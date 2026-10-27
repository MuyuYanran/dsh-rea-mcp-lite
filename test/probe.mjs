#!/usr/bin/env node
// 集成测试：起真实代理 + 真实 REA，验证握手、元工具、按需加载、热切换与转发。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '../src/lite.mjs';
import { META_TOOLS } from '../src/meta-tools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROXY = path.join(HERE, '..', 'src', 'proxy.mjs');
const TEST_CONFIG = path.join(HERE, 'probe-config.json');
/**
 * 预设存储的隔离目录。
 *
 * 预设不跟 REA_LITE_CONFIG 走（见 src/preset-store.mjs）：跟着走的话，config.json 装在
 * 插件包内时预设也会进包内，插件升级一换包就没了 —— 那正是要修的问题。
 * 代价是本脚本必须**单独**告诉代理把预设放哪，否则它会写进真实用户目录 ~/.dsh/rea-lite/。
 */
const TEST_DATA_DIR = path.join(HERE, 'probe-data');
/** 元工具个数从定义处派生，不写死——加元工具时测试不该红。 */
const META_COUNT = META_TOOLS.length;
const META_NAMES_LIST = META_TOOLS.map((t) => t.name);

/**
 * 测试用配置：默认值里**没有**能直接跑的 REA 路径（仓库不携带本机绝对路径），
 * 所以这里从真实 config.json（已 gitignore）借 child 块；没有配置时退回环境变量。
 * 两条都拿不到就让 REA 启动失败并如实报出来 —— 那比偷偷指向别人的磁盘更好。
 */
