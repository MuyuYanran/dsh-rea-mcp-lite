// Inspect the actual shape of one REA tool object: which keys cost what.
import fs from 'node:fs';

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
let tools = null;
for (const line of lines) {
  try {
    const msg = JSON.parse(line);
    if (msg.id === 2 && msg.result?.tools) tools = msg.result.tools;
  } catch {}
}
const L = (x) => JSON.stringify(x ?? '').length;
const total = tools.reduce((a, t) => a + L(t), 0);

// Aggregate cost per top-level key name across all tools
const perKey = new Map();
for (const t of tools) {
  for (const [k, v] of Object.entries(t)) {
    perKey.set(k, (perKey.get(k) ?? 0) + L(v));
  }
}
console.log('total chars:', total);
console.log('--- cost per top-level key (all tools) ---');
for (const [k, v] of [...perKey.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(18)} ${String(v).padStart(9)}  ${((v / total) * 100).toFixed(1)}%`);
}

const biggest = [...tools].sort((a, b) => L(b) - L(a))[0];
console.log('\n--- biggest tool:', biggest.name, '(', L(biggest), 'chars ) ---');
for (const [k, v] of Object.entries(biggest).sort((a, b) => L(b[1]) - L(a[1]))) {
  const s = JSON.stringify(v);
  console.log(`${k.padEnd(18)} ${String(s.length).padStart(9)}  preview: ${s.slice(0, 160).replace(/\s+/g, ' ')}`);
}
