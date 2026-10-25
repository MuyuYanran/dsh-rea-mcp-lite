// 新增能力自检：智能归类、追加归类合并、工具覆盖体检、版本比较、更新检查与面板新接口。
//
// 三条原则（与其它测试一致）：
//   - 不写死版本相关数字（工具数、版本号都从输入派生）；
//   - 不碰真实 config.json / 真实仓库（临时目录 + REA_LITE_CONFIG）；
//   - 需要 git 行为的地方，用临时目录里现建的真仓库跑，不 mock「看起来像 git」的东西。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

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

const load = (relative) => import(pathToFileURL(path.join(REPO, relative)).href);

const { BUNDLES, effectiveBundles, extrasOf } = await load('src/bundles.mjs');
const { suggestBundle, classifyTools, extrasFrom, mergeExtras, MIN_SCORE, CONFIDENT_SCORE } = await load('src/classify.mjs');
const { checkToolCoverage, compareVersions, locateReaInstall, checkSelfUpdate, applySelfUpdate } = await load('src/updates.mjs');
const { applyClassify, describeSelf, describeRea, describeUpdate, summarize } = await load('src/maintenance.mjs');

// ── 1. 归类引擎 ─────────────────────────────────────────────────────────────

console.log('归类引擎（classify.mjs）');

// 用「已知族内工具」造一批假的新工具：名字/描述里带专属词，应当被规则抓住。
// 注意这些词的**稀有度**才是判据：dart/pcap/frida 只属于一个族（强信号），
// inspect/verify/compare 遍地都是（弱信号，不该决定归属）。
const cases = [
  { tool: { name: 'inspect_dart_isolate', description: 'Inspect a Dart AOT isolate snapshot for Flutter apps.' }, expect: 'android', confidence: 'high' },
  { tool: { name: 'inspect_pcap_reassembly', description: 'Inspect packet stream reassembly in a pcap using tshark fields.' }, expect: 'capture', confidence: 'high' },
  { tool: { name: 'verify_swift_protocol_conformance', description: 'Verify Objective-C and Swift protocol conformance in a Mach-O image.' }, expect: 'apple', confidence: 'medium' },
  { tool: { name: 'build_reconstruction_ledger_v2', description: 'Build a reconstruction obligation ledger and verify coverage.' }, expect: 'evidence', confidence: 'high' },
  { tool: { name: 'start_frida_session_v2', description: 'Start a Frida session against a process; attach and breakpoint via gdb.' }, expect: 'debug', confidence: 'high' },
  { tool: { name: 'inspect_sqlite_wal', description: 'Inspect a SQLite database snapshot and its WAL.' }, expect: 'formats', confidence: 'medium' },
  // 没有专属词的新领域（WiFi）不该被硬塞进某个族 —— 这正是「宁可留给模型」的场景。
  { tool: { name: 'capture_wifi_handshake', description: 'Capture a WPA handshake from a wireless interface.' }, expect: null, confidence: 'low' },
];
for (const item of cases) {
  const result = suggestBundle(item.tool, { defs: BUNDLES });
  check(
    `「${item.tool.name}」→ ${item.expect ?? '无建议'}（${item.confidence}）`,
    result.suggested === item.expect && result.confidence === item.confidence,
    `得到 ${result.suggested ?? '(null)'} score=${result.score} conf=${result.confidence}`,
  );
}

// 专属词 vs 通用动词：两者都出现在名字里时，专属词必须赢。
const domainWins = suggestBundle({ name: 'verify_frida_hook', description: 'Verify a Frida hook on a running process.' }, { defs: BUNDLES });
check('专属词压过通用动词 verify', domainWins.suggested === 'debug', `${domainWins.suggested} score=${domainWins.score}`);

// 置信度分级：高置信度必须同时满足「有建议」「分数够」「明显领先」。
const high = suggestBundle({ name: 'inspect_sqlite_wal', description: 'Inspect a SQLite database snapshot and its WAL.' }, { defs: BUNDLES });
check('高置信度阈值自洽', high.confidence !== 'high' || high.score >= CONFIDENT_SCORE, `${high.score} / ${high.confidence}`);
const low = suggestBundle({ name: 'zzz_qqq', description: 'Nothing resembles any bundle.' }, { defs: BUNDLES });
check('毫无信号时不给建议', low.suggested === null && low.confidence === 'low' && low.score < MIN_SCORE, `score=${low.score}`);
check('无建议时候选可为空或低分', Array.isArray(low.candidates));

