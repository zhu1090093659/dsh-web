/**
 * tool-activate — the LiangShen preset's `tool_activate` tool: the activation
 * handle for the gentle tool paging the sibling tool-catalog plugin applies.
 *
 * Tools whose names match the paging patterns — by default the MCP bridge plus
 * the plugin families `browser_*`, `task_board_*`, `team_*`, `squad*`, `ui_*`
 * and `ssh_*` — stay out of reach until their namespace is activated here: off
 * the wire, and, under a presentation whose wire has already collapsed to the
 * single `run_code` transport where the wire carries nothing left to filter,
 * also out of the scope's registry view, which is what the generated SDK and
 * every program dispatch resolve against.
 *
 * The activation itself is the durable `tool/call`
 * event this call appends to the session log: the catalog plugin re-pages the
 * scope at the end of the call (its `tools/post-execute` hook) and the wire
 * partition replays the same event stream at the next assembly, so both halves
 * of paging follow the log — the namespace's tools come back from the next
 * request on, and a resume or compaction rebuilds the same state without any
 * process memory.
 *
 * At most MAX namespaces stay active at once (LRU): activating beyond the cap
 * evicts the least recently used namespace back to the paged summary, and the
 * eviction is named in this tool's result so the catalog's next publication
 * reflects it.
 *
 * Validation: the target must name a namespace that currently has paged,
 * inactive tools — an unknown namespace fails with the list of available ones,
 * and an already-active namespace is a no-op error instead of a silent success.
 */

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  integerAtLeast,
  namespaceOf,
  replayActivations,
  validatePagedToolPatterns,
} from './paging.mjs'
import { pagedNamespacesFor } from './tool-catalog.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-tool-activate'

/** The tools registry must exist before the activation tool can register. */
export const inject = ['tools']

/** Session events, tolerating both snapshotEvents() and events array. */
function sessionEvents(session) {
  if (Array.isArray(session?.events)) return session.events
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  return []
}

/** Register the model-facing `tool_activate` tool. */
export function apply(ctx, config) {
  const pagedToolPatterns = validatePagedToolPatterns(name, config?.pagedToolPatterns)
  const maxActiveNamespaces = integerAtLeast(
    name,
    config?.maxActiveNamespaces,
    'maxActiveNamespaces',
    1,
    DEFAULT_MAX_ACTIVE_NAMESPACES,
  )

  /**
   * Read the session's visible tool schemas from the public API, tolerating
   * test stubs that only provide sdkSchemas.
   */
  const schemasFor = (agent) => {
    const candidates = [agent?.ctx?.tools, ctx.tools, ctx.get('tools')]
    for (const tools of candidates) {
      if (tools === undefined) continue
      for (const method of ['schemas', 'sdkSchemas']) {
        if (typeof tools?.[method] !== 'function') continue
        try {
          const schemas = tools[method](agent)
          if (Array.isArray(schemas)) return schemas
        } catch {
          // A hostile or unavailable projection falls through to the next source.
        }
      }
    }
    return []
  }

  /**
   * The paged namespaces this scope carries, keyed by namespace to the sorted
   * names of its tools.
   *
   * The catalog publishes the pre-restriction partition of every scope it
   * pages, and reading it back is the only faithful source: the catalog's live
   * `tools.restrict` filter removes the paged names from every scoped reader,
   * so recomputing from `tools.schemas(agent)` finds an empty page and refuses
   * activations the same request's catalog advertises. The schema read stays as
   * the fallback for a scope nothing pages — a native presentation, a
   * deployment without the catalog row, or a test stub.
   * @param agent - agent scope the call acts for.
   * @returns namespace to tool-name map, empty when nothing is paged.
   */
  const pagedToolsOf = (agent) => {
    const paged = new Map()
    const published = pagedNamespacesFor(agent)
    if (published !== undefined && published.size > 0) {
      for (const [namespace, group] of published) {
        paged.set(namespace, group.map(tool => tool?.name).filter(toolName => typeof toolName === 'string').sort())
      }
      return paged
    }
    for (const schema of schemasFor(agent)) {
      const toolName = schema?.name
      if (typeof toolName !== 'string' || toolName === 'tool_activate') continue
      const owner = namespaceOf(toolName, pagedToolPatterns)
      if (owner === undefined) continue
      let group = paged.get(owner)
      if (group === undefined) {
        group = []
        paged.set(owner, group)
      }
      group.push(toolName)
    }
    for (const group of paged.values()) group.sort()
    return paged
  }

  ctx.tools.register({
    name: 'tool_activate',
    description: [
      `Load one paged tool namespace back into this session's reach — onto the wire, and the generated SDK along with it. The session catalog summarizes the paged namespaces; activating one makes its tools callable from the next request on.`,
      `At most ${maxActiveNamespaces} namespaces stay active at once: activating beyond the cap evicts the least recently used namespace back to the catalog summary.`,
      'The target must be a paged, currently inactive namespace exactly as the catalog names it.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'The paged namespace to activate, exactly as the catalog names it (for example "codegraph" for mcp__codegraph__* tools, or "task_board" for task_board_* tools).',
        },
      },
      required: ['namespace'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    /**
     * Activation is concurrency-safe: the handler only reads the session's event
     * stream and returns a report. The activation itself is the durable tool/call
     * event the runtime appends for this call, so overlapping activations of
     * different namespaces cannot corrupt shared state — the next assembly simply
     * replays whatever the log holds. Declaring it lets independent activations
     * (and any other read-only sibling) overlap instead of forming a barrier.
     */
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const namespace = args.namespace
      const agent = exec?.agent

      // The paged namespaces the session actually carries, with their tools in
      // stable name order for deterministic reporting.
      const paged = pagedToolsOf(agent)

      if (!paged.has(namespace)) {
        const available = [...paged.keys()].sort()
        throw new Error(`unknown paged namespace "${namespace}" — paged namespaces in this session: ${available.map(ns => `"${ns}"`).join(', ') || '(none)'}`)
      }

      // Replay the activation state from the durable log, EXCLUDING this very
      // call: the harness appends the tool/call event before executing, so the
      // stream may already carry it, and counting it would misreport the target
      // as already active.
      const selfCallId = exec?.callId
      const events = sessionEvents(agent?.session).filter(event => !(
        event?.type === 'tool/call'
        && selfCallId !== undefined
        && event.data?.name === 'tool_activate'
        && String(event.data?.callId) === String(selfCallId)
      ))
      const { active } = replayActivations(events, maxActiveNamespaces, pagedToolPatterns)
      if (active.includes(namespace)) {
        throw new Error(`namespace "${namespace}" is already active; its tools are on the wire`)
      }

      const next = [...active, namespace]
      const evicted = next.length > maxActiveNamespaces ? next.shift() : undefined
      const tools = paged.get(namespace)
      const lines = [
        `Activated namespace "${namespace}" (${tools.length} tool${tools.length === 1 ? '' : 's'}): ${tools.join(', ')}.`,
        'Its tools are on the wire from the next request; call them directly by name.',
      ]
      if (evicted !== undefined) {
        lines.push(`Least recently used namespace "${evicted}" was paged out (capacity ${maxActiveNamespaces}); its summary stays in the catalog and tool_activate can reload it.`)
      }
      return { text: lines.join(' ') }
    },
  })
}
