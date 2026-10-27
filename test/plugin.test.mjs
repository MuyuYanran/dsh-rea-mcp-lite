// dsh-rea-lite-panel 自检：用假的 Cordis 上下文驱动真实的 apply()，
// 再直接用 React 存根渲染一遍页面，验证「设置页确实注册上、API 确实能读写」。
//
// 不启动 DSH、不启动 REA、不碰真实 config.json（写到临时目录）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PLUGIN = path.join(REPO, 'dsh-plugin');

/** 直接读快照文件，用于和插件报告的数值交叉核对（避免把工具数量写死在测试里）。 */
function readSnapshotRaw() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'tools-model.json'), 'utf8'));
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

// ── 测试替身 ────────────────────────────────────────────────────────────────

function fakeCtx({ schemas = [], entries = [] } = {}) {
  const routes = [];
  const cleanups = [];
  return {
    routes,
    cleanups,
    ctx: {
      effect(fn, label) {
        const disposer = fn();
        cleanups.push({ label, disposer });
        return () => {
          if (typeof disposer === 'function') disposer();
        };
      },
      get(name) {
        if (name === 'tools') return { schemas: () => schemas };
        if (name === 'loader') return { entries: () => entries };
        return undefined;
      },
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    },
  };
}

function fakeReq({ method = 'GET', url = '/rea-lite/state', body, remote = '127.0.0.1' } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    url,
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeRes() {
  const res = { status: 0, payload: undefined };
  res.writeHead = (status) => {
    res.status = status;
  };
  res.end = (text) => {
    res.payload = text === undefined || text === '' ? undefined : JSON.parse(text);
  };
  return res;
}

async function call(handler, options) {
  const res = fakeRes();
  await handler(fakeReq(options), res);
  return res;
}

/** 假 React：够跑通组件函数、拿到元素树即可。 */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
  };
}

