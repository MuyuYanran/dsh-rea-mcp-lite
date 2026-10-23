# AGENTS.md

给接手这个仓库的 AI 代理（和人类）看的。README 讲**这个项目是什么、怎么用**；这里讲**改代码前必须知道什么、哪些坑已经踩过、验收怎么做**。

先读这三段，能省掉大半返工。

---

## 一、这个仓库到底在解决什么问题

REA（`rea-agents`）是一个 MCP 服务器，提供 207 个逆向工程工具（6.7.0）。直连它，模型每次都要吃掉约 53k token 的工具定义。本仓库是一个 **stdio MCP 代理**，把「工具定义」变成按需加载：默认只暴露 4 个元工具（约 414 tok），其余工具随时可通过 `call_tool` 调用。

核心设计取舍是 **按需暴露（progressive disclosure），不是压缩 schema**。理由在 README 的「为什么不是压缩 schema」一节，实测数据是：REA 报文里 91.4% 是 `outputSchema`，而它根本不进模型上下文。别再把精力花在砍 schema 上。

架构一句话：

```
DSH ──stdio──> src/proxy.mjs ──stdio──> rea.mjs mcp（子进程）
                    │
                    └─ 4 个元工具 + 当前加载族的工具（热切换）
```

---

## 二、动手前必须知道的六条

### 1. 不要把 REA 的工具数量或 token 总量写进代码或断言

这两个数**随 REA 版本漂移，而且方向反直觉**：

| REA | 工具数 | 模型可见成本 |
| --- | --- | --- |
| 6.4.0 | 170 | ~49k tok |
| 6.7.0 | 207 | ~26.7k tok |

工具多了 37 个，成本反而降了 44%——因为 6.7.0 的 `compact` schema profile 裁得更狠（最大的几个工具 schema 从 6–9k 字符压到 500–900）。我为此白查了一轮「快照生成是不是有 bug」。

**正确做法**：一切以 `data/tools-model.json` 为准，测试从它派生基准。参见 `test/plugin.test.mjs` 里的写法——那里曾经写死 `49k`、`99%`、`170`，升级后三个断言全红，而那是版本演进不是回归。

工具描述里也别写数量。`src/meta-tools.mjs` 里那些是**模型直接读到的文本**，写死会让模型拿着过期数字行动。

### 2. 改 `child`（command/args/env）会重启 REA 子进程

`config.json` 的 `child.env` 是给 REA 指定外部工具的入口。子进程的启动参数在 spawn 那一刻就定死了，所以 `watchConfig` 检测到 `child` 变更会：杀掉旧进程 → 用新配置 spawn → **重放握手** → 重取工具列表 → 发 `tools/list_changed`。

两个容易踩的点（都踩过）：

- **重放必须带 `jsonrpc` 字段**。第一版只存了 `{method, params}`，REA 静默丢弃，表现是握手超时而不是报错，查了三轮。
- **握手方法不一定是 `initialize`**。REA 6.5+ 协商到 2026-07-28 协议后**不再接受 `initialize`**（回 `Method not found`），改用 `server/discover`。所以存的是 `lastHandshake`，不是固定的 initialize。
- 旧进程的 `exit`/`error` 回调必须用 `isCurrent()` 守卫，否则主动重启时旧进程退出会把新进程状态改写成「已退出」。

### 3. MCP 2026-07-28 协议有三条硬要求

DSH 内置客户端会自动协商到这个版本。代理必须满足（否则面板显示 0 工具，且 `failOnStartupError:false` 会静默吞掉错误）：

1. 每个出站请求带 `_meta` 信封（`io.modelcontextprotocol/protocolVersion` + `.../clientCapabilities` + `.../clientInfo`）——代理内部向 REA 发的请求也要带，所以 `routeClient` 捕获 `clientMeta` 后 `request()` 复用。
2. 结果对象顶层 `resultType: "complete"`。
3. `tools/list` 结果带 `ttlMs`（整数 ≥0）+ `cacheScope`（`"public"|"private"`）。

排查这类问题**必须用真的 MCP 客户端复现**——手写 JSON-RPC 走旧协议版本复现不出来。

### 4. 三族的外部工具不在这个仓库里

`debug` / `formats` / `capture` 需要外部原生工具（objdump、rizin、GDB、tshark、WABT、sigrok-cli、Cutter）。REA 明确「不安装、不更新」它们，只按 `PATH` 或 `REA_*_COMMAND` 找。

安装方法、选型理由、以及**哪些通路在 Windows 上被 REA 源码硬判平台而根本调不通**，见 `_Tools/README-rea-target-env.md`（在用户机器上，不在这个仓库）。摘要：

- Cutter 只能用 **2.4.1**（2.5.0 的 Windows 构建无法加载任何 Python 插件，最小插件即可复现）
- Cutter 两个版本的 Windows 包都缺 `libffi-8.dll`，不补任何 Python 插件都起不来
- `start_gdb_session`、`start_rizin_debug_session`、`inspect_packet_capture`、`decode_signal_recording` 等要求 Linux + `/proc` 或 `prlimit`，Windows 上无解

改这些相关代码时注意：**路径必须是盘符形式**（`D:/...`），Git Bash 的 `/d/...` 是 MSYS 形式，原生 Windows 进程认不出来。

### 5. 族是静态清单，新增工具必须归族

`src/bundles.mjs` 里的 `BUNDLES` 是显式工具名列表。REA 升级后新增的工具若没归族：

- 会出现在 `bundles` 元工具的 `unassigned` 里
- 会出现在 `node src/cli.mjs status` 的提示里
- 面板上看不到它属于哪族

