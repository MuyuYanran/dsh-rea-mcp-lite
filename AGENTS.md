# AGENTS.md

给接手这个仓库的 AI 代理（和人类）看的。README 讲**这个项目是什么、怎么用**；这里讲**改代码前必须知道什么、哪些坑已经踩过、验收怎么做**。

先读这三段，能省掉大半返工。

---

## 一、这个仓库到底在解决什么问题

REA（`rea-agents`）是一个 MCP 服务器，提供 207 个逆向工程工具（6.7.0）。直连它，模型每次都要吃掉约 53k token 的工具定义。本仓库是一个 **stdio MCP 代理**，把「工具定义」变成按需加载：默认只暴露 5 个元工具（约 541 tok），其余工具随时可通过 `call_tool` 调用。

核心设计取舍是 **按需暴露（progressive disclosure），不是压缩 schema**。理由在 README 的「为什么不是压缩 schema」一节，实测数据是：REA 报文里 91.4% 是 `outputSchema`，而它根本不进模型上下文。别再把精力花在砍 schema 上。

架构一句话：

```
DSH ──stdio──> src/proxy.mjs ──stdio──> rea.mjs mcp（子进程）
                    │
                    └─ 5 个元工具 + 当前加载族的工具（热切换）
```

---

## 二、动手前必须知道的九条

### 1. 不要把 REA 的工具数量或 token 总量写进代码或断言

这两个数**随 REA 版本漂移，而且方向反直觉**：

| REA | 工具数 | 全量成本（含元工具） |
| --- | --- | --- |
| 6.4.0 | 170 | ~49k tok |
| 6.7.0 | 207 | ~26.9k tok |

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

**自动归类**（`src/classify.mjs`）：`node src/cli.mjs classify` 给未归族工具打分并给建议，`--apply` 把高置信度的写进 `config.json` 的 `bundleExtras`，`--set tool=bundle,…` 手工指定。`update-rea --apply` 升级完会自动跑一遍。

三个坑（都踩过）：

- **别用硬编码关键词表**。第一版给每族列关键词，结果 `verify_swift_protocol_conformance` 被 `verify` 拉去 evidence 而不是 apple。现在用**词元稀有度**（df：一个词出现在几个族里）+ 停用词表：专属词（dart/pcap/frida）权重高，通用动词（inspect/verify/compare）权重低。
- **置信度要诚实**。高置信度不仅要求分数，还要求明显领先第二名（`CONFIDENT_MARGIN`）。同分就写「不确定」，别自动写。
- **归类结果写 `bundleExtras`，不改 `bundles.mjs`**。`effectiveBundles(custom, extras)` 做增量合并；内置清单保持人工维护，机器判断另存一层，删掉就回到原样。

### 6. 自定义族、内置族、追加归类是**三者并列**，不是覆盖

`effectiveBundles(custom, extras)` 依次合并：内置族 → 自定义族 → 追加归类。让用户改写内置族会在升级时产生难以解释的漂移；自定义族是用户自己的视角，同一个工具可以既在 `native` 又在自定义族里（内置族本来就有重叠）。

### 7. 自动更新默认全关，写动作必须显式

`src/updates.mjs` + `src/maintenance.mjs` 做三件事：查本仓库（git 远端）、查 REA 本体（npm registry）、算工具覆盖差集。

- `config.updates.*.checkOnStart` 只记日志；`autoApply` 才会改本机。
- `checkSelfUpdate` 只做 `git fetch` 与 `rev-list`，**从不** merge；`applySelfUpdate` 只走 `git merge --ff-only`，并且**脏工作区或有本地提交时直接拒绝** —— 那不是脚本能替人决定的事。
- `applyReaUpdate` 先把清单/锁文件备份到 `_upgrade-backup-<时间戳>/`，装失败会把清单拷回并重装。
- 面板与元工具的写动作都是白名单 action，未知 action 报出可用列表。

### 8. `CONFIG_PATH` 常量会把真实配置写脏

