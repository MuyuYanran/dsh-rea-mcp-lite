// 更新与体检：三个都要问「外面/里面各是什么版本」。
//
//   1. 本仓库自己有没有新提交（git 远端）；
//   2. 本机装的 rea-agents 与 npm 上最新版差多少（以及该怎么升级：pnpm 工作区 / npm 目录）；
//   3. 当前 REA 的工具清单与功能族清单的差集 —— 哪些工具本地用不到、哪些新工具还没归族。
//
// 全部是「只读检查」，只有显式 apply 才会真的动东西：
//   - applySelf：git merge --ff-only（只快进，分叉了就停下报给人）；
//   - applyRea ：先把 package.json / 锁文件备份到 _upgrade-backup-<时间戳>/，再装新版。
// 这样用户可以「先看再决定」，也让面板能安全地轮询。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { BUNDLES, unassignedTools } from './bundles.mjs';

const REGISTRY_URL = process.env.REA_LITE_REGISTRY || 'https://registry.npmjs.org/rea-agents';

/**
 * Windows 上 npm/pnpm 是 `.cmd` 垫片：不经 shell 直接 spawn 会立刻失败（ENOENT/EINVAL），
 * 而且失败只走 `error` 事件 —— stdout 与 stderr 都是空的。2026-10-30 就因为这一点，
 * `update-rea --apply` 报出一句没有任何信息的「安装失败：」，而同一个命令手工跑是成功的。
 * git 与 node 是真正的 .exe，不需要 shell，走原路径。
 */
const SHELL_SHIMS = new Set(['npm', 'pnpm', 'yarn', 'npx', 'corepack']);

/** 这条命令要不要交给 shell 解析（只看包管理器；其余保持 shell:false，避免多余的命令行解析）。 */
export function needsShell(command) {
  return process.platform === 'win32' && SHELL_SHIMS.has(String(command).toLowerCase());
}

/**
 * 交给 shell 时必须把整条命令行拼成**一个字符串**再传：
 * `spawn(cmd, args, { shell: true })` 会触发 Node 的 DEP0190 —— 它明确说实参「只拼接、不转义」。
 * 所以这里只放行安全字符集，出现别的字符就直接拒绝，而不是拼出一条可能被当成命令解释的命令行。
 */
const SAFE_SHELL_ARG = /^[A-Za-z0-9@._/:=+-]+$/u;

function shellCommandLine(command, args) {
  const parts = [String(command), ...args.map(String)];
  for (const part of parts) {
    if (!SAFE_SHELL_ARG.test(part)) throw new Error(`拒绝交给 shell 的内容（含特殊字符）：${JSON.stringify(part)}`);
  }
  return parts.join(' ');
}

/** 把 runSync/runAsync 的错误字段拼成一句人话：error 与 stderr 常常只有一边有内容。 */
function describeFailure(result) {
  const detail = [result.error, result.stderr, result.stdout].map((part) => (part ?? '').trim()).filter(Boolean).join(' / ');
  return detail === '' ? '没有输出（进程可能根本没起来）' : detail.slice(-800);
}

/** 跑一条命令，同步拿结果（git/pnpm 这类短命令用同步更省事）。 */
function runSync(command, args, opts = {}) {
  const useShell = opts.shell ?? needsShell(command);
  const result = spawnSync(useShell ? shellCommandLine(command, args) : command, useShell ? [] : args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeoutMs ?? 60000,
    shell: useShell,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    error: result.error?.message,
  };
}

