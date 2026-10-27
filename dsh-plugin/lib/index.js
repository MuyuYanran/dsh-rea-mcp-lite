// dsh-rea-lite-panel 的宿主半：给「REA 工具」设置页提供数据与写入口。
//
// 它只做两件事：
//   1. 读：把 rea-mcp-lite 的 config.json、工具成本快照（data/tools-model.json）、
//      以及 DSH 工具注册表里的实测值汇总成一份状态给浏览器；
//   2. 写：把勾选结果写回 config.json 的 activeBundles。
// 它不碰 profile 的 cordis.patch.yml，也不接管 MCP 服务器本身 —— 那是「MCP 管理」的事。
// 运行中的代理会监听 config.json 并发出 tools/list_changed，所以保存后约 1 秒生效、无需重启。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const name = 'dsh-rea-lite-panel';
// webServer 必须声明（而非 ctx.get）：声明式注入会在服务就绪后才运行 apply()。
export const inject = ['webServer'];

/** 本插件在回环 Web 服务器上占用的路径前缀。 */
const API_PREFIX = '/rea-lite';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
/** 仓库布局：dsh-plugin/ 与 src/ 同级，所以网关根目录是包的上一级。 */
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
/**
 * npm 包自带的网关副本（`scripts/pack-gateway.mjs` 在 prepack 时生成）。
 * 装进 node_modules 以后就没有「仓库根的兄弟目录」了，只有这份副本能兜住；
 * 它是生成物，源码永远以仓库根的 src/ 为准。
 */
const BUNDLED_GATEWAY = path.join(PACKAGE_ROOT, 'gateway');
const CHARS_PER_TOKEN = 3.6;
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
/** MCP 桥给工具起的名字是 mcp__<serverName>__<工具名>。 */
const SERVER_NAME = 'rea';
/** Cordis fiber 状态码 → 可读阶段。 */
const FIBER_PHASE = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' };

/** 面板写回更新设置时的 registry 兜底（与 config.mjs 的默认值一致）。 */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/rea-agents';

/**
 * 需要额外准备或风险较高的功能族，面板上单独标注。
 *
 * 这些族不是「加载了就能用」：动态调试要求目标进程/设备已就绪、且会改目标状态；
 * 抓包与信号分析要求本机装了 TShark / sigrok-cli；格式专项里 objdump 也依赖外部工具链。
 * 标出来是为了避免用户勾了 debug 却发现调不动，还以为网关坏了。
 */
const RISKY_BUNDLES = new Set(['debug', 'capture', 'formats']);

// ── 网关定位与模块加载 ───────────────────────────────────────────────────────

/**
 * 候选网关目录，按优先级排列：插件行配置 → 环境变量 → 本包的上两级（仓库布局）
 * → 本包自带的副本（npm 安装）。
 * @param {string|undefined} configured 插件行 config.root
 */
export function gatewayCandidates(configured) {
  const list = [];
  if (typeof configured === 'string' && configured.trim() !== '') list.push(configured.trim());
  if (process.env.REA_LITE_ROOT) list.push(process.env.REA_LITE_ROOT);
  if (process.env.REA_LITE_CONFIG) list.push(path.dirname(process.env.REA_LITE_CONFIG));
  list.push(REPO_ROOT);
  // 副本排最后：本地开发时仓库根的 src/ 才是最新代码，副本只是 npm 安装的兜底。
  list.push(BUNDLED_GATEWAY);
  return [...new Set(list.map((entry) => path.resolve(entry)))];
}

/** 目录是不是一个 rea-mcp-lite 网关（以 src/bundles.mjs 为标志）。 */
export function isGatewayRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, 'src', 'bundles.mjs'));
  } catch {
    return false;
  }
}

/** 第一个存在的候选目录；一个都没有时退回首选候选，由调用方报错。 */
export function resolveGatewayRoot(configured) {
  const candidates = gatewayCandidates(configured);
  return candidates.find(isGatewayRoot) ?? candidates[0];
}

/**
 * 加载网关自己的模块（bundles / config / snapshot），保证面板与代理口径一致。
 * 带 mtime 缓存：网关代码升级后无需重装插件即可生效，也不会每次请求都重新解析。
 */
const moduleCache = new Map();

export async function loadGatewayModule(root, relative) {
  const file = path.join(root, relative);
  const stamp = fs.statSync(file).mtimeMs;
  const cached = moduleCache.get(file);
  if (cached !== undefined && cached.stamp === stamp) return cached.module;
  // 查询串让 import 绕过 Node 的模块缓存，否则改了文件也读不到新版本。
  const module = await import(`${pathToFileURL(file).href}?v=${Math.round(stamp)}`);
  moduleCache.set(file, { stamp, module });
  return module;
}

/**
 * 可选加载：模块不存在时返回 null，而不是抛。
 *
 * 为什么需要它：插件与网关是两条升级路径。用户完全可能先把插件换成新版，而网关还指着
 * 一份旧副本（插件行 `root` / REA_LITE_ROOT 指向旧目录，或仓库布局里是旧 src/）。
 * 那时新版面板去 require 一个旧网关没有的模块，`fs.statSync` 会 ENOENT —— 若让它抛，
 * Promise.all 整条链失败，设置页直接白屏。所以凡是**新增**的网关模块都走这里，
 * 让「新面板 + 旧网关」退化成旧行为而不是打不开。
 */
export async function loadOptionalGatewayModule(root, relative) {
  try {
    return await loadGatewayModule(root, relative);
  } catch {
    return null;
  }
}

// ── 只读探测 ─────────────────────────────────────────────────────────────────

