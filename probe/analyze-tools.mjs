// Analyze REA's MCP tool payload v2: correct names, family split, and how much
// each transformation would save on the part that actually reaches the model.
import fs from 'node:fs';

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
let tools = null;
for (const line of lines) {
  try {
    const m = JSON.parse(line);
    if (m.id === 2 && m.result?.tools) tools = m.result.tools;
  } catch {}
}
const L = (x) => JSON.stringify(x ?? '').length;
const total = tools.reduce((a, t) => a + L(t), 0);

console.log('=== as received ===');
console.log('tools:', tools.length, 'chars:', total, '~tokens:', Math.round(total / 3.6));
for (const [k, v] of [['outputSchema', 'outputSchema'], ['inputSchema', 'inputSchema'], ['description', 'description']]) {
  const s = tools.reduce((a, t) => a + L(t[v]), 0);
  console.log(`  ${k.padEnd(14)} ${String(s).padStart(9)} ${((s / total) * 100).toFixed(1)}%`);
}

// ---- transformations ----
const JUNK = new Set(['$schema', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'exclusiveMinimum', 'exclusiveMaximum', 'uniqueItems', 'contentEncoding', 'contentMediaType', 'format']);

function transformSchema(schema, mode) {
  const out = JSON.parse(JSON.stringify(schema ?? {}));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (mode !== 'off') {
      for (const k of Object.keys(node)) if (JUNK.has(k)) delete node[k];
      if (typeof node.description === 'string') {
        node.description = node.description.slice(0, mode === 'aggressive' ? 50 : 80);
      }
    }
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(out);
  // drop an empty top-level $defs
  if (out.$defs && Object.keys(out.$defs).length === 0) delete out.$defs;
  return out;
}

function project(tool, { mode = 'off', dropOutput = true, descChars = 0, families = null }) {
  const firstSentence = String(tool.description ?? '').split(/(?<=\.)\s/)[0] ?? '';
  const description = descChars ? firstSentence.slice(0, descChars) : tool.description;
  const out = { name: tool.name, description, inputSchema: transformSchema(tool.inputSchema, mode) };
  if (!dropOutput) out.outputSchema = tool.outputSchema;
  return out;
}

const descToModel = (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema });

const scenarios = {
  'model-visible baseline (name+desc+inputSchema)': tools.map(descToModel),
  '+ drop outputSchema (proves it is not the model cost)': tools.map((t) => project(t, { mode: 'off' })),
  '+ slim schema junk (patterns/bounds)': tools.map((t) => project(t, { mode: 'mild' })),
  '+ 1-sentence descriptions': tools.map((t) => project(t, { mode: 'mild', descChars: 100 })),
  '+ aggressive (50-char param docs)': tools.map((t) => project(t, { mode: 'aggressive', descChars: 100 })),
};

console.log('\n=== projections (model-visible payload) ===');
const base = L(scenarios['model-visible baseline (name+desc+inputSchema)']);
for (const [label, v] of Object.entries(scenarios)) {
  const c = L(v);
  console.log(`${label.padEnd(52)} chars=${String(c).padStart(9)} ~tok=${String(Math.round(c / 3.6)).padStart(7)} (${((c / base) * 100).toFixed(1)}% of baseline)`);
}

// ---- families by tool name ----
const FAMILIES = [
  ['native-static', /(ghidra|hopper|ida|jeb|decompile|assembly|instruction|basic_block|macho|binary|objc|swift|segment|procedure|native|xref|address|bookmark|comment|name|data_type|call_graph|call_path|function|load_image|dispatch|dylib|signature|plist|asset_catalog|interface_builder|keyed_archive|architectures|documents|reference|strings|list_names)/i],
  ['android', /(adb|android|apk|dex|smali|device|logcat|screen|bugreport|jeb_|trace_android|search_android|inspect_android|decode_android)/i],
  ['web-browser', /(web|browser|cdp|page|screenshot|webmcp|listener|network_capture|electron_page|electron_target|javascript_runtime|inspector|observe_web|inspect_web|discover_webmcp|trace_web|export_web|compare_web|capture_browser|reconcile_javascript)/i],
  ['js-app-graph', /(javascript|jag|application|module|bundle|semantic|feature|recover_javascript|source_to_bundle|export_shape|analyze_javascript|compare_application|trace_javascript)/i],
  ['managed-dotnet', /(managed|cil|import_managed|inspect_managed|verify_managed|project_managed|compare_managed)/i],
  ['evidence-governance', /(compare|evidence|bundle|obligation|reconstruction|correlate|unknown|verify|ledger|coverage|changed_behavior|differential|find_changed)/i],
  ['runtime-capture', /(capture_process|process_scenario|recorded_crash|firmware|evm|unblob|binwalk|run|scenario)/i],
];

const assigned = new Set();
const buckets = [];
for (const [label, re] of FAMILIES) {
  const list = tools.filter((t) => !assigned.has(t.name) && re.test(t.name));
  for (const t of list) assigned.add(t.name);
  buckets.push([label, list]);
}
const leftover = tools.filter((t) => !assigned.has(t.name));
if (leftover.length) buckets.push(['other', leftover]);

console.log('\n=== families (heuristic by name) ===');
const liteOf = (list) => L(list.map((t) => project(t, { mode: 'mild', descChars: 100 })));
for (const [label, list] of buckets.sort((a, b) => liteOf(b[1]) - liteOf(a[1]))) {
  console.log(`${label.padEnd(20)} n=${String(list.length).padStart(3)}  lite_chars=${String(liteOf(list)).padStart(8)} ~tok=${String(Math.round(liteOf(list) / 3.6)).padStart(6)}`);
}

console.log('\n=== other family members ===');
console.log(leftover.map((t) => t.name).join(', ') || '(none)');

console.log('\n=== all tool names with size ===');
for (const t of [...tools].sort((a, b) => L(b) - L(a))) {
  console.log(`${String(L(t)).padStart(7)}  ${t.name}`);
}
