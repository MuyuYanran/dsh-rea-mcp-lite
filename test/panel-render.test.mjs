// 设置页渲染冒烟测试：用最小 React 运行时**真的重渲染**整页，覆盖「首屏 → 有数据 → 各子区块」路径。
//
// 为什么需要它：`test/plugin.test.mjs` 只渲染首屏（那时 state 还是 null），
// 而「更新与体检」「归类预览」这些区块只在有数据时才执行 —— 那些代码里的
// `report.coverage.unassigned`、`state.updates.self.autoApply` 之类一旦写错，
// 首屏测试一点都发现不了，但用户一打开设置页就白屏。
//
// 这里的假 React 实现了真正的 useState（存值 + 重渲染），所以组件函数会按状态变化反复执行；
// 任何取错属性/未定义变量都会抛出来。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CLIENT = path.join(REPO, 'dsh-plugin', 'lib', 'client.js');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

/** 收集元素树里的纯文本，用来断言「某段文案确实渲染出来了」。 */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
    return out;
  }
  if (node.children) for (const child of node.children) textOf(child, out);
  return out;
}

/** 按属性找元素（placeholder 之类不在文本节点里，textOf 看不到）。 */
function hasProp(node, key, needle) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number' || node === false) return false;
  if (Array.isArray(node)) return node.some((child) => hasProp(child, key, needle));
  if (typeof node.props?.[key] === 'string' && node.props[key].includes(needle)) return true;
  return (node.children ?? []).some((child) => hasProp(child, key, needle));
}

/**
 * 最小 React 运行时：hooks 按调用顺序存进当前渲染态。
 * `render(component, patches)` 先渲染一次，然后依次把 `[槽位, 值]` 写进 hooks 再重渲染，
 * 模拟「数据回来 → setState → 重渲染」这条真实路径。
 */
function makeRuntime() {
  const state = {
    hooks: [],
    index: 0,
    effects: [],
    tree: null,
    renders: 0,
  };

  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });

  const useState = (initial) => {
    const slot = state.index;
    state.index += 1;
    if (state.hooks[slot] === undefined) state.hooks[slot] = typeof initial === 'function' ? initial() : initial;
    const setter = (value) => {
      state.hooks[slot] = typeof value === 'function' ? value(state.hooks[slot]) : value;
    };
    return [state.hooks[slot], setter];
  };
  const useEffect = (fn) => {
    // 每个渲染周期登记一次；调用方保证效果幂等（真 React 靠依赖数组）。
    state.effects.push(fn);
    state.index += 1;
  };
  const useRef = (initial) => {
    const slot = state.index;
    state.index += 1;
    if (state.hooks[slot] === undefined) state.hooks[slot] = { current: initial };
    return state.hooks[slot];
  };
  const useCallback = (fn) => {
    state.index += 1;
    return fn;
  };

  const renderOnce = (component) => {
    state.index = 0;
    state.effects = [];
    state.tree = component();
    state.renders += 1;
    for (const fn of state.effects) {
      try {
        fn();
      } catch {
        // 效果函数里偶发异常（例如订阅不可用）不该让渲染测试失败。
      }
    }
    return state.tree;
  };

  return {
    react: { createElement, useState, useEffect, useRef, useCallback },
    /** @param {Array<Array<[number, any]>>} patches 每项是一次 setState 批次 */
    render(component, patches = [], limit = 60) {
      let tree = renderOnce(component);
      for (const patch of patches) {
        if (state.renders > limit) throw new Error('重渲染次数超限（可能有无限 setState）');
        for (const [slot, value] of patch) state.hooks[slot] = value;
        tree = renderOnce(component);
      }
      return tree;
    },
    get state() { return state; },
  };
}

// ── 载入浏览器半 ────────────────────────────────────────────────────────────

function loadClient() {
  const source = fs.readFileSync(CLIENT, 'utf8');
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { captured = definition; } } },
    document: {
      head: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
    },
    console,
    fetch: () => Promise.reject(new Error('渲染测试里不应发请求')),
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  return captured;
}

const captured = loadClient();
check('浏览器半能被 __ModuleLoader__ 捕获', captured !== null && captured.id === 'dsh-rea-lite-panel');

