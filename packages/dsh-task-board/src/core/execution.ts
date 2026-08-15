/**
 * Execution service: runs a task through dsh's real session machinery.
 *
 * The board's "run" button must make dsh actually work, not fake a status:
 * the service connects a real session (workspace blank-session reuse or
 * `session.create` on the host via the workspaces service), renames it to
 * the task title, sends the task prompt with `session.prompt`, and then
 * watches the session's conversation snapshot until its turn settles. The
 * task board controller consumes {@link ExecutionEvent}s to move the card
 * running → done/failed and to keep the execution record.
 *
 * Deliberately framework-free: the runtime faces are declared structurally
 * (a narrow slice of the real `ctx.sessions` / `ctx.workspaces` contracts)
 * so tests drive it with plain fakes.
 */
import type { ExecutionRecord, TaskRecord } from './tasks.ts'

/** One list-row summary the execution service reads (the narrow slice of a SessionSummary). */
export interface ExecutionSessionSummary {
  running: boolean
  completed?: boolean
  /** Empty-log bit: the preset can only be recomposed while the session is blank. */
  blank?: boolean
  /** The preset the session currently runs (absent on deployments without presets). */
  agentPreset?: string
}

/** The narrow sessions face the service needs. */
export interface SessionsExecutionFace {
  list: {
    getSnapshot(): {
      /** Baseline arrival lifecycle — 'pending' until the host list has loaded. */
      phase: 'pending' | 'ready'
      byId: Record<string, ExecutionSessionSummary>
    }
    subscribe(fn: () => void): () => void
  }
  binding(id: string): { session: SessionDriver } | undefined
  /** Record a host-confirmed preset switch so the list label moves immediately. */
  noteAgentPreset?(sessionId: string, agentPreset: string): void
}

/** The narrow agent-preset wire face the service needs (`agentPreset.select`). */
export interface PresetsExecutionFace {
  /** Recompose a blank session's agent from a preset. */
  select(sessionId: string, agentPreset: string): Promise<{ ok: true } | { ok: false; error: unknown }>
}

/** The narrow workspaces face the service needs. */
export interface WorkspacesExecutionFace {
  list: {
    getSnapshot(): {
      items: readonly { workspaceId: string }[]
      recentWorkspaceId: string | undefined
    }
  }
  connectWorkspace(workspaceId: string): Promise<string>
}

/** One raw session-history event narrowed to the failure signal reconcile needs. */
export interface ExecutionHistoryEvent {
  type: string
  data?: unknown
}

/** Optional raw-history face used to detect failures of never-opened sessions. */
export interface HistoryExecutionFace {
  loadTail(sessionId: string): Promise<{ events: readonly ExecutionHistoryEvent[] } | undefined>
}

/** The behavior verbs the service invokes on an execution session. */
export interface SessionDriver {
  rename(title: string): Promise<unknown>
  prompt(
    content: readonly unknown[],
    mode: 'queue',
  ): Promise<{ ok: true } | { ok: false; error: unknown }>
  /**
   * Admit one slash-command line against the session's agent (the
   * `/permission <id>` mechanism). `matched` reports whether a command
   * claimed the line.
   */
  command(line: string): Promise<{ ok: true; matched: boolean } | { ok: false; error: unknown }>
  getSnapshot(): { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> }
  subscribe(fn: () => void): () => void
}

/** Everything the service needs from the runtime. */
export interface ExecutionEnvironment {
  sessions: SessionsExecutionFace
  workspaces: WorkspacesExecutionFace
  /** Agent-preset wire face; absent on deployments without preset support. */
  presets?: PresetsExecutionFace
  /** Raw-history reader for failure detection of never-opened sessions. */
  history?: HistoryExecutionFace
}

/** Outcome events the service emits to the controller. */
export type ExecutionEvent =
  | { kind: 'started'; taskId: string; executionId: string; sessionId: string }
  | { kind: 'settled'; taskId: string; executionId: string; outcome: 'succeeded' | 'failed' | 'cancelled'; error?: string }

/** Human copy for a run failure. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Whether a rejected preset switch actually means "the session already runs
 * this preset" (the host's agent-preset-conflict with a matching
 * existingPreset). A blank-session reuse race can produce this even though
 * the requested composition is in place.
 */
function presetAlreadyRuns(error: unknown, mode: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return false
  return (details as { existingPreset?: unknown }).existingPreset === mode
}

/** Whether a `turn/end` payload closed the turn with an error reason. */
function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null
    && (reason as { kind?: unknown }).kind === 'error'
}

