#!/usr/bin/env node
// rea-mcp-lite —— 夹在 DSH 与 REA 之间的 MCP stdio 代理。
//
// 它做四件事：
//   1. 只把「按需加载的功能族 + 4 个元工具」暴露给模型，REA 的 170 个工具保持全部可达；
//   2. 裁剪暴露工具的 schema/描述（outputSchema 保留，因为它不进模型上下文、只用于结果校验）；
//   3. 支持运行时开关功能族：改写后的工具列表通过 notifications/tools/list_changed 热更新，无需重启 DSH；
//   4. 其余 JSON-RPC 消息（工具调用、资源、通知）原样双向转发。
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { BUNDLES, ALL_BUNDLE, resolveBundleTools, effectiveBundles } from './bundles.mjs';
import { projectTool, estimateTokens } from './lite.mjs';
import { META_TOOLS, META_NAMES, handleMetaTool, describeExposedText } from './meta-tools.mjs';
import { CONFIG_PATH, loadConfig, saveConfig } from './config.mjs';
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
    };
  }

  // ---------- 传输层 ----------
  writeOut(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
  writeChild(message) { if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(message) + '\n'); }

  start() {
    const { command, args, env } = this.config.child;
    log(`启动 REA：${command} ${args.join(' ')}`);
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    this.child.stdout.on('data', makeLineReader((msg) => this.onChildMessage(msg)));
    this.child.stderr.on('data', (chunk) => process.stderr.write(`[rea] ${chunk}`));
    this.child.on('error', (error) => {
      this.childError = `无法启动 REA：${error.message}`;
      log(this.childError);
      this.failInit();
    });
    this.child.on('exit', (code, signal) => {
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
      this.initTimer = setTimeout(() => { this.childError = '等待 REA 初始化超时（30 秒）'; this.failInit(); }, 30000);
      this.writeChild(msg);
      return;
    }
    if (msg.method === 'notifications/initialized') { this.writeChild(msg); return; }
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
  /** 本次生效的族表：内置族 + 配置里的自定义族。 */
  bundleTable() {
    return effectiveBundles(this.config.customBundles);
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
          this.config = fresh;
          this.activeBundles = [...fresh.activeBundles];
          log('config.json 已变更，重新加载');
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
process.stdin.on('data', (chunk) => proxy.handleClientLine(chunk));
process.stdin.on('end', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { proxy.child?.kill(); } catch {} process.exit(0); });
