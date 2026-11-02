/**
 * dispatch-guard — the LiangShen preset's execution-time guard against two
 * dispatch-plane overreaches.
 *
 * A preset row composes ONE tool registry, and an in-process child agent
 * inherits that composition. Two things therefore break quietly:
 *
 * 1. **A child calls a coordinator-only tool.** `ask_user_question`,
 *    `exit_plan_mode`, `create_goal` and their kin are the points where a
 *    decision is made. A child that asks the user itself, enters plan mode
 *    itself, or opens a goal itself splits one decision into two: the child asks,
 *    the user answers, and the dispatcher never learns what was asked. A child
 *    is supposed to hand the open question BACK, not to consume it.
 * 2. **A caller sleeps while a child is still running.** The harness wakes the
 *    caller through the child's completion notification, so a `sleep` loop
 *    burns tokens to observe an event that arrives on its own.
 *
 * ## Why the tool surface does not move
 *
 * The guard uses exactly one seam, `ctx.tools.guard(exec => …)`:
 *
 * - it does not wrap `tools.register`, does not wrap `tools.definitions`, and
 *   does not listen on prompt assembly, so the declared tool schema stays
 *   byte-identical and a prefix-caching provider never rebuilds its cache
 *   because this row exists;
 * - interception happens at CALL EXECUTION time, which keeps "the model can see
 *   the tool" and "the model can drive the tool" separate: the tool stays in
 *   the table and only the out-of-bounds call is refused.
 *
 * ## Where the facts come from
 *
 * Both decisions are structural probes over facts the host already holds, never
 * an import of a cohort-specific type:
 *
 * - "is this caller a child": first the durable session lineage
 *   (`session.header.origin === 'subagent'`), then the live root set
 *   (`agents.roots()`);
 * - "does this caller still have a child running": `subagents.list` and
 *   `agents.list`, whichever answers.
 *
 * Every fact the guard cannot read fails OPEN: a leg the host cannot resolve
 * keeps the harness's own behaviour instead of failing the preset's load, which
 * is why `agents` and `subagents` are read through `ctx.get()` at call time
 * and never declared in `inject`.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-dispatch-guard'

/**
 * Services this row declares.
 *
 * Only `tools` is declared, and only because this row mounts inside it: the
 * guard seam lives on `ctx.tools.guard`. `agents` and `subagents` are NOT
 * declared — a preset row runs in its own fiber, so a static declaration makes
 * the row depend on a service the host may never provide, while an undeclared
 * name read through `ctx.get()` degrades to `undefined` and lets the row mount
 * anyway.
 */
export const inject = ['tools']

/**
 * Tools a delegated subagent must not call.
 *
 * All seven are decision or delivery points rather than work: the ask and the
 * plan transitions belong to the coordinator, the goal domain is held by the
 * coordinator, and `present` is the coordinator's delivery gate. A child that
 * needs a decision reports the open question instead.
 */
export const DEFAULT_COORDINATOR_TOOLS = Object.freeze([
  'ask_user_question',
  'enter_plan_mode',
  'leave_plan_mode',
  'exit_plan_mode',
  'create_goal',
  'update_goal',
  'present',
])

/**
 * Shell tools whose `command` argument can carry a wait.
 *
 * A wait is only a problem when a child is actually running; with no child,
 * `sleep 1` is an ordinary command and must pass through untouched.
 */
export const DEFAULT_SHELL_TOOLS = Object.freeze([
  'bash',
  'pwsh',
  'win_bash',
])

/**
 * One statement that only waits.
 *
 * Anchored at both ends so a statement that waits AND does work (`sleep 1 && npm
 * test` is split before matching, but `sleep 1 | cat` is not) fails to match and
 * therefore passes through: an unrecognised statement is never treated as a wait.
 */
const WAIT_COMMAND_PATTERN = /^(?:sleep\s+\d+(?:\.\d+)?[smhd]?|Start-Sleep\s+(?:-(?:Seconds|Milliseconds|s|m)\s+)?\d+(?:\.\d+)?|timeout(?:\.exe)?\s+(?:\/t\s+)?\d+(?:\s+\/nobreak)?|ping(?:\.exe)?\s+-n\s+\d+\s+(?:127\.0\.0\.1|localhost))$/i

