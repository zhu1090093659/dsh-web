/**
 * paging — pure helpers for the LiangShen preset's gentle tool paging.
 *
 * Paging keeps high-fan-out tool families (MCP servers and plugin tool
 * families) off the wire until the session actually needs them: a tool whose
 * name matches one of the configured prefix patterns is PAGED, everything else
 * is RESIDENT and stays on the wire. A paged tool returns to the wire once its
 * namespace is activated through the `tool_activate` tool.
 *
 * The activation state is derived from the durable session event stream, never
 * from process memory: replaying the `tool_activate` tool calls (and the tool
 * calls that refresh a namespace's recency) rebuilds the same active set after
 * a resume, a reload, or a compaction. Failed activations (errored tool
 * results) never take effect.
 *
 * Least-recently-used eviction keeps at most MAX active namespaces: activating
 * beyond the cap evicts the namespace whose latest activation or use is the
 * oldest, returning its tools to the paged summary.
 */

/**
 * The default paging patterns: the MCP bridge (`mcp__<server>__<fn>`, one
 * namespace per server) plus the plugin tool families this preset mounts and
 * would otherwise carry resident for the whole session — the browser view, the
 * task board, the team issue channel, the squad roster, the client presentation
 * tool and the SSH host tools.
 */
export const DEFAULT_PAGED_TOOL_PATTERNS = ['mcp__*', 'browser_*', 'task_board_*', 'team_*', 'squad*', 'ui_*', 'ssh_*']

/** The LRU cap on simultaneously active paged namespaces. */
export const DEFAULT_MAX_ACTIVE_NAMESPACES = 3

/** The activation tool this preset registers. */
export const TOOL_ACTIVATE_NAME = 'tool_activate'

