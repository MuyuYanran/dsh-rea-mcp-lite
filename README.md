# dsh-rea-mcp-lite

**中文** | [English](README.en.md)

> 把 [REA](https://www.npmjs.com/package/rea-agents) 的逆向工程 MCP 工具全部收进 **5 个元工具 + 按需加载的功能族**：
> 默认只摆出元工具、省下绝大部分工具上下文，其余工具**一个都没丢**，随时检索与调用。
> 功能族支持**运行时热切换**（`notifications/tools/list_changed`），无需重启 DSH。
> 自带**更新与体检**：查本仓库与 REA 上游更新、把 REA 新增工具自动归类、提醒本机缺哪些工具。

A tiny zero-dependency MCP stdio proxy that turns REA's full tool set into a progressive-disclosure
gateway: a handful of meta-tools by default, every tool still searchable and callable, with
hot-swappable tool bundles and no DSH restart. Ships update checks (this repo + REA upstream),
automatic bundle classification for new tools, and coverage hints for missing ones.

> 具体工具数、token 与省下的百分比都是 **REA 版本相关**的数字，写在下面的「效果」表里并标注了实测版本；
> 换版本后以 `node src/cli.mjs snapshot` 重跑的结果为准。

---

## 效果

以下数字按 **REA 6.7.0** 实测（`REA_MCP_INPUT_SCHEMA_PROFILE=compact`，`lite: "mild"`）：

| 场景 | 模型可见工具 | 约 token |
| --- | --- | --- |
| **默认（仅元工具）** | 5 | **541** |
| 加载全部（经本代理裁剪后） | 212 | 26.9k |
| 不用本代理（直连 REA，模型可见部分） | 207 | ~53k |

早期版本（REA 6.4.0，170 个工具）直连约 70k tok、经代理全量约 49k tok；
6.7.0 的工具变多而成本反而下降，是因为新版 compact schema profile 的裁剪强度提高了（见「版本适配」）。

## 为什么不是"压缩 schema"

实测 REA 6.7.0 的 `tools/list` 报文（`REA_MCP_INPUT_SCHEMA_PROFILE=compact`）：

| 口径 | 字符数 | 占比 |
| --- | --- | --- |
| REA 实际发出的报文全文 | 2,576,416 | 100%（≈716k tok） |
| `outputSchema` | 2,353,893 | **91.4%** |
| `inputSchema` | 85,705 | 3.3% |
| `description` | 58,934 | 2.3% |
| **真正进模型上下文的（name + description + inputSchema）** | **191,009** | **7.4%（≈53k tok）** |

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

- 716k tok 的报文里 91% 是"看着吓人但不花钱"的部分；
- 砍掉它省 **0%**，裁掉 `pattern`/`format` 之类只省几个百分点，把描述压成一句话省约 2%；
- 真正的成本是 **工具的数量**（当前版本 207 个）。

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
  "activeBundles": [],        // 常驻功能族；[] = 只挂 5 个元工具
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

**(4) 重启 DSH**（cordis 配置只在启动时读取）。重启后 REA 会以 5 个元工具出现。

> 不想用网关时：把 `args` 换成 `rea.mjs` + `mcp` 并删掉 `REA_LITE_CONFIG` 即可直连。

## 5 个元工具

| 工具 | 作用 |
| --- | --- |
| `search_tools` | 在全部 207 个工具里搜（名字 + 说明），返回一句话用途、必填参数、所属族、是否已加载 |
| `tool_schema` | 取某工具的**完整** inputSchema（未裁剪），用于精确构造复杂参数 |
| `call_tool` | 调用**任意**工具（含未加载族的）：`{"tool":"analyze_function","arguments":{"procedure":"main"}}` |
| `bundles` | 列出/切换功能族：`action = list \| activate \| deactivate \| set` |
| `maintenance` | 网关体检与更新：查本仓库/REA 新版、找未归族的新工具并归类、刷新成本快照。默认只读，`action=classify/update-*` 才改本机 |

**不需要先加载功能族就能调用工具** —— 功能族只决定"先把哪些工具的说明书摆到桌面上"。

## 功能族

下表按 **REA 6.7.0（207 个工具，`lite: "mild"`）** 实测；6.4.0 时的数字见下方「版本适配」。

| 族 | 工具数 | 约 token | 内容 |
| --- | --- | --- | --- |
| `native` | 44 | 4.7k | 原生静态分析（伪代码、汇编、交叉引用、注解） |
| `android` | 39 | 3.8k | Android / ADB / JEB（设备、日志、APK、Flutter、HarmonyOS） |
| `evidence` | 16 | 3.4k | 证据治理（对比、验证、未知项、重建账本） |
| `web` | 15 | 2.7k | 网页/浏览器（CDP、网络、脚本、sourcemap） |
| `js` | 13 | 2.6k | JavaScript / Electron 应用图与语义追踪 |
| `debug` | 20 | 2.1k | Frida / GDB / Rizin / Cutter 动态调试 |
| `runtime` | 11 | 2.1k | 运行时捕获与包体（进程、固件、EVM） |
| `nav` | 23 | 1.9k | 会话与导航（打开目标、游标、字节、段表、字节搜索） |
| `apple` | 12 | 1.1k | Objective-C / Swift / plist / 动态库 |
| `managed` | 7 | 1.0k | .NET / 托管程序集 / 托管-原生边界 |
| `formats` | 7 | 1.0k | Go / Rust / WASM / SQLite / Electron fuses / objdump |
| `capture` | 6 | 0.8k | PCAP / TShark / sigrok 逻辑信号 |
| `all` | 207 | 26.3k | 全部（等价于直连 REA 的模型可见部分，但 schema 更瘦） |

> 族之间有重叠（`apple` 的工具也属 `native`，`runtime` 的部分工具同属 `js`/`web`），所以各族 token 相加 > `all`。

> **这里的数字会随 REA 版本漂移**（且方向反直觉，见下节）。上面两个表按 `data/tools-model.json` 的当期快照实测，
> 换版本后以 `node src/cli.mjs snapshot` 重跑的结果为准——别把这些值当作不变量抄进断言或其它文档。

### 版本适配（REA 6.5.0 起）

REA 6.5.0 起新增 `debug` / `formats` / `capture` 三族；6.7.0 共 **207 个工具**，比 6.4.0 多 37 个，
已全部归族（`search_bytes` 补入 `nav`；`identify_flutter_build` / `inspect_dart_aot` /
`project_harmony_application_graph` 补入 `android`）。

| 族 | 工具数 | 内容 | 注意 |
| --- | --- | --- | --- |
| `debug` | 20 | Frida / GDB / Rizin / Cutter 动态调试 | 需目标进程或设备就绪；会改目标状态 |
| `formats` | 7 | Go / Rust / WASM / SQLite / Electron fuses / objdump | 部分依赖外部工具链 |
| `capture` | 6 | PCAP / TShark / sigrok 逻辑信号 | 需装 TShark 4.x / sigrok-cli |

外置工具的安装与 Windows 上的真实可用性见「debug / formats / capture 三族的外部工具」一节。

**成本随版本变化，且方向反直觉**：6.4.0 是 170 工具 / 全量约 49k tok；6.7.0 是 207 工具 / 全量约 26.9k tok。
工具多了三分之一而成本降了近一半，因为 6.7.0 的 compact schema profile 裁剪更狠
（把那批最大的工具 schema 从 6–9k 字符压到 500–900 字符）。所以不要把这几个数字当常量写进断言或文档；
一切都以 `data/tools-model.json` 为准，切版本后重跑 `node src/cli.mjs snapshot`。

**用旧版 REA 时**，这三个族显示 `0 个工具` 并标注「当前 REA 版本无此族」——那不是坏了，是版本没有这些能力。

族是静态清单（`src/bundles.mjs`）。再升级后新增的未归族工具，会出现在 `bundles` 输出的"未归族"里、以及 `node src/cli.mjs status` 的提示里；已归族但当前版本没有的，会显示为缺失而不是报错。

## 自定义分组

内置族按「REA 的能力域」划分，但每个人的常用工具组合不一样。自定义分组让你把任意工具编成一组，之后像内置族一样一键开关。

**在设置页建/改**：「设置 → REA 工具 → 自定义分组」→ 新建或点「编辑」：

- 左边是**全部工具**，每个都带一句话定义与成本，勾选即加入（不必先搜索再选）。
- 右边是本组已选，点 × 移除；也支持把左边的工具**拖进**右边。
- 「整族并入」可把某个内置族的工具一次性全加进来或全移出去，省得一个个点。
- 改组名时，原来勾着的这个组会跟着改名，不会悄悄失效。
- 顶部筛选框按名字或说明过滤，207 个工具里找起来也快。

> 为什么以勾选为主、拖动为辅：WCAG 2.5.7（AA）要求所有拖动操作都必须有非拖动的替代路径，纯拖拽界面对键盘和触屏用户不可用。所以这里是「勾选能用，拖动更好用」。

**用 CLI 建**：

```bash
node src/cli.mjs custom list                       # 看已有的
node src/cli.mjs custom add --id web-audit --label "网页审计" --tools inspect_web_page,analyze_web_bundle,export_web_scripts
node src/cli.mjs custom remove web-audit
```

**直接改配置**：`config.json` 的 `customBundles` 字段：

```json
{
  "customBundles": {
    "web-audit": { "label": "网页审计", "hint": "", "tools": ["inspect_web_page", "analyze_web_bundle"] }
  }
}
```

约束：

- 组名小写字母开头，只含小写字母、数字、`_`、`-`，最长 32；不能与内置族或 `all` 重名。
- 工具名必须真实存在（按当前 REA 版本校验），否则保存时直接报「未知工具」，不会存下一个调不通的组。
- 自定义组与内置族**并列**，不改写内置族；同一个工具可以同时属于内置族和多个自定义组。
- 保存后与改 `activeBundles` 一样走配置监听，约一秒热切换。

## 三种用法

**A. 默认网关模式（推荐）** — 只挂 5 个元工具（约 541 tok），一切靠 `call_tool` 打：
```bash
node src/cli.mjs none
```

**B. 常用族常驻** — 例如天天做 Electron 逆向，让 `nav,js` 常驻（36 个工具，约 4.4k tok；含元工具约 5.0k），其余按需：
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

## 四种开关方式（都热更新，无需重启 DSH）

1. **设置页点选**（最省事，见下一节）——「设置 → REA 工具」勾选功能族，实时看到每个族的 token 成本与实测变化。
2. **直接对模型说** —— "把 web 和 js 族加载上" → 模型调 `bundles {"action":"activate","bundles":["web","js"]}` → 代理发 `list_changed` → DSH 当场换工具集。
3. **改 `config.json`** —— 代理 `fs.watch` 该文件，约 150ms 内生效。
4. **CLI** —— `node src/cli.mjs use web js`（本质就是改 config.json）。

运行时切换会写回 `config.json`（`persistRuntimeSwitch: true`），重启后保持。

## 更新与体检

三个都要问「外面/里面各是什么版本」，所以做成一个共用流水线（`src/updates.mjs` + `src/maintenance.mjs`），
CLI、设置页、元工具 `maintenance` 走同一份实现。

```bash
node src/cli.mjs check                       # 三块一起看：本仓库 / REA 本体 / 工具覆盖
node src/cli.mjs doctor                      # 只看工具覆盖（REA 有但族清单没收录的工具）
node src/cli.mjs update-self [--apply]       # 本仓库快进（git merge --ff-only）
node src/cli.mjs update-rea  [--apply]       # 升级 rea-agents（装完自动刷快照 + 归类）
node src/cli.mjs classify [--apply] [--set tool=bundle,…]
```

`check` 的输出长这样：

```
== 本仓库 ==
  main 落后 origin/main 2 个提交（本地领先 0），可快进
    a18ab29 某个新提交
== REA 本体 ==
  已安装 6.7.0（pnpm @ D:/.../rea-agents）
  npm 上有新版 6.8.0
  装完新版本后运行 node src/cli.mjs snapshot，再 node src/cli.mjs classify —— 新工具要归族才能被功能族加载。
== 工具覆盖 ==
  来源：live；当前 212 个工具，已归族 207 个
  未归族（REA 有、族清单没收录）：5 个
    inspect_wifi_deauth, …
```

三条不可越过的边界：

- **检查只读**。`checkSelfUpdate` 只做 `git fetch` + `rev-list`；`checkReaUpdate` 只读 npm registry 与本地 `package.json`。面板默认用快照算覆盖，不为了看一眼结论去起 REA。
- **写动作要显式**。`update-self` 只走 `--ff-only`，且**工作区脏或本地有未推送提交时直接拒绝**（那是分叉，得人来决定 merge 还是 rebase）；`update-rea` 先备份清单与锁文件到 `_upgrade-backup-<时间戳>/`，装失败会把清单拷回并重装。
- **默认不自动**。`config.updates.*.checkOnStart` 只记日志，`autoApply` 才会真的改本机。两个默认都是 `false`：更新会改你的安装与仓库，必须显式开。

### REA 新版的新工具怎么归类

族清单是静态的，所以 REA 每加工具就会出现「未归族」。`classify` 自动打分并分级：

- 打分用**词元稀有度**：`dart`/`pcap`/`frida` 只出现在一个族（强信号），`inspect`/`verify`/`compare` 遍地都是（弱信号，列进停用词表）。
- 分数够、且明显领先第二名 → `high`，`--apply` 自动写；同分或分数不够 → `medium`/`low`，只给候选。
- `low` 不给建议 —— 新领域（比如 WiFi）宁可留给模型判断。`classify` 会打印一段题面，贴给 DSH 里的模型就能拿回 `{"工具名":"族 id"}` 的 JSON。
- 写入的是 `config.json` 的 `bundleExtras`（`{ "capture": ["inspect_x"] }`），**不改 `bundles.mjs`**：内置清单人工维护，机器判断另存一层，删掉就回到原样。

### 设置页里的「更新与体检」

「设置 → REA 工具 → 更新与体检」：一张卡片显示本仓库/REA/覆盖三块结论，按钮是「更新本仓库」「升级 REA」「刷新快照」「看归类建议」「写入高置信度归类」。检查默认读快照，勾「向 REA 实时查询」才真的起一次 REA。写动作会跑完自动重新检查一遍，改动结果落在日志区。

### 模型侧也能触发

`maintenance` 元工具把同一套动作暴露给模型（默认 `action=report` 只读）：

```
mcp__rea__maintenance { "action": "report" }                     # 三块结论
mcp__rea__maintenance { "action": "classify" }                   # 建议 + 给模型的题面
mcp__rea__maintenance { "action": "classify", "apply": true }     # 写高置信度
mcp__rea__maintenance { "action": "snapshot" }                   # 刷新快照
mcp__rea__maintenance { "action": "update-rea", "apply": true }    # 升级（会重启子进程并重新握手）
```

## 设置页（可选，推荐）

仓库里的 `dsh-plugin/` 是一个 DSH 插件（细节见 [dsh-plugin/README.md](dsh-plugin/README.md)），装好后在 **设置 → REA 工具** 多出一页：

- 勾选框切换功能族，每个族标注工具数与约 token；顶部合计「元工具 + 已勾选族」以及相对全量加载省下的百分比。
- **族内工具可展开**：点「看族内工具」列出该族每个工具名与各自成本，不用为"这族到底有什么"去翻 REA 文档。
- **风险与版本标记**：`debug`/`capture`/`formats` 标「需目标环境」；当前 REA 版本没有的族标「当前 REA 版本无此族」（而不是让你以为勾了没反应）。
- **会话内实测**：DSH 工具注册表里真实存在的 `mcp__rea__*` 数量与字符数 —— 保存后约 1 秒跟随变化，用来确认热切换真的生效。
- 状态灯显示 rea 服务器是 已连接 / 已在 MCP 管理里停用 / 启用但未连上；被停用时额外给出"去 MCP 管理启用"的指引。
- 「查工具属于哪个族」搜索框：在 207 个工具里按名字或说明搜。

```bash
# 装进某个 profile（这里以 desktop 为例；web 同理）—— 依赖与 dsh.profile.bundles 都会自动登记
dsh plugin --profile desktop add link:/path/to/dsh-rea-mcp-lite/dsh-plugin
```

装好后重启一次 DSH 让插件加载；之后改勾选**不需要**重启 —— 面板写 `config.json`，代理监听文件后热切换，约 1 秒生效。

- 面板只管「加载哪些族」，不管 MCP 服务器本身的启停（那是「MCP 管理」的事）。当前 profile 里 `rea` 被停用时，面板会明确提示。
- 插件按「插件行 `root` → `REA_LITE_ROOT` → 仓库布局（本包上一级）→ 包内 `gateway/`」依次找网关；网关装在别处时，设环境变量 `REA_LITE_ROOT` 指向网关目录即可。
- 面板读的是 `data/tools-model.json`（工具成本快照：全部工具的字符数 + 一句话描述 + 所属族），**不含完整 schema**，当前约 37 KB。代理每次连上 REA 都会刷新它；也可以手动 `npm run snapshot` 重新生成。

### 从 npm / 插件市场安装（本机不用克隆仓库）

```bash
npm i -g rea-agents                                 # 网关要连的 REA 本体
dsh plugin --profile desktop add dsh-rea-lite-panel  # 面板 + 包内自带的网关副本
# 还没从 npm 装（或想装预构建包）：直接装 Release 里的 tarball
dsh plugin --profile desktop add "https://github.com/MuyuYanran/dsh-rea-mcp-lite/releases/latest/download/dsh-rea-lite-panel.tgz"
```

发到 npm 的包里**自带一份网关**（`gateway/`：`src/` + 工具快照 + 配置模板），装进 `node_modules`
以后没有「仓库根的 `src/`」也能跑；在仓库里开发时仍以仓库根的 `src/` 为准，副本只是兜底。

面板不负责注册 MCP 服务器，所以还要在 profile 的 `cordis.patch.yml` 里加一行（与源码安装同一份写法，
`args` 指向包内的副本即可）：

```yaml
- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rea
        transport: stdio
        command: node
        args:
          - <profile>/node_modules/dsh-rea-lite-panel/gateway/src/proxy.mjs
        env:
          REA_LITE_CONFIG: <固定路径>/rea-lite/config.json
        failOnStartupError: false
```

`REA_LITE_CONFIG` 别放进 `node_modules`（例如用 `%USERPROFILE%\.dsh\rea-lite\config.json`）：
插件升级会整目录替换，配置写在包内会跟着一起被换掉。把它同时设成本机环境变量，面板与代理才会读写同一份配置。

## 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `activeBundles` | `[]` | 常驻功能族 |
| `metaTools` | `true` | 是否暴露 5 个元工具（关掉就只剩 `activeBundles`） |
| `lite` | `"mild"` | `off` \| `mild` \| `aggressive`，暴露时的 schema/描述裁剪力度 |
| `shortDescription` | `true` | 只给一句话描述（完整说明仍可从 `tool_schema` 拿到） |
| `persistRuntimeSwitch` | `true` | 运行时切换是否写回配置文件 |
| `toolCallTimeoutMs` | `600000` | 单次工具调用超时（反编译类工具有时会跑很久） |
| `customBundles` | `{}` | 用户自定义族：`{ id: { label?, hint?, tools: [...] } }` |
| `bundleExtras` | `{}` | 自动归类追加到内置族的工具：`{ "capture": ["inspect_x"] }`（只追加，不替换） |
| `updates.self` | `{ remote: "origin", checkOnStart: false }` | 本仓库更新；`autoApply: true` 才会在启动时自动快进 |
| `updates.rea` | `{ registry: "https://registry.npmjs.org/rea-agents", checkOnStart: false }` | REA 本体更新；`autoApply: true` 才会在启动时自动升级 |
| `child` | — | 怎么拉起真正的 REA：`command` / `args` / `env` |

- `lite` 的 `mild` 去掉 `pattern`/`format`/`minLength`… 并把描述截到 80 字；`aggressive` 再砍 `examples`/`default` 并截到 50 字。被裁掉的约束 REA 服务端仍会校验，报参数错误时用 `tool_schema` 取原始 schema。
- 环境变量：`REA_LITE_CONFIG` 指定配置文件位置，`REA_LITE_LAUNCHER` 覆盖 REA 启动器路径。
- `child.env` 会合并进 REA 子进程的环境，是给 REA 指定外部工具的入口（`REA_TSHARK_COMMAND` 等）。
  **改动 `child`（command/args/env）会触发子进程热重启**：代理杀掉旧 REA、用新配置重新 spawn、
  重放握手、重取工具列表，再向客户端发 `notifications/tools/list_changed`——
  所以补工具路径不必重启 DSH。（`activeBundles` / `lite` 这类则照旧走轻量热更新。）

## 自检

```bash
node test/probe.mjs         # 19 项集成测试：握手 / 元工具 / 搜索 / 转发 / 热加载 / 热卸载 / 全量 / 自定义族
node test/plugin.test.mjs   # 90 项插件自检：假 Cordis 上下文驱动面板 API + 渲染设置页
node test/maintenance.test.mjs # 81 项：归类打分 / 追加归类 / 工具覆盖 / 版本比较 / 临时真仓库的 git 快进 / 面板新接口
node test/panel-render.test.mjs # 26 项：用最小 React 运行时真的重渲染设置页（含「更新与体检」各分支）
node test/reload-child.mjs  # 6 项子进程热重启：改 child.env → 重启 REA → 重新握手 → 重取工具列表 → 通知客户端
node test/check-config.mjs  # 用真实 config.json 拉起 REA，确认全部工具可达
node e2e-check.mjs          # 9 项外部工具验收：真实代理 → 真实 REA → 真实 objdump/rizin/tshark/WABT/SQLite/Frida/Cutter
node src/cli.mjs snapshot   # 重新生成工具成本快照 data/tools-model.json
```

对应的 npm 脚本：`npm run test:panel` / `test:maintenance` / `test:reload` / `test:e2e` / `test:config` / `probe` / `snapshot` / `check` / `doctor` / `classify`。

这些断言都不写死工具数量与 token 总量——它们随 REA 版本漂移（6.4.0 = 170 工具 / ~49k tok，
6.7.0 = 207 工具 / ~26.9k tok，因为新版 compact schema 裁剪更狠）。基准一律从快照文件派生。

改代码前建议先读 [AGENTS.md](AGENTS.md)：那里记了这个仓库的八条硬约束、代码地图、以及已经踩过的坑。

## debug / formats / capture 三族的外部工具

这三族调用原生工具（objdump、rizin、GDB、tshark、WABT、sigrok-cli、Cutter），
而 **REA 明确不安装它们**，只在运行时按 `PATH` 或 `REA_*_COMMAND` 找。因此需要在操作系统里单独装，
并把绝对路径写进 `child.env`（见 `config.example.json`）。

本机的安装、选型理由、Windows 上的真实可用性（哪些通路被 REA 源码硬判平台而拒绝）、
以及遇到的上游坑（Cutter 2.5.0 Windows 无法加载 Python 插件、缺 `libffi-8.dll` 等），
全部记录在 `_Tools/README-rea-target-env.md`，配套入口脚本 `_Tools/rea-target-env.sh`。


## 配套的模型侧说明

- `skill/SKILL.md` —— 独立的"网关模式"技能，教模型用这些元工具（可复制到 `~/.agents/skills/rea-tool-gateway/`）。
- 若已安装 REA 官方技能 `reverse-engineer-anything`，建议在其 `SKILL.md` 顶部加一段说明：工具列表只剩元工具时，照常用 `call_tool` 干活（本仓库 README 的措辞可直接借用）。

## 已知限制

- 首次握手会向 REA 拉一次全量工具表（6.7.0 为 207 个 / 约 2.6MB，实测 ~4.5s 完成握手+列表），之后走缓存。
- 被裁剪的 schema 关键字让**调用前**的参数预校验变松，错误会晚一步由 REA 抛出（表现为工具返回结构化错误）。
- 仅代理 stdio 类 MCP；`mode: "direct"` 是预留字段，未实现绕过网关的分支。
- DSH 的 LLM 层已有 `defer_loading` 字段（`tool.deferLoading`）。若将来 DSH 允许在 MCP 工具上开启它，原生方案会比本代理更省；目前用不上，列为后续方向。
- 工具成本快照 `data/tools-model.json` 里的数字随 REA 版本变化，切换版本后应重跑 `node src/cli.mjs snapshot`，
  否则设置页显示的是旧版本的成本。
- 自动归类只处理**名字/描述里的词**。REA 若引入全新领域（例如无线抓包），专属词在旧族里一个都没有，
  它会诚实地报「low / 无建议」而不是硬猜；这时用 `classify` 打印的题面让模型判断，再由 `--set` 写入。
- 更新检查依赖外网（git 远端 / npm registry）。离线时 `check` 会在对应块写「取远端失败」而不影响其它块；
  面板默认用快照算覆盖，所以离线也能看到未归族清单。

## 本机部署记录（作者环境）

- 代理接管的条目在本机 `~/.dsh/cordis.patch.yml` 的 `rea-mcp`（`serverName: rea`），备份为 `cordis.patch.yml.bak-rea-lite-*`。
- `probe/` 里是推导上面那些数字的分析脚本与原始抓包（大体积文件已 `.gitignore`）。
- 分析脚本：`probe/inspect-asar.mjs`（解析 Electron `app.asar`）、`probe/asar-grep.mjs`（在 asar 内做内容检索）、`probe/analyze-tools.mjs`、`probe/inspect-shape.mjs`、`probe/write-names.mjs`。

## License

MIT
