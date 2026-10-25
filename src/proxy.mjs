#!/usr/bin/env node
// rea-mcp-lite —— 夹在 DSH 与 REA 之间的 MCP stdio 代理。
//
// 它做五件事：
//   1. 只把「按需加载的功能族 + 5 个元工具」暴露给模型，REA 的全部工具保持可达；
//   2. 裁剪暴露工具的 schema/描述（outputSchema 保留，因为它不进模型上下文、只用于结果校验）；
//   3. 支持运行时开关功能族：改写后的工具列表通过 notifications/tools/list_changed 热更新，无需重启 DSH；
//   4. 其余 JSON-RPC 消息（工具调用、资源、通知）原样双向转发；
//   5. 自身维护：检查/应用本仓库与 REA 更新、把 REA 新版新增工具自动归类、刷新成本快照。
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ALL_BUNDLE, resolveBundleTools, effectiveBundles } from './bundles.mjs';
import { projectTool, estimateTokens } from './lite.mjs';
import { ROOT, loadConfig, CONFIG_PATH, saveConfig } from './config.mjs';
import { probeTools } from './probe-client.mjs';
import { classifyTools, buildClassifierPrompt } from './classify.mjs';
import { collectReport, pullSelfUpdate, pullReaUpdate, refreshAfterUpgrade, applyClassify, describeSelf, describeRea, describeUpdate, runStartupMaintenance } from './maintenance.mjs';
import { META_TOOLS, META_NAMES, handleMetaTool, describeExposedText } from './meta-tools.mjs';
import { normalizePresetName, capturePreset, listPresets, applyPreset, removePreset } from './presets.mjs';
import { tryWriteSnapshot, SNAPSHOT_PATH } from './snapshot.mjs';

function log(...args) { process.stderr.write(`[rea-mcp-lite] ${args.join(' ')}\n`); }

/** 按行切分 stdio 上的 JSON-RPC 消息。 */
function makeLineReader(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { log(`跳过非 JSON 行（${line.length} 字节）`); continue; }
      onMessage(message);
    }
  };
}

class ReaProxy {
  constructor(config, configPath) {
    this.config = config;
    this.configPath = configPath;
    this.child = null;
    this.childTools = null;
    this.childError = null;
    this.initId = null;
    this.initTimer = null;
    this.pending = new Map();
    this.internalSeq = 0;
    this.clientMeta = null; // 客户端出站请求的 _meta 信封（2026-07-28+ 协议要求），内部请求向 REA 转发时复用
    this.childResultShell = null; // REA tools/list 结果外壳（含 ttlMs/cacheScope/_meta 等现代协议字段），回客户端时复用
    this.activeBundles = [...config.activeBundles];
    this.exposedCache = null;
    this.clientReader = null;
    this.metaCtx = {
      allTools: () => this.childTools ?? [],
      exposedNames: () => this.exposedNames(),
      activeBundles: () => [...this.activeBundles],
      setActiveBundles: (next) => this.setActiveBundles(next),
      callTool: (name, args) => this.callChildTool(name, args),
      lite: () => this.config.lite,
      bundleTable: () => this.bundleTable(),
      describeExposed: () => describeExposedText(this.metaCtx),
      // 命名预设：模型自己也能把「当前这套加载集合」存下来、之后一键切回来。
      presets: () => listPresets(this.config),
      savePreset: (args) => this.presetSave(args),
      loadPreset: (name) => this.presetLoad(name),
      removePreset: (name) => this.presetRemove(name),
      // 体检/更新/归类：模型侧也能直接触发，不必切到终端。只读动作默认，写动作必须显式要求。
      maintenance: (args) => this.runMaintenance(args),
    };
  }

  // ---------- 命名预设 ----------
  //
  // 与 CLI、设置页共用 presets.mjs 的纯函数：保存/读取的判断只有一份。
  // 读取预设可能同时改「勾选」与「裁剪档」（lite / shortDescription / metaTools），
  // 后者会改变每个工具定义的长度，所以这种情况既要刷新快照（面板上的成本口径），
  // 也要发 tools/list_changed —— 只改勾选而不发通知的话，模型手里的工具列表是旧的。

