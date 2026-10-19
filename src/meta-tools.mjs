// 始终暴露的元工具：用极小的上下文成本，让 170 个 REA 工具全部保持可达。
import { BUNDLES, ALL_BUNDLE, bundlesOf, describeBundles, unassignedTools } from './bundles.mjs';
import { projectTool, estimateTokens } from './lite.mjs';

export const META_TOOLS = [
  {
    name: 'bundles',
    description:
      '列出或切换 REA 功能族。REA 有 170 个逆向工具，默认不全量加载（否则占用大量上下文）；本工具显示每个功能族的工具数、上下文成本与加载状态，并可用 action=activate/deactivate/set 即时开关（热更新，无需重启）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'activate', 'deactivate', 'set'], description: '默认 list；activate/deactivate 为增量开关，set 为直接替换当前加载集合。' },
        bundles: { type: 'array', items: { type: 'string' }, description: `族名数组，如 ["web","js"]；可用 all 表示全部 170 个工具。已知族：${Object.keys(BUNDLES).join(', ')}` },
      },
    },
  },
  {
    name: 'search_tools',
    description:
      '在全部 170 个 REA 工具里按关键词搜索（工具名与说明都参与匹配），返回工具名、一句话用途、必填参数、所属功能族与是否已加载。任何 REA 能力都可通过 call_tool 调用，无需先加载其功能族。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，如 pseudocode、xref、adb、apk、cookie、module' },
        limit: { type: 'number', description: '返回条数（默认 15，上限 60）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'tool_schema',
    description:
      '返回某个 REA 工具的完整输入参数 schema（未经裁剪）。当 call_tool 报参数错误、或需要精确构造复杂参数时使用。',
    inputSchema: {
      type: 'object',
      properties: { tool: { type: 'string', description: '工具名，如 analyze_function' } },
      required: ['tool'],
    },
  },
  {
    name: 'call_tool',
    description:
      '调用任意 REA 工具（包括当前未加载功能族的工具），原样返回其结果。tool 传工具名，arguments 传参数对象。例：{"tool":"analyze_function","arguments":{"procedure":"main"}}。',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '工具名（可用 search_tools 查找）' },
        arguments: { type: 'object', description: '传给该工具的参数对象' },
      },
      required: ['tool'],
    },
  },
];

export const META_NAMES = new Set(META_TOOLS.map((t) => t.name));

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * @param {object} ctx 由 proxy 提供：
 *   allTools() 全部上游工具、exposedNames() 当前已暴露的工具名集合、
 *   activeBundles()/setActiveBundles()、callTool()、lite()
 */
