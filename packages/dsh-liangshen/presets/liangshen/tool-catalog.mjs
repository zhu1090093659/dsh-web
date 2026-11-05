/**
 * tool-catalog — the model-visible tool surface for LiangShen mode: the
 * presentation this composition renders, gentle tool paging for high-fan-out
 * namespaces, and the durable catalog message.
 *
 * PRESENTATION: the `presentation` config names the transport the session
 * carries, matching the SDK's tool presentation modes:
 * - `native`: the native roster, no code transport;
 * - `ptc` (default): the wire collapses to the single `run_code` transport
 *   and every other tool is reached from inside the program through the
 *   generated SDK.
 *
 * The preset composition is what actually selects it: `src/composition.ts`
 * enables or disables the `tool-executor-ptc` row from the same setting, and
 * that row is what installs the executor whose `describe()` decides the wire
 * (0.2.2 retired `ctx.tools.presentAs`, the old per-scope declaration, so this
 * plugin no longer declares anything). A deployment with no code runtime keeps
 * the native surface, and the catalog says so. There is no turn-boundary
 * staging: the retired anchor-turn mechanism is gone, and the legacy
 * `anchorTools` key is accepted but ignored with a one-time warning. The legacy
 * boolean `ptcPresentation` maps onto the enum (true -> 'ptc', false ->
 * 'native') with a one-time deprecation warning.
 *
 * TOOL PAGING: tools whose names match `pagedToolPatterns` (default
 * `['mcp__*']`) stay off the wire until their namespace is activated through
 * the `tool_activate` tool (registered by the sibling tool-activate plugin).
 * The active set replays from the durable session event stream on every
 * assembly, so resume, reload, and compaction rebuild it without any
 * process-memory state. At most a few namespaces stay active; the LRU
 * eviction falls out of the same replay.
 *
 * Paging is enforced in ONE place: a per-scope registry restriction
 * (agent.ctx.tools.restrict) that removes the paged names from every scoped
 * reader, the request's own wire included.
 *
 * The wire cannot be filtered by a listener any more. Since 0.2.2 the
 * `system-prompt/assemble` waterfall transforms a `PromptPresentation` that
 * carries no tool array at all: the harness collects the tool providers BEFORE
 * the waterfall runs and merges the authoritative `tools` back AFTER it, so a
 * listener can neither observe nor rewrite what the request carries. The
 * registry is the surface every tool declaration is projected from — the
 * native roster the executor renders and the set a program may dispatch to —
 * so one restriction pages both presentations, and the wire partition that
 * used to page the `native` roster is gone with the array it filtered.
 *
 * READING THE SURFACE: the catalog describes the request's own tool set, read
 * as `tools.schemas(agent, context.toolSet)` while assembling. The assemble
 * context's `toolSet` is the step's admitted selection — the fact a listener
 * cannot recover from the assembly value — and `schemas()` reads through the
 * scope's restriction, so the catalog lists exactly what the wire carries. An
 * unreadable projection is NOT an empty one: the catalog keeps its last
 * published state rather than announcing a session with no tools.
 *
 * TIMING: that restriction is installed from OUTSIDE the assembly waterfall.
 * `SystemPrompt.assemble()` collects the tool providers and calls every
 * section's `text(context)` BEFORE it runs the `system-prompt/assemble`
 * waterfall, so a restriction installed inside that waterfall could only take
 * effect one assembly later — leaving a request whose catalog claims a
 * namespace is paged while that request's own `tools:sdk` section still lists
 * it. `syncBeforeAssembly` therefore runs at scope creation, session start,
 * and after each tool call that can move the active set, so the FIRST `ptc`
 * request already renders a page-consistent SDK section.
 *
 * CATALOG: the durable user message appended after the user's own message
 * names exactly the tools the current request's wire carries (each tool's
 * argument signature plus a one-line summary), then summarizes the paged-out
 * namespaces with their activation pointer. The 'ptc' program contract ships
 * when the wire actually collapsed to the transport. A tool the catalog
 * curates renders the hand-written line from
 * {@link CURATED_TOOL_SUMMARIES}; only an uncurated tool falls back to the
 * mechanical `descriptionMaxLength` truncation of its own schema description,
 * because a character-count cut can slice off exactly the sentence that says
 * what the tool is for.
 * The catalog republishes only when its content changes or the published copy
 * left the visible surface (compaction, resume).
 *
 * RESIDENT BUDGET: `maxResidentTokens` estimates the always-on-wire surface
 * and warns once when it is crossed; the shipped ceiling is the
 * `DEFAULT_MAX_RESIDENT_TOKENS` constant below, and a deployment may raise or
 * lower it through the config. The guard is a diagnostic, never a truncation:
 * silently dropping a tool the session needs would trade a measurable context
 * cost for an unmeasurable capability loss.
 */

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  DEFAULT_PAGED_TOOL_PATTERNS,
  inactiveNamespaces,
  integerAtLeast,
  namespaceOf,
  replayActivations,
  summarizeInactive,
  validatePagedToolPatterns,
  withheldToolNames,
} from './paging.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-tool-catalog'

/** Prompt assembly must exist before the wire catalog can be observed. */
export const inject = ['systemPrompt']

/**
 * The paged namespaces each agent scope carries, published by the paging sync
 * below for the sibling `tool-activate` row.
 *
 * The activation tool cannot recompute this itself: the live restriction the
 * catalog installs is what removes the paged names from every scoped reader, so
 * `tools.schemas(agent)` inside the activation tool already lacks exactly the
 * names it must offer. Publishing the pre-restriction partition keeps one fact
 * behind both the catalog message and the tool that loads a namespace back.
 * Keyed by agent, and by the agent's session for a caller that reaches the same
 * session through another scope object; both are weak, so a departed scope
 * leaves nothing behind.
 */
const pagedSurfaceByAgent = new WeakMap()
const pagedSurfaceBySession = new WeakMap()