已归族但当前 REA 版本没有的工具不会报错，只显示为 `missing`。这是有意的：跨版本共存。

REA 每次大版本升级后应该做的事：跑 `node probe/probe-tools.mjs` 导出新工具表 → 对比找新增 → 归族 → 跑 `node src/cli.mjs snapshot`。

### 6. 自定义族与内置族是**并列**关系，不是覆盖

`effectiveBundles(custom)` 把两者合并。让用户改写内置族会在升级时产生难以解释的漂移；自定义族是用户自己的视角，同一个工具可以既在 `native` 又在自定义族里（内置族本来就有重叠）。

---

## 三、代码地图

| 文件 | 职责 | 改动时的注意点 |
| --- | --- | --- |
| `src/proxy.mjs` | 代理主体：路由、预取、暴露计算、配置热重载 | 改握手/热重载逻辑后必跑 `test/reload-child.mjs` |
| `src/meta-tools.mjs` | 4 个元工具的定义 | 这里的文本模型会直接读到，别写死版本相关数字 |
| `src/bundles.mjs` | 族清单与族运算（`effectiveBundles` / `normalizeCustomBundle` / `describeBundles` / `unassignedTools`） | 新增工具归族只改这里 |
| `src/lite.mjs` | schema 裁剪与成本口径（`projectTool` / `modelVisibleChars` / `estimateTokens`） | 成本口径必须与 DSH 的 LLM 层一致：只算 name + description + inputSchema |
| `src/snapshot.mjs` | 工具成本快照生成 | `data/tools-model.json` 是派生数据，可随时重生成 |
| `src/config.mjs` | 配置读写与默认值 | 加新配置键时同步 `config.example.json` |
| `src/cli.mjs` | 命令行：`status` / `list` / `use` / `custom` / `snapshot` | |
| `dsh-plugin/` | DSH 设置页（宿主 + 客户端两半） | 客户端的幂等守卫用 `Symbol.for`，不能用模块级 `Symbol()`（HMR 会重复求值） |
| `test/` | 见下节 | |
| `probe/` | 推导文档里那些数字的一次性分析脚本 | 大体积产物已 gitignore |

`dsh-plugin/lib/index.js` 里有个点容易忘：面板走的是「读取 config → 改 → 写回」的流程，写回时**必须保留 `child` 整块**，否则面板一保存就把外部工具路径抹掉。`saveConfig` 会处理，但别在别处绕开它。

---

## 四、验收：五个脚本，职责不重叠

```bash
node test/plugin.test.mjs    # 90 项：假 Cordis 上下文驱动面板 API + 渲染设置页（不起 REA）
node test/probe.mjs          # 19 项：真代理 + 真 REA，握手/元工具/转发/热加载/自定义族
node test/reload-child.mjs   # 6 项：改 child.env → 重启 → 重新握手 → 重取工具 → 通知客户端
node test/check-config.mjs   # 用真实 config.json 拉起 REA，确认全部工具可达
node e2e-check.mjs           # 9 项：真实代理 → 真实 REA → 真实外部二进制
```

`e2e-check.mjs` 需要外部工具已装（见上面第 4 条）；没装时它会明确报出缺哪个，而不是假装通过。它的样本是**脚本自己生成**的（pcap 手写最小帧、SQLite 用 `node:sqlite`、WASM 用一份已过 `wasm-validate` 的 base64 常量），所以仓库里不塞二进制，也不让被测工具反过来生产测试数据。

**写新断言时**：不要 `sleep` 固定时长赌时序（`reload-child.mjs` 用 `waitFor` 等通知），不要写死版本相关数字，不要用绝对路径（用 `process.execPath` 或临时目录）。

---

## 五、提交约定

- 提交信息用中文，**先写起因（为什么改），再写方案与具体改动，最后写验证结果**。这个仓库的历史提交都是这个结构，照做即可。
- 一次提交一件事。修完一批 bug 再提交，别一个问题一个提交。
- 推送前自查：不能含本机绝对路径、用户名、token。`config.json` 已被 gitignore（模板是 `config.example.json`），实际路径只应该出现在那里。
- 不要动 `.git` 目录本身，git 操作一律走 git 命令。

---

## 六、常见故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 面板显示 0 工具 | MCP 协议三条要求没满足（见第 3 条），错误被 `failOnStartupError:false` 吞掉 | 用真 MCP 客户端复现，别手写 JSON-RPC |
| 改了 `config.json` 但 REA 还是找不到工具 | 改的是 `child.env`，需要重启子进程 | 已实现自动重启；确认日志里有「子进程启动参数/env 变了，重启 REA」 |
| 某个族显示「0 个工具」 | 当前 REA 版本没有这些工具 | 正常，不是坏了 |
| 工具数比文档写的多/少 | 文档数字是按某版本写的 | 以 `data/tools-model.json` 为准 |
| `test/plugin.test.mjs` 报「全量成本」不符 | 快照过期 | `node src/cli.mjs snapshot` |
| Windows 上 `start_gdb_session` 等报 `capability_unavailable` | REA 源码硬判 Linux | 无解，用 Frida 替代 |

---

## 七、这个仓库不做什么

- **不安装外部工具**。那是操作系统层面的事，见 `_Tools/README-rea-target-env.md`。
- **不代理 SSE / HTTP 类 MCP**。只做 stdio。`mode: "direct"` 是预留字段，未实现。
- **不改 REA 的行为**。所有工具调用原样转发，参数不加工（只有在暴露时裁剪 schema，且服务端仍校验完整参数）。
