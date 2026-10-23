// 维护流程：把「检查更新 / 应用更新 / 归类新工具 / 刷新快照」串成一条可复用的流水线。
//
// CLI（check / update-* / doctor）、设置页面板、代理启动时的自动检查，三处都调这里，
// 保证同一个动作在任何入口上的行为与措辞一致。全部读写都走注入的依赖，方便测试替身。
import { buildSnapshot, writeSnapshot, readSnapshot } from './snapshot.mjs';
import { effectiveBundles } from './bundles.mjs';
import { classifyTools, extrasFrom, mergeExtras } from './classify.mjs';
import { checkSelfUpdate, applySelfUpdate, checkReaUpdate, applyReaUpdate, checkToolCoverage } from './updates.mjs';
import { probeTools } from './probe-client.mjs';
import { loadConfig, saveConfig } from './config.mjs';

/**
 * 一份完整报告：本仓库 / REA 本体 / 工具覆盖。只读，不改任何东西。
 *
 * 有意不抛错：面板轮询和 `check` 命令都不该因为「网断了」或「REA 起不来」而整体失败，
 * 每一项各自带 ok/reason，由调用方决定怎么展示。
 *
 * @param {object} config loadConfig() 的结果
 * @param {{root:string, probe?:Function, fetchImpl?:Function, snapshot?:object}} opts
 */
export async function collectReport(config, opts = {}) {
  const root = opts.root;
  const probe = opts.probe ?? ((childConfig) => probeTools(childConfig, { timeoutMs: 90000 }));
  const snapshot = opts.snapshot !== undefined ? opts.snapshot : readSnapshot();

  const self = safeSync(() => checkSelfUpdate({ root, remote: config.updates?.self?.remote ?? 'origin' }));
  const rea = await safeAsync(() => checkReaUpdate({ child: config.child, registry: config.updates?.rea?.registry }));

  let toolNames = [];
  let liveError = null;
  try {
    const { tools } = await probe(config.child);
    toolNames = (tools ?? []).map((tool) => tool.name);
  } catch (error) {
    liveError = String(error?.message ?? error);
  }
  let source = 'live';
  if (toolNames.length === 0 && snapshot?.tools) {
    toolNames = snapshot.tools.map((tool) => tool.name);
    source = `snapshot（REA 未响应：${liveError}）`;
  }
  const defs = effectiveBundles(config.customBundles, config.bundleExtras);
  const coverage = { source, ...checkToolCoverage({ toolNames, defs, extras: config.bundleExtras }) };

  return {
    generatedAt: new Date().toISOString(),
    self,
    rea,
    coverage,
    // 一句话结论，面板与 CLI 都能直接用。
    summary: summarize({ self, rea, coverage }),
  };
}

/** 三块结论压成一行；没有问题就是「全部最新」。 */
export function summarize(report) {
  const parts = [];
  if (report.self?.fetchError) parts.push(`本仓库取远端失败：${report.self.fetchError}`);
  else if (report.self?.available) parts.push(`本仓库落后 ${report.self.behind} 个提交`);
  else if (report.self?.ok === false) parts.push(`本仓库无法检查：${report.self.reason}`);
  if (report.rea?.updateAvailable) parts.push(`REA 有新版 ${report.rea.installed} → ${report.rea.latest}`);
  else if (report.rea?.registryError && report.rea?.updateAvailable !== true) parts.push(report.rea.registryError);
  if (report.coverage?.unassigned?.length) parts.push(`${report.coverage.unassigned.length} 个新工具未归族`);
  if (report.coverage?.missingForLocal?.length) parts.push(`${report.coverage.missingForLocal.length} 个族内工具本地 REA 没有`);
  return parts.length ? parts.join('；') : '本仓库与 REA 都是最新，工具全部归族。';
}

/**
 * 应用归类：把高置信度建议（或手工指定的 { 工具名: 族 id }）写进 config.bundleExtras。
 *
 * 三处入口（CLI classify --apply、面板「写入高置信度归类」、元工具 maintenance classify）
 * 都走这一份，保证「什么算可写」完全一致：只有 confidence=high 才自动写，其余必须人指定。
 *
 * @param {object} config loadConfig() 的结果
 * @param {{manual?:Record<string,string>, tools?:object[], classify?:Function}} opts
 */
