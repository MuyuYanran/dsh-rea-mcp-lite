// REA MCP 工具的「功能族」划分。
// 用显式工具名列表（从 REA 实际 tools/list 导出：6.4.0 = 170 个，6.7.0 = 207 个），
// 便于核对与演进：若 REA 再升级后新增工具，未归族者会在 `bundles` 元工具里以
// unassigned 形式报出来，也会在 `cli.mjs status` 里提示。
//
// 版本漂移约定：保留旧版本已删除的工具名没有坏处（describeBundles 会把它们报成
// missing 而不是报错），但**新增工具必须归族**，否则用户在面板上看不到它属于哪族。

export const BUNDLES = {
  nav: {
    label: '会话与导航（打开目标、游标、字节、段表）',
    hint: '最先用得上的一组：打开二进制/文档、在地址间跳转、读字节、看段与架构。',
    tools: [
      'binary_session', 'open_binary', 'close_binary', 'list_documents', 'current_document',
      'current_address', 'current_procedure', 'get_navigation_context', 'goto_address',
      'next_address', 'prev_address', 'address_name', 'address_to_file_offset', 'read_bytes',
      'search_bytes',
      'list_architectures', 'list_segments', 'binary_overview', 'inspect_address_context',
      'list_bookmarks', 'set_bookmark', 'unset_bookmark', 'inspect_analysis_view',
    ],
  },
  native: {
    label: '原生静态分析（反编译、反汇编、交叉引用、注解）',
    hint: 'Ghidra/Hopper/IDA 类的核心操作：函数伪代码与汇编、调用图、字符串与符号、改名改注释。',
    tools: [
      'analyze_function', 'batch_decompile', 'read_function_instructions', 'procedure_pseudo_code',
      'procedure_assembly', 'procedure_info', 'procedure_callers', 'procedure_callees',
      'procedure_references', 'procedure_address', 'list_procedures', 'search_procedures',
      'get_call_graph', 'build_call_path', 'trace_call_path', 'xrefs', 'find_xrefs_to_name',
      'search_strings', 'list_strings', 'list_names', 'resolve_containing_procedure',
      'resolve_native_call_targets', 'inspect_native_instruction', 'inspect_native_data_type',
      'inspect_native_api', 'inspect_native_load_image', 'inspect_native_dispatch_metadata',
      'inspect_binary_layout', 'inspect_macho', 'inspect_signature', 'annotate_native_function',
      'set_address_name', 'set_addresses_names', 'set_comment', 'set_inline_comment',
      'comment', 'inline_comment', 'trace_native_values', 'trace_native_ui_action',
      'trace_feature', 'observe_native_calls', 'observe_native_ui', 'capture_native_ui_scenario',
      'inspect_pe_resources',
    ],
  },
  apple: {
    label: 'Apple 生态（Objective-C / Swift / plist / 资源目录 / 动态库解析）',
    tools: [
      'demangle_swift', 'get_objc_classes', 'get_objc_protocols', 'analyze_swift_types',
      'trace_dylib_resolution', 'inspect_plist', 'inspect_keyed_archive', 'inspect_asset_catalog',
      'decode_interface_builder', 'project_apple_application_graph', 'inspect_signature',
      'inspect_macho',
    ],
  },
  managed: {
    label: '.NET / 托管程序集',
    hint: 'CIL 元数据成员、托管与原生边界、托管应用图与重建导入。',
    tools: [
      'inspect_managed_artifact', 'inspect_managed_members', 'inspect_managed_native_boundaries',
      'verify_managed_native_boundaries', 'compare_managed_members',
      'project_managed_application_graph', 'import_managed_reconstruction',
    ],
  },
  js: {
    label: 'JavaScript / Electron 应用',
    hint: '打包应用的模块图、语义追踪、Electron 场景与运行时对账（本机最常用的一族）。',
    tools: [
      'analyze_javascript_application', 'recover_javascript_sources', 'trace_javascript_semantics',
      'observe_javascript_runtime', 'list_javascript_runtime_targets', 'reconcile_javascript_runtime',
      'compare_javascript_export_shapes', 'compare_application_versions', 'compare_source_to_bundle',
      'trace_application_feature', 'capture_electron_scenario', 'inspect_electron_page',
      'list_electron_targets',
    ],
  },
  web: {
    label: '网页 / 浏览器（CDP、网络、脚本、源码映射）',
    hint: '被动观察页面、抓网络与监听器、导出脚本、源码映射定位。',
    tools: [
      'inspect_web_page', 'inspect_web_network_capture', 'inspect_web_event_listeners',
      'observe_web_execution', 'observe_web_session', 'discover_webmcp_tools',
      'compare_web_captures', 'compare_web_screenshots', 'capture_web_screenshot',
      'capture_browser_scenario', 'trace_web_source_location', 'trace_web_module_imports',
      'export_web_scripts', 'analyze_web_bundle', 'list_browser_targets',
    ],
  },
  android: {
    label: 'Android / ADB / JEB',
    hint: '设备与包管理、日志、屏幕、APK 资源解码、类与方法反编译。',
    tools: [
      'capture_adb_screen', 'collect_adb_bugreport', 'inspect_adb_client', 'inspect_adb_device',
      'inspect_adb_display', 'inspect_adb_package', 'inspect_adb_window', 'install_adb_package',
      'list_adb_devices', 'list_adb_directory', 'list_adb_features', 'list_adb_packages',
      'list_adb_processes', 'list_adb_services', 'pull_adb_file', 'pull_adb_package',
      'push_adb_file', 'read_adb_logcat', 'read_adb_setting', 'resolve_adb_packages',
      'start_adb_activity', 'start_adb_app', 'stop_adb_app', 'uninstall_adb_package',
      'decode_android_resources', 'inspect_android_class', 'inspect_android_method',
      'inspect_android_package', 'project_android_application_graph', 'search_android_classes',
      'trace_android_references', 'decompile_jeb_item', 'inspect_jeb_client', 'list_jeb_units',
      'open_jeb_project', 'inspect_apktool_client',
      // 6.5.0+ 新增：Flutter/Dart AOT 与 HarmonyOS
      'identify_flutter_build', 'inspect_dart_aot', 'project_harmony_application_graph',
    ],
  },
  debug: {
    label: '动态调试（Frida / GDB / Rizin / Cutter）',
    hint: '附加或启动调试会话、下断点、跑命令、注入脚本。REA 6.5.0 起新增，单独成族是因为它需要目标环境已就绪、且风险高于静态分析。',
    tools: [
      // Frida
      'list_frida_devices', 'list_frida_processes', 'start_frida_session', 'resume_frida_session',
      'close_frida_session', 'frida_session_status', 'load_frida_script', 'unload_frida_script',
      'instrument_with_frida',
      // GDB
      'start_gdb_session', 'gdb_console', 'gdb_session_status', 'close_gdb_session',
      // Rizin
      'execute_rizin_command', 'start_rizin_debug_session', 'rizin_debug_command',
      'rizin_debug_session_status', 'close_rizin_debug_session',
      // Cutter
      'list_cutter_sessions', 'cutter_command',
    ],
  },
  formats: {
    label: '文件格式专项（Go / Rust / WASM / SQLite / Electron fuses）',
    hint: '按语言/容器抽取构建信息与依赖清单。REA 6.5.0 起新增，按需加载即可。',
    tools: [
      'inspect_go_binary', 'inspect_rust_binary', 'inspect_sqlite_database',
      'inspect_electron_fuses', 'inspect_wasm_artifact', 'compare_wasm_interfaces',
      'inspect_with_objdump',
    ],
  },
  capture: {
    label: '抓包与信号分析（PCAP / TShark / sigrok）',
    hint: '读现有抓包文件、发现协议字段、解码逻辑信号录音。REA 6.5.0 起新增。',
    tools: [
      'inspect_packet_capture', 'inspect_packet_fields', 'inspect_pcap_capture',
      'inspect_pcap_client', 'inspect_signal_decoders', 'decode_signal_recording',
    ],
  },
  evidence: {
    label: '证据治理（对比、验证、未知项、重建账本）',
    hint: '跨版本/跨版本对比、证据包导入导出、未知项跟踪与重建覆盖验证。',
    tools: [
      'compare_artifacts', 'compare_bundles', 'compare_functions', 'compare_process_captures',
      'build_reconstruction_obligation_ledger', 'evaluate_reconstruction_coverage',
      'verify_reconstruction', 'verify_unknown_resolution', 'record_unknown', 'update_unknown',
      'list_unknowns', 'export_evidence_bundle', 'import_evidence_bundle', 'get_evidence_bundle',
      'find_changed_behavior', 'correlate_static_and_runtime',
    ],
  },
  runtime: {
    label: '运行时捕获与包体（进程、固件、EVM、应用包）',
    tools: [
      'capture_process_scenario', 'inspect_recorded_crash', 'inspect_firmware_regions',
      'extract_firmware', 'inspect_evm_interface', 'inspect_artifact', 'extract_artifact',
      'compare_process_captures', 'project_apple_application_graph',
      'project_android_application_graph', 'project_managed_application_graph',
    ],
  },
};