/**
 * Publish (or, with `undefined`, retract) one scope's paged namespaces.
 * @param agent - agent scope the partition belongs to.
 * @param surface - namespace-keyed namespaces, as `inactiveNamespaces` returns.
 */
function publishPagedSurface(agent, surface) {
  if (agent === undefined || agent === null) return
  const session = agent.session
  if (surface === undefined) {
    pagedSurfaceByAgent.delete(agent)
    if (session !== undefined && session !== null) pagedSurfaceBySession.delete(session)
    return
  }
  pagedSurfaceByAgent.set(agent, surface)
  if (session !== undefined && session !== null) pagedSurfaceBySession.set(session, surface)
}

/**
 * The paged namespaces one agent scope carries, keyed by namespace to that
 * namespace's tool schemas.
 * @param agent - agent scope the caller acts for.
 * @returns the published partition, or undefined when nothing paged this scope.
 */
export function pagedNamespacesFor(agent) {
  if (agent === undefined || agent === null) return undefined
  const byAgent = pagedSurfaceByAgent.get(agent)
  if (byAgent !== undefined) return byAgent
  const session = agent.session
  if (session === undefined || session === null) return undefined
  return pagedSurfaceBySession.get(session)
}

/** Default cap for one tool's one-line summary in the injected compact list. */
const DEFAULT_DESCRIPTION_MAX_LENGTH = 200

/** The presentation modes the SDK's ToolPresentationMode supports. */
export const PRESENTATION_MODES = ['native', 'ptc']

/**
 * The default presentation: the wire collapses to the single \`run_code\` transport
 * and every other tool is reached from inside the program through the generated
 * SDK.
 *
 * This is a deliberate trade, not a measured win. Collapsing the wire removes the
 * native roster's schema payload from every request, which is the cheapest static
 * context of the two modes; the official published scaffold comparison, however,
 * places this presentation BELOW the natively presented surface on both code-agent
 * benchmarks (DeepSWE v1.1: 67.6 against 72.6; Terminal-Bench 2.1: 85.8 against
 * 90.6). The default is chosen for its static-context cost on long sessions and is
 * NOT locally measured — the bundled benchmark matrix is how that would be settled.
 * A deployment with no mounted code runtime degrades to the native surface with a
 * one-time warning rather than presenting a transport the request cannot carry.
 */
export const DEFAULT_PRESENTATION = 'ptc'

/**
 * The default ceiling on the resident (always-on-wire) tool surface, in
 * estimated tokens. The model's long-range attention is a bounded sparse
 * budget, so a static schema surface that keeps growing silently evicts the
 * conversation's own constraints from it, and tool paging exists to keep that
 * surface small.
 *
 * The value is calibrated ABOVE this preset's own shipped roster rather than at
 * the theoretical core-set ideal: with gentle paging every non-\`mcp__*\` tool the
 * preset mounts stays resident, and that roster measures in the low thousands of
 * estimated tokens. A ceiling below the factory baseline would fire on every
 * ordinary session and train the reader to ignore it. It therefore flags real
 * growth — a deployment adding tool families of its own — instead of the shipped
 * configuration. The guard warns once per session and never truncates: silently
 * dropping a tool the session needs would trade a measurable context cost for an
 * unmeasurable capability loss. The budget was re-estimated for DeepSeek-V4.1:
 * its KV cache is a quarter of V4-Flash's (890 bytes/token), so the same schema
 * load occupies a quarter of the sparse-index slots and the threshold moved from
 * 6000 to 8000 — still calibrated above the shipped roster so only real growth
 * trips it.
 */
export const DEFAULT_MAX_RESIDENT_TOKENS = 8000

/**
 * Rough token estimate for one tool surface: the serialized schema is the
 * payload the request actually carries, and four characters per token is the
 * conventional English-and-JSON approximation. Deliberately coarse — this
 * drives a warning threshold, not a billing figure.
 * @param schemas - the tool schemas on the wire.
 * @returns estimated tokens, or 0 when nothing is measurable.
 */
export function estimateSurfaceTokens(schemas) {
  let characters = 0
  for (const schema of Array.isArray(schemas) ? schemas : []) {
    if (schema === null || schema === undefined) continue
    try {
      characters += JSON.stringify(schema)?.length ?? 0
    } catch {
      // A hostile or circular schema contributes nothing rather than throwing.
    }
  }
  return Math.ceil(characters / 4)
}

/**
 * Nesting depth beyond which an inline signature degrades to JsonValue. The
 * rendering stays one line per tool, so deeply nested argument objects are
 * summarized in the inline summary rather than expanded into an unreadable line.
 */
const MAX_SIGNATURE_DEPTH = 4

/** Types the compact signature renders exactly; everything else degrades. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

function optionalBoolean(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name}: ${field} must be a boolean`)
  }
  return value
}

/**
 * Resolve the presentation config: the explicit `presentation` enum wins (with
 * the pre-0.2.1 `'both'` default mapped to `'ptc'` with a one-time deprecation
 * warning so older profiles keep booting); the legacy boolean `ptcPresentation`
 * maps onto it (true -> 'ptc', false -> 'native') with a one-time deprecation
 * warning; neither means the default.
 */
function resolvePresentation(config, warn) {
  const explicit = config?.presentation
  if (explicit !== undefined) {
    if (explicit === 'both') {
      if (config?.ptcPresentation !== undefined) {
        optionalBoolean(config.ptcPresentation, 'ptcPresentation', true)
        warn('the ptcPresentation key is deprecated — presentation takes precedence over it')
      }
      warn("the 'both' presentation was removed in 0.2.1; mapping 'both' -> 'ptc'")
      return 'ptc'
    }
    if (!PRESENTATION_MODES.includes(explicit)) {
      throw new TypeError(`${name}: presentation must be one of ${JSON.stringify(PRESENTATION_MODES)}`)
    }
    if (config?.ptcPresentation !== undefined) {
      optionalBoolean(config.ptcPresentation, 'ptcPresentation', true)
      warn('the ptcPresentation key is deprecated — presentation takes precedence over it')
    }
    return explicit
  }
  if (config?.ptcPresentation !== undefined) {
    const legacy = optionalBoolean(config.ptcPresentation, 'ptcPresentation', true)
    warn(`the ptcPresentation key is deprecated; use presentation instead (mapping ${legacy ? "true -> 'ptc'" : "false -> 'native'"})`)
    return legacy ? 'ptc' : 'native'
  }
  return DEFAULT_PRESENTATION
}