/** 装配组件；返回组件函数与运行时。 */
function buildComponent() {
  const runtime = makeRuntime();
  // factory 直接返回 module.exports（见 client.js 末尾），不再是 module 包装对象。
  const exported = captured.factory((request) => {
    if (request === 'react') return runtime.react;
    throw new Error(`未预期模块：${request}`);
  });
  let component = null;
  const ctx = {
    effect(fn) { fn(); },
    get: () => undefined,
    slots: { inject: (owner, cb) => cb(), register: (options, comp) => { component = comp; } },
  };
  exported.apply(ctx);
  return { component, runtime };
}

// ── 造状态：没有数据 / 完整数据（正常）/ 完整数据（各处出错） ──────────────

/** hook 槽位顺序（与 ReaLitePage 里的 useState 顺序一致，locale 是 0）。 */
const SLOT = {
  locale: 0,
  state: 1,
  error: 2,
  note: 3,
  busy: 4,
  report: 11, // 见下方 baseState 之后的说明
};

function baseState(overrides = {}) {
  const bundles = [
    {
      id: 'nav', label: '会话与导航', hint: '打开目标、跳转', toolCount: 2, tokens: 120, active: true,
      unavailable: false, definedTools: 2, risky: false, custom: false,
      tools: [{ name: 'address_name', tokens: 60 }, { name: 'xrefs', tokens: 60 }], extras: [],
    },
    {
      id: 'capture', label: '抓包与信号', hint: '读抓包', toolCount: 1, tokens: 80, active: false,
      unavailable: false, definedTools: 2, risky: true, custom: false,
      tools: [{ name: 'inspect_pcap', tokens: 80 }], extras: ['inspect_pcap_reassembly'],
    },
    {
      id: 'my-group', label: '我的常用', hint: '', toolCount: 1, tokens: 40, active: false,
      unavailable: false, definedTools: 1, risky: false, custom: true, tools: [{ name: 'read_bytes', tokens: 40 }], extras: [],
    },
  ];
  return {
    ok: true,
    gatewayRoot: '/gw',
    configPath: '/gw/config.json',
    writable: true,
    mode: 'gateway',
    lite: 'mild',
    metaTools: true,
    activeBundles: ['nav'],
    allActive: false,
    bundles,
    snapshot: { present: true, generatedAt: '2026-10-23T06:00:00.000Z', toolCount: 207, lite: 'mild', stale: false, unassigned: ['inspect_pcap_reassembly'] },
    metaTokens: 541,
    activeTokens: 661,
    totalTokens: 26852,
    savings: 97.5,
    live: { toolCount: 3, tokens: 700 },
    server: { known: true, phase: 'active', toolCount: 3 },
    updates: {
      self: { remote: 'origin', checkOnStart: false, autoApply: false },
      rea: { registry: 'https://registry.npmjs.org/rea-agents', checkOnStart: true, autoApply: false },
    },
    warnings: [],
    ...overrides,
  };
}

const happyReport = {
  ok: true,
  generatedAt: '2026-10-23T06:00:00.000Z',
  source: 'snapshot',
  self: { ok: true, available: true, branch: 'main', upstream: 'origin/main', behind: 2, ahead: 0, dirty: false, fastForwardable: true, head: 'a18ab29', commits: ['a18ab29 某提交', 'b321c07 另一个'] },
  rea: { ok: true, installed: '6.7.0', latest: '6.8.0', updateAvailable: true, install: { found: true, manager: 'pnpm', envDir: '/env' }, nextStep: '装完刷快照' },
  coverage: { source: 'snapshot', total: 208, assigned: 207, unassigned: ['inspect_pcap_reassembly'], missingForLocal: [], deadExtras: [], healthy: false, hint: '去归类' },
  extras: [{ name: 'inspect_pcap_reassembly', bundle: 'capture' }],
  updates: { self: { checkOnStart: false }, rea: { checkOnStart: true } },
  summary: '本仓库落后 2 个提交；REA 有新版 6.7.0 → 6.8.0；1 个工具未归族',
};

const happyClassify = {
  ok: true,
  counts: { total: 1, assigned: 1, unclassified: 0 },
  assignments: [{ name: 'inspect_pcap_reassembly', suggested: 'capture', confidence: 'high', score: 5, candidates: ['capture', 'runtime'] }],
  applyable: 1,
};

