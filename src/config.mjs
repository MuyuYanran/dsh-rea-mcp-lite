// 配置读写：proxy 与 cli 共用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CONFIG_PATH = process.env.REA_LITE_CONFIG || path.join(ROOT, 'config.json');

// REA 启动器路径：优先环境变量，其次 config.json 的 child.args，最后是本机默认值。
export const DEFAULT_REA_LAUNCHER =
  process.env.REA_LITE_LAUNCHER ||
  'D:\\_paths\\Workspace\\Environments\\rea-agents\\node_modules\\rea-agents\\scripts\\rea.mjs';

export const DEFAULTS = {
  mode: 'gateway',
  activeBundles: [],
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
    user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(`[rea-mcp-lite] 读取配置失败，使用默认值：${error.message}\n`);
  }
  return {
    ...DEFAULTS,
    ...user,
    child: { ...DEFAULTS.child, ...(user.child ?? {}), env: { ...DEFAULTS.child.env, ...(user.child?.env ?? {}) } },
    activeBundles: Array.isArray(user.activeBundles) ? user.activeBundles : DEFAULTS.activeBundles,
  };
}

export function saveConfig(config) {
  const payload = {
    mode: config.mode,
    activeBundles: config.activeBundles,
    metaTools: config.metaTools,
    lite: config.lite,
    shortDescription: config.shortDescription,
    persistRuntimeSwitch: config.persistRuntimeSwitch,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    child: config.child,
  };
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}
