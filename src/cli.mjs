#!/usr/bin/env node
// 命令行入口。三类命令：
//   族与工具：status / list / use / all / none / custom / snapshot
//   归类：classify（把 REA 新版新增的未归族工具自动归入功能族，写 config.bundleExtras）
//   更新与体检：check / update-self / update-rea / doctor
// 改 config.json 的部分，若 DSH 正在运行，代理会监听文件并立刻热更新工具列表（无需重启）。
import { ALL_BUNDLE, describeBundles, unassignedTools, effectiveBundles, normalizeCustomBundle, extrasOf } from './bundles.mjs';
import { projectTool, estimateTokens } from './lite.mjs';
import { loadConfig, saveConfig, CONFIG_PATH, ROOT } from './config.mjs';
import { buildSnapshot, writeSnapshot, readSnapshot, SNAPSHOT_PATH } from './snapshot.mjs';
import { probeTools } from './probe-client.mjs';
import { classifyTools, buildClassifierPrompt } from './classify.mjs';
import {
  checkSelfUpdate,
  applySelfUpdate,
  checkReaUpdate,
  applyReaUpdate,
  checkToolCoverage,
  locateReaInstall,
} from './updates.mjs';
import { applyClassify } from './maintenance.mjs';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const arg = (name) => {
  const index = rest.indexOf(name);
  return index !== -1 && index + 1 < rest.length && !rest[index + 1].startsWith('--') ? rest[index + 1] : undefined;
};

function printStatus() {
  const config = loadConfig();
  const active = config.activeBundles.length ? config.activeBundles.join(', ') : '（无，仅元工具）';
  console.log(`配置文件：${CONFIG_PATH}`);
  console.log(`当前加载：${active}`);
  console.log(`schema 裁剪：${config.lite}   元工具：${config.metaTools ? '开' : '关'}`);
  console.log(`REA 启动命令：${config.child.command} ${config.child.args.join(' ')}`);
  const install = locateReaInstall(config.child.args[0]);
  if (install.found) console.log(`REA 安装位置：${install.packageDir}（${install.version}，${install.manager}）`);
  const extras = extrasOf(effectiveBundles(config.customBundles, config.bundleExtras), config.bundleExtras);
  if (extras.length) {
    const byBundle = new Map();
    for (const entry of extras) byBundle.set(entry.bundle, [...(byBundle.get(entry.bundle) ?? []), entry.name]);
    console.log(`自动归类：${[...byBundle].map(([id, list]) => `${id}(${list.length})`).join(' ')}`);
  }
  const snapshot = readSnapshot();
  if (!snapshot) {
    console.log(`工具快照：无（${SNAPSHOT_PATH}）—— 运行 node src/cli.mjs snapshot 生成，设置页会读它`);
  } else {
    const stale = snapshot.lite !== config.lite || snapshot.shortDesc !== (config.shortDescription !== false);
    console.log(
      `工具快照：${snapshot.toolCount} 个工具，${snapshot.generatedAt}${stale ? '（与当前裁剪设置不一致，建议重新生成）' : ''}`,
    );
    if (snapshot.toolCount !== undefined) {
      const undefinedExtras = [];
      const known = new Set(snapshot.tools.map((tool) => tool.name));
      for (const entry of extras) if (!known.has(entry.name)) undefinedExtras.push(entry);
      if (undefinedExtras.length) {
        console.log(`注意：自动归类里有当前快照中不存在的工具（${undefinedExtras.map((e) => e.name).join(', ')}），可能已过期`);
      }
    }
  }
}

/** 起一个短命 REA 会话取工具列表（CLI 的 snapshot/list/classify/doctor 共用）。 */
async function fetchTools(config, opts = {}) {
  const { tools } = await probeTools(config.child, opts);
  return tools;
}

/** 只取当前 REA 版本的工具名，用于校验自定义族里写的工具是否存在。 */
async function fetchToolNames() {
  try {
    return (await fetchTools(loadConfig())).map((tool) => tool.name);
  } catch {
    // 取不到就不校验工具名（normalizeCustomBundle 收到空数组时跳过存在性检查）。
    return [];
  }
}

