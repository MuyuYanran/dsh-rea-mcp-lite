#!/usr/bin/env node
// 集成测试：起真实代理 + 真实 REA，验证握手、元工具、按需加载、热切换与转发。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '../src/lite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROXY = path.join(HERE, '..', 'src', 'proxy.mjs');
const TEST_CONFIG = path.join(HERE, 'probe-config.json');

fs.writeFileSync(TEST_CONFIG, JSON.stringify({ activeBundles: [] }, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

class McpClient {
  constructor(child) {
    this.child = child;
    this.seq = 0;
    this.pending = new Map();
    this.notifications = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        this.dispatch(msg);
      }
    });
  }
  dispatch(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      entry.resolve(msg);
      return;
    }
    if (msg.method) this.notifications.push(msg);
  }
  request(method, params = {}, timeoutMs = 180000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeoutMs);
      this.pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params = {}) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  async waitForNotification(method, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hit = this.notifications.find((n) => n.method === method);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  }
}

const child = spawn(process.execPath, [PROXY], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REA_LITE_CONFIG: TEST_CONFIG },
  windowsHide: true,
});
child.stderr.on('data', (chunk) => process.stderr.write(`  [proxy] ${chunk}`));

const client = new McpClient(child);
const textOf = (result) => (result?.content ?? []).map((c) => c.text ?? '').join('\n');

try {
  // 1. 握手
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0.1.0' },
  });
  check('initialize 成功', !!init.result, init.result?.serverInfo?.name);
  check('serverInfo 被改写为 rea-lite', init.result?.serverInfo?.name === 'rea-lite', init.result?.serverInfo?.name);
  check('返回了使用说明', typeof init.result?.instructions === 'string' && init.result.instructions.length > 0);
  client.notify('notifications/initialized');

  // 2. 默认只暴露元工具
  const list1 = await client.request('tools/list');
  const names1 = (list1.result?.tools ?? []).map((t) => t.name).sort();
  check('默认只暴露 4 个元工具', names1.length === 4, names1.join(', '));
  check('元工具齐全', ['bundles', 'call_tool', 'search_tools', 'tool_schema'].every((n) => names1.includes(n)));
  const metaTokens = estimateTokens(list1.result.tools);
  console.log(`  元工具上下文成本：~${metaTokens} tok（原全量约 70k tok）`);

  // 3. 搜索全部工具
  const search = await client.request('tools/call', { name: 'search_tools', arguments: { query: 'pseudo', limit: 5 } });
  const searchText = textOf(search.result);
  check('search_tools 能搜到未加载的工具', searchText.includes('procedure_pseudo_code'), searchText.split('\n')[1] ?? '');

  // 4. 查询完整 schema
  const schema = await client.request('tools/call', { name: 'tool_schema', arguments: { tool: 'analyze_function' } });
  check('tool_schema 返回输入 schema', textOf(schema.result).includes('"procedure"'), textOf(schema.result).slice(0, 60).replace(/\n/g, ' '));

  // 5. 功能族一览
  const bundles = await client.request('tools/call', { name: 'bundles', arguments: { action: 'list' } });
  const bundlesText = textOf(bundles.result);
  check('bundles 列出全部功能族', ['nav', 'native', 'js', 'web', 'android', 'managed', 'evidence'].every((b) => bundlesText.includes(b)));
  console.log('  ' + bundlesText.split('\n').slice(0, 3).join('\n  '));

  // 6. 直接调用任意 REA 工具（未加载任何族）
  const direct = await client.request('tools/call', { name: 'call_tool', arguments: { tool: 'list_documents', arguments: {} } });
  const directText = textOf(direct.result);
  check('call_tool 能转发到真实 REA 工具', !direct.error && directText.length > 0, directText.slice(0, 80).replace(/\n/g, ' '));

  // 7. 热加载功能族
  client.notifications.length = 0;
  const activate = await client.request('tools/call', { name: 'bundles', arguments: { action: 'activate', bundles: ['web'] } });
  check('activate 返回成功', !activate.error && textOf(activate.result).includes('已更新'));
  const changed = await client.waitForNotification('notifications/tools/list_changed');
  check('收到 tools/list_changed 通知（热更新）', !!changed);

  const list2 = await client.request('tools/list');
  const names2 = (list2.result?.tools ?? []).map((t) => t.name);
  check('web 族被加载后工具数 = 4 + 15', names2.length === 19, `${names2.length} 个：${names2.filter((n) => !names1.includes(n)).join(', ')}`);
  check('web 族工具确实在里面', names2.includes('inspect_web_page') && names2.includes('analyze_web_bundle'));
  console.log(`  加载 web 族后上下文成本：~${estimateTokens(list2.result.tools)} tok`);

  // 8. 卸载并确认恢复
  client.notifications.length = 0;
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });
  const changed2 = await client.waitForNotification('notifications/tools/list_changed');
  const list3 = await client.request('tools/list');
  check('热卸载后回到 4 个元工具', (list3.result?.tools ?? []).length === 4, `${list3.result?.tools?.length} 个`);
  check('卸载同样触发 list_changed', !!changed2);

  // 9. 全部加载时的成本（仅统计，不真的加载）
  const all = await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: ['all'] } });
  const list4 = await client.request('tools/list');
  const allTokens = estimateTokens(list4.result.tools);
  const allNames = (list4.result?.tools ?? []).map((t) => t.name);
  check('all 族暴露全部 170 个工具', allNames.length === 174, `${allNames.length} 个（170 + 4 元工具）`);
  console.log(`  全量加载（裁剪后）上下文成本：~${allTokens} tok`);
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });
} catch (error) {
  check('测试流程未抛错', false, String(error?.stack ?? error));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) console.log('失败项：\n' + failed.map((f) => `- ${f.name}`).join('\n'));
  try { child.kill(); } catch {}
  try { fs.unlinkSync(TEST_CONFIG); } catch {}
  process.exit(failed.length ? 1 : 0);
}
