// 预设：一套「加载哪些功能族 + 用哪档 schema 裁剪」的命名存档，存进 config.json 的 presets。
//
// 为什么单开一层而不是直接复用 activeBundles：activeBundles 只记住「此刻」，
// 用户真正要的是几套可切换的视角（原生深挖 / 安卓动态 / 省上下文）；
// 而且读取一个旧预设时必须能报出「它引用的族已经不存在了」——
// 这两件事都不属于 config.mjs 的职责。
//
// 三个调用方（CLI、设置页、代理的元工具）共用这里的纯函数：判断只写一遍。
//
// 不存 `child`：子进程命令与环境变量是本机专属（JAVA_HOME、外部工具路径），
// 跟着预设走等于把一台机器的路径读到另一台上。这条是硬的。
//
// 本模块**不 import config.mjs**：config.mjs 要 import 它来规范化读到的 presets，
// 反向引用会成环。所以这里只认「传进来的配置对象」，不读磁盘。

/** 预设名长度上限（字符，不是字节：中文名照样数得过来）。 */
export const PRESET_NAME_MAX = 48;

/** 预设名里不允许出现的字符：路径分隔符、Windows 保留字符、控制字符。 */
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/u;

/** 被预设引用的四种设置：勾选 + 三档影响上下文的开关。 */
const SHAPE_KEYS = ['lite', 'shortDescription', 'metaTools'];

/**
 * 校验并规范化预设名。名字是人给的字面量（允许中文），不是族 id，所以规则宽松些，
 * 但必须能安全当 JSON 键、能在命令行里原样传。
 */
export function normalizePresetName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name === '') throw new Error('预设名不能为空');
  if (name.length > PRESET_NAME_MAX) throw new Error(`预设名过长（最多 ${PRESET_NAME_MAX} 个字符）：${name.slice(0, 16)}…`);
  if (ILLEGAL_NAME.test(name)) throw new Error(`预设名不能含 \\ / : * ? " < > | 或控制字符：${name}`);
  if (name === '.' || name === '..') throw new Error(`预设名 ${name} 不可用`);
  return name;
}

function cleanBundles(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim()))];
}

/**
 * 规范化从 config.json 读到的 presets。
 * 坏条目（名字非法、值不是对象）直接丢掉：一份配置里混进一条垃圾不该让整页打不开。
 */
export function normalizePresets(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    let name;
    try {
      name = normalizePresetName(key);
    } catch {
      continue;
    }
    const preset = { activeBundles: cleanBundles(value.activeBundles) };
    if (typeof value.label === 'string' && value.label.trim() !== '') preset.label = value.label.trim();
    if (typeof value.note === 'string' && value.note.trim() !== '') preset.note = value.note.trim();
    if (typeof value.lite === 'string' && value.lite !== '') preset.lite = value.lite;
    if (typeof value.shortDescription === 'boolean') preset.shortDescription = value.shortDescription;
    if (typeof value.metaTools === 'boolean') preset.metaTools = value.metaTools;
    if (typeof value.savedAt === 'string' && value.savedAt !== '') preset.savedAt = value.savedAt;
    out[name] = preset;
  }
  return out;
}

/**
 * 把当前（或显式给定）的加载集合与裁剪档拍成一个预设对象。
 * @returns {{ name: string, preset: object, replaced: boolean }}
 */
export function capturePreset(config, options = {}) {
  const name = normalizePresetName(options.name);
  const preset = { activeBundles: cleanBundles(options.bundles ?? config?.activeBundles) };
  if (typeof options.label === 'string' && options.label.trim() !== '') preset.label = options.label.trim();
  if (typeof options.note === 'string' && options.note.trim() !== '') preset.note = options.note.trim();
  if (typeof config?.lite === 'string' && config.lite !== '') preset.lite = config.lite;
  if (typeof config?.shortDescription === 'boolean') preset.shortDescription = config.shortDescription;
  if (typeof config?.metaTools === 'boolean') preset.metaTools = config.metaTools;
  preset.savedAt = typeof options.now === 'string' && options.now !== '' ? options.now : new Date().toISOString();
  return { name, preset, replaced: Object.hasOwn(config?.presets ?? {}, name) };
}