/**
 * Run one task to completion (or to a settled failure).
 *
 * @param task - the task being executed.
 * @param execution - the freshly opened execution record (id + start time).
 * @param onEvent - callback for started/settled events.
 * @returns resolves when the run settles (or fails to start); never rejects —
 *   every failure path is reported as a settled event.
 */
export class ExecutionService {
  /** @param env - the runtime faces (real or fake). */
  constructor(private readonly env: ExecutionEnvironment) {}

  async run(
    task: TaskRecord,
    execution: ExecutionRecord,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<void> {
    const settleFailed = (error: string): void => {
      onEvent({ kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed', error })
    }
    try {
      const sessionId = await this.connectSession(task.workspaceId)
      onEvent({ kind: 'started', taskId: task.id, executionId: execution.id, sessionId })
      const driver = this.driverOf(sessionId)
      if (driver === undefined) {
        settleFailed('execution session is not ready')
        return
      }
      // Task-pinned execution targets are applied BEFORE any prompt: a preset
      // can only be recomposed while the session is blank, and the permission
      // command must run before the task's turn starts. A rejected target
      // fails the run without sending the prompt — running the task under
      // different settings than it declared would be worse than not running.
      if (!await this.applyMode(driver, task, sessionId, settleFailed)) return
      if (!await this.applyPermission(driver, task, settleFailed)) return
      // Best-effort rename so the execution is recognizable in the session list.
      await driver.rename(task.title).catch(() => { /* rename is cosmetic */ })
      // Baseline the turn counter BEFORE the prompt round-trip: a turn that
      // completes while prompt is in flight must still advance past this
      // baseline, or the watch below would never observe it settle.
      const baseline = driver.getSnapshot().turnEnds.size
      const accepted = await this.sendPrompt(driver, task)
      if (!accepted.ok) {
        settleFailed(messageOf(accepted.error))
        return
      }
      this.watchForSettlement(driver, task.id, execution.id, onEvent, baseline)
    } catch (error) {
      settleFailed(messageOf(error))
    }
  }

  /**
   * Recompose the execution session's agent from the task-pinned preset.
   * No-op when the task pins none or the session already runs it; fails the
   * run when the session is no longer blank, the preset face is missing, or
   * the wire refuses.
   */
  private async applyMode(
    driver: SessionDriver,
    task: TaskRecord,
    sessionId: string,
    settleFailed: (error: string) => void,
  ): Promise<boolean> {
    const mode = task.mode
    if (mode === undefined || mode === '') return true
    const summary = this.env.sessions.list.getSnapshot().byId[sessionId]
    if (summary?.blank === false) {
      settleFailed(`cannot switch agent preset to ${mode}: the execution session is not blank`)
      return false
    }
    if (summary?.agentPreset === mode) return true
    if (this.env.presets === undefined) {
      settleFailed(`this deployment does not support agent presets (task asks for ${mode})`)
      return false
    }
    try {
      const result = await this.env.presets.select(sessionId, mode)
      if (!result.ok) {
        // A list race can leave the summary without the preset label even
        // though the blank session already runs it; the wire answers that
        // case with agent-preset-conflict (existingPreset === requested).
        // The requested composition is already in place, so count it as
        // applied instead of failing the run.
        if (presetAlreadyRuns(result.error, mode)) {
          this.env.sessions.noteAgentPreset?.(sessionId, mode)
          return true
        }
        settleFailed(`agent preset switch to ${mode} rejected: ${messageOf(result.error)}`)
        return false
      }
    } catch (error) {
      settleFailed(`agent preset switch to ${mode} failed: ${messageOf(error)}`)
      return false
    }
    this.env.sessions.noteAgentPreset?.(sessionId, mode)
    return true
  }

  /**
   * Apply the task-pinned permission preset through the `/permission <id>`
   * slash command. No-op when the task pins none; fails the run when the
   * admission is rejected or no command claimed the line.
   */
  private async applyPermission(
    driver: SessionDriver,
    task: TaskRecord,
    settleFailed: (error: string) => void,
  ): Promise<boolean> {
    const permission = task.permission
    if (permission === undefined) return true
    const line = `/permission ${permission}`
    try {
      const result = await driver.command(line)
      if (!result.ok) {
        settleFailed(`permission command rejected: ${messageOf(result.error)}`)
        return false
      }
      if (!result.matched) {
        settleFailed(`permission command not recognized: ${line}`)
        return false
      }
    } catch (error) {
      settleFailed(`permission command failed: ${messageOf(error)}`)
      return false
    }
    return true
  }

  /**
   * Inspect a reloaded/background task that was left 'running' and emit a
   * settled event when its session already finished.
   *
   * A session that was never opened keeps a cold conversation snapshot (the
   * runtime only maintains the window for the staged/current session), so the
   * settled outcome is decided by the strongest available signal, in order:
   * 1. the list summary — missing session → cancelled; still running → pending;
   * 2. a warm conversation snapshot → `lastAgentError` decides failed/succeeded;
   * 3. the raw history tail (when a history face is wired) — a `turn/end`
   *    error reason proves failure;
   * 4. otherwise a finished session counts as succeeded.
   *
   * @param task - a task whose latest execution has no endedAt.
   * @returns a settled event when the session state proves completion, else undefined.
   */
  async reconcile(task: TaskRecord): Promise<ExecutionEvent | undefined> {
    const execution = task.executions[task.executions.length - 1]
    if (execution === undefined || execution.sessionId === undefined || execution.endedAt !== undefined) return undefined
    const list = this.env.sessions.list.getSnapshot()
    // The host list baseline has not arrived yet (page load): a session "not
    // found" now would be a false cancel. Wait for a later list change.
    if (list.phase !== 'ready') return undefined
    const summary = list.byId[execution.sessionId]
    if (summary === undefined) {
      return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'cancelled', error: 'execution session no longer exists' }
    }
    if (summary.running) return undefined
    const driver = this.driverOf(execution.sessionId)
    if (driver !== undefined) {
      const snapshot = driver.getSnapshot()
      if (snapshot.turnEnds.size > 0) {
        const outcome = snapshot.lastAgentError !== null ? 'failed' : 'succeeded'
        return {
          kind: 'settled', taskId: task.id, executionId: execution.id, outcome,
          error: snapshot.lastAgentError ?? undefined,
        }
      }
    }
    const failed = await this.historyShowsFailure(execution.sessionId)
    if (failed) {
      return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed', error: 'agent turn failed' }
    }
    return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'succeeded' }
  }

  /** Best-effort failure probe over the raw history tail (false when unavailable). */
  private async historyShowsFailure(sessionId: string): Promise<boolean> {
    const history = this.env.history
    if (history === undefined) return false
    try {
      const tail = await history.loadTail(sessionId)
      if (tail === undefined) return false
      return tail.events.some(event => event.type === 'turn/end' && isErrorTurnEnd(event.data))
    } catch (error) {
      // A failed history read must not block settlement; fall back to success.
      console.error('[dsh-task-board] history failure probe failed', error)
      return false
    }
  }

  private async connectSession(taskWorkspaceId: string | undefined): Promise<string> {
    const workspace = this.env.workspaces.list.getSnapshot()
    if (taskWorkspaceId !== undefined && taskWorkspaceId !== '') {
      // A task-pinned workspace must exist in the list: connecting an
      // unknown id would only defer the failure into the wire.
      if (!workspace.items.some(item => item.workspaceId === taskWorkspaceId)) {
        throw new Error(`task workspace is not available: ${taskWorkspaceId}`)
      }
      return this.env.workspaces.connectWorkspace(taskWorkspaceId)
    }
    const workspaceId = workspace.recentWorkspaceId ?? workspace.items[0]?.workspaceId
    if (workspaceId === undefined) {
      throw new Error('no workspace available to run the task in')
    }
    return this.env.workspaces.connectWorkspace(workspaceId)
  }

  private driverOf(sessionId: string): SessionDriver | undefined {
    return this.env.sessions.binding(sessionId)?.session
  }

  private async sendPrompt(
    driver: SessionDriver,
    task: TaskRecord,
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const text = task.prompt.trim() !== '' ? task.prompt : task.title
    try {
      const result = await driver.prompt([{ type: 'text', text }], 'queue')
      return result
    } catch (error) {
      return { ok: false, error }
    }
  }

  /**
   * Subscribe to the execution session and settle the run once the accepted
   * turn completes (turn counter advanced past the acceptance baseline and
   * the session is no longer running). Never settles while the session is
   * still running; unsubscribes on settle.
   */
  private watchForSettlement(
    driver: SessionDriver,
    taskId: string,
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    baseline: number,
  ): void {
    let settled = false
    let unsubscribe: () => void = () => {}
    const check = (): void => {
      if (settled) return
      const snapshot = driver.getSnapshot()
      if (snapshot.running || snapshot.turnEnds.size <= baseline) return
      settled = true
      unsubscribe()
      onEvent({
        kind: 'settled', taskId, executionId,
        outcome: snapshot.lastAgentError !== null ? 'failed' : 'succeeded',
        error: snapshot.lastAgentError ?? undefined,
      })
    }
    unsubscribe = driver.subscribe(check)
    // A turn can complete during the prompt round-trip (before subscribe):
    // re-check immediately so a fast turn is never missed.
    check()
  }
}