export async function applyClassify(config, opts = {}) {
  const fresh = loadConfig();
  const defs = effectiveBundles(fresh.customBundles, fresh.bundleExtras);
  const snapshot = readSnapshot();
  const known = new Set((opts.tools ?? snapshot?.tools ?? []).map((tool) => tool.name));

  let extra = {};
  if (opts.manual !== undefined && opts.manual !== null) {
    for (const [toolName, bundleId] of Object.entries(opts.manual)) {
      if (defs[bundleId] === undefined) throw new Error(`未知功能族：${bundleId}`);
      if (known.size > 0 && !known.has(toolName)) throw new Error(`未知工具：${toolName}`);
      extra[bundleId] = [...(extra[bundleId] ?? []), toolName];
    }
  } else {
    const tools = opts.tools ?? (snapshot?.tools ?? []).map((tool) => ({ name: tool.name, description: tool.desc ?? '' }));
    const classify = opts.classify ?? ((list, o) => classifyTools(list, o));
    const result = classify(tools, { defs });
    const confident = result.assignments.filter((entry) => entry.suggested !== null && entry.confidence === 'high');
    if (confident.length === 0) throw new Error('没有高置信度的归类建议可写入；用 manual 指定具体工具，或先看分类建议');
    extra = extrasFrom(confident);
  }

  saveConfig({ ...fresh, bundleExtras: mergeExtras(fresh.bundleExtras, extra) });
  return { written: Object.values(extra).flat().length, extras: extra, bundleExtras: loadConfig().bundleExtras };
}

