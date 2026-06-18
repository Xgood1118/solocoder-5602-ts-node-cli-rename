import * as fs from 'fs';
import * as path from 'path';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import {
  RenameOptions,
  RenameRecord,
  RenameStatus,
  CaseMode,
} from './types';

const WINDOWS_INVALID_CHARS = /[\\/:*?"<>|]/g;
const WINDOWS_MAX_FILENAME_LENGTH = 255;
const REGEX_TIMEOUT_MS = 1000;

if (!isMainThread && parentPort) {
  parentPort.on('message', async (data: { text: string; pattern: string; flags: string }) => {
    try {
      const regex = new RegExp(data.pattern, data.flags);
      const result = regex.exec(data.text);
      parentPort!.postMessage({ success: true, result });
    } catch (err) {
      parentPort!.postMessage({ success: false, error: (err as Error).message });
    }
  });
}

async function regexMatchWithTimeout(
  text: string,
  pattern: string,
  flags: string
): Promise<RegExpExecArray | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename);
    
    let timeout: NodeJS.Timeout | null = null;
    let responded = false;

    const cleanup = (error?: Error) => {
      if (responded) return;
      responded = true;
      
      if (timeout) {
        clearTimeout(timeout);
      }
      
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      
      if (error) {
        reject(error);
      }
    };

    timeout = setTimeout(() => {
      cleanup(new Error('正则表达式执行超时，可能存在 ReDoS 攻击风险'));
    }, REGEX_TIMEOUT_MS);

    worker.on('message', (response: { success: boolean; result?: RegExpExecArray | null; error?: string }) => {
      if (responded) return;
      responded = true;
      
      if (timeout) {
        clearTimeout(timeout);
      }
      
      worker.terminate();
      
      if (response.success) {
        resolve(response.result ?? null);
      } else {
        reject(new Error(response.error || '正则表达式执行失败'));
      }
    });

    worker.on('error', (err) => {
      cleanup(err);
    });

    worker.on('exit', (code) => {
      if (!responded) {
        cleanup(new Error(`正则表达式执行进程异常退出，退出码: ${code}`));
      }
    });

    worker.postMessage({ text, pattern, flags });
  });
}

function pathsEqualCaseInsensitive(path1: string, path2: string): boolean {
  return path.normalize(path1).toLowerCase() === path.normalize(path2).toLowerCase();
}

export function sanitizeFilename(name: string): string {
  return name.replace(WINDOWS_INVALID_CHARS, '_');
}

