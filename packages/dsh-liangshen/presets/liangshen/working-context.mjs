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
 * and dedup discipline is shared with tool-catalog's pre-step (paging.mjs owns
 * it): the message is persistent, carries the plugin source shape, and a
 * replacement is published only when the rendered line changed or the published
 * copy left the visible surface.
 *
 * Every field folds in ONE pass over the durable stream: the plan-mode and todo
 * projections, the register, and the failed-call index the activation replay
 * needs are read event by event, and the replay itself only runs when the log
 * holds an activation at all.
 */

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  DEFAULT_PAGED_TOOL_PATTERNS,
  TOOL_ACTIVATE_NAME,
  erroredCallId,
  integerAtLeast,
  latestVisiblePluginMessage,
  reconcileStepMessage,
  replayActivations,
  sessionEvents,
  validatePagedToolPatterns,
} from './paging.mjs'

import { applyFactLedgerEvent, renderLedgerField } from './fact-ledger.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-working-context'

/** Cap one rendered todo title so the line stays a single glance. */
const MAX_TITLE_CHARS = 80

/** At most this many in-progress titles render; the rest collapse to a count. */
const MAX_TITLES = 3

/** Fold one event into the plan-mode projection: the last plan/mode event wins. */
function foldPlanMode(projection, event) {
  if (event?.type !== 'plan/mode' || typeof event.data?.active !== 'boolean') return projection
  projection.seen = true
  projection.active = event.data.active
  return projection
}

/** Fold one event into the todo projection: the latest list, cleared by the next turn/start. */
function foldTodos(current, event) {
  if (event?.type === 'turn/start') return undefined
  if (event?.type === 'todo/write' && Array.isArray(event.data?.todos)) return event.data.todos
  return current
}

/** The in-progress titles of one folded todo list, in list order. */
function inProgressTitles(todos) {
  return (todos ?? [])
    .filter(item => item?.status === 'in_progress' && typeof item?.content === 'string' && item.content.trim() !== '')
    .map(item => item.content.trim())
}

/** The latest plan/mode state in the log: seen flag plus active value. */
export function planModeState(events) {
  const projection = { seen: false, active: false }
  for (const event of Array.isArray(events) ? events : []) foldPlanMode(projection, event)
  return projection
}

/**
 * The in-progress todo titles as the host's todos projection folds them: the
 * latest todo/write list, cleared by the next turn/start.
 */
export function inProgressTodos(events) {
  let todos
  for (const event of Array.isArray(events) ? events : []) todos = foldTodos(todos, event)
  return inProgressTitles(todos)
}

/** Clip one title to the per-title budget at a word-ish boundary. */
function clipTitle(title) {
  if (title.length <= MAX_TITLE_CHARS) return title
  return `${title.slice(0, MAX_TITLE_CHARS - 3)}...`
}

/**
 * Render the working-context line for one session's events, or undefined when
 * no field has anything objective to say.
 *
 * One pass over the stream folds everything this line renders plus the two
 * facts the activation replay needs — the failed callIds and whether any
 * activation was recorded at all. Without an activation the replay cannot find
 * an active namespace (it reads activations, plus the recency of families one of
 * them already lifted), so the second pass is skipped instead of walking the
 * whole log again to derive an empty set.
 */
export function renderWorkingContext(events, options) {
  const patterns = options?.pagedToolPatterns ?? DEFAULT_PAGED_TOOL_PATTERNS
  const maxActive = options?.maxActiveNamespaces ?? DEFAULT_MAX_ACTIVE_NAMESPACES
  const list = Array.isArray(events) ? events : []
  const plan = { seen: false, active: false }
  const facts = []
  const errored = new Set()
  let todos
  let sawActivation = false
  for (const event of list) {
    foldPlanMode(plan, event)
    todos = foldTodos(todos, event)
    applyFactLedgerEvent(facts, event)
    const failedCallId = erroredCallId(event)
    if (failedCallId !== undefined) errored.add(failedCallId)
    if ((event?.type === 'tool/call' || event?.type === 'tool/ptc-dispatch') && event.data?.name === TOOL_ACTIVATE_NAME) {
      sawActivation = true
    }
  }

  const fields = []
  if (plan.seen) fields.push(`plan mode: ${plan.active ? 'on' : 'off'}`)

  if (sawActivation) {
    const { active } = replayActivations(list, maxActive, patterns, errored)
    if (active.length > 0) fields.push(`active namespaces: ${[...active].sort().join(', ')}`)
  }

  const titles = inProgressTitles(todos)
  if (titles.length > 0) {
    const shown = titles.slice(0, MAX_TITLES).map(clipTitle)
    const rest = titles.length - shown.length
    fields.push(`in progress: ${shown.join('; ')}${rest > 0 ? `; +${rest} more` : ''}`)
  }

  // The key-fact register: facts the model pinned with fact_register, folded
  // from the same event stream, ride this line so they land inside the local
  // attention window every step.
  const ledgerField = renderLedgerField(facts)
  if (ledgerField !== undefined) fields.push(ledgerField)

  return fields.length === 0 ? undefined : `[Working Context: ${fields.join(' | ')}]`
}

/** Whether one message is this plugin's working-context line. */
function isContextMessage(message) {
  const source = message?.source
  return source?.kind === name || (source?.kind === 'plugin' && source?.plugin === name)
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

    // Nothing objective to say: inject nothing (a stale published line is left
    // for compaction to age out rather than replaced with an empty marker). The
    // reconciliation is shared with tool-catalog's pre-step, so the two durable
    // messages republish under exactly the same rules.
    return reconcileStepMessage(
      decision,
      latestVisiblePluginMessage(agent, isContextMessage),
      line,
      () => createContextMessage(line),
      isContextMessage,
    )
  }, { prepend: true })
}