/**
 * 找出 hook 槽位：不靠手数，直接按组件里 useState 的调用顺序推导。
 * 顺序来自 ReaLitePage 源码：locale, state, error, note, busy, query, matches,
 * expanded, editing, draftId, draftLabel, draftTools, customError, allTools,
 * toolFilter, pickedBundle, report, maintBusy, maintLog, maintError, classify, maintLive,
 * presetName, presetNote, presetError。
 * 新 state 一律追加在末尾（插在中间会让后面所有槽位错位，已经踩过一次）。
 */
const HOOK = {
  locale: 0,
  state: 1,
  error: 2,
  note: 3,
  busy: 4,
  query: 5,
  matches: 6,
  expanded: 7,
  editing: 8,
  draftId: 9,
  draftLabel: 10,
  draftTools: 11,
  customError: 12,
  allTools: 13,
  toolFilter: 14,
  pickedBundle: 15,
  report: 16,
  maintBusy: 17,
  maintLog: 18,
  maintError: 19,
  classify: 20,
  maintLive: 21,
  presetName: 22,
  presetNote: 23,
  presetError: 24,
};

// ── 1. 首屏（state=null） ───────────────────────────────────────────────────

console.log('\n首屏');
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component);
  check('首屏渲染成 realp-root', tree !== null && tree.props.className === 'realp-root');
  check('首屏显示「正在读取状态」', textOf(tree).join(' ').includes('正在读取状态'));
}

// ── 2. 有状态但还没检查过更新（report=null） ────────────────────────────────

console.log('\n有状态、未检查更新');
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component, [[[HOOK.state, baseState()]]]);
  const text = textOf(tree).join(' ');
  check('渲染出功能族列表', text.includes('会话与导航') && text.includes('抓包与信号'));
  check('渲染出「更新与体检」标题', text.includes('更新与体检'));
  check('未检查时给出检查按钮文案', text.includes('检查更新'));
  check('显示配置写入路径', text.includes('/gw/config.json'));
  check('未检查时不渲染结论卡片（未访问 coverage）', !text.includes('工具覆盖'));
}

// ── 3. 完整数据（正常路径） ─────────────────────────────────────────────────

console.log('\n完整数据（正常）');
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component, [
    [[HOOK.state, baseState()]],
    [[HOOK.report, happyReport]],
    [[HOOK.classify, happyClassify]],
  ]);
  const text = textOf(tree).join(' ');
  check('渲染出一句话结论', text.includes('本仓库落后 2 个提交'));
  check('渲染出本仓库卡片与提交列表', text.includes('a18ab29 某提交'));
  check('渲染出 REA 安装与最新版', text.includes('6.7.0') && text.includes('6.8.0'));
  check('渲染出工具覆盖数字', text.includes('208'));
  check('渲染出未归族工具名', text.includes('inspect_pcap_reassembly'));
  check('渲染出归类建议与置信度', text.includes('capture') && text.includes('高'));
  check('渲染出「写入高置信度归类」按钮', text.includes('写入高置信度归类'));
  check('渲染出更新开关', text.includes('启动时自动检查') && text.includes('启动时自动应用'));
  check('页面渲染没有抛错', true);
}

// ── 4. 各区块出错时的降级路径 ───────────────────────────────────────────────

console.log('\n出错降级');
{
  const broken = {
    ok: true,
    source: 'snapshot（REA 未响应：spawn failed）',
    self: { ok: false, reason: '这个目录不是 git 仓库' },
    rea: { ok: false, reason: '取 npm registry 失败：ENOTFOUND', registryError: '取 npm registry 失败：ENOTFOUND', install: { found: false, reason: '找不到安装位置' } },
    coverage: { source: 'snapshot', total: 3, assigned: 0, unassigned: ['a', 'b', 'c'], missingForLocal: ['x', 'y'], deadExtras: [{ name: 'z', bundle: 'nav' }], healthy: false },
    summary: '本仓库无法检查：这个目录不是 git 仓库；3 个工具未归族',
  };
  const { component, runtime } = buildComponent();
  const state = baseState({ updates: undefined, writable: false, bundles: [] });
  const tree = runtime.render(component, [
    [[HOOK.state, state]],
    [[HOOK.report, broken]],
    [[HOOK.classify, { ok: true, counts: { total: 0 }, assignments: [], applyable: 0 }]],
  ]);
  const text = textOf(tree).join(' ');
  check('仓库不可用时渲染原因而不是崩', text.includes('这个目录不是 git 仓库'));
  check('registry 失败时渲染原因', text.includes('registry'));
  check('没有 updates 字段时开关不崩', text.includes('启动时自动检查'));
  check('不可写时提示只能查看', text.includes('只能查看'));
  check('没有未归族时渲染「没有未归族的工具」', text.includes('没有未归族的工具'));
}

