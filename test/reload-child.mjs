// 验证：改动 config.json 的 child.env 后，代理会重启 REA 子进程、重新握手、重取工具列表，
// 并通知客户端刷新。这是「给 REA 补上 REA_TSHARK_COMMAND 之后不重启 DSH 也能生效」的关键路径。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-lite-reload-'));
const CFG = path.join(TMP, 'config.json');

const orig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
fs.writeFileSync(CFG, JSON.stringify({ ...orig, activeBundles: [], persistRuntimeSwitch: false }, null, 2));

const child = spawn(process.execPath, [path.join(ROOT, 'src', 'proxy.mjs')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REA_LITE_CONFIG: CFG },
});

let buf = '';
let stderr = '';
const pending = new Map();
const notifications = [];
const waiters = [];
let seq = 0;

child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method) {
      notifications.push(m.method);
      for (const w of waiters.slice()) {
        if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
      }
    }
    if (m.id !== undefined && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m); }
  }
});
child.stderr.on('data', (c) => { stderr += c.toString(); });

const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  const t = setTimeout(() => rej(new Error('timeout ' + method)), 120000);
  pending.set(id, (m) => { clearTimeout(t); res(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

/** 等某个通知到达，而不是睡固定时长赌它已经到。 */
const waitFor = (method, timeoutMs = 90000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等 ${method} 超时`)), timeoutMs);
  waiters.push({ method, resolve: (m) => { clearTimeout(timer); resolve(m); } });
});

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'reload-test', version: '1' },
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

try {
  await rpc('server/discover', { _meta: meta });
  const first = await rpc('tools/list', { _meta: meta });
  check('握手后能拿到工具列表', (first.result?.tools ?? []).length > 0, `${(first.result?.tools ?? []).length} 个`);

  // 改 child.env（加一个对 REA 无害的变量），模拟「给 REA 补工具路径」的场景
  const changed = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  changed.child = { ...changed.child, env: { ...changed.child.env, REA_LITE_RELOAD_PROBE: '1' } };
  fs.writeFileSync(CFG, JSON.stringify(changed, null, 2));

  await waitFor('notifications/tools/list_changed');
  check('改动 child.env 后向客户端发了 tools/list_changed', true);

  const afterRestart = stderr.slice(stderr.indexOf('子进程启动参数/env 变了'));
  check('检测到 child.env 变更并重启子进程', afterRestart.length > 0);
  check('重启后重新握手成功', /已与新 REA 子进程重新握手/.test(afterRestart));
  check(
    '重启后重新预取工具列表',
    /已缓存 \d+ 个 REA 工具的 schema/.test(afterRestart),
    (afterRestart.match(/已缓存 \d+ 个/) ?? [''])[0],
  );

  const again = await rpc('tools/list', { _meta: meta });
  check('重启后 tools/list 仍正常返回', (again.result?.tools ?? []).length > 0, `${(again.result?.tools ?? []).length} 个`);
} catch (error) {
  check(`未预期错误：${error.message}`, false);
} finally {
  if (process.env.DEBUG_RELOAD) console.log('--- stderr ---\n' + stderr + '\n--------------');
  child.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '通过' : '失败'} ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
