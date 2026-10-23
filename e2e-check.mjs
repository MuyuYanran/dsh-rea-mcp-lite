// 端到端验证：真实代理 → 真实 REA → 真实外部二进制。
//
// 作用：确认 config.json 的 child.env 真的把外部工具路径交给了 REA，
// 而不是只在 shell 里手设环境变量看起来能跑。
//
// 用法：
//   node e2e-check.mjs                 # 样本放在 samples/，缺了会自动生成
//   node e2e-check.mjs <fixtures-dir>  # 指定自己的样本目录
//
// 目标是「装完就能跑」：样本缺失时自动生成，工具没装时明确报出缺哪个，
// 而不是把某台机器的绝对路径写死在脚本里。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FIXTURES = process.argv[2] ?? path.join(ROOT, 'samples');

// ── 找样本：缺了就用内置的最小生成器补齐 ────────────────────────────────────
async function ensureFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const has = (n) => fs.existsSync(path.join(dir, n));

  if (!has('sample.wat')) {
    fs.writeFileSync(
      path.join(dir, 'sample.wat'),
      `(module
  (import "env" "log" (func $log (param i32)))
  (memory (export "memory") 1)
  (func $add (export "add") (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add)
  (func (export "run") (call $log (i32.const 42)))
)
`,
    );
  }

  // sample.wasm 用内嵌的 base64 常量，不依赖 WABT 先编译——验收脚本不该反过来依赖被测工具。
  // 这 89 字节由上面那份 WAT 经 wabt 1.0.42 的 wat2wasm 生成，并已过 wasm-validate。
  // 结构：Type(3) / Import(1: env.log) / Function(2) / Memory(1, exported) /
  //       Export(3: memory, add, run) / Code(2)。
  // 要换内容就重新生成一次，别手写字节——手写极易在 section size 上出错。
  if (!has('sample.wasm')) {
    fs.writeFileSync(
      path.join(dir, 'sample.wasm'),
      Buffer.from(
        'AGFzbQEAAAABDgNgAX8AYAJ/fwF/YAAAAgsBA2VudgNsb2cAAAMDAgECBQMBAAEHFgMGbWVtb3J5AgADYWRkAAEDcnVuAAIKEAIHACAAIAFqCwYAQSoQAAs=',
        'base64',
      ),
    );
  }

  if (!has('sample.sqlite')) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'sample.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE)');
    db.exec("INSERT INTO users (name, email) VALUES ('alice', 'a@example.com'), ('bob', 'b@example.com')");
    db.close();
  }

  // pcap 手写最小帧（以太网 + IPv4 + UDP/DNS query），避免依赖 scapy 之类
  if (!has('sample.pcap')) {
    const cksum = (buf) => {
      let sum = 0;
      for (let i = 0; i < buf.length; i += 2) sum += (buf[i] << 8) | (buf[i + 1] ?? 0);
      while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
      return (~sum) & 0xffff;
    };
    const dns = Buffer.concat([
      Buffer.from([0xab, 0xcd, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x07]), Buffer.from('example'), Buffer.from([0x03]), Buffer.from('com'),
      Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]),
    ]);
    const udp = Buffer.alloc(8);
    udp.writeUInt16BE(53000, 0);
    udp.writeUInt16BE(53, 2);
    udp.writeUInt16BE(8 + dns.length, 4);
    const ip = Buffer.alloc(20);
    ip.writeUInt8(0x45, 0);
    ip.writeUInt16BE(20 + udp.length + dns.length, 2);
    ip.writeUInt8(64, 8);
    ip.writeUInt8(17, 9);
    Buffer.from([192, 0, 2, 10]).copy(ip, 12);
    Buffer.from([192, 0, 2, 53]).copy(ip, 16);
    ip.writeUInt16BE(cksum(ip), 10);
    const eth = Buffer.alloc(14);
    Buffer.from([0, 0x11, 0x22, 0x33, 0x44, 0x55]).copy(eth, 0);
    Buffer.from([0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb]).copy(eth, 6);
    eth.writeUInt16BE(0x0800, 12);
    const frame = Buffer.concat([eth, ip, udp, dns]);
    const gh = Buffer.alloc(24);
    gh.writeUInt32LE(0xa1b2c3d4, 0);
    gh.writeUInt16LE(2, 4);
    gh.writeUInt16LE(4, 6);
    gh.writeUInt32LE(65535, 16);
    gh.writeUInt32LE(1, 20);
    const rh = Buffer.alloc(16);
    rh.writeUInt32LE(1761000000, 0);
    rh.writeUInt32LE(0, 4);
    rh.writeUInt32LE(frame.length, 8);
    rh.writeUInt32LE(frame.length, 12);
    fs.writeFileSync(path.join(dir, 'sample.pcap'), Buffer.concat([gh, rh, frame]));
  }
}

