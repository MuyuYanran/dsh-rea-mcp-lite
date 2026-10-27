// dsh-rea-lite-panel 的浏览器半：「REA 工具」设置页。
//
// 手写在 lazy-CJS bundle 协议里（window.__ModuleLoader__.load + 返回 cordis 插件导出的
// factory），所以没有构建步骤；运行时需要的东西都在 shell 的冻结模块表里（React）。
//
// 页面刻意自给自足：只依赖两个稳定契约 —— 设置页座位 `settings.section`，以及自己宿主半的
// HTTP API（/rea-lite）。主题色全部走 shell 的 --dsw-alias-* 变量，所以跟随深浅色主题，
// 不改动 DOM 之外的任何东西，也不读别的插件的 DOM/样式。
window.__ModuleLoader__.load({
  id: 'dsh-rea-lite-panel',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require('react');
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useRef = react.useRef;
    var useCallback = react.useCallback;

    var NS = 'dsh-rea-lite-panel';

    /** 宿主半注册的 API 前缀。 */
    var API_PREFIX = '/rea-lite';

    var DICT = {
      zh: {
        nav: 'REA 工具',
        title: 'REA 工具网关',
        intro:
          'REA 的 170 个逆向工具不必全部塞进上下文：勾选的族会直接把工具定义交给模型，未勾选的仍可用 search_tools 找、call_tool 调。',
        loading: '正在读取状态…',
        refresh: '刷新',
        allOn: '全部加载',
        noneOn: '仅元工具',
        metaTools: '元工具',
        bundlesCost: '功能族',
        total: '合计',
        savedPercent: '省下',
        fullLoad: '全量',
        liveTitle: '会话内实测',
        liveHint: 'DSH 工具注册表里此刻真实存在的 REA 工具（保存后约 1 秒跟随热切换变化）。',
        liveTools: '个工具',
        snapshot: '工具快照',
        snapshotAt: '生成于',
        snapshotMissing: '还没有工具快照，成本显示为 0。运行 node src/cli.mjs snapshot 生成。',
        unassigned: '未归族工具',
        bundles: '功能族',
        bundleHint: '勾选即写入 config.json，代理监听文件变化后热切换，无需重启 DSH。',
        active: '已加载',
        toolsUnit: '个',
        showTools: '看族内工具',
        hideTools: '收起',
        toolsUnavailable: '这一版宿主还没返回工具清单；重启 DSH 后即可展开（不是这里点坏了）。',
        needsSetup: '需目标环境',
        unavailable: '当前 REA 版本无此族',
        customTitle: '自定义分组',
        customHint: '把常用的几个工具编成一组，之后像内置族一样一键开关。自定义分组不影响内置族。',
        customNew: '新建分组',
        customIdPlaceholder: '组名（小写字母/数字/下划线/连字符）',
        customLabelPlaceholder: '显示名（可留空，默认用组名）',
        customSave: '保存分组',
        customSaveEdit: '保存修改',
        customEdit: '编辑',
        customDelete: '删除',
        customAllTools: '全部工具',
        customFilter: '按名字或说明筛选…',
        customEmptyPick: '还没有选工具。左边勾选，或把工具拖进来。',
        dropHint: '可把左侧工具拖到此处加入；点 × 移除。',
        remove: '移除',
        customMergeFrom: '整族并入：',
        chooseBundle: '选一个族…',
        mergeAdd: '全加进来',
        mergeRemove: '全移出去',
        customTag: '自定义',
        customPicked: '已选',
        customSaved: '自定义分组已保存。',
        customRemoved: '自定义分组已删除。',
        presetsTitle: '预设',
        presetsHint: '把「勾选了哪些族 + 用哪档裁剪」存成一套带名字的方案，之后一键切回。预设不含任何本机路径，也不随插件升级丢失。',
        presetNamePlaceholder: '预设名，例如 原生深挖',
        presetNotePlaceholder: '备注（可选，写给日后的自己）',
        presetSave: '存下当前勾选',
        presetApply: '读取',
        presetDelete: '删除',
        presetCurrent: '当前生效',
        presetSaved: '已保存预设。点「读取」会把它写回勾选与裁剪档。',
        presetOverwrote: '已有同名预设，已覆盖。',
        presetApplied: '已读取预设：勾选与裁剪档都写回了，约 1 秒热切换。',
        presetRemoved: '已删除预设（当前勾选不受影响）。',
        presetMissing: '引用的族已不存在，读取时会跳过',
        presetUnavailable: '这一版 REA 没有这些族的工具',
        presetEmpty: '还没有预设。把勾选调到想要的样子，再存下来。',
        presetStoreLabel: '存放位置',
        presetStoreHint: '预设在插件目录之外，更新插件不会清掉它。',
        presetStoreBad: '预设存储不可写，保存会失败：',
        presetSavedAt: '保存于',
        presetShape: '裁剪档',
        presetCount: '个族',
        // ── 导航与分区 ──
        tabOverview: '概览',
        tabBundles: '功能族',
        tabGroups: '分组',
        tabPresets: '预设',
        tabTools: '工具',
        tabMaint: '更新与体检',
        segAll: '全部',
        segBuiltin: '内置',
        segCustom: '自定义',
        segLoaded: '已加载',
        segNotLoaded: '未加载',
        segAllPresets: '全部预设',
        segSavedAt: '按保存时间',
        chipAll: '全部',
        chipActive: '已加载',
        chipIdle: '未加载',
        chipRisky: '需环境',
        chipCustom: '自定义',
        filterBundlePlaceholder: '按名字筛选功能族…',
        filterPresetPlaceholder: '按名字筛选预设…',
        noMatch: '没有匹配项。',
        pagePrev: '上一页',
        pageNext: '下一页',
        pageInfo: '第 {n} / {total} 页',
        pageTotal: '共 {n} 条',
        overviewTitle: '当前生效',
        overviewHint: '这一页是「此刻模型看到什么」：勾选、元工具成本、以及会话内的实测值。',
        costBreakdown: '上下文构成',
        costUsed: '已用',
        costSaved: '省下',
        quickActions: '快捷操作',
        bundlesHint2: '勾选即写入 config.json，代理监听文件变化后热切换。',
        toolsPageHint: '按名字或说明搜工具，并看清它属于哪些族、要花多少上下文。',
        cancel: '取消',
        addToCustom: '加入自定义分组',
        toEnableHint: '去「MCP 管理」把 rea 启用后，这里的勾选才会真正生效。',
        savedHot: '已保存，代理已热切换。',
        savedPending: '已保存到配置；REA 服务器未在运行，下次启动时生效。',
        serverState: 'REA 服务器',
        server: {
          active: '已连接',
          pending: '启动中',
          loading: '启动中',
          disabled: '已在 MCP 管理里停用',
          disconnected: '启用但未连上',
          failed: '启动失败',
          missing: '未在 profile 里找到',
          disposed: '已卸载',
          unloading: '卸载中',
          unknown: '未知',
        },
        configPath: '配置写入',
        readOnly: '配置文件不可写，只能查看。',
        searchTitle: '查工具属于哪个族',
        searchPlaceholder: '输入工具名或描述关键词，例如 decompile / adb / plist',
        searchEmpty: '没有匹配的工具。',
        searchCount: '匹配',
        noBundle: '未归族',
        hint: '提示',
        // ── 更新与体检 ──
        maintTitle: '更新与体检',
        maintHint: '检查本仓库、REA 本体、以及「REA 有但功能族没收录」的工具。检查只读，点更新才会改本机。',
        maintCheck: '检查更新',
        maintSummary: '结论',
        maintIdle: '还没检查。点「检查更新」看本仓库与 REA 是否有新版、有没有未归族的工具。',
        maintSelf: '本仓库',
        maintRea: 'REA 本体',
        maintCoverage: '工具覆盖',
        maintUpToDate: '已是最新',
        maintBehind: '落后 {n} 个提交',
        maintAhead: '本地领先 {n} 个提交',
        maintDirty: '工作区有未提交改动',
        maintDiverged: '与远端分叉，需手工处理',
        maintInstall: '已安装',
        maintLatest: '最新',
        maintNoRegistry: '取不到 npm 版本（离线或代理）',
        maintUpdateSelf: '更新本仓库',
        maintUpdateRea: '升级 REA',
        maintRefreshSnapshot: '刷新快照',
        maintClassify: '看归类建议',
        maintClassifyApply: '写入高置信度归类',
        maintClassifyNone: '没有未归族的工具',
        maintClassifyHint: '新工具不归族就加载不到它。高置信度可直接写入；不确定的让模型判断（CLI: classify）。',
        maintSource: '数据来源',
        maintLive: '向 REA 实时查询',
        maintBusy: '正在执行…',
        maintUpdated: '已完成',
        maintFailed: '失败',
        maintPlan: '计划',
        maintApplyDryRun: '这是预览，未改动任何东西',
        maintMore: '还有',
        maintAuto: '启动时自动检查',
        maintAutoApply: '启动时自动应用',
        maintAutoHint: '默认全关：更新会改本机安装与仓库，必须显式开启。',
        maintExtras: '自动归类',
        maintLocalMissing: '族内工具本地 REA 没有',
        maintUnassigned: '未归族',
        maintToolCount: '工具',
        maintAssigned: '已归族',
        maintConfHigh: '高',
        maintConfMedium: '中',
        maintConfLow: '低',
        maintNoSuggestion: '无建议',
      },
      en: {
        nav: 'REA tools',
        title: 'REA tool gateway',
        intro:
          "REA's 170 reverse-engineering tools do not all need to sit in context: checked bundles hand their tool definitions to the model, and unchecked ones stay reachable through search_tools and call_tool.",
        loading: 'Loading state…',
        refresh: 'Refresh',
        allOn: 'Load all',
        noneOn: 'Meta tools only',
        metaTools: 'Meta tools',
        bundlesCost: 'Bundles',
        total: 'Total',
        savedPercent: 'saved',
        fullLoad: 'Full load',
        liveTitle: 'Observed in this session',
        liveHint: 'REA tools actually present in the harness tool registry right now (settles about a second after saving).',
        liveTools: 'tools',
        snapshot: 'Tool snapshot',
        snapshotAt: 'generated',
        snapshotMissing: 'No tool snapshot yet, so costs show as 0. Run node src/cli.mjs snapshot.',
        unassigned: 'Unassigned tools',
        bundles: 'Feature bundles',
        bundleHint: 'Checking a bundle writes config.json; the proxy watches the file and hot-swaps without a restart.',
        active: 'loaded',
        toolsUnit: 'tools',
        showTools: 'Show tools',
        hideTools: 'Hide',
        toolsUnavailable: 'This host build does not return the tool list yet; restart DSH to expand it (nothing is broken here).',
        needsSetup: 'needs target setup',
        unavailable: 'not in this REA version',
        customTitle: 'Custom groups',
        customHint: 'Group the tools you use most; then toggle that group like a built-in bundle. Built-in bundles are unaffected.',
        customNew: 'New group',
        customIdPlaceholder: 'Group id (lowercase letters, digits, _ or -)',
        customLabelPlaceholder: 'Display name (optional)',
        customSave: 'Save group',
        customSaveEdit: 'Save changes',
        customEdit: 'Edit',
        customDelete: 'Delete',
        customAllTools: 'All tools',
        customFilter: 'Filter by name or description…',
        customEmptyPick: 'Nothing picked yet. Tick on the left, or drag tools in.',
        dropHint: 'Drag tools here from the left; click × to remove.',
        remove: 'Remove',
        customMergeFrom: 'Merge whole bundle:',
        chooseBundle: 'Pick a bundle…',
        mergeAdd: 'Add all',
        mergeRemove: 'Remove all',
        customTag: 'custom',
        customPicked: 'Picked',
        customSaved: 'Custom group saved.',
        customRemoved: 'Custom group deleted.',
        presetsTitle: 'Presets',
        presetsHint: 'Save “which bundles are checked + which schema profile” as a named set, then switch back with one click. Presets carry no machine paths and survive plugin upgrades.',
        presetNamePlaceholder: 'Preset name, e.g. native deep dive',
        presetNotePlaceholder: 'Note (optional — for future you)',
        presetSave: 'Save current selection',
        presetApply: 'Load',
        presetDelete: 'Delete',
        presetCurrent: 'in effect',
        presetSaved: 'Preset saved. “Load” writes it back to the checkboxes and the schema profile.',
        presetOverwrote: 'A preset with that name existed; it was overwritten.',
        presetApplied: 'Preset loaded: selection and schema profile written back, hot-swapping in about a second.',
        presetRemoved: 'Preset deleted (the current selection is untouched).',
        presetMissing: 'referenced bundles no longer exist; they are skipped',
        presetUnavailable: 'this REA version has no tools for these bundles',
        presetEmpty: 'No presets yet. Set the checkboxes the way you want, then save.',
        presetStoreLabel: 'Stored at',
        presetStoreHint: 'Presets live outside the plugin directory, so updating the plugin will not clear them.',
        presetStoreBad: 'Preset store is not writable, saving will fail:',
        presetSavedAt: 'saved',
        presetShape: 'schema profile',
        presetCount: 'bundles',
        // ── Navigation and sections ──
        tabOverview: 'Overview',
        tabBundles: 'Bundles',
        tabGroups: 'Groups',
        tabPresets: 'Presets',
        tabTools: 'Tools',
        tabMaint: 'Updates & health',
        segAll: 'All',
        segBuiltin: 'Built-in',
        segCustom: 'Custom',
        segLoaded: 'Loaded',
        segNotLoaded: 'Not loaded',
        segAllPresets: 'All presets',
        segSavedAt: 'By time saved',
        chipAll: 'All',
        chipActive: 'Loaded',
        chipIdle: 'Not loaded',
        chipRisky: 'needs setup',
        chipCustom: 'Custom',
        filterBundlePlaceholder: 'Filter bundles by name…',
        filterPresetPlaceholder: 'Filter presets by name…',
        noMatch: 'Nothing matches.',
        pagePrev: 'Previous',
        pageNext: 'Next',
        pageInfo: 'Page {n} of {total}',
        pageTotal: '{n} total',
        overviewTitle: 'In effect right now',
        overviewHint: 'What the model sees at this moment: the selection, the meta-tool cost, and the measured values from this session.',
        costBreakdown: 'Context breakdown',
        costUsed: 'used',
        costSaved: 'saved',
        quickActions: 'Quick actions',
        bundlesHint2: 'Checking writes config.json; the proxy watches the file and hot-swaps.',
        toolsPageHint: 'Search tools by name or description, and see which bundles own them and what they cost.',
        cancel: 'Cancel',
        addToCustom: 'Add to custom group',
        toEnableHint: 'Enable rea in MCP manager first — these checkboxes only take effect then.',
        savedHot: 'Saved. The proxy hot-swapped the tool list.',
        savedPending: 'Saved to config; the REA server was not running, so it applies on next start.',
        serverState: 'REA server',
        server: {
          active: 'connected',
          pending: 'starting',
          loading: 'starting',
          disabled: 'disabled in MCP manager',
          disconnected: 'enabled but not connected',
          failed: 'failed to start',
          missing: 'no row in this profile',
          disposed: 'disposed',
          unloading: 'unloading',
          unknown: 'unknown',
        },
        configPath: 'Writes to',
        readOnly: 'The config file is not writable; this page is read-only.',
        searchTitle: 'Which bundle owns a tool',
        searchPlaceholder: 'Type a tool name or description keyword, e.g. decompile / adb / plist',
        searchEmpty: 'No matching tool.',
        searchCount: 'matches',
        noBundle: 'unassigned',
        hint: 'Note',
        maintTitle: 'Updates & health',
        maintHint: 'Checks this repo, the REA package, and tools REA ships that no bundle covers. Checking is read-only; only Update touches your machine.',
        maintCheck: 'Check for updates',
        maintSummary: 'Verdict',
        maintIdle: 'Not checked yet. Press “Check for updates” to see whether this repo or REA has new versions, and whether any tool is unbundled.',
        maintSelf: 'This repo',
        maintRea: 'REA package',
        maintCoverage: 'Tool coverage',
        maintUpToDate: 'up to date',
        maintBehind: '{n} commits behind',
        maintAhead: '{n} commits ahead',
        maintDirty: 'uncommitted changes',
        maintDiverged: 'diverged from remote; merge by hand',
        maintInstall: 'installed',
        maintLatest: 'latest',
        maintNoRegistry: 'cannot reach the npm registry',
        maintUpdateSelf: 'Update repo',
        maintUpdateRea: 'Upgrade REA',
        maintRefreshSnapshot: 'Refresh snapshot',
        maintClassify: 'Show classification',
        maintClassifyApply: 'Write high-confidence picks',
        maintClassifyNone: 'Every tool is bundled',
        maintClassifyHint: 'A new tool that is not in any bundle cannot be loaded by bundle. High-confidence picks can be written directly; ask the model about the rest (CLI: classify).',
        maintSource: 'Source',
        maintLive: 'Ask REA live',
        maintBusy: 'Running…',
        maintUpdated: 'Done',
        maintFailed: 'Failed',
        maintPlan: 'Plan',
        maintApplyDryRun: 'Preview only — nothing was changed',
        maintMore: 'and more',
        maintAuto: 'Check at startup',
        maintAutoApply: 'Apply at startup',
        maintAutoHint: 'Off by default: updating changes your local install and repo, so it must be opted into.',
        maintExtras: 'auto-classified',
        maintLocalMissing: 'tools in bundles that local REA lacks',
        maintUnassigned: 'unbundled',
        maintToolCount: 'tools',
        maintAssigned: 'bundled',
        maintConfHigh: 'high',
        maintConfMedium: 'medium',
        maintConfLow: 'low',
        maintNoSuggestion: 'no suggestion',
      },
    };

    /** 词典查询；第二参数是占位符表（{n} 之类），缺了就当普通字符串用。 */
    function makeT(locale) {
      var table = DICT[locale === 'en' ? 'en' : 'zh'];
      return function (key, params) {
        var value = table[key];
        if (value === undefined) return key;
        if (params === undefined || params === null) return value;
        return String(value).replace(/\{(\w+)\}/g, function (match, name) {
          return params[name] === undefined ? match : String(params[name]);
        });
      };
    }

    var localeRef = { current: 'zh' };

    // ── 样式（跟随主题别名 token） ──────────────────────────────────────────

    var CSS = [
      '.realp-root{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.realp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.realp-head h2{margin:0 0 4px;font-size:15px;font-weight:600}',
      '.realp-head p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;max-width:640px}',
      '.realp-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.realp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;white-space:nowrap}',
      '.realp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.realp-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.realp-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-primary-inverted,#fff))}',
      '.realp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}',
      '.realp-summary{display:flex;flex-wrap:wrap;gap:10px}',
      '.realp-stat{flex:1 1 150px;min-width:140px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px}',
      '.realp-stat-label{color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;align-items:center;gap:6px}',
      '.realp-stat-value{font-size:17px;font-weight:600;margin-top:3px}',
      '.realp-stat-sub{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:2px}',
      '.realp-stat-strong .realp-stat-value{color:var(--dsw-alias-state-success-primary)}',
      '.realp-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.realp-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:0 0 auto}',
      '.realp-dot-ok{background:var(--dsw-alias-state-success-primary)}',
      '.realp-dot-warn{background:var(--dsw-alias-state-warn-primary)}',
      '.realp-dot-bad{background:var(--dsw-alias-state-error-primary)}',
      '.realp-section{display:flex;flex-direction:column;gap:8px}',
      '.realp-section h3{margin:0;font-size:13px;font-weight:600}',
      '.realp-section-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.realp-list{display:flex;flex-direction:column;gap:6px}',
      '.realp-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.realp-row-on{border-color:var(--dsw-alias-brand-primary)}',
      '.realp-check{margin:2px 0 0;width:15px;height:15px;flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.realp-grow{flex:1 1 auto;min-width:0}',
      '.realp-row-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:500}',
      '.realp-row-title code{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:5px;padding:1px 5px}',
      '.realp-row-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}',
      '.realp-tag{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.realp-tag-on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.realp-tag-warn{background:transparent;border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
      '.realp-tag-off{background:transparent;border:1px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.realp-link{appearance:none;background:none;border:0;padding:0;margin-left:2px;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11px;cursor:pointer}',
      '.realp-link:hover{text-decoration:underline}',
      '.realp-toolgrid{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
      '.realp-toolchip{display:inline-flex;align-items:center;gap:5px;padding:2px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.realp-toolchip-code{color:var(--dsw-alias-label-primary)}',
      '.realp-toolchip .realp-toolchip-cost{color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.realp-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.realp-section-head h3{margin:0}',
      '.realp-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.realp-custom{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
      '.realp-custom-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.realp-custom-id{max-width:220px}',
      '.realp-custom-pick{display:flex;flex-wrap:wrap;gap:4px;max-height:180px;overflow:auto}',
      '.realp-toolchip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.realp-toolchip input{margin:0}',
      '.realp-row-custom{align-items:center;gap:8px}',
      '.realp-tag-custom{background:transparent;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.realp-tool-head{display:flex;align-items:flex-start;gap:6px}',
      '.realp-tool-picked{border-color:var(--dsw-alias-brand-primary)}',
      '.realp-editor{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
      '.realp-editor-cols{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}',
      '.realp-editor-col{flex:1 1 260px;min-width:240px;display:flex;flex-direction:column;gap:6px}',
      '.realp-editor-picked{outline:1px dashed var(--dsw-alias-border-l1);outline-offset:4px;border-radius:6px}',
      '.realp-col-head{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.realp-col-body{display:flex;flex-direction:column;gap:2px;max-height:280px;overflow:auto;padding-right:2px}',
      '.realp-toolrow{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;font-size:11px;cursor:pointer}',
      '.realp-toolrow:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.realp-toolrow-on{background:var(--dsw-alias-bg-layer-2)}',
      '.realp-toolrow input{margin:0;flex:0 0 auto}',
      '.realp-toolrow-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.realp-toolrow-desc{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.realp-toolrow-cost{color:var(--dsw-alias-label-secondary);opacity:.75;flex:0 0 auto}',
      '.realp-x{appearance:none;background:none;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;padding:0 2px;margin-left:auto}',
      '.realp-x:hover{color:var(--dsw-alias-state-error-primary)}',
      '.realp-drop-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.realp-select{height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 6px}',
      '.realp-input{width:100%;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.realp-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.realp-note{padding:9px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.realp-note-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.realp-note-error{color:var(--dsw-alias-state-error-primary)}',
      '.realp-note-ok{color:var(--dsw-alias-state-success-primary)}',
      '.realp-tools{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.realp-tool{display:grid;grid-template-columns:minmax(150px,240px) 1fr;gap:12px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.realp-tool:last-child{border-bottom:none}',
      '.realp-tool code{font-size:12px;word-break:break-all}',
      '.realp-tool p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.realp-empty{padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.realp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}',
      // ── 更新与体检 ──
      '.realp-maint{display:flex;flex-direction:column;gap:8px}',
      '.realp-maint-grid{display:flex;flex-wrap:wrap;gap:8px}',
      '.realp-maint-card{flex:1 1 240px;min-width:220px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:6px}',
      '.realp-maint-card h4{margin:0;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}',
      '.realp-maint-line{color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}',
      '.realp-maint-line strong{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.realp-maint-tone-ok h4{color:var(--dsw-alias-state-success-primary)}',
      '.realp-maint-tone-warn h4{color:var(--dsw-alias-state-warn-primary)}',
      '.realp-maint-tone-bad h4{color:var(--dsw-alias-state-error-primary)}',
      '.realp-maint-log{max-height:200px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary)}',
      '.realp-maint-rows{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto}',
      '.realp-maint-row{display:flex;align-items:center;gap:8px;font-size:11px;padding:2px 4px;border-radius:5px}',
      '.realp-maint-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.realp-maint-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.realp-maint-arrow{color:var(--dsw-alias-label-secondary)}',
      '.realp-maint-target{color:var(--dsw-alias-brand-primary)}',
      '.realp-maint-switch{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      // ── 导航（子菜单 / 子子菜单 / 分页） ──
      '.realp-tabbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-layer-0,var(--dsw-alias-bg-layer-1));padding:2px 0 0;margin-bottom:-2px}',
      '.realp-tabbar-items{display:flex;align-items:flex-end;gap:2px;flex-wrap:wrap}',
      '.realp-tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;padding:7px 11px;margin-bottom:-1px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color .12s ease,border-color .12s ease,background-color .12s ease}',
      '.realp-tab:hover:not(.realp-tab-on){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.realp-tab-on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}',
      '.realp-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.realp-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600}',
      '.realp-tab-badge-on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.realp-tabbar-status{color:var(--dsw-alias-label-secondary);font-size:11px;padding-bottom:6px}',
      '.realp-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);max-width:100%;flex-wrap:wrap}',
      '.realp-seg-item{appearance:none;background:none;border:0;border-radius:7px;padding:4px 10px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:5px}',
      '.realp-seg-item:hover{color:var(--dsw-alias-label-primary)}',
      '.realp-seg-item-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}',
      '.realp-seg-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.realp-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.realp-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}',
      '.realp-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))}',
      '.realp-chip-on{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.realp-chip-count{opacity:.7;font-size:10px}',
      '.realp-pager{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 0 2px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.realp-pager-single{justify-content:flex-start;padding:4px 0 0}',
      '.realp-pager-info{white-space:nowrap}',
      '.realp-pager-btn{height:26px;padding:0 10px;font-size:11px}',
      // ── 视觉打磨 ──
      '.realp-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);margin-top:6px}',
      '.realp-bar-used{background:var(--dsw-alias-brand-primary);transition:width .2s ease}',
      '.realp-bar-rest{background:transparent}',
      '.realp-stat-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.realp-toolchip{transition:border-color .12s ease,color .12s ease}',
      '.realp-toolgrid{max-height:280px;overflow:auto}',
      '.realp-row{transition:border-color .12s ease,background-color .12s ease}',
      '.realp-row:hover{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))}',
      '.realp-btn{transition:background-color .12s ease,border-color .12s ease,opacity .12s ease}',
      '.realp-btn:focus-visible,.realp-link:focus-visible,.realp-x:focus-visible,.realp-chip:focus-visible,.realp-seg-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.realp-empty{text-align:center;padding:18px 12px}',
      '.realp-section-head{align-items:baseline}',
      // ── 卡片与工具条 ──
      '.realp-card{display:flex;flex-direction:column;gap:6px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.realp-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.realp-card-title{font-size:12px;font-weight:600}',
      '.realp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.realp-filter{max-width:240px}',
      // ── 预设 ──
      '.realp-preset-save{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}',
      '.realp-preset-name{max-width:230px}',
      '.realp-preset-note{max-width:300px}',
      '.realp-preset-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}',
    ].join('');

    /**
     * 注入页面样式。组件挂载式 <style> 会在卸载时自动消失，
     * 这里只需要一条，且注册在 apply() 的 effect 里随插件卸载回收。
     */
    function installStyles() {
      var node = document.createElement('style');
      node.setAttribute('data-plugin', NS);
      node.textContent = CSS;
      document.head.appendChild(node);
      return function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      };
    }

    // ── 宿主 API ───────────────────────────────────────────────────────────

    function api(route, body) {
      var isRead = body === undefined;
      return fetch(API_PREFIX + '/' + route, {
        method: isRead ? 'GET' : 'POST',
        headers: isRead ? undefined : { 'content-type': 'application/json' },
        body: isRead ? undefined : JSON.stringify(body),
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (payload) {
              if (!response.ok) throw new Error(payload.error || 'HTTP ' + response.status);
              return payload;
            });
        });
    }

    // ── 小组件 ─────────────────────────────────────────────────────────────

    function Pill(props) {
      return h(
        'span',
        { className: 'realp-pill' },
        h('i', { className: 'realp-dot ' + (props.tone ? 'realp-dot-' + props.tone : '') }),
        props.children,
      );
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'realp-stat' + (props.strong ? ' realp-stat-strong' : '') },
        h('div', { className: 'realp-stat-label' }, props.label),
        h('div', { className: 'realp-stat-value' }, props.value),
        props.sub ? h('div', { className: 'realp-stat-sub' }, props.sub) : null,
      );
    }

    // ── 导航：子菜单（标签栏）、子子菜单（分段控件）、分页器 ────────────────

    /**
     * 模块级的取词函数。
     *
     * 为什么不用组件里的 t：t 是 ReaLitePage 内部的局部变量（每次渲染按当前语言重建），
     * 而下面这些小组件定义在模块作用域——在里面写 t(...) 在浏览器里就是 ReferenceError，
     * 整个设置页会白屏（自检脚本的假 React 会把这个异常吞掉，所以更危险）。
     */
    function tr(key, params) {
      return makeT(localeRef.current)(key, params);
    }

    /**
     * 一级子菜单：标签栏。
     * 用「下划线」样式而不是药丸样式，是为了和二级（分段控件）拉开层级 ——
     * 两级用同一种视觉，用户会分不清自己在哪一层。
     */
    function TabBar(props) {
      return h(
        'div',
        { className: 'realp-tabbar' },
        h(
          'div',
          { className: 'realp-tabbar-items', role: 'tablist' },
          props.tabs.map(function (tab) {
            var on = tab.id === props.current;
            return h(
              'button',
              {
                key: tab.id,
                type: 'button',
                role: 'tab',
                'aria-selected': on ? 'true' : 'false',
                className: 'realp-tab' + (on ? ' realp-tab-on' : ''),
                onClick: function () { props.onSelect(tab.id); },
              },
              h('span', null, tab.label),
              tab.badge === undefined || tab.badge === null
                ? null
                : h('span', { className: 'realp-tab-badge' + (on ? ' realp-tab-badge-on' : '') }, String(tab.badge)),
            );
          }),
        ),
        props.status ? h('div', { className: 'realp-tabbar-status' }, props.status) : null,
      );
    }

    /** 二级子菜单：分段控件（同一区块内的子分区切换）。 */
    function Segmented(props) {
      return h(
        'div',
        { className: 'realp-seg', role: 'tablist' },
        props.items.map(function (item) {
          var on = item.id === props.current;
          return h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': on ? 'true' : 'false',
              className: 'realp-seg-item' + (on ? ' realp-seg-item-on' : ''),
              onClick: function () { props.onSelect(item.id); },
            },
            item.label,
            item.badge === undefined || item.badge === null
              ? null
              : h('span', { className: 'realp-seg-badge' }, String(item.badge)),
          );
        }),
      );
    }

    /** 筛选片：单选，用来在长列表里快速定位（全部 / 已加载 / 自定义…）。 */
    function Chips(props) {
      return h(
        'div',
        { className: 'realp-chips' },
        props.items.map(function (item) {
          var on = item.id === props.current;
          return h(
            'button',
            {
              key: item.id,
              type: 'button',
              'aria-pressed': on ? 'true' : 'false',
              className: 'realp-chip' + (on ? ' realp-chip-on' : ''),
              onClick: function () { props.onSelect(item.id); },
            },
            item.label,
            item.count === undefined ? null : h('span', { className: 'realp-chip-count' }, String(item.count)),
          );
        }),
      );
    }

    /**
     * 分页器。工具列表有 200+ 条，一次全铺开会把整页拉得极长；
     * 分页后每页一屏，滚动距离与查找路径都短得多。
     */
    function Pager(props) {
      if (props.pages <= 1) {
        return props.total ? h('div', { className: 'realp-pager realp-pager-single' }, tr('pageTotal', { n: props.total })) : null;
      }
      return h(
        'div',
        { className: 'realp-pager' },
        h(
          'button',
          {
            type: 'button',
            className: 'realp-btn realp-pager-btn',
            disabled: props.page <= 1,
            onClick: function () { props.onGo(props.page - 1); },
          },
          '‹ ' + tr('pagePrev'),
        ),
        h('span', { className: 'realp-pager-info' }, tr('pageInfo', { n: props.page, total: props.pages }) + ' · ' + tr('pageTotal', { n: props.total })),
        h(
          'button',
          {
            type: 'button',
            className: 'realp-btn realp-pager-btn',
            disabled: props.page >= props.pages,
            onClick: function () { props.onGo(props.page + 1); },
          },
          tr('pageNext') + ' ›',
        ),
      );
    }

    /** 上下文构成条：已用 vs 省下，比两个数字更直观。 */
    function CostBar(props) {
      var used = Math.max(0, Math.min(100, props.usedPct));
      return h(
        'div',
        { className: 'realp-bar' },
        h('div', { className: 'realp-bar-used', style: { width: used.toFixed(1) + '%' } }),
        h('div', { className: 'realp-bar-rest', style: { width: (100 - used).toFixed(1) + '%' } }),
      );
    }

    function tokens(value) {
      return '~' + Math.round(value || 0).toLocaleString() + ' tok';
    }

    // ── 页面 ───────────────────────────────────────────────────────────────

    function ReaLitePage() {
      var [locale, setLocale] = useState(localeRef.current);
      var [state, setState] = useState(null);
      var [error, setError] = useState('');
      var [note, setNote] = useState('');
      var [busy, setBusy] = useState(false);
      var [query, setQuery] = useState('');
      var [matches, setMatches] = useState(null);
      var [expanded, setExpanded] = useState({});
      // 分组编辑器：null = 关闭，'' = 新建，其它 = 正在编辑该 id 的已有组。
      var [editing, setEditing] = useState(null);
      var [draftId, setDraftId] = useState('');
      var [draftLabel, setDraftLabel] = useState('');
      var [draftTools, setDraftTools] = useState([]);
      var [customError, setCustomError] = useState('');
      var [allTools, setAllTools] = useState([]);
      var [toolFilter, setToolFilter] = useState('');
      var [pickedBundle, setPickedBundle] = useState('');
      // 更新与体检：report 为 null 表示还没检查过（不自动发起，避免每次打开设置页都打网络）。
      var [report, setReport] = useState(null);
      var [maintBusy, setMaintBusy] = useState('');
      var [maintLog, setMaintLog] = useState('');
      var [maintError, setMaintError] = useState('');
      var [classify, setClassify] = useState(null);
      var [maintLive, setMaintLive] = useState(false);
      // 预设：草稿名与草稿备注（读取/删除作用于已有条目，不需要草稿）。
      // 新 state 一律追加在**末尾**：自检脚本按位置索引 hook 槽位，插在中间会让后面的槽位整体错位。
      var [presetName, setPresetName] = useState('');
      var [presetNote, setPresetNote] = useState('');
      var [presetError, setPresetError] = useState('');
      // ── 导航状态（一律追加在末尾，见 AGENTS.md 第 6 条） ──
      // 一级分区：概览 / 功能族 / 分组 / 预设 / 工具 / 更新与体检
      var [tab, setTab] = useState('overview');
      // 二级子分区：功能族页的「全部/内置/自定义」、预设页的「全部/按时间」
      var [bundleSeg, setBundleSeg] = useState('all');
      var [presetSeg, setPresetSeg] = useState('all');
      // 筛选片与筛选框
      var [bundleFilter, setBundleFilter] = useState('');
      var [presetFilter, setPresetFilter] = useState('');
      var [bundleChip, setBundleChip] = useState('all');
      // 分页：每页条数与当前页
      var [page, setPage] = useState(1);
      var [toolPage, setToolPage] = useState(1);
      var pollRef = useRef(null);

      var t = makeT(locale);

      useEffect(
        function () {
          var read = function () {
            if (localeRef.current !== locale) setLocale(localeRef.current);
          };
          read();
          return subscribeLocale(read);
        },
        [locale],
      );

      var load = useCallback(function () {
        return api('state')
          .then(function (next) {
            setState(next);
            setError('');
            return next;
          })
          .catch(function (failure) {
            setError(String(failure.message || failure));
          });
      }, []);

      var toggleExpand = function (id) {
        setExpanded(function (previous) {
          var next = Object.assign({}, previous);
          next[id] = !next[id];
          return next;
        });
      };

      /** 一次性拉全部工具（含一句话定义），供分组编辑器直接勾选。 */
      var loadAllTools = useCallback(function () {
        return api('tools')
          .then(function (payload) {
            setAllTools(payload.matches || []);
            return payload;
          })
          .catch(function (failure) {
            setError(String(failure.message || failure));
          });
      }, []);

      useEffect(
        function () {
          load();
          loadAllTools();
          return function () {
            if (pollRef.current !== null) clearInterval(pollRef.current);
          };
        },
        [load, loadAllTools],
      );

      /** 保存后短暂轮询：热切换要等代理刷新工具列表，注册表里的实测值随后才变。 */
      function pollAfterSave() {
        var rounds = 0;
        if (pollRef.current !== null) clearInterval(pollRef.current);
        pollRef.current = setInterval(function () {
          rounds += 1;
          load();
          if (rounds >= 6) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, 700);
      }

      function save(bundles) {
        setBusy(true);
        setNote('');
        setError('');
        api('active', { bundles: bundles })
          .then(function (payload) {
            setState(payload.state);
            setNote(payload.applied === 'hot' ? t('savedHot') : t('savedPending'));
            pollAfterSave();
          })
          .catch(function (failure) {
            setError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      function toggleBundle(id) {
        if (state === null) return;
        var order = state.bundles.map(function (bundle) {
          return bundle.id;
        });
        var current = state.allActive
          ? order.slice()
          : state.activeBundles.filter(function (entry) {
              return entry !== 'all';
            });
        var next = current.indexOf(id) >= 0
          ? current.filter(function (entry) {
              return entry !== id;
            })
          : current.concat([id]);
        // 按定义顺序写回，config.json 读起来稳定。
        save(
          order.filter(function (entry) {
            return next.indexOf(entry) >= 0;
          }),
        );
      }

      function runSearch(value) {
        setQuery(value);
        api('tools?q=' + encodeURIComponent(value))
          .then(function (payload) {
            setMatches(payload.matches || []);
          })
          .catch(function (failure) {
            setError(String(failure.message || failure));
          });
      }

      /** 打开编辑器：新建用空表单，编辑用已有族的现值。 */
      function openEditor(bundle) {
        setCustomError('');
        if (bundle) {
          setEditing(bundle.id);
          setDraftId(bundle.id);
          setDraftLabel(bundle.label || '');
          setDraftTools((bundle.tools || []).map(function (tool) { return tool.name; }));
        } else {
          setEditing('');
          setDraftId('');
          setDraftLabel('');
          setDraftTools([]);
        }
        setToolFilter('');
      }

      function closeEditor() {
        setEditing('');
        setDraftId('');
        setDraftLabel('');
        setDraftTools([]);
        setCustomError('');
      }

      /** 保存自定义分组：编辑时带上 renameFrom，让宿主把勾选一起迁到新组名。 */
      function saveCustom() {
        setCustomError('');
        setBusy(true);
        api('custom', {
          id: draftId.trim(),
          label: draftLabel.trim(),
          tools: draftTools,
          renameFrom: editing !== '' && editing !== draftId.trim() ? editing : undefined,
        })
          .then(function (payload) {
            setState(payload.state);
            closeEditor();
            setNote(t('customSaved'));
            loadAllTools();
          })
          .catch(function (failure) {
            setCustomError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      function removeCustom(id) {
        setCustomError('');
        setBusy(true);
        api('custom', { id: id, delete: true })
          .then(function (payload) {
            setState(payload.state);
            if (editing === id) closeEditor();
            setNote(t('customRemoved'));
            loadAllTools();
          })
          .catch(function (failure) {
            setError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      // ── 预设（保存/读取/删除当前这套视角） ────────────────────────────────

      function savePreset() {
        var name = presetName.trim();
        if (name === '') return;
        setPresetError('');
        setBusy(true);
        api('presets', { action: 'save', name: name, note: presetNote.trim() })
          .then(function (payload) {
            setState(payload.state);
            setPresetName('');
            setPresetNote('');
            setNote(payload.replaced ? t('presetOverwrote') : t('presetSaved'));
          })
          .catch(function (failure) {
            setPresetError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      function applyPreset(name) {
        setPresetError('');
        setBusy(true);
        api('presets', { action: 'apply', name: name })
          .then(function (payload) {
            setState(payload.state);
            var extra = [];
            if (payload.missing && payload.missing.length) extra.push(t('presetMissing') + '：' + payload.missing.join(', '));
            if (payload.unavailable && payload.unavailable.length) extra.push(t('presetUnavailable') + '：' + payload.unavailable.join(', '));
            setNote([t('presetApplied')].concat(extra).join(' '));
            pollAfterSave();
          })
          .catch(function (failure) {
            setPresetError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      function removePreset(name) {
        setPresetError('');
        setBusy(true);
        api('presets', { action: 'delete', name: name })
          .then(function (payload) {
            setState(payload.state);
            setNote(t('presetRemoved'));
          })
          .catch(function (failure) {
            setPresetError(String(failure.message || failure));
          })
          .then(function () {
            setBusy(false);
          });
      }

      // ── 更新与体检 ────────────────────────────────────────────────────────

      /** 只读检查：并发拿报告与归类预览；任何一步失败都只写进 maintError。 */
      function runCheck() {
        setMaintBusy('check');
        setMaintError('');
        setMaintLog('');
        api('maintenance' + (maintLive ? '?live=1&fetch=1' : ''))
          .then(function (payload) {
            setReport(payload);
            return api('classify').then(
              function (preview) {
                setClassify(preview);
              },
              function () {
                setClassify(null);
              },
            );
          })
          .catch(function (failure) {
            setMaintError(String(failure.message || failure));
          })
          .then(function () {
            setMaintBusy('');
          });
      }

      /** 真正执行动作（会改本机）：把结果文本落到日志区，并刷新状态。 */
      function runAction(action, extra) {
        setMaintBusy(action);
        setMaintError('');
        setMaintLog('');
        var body = { action: action };
        if (extra) Object.assign(body, extra);
        api('maintenance', body)
          .then(function (payload) {
            var lines = [];
            var result = payload.result || {};
            if (payload.ok === false) {
              lines.push(t('maintFailed') + '：' + (result.reason || '未知原因'));
            } else {
              lines.push(t('maintUpdated') + '：' + action);
            }
            if (result.dryRun) lines.push(t('maintApplyDryRun'));
            if (result.plan) lines.push(typeof result.plan === 'string' ? result.plan : JSON.stringify(result.plan, null, 2));
            if (result.apply && result.apply.output) lines.push(String(result.apply.output).slice(-1500));
            if (result.output) lines.push(String(result.output).slice(-1500));
            if (result.after && result.after.warnings && result.after.warnings.length) lines.push(result.after.warnings.join('\n'));
            if (payload.state) setState(payload.state);
            setMaintLog(lines.join('\n'));
            // 干完之后重新检查一遍，让面板显示新的结论。
            return api('maintenance').then(function (fresh) {
              setReport(fresh);
              return api('classify').then(function (preview) { setClassify(preview); }, function () {});
            });
          })
          .catch(function (failure) {
            setMaintError(String(failure.message || failure));
          })
          .then(function () {
            setMaintBusy('');
          });
      }

      /** 写更新开关（config.updates）。 */
      function saveUpdateSetting(kind, key, value) {
        if (state === null) return;
        var current = state.updates || {};
        var next = {
          self: Object.assign({}, current.self || {}),
          rea: Object.assign({}, current.rea || {}),
        };
        next[kind][key] = value;
        api('updates', { updates: next })
          .then(function (payload) {
            setState(payload.state);
          })
          .catch(function (failure) {
            setMaintError(String(failure.message || failure));
          });
      }

      function togglePick(name) {
        setDraftTools(function (previous) {
          return previous.indexOf(name) >= 0
            ? previous.filter(function (entry) { return entry !== name; })
            : previous.concat([name]);
        });
      }

      /** 把某个内置族/自定义族的全部工具一次性并进当前草稿（或整族移除）。 */
      function mergeBundle(id, add) {
        if (state === null) return;
        var bundle = (state.bundles || []).filter(function (b) { return b.id === id; })[0];
        if (!bundle || !Array.isArray(bundle.tools)) return;
        var names = bundle.tools.map(function (tool) { return tool.name; });
        setDraftTools(function (previous) {
          if (add) {
            var set = previous.slice();
            names.forEach(function (name) { if (set.indexOf(name) < 0) set.push(name); });
            return set;
          }
          return previous.filter(function (name) { return names.indexOf(name) < 0; });
        });
      }

      /** 拖放：把工具从列表拖进「已选」区（拖动是勾选之外的增强，不是唯一途径）。 */
      var dragName = useRef(null);

      function onDropAdd(event) {
        event.preventDefault();
        var name = event.dataTransfer.getData('text/plain') || dragName.current;
        dragName.current = null;
        if (name && draftTools.indexOf(name) < 0) setDraftTools(draftTools.concat([name]));
      }

      function onDropRemove(event) {
        event.preventDefault();
        var name = event.dataTransfer.getData('text/plain') || dragName.current;
        dragName.current = null;
        if (name) setDraftTools(draftTools.filter(function (entry) { return entry !== name; }));
      }

      // state 可能是 undefined（接口异常返回），只判 null 会漏。
      if (state === null || state === undefined) {
        return h(
          'div',
          { className: 'realp-root' },
          h('div', { className: 'realp-note' }, error === '' ? t('loading') : error),
        );
      }

      var serverPhase = state.server?.phase ?? 'unknown';
      var serverTone = serverPhase === 'active' ? 'ok' : serverPhase === 'failed' || serverPhase === 'disconnected' ? 'bad' : 'warn';
      var serverText = (t('server') && t('server')[serverPhase]) || serverPhase;
      // 宿主半可能是旧版本（没返回 presets）：缺了就按空列表渲染，别整页白屏。
      var presets = Array.isArray(state.presets) ? state.presets : [];

      // ── 派生数据：筛选与分页都在渲染前算好，渲染函数只负责画 ──────────
      var allBundles = state.bundles || [];
      var customBundles = allBundles.filter(function (bundle) { return bundle.custom === true; });
      var builtinBundles = allBundles.filter(function (bundle) { return bundle.custom !== true; });
      var bundleQuery = bundleFilter.trim().toLowerCase();
      var filteredBundles = allBundles.filter(function (bundle) {
        if (bundleSeg === 'builtin' && bundle.custom === true) return false;
        if (bundleSeg === 'custom' && bundle.custom !== true) return false;
        if (bundleChip === 'active' && !bundle.active) return false;
        if (bundleChip === 'idle' && bundle.active) return false;
        if (bundleChip === 'risky' && !bundle.risky) return false;
        if (bundleQuery === '') return true;
        return (
          bundle.label.toLowerCase().indexOf(bundleQuery) >= 0 ||
          bundle.id.toLowerCase().indexOf(bundleQuery) >= 0 ||
          (bundle.hint || '').toLowerCase().indexOf(bundleQuery) >= 0
        );
      });
      var BUNDLE_PAGE_SIZE = 6;
      var bundlePages = Math.max(1, Math.ceil(filteredBundles.length / BUNDLE_PAGE_SIZE));
      var bundlePage = Math.min(Math.max(1, page), bundlePages);
      var bundleSlice = filteredBundles.slice((bundlePage - 1) * BUNDLE_PAGE_SIZE, bundlePage * BUNDLE_PAGE_SIZE);

      var presetQuery = presetFilter.trim().toLowerCase();
      var filteredPresets = presets.filter(function (preset) {
        if (presetQuery === '') return true;
        return (
          preset.name.toLowerCase().indexOf(presetQuery) >= 0 ||
          (preset.label || '').toLowerCase().indexOf(presetQuery) >= 0 ||
          (preset.note || '').toLowerCase().indexOf(presetQuery) >= 0
        );
      });
      // 「按时间」子分区：新的在前；「全部」保持宿主给的顺序。
      if (presetSeg === 'time') {
        filteredPresets = filteredPresets.slice().sort(function (left, right) {
          return String(right.savedAt || '').localeCompare(String(left.savedAt || ''));
        });
      }
      var PRESET_PAGE_SIZE = 5;
      var presetPages = Math.max(1, Math.ceil(filteredPresets.length / PRESET_PAGE_SIZE));
      var presetPage = Math.min(Math.max(1, page), presetPages);
      var presetSlice = filteredPresets.slice((presetPage - 1) * PRESET_PAGE_SIZE, presetPage * PRESET_PAGE_SIZE);

      var toolMatches = matches || [];
      var TOOL_PAGE_SIZE = 12;
      var toolPages = Math.max(1, Math.ceil(toolMatches.length / TOOL_PAGE_SIZE));
      var currentToolPage = Math.min(Math.max(1, toolPage), toolPages);
      var toolSlice = toolMatches.slice((currentToolPage - 1) * TOOL_PAGE_SIZE, currentToolPage * TOOL_PAGE_SIZE);

      var activeCount = allBundles.filter(function (bundle) { return bundle.active; }).length;
      var usedPct = state.totalTokens > 0 ? (state.activeTokens / state.totalTokens) * 100 : 0;

      var TABS = [
        { id: 'overview', label: t('tabOverview') },
        { id: 'bundles', label: t('tabBundles'), badge: activeCount },
        { id: 'groups', label: t('tabGroups'), badge: customBundles.length },
        { id: 'presets', label: t('tabPresets'), badge: presets.length },
        { id: 'tools', label: t('tabTools') },
        { id: 'maint', label: t('tabMaint') },
      ];

      return h(
        'div',
        { className: 'realp-root' },
        h(
          'div',
          { className: 'realp-head' },
          h(
            'div',
            null,
            h('h2', null, t('title')),
            h('p', null, t('intro')),
          ),
          h(
            'div',
            { className: 'realp-actions' },
            h(Pill, { tone: serverTone }, t('serverState') + '：' + serverText),
            h(
              'button',
              { className: 'realp-btn', onClick: load, disabled: busy, title: t('refresh') },
              t('refresh'),
            ),
          ),
        ),

        error !== '' ? h('div', { className: 'realp-note realp-note-error' }, error) : null,
        note !== '' ? h('div', { className: 'realp-note realp-note-ok' }, note) : null,
        (state.warnings || []).map(function (warning, index) {
          return h('div', { className: 'realp-note realp-note-warn', key: 'warn-' + index }, warning);
        }),
        state.server && state.server.phase === 'disabled'
          ? h('div', { className: 'realp-note realp-note-warn' }, t('toEnableHint'))
          : null,
        state.writable === false ? h('div', { className: 'realp-note realp-note-warn' }, t('readOnly')) : null,

        // ── 一级子菜单：分区 ──
        h(TabBar, {
          tabs: TABS,
          current: tab,
          onSelect: function (id) {
            setTab(id);
            setPage(1);
            setToolPage(1);
          },
          status: state.snapshot.present
            ? t('snapshot') + ' · ' + state.snapshot.toolCount + ' ' + t('toolsUnit')
            : t('snapshotMissing'),
        }),

        // ── 分区：概览 ──
        tab === 'overview'
          ? h(
              'div',
              { className: 'realp-section' },
              h('h3', null, t('overviewTitle')),
              h('p', { className: 'realp-section-hint' }, t('overviewHint')),
              h(
                'div',
                { className: 'realp-summary' },
                h(Stat, { label: t('metaTools'), value: tokens(state.metaTokens) }),
                h(Stat, {
                  label: t('bundlesCost'),
                  value: tokens(state.activeTokens - state.metaTokens),
                  sub: state.allActive
                    ? 'all'
                    : state.activeBundles.length === 0
                      ? t('noneOn')
                      : state.activeBundles.join(', '),
                }),
                h(Stat, {
                  label: t('total'),
                  value: tokens(state.activeTokens),
                  sub: t('savedPercent') + ' ' + state.savings + '%  ·  ' + t('fullLoad') + ' ' + tokens(state.totalTokens),
                  strong: true,
                }),
                h(Stat, {
                  label: t('liveTitle'),
                  value: state.live.toolCount + ' ' + t('toolsUnit'),
                  sub: tokens(state.live.tokens),
                }),
              ),
              h(
                'div',
                { className: 'realp-card' },
                h(
                  'div',
                  { className: 'realp-card-head' },
                  h('span', { className: 'realp-card-title' }, t('costBreakdown')),
                  h('span', { className: 'realp-foot' }, t('costUsed') + ' ' + usedPct.toFixed(1) + '%  ·  ' + t('costSaved') + ' ' + (100 - usedPct).toFixed(1) + '%'),
                ),
                h(CostBar, { usedPct: usedPct }),
                h('div', { className: 'realp-foot' }, t('liveHint')),
              ),
              h(
                'div',
                { className: 'realp-card' },
                h('div', { className: 'realp-card-head' }, h('span', { className: 'realp-card-title' }, t('quickActions'))),
                h(
                  'div',
                  { className: 'realp-actions' },
                  h(
                    'button',
                    { className: 'realp-btn realp-btn-primary', disabled: busy || !state.writable, onClick: function () { save([]); } },
                    t('noneOn'),
                  ),
                  h(
                    'button',
                    { className: 'realp-btn', disabled: busy || !state.writable, onClick: function () { save(['all']); } },
                    t('allOn'),
                  ),
                  h(
                    'button',
                    { className: 'realp-btn', disabled: busy || !state.writable, onClick: function () { setTab('bundles'); } },
                    t('tabBundles'),
                  ),
                  h(
                    'button',
                    { className: 'realp-btn', disabled: busy || !state.writable, onClick: function () { setTab('presets'); } },
                    t('tabPresets'),
                  ),
                ),
                h(
                  'span',
                  { className: 'realp-foot' },
                  state.snapshot.present
                    ? t('snapshot') + '：' + state.snapshot.toolCount + ' ' + t('toolsUnit') + ' · ' + t('snapshotAt') + ' ' + String(state.snapshot.generatedAt || '').replace('T', ' ').slice(0, 19)
                    : t('snapshotMissing'),
                ),
              ),
            )
          : null,

        // ── 分区：功能族 ──
        tab === 'bundles'
          ? h(
              'div',
              { className: 'realp-section' },
              h(
                'div',
                { className: 'realp-section-head' },
                h('h3', null, t('bundles')),
                h(Segmented, {
                  current: bundleSeg,
                  onSelect: function (id) { setBundleSeg(id); setPage(1); },
                  items: [
                    { id: 'all', label: t('segAll'), badge: allBundles.length },
                    { id: 'builtin', label: t('segBuiltin'), badge: builtinBundles.length },
                    { id: 'custom', label: t('segCustom'), badge: customBundles.length },
                  ],
                }),
              ),
              h('p', { className: 'realp-section-hint' }, t('bundlesHint2')),
              h(
                'div',
                { className: 'realp-toolbar' },
                h(Chips, {
                  current: bundleChip,
                  onSelect: function (id) { setBundleChip(id); setPage(1); },
                  items: [
                    { id: 'all', label: t('chipAll'), count: filteredBundles.length },
                    { id: 'active', label: t('chipActive'), count: allBundles.filter(function (b) { return b.active; }).length },
                    { id: 'idle', label: t('chipIdle'), count: allBundles.filter(function (b) { return !b.active; }).length },
                    { id: 'risky', label: t('chipRisky'), count: allBundles.filter(function (b) { return b.risky; }).length },
                  ],
                }),
                h('input', {
                  className: 'realp-input realp-filter',
                  value: bundleFilter,
                  placeholder: t('filterBundlePlaceholder'),
                  onChange: function (event) { setBundleFilter(event.target.value); setPage(1); },
                }),
              ),
              bundleSlice.length === 0
                ? h('div', { className: 'realp-empty' }, t('noMatch'))
                : h(
                    'div',
                    { className: 'realp-list' },
                    bundleSlice.map(function (bundle) {
                      return h(
                        'label',
                        { className: 'realp-row' + (bundle.active ? ' realp-row-on' : ''), key: bundle.id },
                h('input', {
                  className: 'realp-check',
                  type: 'checkbox',
                  checked: bundle.active,
                  disabled: busy || !state.writable,
                  onChange: function () { toggleBundle(bundle.id); },
                }),
                h(
                  'div',
                  { className: 'realp-grow' },
                  h(
                    'div',
                    { className: 'realp-row-title' },
                    h('span', null, bundle.label),
                    h('code', null, bundle.id),
                    h('span', { className: 'realp-tag' + (bundle.active ? ' realp-tag-on' : '') }, bundle.toolCount + ' ' + t('toolsUnit')),
                    h('span', { className: 'realp-tag' }, tokens(bundle.tokens)),
                    bundle.risky ? h('span', { className: 'realp-tag realp-tag-warn' }, t('needsSetup')) : null,
                    bundle.unavailable
                      ? h('span', { className: 'realp-tag realp-tag-off' }, t('unavailable'))
                      : null,
                    bundle.toolCount > 0
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'realp-link',
                            onClick: function (event) {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleExpand(bundle.id);
                            },
                          },
                          expanded[bundle.id] ? t('hideTools') : t('showTools'),
                        )
                      : null,
                  ),
                  bundle.hint ? h('div', { className: 'realp-row-hint' }, bundle.hint) : null,
                  expanded[bundle.id]
                    ? Array.isArray(bundle.tools) && bundle.tools.length > 0
                      ? h(
                          'div',
                          { className: 'realp-toolgrid' },
                          bundle.tools.map(function (tool) {
                            return h(
                              'span',
                              { className: 'realp-toolchip', key: tool.name },
                              h('code', null, tool.name),
                              h('span', { className: 'realp-toolchip-cost' }, '~' + tool.tokens),
                            );
                          }),
                        )
                      : h('div', { className: 'realp-row-hint' }, t('toolsUnavailable'))
                    : null,
                ),
              );
                    }),
                  ),
              h(Pager, {
                page: bundlePage,
                pages: bundlePages,
                total: filteredBundles.length,
                onGo: function (next) { setPage(next); },
              }),
            )
          : null,

        // ── 分区：自定义分组 ──
        tab === 'groups'
          ? h(
              'div',
              { className: 'realp-section' },
              h(
                'div',
                { className: 'realp-section-head' },
                h('h3', null, t('customTitle')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'realp-btn',
                    disabled: busy || !state.writable || editing !== null,
                    onClick: function () { openEditor(null); },
                  },
                  t('customNew'),
                ),
              ),
              h('p', { className: 'realp-section-hint' }, t('customHint')),
          editing !== null
            ? h(
                'div',
                { className: 'realp-editor' },
                h(
                  'div',
                  { className: 'realp-custom-row' },
                  h('input', {
                    className: 'realp-input realp-custom-id',
                    value: draftId,
                    placeholder: t('customIdPlaceholder'),
                    onChange: function (event) { setDraftId(event.target.value); },
                  }),
                  h('input', {
                    className: 'realp-input',
                    value: draftLabel,
                    placeholder: t('customLabelPlaceholder'),
                    onChange: function (event) { setDraftLabel(event.target.value); },
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'realp-btn realp-btn-primary',
                      disabled: busy || draftId.trim() === '' || draftTools.length === 0,
                      onClick: saveCustom,
                    },
                    editing === '' ? t('customSave') : t('customSaveEdit'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'realp-btn', onClick: closeEditor },
                    t('cancel'),
                  ),
                ),
                customError !== '' ? h('div', { className: 'realp-note realp-note-error' }, customError) : null,
                h(
                  'div',
                  { className: 'realp-editor-cols' },
                  // 左：全部工具，带一句话定义；勾选即加入（拖动是增强，不是唯一途径）
                  h(
                    'div',
                    { className: 'realp-editor-col' },
                    h('div', { className: 'realp-col-head' }, t('customAllTools') + ' · ' + allTools.length),
                    h('input', {
                      className: 'realp-input',
                      value: toolFilter,
                      placeholder: t('customFilter'),
                      onChange: function (event) { setToolFilter(event.target.value); },
                    }),
                    h(
                      'div',
                      { className: 'realp-col-body' },
                      allTools
                        .filter(function (tool) {
                          var q = toolFilter.trim().toLowerCase();
                          return q === '' || tool.name.toLowerCase().indexOf(q) >= 0 || (tool.desc || '').toLowerCase().indexOf(q) >= 0;
                        })
                        .map(function (tool) {
                          var picked = draftTools.indexOf(tool.name) >= 0;
                          return h(
                            'label',
                            {
                              className: 'realp-toolrow' + (picked ? ' realp-toolrow-on' : ''),
                              key: 'a-' + tool.name,
                              draggable: true,
                              onDragStart: function (event) {
                                dragName.current = tool.name;
                                try { event.dataTransfer.setData('text/plain', tool.name); } catch (ignored) {}
                                event.dataTransfer.effectAllowed = 'copy';
                              },
                              title: tool.desc,
                            },
                            h('input', {
                              type: 'checkbox',
                              checked: picked,
                              onChange: function () { togglePick(tool.name); },
                            }),
                            h(
                              'span',
                              { className: 'realp-toolrow-main' },
                              h('code', null, tool.name),
                              h('span', { className: 'realp-toolrow-desc' }, tool.desc || ''),
                            ),
                            h('span', { className: 'realp-toolrow-cost' }, '~' + tool.tokens),
                          );
                        }),
                    ),
                  ),
                  // 右：本组已选（点击移除；也接受从左侧拖入）
                  h(
                    'div',
                    {
                      className: 'realp-editor-col realp-editor-picked',
                      onDragOver: function (event) { event.preventDefault(); },
                      onDrop: onDropAdd,
                    },
                    h('div', { className: 'realp-col-head' }, t('customPicked') + ' · ' + draftTools.length),
                    h(
                      'div',
                      { className: 'realp-col-body' },
                      draftTools.length === 0
                        ? h('div', { className: 'realp-row-hint' }, t('customEmptyPick'))
                        : draftTools.map(function (name) {
                            return h(
                              'div',
                              {
                                className: 'realp-toolrow realp-toolrow-on',
                                key: 'p-' + name,
                                draggable: true,
                                onDragStart: function (event) {
                                  dragName.current = name;
                                  try { event.dataTransfer.setData('text/plain', name); } catch (ignored) {}
                                },
                              },
                              h('code', null, name),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'realp-x',
                                  title: t('remove'),
                                  onClick: function () { togglePick(name); },
                                },
                                '×',
                              ),
                            );
                          }),
                    ),
                    h('div', { className: 'realp-drop-hint' }, t('dropHint')),
                  ),
                ),
                // 快速并入整族：省得一个个勾
                h(
                  'div',
                  { className: 'realp-custom-row' },
                  h('span', { className: 'realp-row-hint' }, t('customMergeFrom')),
                  h(
                    'select',
                    {
                      className: 'realp-select',
                      value: pickedBundle,
                      onChange: function (event) { setPickedBundle(event.target.value); },
                    },
                    [h('option', { value: '', key: '' }, t('chooseBundle'))].concat(
                      (state.bundles || []).map(function (bundle) {
                        return h('option', { value: bundle.id, key: bundle.id }, bundle.label + ' (' + bundle.id + ')');
                      }),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'realp-btn',
                      disabled: pickedBundle === '',
                      onClick: function () { mergeBundle(pickedBundle, true); },
                    },
                    t('mergeAdd'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'realp-btn',
                      disabled: pickedBundle === '',
                      onClick: function () { mergeBundle(pickedBundle, false); },
                    },
                    t('mergeRemove'),
                  ),
                ),
              )
            : state.bundles.filter(function (bundle) { return bundle.custom === true; }).length === 0
              ? null
              : h(
                  'div',
                  { className: 'realp-list' },
                  state.bundles
                    .filter(function (bundle) { return bundle.custom === true; })
                    .map(function (bundle) {
                      return h(
                        'div',
                        { className: 'realp-row realp-row-custom', key: 'c-' + bundle.id },
                        h(
                          'div',
                          { className: 'realp-grow' },
                          h(
                            'div',
                            { className: 'realp-row-title' },
                            h('span', null, bundle.label),
                            h('code', null, bundle.id),
                            h('span', { className: 'realp-tag realp-tag-custom' }, t('customTag')),
                            h('span', { className: 'realp-tag' }, bundle.toolCount + ' ' + t('toolsUnit')),
                          ),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'realp-btn', disabled: busy || !state.writable, onClick: function () { openEditor(bundle); } },
                          t('customEdit'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'realp-btn realp-btn-danger', disabled: busy || !state.writable, onClick: function () { removeCustom(bundle.id); } },
                          t('customDelete'),
                        ),
                      );
                    }),
                ),
            )
          : null,

        // ── 分区：预设 ──
        tab === 'presets'
          ? h(
              'div',
              { className: 'realp-section' },
              h(
                'div',
                { className: 'realp-section-head' },
                h('h3', null, t('presetsTitle')),
                h(Segmented, {
                  current: presetSeg,
                  onSelect: function (id) { setPresetSeg(id); setPage(1); },
                  items: [
                    { id: 'all', label: t('segAllPresets'), badge: presets.length },
                    { id: 'time', label: t('segSavedAt') },
                  ],
                }),
              ),
              h('p', { className: 'realp-section-hint' }, t('presetsHint')),
              // 存放位置：预设不在插件目录里，升级插件不会把它清掉——这件事必须让用户看得见。
              state.presetStore && state.presetStore.path
                ? h(
                    'p',
                    { className: 'realp-section-hint' },
                    t('presetStoreLabel') + '：',
                    h('code', null, state.presetStore.path),
                    ' · ',
                    state.presetStore.writable === false ? t('presetStoreBad') : t('presetStoreHint'),
                  )
                : null,
              h(
                'div',
                { className: 'realp-toolbar' },
                h('input', {
                  className: 'realp-input realp-filter',
                  value: presetFilter,
                  placeholder: t('filterPresetPlaceholder'),
                  onChange: function (event) { setPresetFilter(event.target.value); setPage(1); },
                }),
              ),
          filteredPresets.length === 0
            ? h('div', { className: 'realp-empty' }, presets.length === 0 ? t('presetEmpty') : t('noMatch'))
            : h(
                'div',
                { className: 'realp-list' },
                presetSlice.map(function (preset) {
                  return h(
                    'div',
                    { className: 'realp-row' + (preset.current ? ' realp-row-on' : ''), key: 'p-' + preset.name },
                    h(
                      'div',
                      { className: 'realp-grow' },
                      h(
                        'div',
                        { className: 'realp-row-title' },
                        h('span', null, preset.label || preset.name),
                        preset.label ? h('code', null, preset.name) : null,
                        h('span', { className: 'realp-tag' + (preset.current ? ' realp-tag-on' : '') }, preset.applied.length + ' ' + t('presetCount')),
                        h('span', { className: 'realp-tag' }, tokens(preset.tokens)),
                        preset.lite ? h('span', { className: 'realp-tag' }, t('presetShape') + ' ' + preset.lite) : null,
                        preset.current ? h('span', { className: 'realp-tag realp-tag-on' }, t('presetCurrent')) : null,
                        preset.missing.length
                          ? h('span', { className: 'realp-tag realp-tag-warn' }, t('presetMissing') + '：' + preset.missing.join(', '))
                          : null,
                        preset.unavailable.length
                          ? h('span', { className: 'realp-tag realp-tag-off' }, t('presetUnavailable') + '：' + preset.unavailable.join(', '))
                          : null,
                      ),
                      h(
                        'div',
                        { className: 'realp-row-hint' },
                        (preset.applied.join(', ') || t('noneOn')) +
                          (preset.savedAt ? '   ·   ' + t('presetSavedAt') + ' ' + String(preset.savedAt).replace('T', ' ').slice(0, 16) : ''),
                      ),
                      preset.note ? h('div', { className: 'realp-row-hint' }, preset.note) : null,
                    ),
                    h(
                      'div',
                      { className: 'realp-preset-actions' },
                      h(
                        'button',
                        { type: 'button', className: 'realp-btn', disabled: busy || !state.writable, onClick: function () { applyPreset(preset.name); } },
                        t('presetApply'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'realp-btn realp-btn-danger', disabled: busy || !state.writable, onClick: function () { removePreset(preset.name); } },
                        t('presetDelete'),
                      ),
                    ),
                  );
                }),
              ),
          h(Pager, {
            page: presetPage,
            pages: presetPages,
            total: filteredPresets.length,
            onGo: function (next) { setPage(next); },
          }),
          h(
            'div',
            { className: 'realp-preset-save' },
            h('input', {
              className: 'realp-input realp-preset-name',
              value: presetName,
              placeholder: t('presetNamePlaceholder'),
              onChange: function (event) { setPresetName(event.target.value); },
            }),
            h('input', {
              className: 'realp-input realp-preset-note',
              value: presetNote,
              placeholder: t('presetNotePlaceholder'),
              onChange: function (event) { setPresetNote(event.target.value); },
            }),
            h(
              'button',
              { type: 'button', className: 'realp-btn', disabled: busy || !state.writable || presetName.trim() === '', onClick: savePreset },
              t('presetSave'),
            ),
          ),
          presetError ? h('div', { className: 'realp-note realp-note-error' }, presetError) : null,
            )
          : null,

        // ── 分区：工具检索 ──
        tab === 'tools'
          ? h(
              'div',
              { className: 'realp-section' },
              h('h3', null, t('searchTitle')),
              h('p', { className: 'realp-section-hint' }, t('toolsPageHint')),
              h('input', {
                className: 'realp-input',
                value: query,
                placeholder: t('searchPlaceholder'),
                onChange: function (event) { runSearch(event.target.value); },
              }),
              matches === null
                ? null
                : matches.length === 0
                  ? h('div', { className: 'realp-empty' }, t('searchEmpty'))
                  : h(
                      'div',
                      { className: 'realp-tools' },
                      toolSlice.map(function (tool) {
                    var picked = draftTools.indexOf(tool.name) >= 0;
                    var inEditor = editing !== null;
                    return h(
                      'div',
                      { className: 'realp-tool' + (picked ? ' realp-tool-picked' : ''), key: tool.name },
                      h(
                        'div',
                        { className: 'realp-tool-head' },
                        inEditor
                          ? h('input', {
                              type: 'checkbox',
                              checked: picked,
                              title: t('addToCustom'),
                              onChange: function () { togglePick(tool.name); },
                            })
                          : null,
                        h(
                          'div',
                          { className: 'realp-grow' },
                          h('code', null, tool.name),
                          h(
                            'div',
                            { style: { marginTop: '3px', display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                            (tool.bundles.length ? tool.bundles : [t('noBundle')]).map(function (name) {
                              return h('span', { className: 'realp-tag', key: name }, name);
                            }),
                            h('span', { className: 'realp-tag' }, '~' + tool.tokens + ' tok'),
                          ),
                        ),
                      ),
                      h('p', { title: tool.desc }, tool.desc),
                    );
                  }),
                    ),
              h(Pager, {
                page: currentToolPage,
                pages: toolPages,
                total: toolMatches.length,
                onGo: function (next) { setToolPage(next); },
              }),
            )
          : null,

        // ── 分区：更新与体检 ──
        tab === 'maint'
          ? h(
              'div',
              { className: 'realp-section' },
              h(
                'div',
                { className: 'realp-section-head' },
                h('h3', null, t('maintTitle')),
                h(
                  'div',
                  { className: 'realp-actions' },
                  h(
                    'label',
                    { className: 'realp-maint-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: maintLive,
                      disabled: maintBusy !== '',
                      onChange: function (event) { setMaintLive(event.target.checked); },
                    }),
                    t('maintLive'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'realp-btn',
                      disabled: maintBusy !== '' || busy,
                      onClick: runCheck,
                    },
                    maintBusy === 'check' ? t('maintBusy') : t('maintCheck'),
                  ),
                ),
              ),
              h('p', { className: 'realp-section-hint' }, t('maintHint')),

              state.snapshot.unassigned && state.snapshot.unassigned.length > 0
                ? h('div', { className: 'realp-note realp-note-warn' }, t('unassigned') + '：' + state.snapshot.unassigned.join(', '))
                : null,

              maintError !== '' ? h('div', { className: 'realp-note realp-note-error' }, maintError) : null,

          report === null
            ? h('div', { className: 'realp-note' }, t('maintIdle'))
            : report.ok === false || !report.coverage
              ? h('div', { className: 'realp-note realp-note-error' }, String(report.reason || report.error || '检查失败'))
              : h(
                'div',
                { className: 'realp-maint' },
                h(
                  'div',
                  { className: 'realp-note' + (report.summary && report.summary.indexOf('最新') >= 0 && !report.coverage.unassigned.length ? ' realp-note-ok' : ' realp-note-warn') },
                  t('maintSummary') + '：' + (report.summary || ''),
                ),
                h(
                  'div',
                  { className: 'realp-maint-grid' },
                  // 本仓库
                  h(
                    'div',
                    {
                      className:
                        'realp-maint-card realp-maint-tone-' +
                        (report.self && report.self.ok === false ? 'bad' : report.self && report.self.available ? 'warn' : 'ok'),
                    },
                    h('h4', null, t('maintSelf')),
                    report.self && report.self.ok === false
                      ? h('div', { className: 'realp-maint-line' }, report.self.reason || '—')
                      : h(
                          'div',
                          { className: 'realp-maint-line' },
                          h('strong', null, report.self && report.self.available ? t('maintBehind', { n: report.self.behind }) : t('maintUpToDate')),
                          report.self && report.self.ahead ? ' · ' + t('maintAhead', { n: report.self.ahead }) : '',
                          report.self && report.self.dirty ? ' · ' + t('maintDirty') : '',
                        ),
                    report.self && report.self.fetchError
                      ? h('div', { className: 'realp-maint-line' }, report.self.fetchError)
                      : null,
                    report.self && report.self.commits && report.self.commits.length
                      ? h(
                          'div',
                          { className: 'realp-maint-rows' },
                          report.self.commits.slice(0, 8).map(function (line) {
                            return h('div', { className: 'realp-maint-row', key: 'c-' + line }, h('span', { className: 'realp-maint-row-name' }, line));
                          }),
                        )
                      : null,
                    h(
                      'div',
                      { className: 'realp-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'realp-btn',
                          disabled: maintBusy !== '' || !(report.self && report.self.available),
                          title: report.self && report.self.fastForwardable ? '' : t('maintDiverged'),
                          onClick: function () { runAction('update-self', { apply: true }); },
                        },
                        t('maintUpdateSelf'),
                      ),
                    ),
                  ),
                  // REA 本体
                  h(
                    'div',
                    {
                      className:
                        'realp-maint-card realp-maint-tone-' +
                        (report.rea && report.rea.ok === false ? 'bad' : report.rea && report.rea.updateAvailable ? 'warn' : 'ok'),
                    },
                    h('h4', null, t('maintRea')),
                    h(
                      'div',
                      { className: 'realp-maint-line' },
                      t('maintInstall') + '：',
                      h('strong', null, (report.rea && report.rea.installed) || '—'),
                      report.rea && report.rea.latest ? ' · ' + t('maintLatest') + '：' + report.rea.latest : '',
                    ),
                    report.rea && report.rea.registryError
                      ? h('div', { className: 'realp-maint-line' }, report.rea.registryError)
                      : null,
                    report.rea && report.rea.install && report.rea.install.found
                      ? h('div', { className: 'realp-maint-line' }, report.rea.install.manager + ' @ ' + report.rea.install.envDir)
                      : h('div', { className: 'realp-maint-line' }, (report.rea && (report.rea.install && report.rea.install.reason)) || ''),
                    report.rea && report.rea.nextStep
                      ? h('div', { className: 'realp-maint-line' }, report.rea.nextStep)
                      : null,
                    h(
                      'div',
                      { className: 'realp-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'realp-btn realp-btn-primary',
                          disabled: maintBusy !== '' || !(report.rea && report.rea.updateAvailable),
                          onClick: function () { runAction('update-rea', { apply: true }); },
                        },
                        t('maintUpdateRea'),
                      ),
                    ),
                  ),
                  // 工具覆盖
                  h(
                    'div',
                    {
                      className:
                        'realp-maint-card realp-maint-tone-' +
                        (report.coverage.unassigned.length ? 'warn' : report.coverage.missingForLocal.length ? 'warn' : 'ok'),
                    },
                    h('h4', null, t('maintCoverage')),
                    h(
                      'div',
                      { className: 'realp-maint-line' },
                      t('maintToolCount') + '：',
                      h('strong', null, String(report.coverage.total)),
                      ' · ' + t('maintAssigned') + '：' + report.coverage.assigned,
                    ),
                    h('div', { className: 'realp-maint-line' }, t('maintSource') + '：' + report.coverage.source),
                    report.coverage.unassigned.length
                      ? h('div', { className: 'realp-maint-line' }, t('maintUnassigned') + '：' + report.coverage.unassigned.join(', '))
                      : null,
                    report.coverage.missingForLocal.length
                      ? h('div', { className: 'realp-maint-line' }, t('maintLocalMissing') + '：' + report.coverage.missingForLocal.join(', '))
                      : null,
                    h(
                      'div',
                      { className: 'realp-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'realp-btn',
                          disabled: maintBusy !== '',
                          onClick: function () { runAction('refresh-snapshot'); },
                        },
                        t('maintRefreshSnapshot'),
                      ),
                    ),
                  ),
                ),

                // 归类预览 + 写入
                h(
                  'div',
                  { className: 'realp-note' },
                  classify && classify.counts
                    ? classify.counts.total === 0
                      ? t('maintClassifyNone')
                      : classify.counts.total + ' / ' + report.coverage.total + ' — ' + t('maintClassifyHint')
                    : t('maintClassifyHint'),
                ),
                classify && classify.assignments && classify.assignments.length
                  ? h(
                      'div',
                      { className: 'realp-maint-rows' },
                      classify.assignments.map(function (entry) {
                        var tone = entry.confidence === 'high' ? t('maintConfHigh') : entry.confidence === 'medium' ? t('maintConfMedium') : t('maintConfLow');
                        return h(
                          'div',
                          { className: 'realp-maint-row', key: 'cls-' + entry.name },
                          h('span', { className: 'realp-maint-row-name' }, entry.name),
                          h('span', { className: 'realp-maint-arrow' }, '→'),
                          h('span', { className: 'realp-maint-target' }, entry.suggested || t('maintNoSuggestion')),
                          h('span', { className: 'realp-tag' }, tone),
                        );
                      }),
                    )
                  : null,
                classify && classify.applyable > 0
                  ? h(
                      'div',
                      { className: 'realp-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'realp-btn realp-btn-primary',
                          disabled: maintBusy !== '' || !state.writable,
                          onClick: function () { runAction('classify'); },
                        },
                        t('maintClassifyApply') + ' (' + classify.applyable + ')',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'realp-btn',
                          disabled: maintBusy !== '',
                          onClick: function () { runAction('refresh-all'); },
                        },
                        t('maintClassify'),
                      ),
                    )
                  : null,

                // 自动更新开关
                h(
                  'div',
                  { className: 'realp-custom-row' },
                  h('span', { className: 'realp-row-hint' }, t('maintAutoHint')),
                ),
                h(
                  'div',
                  { className: 'realp-custom-row' },
                  h(
                    'label',
                    { className: 'realp-maint-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(state.updates && state.updates.self && state.updates.self.checkOnStart),
                      disabled: busy || !state.writable,
                      onChange: function (event) { saveUpdateSetting('self', 'checkOnStart', event.target.checked); },
                    }),
                    t('maintSelf') + ' · ' + t('maintAuto'),
                  ),
                  h(
                    'label',
                    { className: 'realp-maint-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(state.updates && state.updates.self && state.updates.self.autoApply),
                      disabled: busy || !state.writable,
                      onChange: function (event) { saveUpdateSetting('self', 'autoApply', event.target.checked); },
                    }),
                    t('maintSelf') + ' · ' + t('maintAutoApply'),
                  ),
                  h(
                    'label',
                    { className: 'realp-maint-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(state.updates && state.updates.rea && state.updates.rea.checkOnStart),
                      disabled: busy || !state.writable,
                      onChange: function (event) { saveUpdateSetting('rea', 'checkOnStart', event.target.checked); },
                    }),
                    t('maintRea') + ' · ' + t('maintAuto'),
                  ),
                  h(
                    'label',
                    { className: 'realp-maint-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(state.updates && state.updates.rea && state.updates.rea.autoApply),
                      disabled: busy || !state.writable,
                      onChange: function (event) { saveUpdateSetting('rea', 'autoApply', event.target.checked); },
                    }),
                    t('maintRea') + ' · ' + t('maintAutoApply'),
                  ),
                ),

                maintLog !== '' ? h('div', { className: 'realp-maint-log' }, maintLog) : null,
                maintBusy !== '' ? h('div', { className: 'realp-note' }, t('maintBusy')) : null,
              ),
            )
          : null,

        h('div', { className: 'realp-foot' }, t('configPath') + '：' + state.configPath),
      );
    }

    // ── 语言订阅 ───────────────────────────────────────────────────────────

    /** 宿主 locale 服务的订阅；服务不存在时退化为「只用自己的词典」。 */
    var localeService = null;
    var localeWatchers = [];

    function subscribeLocale(listener) {
      localeWatchers.push(listener);
      return function () {
        localeWatchers = localeWatchers.filter(function (entry) {
          return entry !== listener;
        });
      };
    }

    function pushLocale(id) {
      localeRef.current = id === 'en' ? 'en' : 'zh';
      for (var index = 0; index < localeWatchers.length; index += 1) localeWatchers[index]();
    }

    // ── 插件导出 ───────────────────────────────────────────────────────────

    exports.name = NS;
    // slots 必须声明而不是 ctx.get：声明式注入会在 apply() 之前解析好服务。
    exports.inject = ['slots'];

    exports.apply = function apply(ctx) {
      ctx.effect(installStyles, NS + ': styles');

      var locale = ctx.get('locale');
      if (locale !== undefined && typeof locale.register === 'function') {
        ctx.effect(
          function () {
            return locale.register(NS, { zh: DICT.zh, en: DICT.en });
          },
          NS + ': dictionaries',
        );
        try {
          var read = function () {
            var id = locale.getLocale().id === 'en' ? 'en' : 'zh';
            pushLocale(id);
          };
          read();
          ctx.effect(
            function () {
              return locale.subscribe(read);
            },
            NS + ': locale mirror',
          );
        } catch (error) {
          console.warn('[' + NS + '] locale mirror skipped:', error);
        }
      }

      var slots = ctx.slots;
      if (slots === undefined) {
        // 设置页静默不出现是这个插件唯一不能接受的失败，所以直接抛。
        throw new Error('[' + NS + '] slots 服务不可用，设置页无法注册');
      }
      ctx.effect(
        function () {
          return slots.inject('settings.section', function () {
            return slots.register(
              {
                name: 'settings.section',
                id: 'rea-tools',
                order: 36,
                label: function () {
                  return makeT(localeRef.current)('nav');
                },
              },
              ReaLitePage,
            );
          });
        },
        NS + ': settings section',
      );
    };

    return module.exports;
  },
});
