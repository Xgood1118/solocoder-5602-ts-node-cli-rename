import chalk from 'chalk';
import { SingleBar, Presets } from 'cli-progress';
import { RenameRecord, RenameStatus } from './types';

export function createProgressBar(total: number): SingleBar {
  return new SingleBar(
    {
      format:
        chalk.cyan('{bar}') +
        ' {percentage}% | ETA: {eta}s | {value}/{total}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: true,
    },
    Presets.shades_classic
  );
}

function pad(str: string, length: number): string {
  const actualLength = Array.from(str).length;
  if (actualLength >= length) {
    return str.substring(0, length - 3) + '...';
  }
  return str + ' '.repeat(length - actualLength);
}

function formatStatus(status: RenameStatus): string {
  switch (status) {
    case 'success':
      return chalk.green('成功');
    case 'skipped':
      return chalk.yellow('跳过');
    case 'failed':
      return chalk.red('失败');
    default:
      return status;
  }
}

export function printResultsTable(records: RenameRecord[]): void {
  const nameWidth = 40;
  const statusWidth = 6;

  console.log('');
  console.log(
    chalk.bold(
      pad('原文件名', nameWidth) +
        '  ' +
        pad('新文件名', nameWidth) +
        '  ' +
        pad('状态', statusWidth) +
        '  ' +
        '原因'
    )
  );
  console.log('-'.repeat(nameWidth * 2 + statusWidth + 20));

  for (const record of records) {
    const line =
      pad(record.oldName, nameWidth) +
      '  ' +
      pad(record.newName, nameWidth) +
      '  ' +
      pad(formatStatus(record.status), statusWidth) +
      '  ' +
      (record.error ? chalk.gray(record.error) : '');
    console.log(line);
  }

  console.log('');
}

export function printSummary(records: RenameRecord[]): void {
  const success = records.filter((r) => r.status === 'success').length;
  const skipped = records.filter((r) => r.status === 'skipped').length;
  const failed = records.filter((r) => r.status === 'failed').length;
  const total = records.length;

  console.log('');
  console.log(chalk.bold('执行摘要:'));
  console.log(`  总计: ${total} 个文件`);
  console.log(`  ${chalk.green('成功')}: ${success}`);
  console.log(`  ${chalk.yellow('跳过')}: ${skipped}`);
  console.log(`  ${chalk.red('失败')}: ${failed}`);
  console.log('');
}

export function printRollbackResult(result: {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}, dryRun: boolean = false): void {
  console.log('');
  console.log(chalk.bold(dryRun ? '撤销预览摘要:' : '撤销执行摘要:'));
  const successLabel = dryRun ? chalk.blue('预览') : chalk.green('成功');
  console.log(`  ${successLabel}: ${result.success}`);
  console.log(`  ${chalk.yellow('跳过')}: ${result.skipped}`);
  if (!dryRun) {
    console.log(`  ${chalk.red('失败')}: ${result.failed}`);
  }

  if (result.errors.length > 0) {
    console.log('');
    console.log(chalk.bold(chalk.yellow('警告/错误:')));
    for (const err of result.errors) {
      console.log(`  ${chalk.gray(err)}`);
    }
  }
  console.log('');
}

export function printInfo(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}
