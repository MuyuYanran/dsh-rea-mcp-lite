// Grep text file contents inside an Electron app.asar without extracting it.
import fs from 'node:fs';

const ASAR = process.argv[2];
const PATTERN = new RegExp(process.argv[3], 'i');
const PATH_FILTER = process.argv[4] ? new RegExp(process.argv[4], 'i') : null;
const LIMIT = Number(process.argv[5] || 40);

const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonSize = head.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
const tree = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 8 + headerSize;

let printed = 0;
function walk(node, prefix) {
  if (!node || typeof node !== 'object') return;
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, prefix + '/' + name);
    return;
  }
  const size = node.size ?? 0;
  if (size > 4_000_000 || size === 0) return;
  if (!/\.(js|mjs|cjs|json|ts|md|yml|yaml)$/.test(prefix)) return;
  if (PATH_FILTER && !PATH_FILTER.test(prefix)) return;
  let text;
  try {
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, dataStart + Number(node.offset));
    text = buf.toString('utf8');
  } catch { return; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      console.log(`${prefix}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
      if (++printed >= LIMIT) { console.log('--- limit reached ---'); process.exit(0); }
    }
  }
}
walk(tree, '');
console.log('--- done, matches:', printed);
fs.closeSync(fd);
