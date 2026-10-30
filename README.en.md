# dsh-rea-mcp-lite

[中文](README.md) | **English**

> Folds [REA](https://www.npmjs.com/package/rea-agents)'s reverse-engineering MCP tools into
> **5 meta-tools + on-demand tool bundles**: by default only the meta-tools sit on the table, so you
> pay a small fraction of the tool context, while **none of the tools are lost** — every one stays
> searchable and callable.
> Bundles **hot-swap at runtime** (`notifications/tools/list_changed`) — no DSH restart.
> Favourite combinations can be saved as **named presets** and switched back in one call.
> Ships **update checks and health checks**: this repo against its remote, REA against npm, and
> automatic classification of tools REA added after your bundle list was written.

A tiny zero-dependency MCP stdio proxy. It is not a schema compressor: it changes *which tool
definitions the model sees*, not how big each one is.

> The tool counts, token costs and savings percentages below are **REA-version dependent**. They are
> all in the "What it saves" table, labelled with the version they were measured on. Re-run
> `node src/cli.mjs snapshot` after a version bump; that output is the source of truth.

---

## What it saves

Measured on **REA 6.8.0** (`REA_MCP_INPUT_SCHEMA_PROFILE=compact`, `lite: "mild"`):

| Scenario | Tools visible to the model | Approx. tokens |
| --- | --- | --- |
| **Default (meta-tools only)** | 5 | **624** |
| Everything loaded (after this proxy's trimming) | 234 | 35.5k |
| Without this proxy (direct REA, model-visible part) | 229 | ~75k |

For an earlier version (REA 6.4.0, 170 tools) the same numbers were ~70k tokens direct and ~49k
through the proxy fully loaded; by 6.7.0 that became 207 tools and ~26.9k tokens through the proxy
(the newer `compact` schema profile trimmed harder). 6.8.0 is back up to 229 tools and both sides
grew by roughly 40% — the saving is still around half; see "Version adaptation".

## Why this is not "schema compression"

Measured on the actual REA 6.8.0 `tools/list` payload (`REA_MCP_INPUT_SCHEMA_PROFILE=compact`):

| Scope | Characters | Share |
| --- | --- | --- |
| The whole payload REA sends | 3,504,736 | 100% (≈974k tok) |
| `outputSchema` | 3,199,098 | **91.3%** |
| `inputSchema` | 121,537 | 3.5% |
| `description` | 135,500 | 3.9% |
| **What actually reaches the model (name + description + inputSchema)** | **270,966** | **7.7% (≈75k tok)** |

When DSH assembles an LLM request it maps exactly three fields — `@deepseek-ai/dsh-llm-deepseek/lib/index.js`:

```js
tools: options.tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,          // ← MCP's inputSchema
  ...tool.deferLoading === true ? { defer_loading: true } : {}
}))
```

`outputSchema` is used only inside DSH to validate tool results; it **costs no context at all**. So:

- 91% of that 716k-token payload is the part that looks scary and costs nothing;
- deleting it saves **0%**; trimming `pattern`/`format` saves a couple of percent; cutting
  descriptions to one sentence saves about 2%;
- the real cost is **the number of tools** (229 as of this version).

So the core idea here is **progressive disclosure**, not schema shrinking. Schema trimming
(`lite`) is only a secondary optimisation.

## How it works

```
DSH ──stdio JSON-RPC──> proxy.mjs ──stdio JSON-RPC──> rea.mjs mcp (child process)
```

Zero dependencies; the JSON-RPC framing is hand-written line splitting (MCP stdio is one JSON
object per line — no `Content-Length` headers).

| Message | Handling |
| --- | --- |
| `initialize` | Forwarded; `serverInfo.name` rewritten to `rea-lite`, and an `instructions` block is injected telling the model how to use the gateway |
| `tools/list` | **Not forwarded** — the proxy composes it from the cached REA tool table plus config (meta-tools + active bundles, trimmed per `lite`) |
| `tools/call` | Meta-tool names are handled locally; everything else is forwarded verbatim and the result returned verbatim (images and structured errors included) |
| Anything else | `notifications/*`, `resources/*`, `ping` pass through both ways |
| Hot update | A bundle change makes the proxy emit `notifications/tools/list_changed`; DSH's MCP client registers `onChanged: () => refreshTools()`, so switching tool sets needs no restart |

## Install

```bash
git clone https://github.com/MuyuYanran/dsh-rea-mcp-lite.git
cd dsh-rea-mcp-lite
```

**(1) Prepare REA** (this proxy is only a gateway; REA is what actually does the work):

```bash
npm i -g rea-agents          # or: pnpm add rea-agents; npx also works
# or use the official skill: rea setup --skill --yes
```

**(2) Write a config**: copy `config.example.json` to `config.json`, then point `child.args[0]` at
your `rea.mjs` and `env.JAVA_HOME` at your JDK.

```bash
cp config.example.json config.json   # Windows: Copy-Item config.example.json config.json
```

```jsonc
{
  "activeBundles": [],        // always-on bundles; [] = meta-tools only
  "lite": "mild",             // off | mild | aggressive
  "child": {
    "command": "node",        // an absolute path to node is recommended
    "args": ["<...>/node_modules/rea-agents/scripts/rea.mjs", "mcp"],
    "env": { "REA_MCP_INPUT_SCHEMA_PROFILE": "compact", "JAVA_HOME": "<your JDK>" }
  }
}
```

**(3) Register it with DSH**: add an entry to `~/.dsh/cordis.patch.yml` (`serverName: rea` keeps it
consistent with what REA's official skill references):

```yaml
- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rea
        transport: stdio
        command: 'C:\\Program Files\\nodejs\\node.exe'   # or the absolute path to DSH's bundled node
        args:
          - 'D:\\path\\to\\dsh-rea-mcp-lite\\src\\proxy.mjs'
        env:
          REA_LITE_CONFIG: 'D:\\path\\to\\dsh-rea-mcp-lite\\config.json'
          JAVA_HOME: 'D:\\path\\to\\jdk'
        failOnStartupError: false
```

**(4) Restart DSH** (the Cordis config is only read at startup). REA should now appear as 5 meta-tools.

> If you don't want the gateway: replace `args` with `rea.mjs` + `mcp` and drop `REA_LITE_CONFIG` to
> talk to REA directly.

## The 5 meta-tools

| Tool | Purpose |
| --- | --- |
| `search_tools` | Search all 229 tools by name + description; returns one-line purpose, required parameters, owning bundle, and whether it is currently loaded |
| `tool_schema` | Fetch a tool's **complete**, untrimmed inputSchema — use it to construct complex arguments precisely |
| `call_tool` | Call **any** tool, including tools in unloaded bundles: `{"tool":"analyze_function","arguments":{"procedure":"main"}}` |
| `bundles` | List/switch bundles, and manage named presets: `action = list \| activate \| deactivate \| set \| save-preset \| load-preset \| remove-preset` |
| `maintenance` | Gateway health and updates: check this repo / REA versions, find newly added unclassified tools and classify them, refresh the cost snapshot. Read-only by default; only `action=classify/update-*` changes the machine |

**You do not need to load a bundle to call a tool** — bundles only decide *whose manual is already
lying on the desk*.

## Bundles

Measured on **REA 6.8.0 (229 tools, `lite: "mild"`)**; for older versions see "Version adaptation".

| Bundle | Tools | Approx. tokens | Contents |
| --- | --- | --- | --- |
| `native` | 53 | 6.8k | Native static analysis (pseudocode, assembly, xrefs, annotations) |
| `android` | 40 | 4.0k | Android / ADB / JEB (devices, logs, APKs, Flutter, HarmonyOS) |
| `evidence` | 18 | 3.9k | Evidence governance (comparison, verification, residual unknowns, reconstruction ledger) |
| `web` | 15 | 3.5k | Web / browsers (CDP, network, scripts, source maps) |
| `nav` | 25 | 3.3k | Sessions and navigation (open a target, cursors, bytes, segments, byte search) |
| `runtime` | 12 | 2.8k | Runtime capture and containers (processes, firmware, EVM, application packages) |
| `formats` | 11 | 2.6k | Go / Rust / WASM / SQLite / Electron fuses / objdump / model weights / `.pyc` / BEAM |
| `js` | 13 | 2.6k | JavaScript / Electron application graphs and semantic tracing |
| `debug` | 20 | 2.2k | Frida / GDB / Rizin / Cutter dynamic debugging |
| `apple` | 14 | 1.6k | Objective-C / Swift / plist / asset catalogs / dylib resolution |
| `managed` | 8 | 1.3k | .NET / managed assemblies / managed-native boundaries / Unity IL2CPP |
| `formats` | 11 | 2.6k | Go / Rust / WASM / SQLite / Electron fuses / objdump / model weights / device tree / `.pyc` / BEAM |
| `capture` | 6 | 1.1k | PCAP / TShark / sigrok logic signals |
| `all` | 229 | 34.9k | Everything (equivalent to REA's model-visible set, but slimmer schemas) |

> Bundles overlap (`apple` tools are also in `native`; some `runtime` tools are also in `js`/`web`),
> so the per-bundle token counts sum to more than `all`.

> **These numbers drift with the REA version** (and in a counter-intuitive direction — see below).
> Both tables above are measured against the current `data/tools-model.json` snapshot; after a
> version change, re-run `node src/cli.mjs snapshot` and use its output. Do not copy these values
> into assertions or other documents as if they were constants.

### Version adaptation (REA 6.5.0 onward)

REA 6.5.0 added three bundles — `debug` / `formats` / `capture`. 6.8.0 has **229 tools** (22 more than
6.7.0), all of them classified. The 6.8.0 additions are mostly **offline single-file parsers**, filed
by what the file *is*: PE/ELF/kernel-module/GPU code objects into `native`; Apple `.ips` crash
reports and read-only `.app` bundles into `apple`; APK signatures into `android`; Unity IL2CPP
metadata into `managed`; model weights, device-tree blobs, CPython `.pyc` and Erlang BEAM into
`formats`; whole desktop-application identification into `runtime`; matching two retained function
inventories into `evidence`; and REA's own runtime limits into `nav`.

| Bundle | Tools | Contents | Notes |
| --- | --- | --- | --- |
| `debug` | 20 | Frida / GDB / Rizin / Cutter dynamic debugging | Needs a live process or device; it mutates target state |
| `formats` | 11 | Go / Rust / WASM / SQLite / Electron fuses / objdump / model weights / device tree / `.pyc` / BEAM | Some entries need an external toolchain |
| `capture` | 6 | PCAP / TShark / sigrok logic signals | Needs TShark 4.x / sigrok-cli installed |

Installing those external tools, and what actually works on Windows, is covered in
"External tools for debug / formats / capture".

**Cost varies by version, and it swings both ways**: 6.4.0 was 170 tools / ~49k tokens fully loaded;
6.7.0 was 207 tools / ~26.9k tokens fully loaded (its `compact` schema profile trimmed far harder —
the largest tool schemas went from 6–9k characters down to 500–900, so more tools cost less);
6.8.0 is 229 tools / ~35.5k tokens fully loaded. The trimming did not change again, so the cost
tracked the tool count back up, and the direct side went from ~53k to ~75k — the saving is still
about half either way. So don't bake these numbers into assertions or docs — always take them from
`data/tools-model.json`, and re-run `node src/cli.mjs snapshot` when you switch versions.

**On an older REA**, those three bundles report `0 tools` and are labelled "this REA version does
not have this bundle" — nothing is broken; the version simply lacks those capabilities.

Bundles are a static list (`src/bundles.mjs`). After a future upgrade, newly added tools that nobody
classified show up in the `bundles` output's "unassigned" list and in the `node src/cli.mjs status`
hint; tools that are classified but absent from the current version show as missing, not as an error.

## Custom bundles

The built-in bundles are cut along REA's capability domains, but everyone's everyday toolset differs.
Custom bundles let you group arbitrary tools and then toggle them like a built-in bundle.

**From the settings page**: "Settings → REA tools → Custom bundles" → create, or click "Edit":

- The left side lists **every tool** with its one-line description and cost; tick to add (no need to
  search first).
- The right side is the bundle's current selection; click × to remove. You can also **drag** tools
  from left to right.
- "Merge whole bundle" adds or removes every tool of a built-in bundle at once.
- Renaming a bundle keeps its ticks attached to it instead of silently breaking.
- The filter box at the top narrows by name or description, which helps across 229 tools.

> Why ticking is primary and dragging is secondary: WCAG 2.5.7 (AA) requires a non-dragging
> alternative for every drag operation, because a drag-only UI is unusable with a keyboard or on a
> touch screen. Hence "ticking works, dragging is nicer".

**From the CLI**:

```bash
node src/cli.mjs custom list                       # show existing ones
node src/cli.mjs custom add --id web-audit --label "Web audit" --tools inspect_web_page,analyze_web_bundle,export_web_scripts
node src/cli.mjs custom remove web-audit
```

**By editing config**: the `customBundles` field of `config.json`:

```json
{
  "customBundles": {
    "web-audit": { "label": "Web audit", "hint": "", "tools": ["inspect_web_page", "analyze_web_bundle"] }
  }
}
```

Constraints:

- Bundle ids start with a lowercase letter and contain only lowercase letters, digits, `_`, `-`,
  up to 32 characters; they may not collide with a built-in bundle or with `all`.
- Tool names must actually exist (validated against the current REA version). Otherwise saving fails
  with "unknown tool" instead of storing a bundle that can never work.
- Custom bundles sit **alongside** built-ins and never rewrite them; the same tool can belong to a
  built-in bundle and to several custom bundles at once.
- Saving goes through the same config watcher as `activeBundles`, so it hot-swaps in about a second.

## Presets (save and load your favourite combinations)

Custom bundles answer "these tools belong together"; presets answer "this exact selection plus this
schema profile is something I keep switching back to".

```bash
node src/cli.mjs preset                        # list presets (● marks the one in effect)
node src/cli.mjs preset save native-deep --note "native + evidence"   # capture current selection
node src/cli.mjs preset save android-live --bundles android,debug,nav  # or name the bundles explicitly
node src/cli.mjs preset show native-deep
node src/cli.mjs preset use native-deep        # switch back in one command
node src/cli.mjs preset remove native-deep
```

The settings page has the same thing in a "Presets" section: type a name → "Save current selection";
each preset row has "Load" and "Delete", and the one currently in effect is tagged. The model can do
it too (via the `bundles` meta-tool), so "save this setup, I'll want it back later" just works:

```json
{"action":"save-preset","preset":"native-deep","note":"native + evidence"}
{"action":"load-preset","preset":"native-deep"}
```

A preset records **which bundles are checked** plus the `lite` / `shortDescription` / `metaTools`
switches, a note and a timestamp. Loading it writes those keys back, and the usual hot-swap follows
(about a second).

Four deliberate choices:

- **`child` is never stored.** The child command and environment are machine-specific (`JAVA_HOME`,
  external tool paths); letting them travel inside a preset means reading one machine's paths into
  another.
- **Referenced bundles that no longer exist are skipped and reported.** If a custom bundle was
  deleted, or the preset came from another machine, loading brings in what exists and lists what it
  skipped — it never silently loads an empty bundle.
- **The schema profile is stored with it.** `lite` changes the length of every tool definition, so the
  cost basis moves with it; the panel tells you when the snapshot needs regenerating.
- **Presets live outside the plugin directory.** They are not written into `config.json`, so
  **updating the plugin does not clear them** (see below).

Presets have their own file, and its location deliberately does **not** follow `config.json`:

```
<user-data-root>/rea-lite/presets.json    user-data-root = DSH_HOME, or ~/.dsh when unset
```

Why a separate store: `config.json` lives wherever `REA_LITE_CONFIG` says, and when that is unset it
sits at the gateway root — which, for a plugin installed from npm, is **inside the plugin package**
(`node_modules/dsh-rea-lite-panel/gateway/`). Updating the plugin replaces that whole directory, so
anything written inside it disappears with it. Presets are data you wrote by hand and should not be
lost that way. It also matches what a preset already is: a record of "which bundles, which schema
profile" with no machine paths in it, so it is portable across installs and profiles by nature.

The file:

```json
{
  "version": 1,
  "presets": {
    "native-deep": {
      "activeBundles": ["nav", "native", "evidence"],
      "lite": "mild", "shortDescription": true, "metaTools": true,
      "note": "native + evidence", "savedAt": "2026-10-25T05:11:14.406Z"
    }
  }
}
```

- **Upgrading from an older version migrates automatically.** If `config.json` still carries `presets`,
  the first read (proxy start, panel open, or any CLI run) moves them into the store and clears the
  copy in `config.json` — two copies would drift apart, so only one is kept.
- The `preset` subcommand and the panel both show the actual location, so you can back it up.
- To relocate it: `REA_LITE_PRESETS` names the file directly, `REA_LITE_DATA_DIR` names the directory.

A preset name is free text up to 48 characters (non-ASCII is fine), and may not contain
`\ / : * ? " < > |` or control characters — it has to be a safe JSON key and a safe command-line
argument. Saving under an existing name overwrites it.

## Three ways to run it

**A. Gateway mode (recommended)** — only the 5 meta-tools (~624 tok), everything via `call_tool`:
```bash
node src/cli.mjs none
```

**B. Keep your usual bundles resident** — e.g. if you do Electron reverse engineering every day, keep
`nav,js` resident (36 tools, ~4.4k tok; ~5.0k including meta-tools) and load the rest on demand:
```bash
node src/cli.mjs use nav js
```

**C. Everything** — when the model needs to see all tools at once (e.g. to plan a long workflow itself):
```bash
node src/cli.mjs all
```

```bash
node src/cli.mjs list      # bundle overview with live token estimates
node src/cli.mjs status    # current configuration
```

## Five ways to switch (all hot — no DSH restart)

1. **Tick in the settings page** (easiest; see below) — "Settings → REA tools", with live token cost
   per bundle and a measured before/after check.
2. **Just tell the model** — "load the web and js bundles" → the model calls
   `bundles {"action":"activate","bundles":["web","js"]}` → the proxy emits `list_changed` → DSH
   swaps the tool set on the spot.
3. **Edit `config.json`** — the proxy `fs.watch`es the file; changes apply within ~150 ms.
4. **CLI** — `node src/cli.mjs use web js` (which is really just editing `config.json`).
5. **Load a preset** — "Presets → Load" in the panel, `node src/cli.mjs preset use <name>`, or let the
   model call `bundles {"action":"load-preset","preset":"<name>"}`; it swaps the selection and the
   schema profile in one go.

Runtime switches are written back to `config.json` (`persistRuntimeSwitch: true`), so they survive a
restart.

## Updates and health checks

All three checks ask "what version is out there, and what version do I have?", so they are one shared
pipeline (`src/updates.mjs` + `src/maintenance.mjs`); the CLI, the settings page and the `maintenance`
meta-tool all call the same implementation.

```bash
node src/cli.mjs check                       # all three blocks: this repo / REA itself / tool coverage
node src/cli.mjs doctor                      # coverage only (tools REA has that the bundle list does not)
node src/cli.mjs update-self [--apply]       # fast-forward this repo (git merge --ff-only)
node src/cli.mjs update-rea  [--apply]       # upgrade rea-agents (then auto-refresh snapshot + classify)
node src/cli.mjs classify [--apply] [--set tool=bundle,…]
```

`check` looks like this:

```
== this repo ==
  main is 2 commits behind origin/main (0 ahead), fast-forwardable
    a18ab29 some new commit
== REA itself ==
  installed 6.8.0 (pnpm @ D:/.../rea-agents)
  npm has nothing newer than 6.8.0
== tool coverage ==
  source: live; 229 tools present, 229 classified
  every tool is classified and no entry is stale.
```

Three boundaries that are never crossed:

- **Checks are read-only.** `checkSelfUpdate` only runs `git fetch` + `rev-list`; `checkReaUpdate`
  only reads the npm registry and the local `package.json`. The panel computes coverage from the
  snapshot by default, rather than starting REA just to look at a conclusion.
- **Writes are explicit.** `update-self` only does `--ff-only`, and **refuses outright on a dirty
  working tree or when there are local unpushed commits** (that is a divergence a human has to decide
  about — merge or rebase). `update-rea` first backs up manifests and lockfiles to
  `_upgrade-backup-<timestamp>/`, and restores and reinstalls them if the install fails.
- **Nothing is automatic by default.** `config.updates.*.checkOnStart` only writes a log line;
  `autoApply` is what actually changes the machine. Both default to `false`: updates modify your
  install and your repo, so they must be turned on deliberately.

### How new tools from a new REA release get classified

The bundle list is static, so every tool REA adds shows up as "unclassified". `classify` scores and
grades them automatically:

- Scoring uses **token rarity**: `dart`/`pcap`/`frida` appear in only one bundle (a strong signal),
  while `inspect`/`verify`/`compare` are everywhere (weak signals, listed as stopwords).
- A score that clears the threshold *and* clearly leads the runner-up → `high`, and `--apply` writes
  it. Ties or a low score → `medium`/`low`, suggestion only.
- `low` gets no suggestion at all — a genuinely new domain (WiFi capture, say) is better left to the
  model. `classify` prints a prompt you can paste into DSH to get back JSON shaped
  `{"tool name": "bundle id"}`.
- Results are written to `config.json`'s `bundleExtras` (`{ "capture": ["inspect_x"] }`) and **never
  to `bundles.mjs`**: the built-in list stays hand-maintained, machine judgement lives in its own
  layer, and deleting that layer reverts everything.

### The settings page's "Updates & health" section

"Settings → REA tools → Updates & health": one card shows all three conclusions (this repo / REA /
coverage), with buttons "Update this repo", "Upgrade REA", "Refresh snapshot", "Show classification
suggestions" and "Write high-confidence classifications". Checks read the snapshot by default; tick
"query REA live" to actually start REA once. A write action re-runs the checks afterwards and logs the
outcome in the log area.

### Also reachable from the model side

The `maintenance` meta-tool exposes the same actions to the model (default `action=report`, read-only):

```
mcp__rea__maintenance { "action": "report" }                     # all three blocks
mcp__rea__maintenance { "action": "classify" }                   # suggestions + the prompt for the model
mcp__rea__maintenance { "action": "classify", "apply": true }     # write high-confidence ones
mcp__rea__maintenance { "action": "snapshot" }                   # refresh the cost snapshot
mcp__rea__maintenance { "action": "update-rea", "apply": true }    # upgrade (restarts the child and re-handshakes)
```

Presets are on the meta-tool too (via `bundles`), so "save this setup, I'll want it back later" is
something you can simply say:

```
mcp__rea__bundles { "action": "save-preset", "preset": "native-deep", "note": "native + evidence" }
mcp__rea__bundles { "action": "load-preset", "preset": "native-deep" }
mcp__rea__bundles { "action": "remove-preset", "preset": "native-deep" }
```

## Settings page (optional, recommended)

`dsh-plugin/` in this repo is a DSH plugin (details in [dsh-plugin/README.md](dsh-plugin/README.md)).
Once installed, **Settings → REA tools** gains a page.

**Kernel requirement**: DSH 0.2.0 and later (including prereleases such as 0.2.1-rc.5 and
0.2.2-alpha.x), with the 0.1.6-alpha.1 line still in range. That range lives in
`dsh-plugin/package.json` as `engines.dsh` plus the `@deepseek-ai/dsh` peer, and **DSH evaluates it
when it loads a bundle**: on a mismatch the whole bundle is skipped — the settings page simply
disappears, and nothing is logged by default. Each 0.2.x prerelease line is listed explicitly,
because semver's prerelease rule makes a range like `>=0.2.0-rc.1 <0.3.0-0` fail to cover
`0.2.1-rc.5` for pnpm/npm; the "DSH kernel compatibility declaration" section of
`node test/maintenance.test.mjs` recomputes this version by version.

The page is split into **six sections** (a top-level tab bar), and each section brings its own
sub-menu, filters and pagination — 200+ tools, 12 bundles and any number of presets no longer pile
up in one long scroll:

| Section | What it holds | Sub-menu / filters / paging |
| --- | --- | --- |
| **Overview** | What the model sees right now: meta-tool cost, cost of the ticked bundles, the total and how much it saves, the measured in-session values; plus a **context breakdown bar** (used vs saved) and quick actions | — |
| **Bundles** | Tick bundles; each is labelled with tool count and approximate tokens | Sub-menu: all / built-in / custom; chips: all / loaded / not loaded / needs setup; a name filter; 6 per page |
| **Groups** | Custom bundles (visual editor: every tool on the left, the selection on the right, drag or tick) | — |
| **Presets** | Named presets: capture the current selection and schema profile, load it back in one click | Sub-menu: all presets / by time saved; a name filter; 5 per page; **shows the store location** (outside the plugin directory, so plugin updates do not clear it) |
| **Tools** | Search tools by name or description and see which bundles own them and what they cost | 12 per page |
| **Updates & health** | Conclusions for this repo / the REA package / tool coverage, the write actions, and the auto-update switches | "query REA live" toggle |

Per section:

- Checkboxes switch bundles, each labelled with tool count and approximate tokens; the header totals
  "meta-tools + ticked bundles" and shows the percentage saved against loading everything.
- **Bundles expand**: "show tools in bundle" lists each tool in that bundle with its own cost, so you
  don't have to read REA's docs to find out what a bundle contains.
- **Risk and version labels**: `debug`/`capture`/`formats` are marked "needs target environment";
  bundles absent from the current REA version are marked "not in this REA version" (instead of
  letting you believe a tick did nothing).
- **Measured in-session**: the number and character count of `mcp__rea__*` tools that really exist in
  DSH's tool registry — it follows your change in about a second, which is the authoritative answer to
  "did the hot swap actually happen".
- A status light shows whether the rea server is connected / disabled in MCP management / enabled but
  not connected, and points you at MCP management when it is disabled.
- A **Presets** section: type a name to capture the current selection and schema profile; every preset
  row has Load and Delete, and the one in effect is tagged. A preset whose referenced bundles have
  disappeared (deleted custom bundle, or a preset copied from another machine) is flagged on the spot
  instead of silently doing nothing.
- A "which bundle owns this tool" search box, over 229 tools by name or description.

```bash
# install into a profile (desktop shown here; web works the same) — dependencies and
# dsh.profile.bundles are registered automatically
dsh plugin --profile desktop add link:/path/to/dsh-rea-mcp-lite/dsh-plugin
```

Restart DSH once after installing so the plugin loads; after that, changing ticks **does not** need a
restart — the panel writes `config.json`, the proxy watches it and hot-swaps in about a second.

- The panel only controls **which bundles load**; it does not start or stop the MCP server itself
  (that is MCP management's job). When `rea` is disabled in the current profile, the panel says so.
- The plugin looks for the gateway in this order: the plugin row's `root` → `REA_LITE_ROOT` → the
  repository layout (this package's parent) → the copy shipped inside the package (`gateway/`).
  When the gateway lives elsewhere, set `REA_LITE_ROOT` to the gateway directory.
- The panel reads `data/tools-model.json` (the cost snapshot: character count per tool + one-line
  description + owning bundle), **without full schemas**, currently about 37 KB. The proxy refreshes
  it every time it connects to REA; you can also regenerate it manually with `npm run snapshot`.

### Installing from npm / the plugin market (no clone)

```bash
npm i -g rea-agents                                  # the REA server the gateway talks to
dsh plugin --profile desktop add dsh-rea-lite-panel   # the panel, plus a gateway copy in the package
# not taking the npm route (or you want the prebuilt package): the Release tarball
dsh plugin --profile desktop add "https://github.com/MuyuYanran/dsh-rea-mcp-lite/releases/latest/download/dsh-rea-lite-panel.tgz"
```

The published package **ships its own copy of the gateway** (`gateway/`: `src/`, the tool snapshot and
the config template), so it runs inside `node_modules` where no sibling `src/` exists. In a checkout the
repository's own `src/` still wins; the copy is only the fallback.

The panel does not register the MCP server, so add the row to your profile's `cordis.patch.yml` exactly
as in the source install, with `args` pointing at the copy inside the package:

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
          REA_LITE_CONFIG: <stable path>/rea-lite/config.json
        failOnStartupError: false
```

Keep `REA_LITE_CONFIG` outside `node_modules` (e.g. `%USERPROFILE%\.dsh\rea-lite\config.json`): a plugin
update replaces the package directory wholesale, and a config inside it goes with it. Set it as a
machine environment variable too, so the settings page and the gateway read and write the same file.

## Configuration keys

| Key | Default | Meaning |
| --- | --- | --- |
| `activeBundles` | `[]` | Bundles that stay resident |
| `metaTools` | `true` | Whether to expose the 5 meta-tools (turn off and only `activeBundles` remain) |
| `lite` | `"mild"` | `off` \| `mild` \| `aggressive` — how hard to trim schemas/descriptions when exposing |
| `shortDescription` | `true` | One-sentence descriptions only (the full text is still available via `tool_schema`) |
| `persistRuntimeSwitch` | `true` | Whether runtime switches are written back to the config file |
| `toolCallTimeoutMs` | `600000` | Per-call timeout (decompiler-style tools can run for a long time) |
| `customBundles` | `{}` | User-defined bundles: `{ id: { label?, hint?, tools: [...] } }` |
| `bundleExtras` | `{}` | Tools auto-classified into built-in bundles: `{ "capture": ["inspect_x"] }` (additive, never replacing) |
| `presets` | — | **Moved out of `config.json`**: presets live in `<user-data-root>/rea-lite/presets.json` so updating the plugin does not clear them (see "Presets"). The key here is only a one-time migration source — a legacy copy is read, moved, and cleaned up |
| `updates.self` | `{ remote: "origin", checkOnStart: false }` | This repo's updates; `autoApply: true` fast-forwards at startup |
| `updates.rea` | `{ registry: "https://registry.npmjs.org/rea-agents", checkOnStart: false }` | REA's own updates; `autoApply: true` upgrades at startup |
| `child` | — | How to launch the real REA: `command` / `args` / `env` |

- `lite: "mild"` drops `pattern`/`format`/`minLength`… and truncates descriptions to 80 characters;
  `aggressive` also drops `examples`/`default` and truncates to 50. Constraints that were trimmed are
  still validated server-side by REA, so when you hit an argument error, fetch the original schema
  with `tool_schema`.
- Environment variables: `REA_LITE_CONFIG` sets the config file location; `REA_LITE_LAUNCHER`
  overrides the REA launcher path; `REA_LITE_PRESETS` / `REA_LITE_DATA_DIR` set the preset store
  (see "Presets").
- `child.env` is merged into the REA child process environment and is the entry point for pointing
  REA at external tools (`REA_TSHARK_COMMAND` and friends).
  **Changing `child` (command/args/env) triggers a child hot restart**: the proxy kills the old REA,
  spawns with the new config, replays the handshake, refetches the tool list, and then sends the
  client `notifications/tools/list_changed` — so you don't need to restart DSH to add a tool path.
  (`activeBundles` / `lite` and friends still go through the lightweight hot path.)

## Verifying it yourself

```bash
node test/probe.mjs         # 28 integration tests: handshake / meta-tools / search / forwarding / hot load / hot unload / everything / custom bundles / presets
node test/plugin.test.mjs   # 91 plugin checks: fake Cordis context drives the panel API + renders the settings page
node test/maintenance.test.mjs # 190 checks: classification scoring / extras merge / tool coverage / version comparison / git fast-forward on a temporary real repo / presets / the standalone preset store / the DSH kernel compatibility declaration / new panel routes
node test/panel-render.test.mjs # 68 checks: re-renders the whole settings page on a minimal React runtime (every "Updates & health", "Presets" and "host locale" branch)
node test/reload-child.mjs  # 6 child hot-restart checks: change child.env → restart REA → re-handshake → refetch tools → notify client
node test/check-config.mjs  # starts REA with the real config.json and confirms every tool is reachable
node e2e-check.mjs          # 9 external-tool checks: real proxy → real REA → real objdump/rizin/tshark/WABT/SQLite/Frida/Cutter
node src/cli.mjs snapshot   # regenerate the cost snapshot data/tools-model.json
```

Matching npm scripts: `npm run test:panel` / `test:maintenance` / `test:reload` / `test:e2e` /
`test:config` / `probe` / `snapshot` / `check` / `doctor` / `classify`.

None of these assertions hard-code tool counts or total token cost — those drift with the REA version
(6.4.0 = 170 tools / ~49k tok, 6.7.0 = 207 tools / ~26.9k tok, 6.8.0 = 229 tools / ~35.5k tok).
Every baseline derives from the snapshot file.

Before changing code, read [AGENTS.md](AGENTS.md) (Chinese): it records this repo's ten hard
constraints, a code map, and the traps already stepped on.

## External tools for debug / formats / capture

These three bundles call native tools (objdump, rizin, GDB, tshark, WABT, sigrok-cli, Cutter), and
**REA explicitly does not install them** — it finds them on `PATH` or via `REA_*_COMMAND` at runtime.
So you install them at the OS level and put the absolute paths into `child.env` (see
`config.example.json`).

The author's install, the reasoning behind each choice, what actually works on Windows (which
capabilities REA's own source hard-rejects by platform), and the upstream traps hit along the way
(Cutter 2.5.0's Windows build cannot load Python plugins at all; the missing `libffi-8.dll`; and so
on) are all recorded in `_Tools/README-rea-target-env.md` with a companion entry script
`_Tools/rea-target-env.sh`. Those two files live on the author's machine, not in this repository.

## Companion model-side docs

- `skill/SKILL.md` — a standalone "gateway mode" skill that teaches the model to use these meta-tools
  (copy it to `~/.agents/skills/rea-tool-gateway/`).
- If you have REA's official `reverse-engineer-anything` skill installed, consider adding a note at
  the top of its `SKILL.md`: when the tool list contains only meta-tools, keep working through
  `call_tool` as usual (the wording from this README can be reused directly).

## Known limitations

- The first handshake pulls REA's full tool table once (229 tools / about 3.3 MB on 6.8.0; handshake
  + list measured at ~1.5 s here, which depends on the machine and the disk cache — an order of
  magnitude, not a promise), after which it is cached.
- Trimming schema keywords makes **pre-call argument validation looser**, so errors surface one step
  later, from REA (as a structured tool error).
- Only stdio MCP is proxied; `mode: "direct"` is a reserved field and the bypass path is not implemented.
- DSH's LLM layer already has a `defer_loading` field (`tool.deferLoading`). If DSH ever allows it on
  MCP tools, that native mechanism would save more than this proxy; it is not usable today and is
  listed as future direction.
- The numbers in the cost snapshot `data/tools-model.json` change with the REA version; after
  switching versions re-run `node src/cli.mjs snapshot`, or the settings page keeps showing the old
  version's costs.
- Automatic classification only works on **words in names/descriptions**. If REA introduces a wholly
  new domain (wireless capture, say), no bundle contains its distinctive words, and classification
  honestly reports "low / no suggestion" instead of guessing. Use the prompt `classify` prints to let
  the model decide, then write it back with `--set`.
- Update checks need the network (git remote / npm registry). Offline, `check` writes "could not
  reach remote" into the affected block without breaking the others; the panel computes coverage from
  the snapshot by default, so the unclassified list is available offline too.

## Local deployment notes (author's environment)

- The gateway's entry in the local `~/.dsh/cordis.patch.yml` is `rea-mcp` (`serverName: rea`), backed
  up as `cordis.patch.yml.bak-rea-lite-*`.
- `probe/` holds the one-off analysis scripts and raw captures used to derive the numbers above;
  large artifacts are `.gitignore`d.
- Analysis scripts: `probe/inspect-asar.mjs` (parses an Electron `app.asar`), `probe/asar-grep.mjs`
  (content search inside an asar), `probe/analyze-tools.mjs`, `probe/inspect-shape.mjs`,
  `probe/write-names.mjs`.

## License

MIT