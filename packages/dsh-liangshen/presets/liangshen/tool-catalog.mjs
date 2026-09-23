/**
 * tool-catalog — the model-visible tool surface for LiangShen mode: one
 * presentation declaration per session, gentle tool paging for high-fan-out
 * namespaces, and the durable catalog message.
 *
 * PRESENTATION: the `presentation` config picks how this session's tools sit
 * on the wire, matching the SDK's ToolPresentationMode:
 * - `native`: the assembled native roster, no code transport;
 * - `ptc`: the wire collapses to the single `run_code` transport and every
 *   other tool is reached from inside the program through the generated SDK;
 * - `both` (default): the full native roster plus the `run_code` transport
 *   co-resident on the wire — native calls carry ordinary work, `run_code`
 *   covers programmatic batch computation and overlapped fan-out.
 *
 * The declaration happens once per agent scope (agent.ctx.tools.presentAs) as
 * early as the scope exists — there is no turn-boundary staging: the retired
 * anchor-turn mechanism is gone, and the legacy `anchorTools` key is accepted
 * but ignored with a one-time warning. The legacy boolean `ptcPresentation`
 * maps onto the enum (true -> 'ptc', false -> 'native') with a one-time
 * deprecation warning. A missing code runtime or a declined declaration keeps
 * the native surface with a one-time warning.
 *
 * TOOL PAGING: tools whose names match `pagedToolPatterns` (default
 * `['mcp__*']`) stay off the wire until their namespace is activated through
 * the `tool_activate` tool (registered by the sibling tool-activate plugin).
 * The active set replays from the durable session event stream on every
 * assembly, so resume, reload, and compaction rebuild it without any
 * process-memory state. At most a few namespaces stay active; the LRU
 * eviction falls out of the same replay.
 *
 * Paging is enforced in TWO places, because the wire is not the only surface a
 * tool can be reached through:
 * - the wire partition below (resident tools returned, paged tools lifted) and
 * - a per-scope registry restriction (agent.ctx.tools.restrict) that removes
 *   the paged names exactly as the wire does.
 * The second one is what makes paging real under the `ptc` presentation,
 * where the wire has already collapsed to the single `run_code` transport and
 * every other tool is reached from inside a program. Under a collapsed wire
 * the visible set is the whole surface: it renders the `tools:sdk` prompt
 * section and it is what a program may dispatch to, so filtering the assembled
 * `tools` array alone would withhold nothing the model can observe. The
 * restriction is derived from the same pattern match as the partition
 * (`withheldToolNames`) and is lifted before a new one is applied, so repeated
 * collections do not accumulate filters.
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
 * namespaces with their activation pointer. Under 'both' the catalog lists
 * `run_code` like any other tool and notes the programmatic-escape hatch; the
 * 'ptc' program contract only ships when the wire actually collapsed to it.
 * The catalog republishes only when its content changes or the published copy
 * left the visible surface (compaction, resume).
 *
 * RESIDENT BUDGET: `maxResidentTokens` (default 1500) estimates the
 * always-on-wire surface and warns once when it is crossed. The guard is a
 * diagnostic, never a truncation: silently dropping a tool the session needs
 * would trade a measurable context cost for an unmeasurable capability loss.
 */

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  DEFAULT_PAGED_TOOL_PATTERNS,
  inactiveNamespaces,
  integerAtLeast,
  namespaceOf,
  partitionWireTools,
  replayActivations,
  summarizeInactive,
  validatePagedToolPatterns,
  withheldToolNames,
} from './paging.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-tool-catalog'

/** Prompt assembly must exist before the wire catalog can be observed. */
export const inject = ['systemPrompt']

/** Default cap for one tool's one-line summary in the injected compact list. */
const DEFAULT_DESCRIPTION_MAX_LENGTH = 200

/** The presentation modes the SDK's ToolPresentationMode supports. */
export const PRESENTATION_MODES = ['native', 'ptc', 'both']

