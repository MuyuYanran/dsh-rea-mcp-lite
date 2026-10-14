#!/usr/bin/env node
// 命令行开关：改 config.json 里的 activeBundles。
// 若 DSH 正在运行，代理会监听 config.json 并立刻热更新工具列表（无需重启）。
import { spawn } from 'node:child_process';
import { BUNDLES, ALL_BUNDLE, describeBundles, unassignedTools } from './bundles.mjs';
import { projectTool, estimateTokens } from './lite.mjs';
import { loadConfig, saveConfig, CONFIG_PATH } from './config.mjs';
import { buildSnapshot, writeSnapshot, readSnapshot, SNAPSHOT_PATH, tokensOfChars } from './snapshot.mjs';

const [command, ...rest] = process.argv.slice(2);

function printStatus() {
  const config = loadConfig();
  const active = config.activeBundles.length ? config.activeBundles.join(', ') : '（无，仅元工具）';
  console.log(`配置文件：${CONFIG_PATH}`);
  console.log(`当前加载：${active}`);
  console.log(`schema 裁剪：${config.lite}   元工具：${config.metaTools ? '开' : '关'}`);
  console.log(`REA 启动命令：${config.child.command} ${config.child.args.join(' ')}`);
  const snapshot = readSnapshot();
  if (!snapshot) {
    console.log(`工具快照：无（${SNAPSHOT_PATH}）—— 运行 node src/cli.mjs snapshot 生成，设置页会读它`);
  } else {
    const stale = snapshot.lite !== config.lite || snapshot.shortDesc !== (config.shortDescription !== false);
    console.log(
      `工具快照：${snapshot.toolCount} 个工具，${snapshot.generatedAt}${stale ? '（与当前裁剪设置不一致，建议重新生成）' : ''}`,
    );
  }
}

/** 起一个短命的 REA 会话，拿到真实工具列表用于估算 token 成本。 */
async function fetchTools(config) {
  return await new Promise((resolve, reject) => {
    const child = spawn(config.child.command, config.child.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.child.env },
      windowsHide: true,
    });
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('超时')); }, 60000);
    child.on('error', reject);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 'i' && msg.result) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'l', method: 'tools/list', params: {} }) + '\n');
        }
        if (msg.id === 'l') {
          clearTimeout(timer);
          child.kill();
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result.tools ?? []);
        }
      }
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 'i', method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rea-mcp-lite-cli', version: '0.1.0' } },
    }) + '\n');
  });
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
  console.log(`REA 工具 ${tools.length || '?'} 个；当前加载：${active.length ? active.join(', ') : '（无，仅元工具）'}\n`);
  if (!names.length) {
    for (const [name, def] of Object.entries(BUNDLES)) {
      const isActive = active.includes(name) || active.includes(ALL_BUNDLE);
      console.log(`${isActive ? '●' : '○'} ${name.padEnd(9)} ${String(def.tools.length).padStart(3)} 个  ${'—'.padStart(9)}  ${def.label}`);
    }
  } else {
    for (const b of describeBundles(names, cost)) {
      const isActive = active.includes(b.name) || active.includes(ALL_BUNDLE);
      console.log(`${isActive ? '●' : '○'} ${b.name.padEnd(9)} ${String(b.toolCount).padStart(3)} 个  ${`~${b.estTokens} tok`.padStart(9)}  ${b.label}`);
      if (b.hint) console.log(`  ${' '.repeat(9)} ${b.hint}`);
    }
  }
  if (names.length) {
    const rest = unassignedTools(names);
    if (rest.length) console.log(`\n未归族：${rest.join(', ')}`);
  }
  console.log(`\n用法：node src/cli.mjs use <族名…> | all | none | list | status | snapshot`);
}

if (command === 'status' || !command) printStatus();
else if (command === 'list') await printBundles(true);
else if (command === 'list-static') await printBundles(false);
else if (command === 'snapshot') await writeToolsSnapshot();
else if (command === 'all') {
  const config = loadConfig();
  saveConfig({ ...config, activeBundles: [ALL_BUNDLE] });
  console.log('已设为加载全部 170 个工具（上下文成本约 48k tok）。');
} else if (command === 'none' || command === 'gateway') {
  const config = loadConfig();
  saveConfig({ ...config, activeBundles: [] });
  console.log('已设为仅元工具（上下文成本约 0.4k tok，全部工具仍可通过 call_tool 调用）。');
} else if (command === 'use') {
  const requested = rest.filter((name) => name !== ALL_BUNDLE);
  const unknown = requested.filter((name) => !BUNDLES[name]);
  if (unknown.length) {
    console.error(`未知功能族：${unknown.join(', ')}\n已知：${Object.keys(BUNDLES).join(', ')}, ${ALL_BUNDLE}`);
    process.exit(1);
  }
  const config = loadConfig();
  saveConfig({ ...config, activeBundles: [...new Set(rest)] });
  console.log(`已设为加载：${[...new Set(rest)].join(', ') || '（无）'}。DSH 在运行时将自动热更新。`);
} else {
  console.error('用法：node src/cli.mjs status | list | use <族名…> | all | none | snapshot');
  process.exit(1);
}