/** Validate the retired anchorTools key's shape before ignoring it. */
function validateRetiredAnchorTools(value) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new TypeError(`${name}: anchorTools must be an array of tool names`)
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TypeError(`${name}: anchorTools entries must be non-empty tool names`)
    }
  }
}

/**
 * Curated one-line summaries, one per host builtin tool this preset can put on
 * a wire. Each line says what the tool is FOR and names the arguments that
 * decide how it is called, kept well inside {@link DEFAULT_DESCRIPTION_MAX_LENGTH}.
 *
 * PRECEDENCE: a tool named here renders THIS line; every other tool keeps the
 * mechanical cap — its own schema description, whitespace collapsed and cut to
 * `descriptionMaxLength`. Curation therefore wins over truncation and never
 * replaces it: a tool the table does not name (a paged MCP namespace's tool, a
 * plugin-registered tool, a tool the harness adds later) still reaches the
 * model, just at whatever the cap leaves of its own description. A character
 * count is a poor editor — it slices off the sentence that says what the tool
 * is for — so the tools this session mounts on every request get a hand-written
 * line instead.
 *
 * SCOPE: exactly the host builtins the preset's own `agent.cordis.yml` rows
 * mount for a session, which is the surface the paging wildcard leaves resident
 * (`pagedToolPatterns` defaults to `mcp__*`, so no host builtin is ever paged
 * out):
 * - the shell (one of bash / pwsh per platform), the filesystem and discovery
 *   tools, the background-job controls, and the editor;
 * - the prompt/skill surface, the todo list, the user question tool, and
 *   `web_search` (the preset's own `tool-web` row configures `fetch: false`,
 *   so the session opens the search tool alone);
 * - the preset's own `tool_activate` and `fact_register`;
 * - the READ-ONLY MCP resource tools, which the base composition mounts and
 *   which are reachable whenever the deployment registers an MCP server — even
 *   though a configured `mcp__*` server's tools are the ones paging withholds.
 *
 * Three names a reader might expect are deliberately ABSENT, because this
 * composition mounts no row that registers them and curating them would write a
 * catalog line for a tool surface the request never opens — exactly the claim
 * the declare-exactly-what-the-request-opens contract forbids:
 * - `present`: only the builtin Standard / PTC / Cordis compositions mount the
 *   `@deepseek-ai/dsh-tool-present` row, and the web app disables the host one;
 * - `web_fetch`: the per-session `tool-web` row below sets `fetch: false`,
 *   so this session opens `web_search` alone;
 * - `workflow`: the delegation group ships that row `disabled: true` so no
 *   second model-authored orchestration surface sits beside `run_code`.
 * The goal tools and `exit_plan_mode` ARE here, because the `tool-goal` and
 * `plan-mode` rows below mount them.
 *
 * `run_code` is also absent: it is the transport the harness adds for a code
 * presentation, not a row-mounted builtin, and the catalog never lists it as
 * an entry — under `ptc` the program contract describes it, under `native` the
 * request does not carry it.
 *
 * Adding a tool the preset mounts is the one edit an entry needs, and no test
 * pins the exact text of any line: an operator reword is not a behavior change.
 * That is why the table is exported — a test can prove every key is a tool name
 * and every value is a single bounded line, without freezing the prose.
 */

