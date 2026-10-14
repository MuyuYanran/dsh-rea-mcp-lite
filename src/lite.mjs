// 工具载荷瘦身：只在「暴露给模型」时裁剪，原始 schema 仍保留给 tool_schema 元工具按需查询。

const JUNK_KEYWORDS = new Set([
  '$schema', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'exclusiveMinimum', 'exclusiveMaximum', 'uniqueItems', 'multipleOf',
  'contentEncoding', 'contentMediaType', 'patternProperties',
]);

const AGGRESSIVE_EXTRA = new Set(['examples', 'default', 'deprecated']);

/**
 * 裁剪一个 JSON Schema 的冗余关键字与描述长度。
 * @param {object} schema 原始 schema
 * @param {'off'|'mild'|'aggressive'} mode
 * @param {number} descChars 描述截断长度（0 = 不截断）
 */
export function slimSchema(schema, mode, descChars) {
  if (!schema || mode === 'off') return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    for (const key of Object.keys(node)) {
      if (JUNK_KEYWORDS.has(key) || (mode === 'aggressive' && AGGRESSIVE_EXTRA.has(key))) { delete node[key]; continue; }
    }
    if (descChars > 0 && typeof node.description === 'string' && node.description.length > descChars) {
      node.description = node.description.slice(0, descChars).replace(/\s+$/, '') + '…';
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(clone);
  if (clone.$defs && Object.keys(clone.$defs).length === 0) delete clone.$defs;
  return clone;
}

/** 一句话描述：取第一句，必要时截断。 */
export function shortDescription(description, max = 160) {
  const text = String(description ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.。!！?？])\s/)[0] ?? text;
  const chosen = firstSentence.length > max ? firstSentence.slice(0, max).replace(/\s+\S*$/, '') + '…' : firstSentence;
  return chosen;
}

/**
 * 把上游 MCP 工具投影成暴露给模型的形态。
 * @param {object} tool 上游工具对象
 * @param {{lite:string, shortDesc:boolean}} opts
 */
export function projectTool(tool, opts) {
  const lite = opts?.lite ?? 'mild';
  const descChars = lite === 'aggressive' ? 50 : lite === 'mild' ? 80 : 0;
  const out = {
    name: tool.name,
    description: opts?.shortDesc === false ? tool.description : shortDescription(tool.description),
    inputSchema: slimSchema(tool.inputSchema, lite, descChars),
  };
  // outputSchema 不进模型上下文（仅用于结果校验），保留可让 DSH 正确校验结构化输出。
  if (tool.outputSchema !== undefined) out.outputSchema = tool.outputSchema;
  return out;
}

/**
 * 工具定义在模型上下文中的实际成本。
 * DSH 只把 name / description / parameters(=inputSchema) 发给模型
 * （见 dsh-llm-deepseek/lib/index.js：`input_schema: tool.parameters`），
 * outputSchema 仅用于结果校验，因此不计入。
 */
export function modelVisibleChars(tool) {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  }).length;
}

/** 估算一段工具定义占用模型上下文的 token 数（英文 JSON 约 3.6 字符/token）。 */
export function estimateTokens(tools) {
  const chars = (tools ?? []).reduce((sum, tool) => sum + modelVisibleChars(tool ?? {}), 0);
  return Math.round(chars / 3.6);
}
