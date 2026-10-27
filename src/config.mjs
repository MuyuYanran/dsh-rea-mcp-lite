// 配置读写：proxy 与 cli 共用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePresets } from './presets.mjs';
import { readPresetStore, writePresetStore, presetStorePath } from './preset-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
/** 模块加载时的配置路径（给显示用；实际读写走 configPath()，见下）。 */
export const CONFIG_PATH = process.env.REA_LITE_CONFIG || path.join(ROOT, 'config.json');

/**
 * 真正使用的配置路径。
 *
 * 为什么不是直接用 CONFIG_PATH 常量：这个路径允许用 REA_LITE_CONFIG 覆写，
 * 而自检脚本/面板会在同一次进程里换到临时配置（否则测试会把真实 config.json 写脏——
 * 已经踩过一次）。常量在模块求值时固定，调用时再读环境变量才符合预期。
 */
export function configPath() {
  return process.env.REA_LITE_CONFIG || path.join(ROOT, 'config.json');
}

// REA 启动器路径：优先环境变量，其次 config.json 的 child，最后是占位默认值。
// 这里**故意不写本机绝对路径**：仓库不该携带任何机器专属路径（见 AGENTS.md 提交约定）。
// 真正能用的路径应该出现在 config.json（已 gitignore）或 REA_LITE_LAUNCHER 里；
// 只凭占位值启动时 CLI/面板会把「找不到安装位置」如实报出来，而不是悄悄指向别人的磁盘。
export const DEFAULT_REA_LAUNCHER =
  process.env.REA_LITE_LAUNCHER ||
  path.join('<rea-agents>', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');

export const DEFAULTS = {
  mode: 'gateway',
  activeBundles: [],
  // 用户自定义的族：{ <id>: { label?, hint?, tools: [...] } }。与内置族并列，不是覆盖。
  customBundles: {},
  // 内置族的增量归类：{ <内置族 id>: [工具名…] }。由 classify 写入，只做追加不做替换。
  bundleExtras: {},
  // 命名预设：{ <名字>: { activeBundles, lite?, shortDescription?, metaTools?, label?, note?, savedAt? } }。
  // 存「一套可切换的视角」，与 activeBundles（此刻生效的那一套）是两回事。
  presets: {},
  // 自动更新设置。默认全关：更新会改本机安装，必须由用户显式开启。
  updates: {
    self: { remote: 'origin', checkOnStart: false },
    rea: { registry: 'https://registry.npmjs.org/rea-agents', checkOnStart: false },
  },
  metaTools: true,
  lite: 'mild',
  shortDescription: true,
  persistRuntimeSwitch: true,
  toolCallTimeoutMs: 600000,
  child: {
    command: process.execPath,
    args: [DEFAULT_REA_LAUNCHER, 'mcp'],
    env: { REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' },
  },
};

/**
 * 把 config.json 里那份旧预设副本去掉（预设的唯一归属地是 preset-store.mjs 的独立存储）。
 *
 * 只在确实还留着这个键时才动文件，且是「读出来 → 删键 → 原子写回」：
 * 迁移过程中任何一步失败都只是留着旧副本，不会把别的配置项弄丢。
 */
function stripLegacyPresets(user) {
  if (!Object.hasOwn(user, 'presets')) return false;
  const target = configPath();
  try {
    const next = { ...user };
    delete next.presets;
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (error) {
    process.stderr.write(`[rea-mcp-lite] 清理 config.json 里的旧预设副本失败（不影响使用）：${error.message}\n`);
    return false;
  }
}

/**
 * 读预设。独立存储是唯一归属地；config.json 里的 presets 只当**一次性迁移来源**。
 *
 * 为什么在这里迁移而不是等用户下次保存：用户装的是 npm 包，升级会整目录替换 ——
 * 如果他升级前一次都没保存过，config.json 里那份就是唯一的预设，必须先搬出来。
 * 所以任何一次 loadConfig（代理启动、面板打开、CLI 跑一下）都会触发迁移。
 *
 * 顺序是「先落盘、再清旧副本」：中途失败最坏是旧副本还在，绝不会两边都空。
 */
function resolvePresets(user) {
  const legacy = normalizePresets(user.presets);
  let hasLegacy = Object.hasOwn(user, 'presets');
  let store;
  try {
    store = readPresetStore();
  } catch (error) {
    process.stderr.write(`[rea-mcp-lite] 读取预设存储失败，暂用 config.json 里的副本：${error.message}\n`);
    return legacy;
  }

  if (!store.exists) {
    if (Object.keys(legacy).length === 0) {
      // 没有存储也没有旧副本：清掉空的 presets 键，保持 config.json 干净。
      if (hasLegacy) stripLegacyPresets(user);
      return {};
    }
    try {
      writePresetStore(legacy);
      const cleaned = stripLegacyPresets(user);
      process.stderr.write(
        `[rea-mcp-lite] 已把 ${Object.keys(legacy).length} 个预设迁移到独立存储：${store.path}` +
          `${cleaned ? '（config.json 里的旧副本已清理）' : ''}\n`,
      );
    } catch (error) {
      process.stderr.write(`[rea-mcp-lite] 预设迁移失败，仍使用 config.json 里的副本：${error.message}\n`);
    }
    return legacy;
  }

  // 存储已经存在：以它为准。config.json 若还留着旧副本，顺手清掉，避免两份数据各自漂移。
  if (store.error !== undefined) {
    process.stderr.write(`[rea-mcp-lite] ${store.error}\n`);
  }
  if (hasLegacy) stripLegacyPresets(user);
  return store.presets;
}

export function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(`[rea-mcp-lite] 读取配置失败，使用默认值：${error.message}\n`);
  }
  const custom = user.customBundles;
  const extras = user.bundleExtras;
  return {
    ...DEFAULTS,
    ...user,
    child: { ...DEFAULTS.child, ...(user.child ?? {}), env: { ...DEFAULTS.child.env, ...(user.child?.env ?? {}) } },
    activeBundles: Array.isArray(user.activeBundles) ? user.activeBundles : DEFAULTS.activeBundles,
    customBundles: custom !== null && typeof custom === 'object' && !Array.isArray(custom) ? custom : {},
    bundleExtras: extras !== null && typeof extras === 'object' && !Array.isArray(extras) ? extras : {},
    // 预设来自独立存储（见 preset-store.mjs）：它们不该待在会被插件升级替换掉的 config.json 里。
    // 坏条目按条丢弃，不让一条垃圾拖垮整页。
    presets: resolvePresets(user),
    updates: {
      self: { ...DEFAULTS.updates.self, ...(user.updates?.self ?? {}) },
      rea: { ...DEFAULTS.updates.rea, ...(user.updates?.rea ?? {}) },
    },
  };
}

export function saveConfig(config) {
  const payload = {
    mode: config.mode,
    activeBundles: config.activeBundles,
    customBundles: config.customBundles ?? {},
    // 追加归类与更新设置要一起保存：面板和执行 classify 的 CLI 都会改它们，
    // 漏了这两项就会出现「刚归类完，下次一保存勾选就全丢」。
    bundleExtras: config.bundleExtras ?? {},
    // 注意：这里**不再写 presets**。预设的唯一归属地是独立存储（preset-store.mjs），
    // 写两份就会各自漂移（删了一个，另一份还在，下次迁移又把删掉的搬回来）。
    // 因此 config.json 里不会再有 presets 键；旧版本留下的一份由 loadConfig 负责迁移并清理。
    metaTools: config.metaTools,
    lite: config.lite,
    shortDescription: config.shortDescription,
    persistRuntimeSwitch: config.persistRuntimeSwitch,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    updates: config.updates ?? DEFAULTS.updates,
    child: config.child,
  };
  const target = configPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);

  // 预设单独写；config.presets 缺省（undefined）时不动存储，避免被一个不关心预设的调用方抹掉。
  if (config.presets !== undefined) writePresetStore(config.presets);
}
