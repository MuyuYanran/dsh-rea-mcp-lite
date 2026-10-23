// 智能归类：把「当前 REA 版本里有、但没被任何功能族收录」的新工具，自动建议归入某个内置族。
//
// 为什么需要它：REA 每次升级都会新增工具，而 src/bundles.mjs 的族清单是**静态**的。
// 新工具不归族就会：
//   - 出现在 `bundles` 元工具的 unassigned 里（模型看到「未归族」，不知道该不该加载）；
//   - 在面板上不属于任何族，用户找不到它；
//   - `use <族名>` 加载不到它。
//
// 手工归族要读 200 多个工具名，所以这里自动打分。用的是**词元稀有度**而不是硬编码关键词：
// 一个词出现在越少的族里，它对这个族的指向性越强。
//   - `swift` / `pcap` / `frida` 只出现在一个族 → 强信号；
//   - `inspect` / `verify` / `compare` / `session` 遍地都是 → 弱信号（而且它本来就是弱动词）。
// 硬编码关键词做不到这件事：`verify_swift_protocol_conformance` 里 `verify` 会把结果拉到
// evidence，而真正的领域词 swift / mach-o 才该决定归属。
//
// 归类结果写进 config.bundleExtras，而不是直接改 bundles.mjs：
// 内置族由代码维护、随 REA 版本演进；把机器判断塞进代码会在下次升级时变成难解释的漂移。
//
// 置信度必须诚实：分数不够就不给建议（宁可留给模型判断），前两名太接近就只说「不确定」。

import { BUNDLES } from './bundles.mjs';

/** 低于这个分数就不给建议 —— 宁可不归类，也别把工具塞进错的族。 */
export const MIN_SCORE = 3;
/**
 * 达到这个分数、且明显压过第二名，才算高置信度（可一键写入）。
 * 4.5 ≈「名字里有一个专属词 + 描述里再有一点印证」，或「名字里两个专属词」。
 */
export const CONFIDENT_SCORE = 4.5;
/** 高置信度还要求：第一名至少是第二名的这么多倍（避免「三族同分」被当成确定答案）。 */
export const CONFIDENT_MARGIN = 1.4;

/** 名字里的词更重要：作者起名时选的就是最能描述它的词。 */
const NAME_WEIGHT = 3;
/** 描述里的词算辅助证据，权重低一档。 */
const DESC_WEIGHT = 1;