// ── 起代理 ──────────────────────────────────────────────────────────────────
const CONFIG = path.join(ROOT, 'config.json');
const child = spawn(process.execPath, [path.join(ROOT, 'src', 'proxy.mjs')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REA_LITE_CONFIG: CONFIG },
});

let buf = '';
const pending = new Map();
let seq = 0;
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m); }
  }
});
child.stderr.on('data', (c) => { if (process.env.DEBUG_E2E) process.stderr.write(c); });

const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 300000);
  pending.set(id, (m) => { clearTimeout(t); res(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'e2e', version: '1' },
};

let pass = 0;
let fail = 0;
const skipped = [];
/**
 * @param {string} label 用例名
 * @param {object} res 工具结果
 * @param {RegExp} mustMatch 期望在输出里看到的特征
 * @param {boolean} optional 该工具在这台机器/这个平台上本来就可能不可用
 */
function check(label, res, mustMatch, optional = false) {
  const txt = (res?.content ?? []).map((c) => c.text ?? '').join('');
  const failed = res?.isError === true || /capability_unavailable|VALIDATION_ERROR|^code: /.test(txt.slice(0, 160));
  const hit = mustMatch ? mustMatch.test(txt) : true;
  if (!failed && hit) {
    console.log(`✓ ${label}`);
    pass += 1;
    return;
  }
  const reason = txt.slice(0, 220).replace(/\s+/g, ' ');
  if (optional) {
    console.log(`– ${label}  （本平台不可用）${reason}`);
    skipped.push(label);
    return;
  }
  console.log(`✗ ${label}\n    ${reason}`);
  fail += 1;
}

try {
  await ensureFixtures(FIXTURES);
  await rpc('server/discover', { _meta: meta });
  // 三个族一起加载，确保这些工具真的被暴露出来
  await rpc('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: ['formats', 'debug', 'capture'] }, _meta: meta });

  const call = (tool, args) => rpc('tools/call', { name: tool, arguments: args, _meta: meta }).then((r) => r.result);
  const sampleBinary = process.env.E2E_SAMPLE_BINARY ?? process.execPath;

  check('objdump：BFD 目标清单', await call('inspect_with_objdump', { operation: 'architectures' }), /pe-x86|elf|mach-o/i);
  check('objdump：读文件头', await call('inspect_with_objdump', { path: sampleBinary, operation: 'file_headers' }), /file format|architecture/i);
  check('rizin：一次性命令', await call('execute_rizin_command', { path: sampleBinary, command: 'iI' }), /rizin|arch|bits|class/i);
  check('WABT：读 WASM', await call('inspect_wasm_artifact', { path: path.join(FIXTURES, 'sample.wasm') }), /wasm|sha256|section/i);
  check('SQLite：读库', await call('inspect_sqlite_database', { path: path.join(FIXTURES, 'sample.sqlite'), table: 'users' }), /users|alice|bob/);
  check('Frida：设备列表', await call('list_frida_devices', {}), /Local System|local/i);
  check('Cutter：会话列表', await call('list_cutter_sessions', {}), /sessions|bridge_directory/i, true);
  check('tshark：读抓包摘要', await call('inspect_pcap_capture', { path: path.join(FIXTURES, 'sample.pcap') }), /example\.com|192\.0\.2|TShark/i);
  check('tshark/capinfos：客户端探测', await call('inspect_pcap_client', {}), /\d+\.\d+\.\d+/);
} catch (error) {
  console.log(`✗ 未预期错误：${error.message}`);
  fail += 1;
} finally {
  child.kill();
}

if (skipped.length > 0) console.log(`\n本平台不可用（不算失败）：${skipped.join('、')}`);
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