/** Validate a positive-integer config value, or fall back when absent. */
export function integerAtLeast(plugin, value, field, minimum, fallback) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${plugin}: ${field} must be an integer >= ${minimum}`)
  }
  return value
}

/**
 * Validate the pagedToolPatterns config: an array of prefix globs, each a
 * non-empty literal head ending in exactly one trailing `*`. A head-less `*`
 * is refused rather than accepted and inert: the family derivation reads the
 * head, so a bare wildcard would claim every tool and page none of them.
 */
export function validatePagedToolPatterns(plugin, value, fallback = DEFAULT_PAGED_TOOL_PATTERNS) {
  if (value === undefined) return fallback
  if (!Array.isArray(value)) {
    throw new TypeError(`${plugin}: pagedToolPatterns must be an array of prefix patterns`)
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TypeError(`${plugin}: pagedToolPatterns entries must be non-empty strings`)
    }
    if (!entry.endsWith('*') || entry.slice(0, -1).includes('*') || entry.slice(0, -1).trim() === '') {
      throw new TypeError(`${plugin}: pagedToolPatterns entries must be prefix patterns ending in one trailing "*"`)
    }
    return entry
  })
}

/**
 * The namespace one tool name belongs to under one pattern, or undefined when
 * the pattern does not match. The pattern's own head decides how the namespace
 * is derived:
 * - a head ending in `__` is an MCP bridge, whose namespace lives in the tool
 *   name: the first `__`-delimited segment of the remainder
 *   (`mcp__codegraph__codegraph_explore` under `mcp__*` is `codegraph`);
 * - any other head names the family literally, with one trailing `_` dropped
 *   (`task_board_*` is `task_board`, `squad*` is `squad`), so a plugin whose
 *   tools share a literal prefix shares one namespace — and `squad*` covers
 *   `squads_*` and `squad_member_*` alike.
 * An empty remainder, or a head that leaves no family name at all, means the
 * tool is not paged.
 */
export function patternNamespace(name, pattern) {
  if (typeof name !== 'string' || typeof pattern !== 'string' || !pattern.endsWith('*')) return undefined
  const prefix = pattern.slice(0, -1)
  if (!name.startsWith(prefix)) return undefined
  const rest = name.slice(prefix.length)
  if (rest === '') return undefined
  const namespace = prefix.endsWith('__')
    ? rest.split('__')[0]
    : prefix.endsWith('_') ? prefix.slice(0, -1) : prefix
  return namespace === '' ? undefined : namespace
}

/** The namespace one tool name belongs to under any pattern, or undefined. */
export function namespaceOf(name, patterns) {
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    const namespace = patternNamespace(name, pattern)
    if (namespace !== undefined) return namespace
  }
  return undefined
}

/**
 * Partition one wire tool list into resident tools and paged-but-inactive
 * namespaces. A paged tool whose namespace is active stays resident. The
 * inactive map is keyed by namespace in sorted order so one surface renders
 * byte-identical text across assemblies.
 */
export function partitionWireTools(tools, patterns, activeNamespaces) {
  const resident = []
  const inactive = new Map()
  const active = activeNamespaces instanceof Set ? activeNamespaces : new Set(activeNamespaces ?? [])
  for (const tool of Array.isArray(tools) ? tools : []) {
    const namespace = namespaceOf(tool?.name, patterns)
    if (namespace === undefined || active.has(namespace)) {
      resident.push(tool)
      continue
    }
    let group = inactive.get(namespace)
    if (group === undefined) {
      group = []
      inactive.set(namespace, group)
    }
    group.push(tool)
  }
  const sorted = new Map([...inactive.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
  return { resident, inactive: sorted }
}

/**
 * The tool names one full (pre-restriction) surface must withhold at the
 * REGISTRY for a given active set: every paged tool whose namespace is not
 * active. Reserved names are never returned — the official transport cannot
 * be named by a restriction, and paging must not be the reason a session
 * loses it.
 *
 * Deliberately the same partition the wire uses, so the two halves of paging
 * cannot disagree about which tools are resident.
 */
export function withheldToolNames(tools, patterns, activeNamespaces, reserved = ['run_code']) {
  const blocked = new Set(reserved)
  const names = []
  for (const group of partitionWireTools(tools, patterns, activeNamespaces).inactive.values()) {
    for (const tool of group) {
      if (typeof tool?.name !== 'string' || tool.name === '') continue
      if (blocked.has(tool.name)) continue
      names.push(tool.name)
    }
  }
  return names.sort()
}

/**
 * The paged namespaces of one full (pre-restriction) surface, keyed like
 * {@link partitionWireTools} does and sorted the same way, so a catalog can
 * summarize what a restriction withheld without a second matching rule.
 */
export function inactiveNamespaces(tools, patterns, activeNamespaces) {
  return partitionWireTools(tools, patterns, activeNamespaces).inactive
}

/** Parse one tool/call event's arguments, tolerating the JSON-string form. */
function callArguments(data) {
  let args = data?.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  return args !== null && typeof args === 'object' ? args : undefined
}

/**
 * Whether one tool/result event reports a failure.
 *
 * Exported because the phase logic reads the same signal: a failed dispatch opens
 * the review stretch, and one definition of "failed" keeps the two mechanisms
 * from disagreeing about what a failure is.
 */
export function resultIsError(data) {
  if (data?.error !== undefined && data?.error !== null) return true
  const message = data?.message
  if (message?.isError === true) return true
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.some(block => block?.isError === true)
}

/**
 * Replay the durable session event stream into the active namespace set.
 *
 * Events are the source of truth: a `tool_activate` call whose result did not
 * error activates its namespace (or refreshes its recency), and any other
 * successful call into a paged tool refreshes the namespace it belongs to.
 * Activating beyond the capacity evicts the least recently used namespace.
 * Returns the active namespaces oldest-first and every evicted namespace in
 * eviction order.
 */
export function replayActivations(events, capacity = DEFAULT_MAX_ACTIVE_NAMESPACES, patterns = DEFAULT_PAGED_TOOL_PATTERNS) {
  const list = Array.isArray(events) ? events : []
  const errored = new Set()
  for (const event of list) {
    if (event?.type !== 'tool/result') continue
    const callId = event.data?.message?.source?.callId ?? event.data?.callId
    if (callId !== undefined && resultIsError(event.data)) errored.add(String(callId))
  }

  const active = []
  const evicted = []
  const touch = (namespace) => {
    const index = active.indexOf(namespace)
    if (index >= 0) active.splice(index, 1)
    active.push(namespace)
    while (active.length > capacity) evicted.push(active.shift())
  }
  for (const event of list) {
    // Under the `ptc` presentation the wire carries `run_code` alone, so the model
    // reaches EVERY tool from inside a program and the harness records each call as
    // a `tool/ptc-dispatch` event — never as a top-level `tool/call`. Reading only
    // `tool/call` therefore found no activation at all: every activation reported
    // success, the page never lifted, and the same namespace could be activated
    // again for ever. Both event shapes feed the same recency list, in the order
    // the session recorded them, and the dispatch branch repeats BOTH rules the
    // top-level branch applies: an activation activates, and any other call into
    // an already-active family refreshes it. Without the second rule the LRU
    // silently degraded to activation order — the only shape a real tool call
    // takes under the default presentation refreshed nothing.
    if (event?.type === 'tool/ptc-dispatch') {
      const dispatch = event.data
      if (dispatch?.isError === true) continue
      if (dispatch?.name === TOOL_ACTIVATE_NAME) {
        const namespace = callArguments(dispatch)?.namespace
        if (typeof namespace === 'string' && namespace !== '') touch(namespace)
        continue
      }
      const namespace = namespaceOf(dispatch?.name, patterns)
      if (namespace !== undefined && active.includes(namespace)) touch(namespace)
      continue
    }
    if (event?.type !== 'tool/call') continue
    const data = event.data
    if (data?.callId !== undefined && errored.has(String(data.callId))) continue
    if (data?.name === TOOL_ACTIVATE_NAME) {
      const namespace = callArguments(data)?.namespace
      if (typeof namespace === 'string' && namespace !== '') touch(namespace)
      continue
    }
    const namespace = namespaceOf(data?.name, patterns)
    if (namespace !== undefined && active.includes(namespace)) touch(namespace)
  }
  return { active, evicted }
}

/**
 * One-line catalog summary per inactive namespace: the namespace, its tool
 * count, a sample tool name, and the first tool's one-line description as the
 * namespace's summary.
 */
export function summarizeInactive(inactive, describe) {
  const summaries = []
  for (const [namespace, tools] of inactive instanceof Map ? inactive : []) {
    const sorted = [...tools].sort((a, b) => (a?.name < b?.name ? -1 : a?.name > b?.name ? 1 : 0))
    const first = sorted[0]
    summaries.push({
      namespace,
      count: sorted.length,
      sample: typeof first?.name === 'string' ? first.name : '',
      description: typeof describe === 'function' ? describe(first?.description) : '',
    })
  }
  return summaries
}
