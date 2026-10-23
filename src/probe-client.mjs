// 与 REA 子进程的一次性会话：拿 tools/list。
//
// CLI（snapshot / list / classify）与「拉取 REA 更新」都要问 REA「你这一版有哪些工具」，
// 所以把这段握手收敛到一处。两条握手法都要会：
//   - REA 6.5+ 协商到 2026-07-28 协议后**不再接受 initialize**（回 Method not found），
//     改用 server/discover，且每个请求都要求带 _meta 信封；
//   - 旧行为（initialize + 2024-11-05）留作兜底，别的地方仍在用。
import { spawn } from 'node:child_process';

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'rea-mcp-lite-probe', version: '1.0.0' },
};

/**
 * 起一个短命 REA 会话，返回它的工具列表。
 *
 * @param {{command:string,args:string[],env?:object}} childConfig config.child
 * @param {{timeoutMs?:number, onStderr?:(text:string)=>void}} [opts]
 * @returns {Promise<{tools:object[], serverInfo:object|null, protocol:string, shell:object}>}
 */
export function probeTools(childConfig, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120000;
  return new Promise((resolve, reject) => {
    const child = spawn(childConfig.command, childConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(childConfig.env ?? {}) },
      windowsHide: true,
    });
    const pending = new Map();
    let seq = 0;
    let buffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* 已经退出 */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`REA 工具列表超时（${timeoutMs}ms）`)), timeoutMs);
    child.on('error', (error) => finish(new Error(`无法启动 REA：${error.message}`)));
    child.stderr.on('data', (chunk) => opts.onStderr?.(chunk.toString()));

    const send = (method, params, timeout = timeoutMs) => new Promise((res, rej) => {
      const id = ++seq;
      const guard = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 超时`)); }, timeout);
      pending.set(id, { res: (msg) => { clearTimeout(guard); res(msg); }, rej: (error) => { clearTimeout(guard); rej(error); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === '') continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const entry = pending.get(msg.id);
          pending.delete(msg.id);
          entry.res(msg);
        }
      }
    });

    const run = async () => {
      // 现代协议：server/discover 握手 + 带 _meta 的 tools/list
      let protocol = '2026-07-28';
      let serverInfo = null;
      const discover = await send('server/discover', { _meta: MODERN_META }, 30000);
      if (discover.error) {
        // 老版本 REA：退回 initialize
        protocol = '2024-11-05';
        const init = await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: MODERN_META['io.modelcontextprotocol/clientInfo'],
        }, 30000);
        if (init.error) throw new Error(`握手失败：${init.error.message ?? JSON.stringify(init.error)}`);
        serverInfo = init.result?.serverInfo ?? null;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      } else {
        serverInfo = discover.result?.serverInfo ?? null;
      }
      const list = await send('tools/list', protocol === '2026-07-28' ? { _meta: MODERN_META } : {});
      if (list.error) throw new Error(`tools/list 失败：${list.error.message ?? JSON.stringify(list.error)}`);
      const { tools, ...shell } = list.result ?? {};
      return { tools: tools ?? [], serverInfo, protocol, shell };
    };

    run().then((value) => finish(null, value), (error) => finish(error));
  });
}

/** 只要工具名。取不到时返回空数组（调用方自己决定是否当作错误）。 */
export async function probeToolNames(childConfig, opts) {
  const { tools } = await probeTools(childConfig, opts);
  return tools.map((tool) => tool.name);
}