export const CURATED_TOOL_SUMMARIES = new Map([
  ['bash', 'Run a command in a fresh bash shell (`command`, optional `timeoutMs`, `workdir`, `run_in_background`).'],
  ['pwsh', 'Run a command in a fresh PowerShell process (`command`, optional `timeoutMs`, `workdir`, `run_in_background`); native Windows paths and `$env:NAME` variables.'],
  ['read', 'Read one UTF-8 text file as line-numbered content (`file_path`, optional `offset` and `limit`).'],
  ['read_image', 'Read a PNG/JPEG/WebP/GIF image file and return the image itself (`file_path`); large images are downscaled automatically.'],
  ['write', 'Create or fully replace one UTF-8 text file (`file_path`, `content`).'],
  ['edit', 'Replace literal text in one existing file (`file_path`, `old_string`, `new_string`, optional `replace_all`).'],
  ['str_replace_editor', 'View, create, and edit files through one command tool (`command`, `path`, plus `file_text`, `old_str` / `new_str`, `insert_line`, `view_range`).'],
  ['glob', 'Find files whose paths match a glob pattern (`pattern`, optional `path`); up to 100 paths in modification-time order.'],
  ['grep', 'Search file contents with a ripgrep expression (`pattern`, optional `path`, optional `include`); matching lines with line numbers.'],
  ['job_output', 'Read a background job: output since the previous read, or the finished result (`job_id`, optional `wait`, `timeout_ms`).'],
  ['job_list', 'List the background jobs started by this session with their ids, kinds, and statuses.'],
  ['job_kill', 'Request cancellation of a running background job (`job_id`, optional `reason`).'],
  ['todo_write', 'Record and update the plan as one todo per concrete step (`todos`: content and status); skip it for trivial single-step work.'],
  ['create_goal', 'Create a persisted goal that keeps this session working across automatic continuation rounds (`objective`, optional `max_goal_rounds`).'],
  ['get_goal', 'Read the current session goal, including the id and revision that update_goal requires.'],
  ['update_goal', 'Change one goal: edit, pause, resume, complete or blocked (`goal_id`, `revision`, `action`, plus `objective`, `max_goal_rounds`, `blocked_reason`).'],
  ['exit_plan_mode', 'Present the completed plan for user review (`plan`, markdown starting with a title); approval is the only way out of plan mode.'],
  ['subagent', 'Delegate a self-contained task to a subagent that works in its own context and returns its result, not its steps (`description`, `prompt`, optional `provider` / `model` / `reasoning_effort`).'],
  ['subagent_fork', 'Delegate a task to a subagent seeded with this conversation (`description`, `prompt`); it inherits the parent route, so route fields are not accepted.'],
  ['list_subagent_models', 'Discover the subagent routes this session authorizes (`provider`, optional `model`); the returned ids feed the delegation tools.'],
  ['send_message', 'Send a message to a subagent started from this session (`agent_id`, `message`); the call confirms delivery, not the answer.'],
  ['list_agents', 'List the subagents started from this session with their ids, labels, and status (`scope`).'],
  ['interrupt_agent', 'Ask a subagent to stop its current work (`agent_id`); the call returns without waiting for it to settle.'],
  ['ask_user_question', 'Ask the user a concise question and wait for the answer (`questions`: id, question, optional header, options, and custom input).'],
  ['web_search', 'Search the web for current information (one to four `queries`); returns a merged summary and its source URLs.'],
  ['skill', 'Load the full instructions of one session skill (`name`); call it before acting on a task that names or matches a skill.'],
  ['tool_activate', 'Load one paged tool namespace back onto the wire and into the generated SDK (`namespace`, exactly as the catalog names it).'],
  ['fact_register', 'Pin one key fact into the working context (`fact`, optional `tag`), or unpin with `revoke`; at most twelve short facts stay pinned.'],
  ['ralph', 'Run a foreground fresh-agent Ralph loop toward one immutable objective (`objective`, optional `maxRounds`); only when the human explicitly asks for it.'],
  ['list_mcp_resources', 'List the resources an MCP server exposes (`server`, optional `cursor`).'],
  ['list_mcp_resource_templates', 'List the parameterized resource URI templates of one MCP server (`server`, optional `cursor`).'],
  ['read_mcp_resource', 'Read one MCP resource by URI from the named server (`server`, `uri`).'],
])

/**
 * One-line model-facing summary of a tool description: whitespace collapsed,
 * truncated with an ellipsis when maxLength is specified.
 */
export function catalogDescription(value, maxLength) {
  const normalized = String(value ?? '').replaceAll(/\s+/g, ' ').trim()
  if (maxLength === undefined || maxLength <= 0 || normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}

/**
 * The one-line summary one entry renders for a tool: the curated line when the
 * table names it, otherwise the mechanically capped schema description. The
 * order is the whole point — curation first, truncation only as the fallback
 * for a tool nobody has written a line for yet.
 * @param {{ name?: unknown, description?: unknown }} schema - one tool definition.
 * @param {number} maxLength - the schema-description cap, in characters.
 * @returns the summary text for the catalog entry.
 */
export function toolSummary(schema, maxLength) {
  const name = schema?.name
  if (typeof name === 'string' && CURATED_TOOL_SUMMARIES.has(name)) {
    return CURATED_TOOL_SUMMARIES.get(name)
  }
  return catalogDescription(schema?.description, maxLength)
}

/** One scalar literal as TypeScript-ish text; non-JSON scalars degrade to the broad type. */
function renderLiteral(value) {
  const json = JSON.stringify(value)
  return json === undefined ? 'JsonValue' : json
}

/**
 * One JSON-Schema node as compact TypeScript-ish text for inline signatures.
 * Bounded by MAX_SIGNATURE_DEPTH so inline signatures remain single-line.
 */
export function renderJsonSchemaType(schema, depth = 0) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'JsonValue'
  const union = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  if (union !== undefined && union.length > 0) {
    const parts = union.map(node => renderJsonSchemaType(node, depth))
    return [...new Set(parts)].join(' | ')
  }
  if (Object.hasOwn(schema, 'const')) return renderLiteral(schema.const)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map(renderLiteral).join(' | ')
  if (Array.isArray(schema.type)) {
    const parts = schema.type.map(type => (typeof type === 'string' ? type : 'JsonValue'))
    return [...new Set(parts)].join(' | ')
  }
  if (SCALAR_TYPES.has(schema.type)) return schema.type === 'integer' ? 'number' : schema.type
  if (schema.type === 'array') {
    const items = schema.items === undefined ? 'JsonValue' : renderJsonSchemaType(schema.items, depth + 1)
    return items.includes('|') ? `(${items})[]` : `${items}[]`
  }
  if (schema.type === 'object' || schema.properties !== undefined) {
    if (depth >= MAX_SIGNATURE_DEPTH) return 'JsonValue'
    const properties = schema.properties !== undefined && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? Object.entries(schema.properties)
      : []
    if (properties.length === 0) return 'Record<string, JsonValue>'
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const fields = properties.map(([field, child]) => (
      `${field}${required.has(field) ? '' : '?'}: ${renderJsonSchemaType(child, depth + 1)}`
    ))
    return `{ ${fields.join(', ')} }`
  }
  return 'JsonValue'
}

/**
 * The parenthesized argument signature of one tool, e.g.
 * ({ command: string, timeoutMs?: number }). Empty when the parameter schema
 * carries nothing to say.
 */
export function renderSignature(parameters) {
  if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) return ''
  const type = renderJsonSchemaType(parameters)
  return type === 'JsonValue' ? '' : `(${type})`
}

/**
 * Catalog entries for one tool surface, sorted by name so an unchanged surface
 * renders byte-identical text across assemblies. Nameless definitions are
 * skipped; the `run_code` transport never renders as an entry — under `ptc`
 * the program contract describes it, under `native` the request does not
 * carry it. Each entry's summary is resolved by {@link toolSummary}: the
 * curated line where the table has one, the capped schema description
 * otherwise.
 */
