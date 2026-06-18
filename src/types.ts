export type RenameStatus = 'success' | 'skipped' | 'failed';

export type RenameMode =
  | 'replace'
  | 'regex'
  | 'number'
  | 'date'
  | 'exif'
  | 'case'
  | 'insert'
  | 'delete'
  | 'ext'
  | 'csv';

export type CaseMode = 'lower' | 'upper' | 'title';

export interface ScannerOptions {
  recursive: boolean;
  excludeDirs: string[];
  pattern?: string;
}

export interface ReplaceOptions {
  find: string;
  replace: string;
}

export interface RegexOptions {
  pattern: string;
  flags?: string;
  replace: string;
}

export interface NumberOptions {
  prefix?: string;
  suffix?: string;
  start?: number;
  digits: number;
  keepOriginal?: boolean;
}

export interface DateOptions {
  format: string;
  prefix?: string;
  suffix?: string;
  keepOriginal?: boolean;
}

export interface CaseOptions {
  mode: CaseMode;
}

export interface InsertOptions {
  position: number;
  text: string;
}

export interface DeleteOptions {
  start: number;
  length: number;
}

export interface ExtOptions {
  ext: string;
}

export interface RenameOptions {
  mode: RenameMode;
  dryRun: boolean;
  apply: boolean;
  force: boolean;
  undo?: string;
  replace?: ReplaceOptions;
  regex?: RegexOptions;
  number?: NumberOptions;
  date?: DateOptions;
  exif?: DateOptions;
  case?: CaseOptions;
  insert?: InsertOptions;
  delete?: DeleteOptions;
  ext?: ExtOptions;
  csvFile?: string;
}

export interface RenameRecord {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
  status: RenameStatus;
  error?: string;
}

export interface RollbackEntry {
  oldPath: string;
  newPath: string;
  timestamp: number;
}

export interface RollbackData {
  timestamp: number;
  entries: RollbackEntry[];
}