/** 「全部」是一个虚拟族：始终匹配所有工具。 */
export const ALL_BUNDLE = 'all';

/** 自定义族 id 的合法形状：小写字母开头，只含小写字母/数字/下划线/连字符。 */
export const BUNDLE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/u;

/** 不允许占用的 id（与虚拟族冲突）。 */
const RESERVED_IDS = new Set([ALL_BUNDLE]);

/**
 * 合并内置族与用户自定义族，得到本次实际生效的族表。
 *
 * 自定义族与内置族是**并列**关系，不是覆盖：内置族由代码维护、随 REA 版本演进，
 * 让用户改写它们会在升级时产生难以解释的漂移；自定义族是用户自己的视角，
 * 想怎么切都行（同一个工具可以既在 native 里又在自定义族里——内置族本来就有这种重叠）。
 *
 * @param {object} custom 配置里的 customBundles：{ id: { label?, hint?, tools? } }
 * @returns 合并后的族表（内置族定义原样保留，自定义族多带 custom: true）
 */
export function effectiveBundles(custom) {
  const merged = { ...BUNDLES };
  if (custom === null || typeof custom !== 'object') return merged;
  for (const [id, def] of Object.entries(custom)) {
    if (!BUNDLE_ID_RE.test(id) || RESERVED_IDS.has(id)) continue;
    if (def === null || typeof def !== 'object') continue;
    const tools = Array.isArray(def.tools) ? [...new Set(def.tools.filter((t) => typeof t === 'string' && t !== ''))] : [];
    merged[id] = {
      label: typeof def.label === 'string' && def.label.trim() !== '' ? def.label.trim() : id,
      hint: typeof def.hint === 'string' ? def.hint : '',
      custom: true,
      tools,
    };
  }
  return merged;
}