/** 按名字列出预设（稳定排序，面板/CLI 读起来一致）。 */
export function listPresets(config) {
  return Object.entries(config?.presets ?? {})
    .map(([name, preset]) => ({ name, ...preset }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh'));
}

/**
 * 预设引用的族在「当前族表」和「当前 REA 版本」里还在不在。
 *
 * 三种结论分开报，因为它们要用户做的事完全不同：
 *   - applied：真的挂进 activeBundles 的族；
 *   - missing：族表里没有（预设是旧机器存的，或引用的自定义族被删了）；
 *   - unavailable：族在、但这一版 REA 一个工具都没有（旧 REA 缺这族的能力）。
 * 只有 missing 会被挡下来：它进了 activeBundles 也加载不到任何东西，留着只会让人困惑。
 */
export function presetReport(preset, options = {}) {
  const defs = options.defs ?? {};
  const allBundle = options.allBundle ?? 'all';
  const known = Array.isArray(options.knownTools) ? new Set(options.knownTools) : null;
  const applied = [];
  const missing = [];
  const unavailable = [];
  for (const id of cleanBundles(preset?.activeBundles)) {
    if (id === allBundle) {
      applied.push(id);
      continue;
    }
    const def = defs[id];
    if (def === undefined) {
      missing.push(id);
      continue;
    }
    const defined = (def.tools ?? []).length;
    if (known !== null && defined > 0 && (def.tools ?? []).every((tool) => !known.has(tool))) unavailable.push(id);
    applied.push(id);
  }
  return { applied, missing, unavailable };
}

/**
 * 读取预设：拍出一份**新**配置（不动传进来的对象）。
 * 只改 activeBundles 与预设里真的记了的裁剪开关；没记的键保持原样。
 */
export function applyPreset(config, preset, options = {}) {
  const report = presetReport(preset, options);
  const next = { ...config, activeBundles: report.applied };
  const changed = [];
  for (const key of SHAPE_KEYS) {
    const value = preset?.[key];
    if (typeof value === 'undefined' || value === null) continue;
    if (typeof value !== typeof config?.[key]) continue;
    if (value === config[key]) continue;
    next[key] = value;
    changed.push({ key, from: config[key], to: value });
  }
  return { config: next, ...report, changed };
}

/** 当前配置正好等于这个预设（面板用它标「当前生效」）。 */
export function presetIsCurrent(preset, config) {
  const left = cleanBundles(preset?.activeBundles).sort().join(',');
  const right = cleanBundles(config?.activeBundles).sort().join(',');
  if (left !== right) return false;
  for (const key of SHAPE_KEYS) {
    const value = preset?.[key];
    if (typeof value === 'undefined' || value === null) continue;
    if (value !== config?.[key]) return false;
  }
  return true;
}

/**
 * 预设的工具数与估算成本。口径由调用方给（快照里的每工具字符数），不在这里另立一套，
 * 否则面板上的数字会和「合计」对不上。
 * @param {Map<string,number>|object} toolChars 工具名 → 模型可见字符数
 */
export function presetCost(preset, options = {}) {
  const defs = options.defs ?? {};
  const allBundle = options.allBundle ?? 'all';
  const toolChars = options.toolChars ?? {};
  const charsOf = typeof toolChars.get === 'function' ? (name) => toolChars.get(name) ?? 0 : (name) => toolChars[name] ?? 0;
  const ids = cleanBundles(preset?.activeBundles);
  const wanted = new Set();
  if (ids.includes(allBundle)) {
    const names = typeof toolChars.keys === 'function' ? toolChars.keys() : Object.keys(toolChars);
    for (const name of names) wanted.add(name);
  } else {
    for (const id of ids) for (const tool of defs[id]?.tools ?? []) wanted.add(tool);
  }
  let chars = 0;
  let toolCount = 0;
  for (const name of wanted) {
    const size = charsOf(name);
    if (size > 0) {
      chars += size;
      toolCount += 1;
    }
  }
  const toTokens = typeof options.tokensOfChars === 'function' ? options.tokensOfChars : (value) => Math.round((value ?? 0) / 3.6);
  return { toolCount, tokens: toTokens(chars) };
}

/** 删掉一个预设；不存在时报出已有名字，而不是静默成功。 */
export function removePreset(config, name) {
  const key = normalizePresetName(name);
  const presets = { ...(config?.presets ?? {}) };
  if (!Object.hasOwn(presets, key)) throw new Error(`没有预设：${key}。已有：${Object.keys(presets).join(', ') || '（无）'}`);
  delete presets[key];
  return { config: { ...config, presets }, removed: key };
}
