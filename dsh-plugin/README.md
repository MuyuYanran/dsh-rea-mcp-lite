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
- **查工具属于哪个族**：按名字/说明搜索（REA 6.4.0 是 170 个，6.7.0 是 207 个）。
- **服务器状态**：已连接 / 已停用 / 启用但未连上，并在被停用时提示去「MCP 管理」启用。

成本数据来自网关生成的 `data/tools-model.json`（170 个工具的字符数、一句话描述、所属族，约 30 KB，不含完整 schema）。代理每次连上 REA 都会刷新它，也可以手动 `node src/cli.mjs snapshot` 重新生成。

## 安装与配置

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-rea-mcp-lite/dsh-plugin
```

`dsh plugin add` 会同时把包写进 profile 的 `dependencies` 与 `dsh.profile.bundles`；装完重启一次 DSH，设置页就会出现（侧边栏顺序 36）。

插件行可选的 `config`：

| 键 | 说明 |
| --- | --- |
| `root` | 网关仓库目录。默认按「本包目录的上一级」找（仓库布局 `dsh-plugin/` 与 `src/` 同级）。 |
| `patchPath` | profile patch 路径（字符串或数组），用于判断 rea 是否被停用。默认自动找 `$DSH_HOME/cordis.patch.yml` 与 profile 的 `cordis.patch.yml`；DSH Desktop 把 profile 目录放在别处时才需要显式指定。 |

环境变量 `REA_LITE_ROOT` 也能指定网关目录（优先级低于插件行的 `root`）。

## 边界

- 只管「加载哪些族」，不管 MCP 服务器的启停 —— 那是「MCP 管理」的事。
- 只服务回环地址：`/rea-lite/*` 对非 `127.0.0.1`/`::1` 来源一律 403。
- 只写网关 `config.json` 里的 `activeBundles` 一个字段，其余字段原样保留。
- 自检：`node test/plugin.test.mjs`（58 项，用假 Cordis 上下文驱动真实的 `apply()`）。