`config.mjs` 导出的 `CONFIG_PATH` 是**模块求值那一刻**的路径；之后改 `REA_LITE_CONFIG` 它不会跟着变。第一版 `saveConfig` 用了常量，自检脚本于是把真实 `config.json` 写了 `bundleExtras`。现在读写都走 `configPath()`（每次读环境变量）。在同进程里换配置目录时，别再引用常量。

### 9. 发 npm 与上架市场：包内的网关副本是生成物，别当源码改

`dsh-plugin/` 就是发到 npm 的那个包（`dsh-rea-lite-panel`）。npm 只能打包自己目录以内的文件，
装进 `node_modules` 后没有「仓库根的 `src/`」，所以 `scripts/pack-gateway.mjs` 在 `prepack` 时把
`../src`、`../data/tools-model.json`、`../config.example.json`、`../LICENSE` 复制成
`dsh-plugin/gateway/` 与 `dsh-plugin/LICENSE`（两者都在 `.gitignore`）。

- **改网关只改仓库根的 `src/`**，副本每次 pack 重新生成。改副本等于下次发包被覆盖。
- 面板找网关的顺序在 `lib/index.js` 的 `gatewayCandidates`：插件行 `root` → `REA_LITE_ROOT` →
  `REA_LITE_CONFIG` 所在目录 → 仓库布局 → 包内副本。**副本必须排最后**，否则本地开发会读到旧代码。
- 副本脚本的日志一律走 stderr：`npm pack --json` / `npm publish` 读的是 stdout，往 stdout 打印会把 JSON 弄坏。
- 上架 dsh-market **不是**往 `dshmarket` 仓库提 PR。条目在 `awesome-dsh-plugin/awesome-dsh-plugin` 的
  `data/plugins/<owner>__<repo>[--<子目录>].yml`，一个插件一个文件，两个 README 由脚本生成（别手改）。
  子包条目写成 `url: https://github.com/<owner>/<repo>/tree/main/dsh-plugin` + `name: <owner>/<repo>#dsh-plugin`
  + 文件名 `<owner>__<repo>--dsh-plugin.yml`。CI 会真的去读那个子目录的 `dsh.bundle`，并核对描述里的每个声明。

---

## 三、代码地图

| 文件 | 职责 | 改动时的注意点 |
| --- | --- | --- |
| `src/proxy.mjs` | 代理主体：路由、预取、暴露计算、配置热重载 | 改握手/热重载逻辑后必跑 `test/reload-child.mjs` |
| `src/meta-tools.mjs` | 5 个元工具的定义 | 这里的文本模型会直接读到，别写死版本相关数字 |
| `src/bundles.mjs` | 族清单与族运算（`effectiveBundles` / `normalizeCustomBundle` / `describeBundles` / `unassignedTools`） | 新增工具归族只改这里 |
| `src/lite.mjs` | schema 裁剪与成本口径（`projectTool` / `modelVisibleChars` / `estimateTokens`） | 成本口径必须与 DSH 的 LLM 层一致：只算 name + description + inputSchema |
| `src/snapshot.mjs` | 工具成本快照生成 | `data/tools-model.json` 是派生数据，可随时重生成 |
| `src/config.mjs` | 配置读写与默认值 | 加新配置键时同步 `config.example.json`；读写走 `configPath()` 而非 `CONFIG_PATH` |
| `src/classify.mjs` | 智能归类：词元稀有度打分、置信度分级、写入 `bundleExtras` | 别退回硬编码关键词表；置信度必须要求领先第二名 |
| `src/updates.mjs` | 更新检查与应用（git 快进 / npm 升级 / 工具覆盖差集） | 检查必须只读；快进只在干净且无本地提交时执行 |
| `src/maintenance.mjs` | 把体检/更新/归类/快照串成流水线，CLI 与面板与元工具共用 | 写动作只在这里实现一份，别在入口处复制判断 |
| `src/probe-client.mjs` | 一次性 REA 会话取 `tools/list`（兼容现代/旧握手） | 现代协议要带 `_meta`；两代握手都要能连 |
| `src/cli.mjs` | 命令行：`status` / `list` / `use` / `custom` / `snapshot` / `classify` / `check` / `doctor` / `update-self` / `update-rea` | |
| `dsh-plugin/` | DSH 设置页（宿主 + 客户端两半），也是发布到 npm 的包 | 客户端的幂等守卫用 `Symbol.for`，不能用模块级 `Symbol()`（HMR 会重复求值）；`gateway/` 与 `LICENSE` 是 prepack 生成物，别手改（见第 9 条） |
| `test/` | 见下节 | |
| `probe/` | 推导文档里那些数字的一次性分析脚本 | 大体积产物已 gitignore |

