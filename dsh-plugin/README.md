# dsh-rea-lite-panel

[rea-mcp-lite](https://github.com/MuyuYanran/dsh-rea-mcp-lite) 的设置页：在 **设置 → REA 工具** 里勾选功能族、看清每个族的上下文成本、约一秒热切换，不用改配置文件也不用重启 DSH。

```
dsh plugin --profile desktop add link:/path/to/dsh-rea-mcp-lite/dsh-plugin
```

## 它做什么

- **勾选功能族**（12 个族 + `all`，含 REA 6.5.0+ 新增的 `debug`/`formats`/`capture`）：写回网关的 `config.json`；代理 `fs.watch` 该文件 → 发 `tools/list_changed` → DSH 当场换工具集。
- **族内工具可展开**：列出族内每个工具名与各自成本，省得为"这族到底有什么"翻文档。
- **风险与版本标记**：需目标环境或外部工具链的族标「需目标环境」；当前 REA 版本没有的族标「当前 REA 版本无此族」，避免"勾了没反应"的误判。
- **看清成本**：每个族标注工具数与约 token；顶部合计「元工具 + 已勾选族」，并给出相对全量加载省下的百分比。
- **会话内实测**：直接读 DSH 工具注册表里真实存在的 `mcp__rea__*` 工具数与字符数（与网关同一套 3.6 字符/token 口径），保存后约 1 秒跟随变化 —— 这是"热切换到底生效没有"的权威答案。
- **自定义分组（可视化编辑）**：左边列出全部工具（带一句话定义与成本）供勾选，右边是本组已选；支持拖动加入、整族一键并入、改组名时勾选自动跟随、随时编辑已有分组。以勾选为主是因为 WCAG 2.5.7 要求拖动必须有非拖动替代。
- **查工具属于哪个族**：按名字/说明搜索（REA 6.4.0 是 170 个，6.7.0 是 207 个）。
- **更新与体检**：一张卡片给出三块结论 —— 本仓库落后远端几个提交、REA 本体装的是哪版/npm 上有哪版、当前 REA 有多少工具还没归族。按钮是「更新本仓库」「升级 REA」「刷新快照」「写入高置信度归类」。默认读工具快照（一秒内出结果），勾「向 REA 实时查询」才真的起一次 REA。
- **归类预览**：列出每个未归族的新工具与建议归属，标出置信度（高/中/低）。高置信度可一键写入 `config.json` 的 `bundleExtras`；不确定的留给模型判断（CLI `classify` 会打印题面）。
- **服务器状态**：已连接 / 已停用 / 启用但未连上，并在被停用时提示去「MCP 管理」启用。

成本数据来自网关生成的 `data/tools-model.json`（当前 REA 版本的每个工具的字符数、一句话描述、所属族，不含完整 schema）。代理每次连上 REA 都会刷新它，也可以手动 `node src/cli.mjs snapshot` 重新生成。

## 安装与配置

```bash
# 从 npm 或插件市场（推荐日常使用）
dsh plugin --profile desktop add dsh-rea-lite-panel
# 预构建 tarball（等同上面那份包，只是不经 npm）
dsh plugin --profile desktop add "https://github.com/MuyuYanran/dsh-rea-mcp-lite/releases/latest/download/dsh-rea-lite-panel.tgz"
# 从源码（开发时用，改完即生效，不必发包）
dsh plugin --profile desktop add link:/path/to/dsh-rea-mcp-lite/dsh-plugin
```

发到 npm 的包里自带一份网关（`gateway/`：`src/` + 工具快照 + 配置模板），由 `scripts/pack-gateway.mjs`
在发包时从仓库根复制生成（不进版本库），所以装进 `node_modules` 后没有「仓库根的 `src/`」也能跑；
在仓库里开发时用的仍是仓库根的 `src/`。

`dsh plugin add` 会同时把包写进 profile 的 `dependencies` 与 `dsh.profile.bundles`；装完重启一次 DSH，设置页就会出现（侧边栏顺序 36）。

插件行可选的 `config`：

| 键 | 说明 |
| --- | --- |
| `root` | 网关仓库目录。默认按「插件行 `root` → `REA_LITE_ROOT` → 仓库布局（本包上一级）→ 包内 `gateway/`」依次找。 |
| `patchPath` | profile patch 路径（字符串或数组），用于判断 rea 是否被停用。默认自动找 `$DSH_HOME/cordis.patch.yml` 与 profile 的 `cordis.patch.yml`；DSH Desktop 把 profile 目录放在别处时才需要显式指定。 |

「更新与体检」的写动作（升级 REA / 更新仓库 / 写归类）走 `POST /rea-lite/maintenance`（`action` = `update-self` / `update-rea` / `refresh-snapshot` / `classify` / `refresh-all`）与 `POST /rea-lite/classify`；动作名白名单校验，未知动作报 400 并列出可用值。更新开关存在 `config.json` 的 `updates`，默认全关。

环境变量 `REA_LITE_ROOT` 也能指定网关目录（优先级低于插件行的 `root`）。

## 边界

- 只管「加载哪些族」，不管 MCP 服务器的启停 —— 那是「MCP 管理」的事。
- 只服务回环地址：`/rea-lite/*` 对非 `127.0.0.1`/`::1` 来源一律 403。
- 只写网关 `config.json` 的这几个字段：`activeBundles`（勾选）、`customBundles`（自定义分组）、`bundleExtras`（归类结果）、`updates`（更新开关）；其余字段原样保留（尤其 `child`）。
- 自检：`node test/plugin.test.mjs`（90 项，用假 Cordis 上下文驱动真实的 `apply()`）+ `node test/maintenance.test.mjs`（81 项，含面板新增接口）。
