#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';

import { FileScanner } from './scanner';
import { processRenames } from './rename';
import {
  saveRollback,
  loadRollback,
  executeRollback,
  listRollbackFiles,
} from './rollback';
import {
  createProgressBar,
  printResultsTable,
  printSummary,
  printRollbackResult,
  printInfo,
  printWarning,
  printError,
  printSuccess,
} from './display';
import { loadCsvMap } from './csvmap';
import { RenameOptions, RenameMode } from './types';

const program = new Command();

program
  .name('bulk-rename')
  .description('批量文件重命名命令行工具')
  .version('1.0.0');

program
  .option('-r, --recursive', '递归处理子目录', false)
  .option('-p, --pattern <glob>', '文件匹配模式 (如 *.png)')
  .option('--dry-run', '预览模式，不实际执行重命名', false)
  .option('--apply', '确认执行重命名（必须显式指定）', false)
  .option('--force', '文件名冲突时自动添加序号后缀', false)
  .option('--exclude <dirs>', '排除的目录，逗号分隔', '.git,node_modules,.DS_Store')
  .option('--undo [file]', '撤销操作，指定 rollback 文件或使用最近一次')
  .option('--list-rollbacks', '列出所有可用的 rollback 文件')
  .option('-d, --dir <directory>', '处理目录', '.')
  .option('--replace <find>,<replace>', '纯字符串替换')
  .option('--regex <pattern>,<replace>', '正则表达式替换')
  .option('--regex-flags <flags>', '正则表达式标志，默认 g')
  .option('--number', '编号模式')
  .option('--number-prefix <prefix>', '编号前缀')
  .option('--number-suffix <suffix>', '编号后缀')
  .option('--number-start <n>', '编号起始值', '1')
  .option('--number-digits <n>', '编号位数（0 填充）', '3')
  .option('--number-keep-original', '编号模式下保留原文件名', false)
  .option('--date', '按文件修改日期（mtime）改名')
  .option('--exif', '按 EXIF 拍摄日期改名（图片）')
  .option('--date-format <format>', '日期格式，默认 YYYYMMDD-HHmmss', 'YYYYMMDD-HHmmss')
  .option('--date-prefix <prefix>', '日期前缀')
  .option('--date-suffix <suffix>', '日期后缀')
  .option('--date-keep-original', '日期模式下保留原文件名', false)
  .option('--case <mode>', '大小写转换: lower|upper|title')
  .option('--insert <position>,<text>', '在指定位置插入字符')
  .option('--delete <start>,<length>', '从 start 位置删除 length 个字符')
  .option('--ext <extension>', '批量修改扩展名')
  .option('--csv <file>', 'CSV 映射文件（两列：old_name,new_name）');