/** 在隔离环境里执行浏览器半的 bundle，捕获它注册的模块。 */
function loadClientBundle() {
  const source = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');
  let captured = null;
  const documentStub = {
    head: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { captured = definition; } } },
    document: documentStub,
    console,
    fetch: () => Promise.reject(new Error('测试里不应真的发请求')),
  };
  // 只求值，不执行 factory（factory 里不含顶层副作用）。
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  return { captured, sandbox };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-lite-panel-test-'));
const tempConfig = path.join(tmpDir, 'config.json');
const originalConfigEnv = process.env.REA_LITE_CONFIG;
const originalDataEnv = process.env.REA_LITE_DATA_DIR;
process.env.REA_LITE_CONFIG = tempConfig;
// 预设存储**不跟着** REA_LITE_CONFIG 走（见 src/preset-store.mjs），必须单独指到临时目录，
// 否则测试会把预设写进真实用户目录 ~/.dsh/rea-lite/。
process.env.REA_LITE_DATA_DIR = tmpDir;
const initialConfig = {
  mode: 'gateway',
  activeBundles: [],
  metaTools: true,
  lite: 'mild',
  shortDescription: true,
  persistRuntimeSwitch: true,
  toolCallTimeoutMs: 600000,
  child: { command: process.execPath, args: ['x.mjs', 'mcp'], env: { REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' } },
};
fs.writeFileSync(tempConfig, `${JSON.stringify(initialConfig, null, 2)}\n`, 'utf8');

try {
  console.log('宿主半（lib/index.js）');

  const schemaChars = (name, description, parameters) =>
    JSON.stringify({ name, description, inputSchema: parameters }).length;

  const { apply, name, inject, resolveGatewayRoot, computeState, gatewayCandidates, scanPatch, patchDisabledNames, patchLayers, reaServerState, resolvePatchPath } = await import(
    pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href
  );
  const { BUNDLES } = await import(pathToFileURL(path.join(REPO, 'src', 'bundles.mjs')).href);

  check('插件名与注入声明', name === 'dsh-rea-lite-panel' && inject.includes('webServer'));
  check('默认从仓库布局认出网关根目录', resolveGatewayRoot(undefined) === REPO, resolveGatewayRoot(undefined));
  check('候选目录优先用显式配置', gatewayCandidates('D:\\x')[0] === path.resolve('D:\\x'));

  const reaSchemas = [
    { name: 'mcp__rea__bundles', description: 'list bundles', parameters: { type: 'object' } },
    { name: 'mcp__rea__call_tool', description: 'call any tool', parameters: { type: 'object' } },
    { name: 'mcp__cc-switch__list', description: 'not rea', parameters: {} },
    { name: 'read_file', description: 'builtin', parameters: {} },
  ];
  const loaderEntries = [
    { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'rea' } }, fiber: { state: 2 } },
    { options: { name: 'other-plugin', config: {} } },
  ];
  const { ctx, routes } = fakeCtx({ schemas: reaSchemas, entries: loaderEntries });
  const neutralPatch = path.join(tmpDir, 'neutral.cordis.patch.yml');
  fs.writeFileSync(neutralPatch, '- id: mnemon-strategy-auto-capture\n  disabled: false\n', 'utf8');
  apply(ctx, { patchPath: neutralPatch });

  check('注册了一条 prefix 路由', routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/rea-lite');
  const handler = routes[0].handler;

  const stateRes = await call(handler, { url: '/rea-lite/state' });
  const state = stateRes.payload;
  check('GET /state → 200', stateRes.status === 200);
  check('读到临时配置文件', state.configPath === tempConfig, state.configPath);
  check('功能族数量与 bundles.mjs 一致', state.bundles.length === Object.keys(BUNDLES).length, `${state.bundles.length} 个: ${state.bundles.map((b) => b.id).join(',')}`);
  // 预设列表：旧宿主半没这个字段时浏览器半要退化成空列表，接口这层必须是数组。
  check('状态里带出预设列表（为空时是空数组）', Array.isArray(state.presets) && state.presets.length === 0, JSON.stringify(state.presets));

  // 族内工具清单：面板靠它做「看族内工具」展开，缺了就只能显示数字。
  const navBundle = state.bundles.find((b) => b.id === 'nav');
  check('每个族带 toolCount 个族内工具名', navBundle && Array.isArray(navBundle.tools) && navBundle.tools.length === navBundle.toolCount, `nav: ${navBundle?.tools?.length}/${navBundle?.toolCount}`);
  check('族内工具项含名字与成本', Boolean(navBundle?.tools?.[0]?.name) && typeof navBundle?.tools?.[0]?.tokens === 'number');
  check('族内工具成本之和不超过该族总成本', navBundle.tools.reduce((s, x) => s + x.tokens, 0) <= navBundle.tokens * 1.02);
  // 风险标记：debug/capture/formats 需要目标环境或外部工具链，面板上要能区分出来。
  check('debug 族标了 risky', state.bundles.find((b) => b.id === 'debug')?.risky === true);
  check('nav 族不标 risky', state.bundles.find((b) => b.id === 'nav')?.risky === false);
  // 老版本 REA（当前快照即 6.4.0）没有 debug 族的工具，面板必须能说清「是版本没有，不是坏了」。
  const debugBundle = state.bundles.find((b) => b.id === 'debug');
  check(
    'REA 版本没有的族标 unavailable',
    debugBundle.unavailable === (debugBundle.toolCount === 0),
    `debug toolCount=${debugBundle.toolCount} unavailable=${debugBundle.unavailable}`,
  );
  check('available 的族不误标 unavailable', state.bundles.find((b) => b.id === 'nav').unavailable === false);
  check('unavailable 的族仍报出定义了多少个工具', debugBundle.definedTools > 0, `defined=${debugBundle.definedTools}`);
  check(
    '每个族都有中文标签与提示',
    state.bundles.every((b) => typeof b.label === 'string' && b.label !== '' && typeof b.hint === 'string'),
  );
  check(
    '快照工数等于快照文件自报的数量',
    state.snapshot.present && state.snapshot.toolCount === readSnapshotRaw().toolCount,
    `tools=${state.snapshot.toolCount}`,
  );
  check('元工具成本为正且小于 1k', state.metaTokens > 0 && state.metaTokens < 1000, `meta=${state.metaTokens}`);
  check('当前仅元工具时合计 == 元工具', state.activeTokens === state.metaTokens, `active=${state.activeTokens}`);
  // 全量成本 = 快照里全部工具的成本 + 元工具（'all' 时元工具与工具同时暴露）。
  // 基准取内置快照自报值，避免把某个 REA 版本的数值写死。
  check(
    '全量成本 == 快照 totalTokens + 元工具',
    state.totalTokens === readSnapshotRaw().totalTokens + readSnapshotRaw().metaTokens,
    `total=${state.totalTokens} / 期望=${readSnapshotRaw().totalTokens}+${readSnapshotRaw().metaTokens}`,
  );
  check('实测只数 mcp__rea__*', state.live.toolCount === 2, `live=${state.live.toolCount}`);
  check(
    '实测 token 与 lite.mjs 同口径',
    state.live.tokens === Math.round((schemaChars('mcp__rea__bundles', 'list bundles', { type: 'object' }) + schemaChars('mcp__rea__call_tool', 'call any tool', { type: 'object' })) / 3.6),
    `live=${state.live.tokens}`,
  );
  check('识别出 rea 服务器已连接', state.server.phase === 'active', state.server.phase);
  const webBundle = state.bundles.find((b) => b.id === 'web');
  check('web 族：15 个工具、成本 > 0', webBundle.toolCount === 15 && webBundle.tokens > 0, `${webBundle.toolCount} / ${webBundle.tokens} tok`);
  check('未勾选时族都是未激活', state.bundles.every((b) => b.active === false));

  const saveRes = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: ['web', 'js'] } });
  check('POST /active → 200', saveRes.status === 200 && saveRes.payload.saved === true);
  check('保存后 applied=hot（服务器在跑）', saveRes.payload.applied === 'hot', saveRes.payload.applied);
  const written = JSON.parse(fs.readFileSync(tempConfig, 'utf8'));
  check('config.json 写入了 activeBundles', JSON.stringify(written.activeBundles) === JSON.stringify(['web', 'js']), JSON.stringify(written.activeBundles));
  check('其余配置字段原样保留', written.child.args[0] === 'x.mjs' && written.lite === 'mild');
  check('保存后的状态反映勾选', saveRes.payload.state.activeBundles.join(',') === 'web,js');
  check(
    '成本 = 元工具 + web + js',
    saveRes.payload.state.activeTokens ===
      saveRes.payload.state.metaTokens +
        saveRes.payload.state.bundles.filter((b) => b.id === 'web' || b.id === 'js').reduce((sum, b) => sum + b.tokens, 0),
    `active=${saveRes.payload.state.activeTokens}`,
  );

  const allRes = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: ['all'] } });
  check('全部加载 == 快照全量 + 元工具', allRes.payload.state.activeTokens === allRes.payload.state.totalTokens);
  check('全部加载时 savings 为 0', allRes.payload.state.savings === 0, String(allRes.payload.state.savings));

  const noneRes = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: [] } });
  // 节省比例 = 1 - 元工具/全量。全量本身随 REA 版本漂移，所以只断言公式成立、且确实省下绝大部分。
  const expectedSavings = Math.round((1 - noneRes.payload.state.metaTokens / noneRes.payload.state.totalTokens) * 1000) / 10;
  check(
    '仅元工具时的节省比例符合公式',
    noneRes.payload.state.savings === expectedSavings && expectedSavings > 95,
    `${noneRes.payload.state.savings}% (期望 ${expectedSavings}%)`,
  );

  const badRes = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: ['nope'] } });
  check('未知功能族 → 400 且报出名字', badRes.status === 400 && String(badRes.payload.error).includes('nope'), badRes.payload.error);
  const badType = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: 'web' } });
  check('bundles 非数组 → 400', badType.status === 400, badType.payload.error);

  // ── 自定义分组（POST /custom）─────────────────────────────────────────────
  console.log('\n自定义分组');
  const madeRes = await call(handler, {
    method: 'POST',
    url: '/rea-lite/custom',
    body: { id: 'my-fav', label: '我的常用', tools: ['address_name', 'xrefs'] },
  });
  check('POST /custom 新建分组 → 200', madeRes.status === 200 && madeRes.payload.saved === true, madeRes.payload.error ?? '');
  const madeBundle = madeRes.payload.state.bundles.find((b) => b.id === 'my-fav');
  check('新分组出现在状态里并标 custom', madeBundle?.custom === true && madeBundle.label === '我的常用');
  check('新分组按快照算出了工具数与成本', madeBundle.toolCount === 2 && madeBundle.tokens > 0, `${madeBundle.toolCount} 个 / ${madeBundle.tokens} tok`);
  const persisted = JSON.parse(fs.readFileSync(tempConfig, 'utf8'));
  check(
    '新分组写进了 config.json 的 customBundles',
    persisted.customBundles?.['my-fav']?.tools?.length === 2,
    JSON.stringify(persisted.customBundles?.['my-fav']?.tools),
  );
  check('写分组不破坏 activeBundles 等既有字段', Array.isArray(persisted.activeBundles) && persisted.lite === 'mild');

  const useCustom = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: ['my-fav'] } });
  check('自定义分组能被勾选为激活', useCustom.status === 200 && useCustom.payload.state.allActive === false);
  check('激活后成本 = 元工具 + 该组两个工具', useCustom.payload.state.activeTokens > useCustom.payload.state.metaTokens);

  const badId = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'Bad Name', tools: ['xrefs'] } });
  check('非法组名 → 400', badId.status === 400 && String(badId.payload.error).includes('不合法'), badId.payload.error);
  const dupId = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'native', tools: ['xrefs'] } });
  check('与内置族重名 → 400', dupId.status === 400 && String(dupId.payload.error).includes('内置族'), dupId.payload.error);
  const unknownTool = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'ok-id', tools: ['no_such_tool'] } });
  check('未知工具 → 400 并报出名字', unknownTool.status === 400 && String(unknownTool.payload.error).includes('no_such_tool'), unknownTool.payload.error);
  const emptyTools = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'ok-id', tools: [] } });
  check('空工具列表 → 400', emptyTools.status === 400, emptyTools.payload.error);

  const delRes = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'my-fav', delete: true } });
  check('删除分组 → 200 且从状态里消失', delRes.status === 200 && !delRes.payload.state.bundles.some((b) => b.id === 'my-fav'));
  check('删除时同时从 activeBundles 摘掉', !delRes.payload.state.activeBundles.includes('my-fav'), delRes.payload.state.activeBundles.join(','));
  const delMissing = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'ghost', delete: true } });
  check('删除不存在的分组 → 400', delMissing.status === 400, delMissing.payload.error);

  // 编辑已有分组：改工具集合 + 改组名（勾选要跟着迁走）
  const again = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'edit-me', label: '待编辑', tools: ['address_name'] } });
  check('先建一个待编辑的组', again.status === 200 && again.payload.state.bundles.some((b) => b.id === 'edit-me'));
  await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: ['edit-me'] } });
  const editedRes = await call(handler, {
    method: 'POST',
    url: '/rea-lite/custom',
    body: { id: 'edit-me', label: '改过的名字', tools: ['address_name', 'xrefs', 'read_bytes'], renameFrom: 'edit-me' },
  });
  check(
    '编辑：工具集合被替换',
    editedRes.status === 200 && editedRes.payload.state.bundles.find((b) => b.id === 'edit-me')?.toolCount === 3,
    editedRes.payload.error ?? '',
  );
  check('编辑：显示名被更新', editedRes.payload.state.bundles.find((b) => b.id === 'edit-me')?.label === '改过的名字');

  const renamedRes = await call(handler, {
    method: 'POST',
    url: '/rea-lite/custom',
    body: { id: 'edit-me-2', label: '改过的名字', tools: ['address_name', 'xrefs', 'read_bytes'], renameFrom: 'edit-me' },
  });
  check(
    '改名：新 id 出现、旧 id 消失',
    renamedRes.status === 200 &&
      renamedRes.payload.state.bundles.some((b) => b.id === 'edit-me-2') &&
      !renamedRes.payload.state.bundles.some((b) => b.id === 'edit-me'),
    renamedRes.payload.error ?? '',
  );
  check(
    '改名：activeBundles 里的勾选跟着迁到新名',
    renamedRes.payload.state.activeBundles.includes('edit-me-2') && !renamedRes.payload.state.activeBundles.includes('edit-me'),
    renamedRes.payload.state.activeBundles.join(','),
  );
  const renameMissing = await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'x2', tools: ['xrefs'], renameFrom: 'nope-group' } });
  check('改自不存在的组 → 400', renameMissing.status === 400, renameMissing.payload.error);
  await call(handler, { method: 'POST', url: '/rea-lite/custom', body: { id: 'edit-me-2', delete: true } });

  // 「全部工具」视图：分组编辑器靠它一次列出所有工具，而不是逼用户先搜索
  const allToolsRes = await call(handler, { url: '/rea-lite/tools' });
  check(
    '不带 q 时返回全部工具',
    allToolsRes.status === 200 && allToolsRes.payload.total === allToolsRes.payload.matches.length,
    `${allToolsRes.payload.total} 个`,
  );
  check(
    '每个工具带一句话定义，供勾选时判断',
    typeof allToolsRes.payload.matches[0]?.desc === 'string' && allToolsRes.payload.matches[0].desc !== '',
  );
  check(
    '同时返回可选的分组清单',
    Array.isArray(allToolsRes.payload.bundleOptions) && allToolsRes.payload.bundleOptions.length >= Object.keys(BUNDLES).length,
    `${allToolsRes.payload.bundleOptions?.length} 个`,
  );

  // 复位，后面的断言按「仅元工具」基线算
  await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: [] } });

  const searchRes = await call(handler, { url: '/rea-lite/tools?q=decompile' });
  check(
    '工具搜索命中反编译类工具并带族标签',
    searchRes.status === 200 && searchRes.payload.matches.length > 0 && searchRes.payload.matches.every((m) => Array.isArray(m.bundles)),
    `${searchRes.payload.total} 个匹配`,
  );
  const adbRes = await call(handler, { url: '/rea-lite/tools?q=adb&limit=5' });
  check('搜索尊重 limit', adbRes.payload.matches.length <= 5 && adbRes.payload.total >= adbRes.payload.matches.length);

  const forbidden = await call(handler, { url: '/rea-lite/state', remote: '10.0.0.7' });
  check('非回环来源 → 403', forbidden.status === 403, forbidden.payload.error);
  const notFound = await call(handler, { url: '/rea-lite/nope' });
  check('未知路由 → 404', notFound.status === 404, notFound.payload.error);
  const readOnly = await call(handler, { method: 'POST', url: '/rea-lite/active', body: { bundles: [] } });
  check('合法写回仍可用', readOnly.status === 200);

  // 未归族 / 缺快照的分支：computeState 是纯函数，直接喂极端输入。
  const empty = computeState({ root: REPO, configPath: tempConfig, config: { activeBundles: [] }, bundleDefs: {}, allBundle: 'all', snapshot: null });
  check('没有快照时给警告且成本为 0', empty.snapshot.present === false && empty.activeTokens === 0 && empty.warnings.length > 0);
  check('没有快照时不显示省下百分比', empty.savings === 0);

  console.log('\n停用判定（patch 覆写 / 实测优先）');

  // patch 的两种写法：块里直接写 serverName，或只写 id（真正带 serverName 的行在别层）。
  const scan = scanPatch(
    [
      '# 注释里的 disabled: true 不算数',
      '- insert:',
      '    - id: mcp-cc-switch',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: cc-switch',
      '    - id: inline-off',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: inline',
      '        command: node   # disabled: true 只是注释',
      '    - id: inline-off-real',
      '      disabled: true',
      '      config:',
      '        serverName: inline2',
      '    - id: only-id-off',
      '      disabled: true',
    ].join('\n'),
  );
  check('同块 serverName + disabled 直接认出', scan.disabledNames.has('inline2'), [...scan.disabledNames].join(','));
  check('只写 id 的停用记录在 disabledIds', scan.disabledIds.has('only-id-off'), [...scan.disabledIds].join(','));
  check('注释里的 disabled 不生效', !scan.disabledNames.has('inline') && !scan.disabledIds.has('inline-off'));

  // 真实形状：profile 层写「停用哪个 id」，$DSH_HOME 层写「这个 id 是哪个服务器」。
  const profilePatch = path.join(tmpDir, 'profile.cordis.patch.yml');
  fs.writeFileSync(profilePatch, '- id: mcp-cc-switch\n  disabled: true\n- id: rea-mcp\n  disabled: true\n', 'utf8');
  const homePatch = path.join(tmpDir, 'home.cordis.patch.yml');
  fs.writeFileSync(
    homePatch,
    ['- insert:', '    - id: rea-mcp', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: rea', '        command: node', ''].join('\n'),
    'utf8',
  );
  const merged = patchDisabledNames([homePatch, profilePatch]);
  check('跨层把「停用 id」还原成 serverName', merged.names.has('rea'), [...merged.names].join(','));
  check('无法归属的停用 id 只留 id，不乱猜 serverName', !merged.names.has('cc-switch') && merged.ids.has('mcp-cc-switch'));
  check('patchLayers 给了显式层就只用它', patchLayers({}, profilePatch).join(',') === profilePatch);
  check(
    'patchLayers 默认找 $DSH_HOME 与 profile 两层',
    patchLayers({}, undefined).length === 2 && patchLayers({}, undefined)[0].endsWith('cordis.patch.yml'),
  );

  // cordis:include 给的是 file:// URL（含空格也要能解码成真路径）。
  const includeCtx = {
    get: () => ({
      entries: () => [{ options: { name: 'cordis:include', config: { path: 'file:///D:/A%20B/profiles/desktop/cordis.yml' } } }],
    }),
  };
  check(
    'patch 路径来自 loader 实际读过的 include，并解码 %20',
    resolvePatchPath(includeCtx) === path.join('D:\\A B', 'profiles', 'desktop', 'cordis.patch.yml'),
    resolvePatchPath(includeCtx),
  );

  const activeEntry = { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'rea' } }, fiber: { state: 2 } };
  const ctxOf = (entries) => fakeCtx({ schemas: [], entries }).ctx;
  const noPatch = path.join(tmpDir, 'no-such-patch.yml');
  check('实测有工具 → active（不看 patch）', reaServerState(ctxOf([activeEntry]), { toolCount: 3 }, profilePatch).phase === 'active');
  check(
    '实测无工具 + patch 停用（跨层归属）→ disabled',
    reaServerState(ctxOf([activeEntry]), { toolCount: 0 }, [homePatch, profilePatch]).phase === 'disabled',
    reaServerState(ctxOf([activeEntry]), { toolCount: 0 }, [homePatch, profilePatch]).phase,
  );
  check('只看 profile 层无法归属 id 时不乱判停用', reaServerState(ctxOf([activeEntry]), { toolCount: 0 }, profilePatch).phase === 'disconnected');
  check('实测无工具 + 未停用 → disconnected（不是已连接）', reaServerState(ctxOf([activeEntry]), { toolCount: 0 }, noPatch).phase === 'disconnected');
  check('fiber 失败 → failed', reaServerState(ctxOf([{ ...activeEntry, fiber: { state: 3 } }]), { toolCount: 0 }, noPatch).phase === 'failed');
  check('条目自报 disabled → disabled', reaServerState(ctxOf([{ ...activeEntry, disabled: true }]), { toolCount: 0 }, noPatch).phase === 'disabled');
  check('profile 里没有这一行 → missing', reaServerState(ctxOf([]), { toolCount: 0 }, noPatch).phase === 'missing');
  check(
    'disabled 状态会写进面板警告',
    computeState({ root: REPO, configPath: tempConfig, config: { activeBundles: [] }, bundleDefs: {}, snapshot: null, server: { known: true, phase: 'disabled' } }).warnings.some((w) => w.includes('停用')),
  );
  check(
    'disconnected 状态会写进面板警告',
    computeState({ root: REPO, configPath: tempConfig, config: { activeBundles: [] }, bundleDefs: {}, snapshot: null, server: { known: true, phase: 'disconnected' } }).warnings.some((w) => w.includes('没连上')),
  );

  console.log('\n浏览器半（lib/client.js）');
  const { captured } = loadClientBundle();
  check('用 __ModuleLoader__ 注册且 id 等于包名', captured !== null && captured.id === 'dsh-rea-lite-panel');
  const mod = captured.factory((id) => {
    if (id === 'react') return fakeReact();
    throw new Error(`未预期的模块：${id}`);
  });
  check('导出名与 inject 正确', mod.name === 'dsh-rea-lite-panel' && mod.inject.includes('slots'));

  let registered = null;
  const clientCtx = {
    effect(fn) {
      fn();
    },
    get: () => undefined,
    slots: {
      inject(owner, callback) {
        callback();
      },
      register(options, component) {
        registered = { options, component };
      },
    },
  };
  mod.apply(clientCtx);
  check('注册进 settings.section 座位', registered !== null && registered.options.name === 'settings.section');
  check('座位 id / 顺序稳定', registered.options.id === 'rea-tools' && registered.options.order === 36);
  check('侧边栏标签走词典', registered.options.label() === 'REA 工具', registered.options.label());

  const tree = registered.component();
  check('首次渲染是「正在读取状态」而不是抛错', tree !== null && tree.props.className === 'realp-root');
  check(
    '首屏文案取中文词典',
    JSON.stringify(tree).includes('正在读取状态'),
  );

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  if (originalConfigEnv === undefined) delete process.env.REA_LITE_CONFIG;
  else process.env.REA_LITE_CONFIG = originalConfigEnv;
  if (originalDataEnv === undefined) delete process.env.REA_LITE_DATA_DIR;
  else process.env.REA_LITE_DATA_DIR = originalDataEnv;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响结论 */
  }
}