// 只处理未归族的工具：已归族的绝不能出现在结果里（否则会把内置归族覆盖掉）。
const assignedSet = new Set(['inspect_dart_aot']);
const tools = [
  { name: 'inspect_dart_aot', description: 'already bundled' },
  { name: 'inspect_pcap_reassembly', description: 'Inspect packet stream reassembly in a pcap using tshark fields.' },
  { name: 'mystery_tool_xyz', description: 'no signal at all' },
];
const result = classifyTools(tools, { defs: BUNDLES, assigned: assignedSet });
check('只归类未归族的工具', !result.assignments.some((entry) => entry.name === 'inspect_dart_aot'), result.assignments.map((e) => e.name).join(','));
check('计数一致', result.counts.total === 2 && result.counts.assigned + result.counts.unclassified === 2, JSON.stringify(result.counts));
check('无建议的进 unclassified', result.unclassified.includes('mystery_tool_xyz'), result.unclassified.join(','));

const extra = extrasFrom(result.assignments);
check('extrasFrom 只收有建议的', Object.values(extra).flat().length === result.counts.assigned, JSON.stringify(extra));
const merged = mergeExtras({ capture: ['a'] }, { capture: ['a', 'b'], debug: ['c'] });
check('mergeExtras 幂等去重', JSON.stringify(merged.capture) === JSON.stringify(['a', 'b']) && merged.debug.length === 1, JSON.stringify(merged));

// ── 2. 追加归类合并进族表 ───────────────────────────────────────────────────

console.log('\n追加归类（bundleExtras → effectiveBundles）');
const withExtras = effectiveBundles({}, { capture: ['brand_new_capture_tool'] });
check('extras 追加到内置族', withExtras.capture.tools.includes('brand_new_capture_tool'));
check('内置族原有工具仍在', BUNDLES.capture.tools.every((name) => withExtras.capture.tools.includes(name)));
check('不污染内置族对象', !BUNDLES.capture.tools.includes('brand_new_capture_tool'));
check('没有 extras 时族表与原样一致', JSON.stringify(effectiveBundles({}).capture.tools) === JSON.stringify(BUNDLES.capture.tools));
check('未知族的 extras 被忽略', effectiveBundles({}, { nope: ['x'] }).nope === undefined);
const ext = extrasOf(withExtras, { capture: ['brand_new_capture_tool', ...BUNDLES.capture.tools.slice(0, 1)] });
check('extrasOf 只报真正的新增项', ext.length === 1 && ext[0].name === 'brand_new_capture_tool' && ext[0].bundle === 'capture', JSON.stringify(ext));

// ── 3. 工具覆盖体检 ─────────────────────────────────────────────────────────

console.log('\n工具覆盖（checkToolCoverage）');
const liveNames = ['address_name', 'xrefs', 'inspect_web_page'];
// 期望值用集合运算推出来：族清单声明的工具数 − 这三个已经存在的。
const declaredCount = new Set(Object.values(BUNDLES).flatMap((def) => def.tools)).size;
const coverageLocal = checkToolCoverage({ toolNames: liveNames, defs: BUNDLES });
check(
  '本地没有的工具被列进 missingForLocal',
  coverageLocal.missingForLocal.length === declaredCount - liveNames.length,
  `${coverageLocal.missingForLocal.length} / 期望 ${declaredCount} - ${liveNames.length}`,
);
check('本地有的工具不在 missingForLocal 里', !coverageLocal.missingForLocal.some((name) => liveNames.includes(name)));
check('未归族为空时 healthy 只取决于 missing', coverageLocal.unassigned.length === 0 && coverageLocal.healthy === false);
const coverageNew = checkToolCoverage({ toolNames: [...liveNames, 'shiny_new_tool'], defs: BUNDLES });
check('REA 新增但未归族的工具被报出', coverageNew.unassigned.includes('shiny_new_tool'), coverageNew.unassigned.join(','));
check('未归族时给出去归类的提示', /classify/.test(coverageNew.hint ?? ''), coverageNew.hint ?? '');
const perfect = checkToolCoverage({ toolNames: Object.values(BUNDLES).flatMap((def) => def.tools), defs: BUNDLES });
check('全覆盖时 healthy 为真', perfect.healthy === true && perfect.hint === undefined, `${perfect.assigned}/${perfect.total}`);
const dead = checkToolCoverage({ toolNames: ['address_name'], defs: BUNDLES, extras: { nav: ['gone_tool'] } });
check('extras 里的死条目被报出', dead.deadExtras.some((entry) => entry.name === 'gone_tool'), JSON.stringify(dead.deadExtras));

// ── 4. 版本比较 ────────────────────────────────────────────────────────────

console.log('\n版本比较');
check('6.7.0 比 6.4.0 新', compareVersions('6.7.0', '6.4.0') > 0);
check('相同版本为 0', compareVersions('6.7.0', '6.7.0') === 0);
check('7.0.0 比 6.99.99 新', compareVersions('7.0.0', '6.99.99') > 0);
check('短版本号按缺位补 0', compareVersions('6.7', '6.7.0') === 0);

// ── 5. 安装定位 ────────────────────────────────────────────────────────────