/** 生成/刷新工具成本快照（设置页读它来算每个族的 token 成本）。 */
async function writeToolsSnapshot() {
  const config = loadConfig();
  process.stdout.write('正在启动 REA 取工具列表…\n');
  const tools = await fetchTools(config);
  const snapshot = buildSnapshot(tools, config);
  writeSnapshot(snapshot);
  console.log(`已写入快照：${SNAPSHOT_PATH}`);
  console.log(
    `工具 ${snapshot.toolCount} 个；全量约 ${snapshot.totalTokens} tok，元工具 ${snapshot.metaTokens} tok` +
      `；schema 裁剪 ${snapshot.lite}${snapshot.unassigned.length ? `；未归族：${snapshot.unassigned.join(', ')}` : ''}`,
  );
  return snapshot;
}

async function printBundles(live) {
  const config = loadConfig();
  const active = config.activeBundles;
  let tools = [];
  if (live) {
    try { tools = await fetchTools(config); } catch (error) { console.log(`（取实时工具列表失败：${error.message}，仅显示静态统计）`); }
  }
  const names = tools.map((t) => t.name);
  const cost = (list) => estimateTokens(
    tools.filter((t) => list.includes(t.name)).map((t) => projectTool(t, { lite: config.lite })),
  );
  const table = effectiveBundles(config.customBundles, config.bundleExtras);
  console.log(`REA 工具 ${tools.length || '?'} 个；当前加载：${active.length ? active.join(', ') : '（无，仅元工具）'}\n`);
  if (!names.length) {
    for (const [name, def] of Object.entries(table)) {
      const isActive = active.includes(name) || active.includes(ALL_BUNDLE);
      const tag = def.custom ? '（自定义）' : '';
      console.log(`${isActive ? '●' : '○'} ${name.padEnd(9)} ${String(def.tools.length).padStart(3)} 个  ${'—'.padStart(9)}  ${def.label}${tag}`);
    }
  } else {
    for (const b of describeBundles(names, cost, table)) {
      const isActive = active.includes(b.name) || active.includes(ALL_BUNDLE);
      const tag = b.custom ? '（自定义）' : '';
      console.log(`${isActive ? '●' : '○'} ${b.name.padEnd(9)} ${String(b.toolCount).padStart(3)} 个  ${`~${b.estTokens} tok`.padStart(9)}  ${b.label}${tag}`);
      if (b.hint) console.log(`  ${' '.repeat(9)} ${b.hint}`);
      if (b.missing.length) console.log(`  ${' '.repeat(9)} 当前 REA 版本没有：${b.missing.join(', ')}`);
    }
  }
  if (names.length) {
    const restNames = unassignedTools(names, table);
    if (restNames.length) console.log(`\n未归族：${restNames.join(', ')}\n用 node src/cli.mjs classify 看建议`);
  }
  console.log(`\n用法：node src/cli.mjs use <族名…> | all | none | list | status | snapshot | classify | check | doctor`);
}

// ── classify：把未归族的新工具自动归类 ──────────────────────────────────────