export function catalogEntries(schemas, maxLength, options) {
  const patterns = Array.isArray(options?.patterns) ? options.patterns : []
  const entries = []
  for (const schema of Array.isArray(schemas) ? schemas : []) {
    const toolName = schema?.name
    if (typeof toolName !== 'string' || toolName === '') continue
    if (toolName === 'run_code') continue
    // A tool from a paged family carries its namespace so the catalog can group
    // it the way the model calls it, instead of scattering one server's tools
    // through an alphabetical list.
    const namespace = namespaceOf(toolName, patterns)
    entries.push({
      name: toolName,
      signature: renderSignature(schema.parameters),
      description: toolSummary(schema, maxLength),
      ...(namespace === undefined ? {} : { namespace }),
    })
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The program contract the injected message carries when the wire collapsed to
 * the PTC transport: `run_code` is then the only directly callable tool.
 */
const PTC_PROGRAM_LINES = [
  'The session presents these tools through `run_code`, which takes `code` — the body of an async TypeScript function (top-level `await` and `return` both work; only erasable syntax runs, no `enum` or namespaces) — and `description`, a short summary of the program. Compose one program per intent instead of one tool call per step:',
  '',
  '- reach a tool as `await tools.<name>({ ... })` — quoted access for exotic names, `tools["my-tool"]({ ... })`;',
  '- overlap independent read-only calls under `Promise.all` (safe calls run concurrently, mutating calls run alone in submission order) and sequence dependent work with `await`;',
  '- a failed call rejects with `ToolCallError`, whose `toolName` and human-readable message identify it — `try/catch` it to continue;',
  '- only what you `return` or `console.log` becomes program output; every other intermediate result stays out of the conversation, so extract just what the next decision needs, and an image a tool returns is attached after the run.',
  '',
  '`run_code` is the only tool that can be called directly once it is on the wire: every tool listed above is reached from inside the program.',
  '',
  'A namespace this session has not activated with `tool_activate({ namespace: "..." })` is not listed above and cannot be reached from inside a program either: the page is a page on the whole surface, not only on the wire, and the paged-out list below names exactly what is withheld. Activating one puts its tools back into this list and back into a program from the next request on.',
]

/**
 * Model-facing catalog text.
 * - Native presentation: the on-wire tool list plus the paged-out namespace
 *   summary with its wire-only reachability.
 * - 'ptc' (wire collapsed to `run_code`): the SDK-reachable list plus the full
 *   program contract naming `run_code` the one direct transport, and a
 *   namespace summary whose page covers the whole surface.
 */
export function renderCatalogText(entries, presentation = 'native', inactive = []) {
  // Activated paged families are listed under their namespace heading; every
  // other tool stays in the flat alphabetical list, so an unchanged surface
  // still renders byte-identical text.
  const resident = entries.filter(entry => entry.namespace === undefined)
  const byNamespace = new Map()
  for (const entry of entries) {
    if (entry.namespace === undefined) continue
    if (!byNamespace.has(entry.namespace)) byNamespace.set(entry.namespace, [])
    byNamespace.get(entry.namespace).push(entry)
  }
  const lineOf = entry => `- \`${entry.name}${entry.signature}\`: ${entry.description}`
  const available = entries.length === 0
    ? ['No tools are currently available in this session.']
    : [
        '<available_tools>',
        ...resident.map(lineOf),
        ...[...byNamespace.entries()].flatMap(([namespace, group]) => [
          `- namespace \`${namespace}\` (activated):`,
          ...group.map(entry => `  ${lineOf(entry)}`),
        ]),
        '</available_tools>',
      ]
  const footer = inactive.length === 0
    ? 'This is the complete current list and replaces any earlier available-tools list in this session.'
    : 'This is the current on-wire list and replaces any earlier available-tools list in this session.'
  // The paged-out summary states its own reachability per presentation, because
  // the presentations differ on exactly the fact a reader would otherwise have
  // to infer from the program contract further down: 'ptc' pages the whole
  // surface, and 'native' carries no program at all.
  const inactiveReachability = presentation === 'ptc'
    ? 'The page covers the whole surface here, not the wire alone: these namespaces are unreachable from inside a program too until they are activated.'
    : 'This presentation carries no program transport, so the wire is the only surface these namespaces can be reached through.'
  const inactiveBlock = inactive.length === 0 ? [] : [
    '',
    'These tool namespaces are registered but currently paged out of the wire:',
    inactiveReachability,
    '<inactive_namespaces>',
    ...inactive.map(ns => `- \`${ns.namespace}\` (${ns.count} tool${ns.count === 1 ? '' : 's'}${ns.sample === '' ? '' : `, e.g. \`${ns.sample}\``}): ${ns.description} Call \`tool_activate({ namespace: "${ns.namespace}" })\` to activate it.`),
    '</inactive_namespaces>',
  ]
  const presentationLines = presentation === 'ptc'
    ? ['', ...PTC_PROGRAM_LINES]
    : []
  return [
    '<system-reminder>',
    'The following tools are available in this session:',
    '',
    ...available,
    '',
    footer,
    ...inactiveBlock,
    ...presentationLines,
    '</system-reminder>',
  ].join('\n')
}

/** Build the durable catalog message for one entry list. */
export function createCatalogMessage(entries, presentation = 'native', inactive = []) {
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: renderCatalogText(entries, presentation, inactive) }],
    source: { kind: name },
  }
}