// ── 5. report 整体失败（ok:false） ─────────────────────────────────────────

console.log('\n报告整体失败');
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component, [
    [[HOOK.state, baseState()]],
    [[HOOK.report, { ok: false, reason: '找不到 rea-mcp-lite 网关' }]],
  ]);
  const text = textOf(tree).join(' ');
  check('report.ok=false 时显示错误文案', text.includes('找不到 rea-mcp-lite 网关'));
  check('此时不再访问 coverage（不崩）', true);
}

// ── 6. 报错态与提示态 ──────────────────────────────────────────────────────

console.log('\n报错/提示态');
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component, [
    [[HOOK.state, baseState()]],
    [[HOOK.error, '保存失败：配置不可写']],
    [[HOOK.note, '已保存，代理已热切换。']],
  ]);
  const text = textOf(tree).join(' ');
  check('error 渲染成红色提示', text.includes('保存失败：配置不可写'));
  check('note 渲染成成功提示', text.includes('已保存，代理已热切换'));
}

// ── 7. 预设区块（有数据 / 旧宿主没有这个字段） ──────────────────────────────

console.log('\n预设');
{
  const { component, runtime } = buildComponent();
  const preset = (overrides) => ({
    name: 'x', label: '', note: '', savedAt: '2026-10-24T10:00:00.000Z', activeBundles: [], applied: [],
    missing: [], unavailable: [], toolCount: 0, tokens: 0, lite: null, shortDescription: null, metaTools: null,
    current: false, ...overrides,
  });
  const tree = runtime.render(component, [
    [
      [
        HOOK.state,
        baseState({
          presets: [
            preset({ name: '原生深挖', label: '原生深挖', note: 'native 为主', applied: ['nav'], toolCount: 2, tokens: 661, lite: 'mild', current: true }),
            preset({ name: '旧的', savedAt: '2026-10-01T10:00:00.000Z', missing: ['my-group'], unavailable: ['capture'] }),
          ],
        }),
      ],
    ],
  ]);
  const text = textOf(tree).join(' ');
  check('渲染出预设区块与说明', text.includes('存成一套带名字的方案'));
  check('渲染出预设名与备注', text.includes('原生深挖') && text.includes('native 为主'));
  check('当前生效的预设有标记', text.includes('当前生效'));
  check('保存时间渲染成可读形式', text.includes('2026-10-24 10:00'));
  check('渲染出读取时间那行的族清单', text.includes('nav'));
  check('引用的族已不存在时标出来', text.includes('引用的族已不存在') && text.includes('my-group'));
  check('这一版 REA 没这族时标出来', text.includes('这一版 REA 没有这些族的工具') && text.includes('capture'));
  check('渲染出读取/删除按钮', text.includes('读取') && text.includes('删除'));
  check('渲染出保存按钮与名字输入框', text.includes('存下当前勾选') && hasProp(tree, 'placeholder', '预设名'));
}
{
  // 旧宿主半不返回 presets：必须按空列表渲染（取错属性 = 白屏）。
  const { component, runtime } = buildComponent();
  const legacy = baseState();
  delete legacy.presets;
  const tree = runtime.render(component, [[[HOOK.state, legacy]]]);
  const text = textOf(tree).join(' ');
  check('宿主半没返回 presets 时按空列表渲染', text.includes('还没有预设') && !text.includes('undefined'));
}
{
  const { component, runtime } = buildComponent();
  const tree = runtime.render(component, [[[HOOK.state, baseState({ presets: [] })]], [[HOOK.presetError, '预设名不能含 /']]]);
  check('预设错误渲染成红色提示', textOf(tree).join(' ').includes('预设名不能含 /'));
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
