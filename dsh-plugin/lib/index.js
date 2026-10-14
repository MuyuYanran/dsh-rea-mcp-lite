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
const CHARS_PER_TOKEN = 3.6;
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
/** MCP 桥给工具起的名字是 mcp__<serverName>__<工具名>。 */
const SERVER_NAME = 'rea';
/** Cordis fiber 状态码 → 可读阶段。 */
const FIBER_PHASE = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' };

// ── 网关定位与模块加载 ───────────────────────────────────────────────────────

/**
 * 候选网关目录，按优先级排列：插件行配置 → 环境变量 → 本包的上两级（仓库布局）。
 * @param {string|undefined} configured 插件行 config.root
 */
export function gatewayCandidates(configured) {
  const list = [];
  if (typeof configured === 'string' && configured.trim() !== '') list.push(configured.trim());
  if (process.env.REA_LITE_ROOT) list.push(process.env.REA_LITE_ROOT);
  if (process.env.REA_LITE_CONFIG) list.push(path.dirname(process.env.REA_LITE_CONFIG));
  list.push(REPO_ROOT);
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
    bundles,
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
    const [{ BUNDLES, ALL_BUNDLE }, { loadConfig, CONFIG_PATH }, { readSnapshot, tokensOfChars }] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
      loadGatewayModule(root, 'src/snapshot.mjs'),
    ]);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    return computeState({
      root,
      configPath,
      writable: probeWritable(configPath),
      config: loadConfig(),
      bundleDefs: BUNDLES,
      allBundle: ALL_BUNDLE,
      snapshot: readSnapshot(),
      tokensOfChars,
      live,
      server,
    });
  };

  /** 写入勾选结果；只改 activeBundles，其余字段原样保留。 */
  const saveActive = async (body) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) throw new Error(`找不到 rea-mcp-lite 网关：${root}`);
    const [{ BUNDLES, ALL_BUNDLE }, { loadConfig, saveConfig, CONFIG_PATH }] = await Promise.all([
      loadGatewayModule(root, 'src/bundles.mjs'),
      loadGatewayModule(root, 'src/config.mjs'),
    ]);
    if (!Array.isArray(body?.bundles)) throw new Error('bundles 必须是功能族名数组');
    const requested = [...new Set(body.bundles.map((entry) => String(entry)))];
    const unknown = requested.filter((id) => id !== ALL_BUNDLE && !Object.hasOwn(BUNDLES, id));
    if (unknown.length > 0) throw new Error(`未知功能族：${unknown.join(', ')}（可用：${Object.keys(BUNDLES).join(', ')}, ${ALL_BUNDLE}）`);
    const configPath = CONFIG_PATH ?? path.join(root, 'config.json');
    if (!probeWritable(configPath)) throw new Error(`配置文件不可写：${configPath}`);
    const current = loadConfig();
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

  /** 在快照里搜工具：回答「某个工具属于哪个族」。 */
  const searchTools = async (url) => {
    const root = resolveGatewayRoot(configuredRoot);
    if (!isGatewayRoot(root)) return { ok: true, query: '', total: 0, matches: [] };
    const { readSnapshot } = await loadGatewayModule(root, 'src/snapshot.mjs');
    const snapshot = readSnapshot();
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '60', 10) || 60, 200);
    const tools = snapshot?.tools ?? [];
    const matched = query === ''
      ? tools
      : tools.filter((tool) => tool.name.toLowerCase().includes(query) || (tool.desc ?? '').toLowerCase().includes(query));
    return {
      ok: true,
      query,
      total: matched.length,
      matches: matched.slice(0, limit).map((tool) => ({
        name: tool.name,
        desc: tool.desc ?? '',
        bundles: tool.bundles ?? [],
        tokens: Math.round((tool.chars ?? 0) / CHARS_PER_TOKEN),
      })),
    };
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
      if (route === '/tools' && req.method === 'GET') {
        sendJson(res, 200, await searchTools(url));
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