`dsh-plugin/lib/index.js` 里有个点容易忘：面板走的是「读取 config → 改 → 写回」的流程，写回时**必须保留 `child` 整块**，否则面板一保存就把外部工具路径抹掉。`saveConfig` 会处理，但别在别处绕开它。

---

## 四、验收：七个脚本，职责不重叠

```bash
node test/plugin.test.mjs    # 90 项：假 Cordis 上下文驱动面板 API + 渲染设置页（不起 REA）
node test/maintenance.test.mjs # 81 项：归类打分、追加归类、工具覆盖、版本比较、临时真仓库的 git 快进、面板新接口
node test/panel-render.test.mjs # 26 项：最小 React 运行时重渲染整页（plugin.test.mjs 只覆盖首屏）
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
- **README 有两份，改一份等于没改**：`README.md` 是中文，`README.en.md` 是英文，两份章节结构必须一一对应、数字必须一致，顶部有互链。改动 README 时两份一起改，只改一份视为未完成。
- 不要动 `.git` 目录本身，git 操作一律走 git 命令。

---

## 六、常见故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 设置页白屏 / 「更新与体检」区块不显示 | 渲染层取错属性（首屏测试覆盖不到） | `node test/panel-render.test.mjs`，它会用带数据的状态重渲染整页 |
| 面板显示 0 工具 | MCP 协议三条要求没满足（见第 3 条），错误被 `failOnStartupError:false` 吞掉 | 用真 MCP 客户端复现，别手写 JSON-RPC |
| 改了 `config.json` 但 REA 还是找不到工具 | 改的是 `child.env`，需要重启子进程 | 已实现自动重启；确认日志里有「子进程启动参数/env 变了，重启 REA」 |
| 某个族显示「0 个工具」 | 当前 REA 版本没有这些工具 | 正常，不是坏了 |
| 工具数比文档写的多/少 | 文档数字是按某版本写的 | 以 `data/tools-model.json` 为准 |
| `test/plugin.test.mjs` 报「全量成本」不符 | 快照过期 | `node src/cli.mjs snapshot` |
| Windows 上 `start_gdb_session` 等报 `capability_unavailable` | REA 源码硬判 Linux | 无解，用 Frida 替代 |
| REA 升级后出现「未归族」工具 | 族清单是静态的 | `node src/cli.mjs classify`，高置信度 `--apply` |
| `update-rea --apply` 后工具列表还是旧的 | 子进程没重启 | 代理自己会重启；面板/CLI 单独跑时需重启 DSH 或让代理重连 |
| 面板「更新与体检」结论显示「无法检查：这个目录不是 git 仓库」 | 网关目录不在 git 仓库里（plugin 的 root 指错） | 检查插件行 `config.root` / `REA_LITE_ROOT` |

---

## 七、这个仓库不做什么

- **不安装外部工具**。那是操作系统层面的事，见 `_Tools/README-rea-target-env.md`。
- **不代理 SSE / HTTP 类 MCP**。只做 stdio。`mode: "direct"` 是预留字段，未实现。
- **不改 REA 的行为**。所有工具调用原样转发，参数不加工（只有在暴露时裁剪 schema，且服务端仍校验完整参数）。