export function validateFilename(name: string): string | null {
  if (WINDOWS_INVALID_CHARS.test(name)) {
    return `文件名包含非法字符: ${name.match(WINDOWS_INVALID_CHARS)?.join(', ')}`;
  }
  if (name.length > WINDOWS_MAX_FILENAME_LENGTH) {
    return `文件名过长 (${name.length} > ${WINDOWS_MAX_FILENAME_LENGTH})`;
  }
  if (name.trim() === '') {
    return '文件名为空';
  }
  return null;
}

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function formatDate(date: Date, format: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return format
    .replace(/YYYY/g, date.getFullYear().toString())
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

async function getExifDate(_filePath: string): Promise<Date | null> {
  return null;
}

export function applyCaseTransform(
  basename: string,
  mode: CaseMode
): string {
  switch (mode) {
    case 'lower':
      return basename.toLowerCase();
    case 'upper':
      return basename.toUpperCase();
    case 'title':
      return toTitleCase(basename);
    default:
      return basename;
  }
}

export interface TransformContext {
  filePath: string;
  index: number;
  stat?: fs.Stats;
}

export async function computeNewName(
  filePath: string,
  options: RenameOptions,
  context: TransformContext
): Promise<string> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);

  let newBasename = basename;
  let newExt = ext;

  switch (options.mode) {
    case 'replace':
      if (options.replace) {
        newBasename = basename.split(options.replace.find).join(options.replace.replace);
      }
      break;

    case 'regex':
      if (options.regex) {
        try {
          const flags = options.regex.flags || 'g';
          const result = await regexMatchWithTimeout(basename, options.regex.pattern, flags);
          if (result !== null) {
            const re = new RegExp(options.regex.pattern, flags);
            newBasename = basename.replace(re, options.regex.replace);
          }
        } catch (err: any) {
          throw new Error(`正则表达式错误: ${err.message}`);
        }
      }
      break;

    case 'number':
      if (options.number) {
        const start = options.number.start ?? 1;
        const num = (start + context.index).toString().padStart(options.number.digits, '0');
        let name = '';
        if (options.number.prefix) name += options.number.prefix;
        name += num;
        if (options.number.suffix) name += options.number.suffix;
        if (options.number.keepOriginal) name += basename;
        newBasename = name;
      }
      break;

    case 'date':
      if (options.date) {
        const stat = context.stat ?? (await fs.promises.stat(filePath));
        const dateStr = formatDate(stat.mtime, options.date.format);
        let name = '';
        if (options.date.prefix) name += options.date.prefix;
        name += dateStr;
        if (options.date.suffix) name += options.date.suffix;
        if (options.date.keepOriginal) name += basename;
        newBasename = name;
      }
      break;

    case 'exif':
      if (options.exif) {
        const exifDate = await getExifDate(filePath);
        const dateToUse = exifDate ?? context.stat?.mtime ?? new Date();
        const dateStr = formatDate(dateToUse, options.exif.format);
        let name = '';
        if (options.exif.prefix) name += options.exif.prefix;
        name += dateStr;
        if (options.exif.suffix) name += options.exif.suffix;
        if (options.exif.keepOriginal) name += basename;
        newBasename = name;
      }
      break;

    case 'case':
      if (options.case) {
        newBasename = applyCaseTransform(basename, options.case.mode);
      }
      break;

    case 'insert':
      if (options.insert) {
        const pos = Math.max(0, Math.min(options.insert.position, basename.length));
        newBasename =
          basename.substring(0, pos) +
          options.insert.text +
          basename.substring(pos);
      }
      break;

    case 'delete':
      if (options.delete) {
        newBasename =
          basename.substring(0, options.delete.start) +
          basename.substring(options.delete.start + options.delete.length);
      }
      break;

    case 'ext':
      if (options.ext) {
        newExt = options.ext.ext.startsWith('.')
          ? options.ext.ext
          : `.${options.ext.ext}`;
      }
      break;

    case 'csv':
      break;
  }

  newBasename = sanitizeFilename(newBasename);
  return path.join(dir, newBasename + newExt);
}

export function resolveConflict(
  oldPath: string,
  newPath: string,
  existingPaths: Set<string>,
  force: boolean
): { path: string; resolved: boolean } {
  if (pathsEqualCaseInsensitive(oldPath, newPath)) {
    return { path: newPath, resolved: true };
  }

  const existsInPlan = Array.from(existingPaths).some((p) => pathsEqualCaseInsensitive(p, newPath));
  const existsOnDisk = fs.existsSync(newPath);
  
  if (!existsInPlan && !existsOnDisk) {
    return { path: newPath, resolved: true };
  }

  if (!force) {
    return { path: newPath, resolved: false };
  }

  const dir = path.dirname(newPath);
  const ext = path.extname(newPath);
  const basename = path.basename(newPath, ext);

  let counter = 1;
  let candidate: string;

  do {
    candidate = path.join(dir, `${basename}_${counter}${ext}`);
    counter++;
  } while (existingPaths.has(candidate) || fs.existsSync(candidate));

  return { path: candidate, resolved: true };
}

function getDriveLetter(filePath: string): string {
  const match = filePath.match(/^([A-Za-z]):/);
  return match ? match[1].toUpperCase() : '';
}