/** One statement that does nothing at all, so it changes no verdict. */
const NOOP_COMMAND_PATTERN = /^(?:echo\b.*|Write-Host\b.*|Write-Output\b.*|true|:)$/i

/** A comment line: the shell ignores it, so it may accompany a wait. */
const COMMENT_COMMAND_PATTERN = /^#/

/** Read a value as a plain record. */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** Read a value as a plain array. */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** Read a record's string `id`. */
function idOf(value) {
  const record = asRecord(value)
  return typeof record?.['id'] === 'string' ? record['id'] : undefined
}

/**
 * Read one OPTIONAL service off the host context.
 *
 * Always through `ctx.get()`: an undeclared property read on a real cordis
 * context throws `cannot get property "…" without inject` on the spot, and a
 * failed read must leave the guard without an opinion, never raise on a tool
 * call.
 */
function readService(ctx, serviceName) {
  const reader = asRecord(ctx)?.['get']
  if (typeof reader !== 'function') return undefined
  try {
    return reader.call(ctx, serviceName)
  } catch {
    return undefined
  }
}

/** The live root set of an `agents` service, when it can be read at all. */
function rootsOf(agents) {
  const roots = asRecord(agents)?.['roots']
  if (typeof roots !== 'function') return undefined
  try {
    const listed = roots.call(agents)
    return Array.isArray(listed) ? listed : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether this caller is a delegated child.
 *
 * Two levels, the independently valid fact first:
 *
 * 1. durable lineage — `session.header.origin === 'subagent'`, written when the
 *    child session was created, so it survives a host generation change;
 * 2. the live root set — an agent that is NOT among `agents.roots()` is somebody
 *    else's child. Liveness is checked first (`agents.get(id) === agent`): an
 *    agent that is no longer the one registered under that id has been replaced
 *    or expired, and judging whether a stale object is a child is meaningless,
 *    so it passes through.
 *
 * A host without `agents`, without `roots`, or with a throwing read cannot be
 * judged and answers `false`: treating an unreadable identity as a child would
 * refuse the coordinator's own calls.
 * @param agent - Calling agent.
 * @param ctx - Host context carrying the optional `agents` service.
 * @returns whether the caller is a delegated subagent.
 */
export function isDelegatedCaller(agent, ctx) {
  const caller = asRecord(agent)
  if (caller === undefined) return false
  const header = asRecord(asRecord(caller['session'])?.['header'])
  if (header?.['origin'] === 'subagent') return true

  const agents = readService(ctx, 'agents')
  if (asRecord(agents) === undefined) return false
  const roots = rootsOf(agents)
  if (roots === undefined) return false
  const id = idOf(caller)
  const get = asRecord(agents)?.['get']
  if (id !== undefined && typeof get === 'function') {
    let live
    try {
      live = get.call(agents, id)
    } catch {
      live = undefined
    }
    if (live !== agent) return false
  }
  return !roots.includes(agent)
}

/**
 * Whether one statement is harmless filler beside a wait.
 * @param statement - Trimmed statement.
 * @returns whether the statement makes no difference to the verdict.
 */
function isNoopStatement(statement) {
  return NOOP_COMMAND_PATTERN.test(statement) || COMMENT_COMMAND_PATTERN.test(statement)
}

/**
 * Whether a command only waits.
 *
 * The command is split on `;`, `&&` and newlines, and it counts as a pure wait
 * only when at least one statement waits and EVERY statement either waits or is
 * harmless filler. One statement doing real work (`npm test`, `git status`,
 * `node …`) makes the whole command real work, and such a command MUST pass
 * through — otherwise the guard refuses legitimate background work.
 * @param command - Candidate command.
 * @returns whether the command only waits.
 */
export function isPureSleepCommand(command) {
  if (typeof command !== 'string') return false
  const statements = command
    .split(/;|&&|\n/u)
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0)
  if (statements.length === 0) return false
  let sawWait = false
  for (const statement of statements) {
    if (WAIT_COMMAND_PATTERN.test(statement)) {
      sawWait = true
      continue
    }
    if (!isNoopStatement(statement)) return false
  }
  return sawWait
}

/**
 * Call a host "list my entries" method defensively.
 *
 * Generations disagree about the shape: a scoped `list(agent, 'children')`, a
 * scoped-but-single-argument `list(agent)`, and an argument-free `list()` all
 * exist in the wild. Each form is tried in order and the first one that answers
 * wins.
 * @param fn - Host method.
 * @param self - Receiver the method belongs to.
 * @param agent - Calling agent.
 * @param scoped - whether to try the scoped forms first.
 * @returns whatever the host returned, or undefined when no form answered.
 */
function callList(fn, self, agent, scoped = true) {
  if (typeof fn !== 'function') return undefined
  const attempts = scoped ? [[agent, 'children'], [agent], []] : [[], [agent]]
  for (const args of attempts) {
    try {
      const listed = fn.apply(self, args)
      // A host may ignore the extra argument and answer in full; only an
      // undefined return means this form is not understood.
      if (listed !== undefined) return listed
    } catch {
      // This generation does not know the form: fall back to the next one.
    }
  }
  return undefined
}

/**
 * Pull the entry records out of a host listing.
 *
 * A host may answer with a plain array, or with a record wrapping one of
 * `children` / `agents` / `entries` / `list`.
 * @param listed - Host return value.
 * @returns the entry records, empty when none could be read.
 */
function entriesOf(listed) {
  if (Array.isArray(listed)) return listed.filter(entry => asRecord(entry) !== undefined)
  const record = asRecord(listed)
  if (record === undefined) return []
  const entries = []
  for (const key of ['children', 'agents', 'entries', 'list']) {
    const candidate = record[key]
    if (!Array.isArray(candidate)) continue
    for (const entry of candidate) {
      if (asRecord(entry) !== undefined) entries.push(entry)
    }
  }
  return entries
}

/**
 * Read the directly injected running-child callback off the context.
 *
 * This read is wrapped in try/catch on purpose: a real cordis context throws on
 * any property read that `inject` does not cover, and one failed read must not
 * make the guard raise on every tool call.
 * @param ctx - Host context.
 * @returns the injected callback, or undefined when the host carries none.
 */
function injectedHasRunningChildren(ctx) {
  if (asRecord(ctx) === undefined) return undefined
  let injected
  try {
    injected = ctx['hasRunningChildren']
  } catch {
    return undefined
  }
  return typeof injected === 'function' ? injected : undefined
}

/**
 * The session id of a caller, as its header records it.
 * @param agent - Calling agent.
 * @returns the session id, or undefined when the header carries none.
 */
function sessionIdOf(agent) {
  return idOf(asRecord(asRecord(agent)?.['session'])?.['header'])
}

/**
 * Whether this caller still has a child running.
 *
 * Two host probes, either one answering counts:
 *
 * 1. `subagents.list` — any direct entry whose `status === 'running'`;
 * 2. `agents.list()` — any running entry whose `parent` is the caller's agent id
 *    or the caller's session header id.
 *
 * A directly injected `ctx.hasRunningChildren(agent)` callback wins over both
 * when the host provides one. Every read failure answers `false`: this test only
 * ever adds a denial, so an unreadable host keeps the call.
 * @param agent - Calling agent.
 * @param ctx - Host context carrying the optional `subagents` / `agents` services.
 * @returns whether a child of this caller is still running.
 */
export function hasRunningChildSubagent(agent, ctx) {
  const caller = asRecord(agent)
  if (caller === undefined) return false

  const injected = injectedHasRunningChildren(ctx)
  if (injected !== undefined) {
    try {
      return injected(agent) === true
    } catch {
      return false
    }
  }

  const subagents = readService(ctx, 'subagents')
  if (asRecord(subagents) !== undefined) {
    const listed = callList(asRecord(subagents)?.['list'], subagents, agent)
    if (entriesOf(listed).some(entry => entry['status'] === 'running')) return true
  }

  const agents = readService(ctx, 'agents')
  if (asRecord(agents) !== undefined) {
    const listed = callList(asRecord(agents)?.['list'], agents, agent, false)
    const parentIds = new Set()
    const ownId = idOf(caller)
    if (ownId !== undefined) parentIds.add(ownId)
    const headerId = sessionIdOf(caller)
    if (headerId !== undefined) parentIds.add(headerId)
    const running = entriesOf(listed).some(entry =>
      entry['status'] === 'running'
      && typeof entry['parent'] === 'string'
      && parentIds.has(entry['parent']))
    if (running) return true
  }

  return false
}

/** The denial for a child that called a coordinator-only tool. */
function delegatedCallerDenial(toolName) {
  return `DELEGATED_CALLER: "${toolName}" is a dispatch-level tool and a delegated subagent must not call it directly. `
    + 'Report back to the dispatcher instead: include status: "hand_back" or status: "blocked" '
    + 'and the unresolved question or decision in your report, and let the dispatcher act on it.'
}

/** The denial for sleeping while a child is still running. */
function activeChildSleepDenial() {
  return 'ACTIVE_CHILD_SLEEP_FORBIDDEN: a child subagent is still running, so sleeping to wait for it is not allowed. '
    + 'End your turn now and let the built-in subagent completion notification wake you.'
}

/**
 * Decide one call.
 *
 * The two decisions are independent, so they are checked in a fixed order: the
 * coordinator-only refusal is a fact about WHO called, and it precedes the
 * shell check because a coordinator-only tool is refused whatever its arguments
 * say.
 * @param input - Caller, tool name, arguments, host context and configured lists.
 * @returns a denial reason, or undefined to leave the call untouched.
 */
export function dispatchDenialReason(input) {
  const {
    agent, toolName, args, ctx,
    coordinatorTools = DEFAULT_COORDINATOR_TOOLS,
    shellTools = DEFAULT_SHELL_TOOLS,
    hasRunningChildren,
  } = asRecord(input) ?? {}
  if (typeof toolName !== 'string') return undefined

  if (asArray(coordinatorTools).includes(toolName) && isDelegatedCaller(agent, ctx)) {
    return delegatedCallerDenial(toolName)
  }

  if (asArray(shellTools).includes(toolName)) {
    const command = asRecord(args)?.['command']
    const background = asRecord(args)?.['run_in_background'] === true
    // A backgrounded command is not a wait the caller sits in, so it is exempt.
    if (!background && isPureSleepCommand(command)) {
      let running = false
      try {
        running = typeof hasRunningChildren === 'function'
          ? hasRunningChildren(agent) === true
          : hasRunningChildSubagent(agent, ctx)
      } catch {
        running = false
      }
      if (running) return activeChildSleepDenial()
    }
  }

  return undefined
}

/**
 * Install the guard for the calling scope.
 * @param ctx - Host context carrying the tool registry.
 * @param config - Row configuration.
 * @returns a disposer that removes the guard, or undefined when the scope has no
 *   guard seam at all.
 */
export function installDispatchGuard(ctx, config = {}) {
  let tools
  try {
    tools = asRecord(ctx)?.['tools']
  } catch {
    tools = undefined
  }
  const register = asRecord(tools)?.['guard']
  if (typeof register !== 'function') return undefined
  const coordinatorTools = Array.isArray(config?.coordinatorTools)
    ? config.coordinatorTools
    : DEFAULT_COORDINATOR_TOOLS
  const shellTools = Array.isArray(config?.shellTools) ? config.shellTools : DEFAULT_SHELL_TOOLS
  const dispose = register.call(tools, execution => dispatchDenialReason({
    agent: execution?.agent,
    toolName: execution?.name,
    args: execution?.arguments,
    ctx,
    coordinatorTools,
    shellTools,
  }))
  return typeof dispose === 'function' ? dispose : () => undefined
}

/**
 * Mount the row: register the guard for this scope, with an off switch.
 *
 * The off switch is the row's own `enabled` key rather than a settings-card
 * field: the row is a guard, not a feature, and the composition is the one place
 * that says which guards a preset mounts.
 * @param ctx - Cordis context of the composing scope.
 * @param config - Row configuration; omitted fields select the shipped lists.
 */
export function apply(ctx, config = {}) {
  if (config?.enabled === false) return
  ctx.effect(
    () => installDispatchGuard(ctx, config) ?? (() => undefined),
    'liangshen: dispatch execution guard',
  )
}
