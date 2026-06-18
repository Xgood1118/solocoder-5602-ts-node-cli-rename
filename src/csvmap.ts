import * as fs from 'fs';
import { parse } from 'csv-parse';

function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

export async function loadCsvMap(
  filePath: string
): Promise<Map<string, string>> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV 文件不存在: ${filePath}`);
  }

  const map = new Map<string, string>();
  let content = await fs.promises.readFile(filePath, 'utf-8');
  
  content = stripBOM(content);

  return new Promise((resolve, reject) => {
    parse(
      content,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      },
      (err, records: Array<Record<string, string>>) => {
        if (err) {
          reject(new Error(`CSV 解析失败: ${err.message}`));
          return;
        }

        for (const record of records) {
          const keys = Object.keys(record);
          if (keys.length < 2) {
            continue;
          }
          const oldName = record[keys[0]];
          const newName = record[keys[1]];
          if (oldName && newName) {
            map.set(oldName.trim(), newName.trim());
          }
        }

        if (map.size === 0) {
          reject(new Error('CSV 文件中没有有效的映射数据'));
          return;
        }

        resolve(map);
      }
    );
  });
}