/** The text one message contributes, joined across its text blocks. */
function textOf(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Whether one message is this plugin's catalog. */
function isCatalogMessage(message) {
  const source = message?.source
  return source?.kind === name || (source?.kind === 'plugin' && source?.plugin === name)
}

/**
 * Session events, tolerating both snapshotEvents() and events array.
 */
function sessionEvents(session) {
  if (Array.isArray(session?.events)) return session.events
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  return []
}

/** Visible surface positions, or undefined when the session exposes none. */
function visibleSeqSet(session) {
  const nodes = session?.surface?.nodes
  return Array.isArray(nodes) ? new Set(nodes) : undefined
}

/**
 * Published catalog state read back from durable log.
 */
function catalogHistory(agent) {
  const session = agent?.session
  const events = sessionEvents(session)
  const visible = visibleSeqSet(session)
  let published = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message' || !isCatalogMessage(event.data)) continue
    published = true
    if (visible === undefined || typeof event.seq !== 'number' || visible.has(event.seq)) {
      return { published, text: textOf(event.data) }
    }
  }
  return { published }
}

/** This plugin's catalog message inside one step's admitted batch, if any. */
function catalogMessage(messages) {
  for (const message of messages) {
    if (isCatalogMessage(message)) return { message, text: textOf(message) }
  }
  return undefined
}

/** Drop one message from a step's admitted batch. */
function withoutMessage(decision, id) {
  return { ...decision, messages: decision.messages.filter(message => message.id !== id) }
}

