import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let tools = null;
for (const line of lines) { try { const m = JSON.parse(line); if (m.id === 2) tools = m.result.tools; } catch {} }
const L = (x) => JSON.stringify(x ?? '').length;
const out = tools.map((t) => `${L(t)}\t${t.name}`).sort((a, b) => Number(b.split('\t')[0]) - Number(a.split('\t')[0]));
fs.writeFileSync(process.argv[3], out.join('\n'), 'utf8');
console.log('wrote', out.length, 'tools');