/** config.json 是否可写：先探文件，文件不存在则探目录（首次使用还没写过配置）。 */
function probeWritable(configPath) {
  try {
    if (fs.existsSync(configPath)) fs.accessSync(configPath, fs.constants.W_OK);
    else fs.accessSync(path.dirname(configPath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * DSH 工具注册表里的实测成本：只数 mcp__rea__* 的工具。
 * 这是「模型此刻到底要花多少上下文」的唯一权威答案，面板用它验证热切换是否生效。
 */
export function liveReaTools(ctx) {
  const service = ctx?.get?.('tools');
  let schemas = [];
  try {
    if (service !== undefined && typeof service.schemas === 'function') schemas = service.schemas();
  } catch {
    schemas = [];
  }
  let toolCount = 0;
  let chars = 0;
  const prefix = `mcp__${SERVER_NAME}__`;
  for (const schema of schemas ?? []) {
    const toolName = schema?.name;
    if (typeof toolName !== 'string' || !toolName.startsWith(prefix)) continue;
    toolCount += 1;
    // 与 lite.mjs / snapshot.mjs 同一口径：只有 name + description + parameters 进模型上下文。
    chars += JSON.stringify({
      name: toolName,
      description: typeof schema.description === 'string' ? schema.description : '',
      inputSchema: schema.parameters ?? {},
    }).length;
  }
  return { toolCount, chars, tokens: Math.round(chars / CHARS_PER_TOKEN) };
}

/**
 * profile 的 cordis.patch.yml 在哪。
 * 权威答案来自 loader 真正读过的 `cordis:include` 条目 —— DSH Desktop 会把 profile 目录
 * 放到别处，惯例路径只是兜底。
 */
export function resolvePatchPath(ctx) {
  const loader = ctx?.get?.('loader');
  if (loader !== undefined && typeof loader.entries === 'function') {
    for (const entry of loader.entries()) {
      const options = entry.options ?? {};
      if (options.name !== 'cordis:include') continue;
      const config = options.config;
      if (config === null || typeof config !== 'object') continue;
      const value = config.path;
      if (typeof value !== 'string' || !value.includes('cordis.yml')) continue;
      return fromFileUrl(value).replace(/cordis\.yml$/u, 'cordis.patch.yml');
    }
  }
  return path.join(dshHome(), 'profiles', argvProfile() ?? 'web', 'cordis.patch.yml');
}

/** file:// URL → 本地路径：DSH Desktop 会把含空格的安装目录编码成 %20，必须解码。 */
function fromFileUrl(value) {
  if (!value.startsWith('file://')) return value;
  try {
    return fileURLToPath(value);
  } catch {
    return value.replace(/^file:\/\//u, '');
  }
}

function dshHome() {
  const override = process.env.DSH_HOME;
  return override !== undefined && override.trim() !== '' ? override : path.join(os.homedir(), '.dsh');
}

function argvProfile() {
  const index = process.argv.indexOf('--profile');
  if (index !== -1 && index + 1 < process.argv.length && !process.argv[index + 1].startsWith('-')) return process.argv[index + 1];
  return undefined;
}

/**
 * 扫一份 patch 文本，抽出三样东西：
 *   - `idToName`：带 serverName 的行 → id → serverName（用来把「按 id 停用」翻译成「哪个服务器被停用」）；
 *   - `disabledIds`：`- id: xxx` + `disabled: true` 这种只写 id 的停用行；
 *   - `disabledNames`：在同一行块里直接写了 `serverName` + `disabled: true` 的停用行。
 *
 * 为什么要这么绕：停用一个 MCP 服务器是在 profile 的 cordis.patch.yml 里写
 * `- id: rea-mcp` + `disabled: true` —— 这一块**没有 serverName**，而真正带
 * `serverName: rea` 的那一行往往在另一层（例如 $DSH_HOME/cordis.patch.yml）里。
 * 而 `entry.disabled` 并不能反映这种覆写：loader 仍会列出该条目、fiber 也可能照跑。
 */
export function scanPatch(text) {
  const idToName = new Map();
  const disabledIds = new Set();
  const disabledNames = new Set();
  let block = null;
  const flush = () => {
    if (block === null) return;
    if (block.id !== '' && block.name !== '') idToName.set(block.id, block.name);
    if (block.off) {
      if (block.name !== '') disabledNames.add(block.name);
      else if (block.id !== '') disabledIds.add(block.id);
    }
    block = null;
  };
  for (const raw of String(text ?? '').split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '');
    const id = /^\s*-\s*id:\s*(\S+)\s*$/u.exec(line);
    if (id !== null) {
      flush();
      block = { id: id[1].replace(/^['"]|['"]$/gu, ''), name: '', off: false };
      continue;
    }
    if (block === null) continue;
    const serverName = /^\s*serverName:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/u.exec(line);
    if (serverName !== null) block.name = serverName[1];
    if (/^\s*disabled:\s*true\s*$/u.test(line)) block.off = true;
  }
  flush();
  return { idToName, disabledIds, disabledNames };
}

/**
 * 合并若干 patch 层，回答「哪些 serverName 被停用了」。
 * 需要多层：profile 层写「停用哪个 id」，另一层写「这个 id 是哪个服务器」。
 * @param {string[]} paths 按可读性排列的 patch 文件路径（读不到的自动跳过）。
 */
export function patchDisabledNames(paths) {
  const idToName = new Map();
  const disabledIds = new Set();
  const names = new Set();
  const layers = [];
  for (const patchPath of paths ?? []) {
    try {
      if (patchPath === '' || !fs.existsSync(patchPath)) continue;
      const scan = scanPatch(fs.readFileSync(patchPath, 'utf8'));
      layers.push(patchPath);
      for (const [id, serverName] of scan.idToName) if (!idToName.has(id)) idToName.set(id, serverName);
      for (const id of scan.disabledIds) disabledIds.add(id);
      for (const serverName of scan.disabledNames) names.add(serverName);
    } catch {
      // 单层读不了不影响其它层。
    }
  }
  for (const id of disabledIds) {
    const serverName = idToName.get(id);
    if (serverName !== undefined) names.add(serverName);
  }
  return { names, ids: disabledIds, idToName, layers };
}

/** 本环境里可能写着 rea 那一行 / 停用它的 patch 层。显式给了就只用给的那层（便于测试与非常规布局）。 */
export function patchLayers(ctx, explicit) {
  if (typeof explicit === 'string' && explicit !== '') return [explicit];
  if (Array.isArray(explicit)) {
    const listed = explicit.filter((entry) => typeof entry === 'string' && entry !== '');
    if (listed.length > 0) return listed;
  }
  return [...new Set([path.join(dshHome(), 'cordis.patch.yml'), resolvePatchPath(ctx)])];
}

/**
 * rea 这个 MCP 服务器现在到底什么状态。
 *
 * 判据按证据强度排序：注册表里有工具 = 一定活着；否则才看 patch 覆写与 fiber 状态。
 * 「fiber 跑着但一个工具都没有」是真实存在的状态（`failOnStartupError: false` 时子进程
 * 起不来也不会让 fiber 失败），这时必须报 disconnected，不能报成已连接。
 */
export function reaServerState(ctx, live, patchPath) {
  const toolCount = live?.toolCount ?? 0;
  const layers = patchLayers(ctx, patchPath);
  if (toolCount > 0) return { known: true, phase: 'active', toolCount, patch: layers[layers.length - 1] };
  const loader = ctx?.get?.('loader');
  let entry;
  if (loader !== undefined && typeof loader.entries === 'function') {
    for (const candidate of loader.entries()) {
      const options = candidate.options ?? {};
      if (options.name !== MCP_CLIENT_PACKAGE) continue;
      const config = options.config;
      if (config === null || typeof config !== 'object' || config.serverName !== SERVER_NAME) continue;
      entry = candidate;
      break;
    }
  }
  const offByPatch = patchDisabledNames(layers).names.has(SERVER_NAME);
  if (offByPatch || entry?.disabled === true) return { known: true, phase: 'disabled', toolCount: 0, patch: layers[layers.length - 1] };
  if (entry === undefined) return { known: false, phase: 'missing', toolCount: 0, patch: layers[layers.length - 1] };
  const state = entry.fiber?.state;
  const phase = state === undefined ? 'pending' : (FIBER_PHASE[state] ?? 'unknown');
  // fiber 说「在跑」但没有任何工具，说明没连上。
  return { known: true, phase: phase === 'active' ? 'disconnected' : phase, toolCount: 0, patch: layers[layers.length - 1] };
}

// ── 状态汇总（纯函数，便于自检） ─────────────────────────────────────────────

/**
 * 把「配置 + 快照 + 注册表实测」汇总成浏览器要的一份状态。
 * @param {object} input 见下方字段；全部显式传入，函数本身不读磁盘、不碰 ctx。
 */
export function computeState(input) {
  const config = input.config ?? {};
  const defs = input.bundleDefs ?? {};
  const allBundle = input.allBundle ?? 'all';
  const tokensOfChars = typeof input.tokensOfChars === 'function' ? input.tokensOfChars : (chars) => Math.round((chars ?? 0) / CHARS_PER_TOKEN);
  const activeBundles = Array.isArray(config.activeBundles) ? [...config.activeBundles] : [];
  const allActive = activeBundles.includes(allBundle);
  const tools = input.snapshot?.tools ?? [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const bundles = Object.entries(defs).map(([id, def]) => {
    const hit = (def.tools ?? []).filter((toolName) => byName.has(toolName));
    const chars = hit.reduce((sum, toolName) => sum + (byName.get(toolName)?.chars ?? 0), 0);
    return {
      id,
      label: def.label ?? id,
      hint: def.hint ?? '',
      toolCount: hit.length,
      tokens: hit.length ? tokensOfChars(chars) : 0,
      active: allActive || activeBundles.includes(id),
      // 本 REA 版本里这个族一个工具都没有 = 该族是更新版 REA 才有的能力。
      // 不标出来的话，用户会以为「勾了 debug 却没反应」是网关坏了。
      unavailable: hit.length === 0 && (def.tools ?? []).length > 0,
      definedTools: (def.tools ?? []).length,
      // 族内工具清单（含各自成本），面板上可展开查看，省得为「这族到底有什么」去翻 REA 文档。
      tools: hit.map((toolName) => ({ name: toolName, tokens: tokensOfChars(byName.get(toolName)?.chars ?? 0) })),
      // 需要额外准备（目标环境/外部工具链）或风险较高的族，面板上单独标注。
      risky: RISKY_BUNDLES.has(id),
      // 用户自建的族：面板要能与内置族区分（可删除、显示「自定义」标签）。
      custom: def.custom === true,
    };
  });

  const wanted = new Set();
  if (allActive) for (const tool of tools) wanted.add(tool.name);
  else {
    for (const id of activeBundles) {
      for (const toolName of defs[id]?.tools ?? []) if (byName.has(toolName)) wanted.add(toolName);
    }
  }
  let activeChars = 0;
  for (const toolName of wanted) activeChars += byName.get(toolName)?.chars ?? 0;

  const metaTokens = config.metaTools === false ? 0 : (input.snapshot?.metaTokens ?? input.metaTokens ?? 0);
  const hasSnapshot = input.snapshot !== null && input.snapshot !== undefined;
  const activeTokens = (hasSnapshot ? tokensOfChars(activeChars) : 0) + metaTokens;
  const totalTokens = (input.snapshot?.totalTokens ?? 0) + metaTokens;
  const stale = hasSnapshot
    ? input.snapshot.lite !== config.lite || input.snapshot.shortDesc !== (config.shortDescription !== false)
    : false;

  const warnings = [];
  if (input.issue) warnings.push(input.issue);
  if (!hasSnapshot) warnings.push('还没有工具快照：运行 node src/cli.mjs snapshot，或让代理连一次 REA。');
  else if (stale) warnings.push('快照与当前 schema 裁剪设置不一致，成本只是近似值。');
  if (input.server?.phase === 'disabled') warnings.push('rea 这个 MCP 服务器在「MCP 管理」里被停用，改动要等它启用后才生效。');
  else if (input.server?.phase === 'disconnected') warnings.push('rea 已启用但没连上（工具数为 0）：看「MCP 管理」里的启动错误，或检查启动命令、JAVA_HOME。');
  if (input.server?.phase === 'missing') warnings.push('profile 里没有 serverName 为 rea 的 MCP 行，改动不会生效。');

  // 追加归类出来的工具：面板上要能看出「这些不是内置清单里的，是自动/手工补进来的」。
  const extras = Array.isArray(input.extras) ? input.extras : [];
  const extrasByBundle = new Map();
  for (const entry of extras) {
    const list = extrasByBundle.get(entry.bundle) ?? [];
    list.push(entry.name);
    extrasByBundle.set(entry.bundle, list);
  }

  return {
    ok: true,
    gatewayRoot: input.root,
    configPath: input.configPath,
    writable: input.writable !== false,
    mode: config.mode ?? 'gateway',
    lite: config.lite ?? 'mild',
    metaTools: config.metaTools !== false,
    activeBundles,
    allActive,
    bundles: bundles.map((bundle) => ({
      ...bundle,
      // 该族里由 bundleExtras 追加进来的工具名（面板标「自动归类」）。
      extras: extrasByBundle.get(bundle.id) ?? [],
    })),
    snapshot: hasSnapshot
      ? {
          present: true,
          generatedAt: input.snapshot.generatedAt,
          toolCount: input.snapshot.toolCount,
          lite: input.snapshot.lite,
          stale,
          unassigned: input.snapshot.unassigned ?? [],
        }
      : { present: false, toolCount: 0, stale: false, unassigned: [] },
    metaTokens,
    activeTokens,
    totalTokens,
    // 相对「什么都不省」的全量加载省下了多少百分比。
    savings: totalTokens > 0 ? Math.round((1 - activeTokens / totalTokens) * 1000) / 10 : 0,
    live: input.live ?? { toolCount: 0, tokens: 0 },
    server: input.server ?? { known: false, phase: 'unknown' },
    // 命名预设（已拍成面板要的形状，见 buildState）。
    presets: Array.isArray(input.presets) ? input.presets : [],
    // 预设存储位置：预设不放在 config.json 里（那会随插件升级一起被替换掉），
    // 面板要把落点告诉用户，他才知道东西存在哪、升级不会丢。
    presetStore: input.presetStore ?? null,
    // 更新开关（面板展示与写回都用它）。
    updates: input.updates ?? {},
    warnings,
  };
}

// ── HTTP 管道 ────────────────────────────────────────────────────────────────

/** 读 JSON 请求体，带体积上限。 */
async function readJsonBody(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${String(error?.message ?? error)}`);
  }
}

/** 只服务本机页面：非回环来源一律 403。 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

// ── 插件本体 ─────────────────────────────────────────────────────────────────

/**
 * 在回环 Web 服务器上注册面板 API。
 * @param ctx 宿主上下文（需要 webServer）
 * @param config 插件行配置，可选 `root`（网关目录）与 `patchPath`（profile patch 路径，字符串或数组）
 */
export function apply(ctx, config) {
  const configuredRoot = config?.root;
  // DSH Desktop 可能把 patch 放在别处，所以允许插件行覆写；默认自动找（$DSH_HOME + profile）。
  const configuredPatch = config?.patchPath;

  /** 组装一份完整状态（读盘 + 读注册表）。 */
  const buildState = async () => {
    const live = liveReaTools(ctx);
    const server = reaServerState(ctx, live, configuredPatch);
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) {
      return computeState({
        root,
        configPath: path.join(root, 'config.json'),
        writable: false,
        config: {},
        bundleDefs: {},
        allBundle: 'all',
        snapshot: null,
        live,
        server,
        issue: `这里不像 rea-mcp-lite 网关（缺 src/bundles.mjs）：${root}。请把本插件与网关放在同一仓库，或设置 REA_LITE_ROOT。`,
      });
    }
    const [{ effectiveBundles, ALL_BUNDLE, extrasOf }, { loadConfig, CONFIG_PATH }, { readSnapshot, tokensOfChars }, { listPresets, presetReport, presetCost, presetIsCurrent }, storeModule] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
      loadGatewayModule(root, 'src/presets.mjs'),
      // 可选：旧网关没有这个模块，那就退化成「不显示存储位置」，别把整页拖垮。
      loadOptionalGatewayModule(root, 'src/preset-store.mjs'),
    ]);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    const config = loadConfig();
    // 生效族表 = 内置族 + 用户自定义族 + 追加归类，面板要能一起显示与开关。
    const table = effectiveBundles(config.customBundles, config.bundleExtras);
    const snapshot = readSnapshot();
    const snapshotTools = snapshot?.tools ?? [];
    // 预设的展示口径与「合计」一致：每工具字符数取自快照，不另立一套算法。
    const knownTools = snapshotTools.map((tool) => tool.name);
    const toolChars = new Map(snapshotTools.map((tool) => [tool.name, tool.chars ?? 0]));
    const presets = listPresets(config).map((preset) => {
      const report = presetReport(preset, { defs: table, knownTools, allBundle: ALL_BUNDLE });
      const cost = presetCost(preset, { defs: table, toolChars, allBundle: ALL_BUNDLE, tokensOfChars });
      return {
        name: preset.name,
        label: preset.label ?? '',
        note: preset.note ?? '',
        savedAt: preset.savedAt ?? '',
        activeBundles: [...preset.activeBundles],
        applied: report.applied,
        // 引用的族已经不存在（旧预设/自定义族被删）：读取时会跳过，面板要如实标出来。
        missing: report.missing,
        // 族在、但这一版 REA 一个工具都没有：能读，只是加载不到东西。
        unavailable: report.unavailable,
        toolCount: cost.toolCount,
        tokens: cost.tokens,
        lite: typeof preset.lite === 'string' ? preset.lite : null,
        shortDescription: typeof preset.shortDescription === 'boolean' ? preset.shortDescription : null,
        metaTools: typeof preset.metaTools === 'boolean' ? preset.metaTools : null,
        current: presetIsCurrent(preset, config),
      };
    });
    return computeState({
      root,
      configPath,
      writable: probeWritable(configPath),
      config,
      bundleDefs: table,
      allBundle: ALL_BUNDLE,
      snapshot,
      tokensOfChars,
      live,
      server,
      updates: config.updates ?? {},
      extras: typeof extrasOf === 'function' ? extrasOf(table, config.bundleExtras) : [],
      presets,
      presetStore: typeof storeModule?.describePresetStore === 'function' ? storeModule.describePresetStore() : null,
    });
  };

  /** 写入勾选结果；只改 activeBundles，其余字段原样保留。 */
  const saveActive = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ effectiveBundles, ALL_BUNDLE }, { loadConfig, saveConfig, CONFIG_PATH }] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
    ]);
    if (!Array.isArray(body?.bundles)) throw new Error('bundles 必须是功能族名数组');
    const requested = [...new Set(body.bundles.map((entry) => String(entry)))];
    const current = loadConfig();
    const table = effectiveBundles(current.customBundles, current.bundleExtras);
    const unknown = requested.filter((id) => id !== ALL_BUNDLE && !Object.hasOwn(table, id));
    if (unknown.length > 0) throw new Error(`未知功能族：${unknown.join(', ')}（可用：${Object.keys(table).join(', ')}, ${ALL_BUNDLE}）`);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    if (!probeWritable(configPath)) throw new Error(`配置文件不可写：${configPath}`);
    saveConfig({ ...current, activeBundles: requested });
    const state = await buildState();
    return {
      ok: true,
      saved: true,
      // 代理监听 config.json 后会自己热切换；服务器没跑起来时只能是「待生效」。
      applied: state.server.phase === 'active' ? 'hot' : 'pending',
      state,
    };
  };

  /**
   * 命名预设：保存当前勾选 / 读取预设 / 删除预设。
   * body: { action: 'save' | 'apply' | 'delete', name, label?, note?, bundles? }
   *
   * 与 CLI、代理的元工具共用网关的 presets.mjs（纯函数），面板不复制「什么算可读」的判断：
   * 三处判断分叉过一次就很难发现（归类那边已经踩过）。
   */
  const savePreset = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ effectiveBundles, ALL_BUNDLE }, { loadConfig, saveConfig, CONFIG_PATH, configPath }, { readSnapshot }, { normalizePresetName, capturePreset, applyPreset, removePreset }, storeModule] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
      loadGatewayModule(root, 'src/presets.mjs'),
      loadOptionalGatewayModule(root, 'src/preset-store.mjs'),
    ]);
    // 预设写进独立存储，所以要探的是**存储**的可写性；探 config.json 会答错问题
    // （config.json 可写而存储目录不可写时，会一路走到写失败才报错）。
    // 旧网关没有 preset-store.mjs（storeModule 为 null）：那时预设还在 config.json 里，
    // 退回去探 config.json，保持向后兼容。
    const describeStore = storeModule !== null && typeof storeModule.describePresetStore === 'function' ? storeModule.describePresetStore : null;
    const configPathNow = typeof configPath === 'function' ? configPath() : CONFIG_PATH;
    if (describeStore !== null) {
      const storeNow = describeStore();
      if (storeNow.writable === false) {
        throw new Error(`预设存储不可写：${storeNow.path}。请检查该目录的权限，或把 REA_LITE_DATA_DIR 指到可写位置。`);
      }
    } else if (!probeWritable(configPathNow)) {
      throw new Error(`配置文件不可写：${configPathNow}`);
    }
    const current = loadConfig();
    const action = String(body?.action ?? 'save');

    if (action === 'delete') {
      const result = removePreset(current, body?.name);
      saveConfig(result.config);
      return { ok: true, removed: result.removed, state: await buildState() };
    }

    if (action === 'apply') {
      const name = normalizePresetName(body?.name);
      const preset = (current.presets ?? {})[name];
      if (preset === undefined) {
        throw new Error(`没有预设：${name}。已有：${Object.keys(current.presets ?? {}).join(', ') || '（无）'}`);
      }
      const table = effectiveBundles(current.customBundles, current.bundleExtras);
      const knownTools = (readSnapshot()?.tools ?? []).map((tool) => tool.name);
      const result = applyPreset(current, preset, { defs: table, knownTools, allBundle: ALL_BUNDLE });
      saveConfig(result.config);
      const state = await buildState();
      return {
        ok: true,
        name,
        saved: true,
        applied: state.server.phase === 'active' ? 'hot' : 'pending',
        activeBundles: result.applied,
        missing: result.missing,
        unavailable: result.unavailable,
        // 裁剪档随预设变化时要告诉用户「成本口径重算了」，否则他会以为数字出错了。
        changed: result.changed,
        state,
      };
    }

    if (action !== 'save') throw new Error(`未知动作：${action}。可用：save / apply / delete`);
    const bundles = Array.isArray(body?.bundles) ? body.bundles : current.activeBundles;
    const table = effectiveBundles(current.customBundles, current.bundleExtras);
    const unknown = bundles.filter((id) => id !== ALL_BUNDLE && !Object.hasOwn(table, id));
    if (unknown.length > 0) throw new Error(`未知功能族：${unknown.join(', ')}（可用：${Object.keys(table).join(', ')}, ${ALL_BUNDLE}）`);
    const captured = capturePreset(current, { name: body?.name, label: body?.label, note: body?.note, bundles });
    saveConfig({ ...current, presets: { ...(current.presets ?? {}), [captured.name]: captured.preset } });
    const state = await buildState();
    return {
      ok: true,
      name: captured.name,
      saved: true,
      replaced: captured.replaced,
      preset: captured.preset,
      state,
    };
  };

  /**
   * 在快照里搜工具：回答「某个工具是什么、属于哪个族、要花多少成本」。
   * 面板的「全部工具」视图靠它一次列出所有工具，用户不必先搜索才能勾选。
   */
  const searchTools = async (url) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) return { ok: true, query: '', total: 0, matches: [], bundleOptions: [] };
    const [{ readSnapshot, tokensOfChars }, { effectiveBundles }, { loadConfig }] = await Promise.all([
      loadGatewayModule(root, 'src/snapshot.mjs'),
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
    ]);
    const snapshot = readSnapshot();
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const parsedLimit = Number.parseInt(url.searchParams.get('limit') ?? '400', 10);
    const limit = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 400, 500);
    const tools = snapshot?.tools ?? [];
    const matched = query === ''
      ? tools
      : tools.filter((tool) => tool.name.toLowerCase().includes(query) || (tool.desc ?? '').toLowerCase().includes(query));
    const currentConfig = loadConfig();
    const table = effectiveBundles(currentConfig.customBundles, currentConfig.bundleExtras);
    return {
      ok: true,
      query,
      total: matched.length,
      matches: matched.slice(0, limit).map((tool) => ({
        name: tool.name,
        desc: tool.desc ?? '',
        bundles: tool.bundles ?? [],
        tokens: tokensOfChars(tool.chars ?? 0),
      })),
      // 面板用它渲染「这个工具能加进哪些自定义组」。
      bundleOptions: Object.entries(table).map(([id, def]) => ({ id, label: def.label ?? id, custom: def.custom === true })),
    };
  };

  /**
   * 保存 / 编辑 / 删除自定义功能族。
   * body: { id, label?, hint?, tools: string[], delete?: boolean, renameFrom?: string }
   *
   * renameFrom 用于改组名：先确认旧组存在、新组名没被占用，再把配置里的键换掉，
   * 同时把 activeBundles 里的旧名替换成新名——否则改名后原来的勾选会悄悄失效。
   */
  const saveCustom = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ normalizeCustomBundle }, { loadConfig, saveConfig, CONFIG_PATH }, { readSnapshot }] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    if (!probeWritable(configPath)) throw new Error(`配置文件不可写：${configPath}`);
    const current = loadConfig();
    const custom = { ...(current.customBundles ?? {}) };
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const renameFrom = typeof body?.renameFrom === 'string' ? body.renameFrom.trim() : '';

    if (body?.delete === true) {
      if (!Object.hasOwn(custom, id)) throw new Error(`没有自定义族：${id || '(空)'}`);
      delete custom[id];
      saveConfig({ ...current, customBundles: custom, activeBundles: (current.activeBundles ?? []).filter((b) => b !== id) });
    } else {
      // 用快照里的工具名做存在性校验：宁可此时报「未知工具」，也别存下一个调不通的族。
      const known = (readSnapshot()?.tools ?? []).map((tool) => tool.name);
      const normalized = normalizeCustomBundle({ id, label: body?.label, hint: body?.hint, tools: body?.tools }, known);
      let activeBundles = [...(current.activeBundles ?? [])];
      if (renameFrom !== '' && renameFrom !== normalized.id) {
        if (!Object.hasOwn(custom, renameFrom)) throw new Error(`没有自定义族：${renameFrom}`);
        delete custom[renameFrom];
        // 改名后把勾选一并迁过去，用户不会发现「我明明勾着的组不见了」。
        activeBundles = [...new Set(activeBundles.map((name) => (name === renameFrom ? normalized.id : name)))];
      }
      custom[normalized.id] = { label: normalized.label, hint: normalized.hint, tools: normalized.tools };
      saveConfig({ ...current, customBundles: custom, activeBundles });
    }
    const state = await buildState();
    return { ok: true, saved: true, applied: state.server.phase === 'active' ? 'hot' : 'pending', state };
  };

  /**
   * 更新与体检报告。默认用快照里的工具清单一秒内出结果；`?live=1` 才真的去问 REA（较慢）。
   *
   * 为什么默认不 live：这个接口会被面板轮询，而起 REA 要 5-20 秒；
   * 用快照足够回答「有哪些新工具没归族」——快照就是上一次真实工具列表的落盘产物。
   */
  const maintenanceReport = async (url) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) return { ok: false, reason: `找不到 rea-mcp-lite 网关：${root}` };
    const [{ checkToolCoverage, checkSelfUpdate }, { checkReaUpdate }, { effectiveBundles, extrasOf }, { loadConfig }, { readSnapshot }] = await Promise.all([
      loadGatewayModule(root, 'src/updates.mjs'),
      loadGatewayModule(root, 'src/updates.mjs'),
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    const config = loadConfig();
    const wantLive = url?.searchParams?.get('live') === '1';
    // 自检项各自兜住异常：网络不通/不是 git 仓库都不该让整个报告失败。
    const self = (() => {
      try {
        return checkSelfUpdate({ root, remote: config.updates?.self?.remote ?? 'origin', fetch: url?.searchParams?.get('fetch') === '1' });
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? error) };
      }
    })();
    let rea;
    try {
      rea = await checkReaUpdate({ child: config.child, registry: config.updates?.rea?.registry });
    } catch (error) {
      rea = { ok: false, reason: String(error?.message ?? error) };
    }
    let toolNames = (readSnapshot()?.tools ?? []).map((tool) => tool.name);
    let source = 'snapshot';
    if (wantLive) {
      try {
        const { probeToolNames } = await loadGatewayModule(root, 'src/probe-client.mjs');
        const live = await probeToolNames(config.child, { timeoutMs: 90000 });
        if (live.length > 0) {
          toolNames = live;
          source = 'live';
        }
      } catch (error) {
        source = `snapshot（REA 未响应：${String(error?.message ?? error)}）`;
      }
    }
    const table = effectiveBundles(config.customBundles, config.bundleExtras);
    const coverage = {
      source,
      ...checkToolCoverage({ toolNames, defs: table, extras: config.bundleExtras }),
    };
    const parts = [];
    if (self?.fetchError) parts.push(`本仓库取远端失败：${self.fetchError}`);
    else if (self?.available) parts.push(`本仓库落后 ${self.behind} 个提交`);
    else if (self?.ok === false) parts.push(`本仓库无法检查：${self.reason ?? '未知原因'}`);
    if (rea?.updateAvailable) parts.push(`REA 有新版 ${rea.installed} → ${rea.latest}`);
    else if (rea?.ok === false) parts.push(`REA 无法检查：${rea.reason ?? rea.registryError ?? '未知原因'}`);
    if (coverage.unassigned.length) parts.push(`${coverage.unassigned.length} 个工具未归族`);
    if (coverage.missingForLocal.length) parts.push(`${coverage.missingForLocal.length} 个族内工具本地 REA 没有`);
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      source,
      self,
      rea,
      coverage,
      extras: extrasOf(table, config.bundleExtras),
      updates: config.updates ?? {},
      summary: parts.length ? parts.join('；') : '本仓库与 REA 都是最新，工具全部归族。',
    };
  };

  /** 归类预览：把未归族的工具按规则打分，给面板显示「建议归入哪族」。 */
  const classifyPreview = async (url) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) return { ok: false, reason: `找不到 rea-mcp-lite 网关：${root}` };
    const [{ classifyTools }, { effectiveBundles }, { loadConfig }, { readSnapshot }] = await Promise.all([
      loadGatewayModule(root, 'src/classify.mjs'),
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    const config = loadConfig();
    const snapshot = readSnapshot();
    const table = effectiveBundles(config.customBundles, config.bundleExtras);
    const tools = (snapshot?.tools ?? []).map((tool) => ({ name: tool.name, description: tool.desc ?? '' }));
    const result = classifyTools(tools, { defs: table });
    return {
      ok: true,
      source: 'snapshot',
      counts: result.counts,
      // 面板不需要完整题面，只要结论；prompt 单独给按钮复制。
      assignments: result.assignments.map((entry) => ({
        name: entry.name,
        suggested: entry.suggested,
        confidence: entry.confidence,
        score: entry.score,
        candidates: entry.candidates.map((candidate) => candidate.id),
      })),
      applyable: result.assignments.filter((entry) => entry.suggested !== null && entry.confidence === 'high').length,
    };
  };

  /**
   * 应用归类：直接调网关自己的 applyClassify（与 CLI / 元工具同一份实现）。
   * 面板不再复制一份「什么算可写」的判断——那种复制迟早会与 CLI 分叉。
   */
  const applyClassifyFromPanel = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ applyClassify }, { loadConfig, CONFIG_PATH, configPath }, { readSnapshot }] = await Promise.all([
      loadGatewayModule(root, 'src/maintenance.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    const configPathNow = typeof configPath === 'function' ? configPath() : CONFIG_PATH;
    const configPath_ = configPathNow ?? path.join(root, 'config.json');
    if (!probeWritable(configPath_)) throw new Error(`配置文件不可写：${configPath_}`);
    const tools = (readSnapshot()?.tools ?? []).map((tool) => ({ name: tool.name, description: tool.desc ?? '' }));
    const manual = body?.manual !== undefined && body?.manual !== null && typeof body.manual === 'object' ? body.manual : undefined;
    const result = await applyClassify(loadConfig(), { tools, manual });
    const state = await buildState();
    return {
      ok: true,
      saved: true,
      written: result.written,
      extras: result.extras,
      applied: state.server.phase === 'active' ? 'hot' : 'pending',
      state,
    };
  };

  /** 保存更新设置（config.updates）；只允许已知的布尔开关，避免把配置写坏。 */
  const saveUpdates = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ loadConfig, saveConfig, CONFIG_PATH }] = await Promise.all([loadGatewayModule(root, 'src/config.mjs')]);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    if (!probeWritable(configPath)) throw new Error(`配置文件不可写：${configPath}`);
    const current = loadConfig();
    const pick = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    const self = body?.updates?.self ?? {};
    const rea = body?.updates?.rea ?? {};
    const updates = {
      self: {
        remote: typeof self.remote === 'string' && self.remote.trim() !== '' ? self.remote.trim() : (current.updates?.self?.remote ?? 'origin'),
        checkOnStart: pick(self.checkOnStart, current.updates?.self?.checkOnStart === true),
        autoApply: pick(self.autoApply, current.updates?.self?.autoApply === true),
      },
      rea: {
        registry: typeof rea.registry === 'string' && rea.registry.trim() !== '' ? rea.registry.trim() : (current.updates?.rea?.registry ?? DEFAULT_REGISTRY),
        checkOnStart: pick(rea.checkOnStart, current.updates?.rea?.checkOnStart === true),
        autoApply: pick(rea.autoApply, current.updates?.rea?.autoApply === true),
      },
    };
    saveConfig({ ...current, updates });
    const state = await buildState();
    return { ok: true, saved: true, updates, state };
  };

  /**
   * 真的执行更新/刷新动作。这是唯一会改动本机安装或仓库的接口，所以：
   *   - 必须显式 POST 且带 action；
   *   - 只支持白名单里的动作（未知动作报 400 并列出可用值）；
   *   - 一律返回做了什么、失败原因与下一步。
   */
  const runMaintenance = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const action = String(body?.action ?? '');
    const [{ pullSelfUpdate, pullReaUpdate, refreshAfterUpgrade }, { loadConfig, saveConfig, CONFIG_PATH }, { buildSnapshot, writeSnapshot, readSnapshot, SNAPSHOT_PATH }] = await Promise.all([
      loadGatewayModule(root, 'src/maintenance.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    let config = loadConfig();
    const log = (line) => process.stderr.write(`[rea-lite-panel] ${line}\n`);

    if (action === 'update-self') {
      const result = pullSelfUpdate({ root, remote: config.updates?.self?.remote, apply: body?.apply === true, log });
      return { ok: result.ok, action, result, state: await buildState() };
    }
    if (action === 'update-rea') {
      const result = await pullReaUpdate(config, { root, apply: body?.apply === true, log });
      return { ok: result.ok, action, result, state: await buildState() };
    }
    if (action === 'refresh-snapshot') {
      const { probeTools } = await loadGatewayModule(root, 'src/probe-client.mjs');
      const { tools } = await probeTools(config.child, { timeoutMs: 90000 });
      const snapshot = buildSnapshot(tools ?? [], loadConfig());
      writeSnapshot(snapshot);
      return {
        ok: true,
        action,
        result: { toolCount: snapshot.toolCount, totalTokens: snapshot.totalTokens, unassigned: snapshot.unassigned, path: SNAPSHOT_PATH },
        state: await buildState(),
      };
    }
    if (action === 'classify') {
      const applied = await applyClassifyFromPanel(body ?? {});
      return { ok: true, action, result: { written: applied.written, extras: applied.extras }, state: applied.state };
    }
    if (action === 'refresh-all') {
      // 「一键拉齐」：拉本仓库 → 拉 REA → 刷新快照 → 归类。任一步失败都停下并报告。
      const self = pullSelfUpdate({ root, remote: config.updates?.self?.remote, apply: body?.apply === true, log });
      if (!self.ok) return { ok: false, action, result: { step: 'self', ...self }, state: await buildState() };
      config = loadConfig();
      const rea = await pullReaUpdate(config, { root, apply: body?.apply === true, log });
      if (!rea.ok) return { ok: false, action, result: { step: 'rea', ...rea }, state: await buildState() };
      if (rea.updated) {
        // pullReaUpdate 自己会刷快照并归类，这里不再重复。
        return { ok: true, action, result: { self, rea }, state: await buildState() };
      }
      const after = await refreshAfterUpgrade(loadConfig(), { log });
      return { ok: true, action, result: { self, rea, after }, state: await buildState() };
    }
    throw new Error(`未知动作：${action || '(空)'}。可用：update-self / update-rea / refresh-snapshot / classify / refresh-all`);
  };

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!isLoopback(req)) {
      sendJson(res, 403, { error: '这个接口只服务本机页面' });
      return;
    }
    const route = url.pathname.slice(API_PREFIX.length) || '/';
    try {
      if (route === '/state' && req.method === 'GET') {
        sendJson(res, 200, await buildState());
        return;
      }
      if (route === '/active' && req.method === 'POST') {
        sendJson(res, 200, await saveActive(await readJsonBody(req)));
        return;
      }
      if (route === '/custom' && req.method === 'POST') {
        sendJson(res, 200, await saveCustom(await readJsonBody(req)));
        return;
      }
      if (route === '/presets' && req.method === 'POST') {
        sendJson(res, 200, await savePreset(await readJsonBody(req)));
        return;
      }
      if (route === '/tools' && req.method === 'GET') {
        sendJson(res, 200, await searchTools(url));
        return;
      }
      if (route === '/maintenance' && req.method === 'GET') {
        sendJson(res, 200, await maintenanceReport(url));
        return;
      }
      if (route === '/classify' && req.method === 'GET') {
        sendJson(res, 200, await classifyPreview(url));
        return;
      }
      if (route === '/classify' && req.method === 'POST') {
        sendJson(res, 200, await applyClassifyFromPanel(await readJsonBody(req)));
        return;
      }
      if (route === '/updates' && req.method === 'POST') {
        sendJson(res, 200, await saveUpdates(await readJsonBody(req)));
        return;
      }
      if (route === '/maintenance' && req.method === 'POST') {
        sendJson(res, 200, await runMaintenance(await readJsonBody(req)));
        return;
      }
      sendJson(res, 404, { error: `未知接口：${route}` });
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) });
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }), 'dsh-rea-lite-panel: 面板 API');
}

export default { name, inject, apply };