async function main() {
  program.parse(process.argv);
  const opts = program.opts();

  if (opts.listRollbacks) {
    const files = await listRollbackFiles();
    if (files.length === 0) {
      printInfo('没有找到 rollback 文件');
    } else {
      console.log(chalk.bold('可用的 rollback 文件:'));
      for (const f of files) {
        console.log(`  ${f}`);
      }
    }
    return;
  }

  if (opts.undo !== undefined) {
    let rollbackFile: string;
    if (typeof opts.undo === 'string' && opts.undo.length > 0) {
      rollbackFile = path.resolve(opts.undo);
    } else {
      const files = await listRollbackFiles();
      if (files.length === 0) {
        printError('没有找到可撤销的 rollback 文件');
        process.exit(1);
      }
      rollbackFile = files[0];
    }

    printInfo(`使用 rollback 文件: ${rollbackFile}`);
    const data = await loadRollback(rollbackFile);
    printInfo(`将撤销 ${data.entries.length} 个文件的重命名`);

    if (!opts.apply) {
      printWarning('这是预览模式，未实际执行。加 --apply 确认撤销');
    }

    const result = await executeRollback(data, !opts.apply || opts.dryRun);
    printRollbackResult(result);
    return;
  }

  let mode: RenameMode | null = null;

  if (opts.replace) mode = 'replace';
  else if (opts.regex) mode = 'regex';
  else if (opts.number) mode = 'number';
  else if (opts.date) mode = 'date';
  else if (opts.exif) mode = 'exif';
  else if (opts.case) mode = 'case';
  else if (opts.insert) mode = 'insert';
  else if (opts.delete) mode = 'delete';
  else if (opts.ext) mode = 'ext';
  else if (opts.csv) mode = 'csv';

  if (!mode) {
    printError('请指定一种重命名模式。使用 --help 查看所有选项。');
    program.help();
    return;
  }

  const excludeDirs = opts.exclude.split(',').map((d: string) => d.trim());

  const options: RenameOptions = {
    mode,
    dryRun: opts.dryRun,
    apply: opts.apply,
    force: opts.force,
  };

  switch (mode) {
    case 'replace': {
      const parts = opts.replace.split(',');
      if (parts.length < 2) {
        printError('--replace 格式错误，应为: find,replace');
        process.exit(1);
      }
      options.replace = { find: parts[0], replace: parts.slice(1).join(',') };
      break;
    }
    case 'regex': {
      const parts = opts.regex.split(',');
      if (parts.length < 2) {
        printError('--regex 格式错误，应为: pattern,replace');
        process.exit(1);
      }
      options.regex = {
        pattern: parts[0],
        replace: parts.slice(1).join(','),
        flags: opts.regexFlags || 'g',
      };
      break;
    }
    case 'number':
      options.number = {
        prefix: opts.numberPrefix,
        suffix: opts.numberSuffix,
        start: parseInt(opts.numberStart, 10),
        digits: parseInt(opts.numberDigits, 10),
        keepOriginal: opts.numberKeepOriginal,
      };
      break;
    case 'date':
    case 'exif':
      options[mode] = {
        format: opts.dateFormat,
        prefix: opts.datePrefix,
        suffix: opts.dateSuffix,
        keepOriginal: opts.dateKeepOriginal,
      };
      break;
    case 'case': {
      const caseMode = opts.case.toLowerCase();
      if (!['lower', 'upper', 'title'].includes(caseMode)) {
        printError('--case 参数必须是 lower、upper 或 title');
        process.exit(1);
      }
      options.case = { mode: caseMode as any };
      break;
    }
    case 'insert': {
      const parts = opts.insert.split(',');
      if (parts.length < 2) {
        printError('--insert 格式错误，应为: position,text');
        process.exit(1);
      }
      options.insert = {
        position: parseInt(parts[0], 10),
        text: parts.slice(1).join(','),
      };
      break;
    }
    case 'delete': {
      const parts = opts.delete.split(',');
      if (parts.length < 2) {
        printError('--delete 格式错误，应为: start,length');
        process.exit(1);
      }
      options.delete = {
        start: parseInt(parts[0], 10),
        length: parseInt(parts[1], 10),
      };
      break;
    }
    case 'ext':
      options.ext = { ext: opts.ext };
      break;
  }

  let csvMap: Map<string, string> | undefined;
  if (mode === 'csv' && opts.csv) {
    try {
      csvMap = await loadCsvMap(path.resolve(opts.csv));
      printInfo(`已加载 ${csvMap.size} 条 CSV 映射`);
    } catch (err: any) {
      printError(err.message);
      process.exit(1);
    }
  }

  if (!opts.apply) {
    printWarning('预览模式（--dry-run）：不会实际修改文件。加 --apply 确认执行');
  }

  const targetDir = path.resolve(opts.dir);
  printInfo(`扫描目录: ${targetDir}`);

  const scanner = new FileScanner({
    recursive: opts.recursive,
    excludeDirs,
    pattern: opts.pattern,
  });

  const files = await scanner.collect(targetDir);
  if (files.length === 0) {
    printWarning('没有找到匹配的文件');
    return;
  }

  printInfo(`找到 ${files.length} 个文件`);

  const progressBar = createProgressBar(files.length);
  progressBar.start(files.length, 0);

  const results = await processRenames(files, options, csvMap, {
    onProgress: (_record, current) => {
      progressBar.update(current);
    },
  });

  progressBar.stop();

  printResultsTable(results);
  printSummary(results);

  if (opts.apply && !opts.dryRun) {
    const rollbackPath = await saveRollback(results);
    if (rollbackPath) {
      printSuccess(`已保存 rollback 文件: ${rollbackPath}`);
      printInfo(`使用 --undo ${rollbackPath} 可撤销本次操作`);
    }
  }
}

main().catch((err) => {
  printError(err.message || '执行出错');
  console.error(err);
  process.exit(1);
});