/**
 * 校验一条自定义族定义，返回规范化结果或抛错。
 * @param {object} input { id, label?, hint?, tools }
 * @param {string[]} knownTools 当前 REA 版本实际提供的工具名；为空数组时不校验工具名是否存在
 */
export function normalizeCustomBundle(input, knownTools) {
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  if (!BUNDLE_ID_RE.test(id)) {
    throw new Error(`族名不合法：${id || '(空)'}（要求小写字母开头，只含小写字母、数字、下划线、连字符，最长 32）`);
  }
  if (RESERVED_IDS.has(id)) throw new Error(`族名 ${id} 是保留字`);
  if (BUNDLES[id]) throw new Error(`族名 ${id} 与内置族冲突，换个名字`);
  const rawTools = Array.isArray(input?.tools) ? input.tools.filter((t) => typeof t === 'string' && t !== '') : [];
  const known = new Set(knownTools ?? []);
  if (known.size > 0) {
    const unknown = rawTools.filter((t) => !known.has(t));
    if (unknown.length > 0) {
      throw new Error(`未知工具：${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` 等 ${unknown.length} 个` : ''}`);
    }
  }
  const tools = [...new Set(rawTools)];
  if (tools.length === 0) throw new Error('至少选一个工具');
  return {
    id,
    label: typeof input?.label === 'string' && input.label.trim() !== '' ? input.label.trim() : id,
    hint: typeof input?.hint === 'string' ? input.hint.trim() : '',
    tools,
  };
}

/** 某工具所属的全部族名（不含 all）。传 defs 则按合并后的族表算，否则只看内置族。 */
export function bundlesOf(toolName, defs) {
  return Object.entries(defs ?? BUNDLES)
    .filter(([, def]) => (def.tools ?? []).includes(toolName))
    .map(([name]) => name);
}

/**
 * 计算给定族集合要暴露的工具名集合。
 * @param {string[]} bundleNames 族名数组，可含 'all'
 * @param {object} defs 族表（默认内置族）
 */
export function resolveBundleTools(bundleNames, defs) {
  const table = defs ?? BUNDLES;
  const wanted = new Set();
  for (const name of bundleNames ?? []) {
    if (name === ALL_BUNDLE) return new Set(['*']);
    const def = table[name];
    if (!def) continue;
    for (const t of def.tools ?? []) wanted.add(t);
  }
  return wanted;
}

/** 供 `bundles` 元工具使用：每个族的工具数、估算 token 成本、以及在全部工具中的命中数。 */
export function describeBundles(allToolNames, costOf, defs) {
  const known = new Set(allToolNames);
  return Object.entries(defs ?? BUNDLES).map(([name, def]) => {
    const hit = (def.tools ?? []).filter((t) => known.has(t));
    return {
      name,
      label: def.label,
      hint: def.hint,
      custom: def.custom === true,
      toolCount: hit.length,
      missing: (def.tools ?? []).filter((t) => !known.has(t)),
      estTokens: costOf(hit),
    };
  });
}

/** 未被任何族收录的工具（REA 升级后可能出现）。 */
export function unassignedTools(allToolNames, defs) {
  return allToolNames.filter((t) => bundlesOf(t, defs).length === 0);
}