export async function executeRename(
  oldPath: string,
  newPath: string,
  dryRun: boolean,
  onSuccess?: (oldPath: string, newPath: string) => void
): Promise<{ success: boolean; error?: string }> {
  if (pathsEqualCaseInsensitive(oldPath, newPath)) {
    return { success: false, error: '新旧文件名相同（不区分大小写）' };
  }

  const validationError = validateFilename(path.basename(newPath));
  if (validationError) {
    return { success: false, error: validationError };
  }

  if (!fs.existsSync(oldPath)) {
    return { success: false, error: '源文件不存在' };
  }

  if (dryRun) {
    return { success: true };
  }

  try {
    const newDir = path.dirname(newPath);
    if (!fs.existsSync(newDir)) {
      return { success: false, error: `目标目录不存在: ${newDir}` };
    }

    const oldDrive = getDriveLetter(oldPath);
    const newDrive = getDriveLetter(newPath);
    if (oldDrive && newDrive && oldDrive !== newDrive) {
      return { success: false, error: `跨磁盘重命名不支持（从 ${oldDrive}: 到 ${newDrive}:），请使用复制方式` };
    }

    await fs.promises.rename(oldPath, newPath);
    
    if (onSuccess) {
      onSuccess(oldPath, newPath);
    }
    
    return { success: true };
  } catch (err: any) {
    let errorMsg = err.message || '未知错误';
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      errorMsg = '权限不足';
    } else if (err.code === 'ENOENT') {
      errorMsg = '文件不存在';
    } else if (err.code === 'ENOSPC') {
      errorMsg = '磁盘空间不足';
    } else if (err.code === 'EXDEV') {
      errorMsg = '不支持跨磁盘重命名，请确保源文件和目标文件在同一磁盘';
    }
    return { success: false, error: errorMsg };
  }
}

export interface RenameProcessorCallbacks {
  onProgress?: (record: RenameRecord, current: number, total: number) => void;
  onSuccess?: (oldPath: string, newPath: string) => void;
}

export async function processRenames(
  files: string[],
  options: RenameOptions,
  csvMap?: Map<string, string>,
  callbacks: RenameProcessorCallbacks = {}
): Promise<RenameRecord[]> {
  const results: RenameRecord[] = [];
  const plannedNewPaths: Map<string, string> = new Map();
  const usedNewPaths: Set<string> = new Set();

  const plan: Array<{ oldPath: string; newPath: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const oldPath = files[i];

    let newPath: string;
    if (options.mode === 'csv' && csvMap) {
      const oldName = path.basename(oldPath);
      const mapped = csvMap.get(oldName);
      if (!mapped) {
        results.push({
          oldPath,
          newPath: oldPath,
          oldName,
          newName: oldName,
          status: 'skipped',
          error: 'CSV 中未找到映射',
        });
        if (callbacks.onProgress) {
          callbacks.onProgress(results[results.length - 1], results.length, files.length);
        }
        continue;
      }
      newPath = path.join(path.dirname(oldPath), sanitizeFilename(mapped));
    } else {
      let stat: fs.Stats | undefined;
      try {
        stat = await fs.promises.stat(oldPath);
      } catch {
        // ignore
      }
      newPath = await computeNewName(oldPath, options, {
        filePath: oldPath,
        index: plan.length,
        stat,
      });
    }

    if (pathsEqualCaseInsensitive(oldPath, newPath)) {
      const oldName = path.basename(oldPath);
      results.push({
        oldPath,
        newPath,
        oldName,
        newName: oldName,
        status: 'skipped',
        error: '文件名未变化',
      });
      if (callbacks.onProgress) {
        callbacks.onProgress(results[results.length - 1], results.length, files.length);
      }
      continue;
    }

    const conflict = resolveConflict(oldPath, newPath, usedNewPaths, options.force);
    if (!conflict.resolved) {
      results.push({
        oldPath,
        newPath,
        oldName: path.basename(oldPath),
        newName: path.basename(newPath),
        status: 'skipped',
        error: '文件名冲突',
      });
      if (callbacks.onProgress) {
        callbacks.onProgress(results[results.length - 1], results.length, files.length);
      }
      continue;
    }

    usedNewPaths.add(conflict.path);
    plannedNewPaths.set(oldPath, conflict.path);
    plan.push({ oldPath, newPath: conflict.path });
  }

  const onSuccessCallback = callbacks.onSuccess;

  for (let i = 0; i < plan.length; i++) {
    const { oldPath, newPath } = plan[i];
    const result = await executeRename(
      oldPath,
      newPath,
      options.dryRun || !options.apply,
      onSuccessCallback
    );

    const record: RenameRecord = {
      oldPath,
      newPath,
      oldName: path.basename(oldPath),
      newName: path.basename(newPath),
      status: result.success ? 'success' : 'failed',
      error: result.error,
    };

    results.push(record);

    if (callbacks.onProgress) {
      callbacks.onProgress(record, results.length, files.length);
    }
  }

  return results;
}
