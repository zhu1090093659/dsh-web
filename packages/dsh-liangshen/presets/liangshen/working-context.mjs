/**
 * working-context — the LiangShen preset's minimal recency projection: one
 * durable user message carrying a single `[Working Context: ...]` line of the
 * session's objective, machine-readable state, refreshed only when it changes.
 *
 * Every field is folded from the durable session event stream, so the line
 * survives resume, reload, and compaction without any process-memory state,
 * and every field is omitted when the log has nothing objective to say:
 *
 * - `plan mode: on|off` — from the session's `plan/mode` events (the last one
 *   wins, as the host's own plan projection folds them). Omitted when the log
 *   holds no `plan/mode` event at all: the ambient default is off, and the
 *   planMode service itself sits behind an isolate realm this preset row must
 *   not depend on.
 * - `active namespaces: ...` — the paged tool namespaces currently on the
 *   wire, replayed from `tool_activate` calls exactly the way the wire
 *   partition in tool-catalog replays them.
 * - `in progress: ...` — the in-progress todo titles from the latest
 *   `todo/write` event, cleared by the next `turn/start`, mirroring the host's
 *   todos projection.
 *
 * When no field has anything to say the step is left untouched. The injection
 * and dedup discipline mirrors tool-catalog's pre-step: the message is
 * persistent, carries the plugin source shape, and a replacement is published
 * only when the rendered line changed or the published copy left the visible
 * surface.
 */

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  DEFAULT_PAGED_TOOL_PATTERNS,
  integerAtLeast,
  replayActivations,
  validatePagedToolPatterns,
} from './paging.mjs'

import { foldFactLedger, renderLedgerField } from './fact-ledger.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-working-context'

/** Cap one rendered todo title so the line stays a single glance. */
const MAX_TITLE_CHARS = 80

/** At most this many in-progress titles render; the rest collapse to a count. */
const MAX_TITLES = 3

/** Session events, tolerating both snapshotEvents() and events array. */
function sessionEvents(session) {
  if (Array.isArray(session?.events)) return session.events
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  return []
}

/** The latest plan/mode state in the log: seen flag plus active value. */
export function planModeState(events) {
  let seen = false
  let active = false
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'plan/mode' || typeof event.data?.active !== 'boolean') continue
    seen = true
    active = event.data.active
  }
  return { seen, active }
}

/**
 * The in-progress todo titles as the host's todos projection folds them: the
 * latest todo/write list, cleared by the next turn/start.
 */
export function inProgressTodos(events) {
  let todos
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') {
      todos = undefined
      continue
    }
    if (event?.type === 'todo/write' && Array.isArray(event.data?.todos)) {
      todos = event.data.todos
    }
  }
  return (todos ?? [])
    .filter(item => item?.status === 'in_progress' && typeof item?.content === 'string' && item.content.trim() !== '')
    .map(item => item.content.trim())
}

/** Clip one title to the per-title budget at a word-ish boundary. */
function clipTitle(title) {
  if (title.length <= MAX_TITLE_CHARS) return title
  return `${title.slice(0, MAX_TITLE_CHARS - 3)}...`
}

/**
 * Render the working-context line for one session's events, or undefined when
 * no field has anything objective to say.
 */
export function renderWorkingContext(events, options) {
  const patterns = options?.pagedToolPatterns ?? DEFAULT_PAGED_TOOL_PATTERNS
  const maxActive = options?.maxActiveNamespaces ?? DEFAULT_MAX_ACTIVE_NAMESPACES
  const fields = []

  const plan = planModeState(events)
  if (plan.seen) fields.push(`plan mode: ${plan.active ? 'on' : 'off'}`)

  const { active } = replayActivations(events, maxActive, patterns)
  if (active.length > 0) fields.push(`active namespaces: ${[...active].sort().join(', ')}`)

  const titles = inProgressTodos(events)
  if (titles.length > 0) {
    const shown = titles.slice(0, MAX_TITLES).map(clipTitle)
    const rest = titles.length - shown.length
    fields.push(`in progress: ${shown.join('; ')}${rest > 0 ? `; +${rest} more` : ''}`)
  }

  // The key-fact register: facts the model pinned with fact_register, folded
  // from the same event stream, ride this line so they land inside the local
  // attention window every step.
  const ledgerField = renderLedgerField(foldFactLedger(events))
  if (ledgerField !== undefined) fields.push(ledgerField)

  return fields.length === 0 ? undefined : `[Working Context: ${fields.join(' | ')}]`
}

/** The text one message contributes, joined across its text blocks. */
function textOf(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Whether one message is this plugin's working-context line. */
function isContextMessage(message) {
  const source = message?.source
  return source?.kind === name || (source?.kind === 'plugin' && source?.plugin === name)
}

/** Visible surface positions, or undefined when the session exposes none. */
function visibleSeqSet(session) {
  const nodes = session?.surface?.nodes
  return Array.isArray(nodes) ? new Set(nodes) : undefined
}

/**
 * Published working-context state read back from the durable log: the latest
 * visible line's text, or just the published flag when every copy was shadowed.
 */
function contextHistory(agent) {
  const session = agent?.session
  const events = sessionEvents(session)
  const visible = visibleSeqSet(session)
  let published = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message' || !isContextMessage(event.data)) continue
    published = true
    if (visible === undefined || typeof event.seq !== 'number' || visible.has(event.seq)) {
      return { published, text: textOf(event.data) }
    }
  }
  return { published }
}

/** Build the durable working-context message for one rendered line. */
export function createContextMessage(line) {
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: line }],
    source: { kind: name },
  }
}

/** Register the per-step working-context injection. */
export function apply(ctx, config) {
  const pagedToolPatterns = validatePagedToolPatterns(name, config?.pagedToolPatterns)
  const maxActiveNamespaces = integerAtLeast(
    name,
    config?.maxActiveNamespaces,
    'maxActiveNamespaces',
    1,
    DEFAULT_MAX_ACTIVE_NAMESPACES,
  )

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload?.agent
    if (agent?.session === undefined) return decision

    const line = renderWorkingContext(sessionEvents(agent.session), {
      pagedToolPatterns,
      maxActiveNamespaces,
    })

    const history = contextHistory(agent)
    const existing = decision.messages.find(message => isContextMessage(message))

    // Nothing objective to say: inject nothing. A stale published line is left
    // for compaction to age out rather than replaced with an empty marker.
    if (line === undefined) {
      if (existing === undefined) return decision
      return { ...decision, messages: decision.messages.filter(message => message.id !== existing.id) }
    }

    if (history.text === line) {
      if (existing === undefined) return decision
      return { ...decision, messages: decision.messages.filter(message => message.id !== existing.id) }
    }
    if (existing !== undefined && textOf(existing) === line) return decision

    const message = createContextMessage(line)
    if (existing === undefined) {
      return { ...decision, messages: [...decision.messages, message] }
    }
    return {
      ...decision,
      messages: decision.messages.map(item => (item.id === existing.id ? message : item)),
    }
  }, { prepend: true })
}
