// Inspect an Electron app.asar and locate the dsh MCP client package.
// asar layout: [u32=4][u32 headerSize][u32 headerStringSize][u32 jsonSize][json][padding][data...]
import fs from 'node:fs';

const ASAR = process.argv[2];
const MATCH = process.argv[3] || 'mcp-client';

const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonSize = head.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
const tree = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 8 + headerSize;

const found = [];
function walk(node, prefix) {
  if (!node || typeof node !== 'object') return;
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      walk(child, prefix + '/' + name);
    }
  } else {
    if (prefix.toLowerCase().includes(MATCH.toLowerCase())) {
      found.push({ path: prefix, size: node.size ?? 0, offset: node.offset });
    }
  }
}
walk(tree, '');

console.log('total matches:', found.length);
for (const f of found.slice(0, 200)) console.log(String(f.size).padStart(9), f.path);

// Extract small text files to stdout if asked
const extract = process.argv[4];
if (extract) {
  const hit = found.find((f) => f.path.includes(extract));
  if (!hit) { console.error('no file matching', extract); }
  else {
    const buf = Buffer.alloc(hit.size);
    fs.readSync(fd, buf, 0, hit.size, dataStart + Number(hit.offset));
    console.log('=== ' + hit.path + ' (' + hit.size + ' bytes) ===');
    console.log(buf.toString('utf8'));
  }
}
fs.closeSync(fd);