function testConfig() {
  const base = { activeBundles: [] };
  const real = path.join(HERE, '..', 'config.json');
  if (fs.existsSync(real)) {
    const parsed = JSON.parse(fs.readFileSync(real, 'utf8'));
    if (parsed?.child) return { ...base, child: parsed.child };
  }
  if (process.env.REA_LITE_LAUNCHER) {
    return { ...base, child: { command: process.execPath, args: [process.env.REA_LITE_LAUNCHER, 'mcp'], env: { REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' } } };
  }
  return base;
}

fs.writeFileSync(TEST_CONFIG, JSON.stringify(testConfig(), null, 2));

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
  env: { ...process.env, REA_LITE_CONFIG: TEST_CONFIG, REA_LITE_DATA_DIR: TEST_DATA_DIR },
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
  check('默认只暴露元工具', names1.length === META_COUNT, names1.join(', '));
  check('元工具齐全', META_NAMES_LIST.every((n) => names1.includes(n)));
  const metaTokens = estimateTokens(list1.result.tools);
  console.log(`  元工具上下文成本：~${metaTokens} tok（全量数字随 REA 版本漂移，这里不写死）`);

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
  check('web 族被加载后工具数 = 元工具 + web 族', names2.length === META_COUNT + 15, `${names2.length} 个：${names2.filter((n) => !names1.includes(n)).join(', ')}`);
  check('web 族工具确实在里面', names2.includes('inspect_web_page') && names2.includes('analyze_web_bundle'));
  console.log(`  加载 web 族后上下文成本：~${estimateTokens(list2.result.tools)} tok`);

  // 8. 卸载并确认恢复
  client.notifications.length = 0;
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });
  const changed2 = await client.waitForNotification('notifications/tools/list_changed');
  const list3 = await client.request('tools/list');
  check('热卸载后回到元工具', (list3.result?.tools ?? []).length === META_COUNT, `${list3.result?.tools?.length} 个`);
  check('卸载同样触发 list_changed', !!changed2);

  // 9. 全部加载时的成本（仅统计，不真的加载）
  const all = await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: ['all'] } });
  const list4 = await client.request('tools/list');
  const allTokens = estimateTokens(list4.result.tools);
  const allNames = (list4.result?.tools ?? []).map((t) => t.name);
  // 工具总数随 REA 版本变化（6.4.0=170，6.7.0=207），所以不写死：
  // all 族应当把「元工具之外的全部工具」一个不漏地暴露出来。
  const nonMeta = allNames.filter((n) => !META_NAMES_LIST.includes(n));
  check(
    'all 族暴露全部工具 + 元工具',
    allNames.length === nonMeta.length + META_COUNT && META_NAMES_LIST.every((n) => allNames.includes(n)),
    `${allNames.length} 个（${nonMeta.length} 工具 + ${META_COUNT} 元工具）`,
  );
  console.log(`  全量加载（裁剪后）上下文成本：~${allTokens} tok`);
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });

  // 10. 自定义功能族：用户自己把工具编成一组，并能像内置族一样开关
  //     注意保留 child 块：改配置不能把「怎么拉起 REA」弄丢（重写配置会让子进程换掉）。
  const custom = { 'my-re': { label: '我的常用', hint: '手工挑的', tools: ['address_name', 'procedure_pseudo_code', 'xrefs'] } };
  fs.writeFileSync(TEST_CONFIG, JSON.stringify({ ...testConfig(), activeBundles: [], customBundles: custom }, null, 2));
  await sleep(600); // 等代理 fs.watch 重载配置
  const customRes = await client.request('tools/call', { name: 'bundles', arguments: { action: 'activate', bundles: ['my-re'] } });
  const customText = textOf(customRes.result);
  check('自定义族能被 activate（不报未知族）', !customText.includes('未知功能族'), customText.split('\n')[0] ?? '');
  check('自定义族在 bundles 输出里标为自定义', customText.includes('（自定义）'));
  const list5 = await client.request('tools/list');
  const customNames = (list5.result?.tools ?? []).map((t) => t.name).filter((n) => !META_NAMES_LIST.includes(n));
  check(
    '激活自定义族后只暴露它那 3 个工具',
    customNames.length === 3 && ['address_name', 'procedure_pseudo_code', 'xrefs'].every((n) => customNames.includes(n)),
    customNames.join(', '),
  );
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });

  // 11. 命名预设：把当前这套存下来 → 切走 → 一键切回（模型侧就是 save-preset / load-preset）
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: ['nav', 'evidence'] } });
  const presetSaved = await client.request('tools/call', {
    name: 'bundles',
    arguments: { action: 'save-preset', preset: 'probe-preset', note: 'probe 用' },
  });
  const presetSavedText = textOf(presetSaved.result);
  check('save-preset 存下当前勾选', !presetSaved.result?.isError && presetSavedText.includes('probe-preset'), presetSavedText.split('\\n')[0] ?? '');
  const presetFile = JSON.parse(fs.readFileSync(TEST_CONFIG, 'utf8'));
  const presetStore = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'presets.json'), 'utf8'));
  check(
    '预设落进独立存储（勾选与裁剪档都在）',
    JSON.stringify(presetStore.presets?.['probe-preset']?.activeBundles) === JSON.stringify(['nav', 'evidence']) && typeof presetStore.presets?.['probe-preset']?.lite === 'string',
    JSON.stringify(presetStore.presets?.['probe-preset'] ?? null),
  );
  // 预设写进独立存储后，config.json 不该再持有 presets：两份数据会各自漂移。
  check('config.json 里不再留 presets（唯一归属地在独立存储）', !Object.hasOwn(presetFile, 'presets'));
  check('写预设没弄丢 child（怎么拉起 REA 不能丢）', presetFile.child !== undefined);

  client.notifications.length = 0;
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });
  const presetLoaded = await client.request('tools/call', { name: 'bundles', arguments: { action: 'load-preset', preset: 'probe-preset' } });
  const presetLoadedText = textOf(presetLoaded.result);
  check('load-preset 切回预设的勾选', !presetLoaded.result?.isError && presetLoadedText.includes('nav') && presetLoadedText.includes('evidence'), presetLoadedText.split('\\n')[0] ?? '');
  const presetChanged = await client.waitForNotification('notifications/tools/list_changed');
  check('读取预设触发 tools/list_changed（模型手里的列表跟着换）', !!presetChanged);
  const list6 = await client.request('tools/list');
  const presetNames = (list6.result?.tools ?? []).map((t) => t.name).filter((n) => !META_NAMES_LIST.includes(n));
  // 不写死族内工具数（随 REA 版本漂移）：只要求「非空」且「不含别的族的工具」。
  check(
    '读取后暴露的正是这两族的工具',
    presetNames.length > 0 && presetNames.includes('address_name') && !presetNames.includes('inspect_web_page'),
    `${presetNames.length} 个`,
  );

  const presetBad = await client.request('tools/call', { name: 'bundles', arguments: { action: 'load-preset', preset: '没有这个预设' } });
  check('读取不存在的预设 → 报错并列出可用', presetBad.result?.isError === true && textOf(presetBad.result).includes('没有这个预设'), textOf(presetBad.result).split('\\n')[0] ?? '');

  const presetRemoved = await client.request('tools/call', { name: 'bundles', arguments: { action: 'remove-preset', preset: 'probe-preset' } });
  check('remove-preset 删除预设', !presetRemoved.result?.isError && textOf(presetRemoved.result).includes('已删除'), textOf(presetRemoved.result).split('\\n')[0] ?? '');
  await client.request('tools/call', { name: 'bundles', arguments: { action: 'set', bundles: [] } });
} catch (error) {
  check('测试流程未抛错', false, String(error?.stack ?? error));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) console.log('失败项：\n' + failed.map((f) => `- ${f.name}`).join('\n'));
  try { child.kill(); } catch {}
  try { fs.unlinkSync(TEST_CONFIG); } catch {}
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(failed.length ? 1 : 0);
}
