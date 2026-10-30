// 向指定 REA 版本起一个 MCP stdio 会话，导出 tools/list 的完整工具名与描述，用于跨版本比对。
// 用法: node probe-tools.mjs <rea.mjs 路径> <输出 json>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const REA = process.argv[2];
const OUT = process.argv[3] || 'tools.json';

const child = spawn(process.execPath, [REA, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' },
});

let buf = '';
const pending = new Map();
let seq = 0;

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === '') continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[rea] ' + d.toString()));

function rpc(method, params = {}, timeoutMs = 180000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'rea-lite-probe', version: '1.0.0' },
};

const main = async () => {
  const disc = await rpc('server/discover', { _meta: meta });
  const res = await rpc('tools/list', { _meta: meta });
  if (res.error) throw new Error(JSON.stringify(res.error));
  const tools = res.result?.tools ?? [];
  const shape = tools.map((t) => ({
    name: t.name,
    desc: (t.description ?? '').slice(0, 200),
    chars: JSON.stringify(t).length,
  }));
  // README「为什么不是压缩 schema」那张表要的就是这几个数。它们随 REA 版本漂移，
  // 所以跟摘要一起落盘 —— 否则文档数字只能靠另一份缓存报文复算（那次就是这么来的）。
  // L() 与 probe/analyze-tools.mjs 一致：字段缺失按空字符串算，口径可比。
  const L = (value) => JSON.stringify(value ?? '').length;
  const sum = (pick) => tools.reduce((acc, tool) => acc + L(pick(tool)), 0);
  const sizes = {
    total: sum((t) => t),
    outputSchema: sum((t) => t.outputSchema),
    inputSchema: sum((t) => t.inputSchema),
    description: sum((t) => t.description),
    // 真正进模型上下文的部分：DSH 只映射 name + description + inputSchema（见 README 引的那段代码）。
    modelVisible: sum((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  };
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    protocol: '2026-07-28',
    schemaProfile: process.env.REA_MCP_INPUT_SCHEMA_PROFILE ?? '(未设置)',
    serverVersion: disc.result?.serverInfo?.version ?? null,
    toolCount: shape.length,
    sizes,
    tools: shape,
  }, null, 2));
  console.log('server/discover serverInfo =', JSON.stringify(disc.result?.serverInfo ?? null));
  console.log('工具数 =', shape.length);
  console.log('字符数 =', JSON.stringify(sizes));
  console.log('已写入', OUT);
  child.stdin.end();
  setTimeout(() => process.exit(0), 300);
};

main().catch((error) => {
  console.error('失败:', error.message);
  try { child.kill(); } catch {}
  process.exit(1);
});
