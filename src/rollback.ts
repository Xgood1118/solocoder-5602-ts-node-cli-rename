import * as fs from 'fs';
import * as path from 'path';
import { RollbackData, RollbackEntry, RenameRecord } from './types';

const ROLLBACK_DIR = '.bulk-rename-rollback';

export function getRollbackDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ROLLBACK_DIR);
}

export function generateRollbackFilename(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `rollback-${ts}.json`;
}

export async function saveRollback(
  records: RenameRecord[],
  cwd: string = process.cwd()
): Promise<string> {
  const successRecords = records.filter((r) => r.status === 'success');
  if (successRecords.length === 0) {
    return '';
  }

  const rollbackDir = getRollbackDir(cwd);
  if (!fs.existsSync(rollbackDir)) {
    await fs.promises.mkdir(rollbackDir, { recursive: true });
  }

  const entries: RollbackEntry[] = successRecords.map((r) => ({
    oldPath: r.oldPath,
    newPath: r.newPath,
    timestamp: Date.now(),
  }));

  const data: RollbackData = {
    timestamp: Date.now(),
    entries,
  };

  const filename = generateRollbackFilename();
  const filePath = path.join(rollbackDir, filename);
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

export async function loadRollback(
  filePath: string
): Promise<RollbackData> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Rollback 文件不存在: ${filePath}`);
  }
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content) as RollbackData;
}

export async function listRollbackFiles(
  cwd: string = process.cwd()
): Promise<string[]> {
  const rollbackDir = getRollbackDir(cwd);
  if (!fs.existsSync(rollbackDir)) {
    return [];
  }
  const files = await fs.promises.readdir(rollbackDir);
  return files
    .filter((f) => f.startsWith('rollback-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => path.join(rollbackDir, f));
}

export async function executeRollback(
  data: RollbackData,
  dryRun: boolean = false
): Promise<{ success: number; failed: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = data.entries.length - 1; i >= 0; i--) {
    const entry = data.entries[i];
    if (!fs.existsSync(entry.newPath)) {
      skipped++;
      errors.push(`文件不存在，跳过: ${entry.newPath}`);
      continue;
    }

    if (fs.existsSync(entry.oldPath)) {
      skipped++;
      errors.push(`目标文件已存在，跳过: ${entry.oldPath}`);
      continue;
    }

    if (dryRun) {
      success++;
      continue;
    }

    try {
      await fs.promises.rename(entry.newPath, entry.oldPath);
      success++;
    } catch (err: any) {
      failed++;
      errors.push(`${entry.newPath} -> ${entry.oldPath}: ${err.message}`);
    }
  }

  return { success, failed, skipped, errors };
}