/** Register the registry paging and the per-step catalog injection. */
export function apply(ctx, config) {
  const descriptionMaxLength = integerAtLeast(
    name,
    config?.descriptionMaxLength,
    'descriptionMaxLength',
    1,
    DEFAULT_DESCRIPTION_MAX_LENGTH,
  )
  const pagedToolPatterns = validatePagedToolPatterns(name, config?.pagedToolPatterns)
  const maxActiveNamespaces = integerAtLeast(
    name,
    config?.maxActiveNamespaces,
    'maxActiveNamespaces',
    1,
    DEFAULT_MAX_ACTIVE_NAMESPACES,
  )
  const maxResidentTokens = integerAtLeast(
    name,
    config?.maxResidentTokens,
    'maxResidentTokens',
    1,
    DEFAULT_MAX_RESIDENT_TOKENS,
  )

  // One-time warnings, per concern so each retired/legacy key reports itself.
  const warned = new Set()
  const warnOnce = (key, detail) => {
    if (warned.has(key)) return
    warned.add(key)
    try {
      ctx.logger?.warn?.(`${name}: ${detail}`)
    } catch {
      // Logger unavailable
    }
  }

  validateRetiredAnchorTools(config?.anchorTools)
  if (config?.anchorTools !== undefined) {
    warnOnce('anchor', 'anchor-turn staging is retired — the anchorTools key is accepted but no longer narrows the wire')
  }
  const presentation = resolvePresentation(config, detail => warnOnce(`presentation:${detail}`, detail))

  // Per-agent fresh state evaluated on every assembly (never stale across steps/turns)
  const agentCatalogState = new WeakMap()

  // Session to agent mapping for lifecycle events
  const agentBySession = new WeakMap()

  // Registry-level paging state, one entry per agent scope: the names the live
  // restriction withholds and the exact disposer that lifts it. Keyed by agent
  // so two sessions assembling at once cannot lift each other's filter, and
  // released with the agent so a departed scope leaves no filter behind.
  const agentPaging = new WeakMap()

  /** Lift one agent scope's live restriction, if it has one. */
  const clearScopePaging = (agent) => {
    const state = agentPaging.get(agent)
    if (state === undefined) return
    agentPaging.delete(agent)
    try {
      state.dispose()
    } catch (err) {
      warnOnce('paging-dispose', `lifting an earlier tool restriction failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Recompute one agent scope's page from the durable session event stream and
   * make the registry match it: `deny` masks exactly the names the paged
   * namespaces carry, so the scope still inherits everything else.
   * Scoped registrations are exempt by the registry's own rule, so
   * preset-owned tools can never be filtered away by this.
   *
   * The restriction is what paging MEANS in both presentations now that the
   * waterfall carries no tool array: the registry is the surface every tool
   * declaration is projected from, so the native roster and the program
   * bindings lose the paged names together. It also stores the namespaces it
   * withheld, so the catalog and the live restriction are read from ONE fact
   * instead of two computations.
   *
   * Called OUTSIDE the assembly waterfall, deliberately: see
   * {@link syncBeforeAssembly} for why an in-waterfall sync cannot fix the
   * request it runs in. Returns the stored state, or undefined when the scope
   * needs none — nothing paged, an unusable scoped view, or a refused filter.
   */
  const syncScopePaging = (agent) => {
    clearScopePaging(agent)
    // Retract the earlier publication first: every early return below means this
    // scope is not paged, and a stale page would keep advertising namespaces the
    // activation tool can no longer reach.
    publishPagedSurface(agent, undefined)

    const tools = agent?.ctx?.tools
    if (tools === undefined || typeof tools.restrict !== 'function') {
      warnOnce('paging-runtime', 'no scoped tools view to page through — the paged namespaces stay reachable through a program in this session')
      return undefined
    }

    // Read with the restriction lifted (clearScopePaging above), or the
    // withheld names would already be missing and the next sync would find
    // nothing left to withhold. Silent on an unreadable surface: a sync may
    // run before the registry is populated, and "no tools yet" is not the
    // assembly-path emergency that warning describes.
    const fullSurface = readSurface(agent, undefined, { quiet: true }) ?? []
    if (fullSurface.length === 0) return undefined
    // Publish before the withhold decision: with every namespace already active
    // there is nothing to restrict, and the activation tool must still know the
    // namespace exists to report it as active instead of unknown.
    publishPagedSurface(agent, inactiveNamespaces(fullSurface, pagedToolPatterns, []))
    const active = replayActivations(sessionEvents(agent?.session), maxActiveNamespaces, pagedToolPatterns).active
    const withheld = withheldToolNames(fullSurface, pagedToolPatterns, active)
    if (withheld.length === 0) return undefined

    try {
      const dispose = tools.restrict({ deny: withheld })
      if (typeof dispose !== 'function') {
        warnOnce('paging-runtime', 'the tool registry did not confirm the paging restriction — the paged namespaces stay reachable through a program in this session')
        return undefined
      }
      const state = { active, inactive: inactiveNamespaces(fullSurface, pagedToolPatterns, active), dispose }
      agentPaging.set(agent, state)
      return state
    } catch (err) {
      // A registry that refuses the filter (a name that vanished mid-assembly,
      // a scope that is not scoped after all) must not cost the session its
      // tools: the refused restriction simply does not apply.
      warnOnce('paging-runtime', `paging could not restrict this scope's tools: ${err instanceof Error ? err.message : String(err)} — the paged namespaces stay reachable through a program in this session`)
      return undefined
    }
  }

  /**
   * Bring a scope's page up to date from OUTSIDE the assembly waterfall.
   *
   * `SystemPrompt.assemble()` collects the tool providers AND calls every
   * section's `text(context)` before it runs the `system-prompt/assemble`
   * waterfall, so a restriction installed inside that waterfall cannot change
   * the request it runs for: the `tools:sdk` section has already been rendered
   * from the unrestricted registry. It would take effect one assembly later,
   * leaving a request whose catalog claims a namespace is paged while that
   * request's own SDK section still lists it. Syncing before the providers are
   * collected is what keeps the two consistent from the FIRST `ptc` request.
   *
   * EVERY SCOPE IS PAGED, in both presentations. Before 0.2.2 the native
   * roster was filtered in the waterfall itself — the listener returned a
   * narrowed `tools` array — so a registry restriction there would have been
   * redundant, and a deployment whose wire never collapsed (no code runtime, a
   * declined declaration) had to keep it off entirely. The harness now merges
   * its own provider-owned `tools` back after the waterfall, so that return
   * value is discarded: the registry is the only place a page can exist, and a
   * scope left unpaged would hand the model every paged family it was supposed
   * to activate first.
   */
  const syncBeforeAssembly = (agent) => {
    if (agent === undefined) return undefined
    return syncScopePaging(agent)
  }


  const registry = () => ctx.get('tools')
  // The 0.1.6 cohort renamed the service face from `codeRuntime` to
  // `ptcRuntime` (package `@deepseek-ai/dsh-code-runtime` became
  // `@deepseek-ai/dsh-ptc-runtime`); the old key is gone, so reading it would
  // silently disable program presentation for every session.
  //
  // This is the ONE fact that decides what the request carries, because no
  // reader can observe the collapse itself: the petc executor keeps `run_code`
  // outside the registry (`describe()` returns it, `tools.schemas()` never
  // does), so a `schemas()` read returns the same roster under both
  // presentations. The composition enables the `tool-executor-ptc` row from
  // exactly this setting (see `src/composition.ts`), so the configured
  // presentation plus a mounted runtime IS the wire.
  const collapsedTransport = () => presentation !== 'native' && ctx.get('ptcRuntime') !== undefined

  /**
   * Read visible tool schemas from the public tools.schemas(agent) API.
   * Excludes run_code. Tolerates test stubs providing sdkSchemas.
   */
  const resolveToolsService = (agent) => {
    const scoped = agent?.ctx?.tools
    if (typeof scoped?.schemas === 'function' || typeof scoped?.sdkSchemas === 'function') {
      return scoped
    }
    const reg = registry()
    if (typeof reg?.schemas === 'function' || typeof reg?.sdkSchemas === 'function') {
      return reg
    }
    return scoped ?? reg
  }

  /**
   * Read the model-facing surface one scope offers this step, without the
   * reserved transport (the catalog never lists run_code as an entry).
   *
   * `toolSet` is the assemble context's step admission: passing it narrows the
   * read to exactly the tools this request may carry, conditionally registered
   * ones excluded. Omitted, the read covers every registered definition, which
   * is what the paging sync needs to compute its page.
   *
   * An EMPTY list and an UNREADABLE registry are different facts, and the
   * return type keeps them apart: `[]` means this scope really offers no tool,
   * `undefined` means nothing could be read (a deployment without the registry,
   * a projection that threw). A caller that treats the second as the first
   * announces "no tools" to a session that has them — the defect issue #2016
   * reports.
   *
   * @param agent - agent scope the surface is read for.
   * @param toolSet - the step's admitted selection, or undefined for every definition.
   * @param options - `quiet` suppresses the diagnostic of an unreadable registry.
   * @returns the visible schemas minus run_code, or undefined when unreadable.
   */
  const readSurface = (agent, toolSet, options) => {
    const tools = resolveToolsService(agent)
    if (tools === undefined) return undefined
    for (const method of ['schemas', 'sdkSchemas']) {
      if (typeof tools[method] !== 'function') continue
      try {
        const schemas = tools[method](agent, toolSet)
        if (Array.isArray(schemas)) return schemas.filter(entry => entry?.name && entry.name !== 'run_code')
      } catch (err) {
        if (options?.quiet !== true) {
          // Its own key, so an unreadable projection never swallows the
          // declaration warning that explains what replaced it.
          warnOnce('surface', `no tool schemas available (${err instanceof Error ? err.message : String(err)}) — the catalog keeps its last published state`)
        }
        return undefined
      }
    }
    return undefined
  }

  // Early lifecycle hook: page the scope as soon as it exists.
  //
  // The 0.1.6 cohort folded the former `agent/session-start` into the async
  // serial `agent/created`, which carries the same payload object and runs
  // before the first prompt assembly; the host waits for this listener, so the
  // page is already in place when that assembly collects its tool providers.
  //
  // The payload is destructured ON PURPOSE: `agent/created` passes its payload
  // OBJECT as the first argument, not the agent itself. Reading that parameter
  // as the agent yields an object with no `session` and no `ctx`, so paging
  // would silently never engage.
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session !== undefined) agentBySession.set(agent.session, agent)
    // The session log is readable here, and this runs before the first turn
    // assembles a prompt, so a scope created over an existing (resumed)
    // session is paged before its FIRST assembly rather than one request late.
    syncBeforeAssembly(agent)
  })

  // A departed scope must not keep a registry restriction behind: the layer is
  // keyed by the agent, and a recycled key would inherit a stale filter.
  ctx.on('agent/disposed', ({ agent }) => {
    agentCatalogState.delete(agent)
    clearScopePaging(agent)
  })

  /**
   * Re-sync after a call that can move the active set.
   *
   * Every window between assemblies is the right one to fix the NEXT one, and
   * this fires at the end of each tool call: a `tool_activate` and the calls
   * that refresh a namespace's recency are exactly the events the paging
   * replay reads, so the restriction and the catalog are back in step long
   * before the next prompt is assembled. Declared concurrency-safe so it never
   * serializes independent read-only calls.
   */
  ctx.on('tools/post-execute', (exec, _result, next) => {
    syncBeforeAssembly(exec?.agent)
    return next()
  }, { prepend: true })

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context?.agent
    // The step's admitted selection, and the one fact about this request's tool
    // set a listener can still read: since 0.2.2 the assembly value carries no
    // tool array, and the providers it is built from are collected before this
    // waterfall runs.
    const toolSet = context?.toolSet

    if (agent !== undefined && agent.session !== undefined) {
      agentBySession.set(agent.session, agent)
    }

    // Page the scope before the providers are collected; a scope the lifecycle
    // hooks already paged re-derives the same state, so this is idempotent.
    syncBeforeAssembly(agent)

    // The waterfall's transformed value travels on untouched: tool declarations
    // are provider-owned, so there is no array here to filter or restore.
    const assembled = await next()

    // The catalog describes THIS request's surface, read from the registry
    // through the step's admission. `schemas()` reads through the scope's
    // restriction, so the result is exactly the list this request carries: the
    // native roster, or - under a collapsed `ptc` wire - the projection every
    // tool is reached through from inside a program (run_code is the transport,
    // never a catalog entry).
    const surface = agent === undefined ? undefined : readSurface(agent, toolSet)

    // The presentation this request carries is the one the composition mounted.
    // Nothing in the assembly names it and `schemas()` reads the same roster
    // under both, so the configured mode plus a mounted runtime is the answer -
    // and a mode whose runtime is missing keeps the native wording, because
    // that is the wire an executor-less deployment renders.
    const effectivePresentation = collapsedTransport() ? 'ptc' : 'native'

    // An unreadable projection is NOT an empty one. Keep the catalog this scope
    // last published instead of rewriting it: recording "this session has no
    // tools" over a read that merely failed is what made the model refuse tools
    // the request was carrying (issue #2016). The one fact that still has to
    // follow the request is the transport, so the wording is corrected above.
    if (agent === undefined) return assembled
    if (surface === undefined) {
      const previous = agentCatalogState.get(agent)
      if (previous !== undefined && previous.presentation !== effectivePresentation) {
        agentCatalogState.set(agent, { ...previous, presentation: effectivePresentation })
      }
      return assembled
    }

    // Diagnostic guard on the always-on-wire surface. It warns rather than
    // truncates: silently dropping a tool the session needs would trade a
    // measurable context cost for an unmeasurable capability loss.
    const residentTokens = estimateSurfaceTokens(surface)
    if (residentTokens > maxResidentTokens) {
      // Name the heaviest tools so the remedy is actionable rather than a bare number.
      const heaviest = [...surface]
        .map(tool => ({ name: typeof tool?.name === 'string' ? tool.name : '(unnamed)', tokens: estimateSurfaceTokens([tool]) }))
        .sort((left, right) => right.tokens - left.tokens)
        .slice(0, 3)
        .map(entry => `${entry.name} (${entry.tokens})`)
        .join(', ')
      warnOnce('resident-budget', `the resident tool surface is about ${residentTokens} tokens across ${surface.length} tools, over the ${maxResidentTokens}-token budget; heaviest: ${heaviest} — add matching families to pagedToolPatterns so they are held off the wire until activated`)
    }

    // The page the registry enforces IS this request's page: the restriction was
    // installed before the providers were collected (see {@link syncBeforeAssembly}),
    // and the surface above already reads through it. A scope whose page could
    // not be installed withholds nothing, so it advertises nothing.
    const pagingState = agentPaging.get(agent)
    const inactiveSummary = summarizeInactive(
      pagingState?.inactive ?? [],
      describe => catalogDescription(describe, descriptionMaxLength),
    )

    agentCatalogState.set(agent, {
      entries: catalogEntries(surface, descriptionMaxLength, { patterns: pagedToolPatterns }),
      presentation: effectivePresentation,
      inactive: inactiveSummary,
    })
    return assembled
  }, { prepend: true })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload?.agent
    const state = agent === undefined ? undefined : agentCatalogState.get(agent)
    if (state === undefined) return decision

    const { entries, presentation: statePresentation, inactive } = state
    const candidate = renderCatalogText(entries, statePresentation, inactive)
    const history = catalogHistory(agent)
    const existing = catalogMessage(decision.messages)
    if (history.text === candidate) {
      return existing === undefined ? decision : withoutMessage(decision, existing.message.id)
    }
    if (existing !== undefined && existing.text === candidate) return decision
    if (!history.published && entries.length === 0 && inactive.length === 0) {
      return existing === undefined ? decision : withoutMessage(decision, existing.message.id)
    }
    const catalog = createCatalogMessage(entries, statePresentation, inactive)
    if (existing === undefined) {
      return { ...decision, messages: [...decision.messages, catalog] }
    }
    return {
      ...decision,
      messages: decision.messages.map(message => (message.id === existing.message.id ? catalog : message)),
    }
  }, { prepend: true })
}
