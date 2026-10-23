---
name: rea-tool-gateway
description: Use when REA tools appear as the mcp__rea__ meta tools (search_tools / tool_schema / call_tool / bundles / maintenance) instead of the full set (207 tools on REA 6.7.0). Explains how to reach every REA reverse-engineering tool through the gateway, when to load a bundle, how to switch tool sets at runtime, and how to check/apply gateway and REA updates plus classify newly added tools.
metadata:
  version: "1"
---

# REA 网关模式

当 REA 的工具列表里只有几个元工具（`mcp__rea__search_tools`、`mcp__rea__tool_schema`、
`mcp__rea__call_tool`、`mcp__rea__bundles`、`mcp__rea__maintenance`）时，说明 `rea-mcp-lite` 代理正在把关：
REA 的全部工具（6.7.0 为 207 个）**没有消失**，只是默认不摆到桌面上（省约 53k token 上下文）。

## 调用任何 REA 工具

不需要先加载功能族。两条路：

```
mcp__rea__call_tool  { "tool": "analyze_function", "arguments": { "procedure": "main" } }
```

或先用 `search_tools` 找名字：

```
mcp__rea__search_tools { "query": "pseudocode" }   → analyze_function / procedure_pseudo_code / …
mcp__rea__tool_schema  { "tool": "analyze_function" }  → 完整未裁剪的 inputSchema
```

- 工具返回 REA 自己的结构化错误（例如 `{"error":{"code":"target_unavailable"}}`）说明**转发成功**而目标未就绪 —— 按 REA 技能里的流程先 `open` 目标。
- 参数报错时用 `tool_schema` 取原始 schema：代理在暴露时会裁掉 `pattern`/`format`/`minLength` 之类的约束，服务端仍会校验。

## 什么时候加载功能族

加载族 = 把那一族工具的完整说明书摆到桌面上，便于多步流程里连续调用、避免每次猜名字。
单次、零散调用用 `call_tool` 更省。

```
mcp__rea__bundles { "action": "list" }                              # 看族、工具数、token 成本
mcp__rea__bundles { "action": "activate",   "bundles": ["native"] }  # 增量加载
mcp__rea__bundles { "action": "deactivate", "bundles": ["native"] }  # 卸载
mcp__rea__bundles { "action": "set",        "bundles": ["js","web"] }# 直接替换
```

族（REA 6.7.0 计数）：`nav`(23) `native`(44) `apple`(12) `managed`(7) `js`(13) `web`(15)
`android`(39) `debug`(20) `formats`(7) `capture`(6) `evidence`(16) `runtime`(11) `all`(207)。

按任务挑族：Electron/JS 应用 → `js`；网页/CDP → `web`；原生二进制 → `nav` + `native`；
.NET → `managed`；Android/APK → `android`；跨版本对比与证据包 → `evidence`。

## 体检与更新

```
mcp__rea__maintenance { "action": "report" }    # 本仓库 / REA 本体 / 工具覆盖（默认只读）
mcp__rea__maintenance { "action": "classify" }  # 未归族的新工具 + 建议（含给你判断的题面）
mcp__rea__maintenance { "action": "snapshot" }  # 刷新工具成本快照
```

`report` 里的「未归族」意味着 REA 升级后新增的工具还没进任何族：**这些工具仍然能用 `call_tool`
调用**，只是不会被 `bundles` 加载进来。要用族的方式用它们，先归类：
`{"action":"classify","apply":true}` 写高置信度的，`{"action":"classify","manual":{"工具名":"族id"}}`
写你判断的。写动作才改 `config.json`，只读动作不改任何东西。

## 注意

- 切换是**热更新**：代理发 `notifications/tools/list_changed`，DSH 立刻换工具集，无需重启。
- 加载族会立刻增加上下文占用（见 `bundles` 输出的 token 估算）。**长任务结束后用
  `{"action":"set","bundles":[]}` 卸载**，把上下文还回去。
- 运行时切换会写回 `config.json`，重启后仍生效；想改回默认就 `set` 成 `[]`。