async function runClassify() {
  const config = loadConfig();
  process.stdout.write('正在启动 REA 取工具列表…\n');
  const tools = await fetchTools(config);
  const table = effectiveBundles(config.customBundles, config.bundleExtras);
  const result = classifyTools(tools, { defs: table });

  // --set 是「手工指定归类」，与「有没有未归族工具」无关：
  // 用户完全可能想把一个已经归族的工具也补进另一个族（内置族本来就有 6 个工具重复收录）。
  // 所以这条分支必须在「无未归族 → return」之前处理，否则最常见的用法会被静默吞掉。
  if (flag('--set')) {
    // 显式指定归类：--set tool=bundle,tool2=bundle2
    const pairs = (arg('--set') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    // manual 的形状必须是 { 工具名: 族 id } —— applyClassify（面板/元工具共用）就是这么读的。
    // 第一版在这里攒成 { 族: [工具] }，结果被当成「工具名 = 族名」判未知族，静默写不进去。
    const manual = {};
    for (const pair of pairs) {
      const [toolName, bundleId] = pair.split('=').map((value) => value?.trim());
      if (!toolName || !bundleId) continue;
      if (table[bundleId] === undefined) throw new Error(`未知功能族：${bundleId}`);
      manual[toolName] = bundleId;
    }
    if (Object.keys(manual).length === 0) {
      // 空 --set 是「打错参数」而不是「什么都不写」：静默成功最容易被误以为生效了。
      console.error('--set 需要 tool=bundle 对，例如 --set inspect_x=capture,xrefs=native');
      process.exit(1);
    }
    const applied = await applyClassify(config, { tools, manual });
    console.log(`已写入 ${applied.written} 个手工归类到 config.bundleExtras（${Object.keys(applied.extras).join(', ')}）。`);
    console.log('接着跑 node src/cli.mjs snapshot 刷新快照，面板上的族成本才会跟上。');
    return;
  }

  if (result.counts.total === 0) {
    console.log(`当前 REA 的 ${tools.length} 个工具全部归族，无需处理。`);
    console.log('（想把某个工具补进另一族？用 node src/cli.mjs classify --set tool=bundle）');
    return;
  }

  console.log(`当前 REA 有 ${tools.length} 个工具，其中 ${result.counts.total} 个未归族：\n`);
  for (const entry of result.assignments) {
    const tag = entry.confidence === 'high' ? '高' : entry.confidence === 'medium' ? '中' : '低';
    const target = entry.suggested ?? '（无建议）';
    const others = entry.candidates.filter((c) => c.id !== entry.suggested).slice(0, 2).map((c) => c.id);
    console.log(`  ${entry.name.padEnd(34)} → ${target.padEnd(9)} [置信度 ${tag}${others.length ? ` · 候选 ${others.join('/')}` : ''}]`);
  }

  const confident = result.assignments.filter((entry) => entry.suggested !== null && entry.confidence === 'high');
  const uncertain = result.assignments.filter((entry) => entry.suggested === null || entry.confidence !== 'high');

  if (uncertain.length > 0) {
    console.log(`\n需要人工/模型判断的 ${uncertain.length} 个。把下面这段贴给 DSH 里的模型，让它回 JSON 后再用 --set 写入：\n`);
    console.log(buildClassifierPrompt(result.assignments, { defs: table }));
  }

  if (flag('--apply')) {
    if (confident.length === 0) {
      console.log('\n没有高置信度的工具可自动写入。用 --set 指定，或按上面的题面让模型判断。');
      return;
    }
    // 与面板、元工具走同一份写入实现（maintenance.applyClassify），避免三处判断分叉。
    const applied = await applyClassify(config, { tools });
    console.log(`\n已写入 ${applied.written} 个高置信度归类到 config.bundleExtras（运行中的代理会热更新）。`);
    console.log('接着跑 node src/cli.mjs snapshot 刷新快照，面板上的族成本才会跟上。');
    return;
  }

  console.log('\n这一步只做展示。写入用：--apply（高置信度自动写）或 --set tool=bundle,…（手工指定）。');
}

// ── check / doctor：更新与覆盖体检 ──────────────────────────────────────────

async function runCheck() {
  const config = loadConfig();
  console.log('== 本仓库 ==');
  const self = checkSelfUpdate({ root: ROOT, remote: config.updates?.self?.remote ?? 'origin' });
  if (!self.ok) console.log(`  无法检查：${self.reason}`);
  else if (self.fetchError) console.log(`  取远端失败：${self.fetchError}`);
  else if (self.available) {
    console.log(`  ${self.branch} 落后 ${self.upstream} ${self.behind} 个提交（本地领先 ${self.ahead}）${self.fastForwardable ? '，可快进' : '，需人工处理'}`);
    for (const line of self.commits.slice(0, 10)) console.log(`    ${line}`);
  } else console.log(`  已是最新（${self.upstream ?? self.branch} ${self.head}）${self.dirty ? '；工作区有未提交改动' : ''}`);

  console.log('\n== REA 本体 ==');
  const rea = await checkReaUpdate({ child: config.child, registry: config.updates?.rea?.registry });
  if (rea.install?.found) console.log(`  已安装 ${rea.installed}（${rea.install.manager} @ ${rea.install.envDir}）`);
  else console.log(`  找不到安装：${rea.install?.reason ?? '未知'}`);
  if (rea.registryError) console.log(`  ${rea.registryError}`);
  else if (rea.updateAvailable) console.log(`  npm 上有新版 ${rea.latest}${rea.nextStep ? `\n  ${rea.nextStep}` : ''}`);
  else console.log(`  npm 最新 ${rea.latest}，无需升级`);

  console.log('\n== 工具覆盖 ==');
  const coverage = await collectCoverage(config);
  printCoverage(coverage);
}

async function collectCoverage(config) {
  let toolNames = [];
  let liveError = null;
  try {
    toolNames = (await fetchTools(config)).map((tool) => tool.name);
  } catch (error) {
    liveError = error.message;
  }
  const snapshot = readSnapshot();
  if (toolNames.length === 0 && snapshot) {
    // REA 起不来时退到快照：至少能回答「族清单与上一次快照的差集」。结论要标明来源。
    toolNames = snapshot.tools.map((tool) => tool.name);
  }
  const table = effectiveBundles(config.customBundles, config.bundleExtras);
  return {
    source: liveError === null ? 'live' : `snapshot（REA 未响应：${liveError}）`,
    ...checkToolCoverage({ toolNames, defs: table, extras: config.bundleExtras }),
  };
}

function printCoverage(coverage) {
  console.log(`  来源：${coverage.source}；当前 ${coverage.total} 个工具，已归族 ${coverage.assigned} 个`);
  if (coverage.unassigned.length) {
    console.log(`  未归族（REA 有、族清单没收录）：${coverage.unassigned.length} 个`);
    console.log(`    ${coverage.unassigned.slice(0, 30).join(', ')}${coverage.unassigned.length > 30 ? ' …' : ''}`);
  }
  if (coverage.missingForLocal.length) {
    console.log(`  族清单有但本地 REA 没有（本地 REA 偏旧）：${coverage.missingForLocal.length} 个`);
    console.log(`    ${coverage.missingForLocal.slice(0, 30).join(', ')}${coverage.missingForLocal.length > 30 ? ' …' : ''}`);
  }
  if (coverage.deadExtras.length) {
    console.log(`  自动归类里的死条目：${coverage.deadExtras.map((e) => `${e.name}(${e.bundle})`).join(', ')}`);
  }
  if (coverage.healthy) console.log('  全部工具都已归族，且没有过期条目。');
  if (coverage.hint) console.log(`  建议：${coverage.hint}`);
}

// ── 分派 ────────────────────────────────────────────────────────────────────

if (command === 'status' || !command) printStatus();
else if (command === 'list') await printBundles(true);
else if (command === 'list-static') await printBundles(false);
else if (command === 'snapshot') await writeToolsSnapshot();
else if (command === 'classify') await runClassify();
else if (command === 'check') await runCheck();
else if (command === 'doctor') {
  console.log('== REA 工具覆盖体检 ==');
  printCoverage(await collectCoverage(loadConfig()));
}
else if (command === 'update-self') {
  const config = loadConfig();
  const check = checkSelfUpdate({ root: ROOT, remote: config.updates?.self?.remote ?? 'origin' });
  if (!flag('--apply')) {
    console.log(`检查：${check.ok ? (check.available ? `落后 ${check.behind} 个提交` : '已是最新') : check.reason}`);
    for (const line of check.commits ?? []) console.log(`  ${line}`);
    if (check.available) console.log('\n加 --apply 执行快进（git merge --ff-only）。');
    process.exit(0);
  }
  const result = applySelfUpdate(check, { root: ROOT });
  console.log(result.ok ? `已快进到 ${result.to}：\n${result.output}` : `未更新：${result.reason}`);
  if (result.ok) console.log('\n依赖/插件有变化时重跑一次安装；然后 node src/cli.mjs snapshot 刷新快照。');
  process.exit(result.ok ? 0 : 1);
} else if (command === 'update-rea') {
  const config = loadConfig();
  const check = await checkReaUpdate({ child: config.child, registry: config.updates?.rea?.registry });
  if (!check.ok || check.install?.found !== true) {
    console.log(`无法升级：${check.registryError ?? check.install?.reason ?? '未知原因'}`);
    process.exit(1);
  }
  if (check.registryError && !check.updateAvailable) {
    console.log(`${check.registryError}；本地已安装 ${check.installed}`);
  }
  const result = await applyReaUpdate({
    check,
    version: arg('--version'),
    apply: flag('--apply'),
    onOutput: (text) => process.stdout.write(text),
  });
  if (result.dryRun) {
    console.log(`计划：在 ${result.plan.envDir} 执行 ${result.plan.command}`);
    console.log(`备份：${result.plan.backup}（${result.plan.copied.join(', ') || '无可备份文件'}）`);
    console.log('\n加 --apply 真的执行安装；失败会自动回滚清单。');
    process.exit(0);
  }
  console.log(result.ok ? `已升级 ${result.previous} → ${result.installed ?? result.plan.version}\n${result.nextStep ?? ''}` : `升级失败：${result.reason}`);
  if (!result.ok && result.rollback) console.log(`回滚：${result.rollback}`);
  process.exit(result.ok ? 0 : 1);
} else if (command === 'all') {
  const config = loadConfig();
  saveConfig({ ...config, activeBundles: [ALL_BUNDLE] });
  console.log(`已设为加载全部工具（成本见下方 status；当前 REA 版本的工具数以内置快照为准）。`);
} else if (command === 'none' || command === 'gateway') {
  const config = loadConfig();
  saveConfig({ ...config, activeBundles: [] });
  console.log('已设为仅元工具（上下文成本约 0.4k tok，全部工具仍可通过 call_tool 调用）。');
} else if (command === 'use') {
  const config = loadConfig();
  const table = effectiveBundles(config.customBundles, config.bundleExtras);
  const requested = rest.filter((name) => name !== ALL_BUNDLE);
  const unknown = requested.filter((name) => !table[name]);
  if (unknown.length) {
    console.error(`未知功能族：${unknown.join(', ')}\n已知：${Object.keys(table).join(', ')}, ${ALL_BUNDLE}`);
    process.exit(1);
  }
  saveConfig({ ...config, activeBundles: [...new Set(rest)] });
  console.log(`已设为加载：${[...new Set(rest)].join(', ') || '（无）'}。DSH 在运行时将自动热更新。`);
} else if (command === 'bundles' || command === 'custom') {
  // 自定义族管理：node src/cli.mjs custom <list|add|remove>
  const sub = rest[0] ?? 'list';
  const config = loadConfig();
  if (sub === 'list') {
    const custom = config.customBundles ?? {};
    const ids = Object.keys(custom);
    if (!ids.length) console.log('还没有自定义功能族。\n用：node src/cli.mjs custom add --id my-re --label "我的常用" --tools a,b,c');
    else for (const id of ids) console.log(`${id.padEnd(16)} ${String(custom[id].tools?.length ?? 0).padStart(3)} 个  ${custom[id].label ?? id}`);
  } else if (sub === 'add') {
    const known = await fetchToolNames();
    const normalized = normalizeCustomBundle(
      { id: arg('--id'), label: arg('--label'), hint: arg('--hint'), tools: (arg('--tools') ?? '').split(',').map((t) => t.trim()).filter(Boolean) },
      known,
    );
    saveConfig({ ...config, customBundles: { ...(config.customBundles ?? {}), [normalized.id]: { label: normalized.label, hint: normalized.hint, tools: normalized.tools } } });
    console.log(`已保存自定义族 ${normalized.id}（${normalized.tools.length} 个工具）。`);
  } else if (sub === 'remove') {
    const id = rest[1];
    const custom = { ...(config.customBundles ?? {}) };
    if (!custom[id]) {
      console.error(`没有自定义族：${id ?? '(未指定)'}`);
      process.exit(1);
    }
    delete custom[id];
    saveConfig({ ...config, customBundles: custom, activeBundles: config.activeBundles.filter((b) => b !== id) });
    console.log(`已删除自定义族 ${id}。`);
  } else {
    console.error('用法：node src/cli.mjs custom list | add --id <id> [--label <名>] [--hint <说明>] --tools a,b,c | remove <id>');
    process.exit(1);
  }
} else {
  console.error(
    '用法：node src/cli.mjs status | list | use <族名…> | all | none | snapshot\n' +
      '      classify [--apply] [--set tool=bundle,…]   把 REA 新版新增工具归族\n' +
      '      check | doctor                            更新与工具覆盖体检\n' +
      '      update-self [--apply]                     本仓库快进到远端\n' +
      '      update-rea [--apply] [--version x.y.z]    升级 rea-agents',
  );
  process.exit(1);
}