/**
 * 纯语法词/通用动词：它们几乎出现在每个族里，但当作者把它们写进描述时，
 * 不代表这个工具属于某一族。这里显式列出来，比靠 df 统计更稳（少量样本时 df 会抖）。
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'over',
  'is', 'are', 'be', 'was', 'were', 'has', 'have', 'had', 'can', 'may', 'will', 'that', 'this', 'these', 'those',
  'it', 'its', 'as', 'if', 'then', 'than', 'so', 'not', 'no', 'any', 'all', 'each', 'one', 'two', 'both',
  'get', 'set', 'list', 'show', 'read', 'write', 'run', 'use', 'make', 'take', 'give', 'find', 'check',
  'inspect', 'analyze', 'analyse', 'collect', 'resolve', 'compare', 'verify', 'build', 'trace', 'project',
  'extract', 'import', 'export', 'record', 'capture', 'create', 'update', 'delete', 'remove', 'add',
  'data', 'info', 'information', 'result', 'value', 'item', 'thing', 'tool', 'call', 'start', 'stop',
  'open', 'close', 'load', 'save', 'push', 'pull', 'send', 'receive', 'return', 'output', 'input',
  'app', 'application', 'file', 'files', 'path', 'name', 'names', 'type', 'types',
]);

/** 名字与描述拆成小写词元。 */
function tokenize(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * 每个族的词元表：由该族**已有工具名**构成（英文、稳定、随 REA 演进）。
 * 标签与提示是中文，切词无意义，所以不参与。
 */
function bundleProfiles(defs) {
  const profiles = {};
  for (const [id, def] of Object.entries(defs ?? {})) {
    const tokens = new Set();
    for (const toolName of def.tools ?? []) for (const token of tokenize(toolName)) tokens.add(token);
    profiles[id] = tokens;
  }
  return profiles;
}

/**
 * 词元稀有度权重：出现在越少的族里，指向性越强。
 * df=1 → 3.0（专属词），df=2 → 1.6，df=3 → 0.9，更多 → 0.35（通用词，几乎不参与判断）。
 */
export function tokenWeight(documentFrequency) {
  if (documentFrequency <= 1) return 3;
  if (documentFrequency === 2) return 1.6;
  if (documentFrequency === 3) return 0.9;
  return 0.35;
}

/** 词元 → 出现在多少个族里。 */
function documentFrequencies(profiles) {
  const df = new Map();
  for (const tokens of Object.values(profiles)) {
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return df;
}

/**
 * 给单个工具打分并给出建议。
 *
 * @param {{name:string, description?:string}} tool 待归类的工具（REA tools/list 的一项）
 * @param {{defs?:object}} opts defs 生效族表（内置 + 自定义 + 追加归类）
 * @returns {{name:string,suggested:string|null,confidence:'high'|'medium'|'low',score:number,candidates:Array,reason:string}}
 */
export function suggestBundle(tool, opts = {}) {
  const defs = opts.defs ?? BUNDLES;
  const name = String(tool?.name ?? '');
  const description = String(tool?.description ?? '');
  const profiles = bundleProfiles(defs);
  const df = documentFrequencies(profiles);

  const nameTokens = new Set(tokenize(name));
  // 描述只看前 400 字符：REA 的描述有的很长，尾部多是「Returns ...」之类套话。
  const descTokens = new Set(tokenize(description.slice(0, 400)).filter((token) => !nameTokens.has(token)));

  const scores = new Map();
  for (const [id, tokens] of Object.entries(profiles)) {
    let score = 0;
    for (const token of nameTokens) if (tokens.has(token)) score += tokenWeight(df.get(token) ?? 1) * NAME_WEIGHT / 3;
    for (const token of descTokens) if (tokens.has(token)) score += tokenWeight(df.get(token) ?? 1) * DESC_WEIGHT / 3;
    if (score > 0) scores.set(id, Math.round(score * 100) / 100);
  }

  const candidates = [...scores.entries()]
    .map(([id, score]) => ({ id, score, label: defs[id]?.label ?? id }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const top = candidates[0];
  const runnerUp = candidates[1];
  const score = top?.score ?? 0;
  const suggested = top !== undefined && score >= MIN_SCORE ? top.id : null;
  let confidence = 'low';
  let reason;
  if (suggested === null) {
    reason = top === undefined
      ? '没有命中任何族的词元'
      : `最高分 ${score} 未达到阈值 ${MIN_SCORE}（弱信号，交给人工/模型判断）`;
  } else if (score >= CONFIDENT_SCORE && (runnerUp === undefined || score >= runnerUp.score * CONFIDENT_MARGIN)) {
    confidence = 'high';
    reason = `专属词命中 ${suggested}：${score} 分，明显领先${runnerUp ? `（第二名 ${runnerUp.id} ${runnerUp.score}）` : ''}`;
  } else {
    confidence = 'medium';
    reason = `偏向 ${suggested}（${score} 分）但不够确定${runnerUp ? `：${runnerUp.id} 也有 ${runnerUp.score}` : ''}`;
  }

  return { name, suggested, confidence, score, candidates: candidates.slice(0, 4), reason };
}

/**
 * 批量归类：只处理「当前 REA 有、且不属于任何族」的工具。
 *
 * @param {object[]} tools REA tools/list 原始数组
 * @param {{defs?:object, assigned?:Set<string>|string[]}} opts assigned 已归族的工具名（默认由 defs 推导）
 * @returns {{assignments:Array, unclassified:string[], counts:object}}
 */
export function classifyTools(tools, opts = {}) {
  const defs = opts.defs ?? BUNDLES;
  const assigned = opts.assigned instanceof Set
    ? opts.assigned
    : new Set(opts.assigned ?? Object.values(defs).flatMap((def) => def.tools ?? []));
  const pending = (tools ?? []).filter((tool) => tool?.name && !assigned.has(tool.name));
  const assignments = pending.map((tool) => ({ ...suggestBundle(tool, { defs }), description: String(tool.description ?? '').slice(0, 200) }));
  const unclassified = assignments.filter((entry) => entry.suggested === null).map((entry) => entry.name);
  const counts = { total: pending.length, assigned: pending.length - unclassified.length, unclassified: unclassified.length };
  return { assignments, unclassified, counts };
}

/** 把归类结果收成 bundleExtras 的形状：{ 族 id: [工具名…] }（只收有建议的）。 */
export function extrasFrom(assignments) {
  const out = {};
  for (const entry of assignments ?? []) {
    if (entry?.suggested === null || entry?.suggested === undefined) continue;
    out[entry.suggested] = [...new Set([...(out[entry.suggested] ?? []), entry.name])];
  }
  for (const id of Object.keys(out)) out[id].sort();
  return out;
}

/** 把新归类合并进已有 bundleExtras（幂等，重复执行不会重复添加）。 */
export function mergeExtras(current, extra) {
  const merged = {};
  for (const [id, list] of Object.entries(current ?? {})) {
    if (Array.isArray(list)) merged[id] = [...new Set(list)];
  }
  for (const [id, list] of Object.entries(extra ?? {})) {
    merged[id] = [...new Set([...(merged[id] ?? []), ...(Array.isArray(list) ? list : [])])].sort();
  }
  return merged;
}

/**
 * 生成给模型（DSH 里的 agent）的归类题面：不确定的工具交给模型判断，比词元统计更准。
 * 输出是「待判工具 + 可选族清单」的纯文本，模型答回来的是 JSON：{ 工具名: 族 id }。
 */
export function buildClassifierPrompt(assignments, opts = {}) {
  const defs = opts.defs ?? BUNDLES;
  const lines = ['任务：把下列 REA 工具各自归入一个功能族，只回 JSON：{"工具名":"族 id"}。不确定的写 "none"。', '', '可选族（id — 标签）：'];
  for (const [id, def] of Object.entries(defs)) {
    if (def.custom === true) continue;
    lines.push(`${id} — ${def.label ?? id}`);
  }
  lines.push('', '待归类工具（名称 — 一句话用途 — 本地建议）：');
  let asked = 0;
  for (const entry of assignments ?? []) {
    if (entry.suggested !== null && entry.confidence === 'high') continue; // 高置信度的不必问
    asked += 1;
    lines.push(`${entry.name} — ${entry.description || '(无描述)'} — ${entry.suggested ?? 'none'}（${entry.confidence}）`);
  }
  if (asked === 0) lines.push('（没有需要模型判断的工具，全部高置信度）');
  return `${lines.join('\n')}\n`;
}
