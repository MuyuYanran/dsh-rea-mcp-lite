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
      },
    };

    function makeT(locale) {
      var table = DICT[locale === 'en' ? 'en' : 'zh'];
      return function (key) {
        return table[key] === undefined ? key : table[key];
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
      '.realp-tools{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);max-height:320px;overflow:auto}',
      '.realp-tool{display:grid;grid-template-columns:minmax(150px,240px) 1fr;gap:12px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.realp-tool:last-child{border-bottom:none}',
      '.realp-tool code{font-size:12px;word-break:break-all}',
      '.realp-tool p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.realp-empty{padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.realp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}',
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

      if (state === null) {
        return h(
          'div',
          { className: 'realp-root' },
          h('div', { className: 'realp-note' }, error === '' ? t('loading') : error),
        );
      }

      var serverPhase = state.server?.phase ?? 'unknown';
      var serverTone = serverPhase === 'active' ? 'ok' : serverPhase === 'failed' || serverPhase === 'disconnected' ? 'bad' : 'warn';
      var serverText = (t('server') && t('server')[serverPhase]) || serverPhase;

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
        h('div', { className: 'realp-foot' }, t('liveHint')),

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
            'span',
            { className: 'realp-foot' },
            state.snapshot.present
              ? t('snapshot') + '：' + state.snapshot.toolCount + ' ' + t('toolsUnit') + ' · ' + t('snapshotAt') + ' ' + String(state.snapshot.generatedAt || '').replace('T', ' ').slice(0, 19)
              : t('snapshotMissing'),
          ),
        ),

        h(
          'div',
          { className: 'realp-section' },
          h('h3', null, t('bundles')),
          h('p', { className: 'realp-section-hint' }, t('bundleHint')),
          h(
            'div',
            { className: 'realp-list' },
            state.bundles.map(function (bundle) {
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
        ),

        h(
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
        ),

        h(
          'div',
          { className: 'realp-section' },
          h('h3', null, t('searchTitle')),
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
                  matches.map(function (tool) {
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
        ),

        state.snapshot.unassigned && state.snapshot.unassigned.length > 0
          ? h('div', { className: 'realp-note realp-note-warn' }, t('unassigned') + '：' + state.snapshot.unassigned.join(', '))
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
