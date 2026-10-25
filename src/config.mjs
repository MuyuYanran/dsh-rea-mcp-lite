// 配置读写：proxy 与 cli 共用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePresets } from './presets.mjs';

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
    // 预设是用户手写/面板写入的存档：坏条目按条丢弃，不让一条垃圾拖垮整页。
    presets: normalizePresets(user.presets),
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
    // 同理：预设也必须一起写回。漏了它，用户存好的几套视角会在下一次勾选时被抹掉。
    presets: normalizePresets(config.presets),
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
}
