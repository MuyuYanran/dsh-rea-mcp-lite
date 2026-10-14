# dsh-rea-mcp-lite

> 把 [REA](https://www.npmjs.com/package/rea-agents) 的 **170 个逆向工程 MCP 工具**压成 **4 个元工具 + 按需加载的功能族**，
> 默认省下 **99.4%** 的工具上下文（~70k tok → **411 tok**），而 170 个工具**一个都没丢**，全部仍可调用。
> 功能族支持**运行时热切换**（`notifications/tools/list_changed`），无需重启 DSH。

A tiny zero-dependency MCP stdio proxy that turns REA's 170 tools into a progressive-disclosure
gateway: 4 meta-tools by default (~411 tokens instead of ~70k), every tool still reachable,
with hot-swappable tool bundles and no DSH restart.

---

## 效果

| 场景 | 模型可见工具 | 约 token |
| --- | --- | --- |
| **默认（仅元工具）** | 4 | **411** |
| 只加载 `web` 族 | 19 | 3.1k |
| 加载全部（裁剪后） | 174 | 49.4k |
| 不用本代理（直连 REA） | 170 | ~70.3k |

## 为什么不是"压缩 schema"

实测 REA 的 `tools/list`（`REA_MCP_INPUT_SCHEMA_PROFILE=compact`）：

| 口径 | 字符数 | 占比 |
| --- | --- | --- |
| REA 实际发出的报文 | 1,772,584 | 100%（≈492k tok） |
| `outputSchema` | 1,493,900 | **84.3%** |
| `inputSchema` | 183,725 | 10.4% |
| `description` | 58,934 | 3.3% |
| **真正进模型上下文的（name + description + inputSchema）** | **253,136** | **≈70.3k tok** |

DSH 组装 LLM 请求时只映射三个字段 —— `@deepseek-ai/dsh-llm-deepseek/lib/index.js`：

```js
tools: options.tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,          // ← 即 MCP 的 inputSchema
  ...tool.deferLoading === true ? { defer_loading: true } : {}
}))
```

`outputSchema` 只在 DSH 内部用于校验工具返回值，**完全不占上下文**。所以：

- 492k 报文里 84% 是"看着吓人但不花钱"的部分；
- 砍掉它省 **0%**，裁掉 `pattern`/`format` 之类只省 **9%**，把描述压成一句话省 31%；
- 真正的成本是 **工具的数量**（170 个）。

于是本项目的核心是 **按需暴露（progressive disclosure）**，而不是压缩 schema。schema 瘦身只作为附带优化（`lite` 档位）。

## 工作原理

```
DSH ──stdio JSON-RPC──> proxy.mjs ──stdio JSON-RPC──> rea.mjs mcp（子进程）
```

零依赖，手写按行切分的 JSON-RPC（MCP stdio 就是一行一个 JSON，无 Content-Length 帧）。

| 消息 | 处理 |
| --- | --- |
| `initialize` | 转发；改写 `serverInfo.name` 为 `rea-lite`，并注入一段 `instructions` 教模型用网关 |
| `tools/list` | **不转发**，由代理用缓存的 REA 工具表 + 配置现场合成（元工具 + 已加载族，按 `lite` 裁剪） |
| `tools/call` | 名字是元工具就地处理；其余原样转发，结果原样回传（含图片、结构化错误） |
| 其它 | `notifications/*`、`resources/*`、`ping` 双向直通 |
| 热更新 | 族变化 → 代理发 `notifications/tools/list_changed`；DSH 的 MCP client 对它注册了 `onChanged: () => refreshTools()`，因此换工具集无需重启 |

## 安装

```bash
git clone https://github.com/MuyuYanran/dsh-rea-mcp-lite.git
cd dsh-rea-mcp-lite
```

**(1) 准备 REA**（本代理只是网关，真正干活的还是 REA）：

```bash
npm i -g rea-agents          # 或 pnpm add rea-agents；也可用 npx
# 也可以用官方技能：rea setup --skill --yes
```

**(2) 写配置**：复制 `config.example.json` 为 `config.json`，把 `child.args[0]` 改成你的 `rea.mjs` 绝对路径、`env.JAVA_HOME` 改成你的 JDK 路径。

```bash
cp config.example.json config.json   # Windows: Copy-Item config.example.json config.json
```

```jsonc
{
  "activeBundles": [],        // 常驻功能族；[] = 只挂 4 个元工具
  "lite": "mild",             // off | mild | aggressive
  "child": {
    "command": "node",        // 建议写 node 的绝对路径
    "args": ["<...>/node_modules/rea-agents/scripts/rea.mjs", "mcp"],
    "env": { "REA_MCP_INPUT_SCHEMA_PROFILE": "compact", "JAVA_HOME": "<你的 JDK>" }
  }
}
```

**(3) 注册到 DSH**：在 `~/.dsh/cordis.patch.yml` 加一条（`serverName` 用 `rea` 可与 REA 官方技能里的引用保持一致）：

```yaml
- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rea
        transport: stdio
        command: 'C:\Program Files\nodejs\node.exe'   # 或 DSH 内置 node 的绝对路径
        args:
          - 'D:\path\to\dsh-rea-mcp-lite\src\proxy.mjs'
        env:
          REA_LITE_CONFIG: 'D:\path\to\dsh-rea-mcp-lite\config.json'
          JAVA_HOME: 'D:\path\to\jdk'
        failOnStartupError: false
```

**(4) 重启 DSH**（cordis 配置只在启动时读取）。重启后 REA 会以 4 个元工具出现。

> 不想用网关时：把 `args` 换成 `rea.mjs` + `mcp` 并删掉 `REA_LITE_CONFIG` 即可直连。

## 4 个元工具

| 工具 | 作用 |
| --- | --- |
| `search_tools` | 在全部 170 个工具里搜（名字 + 说明），返回一句话用途、必填参数、所属族、是否已加载 |
| `tool_schema` | 取某工具的**完整** inputSchema（未裁剪），用于精确构造复杂参数 |
| `call_tool` | 调用**任意**工具（含未加载族的）：`{"tool":"analyze_function","arguments":{"procedure":"main"}}` |
| `bundles` | 列出/切换功能族：`action = list \| activate \| deactivate \| set` |

**不需要先加载功能族就能调用工具** —— 功能族只决定"先把哪些工具的说明书摆到桌面上"。

## 功能族

| 族 | 工具数 | 约 token | 内容 |
| --- | --- | --- | --- |
| `nav` | 22 | 3.2k | 会话与导航（打开目标、游标、字节、段表） |
| `native` | 44 | 5.6k | 原生静态分析（伪代码、汇编、交叉引用、注解） |
| `apple` | 12 | 1.9k | Objective-C / Swift / plist / 动态库 |
| `managed` | 7 | 5.5k | .NET / 托管程序集 / 托管-原生边界 |
| `js` | 13 | 12.3k | JavaScript / Electron 应用图与语义追踪 |
| `web` | 15 | 2.7k | 网页/浏览器（CDP、网络、脚本、sourcemap） |
| `android` | 36 | 4.3k | Android / ADB / JEB（设备、日志、APK） |
| `evidence` | 16 | 12.2k | 证据治理（对比、验证、未知项、重建账本） |
| `runtime` | 11 | 6.2k | 运行时捕获与包体（进程、固件、EVM） |
| `all` | 170 | 49.4k | 全部（等价于直连 REA，但 schema 更瘦） |

> 族之间有重叠（`apple` 的工具也属 `native`，`runtime` 的部分工具同属 `js`/`web`），所以各族 token 相加 > `all`。
> 族是一份静态清单（`src/bundles.mjs`）。REA 升级后新增的工具会出现在 `bundles` 输出的"未归族"里，手工归入即可。

## 三种用法

**A. 默认网关模式（推荐）** — 只挂 4 个元工具（411 tok），一切靠 `call_tool` 打：
```bash
node src/cli.mjs none
```

**B. 常用族常驻** — 例如天天做 Electron 逆向，让 `nav,js` 常驻（16.5k tok），其余按需：
```bash
node src/cli.mjs use nav js
```

**C. 全量** — 需要模型一次性看到所有工具（例如让它自己规划长流程）：
```bash
node src/cli.mjs all
```

```bash
node src/cli.mjs list      # 带实时 token 估算的功能族一览
node src/cli.mjs status    # 当前配置
```

## 三种开关方式（都热更新，无需重启 DSH）

1. **直接对模型说** —— "把 web 和 js 族加载上" → 模型调 `bundles {"action":"activate","bundles":["web","js"]}` → 代理发 `list_changed` → DSH 当场换工具集。
2. **改 `config.json`** —— 代理 `fs.watch` 该文件，约 150ms 内生效。
3. **CLI** —— `node src/cli.mjs use web js`（本质就是改 config.json）。

运行时切换会写回 `config.json`（`persistRuntimeSwitch: true`），重启后保持。

## 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `activeBundles` | `[]` | 常驻功能族 |
| `metaTools` | `true` | 是否暴露 4 个元工具（关掉就只剩 `activeBundles`） |
| `lite` | `"mild"` | `off` \| `mild` \| `aggressive`，暴露时的 schema/描述裁剪力度 |
| `shortDescription` | `true` | 只给一句话描述（完整说明仍可从 `tool_schema` 拿到） |
| `persistRuntimeSwitch` | `true` | 运行时切换是否写回配置文件 |
| `toolCallTimeoutMs` | `600000` | 单次工具调用超时（反编译类工具有时会跑很久） |
| `child` | — | 怎么拉起真正的 REA：`command` / `args` / `env` |

- `lite` 的 `mild` 去掉 `pattern`/`format`/`minLength`… 并把描述截到 80 字；`aggressive` 再砍 `examples`/`default` 并截到 50 字。被裁掉的约束 REA 服务端仍会校验，报参数错误时用 `tool_schema` 取原始 schema。
- 环境变量：`REA_LITE_CONFIG` 指定配置文件位置，`REA_LITE_LAUNCHER` 覆盖 REA 启动器路径。

## 自检

```bash
node test/probe.mjs         # 16 项集成测试：握手 / 元工具 / 搜索 / 转发 / 热加载 / 热卸载 / 全量
node test/check-config.mjs  # 用真实 config.json 拉起 REA，确认 170 工具可达
```

## 配套的模型侧说明

- `skill/SKILL.md` —— 独立的"网关模式"技能，教模型用这 4 个元工具（可复制到 `~/.agents/skills/rea-tool-gateway/`）。
- 若已安装 REA 官方技能 `reverse-engineer-anything`，建议在其 `SKILL.md` 顶部加一段说明：工具列表只剩 4 个元工具时，照常用 `call_tool` 干活（本仓库 README 的措辞可直接借用）。

## 已知限制

- 首次握手会向 REA 拉一次 170 工具全表（约 1.7MB，实测 ~4.5s 完成握手+列表），之后走缓存。
- 被裁剪的 schema 关键字让**调用前**的参数预校验变松，错误会晚一步由 REA 抛出（表现为工具返回结构化错误）。
- 仅代理 stdio 类 MCP；`mode: "direct"` 是预留字段，未实现绕过网关的分支。
- DSH 的 LLM 层已有 `defer_loading` 字段（`tool.deferLoading`）。若将来 DSH 允许在 MCP 工具上开启它，原生方案会比本代理更省；目前用不上，列为后续方向。

## 本机部署记录（作者环境）

- 代理接管的条目在本机 `~/.dsh/cordis.patch.yml` 的 `rea-mcp`（`serverName: rea`），备份为 `cordis.patch.yml.bak-rea-lite-*`。
- `probe/` 里是推导上面那些数字的分析脚本与原始抓包（大体积文件已 `.gitignore`）。
- 分析脚本：`probe/inspect-asar.mjs`（解析 Electron `app.asar`）、`probe/asar-grep.mjs`（在 asar 内做内容检索）、`probe/analyze-tools.mjs`、`probe/inspect-shape.mjs`、`probe/write-names.mjs`。

## License

MIT