function safeSync(fn) {
  try {
    return fn();
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

async function safeAsync(fn) {
  try {
    return await fn();
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

/** 本仓库检查结论 → 一行可读文本（元工具与 CLI 共用一套措辞）。 */
export function describeSelf(self) {
  if (!self) return '（未检查）';
  if (self.ok === false) return `无法检查：${self.reason ?? '未知原因'}`;
  if (self.fetchError) return `取远端失败：${self.fetchError}`;
  if (self.tracking === false) return self.reason ?? '没有跟踪远端分支';
  if (self.available) {
    const parts = [`${self.branch || 'HEAD'} 落后 ${self.behind} 个提交（远端 ${self.upstream}）`];
    if (self.ahead) parts.push(`本地领先 ${self.ahead} 个提交`);
    parts.push(self.fastForwardable ? '可快进' : '需人工处理：有本地提交或工作区不干净');
    return parts.join('，');
  }
  return `已是最新（${self.upstream ?? self.branch}${self.head ? ` ${self.head}` : ''}）${self.dirty ? '；工作区有未提交改动' : ''}`;
}

/** REA 本体检查结论 → 一行可读文本。 */
export function describeRea(rea) {
  if (!rea) return '（未检查）';
  if (rea.ok === false) return `无法检查：${rea.reason ?? '未知原因'}`;
  const install = rea.install?.found ? `已安装 ${rea.installed}（${rea.install.manager} @ ${rea.install.envDir}）` : `找不到安装位置：${rea.install?.reason ?? '未知'}`;
  if (rea.registryError) return `${install}；${rea.registryError}`;
  return rea.updateAvailable ? `${install}；npm 有新版 ${rea.latest}` : `${install}；已是最新（npm ${rea.latest ?? '?'}）`;
}

/** 更新结果 → 多行文本（含计划与下一步）。 */
export function describeUpdate(label, result) {
  if (!result) return `${label}：未执行`;
  const lines = [];
  if (result.ok === false) lines.push(`${label}：失败 — ${result.reason ?? '未知原因'}`);
  else if (result.dryRun) {
    lines.push(`${label}：预览（未改动）`);
    if (result.plan) lines.push(`  计划：${typeof result.plan === 'string' ? result.plan : JSON.stringify(result.plan)}`);
    lines.push('  确认后加 apply=true 执行。');
  } else if (result.updated === false) lines.push(`${label}：${result.reason ?? '无需更新'}`);
  else {
    lines.push(`${label}：已更新`);
    if (result.apply?.to) lines.push(`  现在位于 ${result.apply.to}`);
    if (result.after?.snapshot) lines.push(`  快照已刷新：${result.after.snapshot.toolCount} 个工具`);
    if (result.after?.classified) lines.push(`  已自动归类 ${result.after.classified.written} 个新工具`);
    for (const warning of result.after?.warnings ?? []) lines.push(`  ${warning}`);
    if (result.apply?.output) lines.push(`  ${String(result.apply.output).slice(-600)}`);
  }
  return lines.join('\n');
}

/**
 * 拉取 REA 更新并按需归类。
 *
 * @param {object} config
 * @param {{root:string, apply?:boolean, onOutput?:Function, probe?:Function, log?:Function}} opts
 *   apply=false 只检查并给出计划；apply=true 真的装。
 */
export async function pullReaUpdate(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const check = await checkReaUpdate({ child: config.child, registry: config.updates?.rea?.registry });
  if (!check.ok || check.install?.found !== true) {
    return { ok: false, reason: check.registryError ?? check.install?.reason ?? '无法定位 REA 安装', check };
  }
  if (check.updateAvailable !== true) {
    return { ok: true, updated: false, reason: `已是最新（${check.installed}）`, check };
  }
  if (opts.apply !== true) {
    return { ok: true, updated: false, dryRun: true, check, plan: `在 ${check.install.envDir} 执行 ${check.install.manager} 装 rea-agents@${check.latest}` };
  }
  log(`升级 REA ${check.installed} → ${check.latest}`);
  const applied = await applyReaUpdate({ check, apply: true, onOutput: opts.onOutput });
  if (!applied.ok) return { ok: false, reason: applied.reason, check, apply: applied };
  // 装完立刻跑「快照 + 归类」：新工具不归族就加载不到，这一步不能留给用户自己去想。
  const after = await refreshAfterUpgrade(config, { ...opts, log });
  return { ok: true, updated: true, check, apply: applied, ...after };
}

/**
 * 升级后收尾：取新工具列表 → 写快照 → 高置信度归类写进 config.bundleExtras。
 * @returns {{snapshot:object|null, classified:object|null, warnings:string[]}}
 */
export async function refreshAfterUpgrade(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const warnings = [];
  let tools = [];
  try {
    const probe = opts.probe ?? ((childConfig) => probeTools(childConfig, { timeoutMs: 90000 }));
    tools = (await probe(config.child)).tools ?? [];
  } catch (error) {
    warnings.push(`取新版本工具列表失败：${error?.message ?? error}`);
    return { snapshot: null, classified: null, warnings };
  }
  const fresh = loadConfig();
  const snapshot = buildSnapshot(tools, fresh);
  try {
    writeSnapshot(snapshot);
    log(`快照已刷新：${snapshot.toolCount} 个工具，全量约 ${snapshot.totalTokens} tok`);
  } catch (error) {
    warnings.push(`写快照失败：${error?.message ?? error}`);
  }
  const defs = effectiveBundles(fresh.customBundles, fresh.bundleExtras);
  const result = classifyTools(tools, { defs });
  const confident = result.assignments.filter((entry) => entry.suggested !== null && entry.confidence === 'high');
  let classified = null;
  if (confident.length > 0) {
    try {
      const merged = mergeExtras(fresh.bundleExtras, extrasFrom(confident));
      saveConfig({ ...fresh, bundleExtras: merged });
      classified = { written: confident.length, extras: extrasFrom(confident) };
      log(`已把 ${confident.length} 个新工具自动归族（写 config.bundleExtras）`);
    } catch (error) {
      warnings.push(`写归类失败：${error?.message ?? error}`);
    }
  }
  if (result.counts.unclassified > 0) {
    warnings.push(`${result.counts.unclassified} 个新工具需要人工/模型定族：跑 node src/cli.mjs classify`);
  }
  return { snapshot, classified, warnings, remaining: result.assignments.filter((entry) => entry.suggested === null || entry.confidence !== 'high') };
}

/**
 * 拉取本仓库更新（git 快进）。
 * @param {{root:string, remote?:string, apply?:boolean, log?:Function}} opts
 */
export function pullSelfUpdate(opts = {}) {
  const log = opts.log ?? (() => {});
  const check = checkSelfUpdate({ root: opts.root, remote: opts.remote ?? 'origin' });
  if (check.ok !== true) return { ok: false, updated: false, reason: check.reason ?? '检查失败', check };
  if (check.available !== true) return { ok: true, updated: false, reason: `已是最新（${check.head ?? check.branch}）`, check };
  if (opts.apply !== true) return { ok: true, updated: false, dryRun: true, check, plan: `git merge --ff-only ${check.upstream}（${check.behind} 个提交）` };
  log(`快进到 ${check.upstream}`);
  const applied = applySelfUpdate(check, { root: opts.root });
  return { ok: applied.ok, updated: applied.ok, check, apply: applied, reason: applied.reason };
}

/**
 * 代理启动时的自动维护：按 config.updates 里的开关检查（必要时应用）。
 *
 * 默认全关。开着 autoApply 就是在「启动时自动更新」，所以要一眼能从配置看出它做了什么：
 * checkOnStart 只记日志，autoApply 才会真的修改本机。
 */
export async function runStartupMaintenance(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const settings = config.updates ?? {};
  const actions = [];
  if (settings.self?.checkOnStart === true || settings.self?.autoApply === true) {
    const self = pullSelfUpdate({ root: opts.root, remote: settings.self?.remote, apply: settings.self?.autoApply === true, log });
    actions.push({ kind: 'self', ...self });
    log(`本仓库：${self.reason ?? (self.updated ? `已快进到 ${self.apply?.to}` : '有更新可用')}`);
  }
  if (settings.rea?.checkOnStart === true || settings.rea?.autoApply === true) {
    if (settings.rea?.autoApply === true) {
      const result = await pullReaUpdate(config, { root: opts.root, apply: true, probe: opts.probe, log, onOutput: opts.onOutput });
      actions.push({ kind: 'rea', ...result });
      log(`REA：${result.reason ?? (result.updated ? '已升级并归类' : '无需升级')}`);
    } else {
      const check = await safeAsync(() => checkReaUpdate({ child: config.child, registry: settings.rea?.registry }));
      actions.push({ kind: 'rea', ok: check.ok, check });
      log(`REA：${check.updateAvailable ? `有新版本 ${check.installed} → ${check.latest}` : '无需升级'}`);
    }
  }
  return actions;
}