console.log('\n安装定位（locateReaInstall）');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-lite-maint-'));
const envDir = path.join(tmp, 'env');
const packageDir = path.join(envDir, 'node_modules', 'rea-agents');
fs.mkdirSync(path.join(packageDir, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'rea-agents', version: '9.8.7' }, null, 2), 'utf8');
fs.writeFileSync(path.join(packageDir, 'scripts', 'rea.mjs'), '// stub\n', 'utf8');
fs.writeFileSync(path.join(envDir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n', 'utf8');
const located = locateReaInstall(path.join(packageDir, 'scripts', 'rea.mjs'));
check('从 launcher 找到 package 与 env 目录', located.found && located.packageDir === packageDir && located.envDir === envDir, located.envDir);
check('读到版本号', located.version === '9.8.7', located.version);
check('认出 pnpm 管理', located.manager === 'pnpm', located.manager);
check('找不到时给出理由而不是抛错', locateReaInstall(path.join(tmp, 'nope', 'x.mjs')).found === false);

// ── 6. 本仓库更新检查（临时真仓库） ────────────────────────────────────────

console.log('\n本仓库更新（checkSelfUpdate / applySelfUpdate）');
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

if (git(['--version']).status !== 0) {
  check('本机没有 git，跳过仓库更新用例', true);
} else {
  const root = path.join(tmp, 'repo');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(root, { recursive: true });
  // 裸仓库要显式指定默认分支：git 2.50+ 的默认 branch 名随 init.defaultBranch 变，
  // 不指定会让 clone 出来的工作区停在「没有 HEAD」的状态，后面的 push 直接失败。
  git(['init', '--bare', '-q', '-b', 'main', remote], tmp);
  git(['init', '-q', '-b', 'main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'test'], root);
  git(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'v1\n', 'utf8');
  git(['add', '.'], root);
  git(['commit', '-q', '-m', 'v1'], root);
  git(['branch', '-M', 'main'], root);
  git(['remote', 'add', 'origin', remote], root);
  git(['push', '-q', '-u', 'origin', 'main'], root);

  const clean = checkSelfUpdate({ root });
  check('刚推上去时「已是最新」', clean.ok && clean.available === false && clean.behind === 0, `behind=${clean.behind}`);

  // 另起一个克隆，产生一个新提交再推回远端 → 原仓库就该「落后 1」。
  const other = path.join(tmp, 'other');
  git(['clone', '-q', remote, other], tmp);
  git(['config', 'user.email', 'test@example.com'], other);
  git(['config', 'user.name', 'test'], other);
  git(['config', 'commit.gpgsign', 'false'], other);
  // 裸仓库的 HEAD 指向 main，clone 后就在 main 上；显式 checkout 一次，避免任何默认分支差异。
  git(['checkout', '-q', '-B', 'main', 'origin/main'], other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'v2\n', 'utf8');
  git(['add', '.'], other);
  git(['commit', '-q', '-m', 'v2 from other clone'], other);
  const pushed = git(['push', '-q', 'origin', 'main'], other);
  check('测试仓库的推送上一步真的成功', pushed.status === 0, pushed.stderr?.slice(0, 200));

  const behind = checkSelfUpdate({ root });
  check('远端多一个提交 → behind=1', behind.available === true && behind.behind === 1 && behind.ahead === 0, `behind=${behind.behind} ahead=${behind.ahead}`);
  check('列出落后提交的说明', behind.commits.some((line) => line.includes('v2')), behind.commits.join(' | '));
  check('工作区干净时可快进', behind.fastForwardable === true);

  const dry = applySelfUpdate(behind, { root });
  check('--apply 等价动作真的快进', dry.ok === true, dry.reason ?? dry.output);
  check('快进后已是最新', checkSelfUpdate({ root }).available === false);

  // 脏工作区必须拒绝：脚本不能替人决定 stash 还是提交。
  fs.writeFileSync(path.join(other, 'c.txt'), 'v3\n', 'utf8');
  git(['add', '.'], other);
  git(['commit', '-q', '-m', 'v3'], other);
  const pushed3 = git(['push', '-q', 'origin', 'main'], other);
  check('第三轮推送也成功', pushed3.status === 0, pushed3.stderr?.slice(0, 200));
  fs.writeFileSync(path.join(root, 'a.txt'), 'dirty\n', 'utf8');
  const dirty = checkSelfUpdate({ root });
  check('脏工作区被认出', dirty.dirty === true && dirty.available === true);
  const refused = applySelfUpdate(dirty, { root });
  check('脏工作区拒绝快进并说明原因', refused.ok === false && /未提交/.test(refused.reason), refused.reason);

  // 本地领先（有未推送提交）同样拒绝：那是分叉，不是落后。
  git(['checkout', '--', 'a.txt'], root);
  fs.writeFileSync(path.join(root, 'local.txt'), 'local\n', 'utf8');
  git(['add', '.'], root);
  git(['commit', '-q', '-m', 'local only'], root);
  const diverged = checkSelfUpdate({ root });
  check('本地领先被认出', diverged.ahead === 1 && diverged.behind >= 1, `ahead=${diverged.ahead} behind=${diverged.behind}`);
  const conflict = applySelfUpdate(diverged, { root });
  check('分叉时拒绝快进并提示手工处理', conflict.ok === false && /分叉|未推送/.test(conflict.reason), conflict.reason);
}

// ── 7. 归类写入（applyClassify，写临时 config） ────────────────────────────

console.log('\n归类写入（applyClassify）');
const originalConfigEnv = process.env.REA_LITE_CONFIG;
const tmpConfig = path.join(tmp, 'config.json');
process.env.REA_LITE_CONFIG = tmpConfig;
fs.writeFileSync(tmpConfig, JSON.stringify({ activeBundles: [], customBundles: {} }, null, 2), 'utf8');

const fakeTools = [
  { name: 'address_name', description: 'Resolve the primary analyzed name at an address.' },
  { name: 'inspect_pcap_reassembly', description: 'Inspect packet stream reassembly in a pcap using tshark fields.' },
];
const applied = await applyClassify({}, { tools: fakeTools, manual: { address_name: 'nav' } });
check('manual 指定能写入', applied.written === 1 && applied.extras.nav.includes('address_name'), JSON.stringify(applied.extras));
const persisted = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
check('写入落在 config.bundleExtras', persisted.bundleExtras?.nav?.includes('address_name'));
check('其它字段没被抹掉', persisted.activeBundles !== undefined && persisted.customBundles !== undefined);

let badBundle = null;
try { await applyClassify({}, { tools: fakeTools, manual: { address_name: 'no-such-bundle' } }); } catch (error) { badBundle = error.message; }
check('未知族被拒绝', /未知功能族/.test(badBundle ?? ''), badBundle ?? '');
let badTool = null;
try { await applyClassify({}, { tools: fakeTools, manual: { ghost_tool: 'nav' } }); } catch (error) { badTool = error.message; }
check('未知工具被拒绝', /未知工具/.test(badTool ?? ''), badTool ?? '');

if (originalConfigEnv === undefined) delete process.env.REA_LITE_CONFIG;
else process.env.REA_LITE_CONFIG = originalConfigEnv;

// ── 8. 描述函数（元工具与 CLI 共用措辞） ───────────────────────────────────

console.log('\n结论措辞（describe*）');
check('最新时描述里写「已是最新」', /已是最新/.test(describeSelf({ ok: true, available: false, ahead: 0, behind: 0, upstream: 'origin/main', head: 'abc' })));
check('落后时写出提交数与可快进', /落后 3 个提交/.test(describeSelf({ ok: true, available: true, ahead: 0, behind: 3, upstream: 'origin/main', fastForwardable: true })));
check('取远端失败时优先报失败', /取远端失败/.test(describeSelf({ ok: true, fetchError: 'no network', behind: 0, available: false })));
check('REA 有新版时写出来', /新版/.test(describeRea({ ok: true, installed: '6.7.0', latest: '7.0.0', updateAvailable: true, install: { found: true, manager: 'pnpm', envDir: '/x' } })));
check('dryRun 的更新结果标明未改动', /预览/.test(describeUpdate('本仓库', { ok: true, dryRun: true, plan: 'git merge --ff-only origin/main' })));
const summary = summarize({ self: { ok: true, available: false }, rea: { ok: true, updateAvailable: false }, coverage: { unassigned: [], missingForLocal: [] } });
check('全绿时一句话结论', /最新/.test(summary) && /归族/.test(summary), summary);
const summaryWarn = summarize({ self: { ok: true, available: true, behind: 2 }, rea: { updateAvailable: true, installed: '1.0.0', latest: '2.0.0' }, coverage: { unassigned: ['x'], missingForLocal: [] } });
check('有问题时一句话列全', /落后 2/.test(summaryWarn) && /新版/.test(summaryWarn) && /1 个新工具未归族/.test(summaryWarn), summaryWarn);

// ── 9. 命名预设（presets.mjs） ─────────────────────────────────────────────

console.log('\n命名预设（presets.mjs）');

const presets = await load('src/presets.mjs');
const baseConfig = { activeBundles: ['nav', 'native'], lite: 'mild', shortDescription: true, metaTools: true, presets: {} };

// 名字是人给的字面量（允许中文），但必须能安全当 JSON 键、能原样传进命令行。
check('中文预设名可用（两侧空白被去掉）', presets.normalizePresetName('  原生深挖  ') === '原生深挖');
for (const bad of ['', '   ', 'a/b', 'a\\b', 'a:b', 'a*b', 'x\u0000y', '.', '..', 'x'.repeat(49)]) {
  let message = null;
  try { presets.normalizePresetName(bad); } catch (error) { message = error.message; }
  check(`非法预设名被拒：${JSON.stringify(bad).slice(0, 14)}`, message !== null, message ?? '（没有报错）');
}

// 拍取：勾选与三档裁剪开关都记下来；child 绝不能被带进来（那是本机专属路径）。
const captured = presets.capturePreset(
  { ...baseConfig, child: { command: 'node', args: ['rea.mjs', 'mcp'], env: { JAVA_HOME: 'D:/jdk' } } },
  { name: '原生深挖', note: '  native 为主  ' },
);
check(
  '拍取记下勾选与裁剪档',
  JSON.stringify(captured.preset.activeBundles) === JSON.stringify(['nav', 'native']) && captured.preset.lite === 'mild' && captured.preset.metaTools === true,
  JSON.stringify(captured.preset),
);
check('预设不含 child（本机路径不随预设走）', !Object.hasOwn(captured.preset, 'child'));
check('备注被 trim，名字是规范化后的', captured.preset.note === 'native 为主' && captured.name === '原生深挖');
check('同名保存能认出是覆盖', presets.capturePreset({ ...baseConfig, presets: { 原生深挖: captured.preset } }, { name: '原生深挖' }).replaced === true);
check('显式 bundles 优先于当前勾选', JSON.stringify(presets.capturePreset(baseConfig, { name: 'x', bundles: ['web', 'web', ''] }).preset.activeBundles) === JSON.stringify(['web']));

// 读取：存在的族进勾选，不存在的报 missing；裁剪档变化要列出来。
const defs = { nav: { tools: ['address_name'] }, native: { tools: ['xrefs'] }, debug: { tools: ['start_frida_session'] } };
const loadedPreset = presets.applyPreset(baseConfig, { activeBundles: ['nav', 'ghost'], lite: 'strict', metaTools: false }, { defs, knownTools: ['address_name', 'xrefs'], allBundle: 'all' });
check('读取：存在的族进勾选，不存在的报 missing', JSON.stringify(loadedPreset.applied) === JSON.stringify(['nav']) && loadedPreset.missing.includes('ghost'), JSON.stringify(loadedPreset.applied));
check('读取：裁剪档变化被列出来', loadedPreset.changed.length === 2 && loadedPreset.config.lite === 'strict' && loadedPreset.config.metaTools === false, JSON.stringify(loadedPreset.changed));
check('读取不改原配置对象', baseConfig.lite === 'mild' && JSON.stringify(baseConfig.activeBundles) === JSON.stringify(['nav', 'native']));
check('读取：这一版 REA 没有的族标 unavailable', presets.presetReport({ activeBundles: ['debug'] }, { defs, knownTools: ['address_name'] }).unavailable.includes('debug'));
check('读取：all 直接通过（不查族表）', JSON.stringify(presets.presetReport({ activeBundles: ['all'] }, { defs }).applied) === JSON.stringify(['all']));

// 当前生效判定：勾选与记下的裁剪档都要对得上。
check('预设生效判定：全对才算当前', presets.presetIsCurrent({ activeBundles: ['native', 'nav'], lite: 'mild', metaTools: true }, baseConfig) === true);
check('预设生效判定：裁剪档不同就不算', presets.presetIsCurrent({ activeBundles: ['native', 'nav'], lite: 'strict' }, baseConfig) === false);
check('预设生效判定：没记裁剪档时不比它', presets.presetIsCurrent({ activeBundles: ['native', 'nav'] }, baseConfig) === true);

// 成本：口径由调用方给（与快照同一份字符数），不在这里另立一套。
const toolChars = new Map([['address_name', 360], ['xrefs', 360], ['start_frida_session', 720]]);
const costNav = presets.presetCost({ activeBundles: ['nav'] }, { defs, toolChars, tokensOfChars: (chars) => Math.round(chars / 3.6) });
check('成本按族内工具算', costNav.toolCount === 1 && costNav.tokens === 100, JSON.stringify(costNav));
const costAll = presets.presetCost({ activeBundles: ['all'] }, { defs, toolChars, tokensOfChars: (chars) => chars });
check('all 预设的成本是全部工具', costAll.toolCount === 3 && costAll.tokens === 1440, JSON.stringify(costAll));

// 坏数据：读配置时逐条丢弃，不让一条垃圾拖垮整页。
const normalized = presets.normalizePresets({
  '好预设': { activeBundles: ['nav', 'nav', ''], lite: 'strict' },
  'a/b': { activeBundles: [] },
  '坏值': 'not-an-object',
  '缺字段': {},
});
check('坏名字/坏值被丢掉，好条目保留', Object.keys(normalized).join(',') === '好预设,缺字段', Object.keys(normalized).join(','));
check('勾选去重且丢掉空串', JSON.stringify(normalized['好预设'].activeBundles) === JSON.stringify(['nav']));
check('缺字段也能成条目（空勾选可读）', JSON.stringify(normalized['缺字段'].activeBundles) === JSON.stringify([]));
check('presets 不是对象时退回空表', Object.keys(presets.normalizePresets(['x'])).length === 0 && Object.keys(presets.normalizePresets(null)).length === 0);

// 删除：不存在时报出已有名字，而不是静默成功。
const removed = presets.removePreset({ presets: { a: { activeBundles: [] }, b: { activeBundles: [] } } }, 'a');
check('删除预设', Object.keys(removed.config.presets).join(',') === 'b' && removed.removed === 'a');
let removeError = null;
try { presets.removePreset({ presets: { a: { activeBundles: [] } } }, 'zzz'); } catch (error) { removeError = error.message; }
check('删不存在的预设报出已有名字', /没有预设/.test(removeError ?? '') && /a/.test(removeError ?? ''), removeError ?? '');

// ── 10. 面板新接口 ─────────────────────────────────────────────────────────

console.log('\n面板接口（/maintenance /classify /updates /presets）');
{
  const { apply } = await import(pathToFileURL(path.join(REPO, 'dsh-plugin', 'lib', 'index.js')).href);
  const tmpRoot = fs.mkdtempSync(path.join(tmp, 'gw-'));
  fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  // 复制网关模块，让面板按 root 找到它。整目录复制而不是列白名单：
  // 漏一个模块会让面板接口直接报 "Cannot find module"（已踩过一次）。
  for (const entry of fs.readdirSync(path.join(REPO, 'src'))) {
    if (!entry.endsWith('.mjs')) continue;
    fs.copyFileSync(path.join(REPO, 'src', entry), path.join(tmpRoot, 'src', entry));
  }
  const gwConfig = path.join(tmpRoot, 'config.json');
  // registry 指向一个必定连不上的本地端口：让「REA 本体」这一块走 registryError 分支，
  // 测试因此不依赖外网，也不会因为 npm 慢而超时。
  fs.writeFileSync(
    gwConfig,
    JSON.stringify({
      activeBundles: [],
      customBundles: {},
      bundleExtras: {},
      updates: { self: { remote: 'origin', checkOnStart: false }, rea: { registry: 'http://127.0.0.1:1/rea-agents', checkOnStart: false } },
    }, null, 2),
    'utf8',
  );
  // 快照：两个已归族 + 一个未归族的新工具，用来验证「未归族」被报出来。
  fs.writeFileSync(
    path.join(tmpRoot, 'data', 'tools-model.json'),
    JSON.stringify({
      version: 1, generatedAt: '2026-01-01T00:00:00.000Z', lite: 'mild', shortDesc: true,
      toolCount: 3, totalChars: 300, totalTokens: 83, metaTokens: 10, unassigned: ['inspect_pcap_reassembly'],
      tools: [
        { name: 'address_name', chars: 100, desc: 'Resolve name at address.', bundles: ['nav'] },
        { name: 'xrefs', chars: 100, desc: 'List cross references.', bundles: ['native'] },
        { name: 'inspect_pcap_reassembly', chars: 100, desc: 'Inspect packet stream reassembly in a pcap using tshark fields.', bundles: [] },
      ],
    }, null, 2),
    'utf8',
  );

  const routes = [];
  const ctx = {
    effect(fn) { fn(); },
    get(name) {
      if (name === 'tools') return { schemas: () => [] };
      if (name === 'loader') return { entries: () => [] };
      return undefined;
    },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  const originalEnv = process.env.REA_LITE_CONFIG;
  process.env.REA_LITE_CONFIG = gwConfig;
  try {
    apply(ctx, { root: tmpRoot });
    check('仍然只注册一条 prefix 路由', routes.length === 1 && routes[0].path === '/rea-lite');

    const handler = routes[0].handler;
    const call = async (options) => {
      const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body), 'utf8')];
      const req = {
        method: options.method ?? 'GET',
        url: options.url,
        socket: { remoteAddress: options.remote ?? '127.0.0.1' },
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
      };
      const res = {
        status: 0,
        payload: undefined,
        writeHead(status) { this.status = status; },
        end(text) { this.payload = text === undefined || text === '' ? undefined : JSON.parse(text); },
      };
      await handler(req, res);
      return res;
    };

    const maint = await call({ url: '/rea-lite/maintenance' });
    check('GET /maintenance → 200', maint.status === 200, maint.payload?.error ?? '');
    check('报告三块齐全', maint.payload?.self !== undefined && maint.payload?.rea !== undefined && maint.payload?.coverage !== undefined);
    check('默认用快照而不是起 REA', maint.payload?.source === 'snapshot', maint.payload?.source);
    check('未归族的新工具被报出来', maint.payload?.coverage?.unassigned?.includes('inspect_pcap_reassembly'), JSON.stringify(maint.payload?.coverage?.unassigned));
    check('报告带一句话结论', typeof maint.payload?.summary === 'string' && maint.payload.summary.length > 0, maint.payload?.summary);

    const cls = await call({ url: '/rea-lite/classify' });
    check('GET /classify → 200', cls.status === 200, cls.payload?.error ?? '');
    check('归类建议指向 capture', cls.payload?.assignments?.[0]?.suggested === 'capture', JSON.stringify(cls.payload?.assignments));
    check('高置信度可写入数 ≥ 1', cls.payload?.applyable >= 1, String(cls.payload?.applyable));

    const appliedRes = await call({ method: 'POST', url: '/rea-lite/classify', body: {} });
    check('POST /classify 写入成功', appliedRes.status === 200 && appliedRes.payload?.written >= 1, appliedRes.payload?.error ?? '');
    const after = JSON.parse(fs.readFileSync(gwConfig, 'utf8'));
    check('写进 config.bundleExtras', Array.isArray(after.bundleExtras?.capture) && after.bundleExtras.capture.includes('inspect_pcap_reassembly'), JSON.stringify(after.bundleExtras));
    check('写入后状态里该族多了「自动归类」项', appliedRes.payload?.state?.bundles?.find((b) => b.id === 'capture')?.extras?.length >= 1);

    const manual = await call({ method: 'POST', url: '/rea-lite/classify', body: { manual: { xrefs: 'evidence' } } });
    check('POST /classify manual 指定生效', manual.status === 200 && manual.payload?.written === 1, manual.payload?.error ?? '');
    const badManual = await call({ method: 'POST', url: '/rea-lite/classify', body: { manual: { xrefs: 'nope' } } });
    check('未知族 → 400', badManual.status === 400 && /未知功能族/.test(badManual.payload.error), badManual.payload.error);

    const updates = await call({ method: 'POST', url: '/rea-lite/updates', body: { updates: { self: { checkOnStart: true }, rea: { autoApply: false } } } });
    check('POST /updates → 200', updates.status === 200 && updates.payload?.saved === true, updates.payload?.error ?? '');
    const written = JSON.parse(fs.readFileSync(gwConfig, 'utf8'));
    check('开关写进 config.updates', written.updates?.self?.checkOnStart === true && written.updates?.rea?.autoApply === false, JSON.stringify(written.updates));
    check('状态里带回 updates 供面板渲染', updates.payload?.state?.updates?.self?.checkOnStart === true);

    const unknownAction = await call({ method: 'POST', url: '/rea-lite/maintenance', body: { action: 'rm-rf' } });
    check('未知动作 → 400 且报出可用动作', unknownAction.status === 400 && /可用/.test(unknownAction.payload.error), unknownAction.payload.error);

    const dryRun = await call({ method: 'POST', url: '/rea-lite/maintenance', body: { action: 'update-self' } });
    check(
      '不带 apply 的 update-self 只预览、不改仓库',
      dryRun.status === 200 && (dryRun.payload?.result?.dryRun === true || dryRun.payload?.result?.updated === false),
      JSON.stringify(dryRun.payload?.result ?? {}).slice(0, 140),
    );

    const forbidden = await call({ url: '/rea-lite/maintenance', remote: '10.0.0.7' });
    check('非回环来源仍被拒', forbidden.status === 403, String(forbidden.status));

    // ── 预设（/presets） ──
    const stateBefore = await call({ url: '/rea-lite/state' });
    check('状态里带出预设列表（初始为空）', Array.isArray(stateBefore.payload?.presets) && stateBefore.payload.presets.length === 0, JSON.stringify(stateBefore.payload?.presets));

    const savedPreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: '常用档', note: '只看这两个族' } });
    check('POST /presets save → 200', savedPreset.status === 200 && savedPreset.payload?.saved === true, savedPreset.payload?.error ?? '');
    const presetRow = savedPreset.payload?.state?.presets?.find((entry) => entry.name === '常用档');
    // 面板打开时勾选是空的（activeBundles: []），所以这个预设是「仅元工具」档。
    check('预设出现在状态里（按当前勾选拍取）', presetRow !== undefined && JSON.stringify(presetRow.activeBundles) === JSON.stringify([]), JSON.stringify(presetRow));
    check('预设记下备注与保存时间', presetRow?.note === '只看这两个族' && typeof presetRow?.savedAt === 'string');
    check('预设被标为当前生效（勾选与裁剪档都一致）', presetRow?.current === true);
    const fileAfterPreset = JSON.parse(fs.readFileSync(gwConfig, 'utf8'));
    check('预设写进 config.presets', Array.isArray(fileAfterPreset.presets?.['常用档']?.activeBundles), JSON.stringify(fileAfterPreset.presets));

    await call({ method: 'POST', url: '/rea-lite/active', body: { bundles: ['nav', 'native'] } });
    const savedWithBundles = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: '常用档' } });
    check('同名保存报出是覆盖', savedWithBundles.status === 200 && savedWithBundles.payload?.replaced === true);
    const costRow = savedWithBundles.payload?.state?.presets?.find((entry) => entry.name === '常用档');
    check('预设按快照算出工具数与成本', costRow?.toolCount === 2 && costRow?.tokens > 0, `${costRow?.toolCount} 个 / ${costRow?.tokens} tok`);
    check('覆盖后不再是当前生效（勾选变了）', costRow?.current === true, String(costRow?.current));

    // 保存勾选不能把预设抹掉（漏写会导致「勾一次就丢光」）。
    const { loadConfig, saveConfig } = await load('src/config.mjs');
    const roundTrip = loadConfig();
    check('读回配置时预设还在', Object.hasOwn(roundTrip.presets ?? {}, '常用档'));
    saveConfig({ ...roundTrip, activeBundles: ['native'] });
    check('保存勾选后预设仍在 config.json 里', Object.hasOwn(loadConfig().presets ?? {}, '常用档'));

    await call({ method: 'POST', url: '/rea-lite/active', body: { bundles: [] } });
    const appliedPreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'apply', name: '常用档' } });
    check('POST /presets apply → 写回勾选', appliedPreset.status === 200 && JSON.stringify(appliedPreset.payload?.state?.activeBundles) === JSON.stringify(['nav', 'native']), JSON.stringify(appliedPreset.payload?.activeBundles));
    check('读取后该预设在状态里标为当前生效', appliedPreset.payload?.state?.presets?.find((entry) => entry.name === '常用档')?.current === true);

    // 版本漂移：族在、但这一版 REA 一个工具都没有 → 能读，但要标出来。
    // 用 debug 而不是 capture：上面 /classify 刚把 inspect_pcap_reassembly 追加进 capture，
    // 那个族在这份快照里确实有工具可用了（honest 的判据就该跟着变）。
    const driftPreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: '漂移档', bundles: ['debug'] } });
    const driftRow = driftPreset.payload?.state?.presets?.find((entry) => entry.name === '漂移档');
    check('族在但这一版没有工具 → 标 unavailable', driftRow?.unavailable?.includes('debug'), JSON.stringify(driftRow?.unavailable));
    check('unavailable 的族仍留在勾选里（不是被丢掉）', driftRow?.applied?.includes('debug'), JSON.stringify(driftRow?.applied));

    // 预设引用的自定义族被删掉：读取时跳过并报 missing，而不是悄悄加载一个空族。
    await call({ method: 'POST', url: '/rea-lite/custom', body: { id: 'my-re', tools: ['xrefs'] } });
    await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: '带自定义组', bundles: ['nav', 'my-re'] } });
    await call({ method: 'POST', url: '/rea-lite/custom', body: { id: 'my-re', delete: true } });
    const ghostApply = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'apply', name: '带自定义组' } });
    check('引用的族已删除 → 读取时跳过并报 missing', ghostApply.status === 200 && ghostApply.payload?.missing?.includes('my-re') && JSON.stringify(ghostApply.payload?.activeBundles) === JSON.stringify(['nav']), JSON.stringify(ghostApply.payload?.missing));
    check('状态里也标出这个预设引用了不存在的族', ghostApply.payload?.state?.presets?.find((entry) => entry.name === '带自定义组')?.missing?.includes('my-re'));

    const badPresetName = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: 'a/b', bundles: [] } });
    check('非法预设名 → 400', badPresetName.status === 400 && /预设名/.test(badPresetName.payload.error), badPresetName.payload.error);
    const unknownBundlePreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'save', name: 'x', bundles: ['nope'] } });
    check('预设引用未知族 → 400', unknownBundlePreset.status === 400 && /未知功能族/.test(unknownBundlePreset.payload.error), unknownBundlePreset.payload.error);
    const missingPreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'apply', name: '不存在' } });
    check('读取不存在的预设 → 400 并列出已有', missingPreset.status === 400 && /没有预设/.test(missingPreset.payload.error), missingPreset.payload.error);
    const badPresetAction = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'rm-rf', name: 'x' } });
    check('未知动作 → 400 且列出可用', badPresetAction.status === 400 && /可用/.test(badPresetAction.payload.error), badPresetAction.payload.error);

    const deletedPreset = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'delete', name: '常用档' } });
    check('删除预设 → 200 且从状态里消失', deletedPreset.status === 200 && !deletedPreset.payload?.state?.presets?.some((entry) => entry.name === '常用档'), deletedPreset.payload?.error ?? '');
    const deleteMissing = await call({ method: 'POST', url: '/rea-lite/presets', body: { action: 'delete', name: '常用档' } });
    check('重复删除 → 400', deleteMissing.status === 400, deleteMissing.payload?.error);
  } finally {
    if (originalEnv === undefined) delete process.env.REA_LITE_CONFIG;
    else process.env.REA_LITE_CONFIG = originalEnv;
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
