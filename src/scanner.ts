import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ScannerOptions } from './types';

const DEFAULT_EXCLUDE_DIRS = ['.git', 'node_modules', '.DS_Store', 'dist', 'build'];

export class FileScanner {
  private options: ScannerOptions;

  constructor(options: Partial<ScannerOptions> = {}) {
    this.options = {
      recursive: options.recursive ?? false,
      excludeDirs: options.excludeDirs ?? DEFAULT_EXCLUDE_DIRS,
      pattern: options.pattern,
    };
  }

  async *scan(directory: string): AsyncGenerator<string> {
    const resolvedDir = path.resolve(directory);

    if (!fs.existsSync(resolvedDir)) {
      throw new Error(`目录不存在: ${resolvedDir}`);
    }

    if (this.options.pattern) {
      const globPattern = this.options.recursive
        ? path.join(resolvedDir, '**', this.options.pattern)
        : path.join(resolvedDir, this.options.pattern);

      const ignorePatterns = this.options.excludeDirs.map(
        (dir) => `**/${dir}/**`
      );

      const stream = glob.stream(globPattern, {
        ignore: ignorePatterns,
        nodir: true,
        withFileTypes: false,
        windowsPathsNoEscape: true,
      });

      for await (const file of stream as AsyncIterable<string>) {
        yield file;
      }
    } else {
      yield* this.walk(resolvedDir);
    }
  }

  private async *walk(dir: string): AsyncGenerator<string> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (this.options.excludeDirs.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (this.options.recursive) {
          yield* this.walk(fullPath);
        }
      } else if (entry.isFile()) {
        yield fullPath;
      }
    }
  }

  async count(directory: string): Promise<number> {
    let count = 0;
    for await (const _ of this.scan(directory)) {
      count++;
    }
    return count;
  }

  async collect(directory: string): Promise<string[]> {
    const files: string[] = [];
    for await (const file of this.scan(directory)) {
      files.push(file);
    }
    return files;
  }
}