export async function handleMetaTool(name, args, ctx) {
  const tools = ctx.allTools() ?? [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  // 生效的族表 = 内置族 + 用户自定义族（ctx 没提供时退回只有内置族）。
  const table = typeof ctx.bundleTable === 'function' ? ctx.bundleTable() : BUNDLES;

  if (name === 'bundles') {
    const action = args?.action ?? 'list';
    if (action !== 'list') {
      const requested = Array.isArray(args?.bundles) ? args.bundles : [];
      const unknown = requested.filter((b) => b !== ALL_BUNDLE && !table[b]);
      if (unknown.length) return fail(`未知功能族：${unknown.join(', ')}。已知：${Object.keys(table).join(', ')}, ${ALL_BUNDLE}`);
      let next;
      if (action === 'set') next = [...new Set(requested)];
      else if (action === 'activate') next = [...new Set([...ctx.activeBundles(), ...requested])];
      else next = ctx.activeBundles().filter((b) => !requested.includes(b));
      ctx.setActiveBundles(next);
      const summary = await ctx.describeExposed();
      return text(`已更新加载集合为 [${next.join(', ') || '仅元工具'}]，工具列表已热更新。\n\n${summary}`);
    }
    const summary = await ctx.describeExposed();
    return text(summary);
  }

  if (name === 'search_tools') {
    const query = String(args?.query ?? '').trim();
    if (!query) return fail('缺少 query 参数。');
    const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 60);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const exposed = ctx.exposedNames();
    const scored = [];
    for (const tool of tools) {
      const nameLower = tool.name.toLowerCase();
      const descLower = String(tool.description ?? '').toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (nameLower === term) score += 100;
        else if (nameLower.includes(term)) score += 40;
        else if (descLower.includes(term)) score += 8;
      }
      if (score > 0) scored.push({ tool, score });
    }
    scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    if (!scored.length) {
      return text(`没有匹配「${query}」的工具。可用功能族：${Object.keys(table).join(', ')}（用 bundles action=set 加载整族）。`);
    }
    const lines = scored.slice(0, limit).map(({ tool }) => {
      const families = bundlesOf(tool.name, table).join('/') || '未归族';
      const required = tool.inputSchema?.required;
      const requiredText = Array.isArray(required) && required.length ? `必填: ${required.join(', ')}` : '无必填参数';
      const loaded = exposed.has(tool.name) ? '★已加载' : '';
      const summary = String(tool.description ?? '').replace(/\s+/g, ' ').slice(0, 150);
      return `- ${tool.name}  [${families}] ${loaded}\n  ${summary}\n  ${requiredText}`;
    });
    const more = scored.length > limit ? `\n（共 ${scored.length} 个匹配，已显示前 ${limit} 个）` : '';
    return text(`匹配「${query}」：\n${lines.join('\n')}${more}\n\n用 call_tool 调用：{"tool":"<工具名>","arguments":{…}}；参数细节用 tool_schema 查询。`);
  }

  if (name === 'tool_schema') {
    const target = byName.get(String(args?.tool ?? ''));
    if (!target) return fail(`没有名为 ${args?.tool} 的工具。用 search_tools 查找。`);
    const families = bundlesOf(target.name, table);
    return text(
      `工具：${target.name}\n功能族：${families.join(', ') || '未归族'}\n` +
      `已加载：${ctx.exposedNames().has(target.name) ? '是' : '否（可直接用 call_tool 调用）'}\n\n` +
      `说明：\n${String(target.description ?? '').replace(/\s+/g, ' ')}\n\n` +
      `输入 schema：\n${JSON.stringify(target.inputSchema ?? {}, null, 2)}`,
    );
  }

  if (name === 'call_tool') {
    const toolName = String(args?.tool ?? '');
    if (!toolName) return fail('缺少 tool 参数。');
    if (!byName.has(toolName)) return fail(`没有名为 ${toolName} 的工具。用 search_tools 查找可用工具。`);
    if (META_NAMES.has(toolName)) return fail(`${toolName} 是元工具，请直接调用它。`);
    const toolArgs = args?.arguments && typeof args.arguments === 'object' ? args.arguments : {};
    return await ctx.callTool(toolName, toolArgs);
  }

  return fail(`未知元工具：${name}`);
}

/** 组装 bundles 元工具的输出文本。 */
export async function describeExposedText(ctx) {
  const tools = ctx.allTools() ?? [];
  const exposedNames = ctx.exposedNames();
  const names = tools.map((t) => t.name);
  const active = ctx.activeBundles();
  const exposedTools = tools.filter((t) => exposedNames.has(t.name));
  const projected = exposedTools.map((t) => projectTool(t, { lite: ctx.lite() }));
  const metaTokens = estimateTokens(META_TOOLS);
  const totalTokens = estimateTokens(projected) + metaTokens;

  const describe = (hit) => describeBundles(
    names,
    (list) => estimateTokens(tools.filter((t) => list.includes(t.name)).map((t) => projectTool(t, { lite: ctx.lite() }))),
    typeof ctx.bundleTable === 'function' ? ctx.bundleTable() : undefined,
  ).map((b) => {
    const isActive = active.includes(b.name) || active.includes(ALL_BUNDLE);
    const flag = isActive ? '[已加载]' : '';
    const tag = b.custom ? '（自定义）' : '';
    const hint = b.hint ? `  ${b.hint}` : '';
    return `- ${b.name.padEnd(9)} ${String(b.toolCount).padStart(3)} 个  ~${String(b.estTokens).padStart(6)} tok ${flag}  ${b.label}${tag}${hint}`;
  });

  const lines = describe();
  const unassigned = unassignedTools(names, typeof ctx.bundleTable === 'function' ? ctx.bundleTable() : undefined);
  const activeText = active.length ? active.join(', ') : '（无，仅 4 个元工具）';
  return [
    `REA 工具共 ${names.length} 个；当前加载：${activeText}`,
    `模型可见工具：${exposedNames.size} 个 + ${META_TOOLS.length} 个元工具，估算上下文成本 ~${totalTokens} tok（全量加载需 ~70k tok）。`,
    '',
    '功能族（用 action=activate/deactivate/set 开关，热更新）：',
    ...lines,
    unassigned.length ? `\n未归族的工具（REA 升级后新增）：${unassigned.join(', ')}` : '',
    `\n提示：任何工具都可以不加载族直接用 call_tool 调用；参数细节用 tool_schema 查询。`,
  ].filter(Boolean).join('\n');
}