/**
 * The default presentation: the wire collapses to the single \`run_code\` transport
 * and every other tool is reached from inside the program through the generated
 * SDK.
 *
 * This is a deliberate trade, not a measured win. Collapsing the wire removes the
 * native roster's schema payload from every request, which is the cheapest static
 * context of the three modes; the official published scaffold comparison, however,
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
 * Resolve the presentation config: the explicit `presentation` enum wins; the
 * legacy boolean `ptcPresentation` maps onto it (true -> 'ptc', false ->
 * 'native') with a one-time deprecation warning; neither means the default.
 */
function resolvePresentation(config, warn) {
  const explicit = config?.presentation
  if (explicit !== undefined) {
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
 * One-line model-facing summary of a tool description: whitespace collapsed,
 * truncated with an ellipsis when maxLength is specified.
 */
export function catalogDescription(value, maxLength) {
  const normalized = String(value ?? '').replaceAll(/\s+/g, ' ').trim()
  if (maxLength === undefined || maxLength <= 0 || normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
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
 * skipped; the `run_code` transport is listed only when the presentation puts
 * it on the wire beside the native tools ('both').
 */
export function catalogEntries(schemas, maxLength, options) {
  const includeRunCode = options?.includeRunCode === true
  const patterns = Array.isArray(options?.patterns) ? options.patterns : []
  const entries = []
  for (const schema of Array.isArray(schemas) ? schemas : []) {
    const toolName = schema?.name
    if (typeof toolName !== 'string' || toolName === '') continue
    if (toolName === 'run_code' && !includeRunCode) continue
    // A tool from a paged family carries its namespace so the catalog can group
    // it the way the model calls it, instead of scattering one server's tools
    // through an alphabetical list.
    const namespace = namespaceOf(toolName, patterns)
    entries.push({
      name: toolName,
      signature: renderSignature(schema.parameters),
      description: catalogDescription(schema.description, maxLength),
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
 * The short note the catalog carries when `run_code` sits on the wire beside
 * the native roster ('both'): native calls are the primary surface, and the
 * transport covers programmatic batch work. Paged-out namespaces stay reachable
 * through the SDK inside a program even before activation.
 */
const BOTH_PROGRAM_LINES = [
  'Prefer calling the tools above directly by name: ordinary single-step work (read, edit, bash, one search) goes through the native call, never through `run_code`. Reserve `run_code` for what a direct call cannot do — an async TypeScript body (`code`, with a short `description`) that reaches tools as `await tools.<name>({ ... })`, overlaps independent read-only calls under `Promise.all`, and catches `ToolCallError` to continue: programmatic batch computation, wide fan-out, or multi-step data shaping. Routing everyday calls through a program adds a wrapping layer with no payoff.',
  'Paged-out namespaces below stay off the NATIVE wire but stay reachable through the SDK inside a program even before activation; activating one also puts its tools back on the direct surface.',
]

/**
 * Model-facing catalog text.
 * - Native presentation: the on-wire tool list plus the paged-out namespace summary.
 * - 'both': the on-wire list INCLUDING `run_code`, the namespace summary, and
 *   the short programmatic-escape note.
 * - 'ptc' (wire collapsed to `run_code`): the SDK-reachable list plus the full
 *   program contract naming `run_code` the one direct transport.
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
  const inactiveBlock = inactive.length === 0 ? [] : [
    '',
    'These tool namespaces are registered but currently paged out of the wire:',
    '<inactive_namespaces>',
    ...inactive.map(ns => `- \`${ns.namespace}\` (${ns.count} tool${ns.count === 1 ? '' : 's'}${ns.sample === '' ? '' : `, e.g. \`${ns.sample}\``}): ${ns.description} Call \`tool_activate({ namespace: "${ns.namespace}" })\` to load them onto the wire.`),
    '</inactive_namespaces>',
  ]
  const presentationLines = presentation === 'ptc'
    ? ['', ...PTC_PROGRAM_LINES]
    : presentation === 'both'
      ? ['', ...BOTH_PROGRAM_LINES]
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

/**
 * Overlay the registry projection onto each wire entry, keyed by name, so the
 * catalog describes complete argument semantics even when the assembly's own
 * tool object carries a thinner definition.
 *
 * A tool the projection NAMES is authoritative for the parameter field,
 * including its absence: a projected entry that declares no parameters means
 * the tool takes no declared arguments, and the wire's placeholder object
 * (`{ type: 'object', properties: {} }`) would otherwise render the misleading
 * `Record<string, JsonValue>` signature. A tool the projection does not name
 * keeps the wire's own definition, and so does every entry when no projection
 * is readable at all.
 */
export function mergeProjectedSchemas(wireTools, projection) {
  if (!Array.isArray(projection) || projection.length === 0) return wireTools
  const byName = new Map()
  for (const schema of projection) {
    if (typeof schema?.name === 'string' && schema.name !== '') byName.set(schema.name, schema)
  }
  return wireTools.map((tool) => {
    const projected = byName.get(tool?.name)
    if (projected === undefined) return tool
    const merged = { ...tool }
    if (projected.parameters === undefined) delete merged.parameters
    else merged.parameters = projected.parameters
    if (typeof projected.description === 'string' && projected.description.length > 0) {
      merged.description = projected.description
    }
    return merged
  })
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

/** Register the presentation declaration, the wire paging, and the per-step catalog injection. */
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
  const presentation = resolvePresentation(config, detail => warnOnce('ptcPresentation', detail))

  // Per-agent fresh state evaluated on every assembly (never stale across steps/turns)
  const agentCatalogState = new WeakMap()

  // Session to agent mapping for lifecycle events
  const agentBySession = new WeakMap()

  // Presentation declaration tracking per agent scope (one declaration each)
  const agentDeclared = new WeakSet()
  const agentDeclareFailed = new WeakSet()
  const agentDisposers = new WeakMap()

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
   * make the registry match it: `deny` masks exactly the names the wire
   * partition would withhold, so the scope still inherits everything else.
   * Scoped registrations are exempt by the registry's own rule, so
   * preset-owned tools can never be filtered away by this.
   *
   * The restriction is what paging MEANS under a collapsed `ptc` wire, where
   * filtering the assembled `tools` array changes nothing a program can reach.
   * It also stores the namespaces it withheld, so the catalog and the live
   * restriction are read from ONE fact instead of two computations.
   *
   * Called OUTSIDE the assembly waterfall, deliberately: see
   * {@link syncBeforeAssembly} for why an in-waterfall sync cannot fix the
   * request it runs in. Returns the stored state, or undefined when the scope
   * needs none — nothing paged, an unusable scoped view, or a refused filter.
   */
  const syncScopePaging = (agent) => {
    clearScopePaging(agent)

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
    const fullSurface = quietSchemas(agent) ?? []
    if (fullSurface.length === 0) return undefined
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
   * GATED ON THE WIRE ACTUALLY COLLAPSING, not on the configuration asking for
   * it. Both halves of that gate matter, and each covers a deployment where
   * paging at the registry would be wrong:
   * - `presentation === 'ptc'` is what the operator configured, and it excludes
   *   `both`, whose documented contract is that a paged-out namespace stays
   *   reachable through the SDK inside a program before activation. Installing
   *   the restriction there would break that contract for the first request;
   * - `agentDeclared.has(agent)` is the scope's own declaration actually
   *   landing, which is NOT the same as `transportReady()`. A deployment with
   *   no mounted code runtime (and one whose host declines the declaration)
   *   keeps the native wire: the assembled array carries paging by itself, and
   *   a registry restriction installed anyway would strip the paged families
   *   from that request's native wire — the first request would lose tools it
   *   is supposed to have, and the catalog would announce namespaces as
   *   withheld that nothing withheld.
   */
  const syncBeforeAssembly = (agent) => {
    if (agent === undefined || presentation !== 'ptc') return undefined
    if (!agentDeclared.has(agent)) return undefined
    return syncScopePaging(agent)
  }


  const registry = () => ctx.get('tools')
  // The 0.1.6 cohort renamed the service face from `codeRuntime` to
  // `ptcRuntime` (package `@deepseek-ai/dsh-code-runtime` became
  // `@deepseek-ai/dsh-ptc-runtime`); the old key is gone, so reading it would
  // silently disable PTC staging for every session.
  const transportReady = () => presentation !== 'native' && ctx.get('ptcRuntime') !== undefined

  /**
   * Declare this agent scope's presentation through the public
   * agent.ctx.tools.presentAs(mode). One declaration per scope; a refusal is
   * permanent for the agent, a wire miss is retryable.
   */
  const declarePresentation = (agent) => {
    if (!transportReady() || agent === undefined) return false
    if (agentDeclared.has(agent)) return true
    if (agentDeclareFailed.has(agent)) return false

    const tools = agent?.ctx?.tools
    if (tools === undefined || typeof tools.presentAs !== 'function') {
      agentDeclareFailed.add(agent)
      warnOnce('runtime', 'no scoped tools view to declare the presentation through — keeping the native tool surface')
      return false
    }

    try {
      const disposer = tools.presentAs(presentation)
      agentDeclared.add(agent)
      if (typeof disposer === 'function') {
        agentDisposers.set(agent, disposer)
      }
      return true
    } catch (err) {
      agentDeclareFailed.add(agent)
      warnOnce('runtime', `the "${presentation}" presentation was declined: ${err instanceof Error ? err.message : String(err)} — keeping the native tool surface`)
      return false
    }
  }

  /**
   * Abort/revert the declaration if active, restoring the native presentation.
   */
  const revertPresentation = (agent, reason, retryable = false) => {
    if (agent === undefined) return
    const disposer = agentDisposers.get(agent)
    if (typeof disposer === 'function') {
      try {
        disposer()
      } catch {
        // Ignore disposer error
      }
      agentDisposers.delete(agent)
    }
    agentDeclared.delete(agent)
    // A declaration the host itself refused is permanent for this agent. One that
    // merely failed to reach a wire is not: the next assembly may declare again,
    // and latching it would strand the session on the native surface.
    if (!retryable) agentDeclareFailed.add(agent)
    warnOnce('runtime', `${reason} — keeping the native tool surface`)
  }

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
   * Read the scope's model-facing surface without the assembly path's warning.
   * Returns undefined when no projection is readable at all.
   */
  const quietSchemas = (agent) => {
    const tools = resolveToolsService(agent)
    if (tools === undefined) return undefined
    for (const method of ['schemas', 'sdkSchemas']) {
      if (typeof tools[method] !== 'function') continue
      try {
        const schemas = tools[method](agent)
        if (Array.isArray(schemas)) return schemas.filter(entry => entry?.name && entry.name !== 'run_code')
      } catch {
        // Try the next source; an unreadable registry is not fatal here.
      }
    }
    return undefined
  }

  const publicSchemas = (agent) => {
    const tools = resolveToolsService(agent)
    if (tools === undefined) return undefined
    if (typeof tools.schemas === 'function') {
      try {
        const schemas = tools.schemas(agent)
        if (Array.isArray(schemas) && schemas.length > 0) {
          const filtered = schemas.filter(t => t?.name && t.name !== 'run_code')
          return filtered.length > 0 ? filtered : undefined
        }
        return undefined
      } catch {
        warnOnce('runtime', 'no tool schemas available — keeping the native tool surface')
        return undefined
      }
    }
    // Test harness compatibility stub
    if (typeof tools.sdkSchemas === 'function') {
      try {
        const schemas = tools.sdkSchemas(agent)
        if (Array.isArray(schemas) && schemas.length > 0) {
          const filtered = schemas.filter(t => t?.name && t.name !== 'run_code')
          return filtered.length > 0 ? filtered : undefined
        }
      } catch {
        warnOnce('runtime', 'no tool schemas available — keeping the native tool surface')
        return undefined
      }
    }
    return undefined
  }

  // Early lifecycle hook: declare the presentation and page the scope as soon
  // as it exists.
  //
  // The 0.1.6 cohort folded the former `agent/session-start` into the async
  // serial `agent/created`, which carries the same payload object and runs
  // before the first prompt assembly; the host waits for this listener, so the
  // declaration is already in place when that assembly reads the presentation.
  //
  // The payload is destructured ON PURPOSE: `agent/created` passes its payload
  // OBJECT as the first argument, not the agent itself. Reading that parameter
  // as the agent yields an object with no `session` and no `ctx`, so the
  // declaration is skipped and paging silently never engages.
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session !== undefined) agentBySession.set(agent.session, agent)
    if (transportReady()) declarePresentation(agent)
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

  // Per-agent, not one process-wide flag: two sessions assembling at once would
  // otherwise let one skip the re-assembly the other is running.
  const reassembling = new WeakSet()

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context?.agent

    if (agent !== undefined && agent.session !== undefined) {
      agentBySession.set(agent.session, agent)
    }

    if (agent !== undefined && !agentDeclared.has(agent) && transportReady()) {
      // Under 'ptc' a declaration collapses the wire to the single `run_code`
      // transport and lists the tools from their SDK projection. Where no
      // projection can be read at all, declaring would collapse the executor and
      // then have to undo it, losing the native wire on the way out. Stay native
      // instead. Under 'both' the native roster stays on the wire either way, so
      // the declaration needs no projection guard.
      const projectable = publicSchemas(agent)
      if (presentation === 'ptc' && (projectable === undefined || projectable.length === 0)) {
        warnOnce('runtime', 'no tool schema projection available — keeping the native tool surface')
      } else {
        const declaredNow = declarePresentation(agent)
        // A declaration made here cannot reach THIS assembly: the harness collects
        // the tool providers before the waterfall runs. Re-assemble so the
        // presentation lands on the assembly the model actually receives.
        if (declaredNow && !reassembling.has(agent)) {
          const sp = ctx.get('systemPrompt')
          if (typeof sp?.assemble === 'function') {
            reassembling.add(agent)
            try {
              return await sp.assemble(context)
            } catch (error) {
              warnOnce('runtime', `re-assembling after the presentation declaration failed: ${error instanceof Error ? error.message : String(error)}`)
            } finally {
              reassembling.delete(agent)
            }
          }
          // Nothing re-assembled, so this wire stays native. Presenting a transport
          // the request never names would lie to the model, so drop back to native
          // for this assembly and let the next assembly declare again.
          revertPresentation(agent, `the "${presentation}" declaration did not reach this assembly wire`, true)
        }
      }
    }

    // A declaration that just landed here (a scope no lifecycle hook could
    // reach) pages the scope before the re-assembly collects its providers, so
    // that request renders a page-consistent SDK section too. Idempotent: a
    // scope already paged by its lifecycle hook re-derives the same state.
    if (agent !== undefined && agentDeclared.has(agent)) syncBeforeAssembly(agent)

    // Delegate first: the assembled value stays authoritative for the wire (a
    // presentation declared inside this waterfall reaches the NEXT assembly,
    // which is why a declaration is followed by a re-assembly).
    const assembled = await next()

    const assembledTools = Array.isArray(assembled?.tools) ? assembled.tools : undefined
    const wireHasRunCode = (assembledTools ?? []).some(t => t?.name === 'run_code')
    const wireOnlyRunCode = assembledTools !== undefined && assembledTools.length > 0 && assembledTools.every(t => t?.name === 'run_code')

    // The paging restriction was installed OUTSIDE this waterfall (see
    // {@link syncBeforeAssembly}) because `assemble()` renders the sections and
    // collects the providers before the waterfall runs: installing it here
    // would leave the request it runs for with a catalog that claims a
    // namespace is paged and a `tools:sdk` section that still lists it. What
    // this waterfall does with it is read the SAME state the restriction was
    // built from, so the catalog never describes a different page than the one
    // the registry enforces.
    const pagingState = agent === undefined ? undefined : agentPaging.get(agent)

    // Under a collapsed `ptc` wire the registry is the ONLY surface a tool can
    // be reached through, so the page is expressed as a registry restriction.
    // Every other wire still carries paging by itself on the assembled array,
    // and `both` deliberately stays unrestricted: that is what keeps its
    // documented "paged namespaces stay reachable through the SDK inside a
    // program" behavior intact. A wire that carries the native roster again (a
    // reverted declaration) must also drop a page left over from a collapsed
    // assembly, or the filter would keep hiding tools that wire just handed
    // back.
    let surface = agent !== undefined ? publicSchemas(agent) : undefined
    // The wire partition replays the durable log itself: `pagingState` exists
    // only where a restriction was installed (the collapsed ptc wire), and
    // native/both still page the assembled array from the same event stream.
    const activeNamespaces = new Set(
      replayActivations(sessionEvents(agent?.session), maxActiveNamespaces, pagedToolPatterns).active,
    )
    if (agent !== undefined && !wireOnlyRunCode && pagingState !== undefined) clearScopePaging(agent)

    // If the wire carries only run_code but no projection is readable, revert to
    // native and restore the native wire. The replacement travels in the RETURNED
    // assembly: the waterfall's returned value is the authoritative one, and
    // mutating the object the harness handed downstream would be a side effect no
    // other listener can see.
    let correctedWire
    if (wireOnlyRunCode && (surface === undefined || surface.length === 0)) {
      revertPresentation(agent, 'no tool schema projection available under PTC')
      const nativeSchemas = publicSchemas(agent) ?? []
      surface = nativeSchemas
      correctedWire = nativeSchemas
    }

    const effectiveWire = correctedWire ?? assembledTools
    const effectiveHasRunCode = (effectiveWire ?? []).some(t => t?.name === 'run_code')
    const effectiveOnlyRunCode = effectiveWire !== undefined && effectiveWire.length > 0 && effectiveWire.every(t => t?.name === 'run_code')

    // The catalog describes the transport this request actually carries, never
    // the configuration's intent: a collapsed wire is 'ptc', run_code beside the
    // native roster is 'both', and anything else is native.
    const effectivePresentation = effectiveOnlyRunCode ? 'ptc' : (effectiveHasRunCode ? 'both' : 'native')

    // Gentle paging: the active namespaces were replayed from the durable event
    // stream above; here the paged-but-inactive tools come off the wire itself.
    // run_code and the resident roster never match the paging patterns.
    const { resident, inactive } = partitionWireTools(effectiveWire, pagedToolPatterns, activeNamespaces)

    // Diagnostic guard on the always-on-wire surface. It warns rather than
    // truncates: silently dropping a tool the session needs would trade a
    // measurable context cost for an unmeasurable capability loss.
    const residentTokens = estimateSurfaceTokens(resident)
    if (residentTokens > maxResidentTokens) {
      // Name the heaviest tools so the remedy is actionable rather than a bare number.
      const heaviest = [...resident]
        .map(tool => ({ name: typeof tool?.name === 'string' ? tool.name : '(unnamed)', tokens: estimateSurfaceTokens([tool]) }))
        .sort((left, right) => right.tokens - left.tokens)
        .slice(0, 3)
        .map(entry => `${entry.name} (${entry.tokens})`)
        .join(', ')
      warnOnce('resident-budget', `the resident tool surface is about ${residentTokens} tokens across ${resident.length} tools, over the ${maxResidentTokens}-token budget; heaviest: ${heaviest} — add matching families to pagedToolPatterns so they are held off the wire until activated`)
    }

    // The catalog describes this request's ACTUAL surface: with a live page it
    // summarizes exactly the namespaces that page withholds (the same fact the
    // restriction was built from), and otherwise the namespaces the WIRE
    // partition found — which under `both` stay reachable through the SDK
    // inside a program, as the programmatic-escape note below states.
    const catalogInactive = summarizeInactive(
      pagingState?.inactive ?? inactive,
      describe => catalogDescription(describe, descriptionMaxLength),
    )

    let entries
    if (effectivePresentation === 'ptc') {
      // Under the collapsed transport the request opens only run_code, so the
      // catalog lists the SDK-reachable projection instead of the wire.
      entries = catalogEntries(surface ?? [], descriptionMaxLength, { patterns: pagedToolPatterns })
    } else {
      const merged = mergeProjectedSchemas(resident, surface)
      entries = catalogEntries(merged, descriptionMaxLength, {
        includeRunCode: effectivePresentation === 'both',
        patterns: pagedToolPatterns,
      })
    }
    const inactiveSummary = catalogInactive

    // Store fresh state on agent
    if (agent !== undefined) {
      agentCatalogState.set(agent, {
        entries,
        presentation: effectivePresentation,
        inactive: inactiveSummary,
      })
    }

    if (assembledTools === undefined) return assembled
    // Keep the caller's own assembly object whenever this pass neither corrected
    // a collapsed wire nor lifted a paged tool off it: a needless copy would hand
    // downstream listeners a different object for no behavioral reason.
    const unchanged = correctedWire === undefined && resident.length === assembledTools.length
    return unchanged ? assembled : { ...assembled, tools: resident }
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