/** 跑一条命令，异步（安装可能几分钟，不能堵事件循环）。 */
export function runAsync(command, args, opts = {}) {
  const useShell = opts.shell ?? needsShell(command);
  let finalCommand = command;
  let finalArgs = args;
  if (useShell) {
    try {
      finalCommand = shellCommandLine(command, args);
      finalArgs = [];
    } catch (error) {
      // 与「进程起不来」同一种失败形态：调用方拿 error 就能说清楚。
      return Promise.resolve({ ok: false, status: -1, stdout: '', stderr: '', error: error.message });
    }
  }
  return new Promise((resolve) => {
    const child = spawn(finalCommand, finalArgs, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
    }, opts.timeoutMs ?? 600000);
    child.stdout.on('data', (chunk) => { stdout += chunk; opts.onOutput?.(chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr += chunk; opts.onOutput?.(chunk.toString()); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: -1, stdout, stderr, error: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, status: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ── 1. 本仓库自身更新 ───────────────────────────────────────────────────────

/**
 * 检查本仓库相对远端的进度。
 * @param {{root:string, remote?:string, fetch?:boolean}} opts fetch 默认 true（先 git fetch）
 */
export function checkSelfUpdate(opts = {}) {
  const root = opts.root;
  const remote = opts.remote ?? 'origin';
  const git = (args, extra) => runSync('git', args, { cwd: root, ...(extra ?? {}) });

  const probe = git(['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) return { ok: false, reason: '这个目录不是 git 仓库', root, remote, dirty: false, behind: 0, ahead: 0, available: false };

  const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.ok ? branchResult.stdout : '';
  const dirty = git(['status', '--porcelain']).stdout !== '';
  const upstream = git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
  if (!upstream.ok) {
    return {
      ok: true, root, remote, branch, dirty,
      tracking: false, behind: 0, ahead: 0, available: false,
      reason: `分支 ${branch || '(未知)'} 没有跟踪远端，先 git branch --set-upstream-to=${remote}/${branch}`,
    };
  }

  let fetchError = null;
  if (opts.fetch !== false) {
    const fetched = git(['fetch', '--quiet', remote], { timeoutMs: 60000 });
    if (!fetched.ok) fetchError = fetched.stderr || fetched.error || `git fetch 退出码 ${fetched.status}`;
  }

  const counts = git(['rev-list', '--left-right', '--count', `HEAD...${upstream.stdout}`]);
  let ahead = 0;
  let behind = 0;
  if (counts.ok) {
    const [left, right] = counts.stdout.split(/\s+/u).map((value) => Number.parseInt(value, 10) || 0);
    ahead = left;
    behind = right;
  }
  const head = git(['rev-parse', '--short', 'HEAD']);
  // 只列远端领先的提交（不含已合并的），给人看「更新了什么」。
  const log = behind > 0
    ? git(['log', '--oneline', '--no-decorate', `HEAD..${upstream.stdout}`, '-n', '20']).stdout.split('\n').filter(Boolean)
    : [];

  return {
    ok: true,
    root,
    remote,
    branch,
    upstream: upstream.stdout,
    dirty,
    tracking: true,
    ahead,
    behind,
    available: behind > 0,
    // 快进的条件：远端有新提交、本地没有自己的提交、工作区干净。
    fastForwardable: behind > 0 && ahead === 0 && !dirty,
    head: head.ok ? head.stdout : '',
    commits: log,
    fetchError,
    reason: fetchError !== null && behind === 0 ? `取远端失败：${fetchError}` : undefined,
  };
}

/** 快进到远端。分叉或工作区脏时拒绝执行 —— 那是人的决定，不是脚本能替的。 */
export function applySelfUpdate(check, opts = {}) {
  if (!check?.ok) return { ok: false, reason: check?.reason ?? '检查失败' };
  if (check.fetchError) return { ok: false, reason: `取远端失败，先修网络：${check.fetchError}` };
  if (!check.available) return { ok: false, reason: '已经是最新，无需更新' };
  if (check.dirty) return { ok: false, reason: '工作区有未提交的改动，先提交或 stash 再更新' };
  if (check.ahead > 0) return { ok: false, reason: `本地有 ${check.ahead} 个未推送的提交，与远端分叉，请手工 merge/rebase` };
  const result = runSync('git', ['merge', '--ff-only', check.upstream], { cwd: check.root ?? opts.root });
  return {
    ok: result.ok,
    from: check.head,
    to: check.upstream,
    commits: check.commits,
    output: result.ok ? result.stdout : (result.stderr || result.error || ''),
    reason: result.ok ? undefined : `git merge --ff-only 失败：${result.stderr || result.error}`,
  };
}

// ── 2. REA 本体更新 ─────────────────────────────────────────────────────────

/**
 * 从 launcher 路径反查「装在哪、装的是哪一版、怎么装的」。
 * 期望 launcher 形如 <env>/node_modules/rea-agents/scripts/rea.mjs。
 */
export function locateReaInstall(launcher) {
  const start = path.dirname(path.resolve(String(launcher ?? '')));
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = path.join(dir, 'package.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest?.name === 'rea-agents') {
          // node_modules/rea-agents → 上级的上级就是运行环境目录（package.json + 锁文件在那）。
          const packageDir = dir;
          const envDir = path.dirname(path.dirname(packageDir));
          const hasPnpm = fs.existsSync(path.join(envDir, 'pnpm-lock.yaml')) || fs.existsSync(path.join(envDir, 'pnpm-workspace.yaml'));
          const hasNpm = fs.existsSync(path.join(envDir, 'package-lock.json'));
          return {
            found: true,
            packageDir,
            envDir,
            version: String(manifest.version ?? ''),
            manager: hasPnpm ? 'pnpm' : hasNpm ? 'npm' : 'unknown',
            launcherEntry: path.relative(packageDir, path.resolve(String(launcher ?? ''))).split(path.sep).join('/'),
          };
        }
      } catch {
        // 继续往上找
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { found: false, version: '', envDir: '', manager: 'unknown', reason: `没能从 ${launcher} 找到 rea-agents 的 package.json` };
}

/** 问 npm 上最新版是多少（离线时给 null，而不是让整个检查失败）。 */
export async function fetchLatestReaVersion(opts = {}) {
  const url = opts.registry ?? REGISTRY_URL;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) });
    if (!response.ok) return { ok: false, latest: null, reason: `registry HTTP ${response.status}` };
    const doc = await response.json();
    const latest = doc?.['dist-tags']?.latest ?? null;
    const versions = Object.keys(doc?.versions ?? {});
    return { ok: latest !== null, latest, versions, reason: latest === null ? 'registry 里没有 dist-tags.latest' : undefined };
  } catch (error) {
    return { ok: false, latest: null, reason: `取 npm registry 失败：${error?.message ?? error}` };
  }
}

/** 简单版本比较：返回 latest 是否比 installed 新（按数字段逐段比）。 */
export function compareVersions(a, b) {
  const parse = (value) => String(value ?? '').split(/[.+-]/u).map((part) => (/^\d+$/u.test(part) ? Number(part) : 0));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * 检查 REA 本体是否有新版。
 * @param {{child:{args:string[]}, root?:string, registry?:string}} opts
 */
export async function checkReaUpdate(opts = {}) {
  const launcher = opts.child?.args?.[0] ?? '';
  const install = locateReaInstall(launcher);
  const remote = await fetchLatestReaVersion({ registry: opts.registry });
  const installed = install.found ? install.version : null;
  const newer = installed !== null && remote.latest !== null ? compareVersions(remote.latest, installed) > 0 : false;
  return {
    ok: true,
    launcher,
    install,
    installed,
    latest: remote.latest,
    versions: (remote.versions ?? []).slice(-8),
    updateAvailable: newer,
    registryError: remote.ok ? undefined : remote.reason,
    // 升级后要做的事，直接写进提示里，免得用户记不住。
    nextStep: newer
      ? `装完新版本后运行 node src/cli.mjs snapshot，再 node src/cli.mjs classify —— 新工具要归族才能被功能族加载。`
      : undefined,
  };
}

/** 备份运行环境的清单与锁文件（写成 _upgrade-backup-<时间戳>/，与既有习惯一致）。 */
function backupEnv(envDir, stamp) {
  const target = path.join(envDir, `_upgrade-backup-${stamp}`);
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json']) {
    const from = path.join(envDir, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(target, name));
    copied.push(name);
  }
  return { dir: target, copied };
}

/**
 * 升级 rea-agents 到指定版本。
 *
 * 步骤：备份 → 在运行环境目录里装 → 用新 launcher 探一次工具列表（证明它真能跑）。
 * 装失败时把备份拷回去，恢复原来的版本号，不留下一个半死的环境。
 *
 * @param {{check:object, version?:string, apply?:boolean, onOutput?:Function}} opts
 */
export async function applyReaUpdate(opts = {}) {
  const check = opts.check;
  if (!check?.ok) return { ok: false, reason: check?.reason ?? '检查失败' };
  const install = check.install ?? {};
  if (install.found !== true) return { ok: false, reason: install.reason ?? '找不到 rea-agents 的安装位置' };
  if (check.latest === null) return { ok: false, reason: check.registryError ?? '取不到 npm 上最新版本号' };
  if (check.updateAvailable !== true) return { ok: false, reason: `已是最新（${check.installed}）` };

  const version = opts.version ?? check.latest;
  // 版本号来自远端 packument（或调用方），会被拼进 shell 命令行；先按 semver 形状卡住，
  // 免得一个被污染的 dist-tag 变成命令注入（拒绝的理由也要说人话，而不是底层那句「含特殊字符」）。
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    return { ok: false, reason: `版本号不是合法的 semver：${JSON.stringify(version)}` };
  }
  const envDir = install.envDir;
  const manager = install.manager === 'npm' ? 'npm' : 'pnpm';
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19);
  const backup = backupEnv(envDir, stamp);
  const plan = {
    envDir,
    manager,
    version,
    backup: backup.dir,
    copied: backup.copied,
    command: manager === 'pnpm' ? `pnpm add rea-agents@${version}` : `npm install rea-agents@${version}`,
  };
  if (opts.apply !== true) return { ok: true, applied: false, dryRun: true, plan };

  const args = manager === 'pnpm' ? ['add', `rea-agents@${version}`] : ['install', `rea-agents@${version}`];
  const result = await runAsync(manager, args, { cwd: envDir, onOutput: opts.onOutput, timeoutMs: opts.timeoutMs ?? 900000 });
  if (!result.ok) {
    // 回滚：把备份里的清单/锁文件拷回，再让包管理器按原清单重装一遍。
    let rollback = '未执行（备份目录里没有清单）';
    try {
      for (const name of backup.copied) fs.copyFileSync(path.join(backup.dir, name), path.join(envDir, name));
      if (backup.copied.includes('package.json')) {
        const restore = await runAsync(manager, manager === 'pnpm' ? ['install'] : ['install'], { cwd: envDir, timeoutMs: opts.timeoutMs ?? 900000 });
        rollback = restore.ok ? '已恢复原清单并重装' : `恢复清单成功，但重装失败：${describeFailure(restore)}`;
      }
    } catch (error) {
      rollback = `回滚失败：${error.message}`;
    }
    return { ok: false, applied: false, plan, rollback, reason: `安装失败：${describeFailure(result)}` };
  }

  // 装完立刻验一次：能列出工具才算成功，否则「装上了但跑不起来」比装失败更难查。
  const after = locateReaInstall(check.launcher);
  return {
    ok: true,
    applied: true,
    plan,
    installed: after.found ? after.version : null,
    previous: check.installed,
    nextStep: '运行 node src/cli.mjs snapshot 刷新工具快照，再 node src/cli.mjs classify --apply 把新工具归族',
    output: (result.stdout || '').slice(-800),
  };
}

// ── 3. 工具覆盖体检 ─────────────────────────────────────────────────────────

/**
 * 对比「当前 REA 的工具」与「功能族清单」，回答两个方向的缺口。
 *
 * - missingForLocal：族清单里有、当前 REA 版本没有 → 本地 REA 太旧，这些能力用不到；
 * - unassigned：当前 REA 有、没有任何族收录 → 新工具（升级后出现），加载族时找不到它；
 * - unclassifiedInExtras：bundleExtras 里指向已不存在工具的死条目。
 *
 * @param {{toolNames:string[], defs?:object, extras?:object}} input
 */
export function checkToolCoverage(input = {}) {
  const defs = input.defs ?? BUNDLES;
  const names = input.toolNames ?? [];
  const known = new Set(names);
  const declared = new Set();
  for (const def of Object.values(defs)) for (const name of def.tools ?? []) declared.add(name);
  const allKnown = new Set([...declared, ...known]);
  const missingForLocal = [...declared].filter((name) => !known.has(name));
  // 只算一次：unassignedTools 已经是「族表里没有的工具」，别再自己遍历一遍族表。
  const usedNames = unassignedTools(names, defs);
  const deadExtras = [];
  for (const [id, list] of Object.entries(input.extras ?? {})) {
    if (!Array.isArray(list) || defs[id] === undefined) continue;
    for (const name of list) if (!allKnown.has(name)) deadExtras.push({ name, bundle: id });
  }
  return {
    // 同一件事两个说法：「族清单覆盖了多少当前工具」与「当前工具里有多少没归族」。
    total: names.length,
    assigned: names.length - usedNames.length,
    missingForLocal,
    unassigned: usedNames,
    deadExtras,
    healthy: usedNames.length === 0 && missingForLocal.length === 0,
    hint: usedNames.length > 0
      ? '有未归族的新工具：node src/cli.mjs classify 看建议，或让 DSH 模型判断后 classify --apply 写入'
      : missingForLocal.length > 0
        ? '族清单里有当前 REA 版本没有的工具：本地 REA 比族清单旧，检查 REA 更新'
        : undefined,
  };
}