  /** 保存当前（或显式给定）的加载集合为命名预设。 */
  presetSave(args = {}) {
    const { name, preset, replaced } = capturePreset(this.config, {
      name: args?.name,
      label: args?.label,
      note: args?.note,
      bundles: Array.isArray(args?.bundles) ? args.bundles : this.activeBundles,
    });
    saveConfig({ ...this.config, presets: { ...(this.config.presets ?? {}), [name]: preset } });
    this.config = loadConfig();
    log(`预设 ${replaced ? '已覆盖' : '已保存'}：${name} → [${preset.activeBundles.join(', ') || '仅元工具'}]`);
    return { name, preset, replaced };
  }

  /** 读取预设：写回配置、热切换工具列表；引用的族不存在时跳过并如实报出。 */
  presetLoad(input) {
    const name = normalizePresetName(input);
    const preset = (this.config.presets ?? {})[name];
    if (preset === undefined) {
      throw new Error(`没有预设：${name}。可用：${Object.keys(this.config.presets ?? {}).join(', ') || '（无）'}`);
    }
    const shapeOf = (config) => `${config.lite}|${config.shortDescription}|${config.metaTools}`;
    const before = { bundles: this.activeBundles.join(','), shape: shapeOf(this.config) };
    const result = applyPreset(this.config, preset, {
      defs: this.bundleTable(),
      knownTools: (this.childTools ?? []).map((tool) => tool.name),
      allBundle: ALL_BUNDLE,
    });
    saveConfig(result.config);
    this.config = loadConfig();
    this.activeBundles = [...this.config.activeBundles];
    const shapeChanged = shapeOf(this.config) !== before.shape;
    if (shapeChanged) this.refreshSnapshot();
    if (shapeChanged || this.activeBundles.join(',') !== before.bundles) {
      log(`读取预设 ${name}：功能族 ${before.bundles || '(无)'} → ${this.activeBundles.join(',') || '(无)'}`);
      this.writeOut({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    }
    return { ...result, shapeChanged };
  }

  /** 删除命名预设（不动当前勾选）。 */
  presetRemove(input) {
    const result = removePreset(this.config, input);
    saveConfig(result.config);
    this.config = loadConfig();
    log(`预设已删除：${result.removed}`);
    return result;
  }

  // ---------- 维护（元工具 maintenance） ----------
  /**
   * 把维护动作暴露成元工具。这里的写动作都要求 apply:true，且只走白名单；
   * 与 CLI 的 `check / update-* / classify` 是同一批实现（maintenance.mjs）。
   */
  async runMaintenance(args) {
    const action = String(args?.action ?? 'report');
    const config = this.config;
    if (action === 'report') {
      const report = await collectReport(config, { root: ROOT, probe: (childConfig) => probeTools(childConfig, { timeoutMs: 60000 }) });
      const lines = [
        `结论：${report.summary}`,
        '',
        `本仓库：${describeSelf(report.self)}`,
        `REA 本体：${describeRea(report.rea)}`,
        `工具覆盖：${report.coverage.total} 个工具，已归族 ${report.coverage.assigned}（来源 ${report.coverage.source}）`,
      ];
      if (report.coverage.unassigned.length) {
        lines.push(`  未归族：${report.coverage.unassigned.join(', ')}`);
        lines.push('  用 maintenance action=classify 写入高置信度归类，或先看建议。');
      }
      if (report.coverage.missingForLocal.length) lines.push(`  族清单有但本地 REA 没有：${report.coverage.missingForLocal.join(', ')}`);
      return lines.join('\n');
    }
    if (action === 'classify') {
      if (args?.apply !== true && args?.manual === undefined) {
        const tools = (this.childTools ?? []).map((tool) => ({ name: tool.name, description: tool.description }));
        const result = classifyTools(tools, { defs: this.bundleTable() });
        if (result.counts.total === 0) return '当前 REA 的工具全部归族，无需处理。';
        const rows = result.assignments.map((entry) => `  ${entry.name} → ${entry.suggested ?? '（无建议）'} [${entry.confidence}]`);
        return [
          `${result.counts.total} 个工具未归族：`,
          ...rows,
          '',
          '写入高置信度：{"action":"classify","apply":true}；指定：{"action":"classify","manual":{"工具名":"族id"}}',
          '',
          buildClassifierPrompt(result.assignments, { defs: this.bundleTable() }),
        ].join('\n');
      }
      const result = await applyClassify(this.config, { manual: args?.manual });
      this.config = loadConfig();
      return `已写入 ${result.written} 个归类到 config.bundleExtras（族：${Object.keys(result.extras).join(', ')}）。\n接着刷新快照：{"action":"snapshot"}`;
    }
    if (action === 'snapshot') {
      const after = await refreshAfterUpgrade(this.config, { probe: (childConfig) => probeTools(childConfig, { timeoutMs: 60000 }) });
      return [
        after.snapshot ? `快照已刷新：${after.snapshot.toolCount} 个工具，全量约 ${after.snapshot.totalTokens} tok` : '快照未刷新',
        after.classified ? `自动归类写入 ${after.classified.written} 个工具` : '',
        ...(after.warnings ?? []),
      ].filter(Boolean).join('\n');
    }
    if (action === 'update-self') {
      const result = pullSelfUpdate({ root: ROOT, remote: this.config.updates?.self?.remote, apply: args?.apply === true, log });
      return describeUpdate('本仓库', result);
    }
    if (action === 'update-rea') {
      const result = await pullReaUpdate(this.config, { root: ROOT, apply: args?.apply === true, log });
      if (result.updated) {
        // 新版本换了子进程，要重启并重新握手/预取，否则工具列表还是旧的。
        this.config = loadConfig();
        this.restartChild('REA 已升级，重启子进程');
      }
      return describeUpdate('REA', result);
    }
    return `未知动作：${action}。可用：report / classify / snapshot / update-self / update-rea`;
  }

  /** 重启子进程并重新握手+预取（升级 REA 后必须走这条）。 */
  restartChild(reason) {
    log(reason);
    try { this.child?.kill(); } catch { /* 已退出 */ }
    this.childError = null;
    this.childTools = null;
    this.childResultShell = null;
    this.exposedCache = null;
    this.initId = null;
    this.start();
    void this.rehandshakeAndPrefetch();
  }

  // ---------- 传输层 ----------
  writeOut(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
  writeChild(message) { if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(message) + '\n'); }

  start() {
    const { command, args, env } = this.config.child;
    log(`启动 REA：${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    this.child = child;
    // 热重启会换掉 this.child；旧进程的 exit/error 回调必须认自己是哪一代，
    // 否则它退出时会把新进程的状态改写成「已退出」。
    const isCurrent = () => this.child === child;
    child.stdout.on('data', makeLineReader((msg) => { if (isCurrent()) this.onChildMessage(msg); }));
    child.stderr.on('data', (chunk) => process.stderr.write(`[rea] ${chunk}`));
    child.on('error', (error) => {
      if (!isCurrent()) return;
      this.childError = `无法启动 REA：${error.message}`;
      log(this.childError);
      this.failInit();
    });
    child.on('exit', (code, signal) => {
      if (!isCurrent()) return; // 主动重启导致的旧进程退出，不算错误
      this.childError = this.childError ?? `REA 进程退出（code=${code}${signal ? `, signal=${signal}` : ''}）`;
      log(this.childError);
      for (const { reject } of this.pending.values()) reject(new Error(this.childError));
      this.pending.clear();
      this.failInit();
    });
  }

  failInit() {
    if (this.initId === null) return;
    const id = this.initId;
    this.initId = null;
    clearTimeout(this.initTimer);
    this.writeOut({ jsonrpc: '2.0', id, error: { code: -32000, message: this.childError ?? 'REA 初始化失败' } });
  }

  // ---------- 客户端 → 代理 ----------
  handleClientLine(chunk) {
    this.clientReader = this.clientReader ?? makeLineReader((m) => this.routeClient(m));
    this.clientReader(chunk);
  }

  routeClient(msg) {
    // 捕获客户端出站请求的 _meta 信封。2026-07-28+ 协议版本要求每个请求都带
    // io.modelcontextprotocol/protocolVersion 与 .../clientCapabilities；代理内部
    // 向 REA 发的请求（预取工具列表、call_tool）若不带，REA 会以
    // "Request is missing the required _meta envelope" 拒绝，导致工具列表不可用。
    if (msg.params?._meta) this.clientMeta = msg.params._meta;

    if (msg.method === 'initialize') {
      this.initId = msg.id;
      // 存一份客户端握手，供配置热重启后重放——新起的 REA 子进程同样需要握手。
      this.lastHandshake = { jsonrpc: '2.0', method: 'initialize', params: msg.params };
      this.initTimer = setTimeout(() => { this.childError = '等待 REA 初始化超时（30 秒）'; this.failInit(); }, 30000);
      this.writeChild(msg);
      return;
    }
    if (msg.method === 'server/discover') {
      // 2026-07-28 协议下的握手方法（现代客户端走这条，不发 initialize）。
      this.lastHandshake = { jsonrpc: '2.0', method: 'server/discover', params: msg.params };
      this.writeChild(msg);
      return;
    }
    if (msg.method === 'notifications/initialized') {
      this.sawInitialized = true;
      this.writeChild(msg);
      return;
    }
    if (msg.method === 'tools/list') { void this.replyToolList(msg); return; }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      if (META_NAMES.has(name)) { void this.replyMetaCall(msg, name); return; }
      this.writeChild(msg);
      return;
    }
    if (msg.id !== undefined && this.childError) {
      this.writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: this.childError } });
      return;
    }
    this.writeChild(msg);
  }

  // 2026-07-28+ 协议要求结果带 resultType:"complete"；旧版本忽略此字段。
  // 仅在客户端走现代协议（this.clientMeta 已捕获）时添加，避免对旧客户端造成语义偏差。
  modernResult(result) {
    if (this.clientMeta) return { ...result, resultType: 'complete' };
    return result;
  }

  async replyToolList(msg) {
    try {
      const tools = await this.buildExposedTools();
      // 复用 REA 结果外壳（含 ttlMs/cacheScope/_meta 等现代协议必需字段），只替换 tools 数组
      const result = { ...(this.childResultShell ?? {}), tools };
      if (this.clientMeta) result.resultType = 'complete'; // 2026-07-28+ 要求结果显式带 resultType
      this.writeOut({ jsonrpc: '2.0', id: msg.id, result });
    } catch (error) {
      this.writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message ?? error) } });
    }
  }

  async replyMetaCall(msg, name) {
    try {
      const result = await handleMetaTool(name, msg.params?.arguments ?? {}, this.metaCtx);
      this.writeOut({ jsonrpc: '2.0', id: msg.id, result: this.modernResult(result) });
    } catch (error) {
      this.writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message ?? error) } });
    }
  }

  // ---------- 代理 → 客户端 ----------
  onChildMessage(msg) {
    // 配置热重启后重放 initialize 的应答：交给 rehandshakeAndPrefetch 的一次性监听，
    // 不能落到下面那段「客户端握手」分支里（否则会用内部 id 回客户端一条假应答）。
    if (this.onceInitReply && msg.id === 'rea-lite-reinit') {
      const resolve = this.onceInitReply;
      this.onceInitReply = null;
      resolve(msg);
      return;
    }
    // 初始化应答：缓存能力、预取工具列表、给客户端一份改写过的 serverInfo 与使用说明
    if (this.initId !== null && msg.id === this.initId) {
      clearTimeout(this.initTimer);
      this.initId = null;
      if (msg.error) { this.writeOut(msg); return; }
      const result = msg.result ?? {};
      void this.prefetchTools();
      this.writeOut({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          ...result,
          serverInfo: { ...(result.serverInfo ?? {}), name: 'rea-lite' },
          instructions:
            '这是 REA 逆向工程工具的按需加载网关。工具默认不全量加载以节省上下文：' +
            '用 search_tools 查找工具、call_tool 调用任意工具（含未加载功能族的）、bundles 查看并热加载功能族、tool_schema 查询参数细节。',
        },
      });
      return;
    }

    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve(msg);
      return;
    }

    if (msg.method === 'notifications/tools/list_changed') {
      this.childTools = null;
      this.childResultShell = null;
      this.exposedCache = null;
    }
    this.writeOut(msg);
  }

  // ---------- 与子进程的请求往返 ----------
  request(method, params, timeoutMs = 120000) {
    if (this.childError) return Promise.reject(new Error(this.childError));
    const id = `__proxy_${++this.internalSeq}`;
    // 复用客户端的 _meta 信封，满足 REA 在 2026-07-28+ 协议版本下的校验
    const outParams = { ...params };
    if (this.clientMeta) outParams._meta = { ...this.clientMeta, ...(outParams._meta ?? {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.writeChild({ jsonrpc: '2.0', id, method, params: outParams });
    });
  }

  async prefetchTools() {
    try {
      const msg = await this.request('tools/list', {}, 60000);
      if (msg.error) throw new Error(msg.error.message);
      const { tools, ...shell } = msg.result ?? {};
      this.childTools = tools ?? [];
      this.childResultShell = shell; // 保留 ttlMs/cacheScope/_meta 等现代协议必需字段
      this.exposedCache = null;
      log(`已缓存 ${this.childTools.length} 个 REA 工具的 schema`);
      this.refreshSnapshot();
    } catch (error) {
      log(`预取工具列表失败：${error.message}`);
    }
  }

  /**
   * 配置热重启后重新握手：把客户端当初那份握手重放到新子进程，
   * 再预取工具列表，最后通知客户端刷新。
   *
   * 一个关键事实：REA 6.5+ 在协商到 2026-07-28 协议后**不再接受 initialize**
   * （回 `Method not found`），握手改用 `server/discover`。所以要重放的是
   * 「客户端最近一次实际成功的那个握手方法」，而不是无条件发 initialize。
   *
   * 不能复用 initId——那是客户端请求的应答通道，被内部请求占用会把
   * 客户端的 initialize 应答吞掉。这里用一次性监听截获新子进程的握手应答。
   * 注意重放必须带上 jsonrpc 字段：REA 会静默丢弃缺它的报文（表现为握手超时）。
   */
  async rehandshakeAndPrefetch() {
    try {
      const handshake = this.lastHandshake;
      if (handshake) {
        const reply = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('重新握手超时')), 30000);
          this.onceInitReply = (msg) => { clearTimeout(timer); resolve(msg); };
          this.writeChild({ ...handshake, id: 'rea-lite-reinit' });
        });
        this.onceInitReply = null;
        if (reply?.error) throw new Error(`${handshake.method}: ${reply.error.message ?? '重新握手失败'}`);
        // initialize 之后客户端还会发 notifications/initialized；server/discover 不需要。
        if (handshake.method === 'initialize' && this.sawInitialized) {
          this.writeChild({ jsonrpc: '2.0', method: 'notifications/initialized' });
        }
        log(`已与新 REA 子进程重新握手（${handshake.method}）`);
      }
      await this.prefetchTools();
      this.writeOut({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    } catch (error) {
      log(`重启后重新握手/预取失败：${error.message}`);
    }
  }

  /** 把工具成本快照落盘，供设置页（dsh-plugin）与 CLI 免启动 REA 直接读取。 */
  refreshSnapshot() {
    if (!this.childTools) return;
    const snapshot = tryWriteSnapshot(this.childTools, this.config);
    if (snapshot) log(`已刷新工具快照：${SNAPSHOT_PATH}（${snapshot.toolCount} 个工具，全量约 ${snapshot.totalTokens} tok）`);
    else log(`工具快照写入失败（${SNAPSHOT_PATH}），设置页将退回仓库内已有的快照`);
  }

  async ensureTools() {
    if (this.childTools) return this.childTools;
    await this.prefetchTools();
    if (!this.childTools) throw new Error(this.childError ?? 'REA 工具列表不可用');
    return this.childTools;
  }

  // ---------- 工具列表 ----------
  /** 本次生效的族表：内置族 + 自定义族 + 追加归类（bundleExtras）。 */
  bundleTable() {
    return effectiveBundles(this.config.customBundles, this.config.bundleExtras);
  }

  async buildExposedTools() {
    const all = await this.ensureTools();
    const wanted = resolveBundleTools(this.activeBundles, this.bundleTable());
    const allWanted = wanted.has('*');
    const exposed = allWanted ? all : all.filter((tool) => wanted.has(tool.name));
    const projected = exposed.map((tool) => projectTool(tool, { lite: this.config.lite, shortDesc: this.config.shortDescription }));
    const meta = this.config.metaTools ? META_TOOLS : [];
    this.exposedCache = { names: new Set(projected.map((t) => t.name)), tokens: estimateTokens(projected) + estimateTokens(meta) };
    return [...meta, ...projected];
  }

  exposedNames() { return this.exposedCache?.names ?? new Set(); }

  setActiveBundles(next) {
    const table = this.bundleTable();
    const cleaned = [...new Set((next ?? []).filter((b) => b === ALL_BUNDLE || table[b]))];
    const before = this.activeBundles.join(',');
    this.activeBundles = cleaned;
    if (this.config.persistRuntimeSwitch) {
      try { saveConfig({ ...this.config, activeBundles: cleaned }); } catch (error) { log(`保存配置失败：${error.message}`); }
    }
    if (before !== cleaned.join(',')) {
      log(`功能族变更：${before || '(无)'} → ${cleaned.join(',') || '(无)'}`);
      this.writeOut({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    }
  }

  async callChildTool(name, args) {
    const msg = await this.request('tools/call', { name, arguments: args }, this.config.toolCallTimeoutMs);
    if (msg.error) {
      return { content: [{ type: 'text', text: `REA 工具 ${name} 调用失败：${msg.error.message}` }], isError: true };
    }
    return msg.result;
  }

  // ---------- 配置热重载 ----------
  watchConfig() {
    let timer = null;
    try {
      fs.watch(this.configPath, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const fresh = loadConfig();
          const changedBundles = fresh.activeBundles.join(',') !== this.activeBundles.join(',');
          const changedShape = fresh.lite !== this.config.lite || fresh.shortDescription !== this.config.shortDescription;
          // 子进程的启动参数与 env 是 spawn 那一刻定下的：改了它们只能重启子进程才生效。
          // 典型场景是给 REA 补 REA_TSHARK_COMMAND 之类的工具路径。
          const changedChild =
            fresh.child.command !== this.config.child.command ||
            JSON.stringify(fresh.child.args) !== JSON.stringify(this.config.child.args) ||
            JSON.stringify(fresh.child.env ?? {}) !== JSON.stringify(this.config.child.env ?? {});
          this.config = fresh;
          this.activeBundles = [...fresh.activeBundles];
          log('config.json 已变更，重新加载');
          if (changedChild) {
            log('子进程启动参数/env 变了，重启 REA');
            try { this.child?.kill(); } catch { /* 已经退出 */ }
            this.childError = null;
            this.childTools = null;
            this.childResultShell = null;
            this.exposedCache = null;
            this.initId = null;
            this.start();
            // 新的 REA 子进程同样需要握手。用客户端当初那份 initialize 重放，
            // 但不占用 initId（那是留给客户端请求的应答通道），应答由下面这个一次性
            // 监听在 prefetchTools 之前消费掉。
            void this.rehandshakeAndPrefetch();
            return;
          }
          if (changedShape) this.refreshSnapshot();
          if (changedBundles) this.writeOut({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        }, 150);
      });
    } catch { /* 文件不存在等情况下忽略热重载 */ }
  }
}

const proxy = new ReaProxy(loadConfig(), CONFIG_PATH);
proxy.start();
proxy.watchConfig();
// 启动时的自动维护：默认全关（config.updates.*.checkOnStart = false），
// 开了就只按配置说的做——checkOnStart 只记日志，autoApply 才会改本机。
// 不阻塞握手：REA 子进程先起来，维护在后台跑，失败也只进 stderr。
void runStartupMaintenance(proxy.config, { root: ROOT, log: (line) => log(`[startup] ${line}`) }).then((actions) => {
  if (actions.length === 0) return;
  const applied = actions.filter((action) => action.updated === true);
  if (applied.length > 0) {
    // 自动更新真的改了安装 → 子进程必须重启，否则工具列表还指着旧版本。
    proxy.config = loadConfig();
    proxy.restartChild('启动自动更新已完成，重启 REA 子进程');
  }
}).catch((error) => log(`启动维护失败：${error?.message ?? error}`));
process.stdin.on('data', (chunk) => proxy.handleClientLine(chunk));
process.stdin.on('end', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
