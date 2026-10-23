// 工具快照：把 REA 的工具列表按「模型实际看到的成本」落盘。
//
// 用途：设置页（dsh-plugin/）与 CLI 不需要启动 REA 就能算出每个功能族的上下文成本，
// 也不需要把全部工具的完整 schema 抄一份进仓库（快照只存 name / 字符数 / 一句话描述）。
// proxy 每次预取成功后会刷新它，所以快照不会与真实工具集漂移。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlesOf, unassignedTools, effectiveBundles } from './bundles.mjs';
import { projectTool, modelVisibleChars, shortDescription, estimateTokens } from './lite.mjs';
import { META_TOOLS } from './meta-tools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** 快照路径（可用 REA_LITE_SNAPSHOT 覆盖，便于测试）。 */
export const SNAPSHOT_PATH = process.env.REA_LITE_SNAPSHOT || path.join(ROOT, 'data', 'tools-model.json');

/** 与 lite.mjs 共用同一口径：英文 JSON 约 3.6 字符/token。 */
export const CHARS_PER_TOKEN = 3.6;

/** 快照结构版本；读到别的版本一律当没有。 */
export const SNAPSHOT_VERSION = 1;

/** 字符数 → 估算 token。 */
export function tokensOfChars(chars) {
  return Math.round((chars ?? 0) / CHARS_PER_TOKEN);
}

/**
 * 由原始工具列表构建快照。成本口径与 proxy 暴露给模型的完全一致：
 * 先按 lite/shortDescription 投影，再只统计 name + description + inputSchema。
 * @param {object[]} rawTools REA tools/list 的原始工具数组
 * @param {object} config 网关配置（用到 lite / shortDescription）
 */
export function buildSnapshot(rawTools, config) {
  const lite = config?.lite ?? 'mild';
  const shortDesc = config?.shortDescription !== false;
  // 族归属按「内置族 + 用户自定义族」算，这样面板上自定义族也能看到自己的工具。
  const table = effectiveBundles(config?.customBundles);
  const tools = (rawTools ?? [])
    .map((tool) => {
      const projected = projectTool(tool, { lite, shortDesc });
      return {
        name: projected.name,
        chars: modelVisibleChars(projected),
        desc: shortDescription(projected.description, 140),
        bundles: bundlesOf(projected.name, table),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalChars = tools.reduce((sum, tool) => sum + tool.chars, 0);
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    lite,
    shortDesc,
    toolCount: tools.length,
    totalChars,
    totalTokens: tokensOfChars(totalChars),
    metaTokens: estimateTokens(META_TOOLS),
    unassigned: unassignedTools(tools.map((tool) => tool.name), table),
    tools,
  };
}

/** 原子写入快照（临时文件 + rename，避免读者看到半截 JSON）。 */
export function writeSnapshot(snapshot, target = SNAPSHOT_PATH) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
  fs.renameSync(tmp, target);
  return target;
}

/**
 * 写快照但不让失败影响主流程：快照只是给 GUI/CLI 看的派生数据。
 * @returns 快照对象，失败时返回 null
 */
export function tryWriteSnapshot(rawTools, config, target = SNAPSHOT_PATH) {
  try {
    const snapshot = buildSnapshot(rawTools, config);
    writeSnapshot(snapshot, target);
    return snapshot;
  } catch {
    return null;
  }
}

/** 读快照；不存在、损坏或版本不符都返回 null。 */
export function readSnapshot(target = SNAPSHOT_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (parsed?.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.tools)) return null;
    return parsed;
  } catch {
    return null;
  }
}
