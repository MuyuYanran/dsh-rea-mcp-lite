import { loadConfig, CONFIG_PATH } from "../src/config.mjs";
import { spawn } from "node:child_process";
const c = loadConfig();
console.log("配置:", CONFIG_PATH);
console.log("启动:", c.child.command);
console.log("参数:", c.child.args.join(" "));
const child = spawn(c.child.command, c.child.args, { stdio:["pipe","pipe","pipe"], env:{...process.env, ...c.child.env}, windowsHide:true });
const t0 = Date.now();
let buf = "";
child.stderr.on("data", d => process.stderr.write("[rea] " + d));
child.stdout.on("data", ch => { buf += ch; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0,i).trim(); buf = buf.slice(i+1); if(!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.id === 1) { child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list",params:{}})+"\n"); }
  if (m.id === 2) { console.log(`工具数: ${m.result.tools.length}  耗时 ${Date.now()-t0}ms`); child.kill(); process.exit(m.result.tools.length === 170 ? 0 : 1); }
}});
child.on("exit", code => { if (code !== null && code !== 0) { console.log("REA 提前退出 code=" + code); process.exit(1); } });
child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"check",version:"0"}}})+"\n");
setTimeout(() => { console.log("超时"); child.kill(); process.exit(1); }, 90000);
