// 一次性检查：新模块里有没有「import 了但没用」的符号。
// （写文件而不是内联，避免 shell 引号地狱。）
import fs from 'node:fs';

const files = process.argv.slice(2);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/u);
  const imports = [...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/gu)];
  for (const match of imports) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/u).pop()?.trim();
      if (!name) continue;
      const occurrences = lines.filter((line) => !/^\s*import\s/u.test(line)).join('\n').match(new RegExp(`\\b${name}\\b`, 'gu'));
      if (occurrences === null) console.log(`${file}: 未使用 ${name}（来自 ${match[2]}）`);
    }
  }
  const defaultImport = source.match(/import\s+(\w+)\s+from\s+'(node:[^']+)'/u);
  if (defaultImport) {
    const name = defaultImport[1];
    const occurrences = lines.filter((line) => !/^\s*import\s/u.test(line)).join('\n').match(new RegExp(`\\b${name}\\.`, 'gu'));
    if (occurrences === null) console.log(`${file}: 未使用默认导入 ${name}（来自 ${defaultImport[2]}）`);
  }
}
