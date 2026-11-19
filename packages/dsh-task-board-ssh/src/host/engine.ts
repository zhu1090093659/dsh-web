/**
 * The run engine: launch interception, per-host admission, remote polling,
 * reconciliation, follow-up and cancellation for one board mount.
 *
 * One card, one run at a time, and the card's own stored payload is the whole
 * state: what it pins, which run it waits on and what it already did. That is
 * what lets the local host disappear mid-run — the remote process keeps going
 * under `setsid nohup`, and a Host that starts again reads the same payloads and
 * picks every run back up (reconciliation), closes the ones that finished while
 * it was away exactly once, and keeps polling the ones still running.
 *
 * Two board seams are load-bearing and both are probed, never assumed:
 * `launch.intercept` takes a card over before a session exists (direct mode) or
 * adds the preamble a local session starts with (proxy mode), and the board's
 * action seat writes the verdict back through `record-external-outcome`. A board
 * revision that serves neither still gets this extension mounted: its tools
 * answer, its polls stop, and the reason is logged.
 *
 * @module dsh-task-board-ssh/host/engine
 */
import {
  buildAgentCommandLine,
  customAgentCommand,
  customResumeSupported,
  readAgentOutput,
  type SshAgentCommand,
  type SshAgentRunInput,
  type SshCustomTemplates,
} from '../core/adapters/index.ts'
import type { DshSshHost, DshSshService, TaskBoardExtensionHost, TaskBoardLaunchContext, TaskBoardLaunchDecision, TaskBoardStatusChangedEvent, TaskBoardTaskDeletedEvent } from '../core/contract.ts'
import { SSH_ERROR_MAX_LENGTH, SSH_SUMMARY_MAX_LENGTH } from '../core/ledger.ts'
import { runFilePath, type LauncherStatus } from '../core/launcher.ts'
import { isTerminalRunPhase, type SshAgentKind, type SshAgentTarget, type SshRunPhase, type SshRunRecord, type SshTarget } from '../core/target.ts'
import type { TaskRecord } from '../core/task-record.ts'
import type { SshWorkspaceCollection, SshWorkspaceRun, SshWorkspaceStrategy } from '../core/workspace.ts'
import { SSH_INITIATOR_PREFIX, alreadyRecorded, type BoardActionSeat } from './board.ts'
import {
  SSH_INTEGRATION_KEY,
  latestSessionId,
  liveRunOf,
  readHostPayload,
  withActiveRun,
  withSettledRun,
  writeHostPayload,
  type HostSshPayload,
  type SshPendingInstruction,
} from './payload.ts'
import { PUBLISH_BODY_LIMIT_BYTES, SshLogWindows, byteLength, sliceFromByte } from './logs.ts'
import { SSH_DEGRADED_SUMMARY_MARKER, proxyPreamble, runPrompt } from './prompt.ts'
import { admitRuns, type SshQueueEntry } from './queue.ts'
import { SshRemote } from './remote.ts'
import type { SshProviderSettings } from './settings.ts'
import type { HostTimerFace } from './timers.ts'
import type { SshWorkspaceStrategyResolver } from './workspace-seam.ts'

/** Poll cadence when a deployment configures none, in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 2_000

/** Consecutive unreadable polls after which a run is recorded as lost. */
export const LOST_AFTER_FAILURES = 3

/** Longest tail of a run's log this engine parses, in characters. */
const PARSE_WINDOW = 256 * 1024

/** What the engine needs from its mount; every member is injectable so a spec can pin it. */
export interface SshRunEngineOptions {
  /** The board's capability face for this extension. */
  host: TaskBoardExtensionHost
  /** `dsh-ssh`'s forwarder: the only way this package reaches a remote host. */
  ssh: DshSshService
  /** Timer seat the poll cadence runs on. */
  timers: HostTimerFace
  /** Live configuration of this mount, read at use time. */
  settings: () => SshProviderSettings
  /** The board's in-process action seat, resolved per call so a late one is honoured. */
  seat?: () => BoardActionSeat | undefined
  /** Placement strategies; absent means this deployment prepares no working directory. */
  workspaces?: SshWorkspaceStrategyResolver
  /**
   * Resolve a local workspace id to the repository root a git run bundles.
   *
   * The engine holds no workspace face of its own (this package reaches the
   * deployment only through `taskBoard` and `dshSsh`), so the mount supplies the
   * lookup. Absent means a run pinned to a local workspace fails with the
   * strategy's own "repository was not resolved" refusal instead of guessing a
   * path.
   */
  localRepository?: (workspaceId: string) => string | undefined
  /** Clock (ms epoch). */
  now?: () => number
  /** Identifier source for request ids. */
  uuid?: () => string
  /** Poll cadence, in milliseconds. */
  pollIntervalMs?: number
  /** Ceiling for one remote command, in milliseconds. */
  commandTimeoutMs?: number
  /** Where a refusal or a failed remote call is reported. */
  log?: (message: string, detail?: unknown) => void
}

/** One run this process is following. */
interface SshJob {
  /** Card the run belongs to. */
  taskId: string
  /** Run identifier the remote launcher is idempotent on. */
  runId: string
  /** Host the run addresses. */
  alias: string
  /** Consecutive polls that produced no usable answer. */
  failures: number
  /** Whether this run carries a follow-up the agent could not be resumed for. */
  degraded: boolean
}

/** A reply to a card action or a tool call: a value the caller can act on, never a throw. */
export type SshEngineReply =
  | { ok: true; taskId: string; runId?: string; phase?: SshRunPhase; message?: string }
  | { ok: false; code: string; error: string }

/** One card's remote-run state, as a card surface or a model reads it. */
export interface SshRunStatusView {
  /** Card the view is about. */
  taskId: string
  /** Target the card pins, when it pins one. */
  target?: SshTarget
  /** Phase of the run in flight. */
  phase?: SshRunPhase
  /** Run in flight. */
  runId?: string
  /** Remote exit code, once the run settled. */
  exitCode?: number
  /** Bytes of the run's log the remote launcher reported. */
  bytes?: number
  /** Follow-up messages delivered into that run's session. */
  followUps?: number
  /** Session the run reported, usable to resume it. */
  sessionId?: string
  /** Summary the agent reported. */
  summary?: string
  /** Failure text, when the run failed. */
  error?: string
  /** Runs of this card that already settled, newest last. */
  history: SshRunRecord[]
  /** Whether an instruction waits for the next run. */
  pending?: 'follow-up' | 'rework'
}

/** One page of a run's log. */
export type SshLogPage =
  | { ok: true; taskId: string; runId: string; offset: number; nextOffset: number; bytes: number; eof: boolean; text: string }
  | { ok: false; code: string; error: string }

/** Bound one free-text field to the ledger's stored budget. */
function bound(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/** Keep the tail of a log, which is where an agent's final event is. */
function parseWindow(text: string): string {
  return text.length <= PARSE_WINDOW ? text : text.slice(text.length - PARSE_WINDOW)
}

/**
 * The command templates a target's agent runs with.
 *
 * A deployment's override wins over everything, because it exists precisely to
 * replace what this package would otherwise run. A custom agent carries its own
 * templates on the target; the three built-in CLIs have none.
 * @param agent - the agent the target pins.
 * @param settings - live configuration.
 * @returns the templates, or undefined when the built-in command line applies.
 */
export function agentTemplates(agent: SshAgentTarget, settings: SshProviderSettings): SshCustomTemplates | undefined {
  const override = settings.agentCommands[agent.kind]
  if (override !== undefined) return override
  if (agent.kind !== 'custom' || agent.command === undefined) return undefined
  return { command: agent.command, ...(agent.resumeCommand === undefined ? {} : { resumeCommand: agent.resumeCommand }) }
}

/**
 * Whether one agent can continue an earlier session.
 * @param kind - agent CLI kind.
 * @param templates - the templates it runs with, when it has any.
 * @returns true when a follow-up can resume instead of starting fresh.
 */
export function agentResumeSupported(kind: SshAgentKind, templates: SshCustomTemplates | undefined): boolean {
  if (templates !== undefined) return customResumeSupported(templates)
  return kind !== 'custom'
}

/**
 * The command line one run executes.
 *
 * A template — a custom agent's own, or a deployment's override for one of the
 * built-in CLIs — replaces the built-in command line entirely, because that is
 * what an override is for: the operator's own words, quoted by the template
 * builder. Without one the agent's own adapter answers.
 * @param input - run facts, including the session to resume when there is one.
 * @param templates - the templates this run executes with, when it has any.
 * @returns the quoted command line.
 */
export function agentCommandLine(input: SshAgentRunInput, templates: SshCustomTemplates | undefined): SshAgentCommand {
  return templates === undefined ? buildAgentCommandLine(input) : customAgentCommand(input, templates)
}

export class SshRunEngine {
  private readonly host: TaskBoardExtensionHost
  private readonly ssh: DshSshService
  private readonly timers: HostTimerFace
  private readonly settings: () => SshProviderSettings
  private readonly seat: (() => BoardActionSeat | undefined) | undefined
  private readonly workspaces: SshWorkspaceStrategyResolver | undefined
  private readonly localRepository: ((workspaceId: string) => string | undefined) | undefined
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly pollIntervalMs: number
  private readonly log: (message: string, detail?: unknown) => void
  private readonly remote: SshRemote
  /** Runs this process follows, keyed by card id: a card has at most one. */
  private readonly jobs = new Map<string, SshJob>()
  /** The last run known for a card, so a deleted card can still be cleaned up. */
  private readonly known = new Map<string, { alias: string; runId: string }>()
  /** Hosts whose admission pass is already running. */
  private readonly pumping = new Set<string>()
  /** Hosts that asked for another admission pass while one was running. */
  private readonly pumpAgain = new Set<string>()
  /** Cards whose settlement is in progress, so a board echo does not read as a cancel. */
  private readonly settling = new Set<string>()
  /** Runs a person asked to cancel, so their settlement writes no verdict. */
  private readonly cancelRequests = new Set<string>()
  /** The log windows this extension publishes; in memory, never in a payload. */
  private readonly logs = new SshLogWindows()
  private readonly disposers: Array<() => void> = []
  private pollCanceller: (() => void) | undefined
  private polling = false
  private disposed = false

  constructor(options: SshRunEngineOptions) {
    this.host = options.host
    this.ssh = options.ssh
    this.timers = options.timers
    this.settings = options.settings
    this.seat = options.seat
    this.workspaces = options.workspaces
    this.localRepository = options.localRepository
    this.now = options.now ?? (() => Date.now())
    this.uuid = options.uuid ?? (() => crypto.randomUUID())
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.log = options.log ?? ((message, detail) => {
      if (detail === undefined) console.error('[dsh-task-board-ssh] ' + message)
      else console.error('[dsh-task-board-ssh] ' + message, detail)
    })
    this.remote = new SshRemote(options.ssh, {
      ...(options.commandTimeoutMs === undefined ? {} : { timeoutMs: options.commandTimeoutMs }),
    })
  }

  /** Whether the extension is on. Read at use time, so a settings edit binds the next call. */
  enabled(): boolean {
    return this.settings().enabled
  }

  /**
   * Take over every launch the board routes to this extension, follow board
   * events, and reconcile what the previous process left in flight.
   */
  start(): void {
    if (this.disposed) return
    const launch = this.host.launch
    if (launch === undefined) {
      this.log('this board revision serves no launch interception, so a remote card cannot start; the tools still answer')
    } else {
      try {
        this.disposers.push(launch.intercept((task, context) => this.intercept(task, context)))
      } catch (error) {
        this.log('the launch handler could not be registered', error)
      }
    }
    this.disposers.push(this.host.events.onStatusChanged(event => { void this.onStatusChanged(event) }))
    this.disposers.push(this.host.events.onTaskDeleted(event => { void this.onTaskDeleted(event) }))
    this.pollCanceller = this.timers.interval(() => { void this.poll() }, this.pollIntervalMs)
    void this.reconcile().catch(error => { this.log('the reconciliation pass failed', error) })
  }

  /** Stop polling and forget what this process was following. No card data is touched. */
  stop(): void {
    this.disposed = true
    this.pollCanceller?.()
    this.pollCanceller = undefined
    for (const dispose of this.disposers.splice(0)) {
      try { dispose() } catch { /* best-effort */ }
    }
    this.jobs.clear()
    this.known.clear()
    this.pumping.clear()
    this.pumpAgain.clear()
    this.settling.clear()
    this.logs.clear()
    this.remote.forget()
  }

  /** The hosts this deployment can pin a card to; every field of one is secret-free. */
  hosts(): DshSshHost[] {
    try {
      return this.ssh.hosts.list()
    } catch (error) {
      this.log('the host inventory could not be read', error)
      return []
    }
  }

  /** Resolve one host by alias, or undefined when it is not configured. */
  hostByAlias(alias: string): DshSshHost | undefined {
    try {
      return this.ssh.hosts.find(alias)
    } catch {
      return undefined
    }
  }

  /** The card's payload, as this package reads it. */
  payloadOf(taskId: string): HostSshPayload | undefined {
    try {
      return readHostPayload(this.host.integration.read(taskId))
    } catch {
      return undefined
    }
  }

  /** The target a card pins, when it pins one. */
  targetOf(taskId: string): SshTarget | undefined {
    return this.payloadOf(taskId)?.target
  }

  /** One card's remote-run state. */
  status(taskId: string): SshRunStatusView {
    const payload = this.payloadOf(taskId)
    const view: SshRunStatusView = { taskId, history: payload?.history ?? [] }
    if (payload === undefined) return view
    if (payload.target !== undefined) view.target = payload.target
    if (payload.pending !== undefined) view.pending = payload.pending.kind
    const run = payload.activeRun
    if (run === undefined) return view
    view.phase = run.phase
    view.runId = run.runId
    if (run.exitCode !== undefined) view.exitCode = run.exitCode
    if (run.bytes !== undefined) view.bytes = run.bytes
    if (run.followUps !== undefined) view.followUps = run.followUps
    if (run.sessionId !== undefined) view.sessionId = run.sessionId
    if (run.summary !== undefined) view.summary = run.summary
    if (run.error !== undefined) view.error = run.error
    return view
  }

  /**
   * Pin (or replace) the target one card runs with.
   *
   * A target naming a host this deployment does not know is refused here instead
   * of failing the card much later with a connection error nobody can place.
   * @param taskId - card to retarget.
   * @param target - the target to pin.
   * @returns the reply the caller renders.
   */
  setTarget(taskId: string, target: SshTarget): SshEngineReply {
    const task = this.host.tasks.get(taskId)
    if (task === undefined) return { ok: false, code: 'task-not-found', error: `no task with id ${taskId}` }
    if (this.hostByAlias(target.host) === undefined) {
      return { ok: false, code: 'host-not-configured', error: `dsh-ssh has no host with alias "${target.host}"` }
    }
    const payload = this.payloadOf(taskId)
    const next: HostSshPayload = payload === undefined
      ? { updatedAt: this.now(), history: [], target }
      : { ...payload, target }
    if (!this.writePayload(taskId, next)) {
      return { ok: false, code: 'payload-refused', error: 'the board refused the target' }
    }
    this.publishSummary()
    return { ok: true, taskId, message: 'target pinned' }
  }

  /**
   * Start a card's pinned run now, through the board's own run action so the
   * card reaches the running column the same way the run button puts it there.
   * @param taskId - card to run.
   * @returns the reply the caller renders.
   */
  runNow(taskId: string): SshEngineReply {
    const target = this.targetOf(taskId)
    if (target === undefined) return { ok: false, code: 'no-target', error: `task ${taskId} pins no SSH target` }
    if (target.mode !== 'direct') {
      return { ok: false, code: 'proxy-mode', error: 'a proxy card runs in a local session: start it from the board, not from this tool' }
    }
    const seat = this.seat?.()
    if (seat === undefined) return { ok: false, code: 'board-unavailable', error: 'this board revision serves no action applier' }
    try {
      seat.apply(this.uuid(), { kind: 'run', taskId }, 'ssh')
    } catch (error) {
      return { ok: false, code: 'run-refused', error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true, taskId, message: 'run requested' }
  }

  /**
   * Queue one instruction for the card, and drive it into a run.
   *
   * While a run is in flight the instruction waits for the run to settle (there
   * is no channel into a detached remote process). On a settled card it re-enters
   * the launch interceptor through the board's own rerun action, which is what
   * puts the card back in the running column and lets the adapter choose between
   * continuing the session and starting fresh.
   * @param taskId - card to instruct.
   * @param text - the instruction.
   * @param kind - which entry asked.
   * @returns the reply the caller renders.
   */
  async instruct(taskId: string, text: string, kind: 'follow-up' | 'rework'): Promise<SshEngineReply> {
    const task = this.host.tasks.get(taskId)
    if (task === undefined) return { ok: false, code: 'task-not-found', error: `no task with id ${taskId}` }
    if (task.archivedAt !== undefined) return { ok: false, code: 'task-archived', error: `task ${taskId} is archived` }
    const payload = this.payloadOf(taskId)
    if (payload === undefined || payload.target === undefined) {
      return { ok: false, code: 'no-target', error: `task ${taskId} pins no SSH target` }
    }
    const trimmed = text.trim()
    if (trimmed === '') return { ok: false, code: 'empty-instruction', error: 'an instruction must not be blank' }
    const live = liveRunOf(payload)
    const previous = latestSessionId(payload)
    const pending: SshPendingInstruction = {
      kind,
      text: trimmed,
      queuedAt: this.now(),
      ...(previous === undefined ? {} : { resumeSessionId: previous }),
    }
    const next: HostSshPayload = live === undefined
      ? { ...payload, pending }
      : { ...payload, pending, activeRun: live === undefined ? payload.activeRun : { ...live, followUps: (live.followUps ?? 0) + 1 } }
    if (!this.writePayload(taskId, next)) {
      return { ok: false, code: 'payload-refused', error: 'the board refused the queued instruction' }
    }
    if (live !== undefined) {
      this.publishSummary()
      return { ok: true, taskId, runId: live.runId, phase: live.phase, message: 'queued behind the run in flight' }
    }
    const reentered = this.reenter(taskId, 'ssh-' + kind)
    if (!reentered.ok) return reentered
    return { ok: true, taskId, message: kind === 'rework' ? 'rework requested' : 'follow-up requested' }
  }

  /**
   * Cancel the card's active run and write no verdict.
   * @param taskId - card whose run to stop.
   * @returns the reply the caller renders.
   */
  cancel(taskId: string): SshEngineReply {
    const payload = this.payloadOf(taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (payload === undefined || run === undefined || target === undefined) {
      return { ok: false, code: 'no-run', error: `task ${taskId} has no remote run` }
    }
    if (isTerminalRunPhase(run.phase)) return { ok: false, code: 'no-run', error: `the run of task ${taskId} already settled` }
    void this.stopRun(taskId, payload, target, run).catch(error => { this.log('the cancel request failed', error) })
    return { ok: true, taskId, runId: run.runId, phase: 'cancelled', message: 'cancel requested' }
  }

  /**
   * Re-read remote state now instead of waiting for the next tick.
   * @param taskId - one card, or undefined for every card this mount follows.
   * @returns the reply the caller renders.
   */
  async refresh(taskId?: string): Promise<SshEngineReply> {
    if (taskId !== undefined) {
      // A viewer that just opened (or reopened) asks for this card, and the one
      // thing it cannot reconstruct is the beginning: the log is replayed from
      // byte zero into the next publish.
      await this.replayLog(taskId)
      const job = this.jobs.get(taskId)
      if (job !== undefined) await this.pollJob(job)
      this.publishSummary()
      return { ok: true, taskId, message: 'refreshed' }
    }
    await this.poll()
    for (const alias of this.aliasesInFlight()) await this.pump(alias)
    this.publishSummary()
    return { ok: true, taskId: '', message: 'refreshed every followed card' }
  }

  /**
   * Re-read one card's log from byte zero into the pending window.
   *
   * This is the viewer's replay: a card whose detail section is opened again
   * decodes the log from its first byte, without the provider having kept a copy
   * of it anywhere.
   * @param taskId - card whose run log to replay.
   */
  private async replayLog(taskId: string): Promise<void> {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    if (payload === undefined || target === undefined) return
    const run = payload.activeRun ?? payload.history[payload.history.length - 1]
    if (run === undefined) return
    try {
      const stateDir = await this.remote.stateDir(target.host)
      const page = await this.remote.tail({ alias: target.host, stateDir, runId: run.runId }, 0)
      this.logs.replay(taskId, run.runId, 0, page.text)
    } catch (error) {
      this.log(`the log of run ${run.runId} could not be replayed`, error)
    }
  }

  /**
   * Read one page of a run's log.
   *
   * The log is a remote file read by byte offset, never a stored payload: the
   * ledger keeps the account of a run, not its bytes.
   * @param taskId - card whose run's log to read.
   * @param options - run to read (defaults to the active one), offset and page size.
   * @returns the page, or the refusal that says why there is none.
   */
  async readLog(taskId: string, options: { runId?: string; offset?: number; limit?: number } = {}): Promise<SshLogPage> {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    if (payload === undefined || target === undefined) {
      return { ok: false, code: 'no-target', error: `task ${taskId} pins no SSH target` }
    }
    const runId = options.runId ?? payload.activeRun?.runId ?? payload.history[payload.history.length - 1]?.runId
    if (runId === undefined) return { ok: false, code: 'no-run', error: `task ${taskId} has never run remotely` }
    const offset = options.offset !== undefined && Number.isFinite(options.offset) && options.offset >= 0
      ? Math.trunc(options.offset)
      : 0
    const limit = options.limit !== undefined && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.trunc(options.limit), 128 * 1024)
      : 64 * 1024
    try {
      const stateDir = await this.remote.stateDir(target.host)
      const page = await this.remote.tail({ alias: target.host, stateDir, runId }, offset)
      const text = page.text.length <= limit ? page.text : page.text.slice(0, limit)
      const bytes = offset + new TextEncoder().encode(text).length
      return {
        ok: true,
        taskId,
        runId,
        offset,
        nextOffset: bytes,
        bytes,
        eof: text.length === page.text.length,
        text,
      }
    } catch (error) {
      return { ok: false, code: 'log-unavailable', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The document this extension publishes into the board snapshot. */
  summary(): Record<string, unknown> {
    return this.buildSummary().document
  }

  /**
   * Build the published document and the log windows it carries.
   *
   * The window section is the one unbounded part of this document, so it is
   * bounded here: SshLogWindows caps one card's window and the section as a
   * whole, and a document that still came out over the body budget drops the
   * section (every window then waits for the next publish rather than being
   * lost or overrunning the board's ceiling).
   * @returns the document and the cards whose window it delivered.
   */
  private buildSummary(): { document: Record<string, unknown>; delivered: string[] } {
    const settings = this.settings()
    let running = 0
    let queued = 0
    let targets = 0
    const runs: Array<Record<string, unknown>> = []
    let linked: readonly { task: TaskRecord; payload: Record<string, unknown> }[] = []
    try {
      linked = this.host.tasks.linked() as readonly { task: TaskRecord; payload: Record<string, unknown> }[]
    } catch {
      linked = []
    }
    for (const entry of linked) {
      const payload = readHostPayload(entry.payload)
      if (payload?.target === undefined) continue
      targets += 1
      const run = payload.activeRun
      if (run?.phase === 'running') running += 1
      if (run?.phase === 'queued') queued += 1
      if (run !== undefined && runs.length < 20) {
        runs.push({
          taskId: entry.task.id,
          runId: run.runId,
          phase: run.phase,
          host: payload.target.host,
          ...(run.bytes === undefined ? {} : { bytes: run.bytes }),
        })
      }
    }
    const delivery = this.logs.take()
    const document: Record<string, unknown> = {
      defaults: {
        host: settings.defaultHost,
        agent: settings.defaultAgent,
        mode: settings.defaultMode,
        perHostCap: settings.perHostCap,
      },
      targets,
      running,
      queued,
      runs,
      hosts: this.hosts().slice(0, 50).map(host => ({ alias: host.alias, host: host.host, user: host.user })),
      ...(Object.keys(delivery.logs).length === 0 ? {} : { logs: delivery.logs }),
    }
    if (byteLength(JSON.stringify(document)) > PUBLISH_BODY_LIMIT_BYTES) {
      delete document.logs
      return { document, delivered: [] }
    }
    return { document, delivered: delivery.delivered }
  }

  // --- launch interception -----------------------------------------------------

  /**
   * The board's launch gate for one card.
   *
   * Synchronous by contract: the run it opens is recorded here and started on
   * the next microtask, because the ledger commits the running column after this
   * handler returns and a payload write made inside it would be overwritten.
   */
  private intercept(task: TaskRecord, _context: TaskBoardLaunchContext): TaskBoardLaunchDecision | undefined {
    if (this.disposed || !this.enabled()) return undefined
    const payload = readHostPayload(task.integrations?.[SSH_INTEGRATION_KEY])
    const target = payload?.target
    if (payload === undefined || target === undefined) return undefined
    const seat = this.seat?.()
    if (target.mode === 'proxy') return { kind: 'local', promptPreamble: proxyPreamble(task, target) }
    if (this.host.launch === undefined || seat === undefined) {
      this.log(`task ${task.id} pins a remote host but this board revision serves no launch interception or action applier, so it runs nowhere`)
      return undefined
    }
    void this.openRun(task.id, target.host).catch(error => { this.log(`the remote run of task ${task.id} could not be opened`, error) })
    return { kind: 'external' }
  }

  /** Queue one run for a card the board just decided to hand over. */
  private async openRun(taskId: string, alias: string): Promise<void> {
    // The ledger commits the running column after the handler returns: writing
    // the payload before that commit would be overwritten by it.
    await Promise.resolve()
    if (this.disposed) return
    const task = this.host.tasks.get(taskId)
    if (task === undefined) return
    const payload = this.payloadOf(taskId)
    if (payload?.target === undefined) return
    const live = liveRunOf(payload)
    if (live !== undefined) return
    const run: SshRunRecord = { runId: this.newRunId(), phase: 'queued', startedAt: this.now() }
    this.known.set(taskId, { alias, runId: run.runId })
    if (!this.writePayload(taskId, { ...payload, activeRun: run })) return
    await this.pump(alias)
    this.publishSummary()
  }

  // --- admission ---------------------------------------------------------------

  /** The aliases this mount currently has work for. */
  private aliasesInFlight(): string[] {
    const aliases = new Set<string>()
    for (const entry of this.linkedEntries()) {
      const target = entry.payload?.target
      if (target === undefined) continue
      if (liveRunOf(entry.payload as HostSshPayload) === undefined) continue
      aliases.add(target.host)
    }
    return [...aliases]
  }

  /** Every linked card with the payload this package understands. */
  private linkedEntries(): Array<{ task: TaskRecord; payload: HostSshPayload | undefined }> {
    let linked: readonly { task: TaskRecord; payload: Record<string, unknown> }[] = []
    try {
      linked = this.host.tasks.linked() as readonly { task: TaskRecord; payload: Record<string, unknown> }[]
    } catch (error) {
      this.log('the linked cards could not be read', error)
      return []
    }
    return linked.map(entry => ({ task: entry.task, payload: readHostPayload(entry.payload) }))
  }

  /** Admit queued runs on one host until its ceiling is reached. */
  private async pump(alias: string): Promise<void> {
    if (this.disposed) return
    if (this.pumping.has(alias)) {
      this.pumpAgain.add(alias)
      return
    }
    this.pumping.add(alias)
    try {
      do {
        this.pumpAgain.delete(alias)
        await this.admit(alias)
      } while (this.pumpAgain.has(alias) && !this.disposed)
    } finally {
      this.pumping.delete(alias)
    }
  }

  /** One admission pass over one host. */
  private async admit(alias: string): Promise<void> {
    const cap = this.settings().perHostCap
    const queued: SshQueueEntry[] = []
    let running = 0
    for (const entry of this.linkedEntries()) {
      const target = entry.payload?.target
      const run = entry.payload?.activeRun
      if (target === undefined || run === undefined || target.host !== alias) continue
      this.known.set(entry.task.id, { alias, runId: run.runId })
      if (run.phase === 'running') {
        running += 1
        this.logs.adopt(entry.task.id, run.runId, run.bytes ?? 0)
        if (!this.jobs.has(entry.task.id)) {
          this.jobs.set(entry.task.id, { taskId: entry.task.id, runId: run.runId, alias, failures: 0, degraded: false })
        }
        continue
      }
      if (run.phase === 'queued') queued.push({ taskId: entry.task.id, runId: run.runId, startedAt: run.startedAt })
    }
    const admission = admitRuns(queued, running, cap)
    for (const entry of admission.start) {
      void this.startRun(alias, entry.taskId, entry.runId).catch(error => {
        this.log(`the run ${entry.runId} of task ${entry.taskId} could not be started`, error)
      })
    }
  }

  /** Prepare and start one admitted run. */
  private async startRun(alias: string, taskId: string, runId: string): Promise<void> {
    if (this.disposed) return
    const task = this.host.tasks.get(taskId)
    const payload = this.payloadOf(taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (task === undefined || payload === undefined || run === undefined || target === undefined) return
    if (run.runId !== runId || run.phase !== 'queued') return
    const settings = this.settings()
    const job: SshJob = { taskId, runId, alias, failures: 0, degraded: false }
    this.jobs.set(taskId, job)
    this.logs.adopt(taskId, runId, run.bytes ?? 0)
    // The slot is taken before any remote work: a concurrent admission sees a
    // running run instead of starting the same card twice.
    this.writePayload(taskId, withActiveRun(payload, { ...run, phase: 'running' }))
    const templates = agentTemplates(target.agent, settings)
    const pending = payload.pending
    const resumeSession = pending === undefined ? undefined : pending.resumeSessionId ?? latestSessionId(payload)
    const resumed = pending !== undefined && resumeSession !== undefined && agentResumeSupported(target.agent.kind, templates)
    job.degraded = pending !== undefined && !resumed
    try {
      const stateDir = await this.remote.stateDir(alias)
      await this.remote.installLauncher({ alias, stateDir })
      const prepared = await this.prepareWorkspace(target, runId)
      const promptFile = runFilePath(stateDir, runId, 'prompt.txt')
      const input: SshAgentRunInput = {
        agent: target.agent.kind,
        promptFile,
        cwd: prepared,
        ...(resumed && resumeSession !== undefined ? { resumeSessionId: resumeSession } : {}),
      }
      const command = agentCommandLine(input, templates)
      const prompt = runPrompt(task, pending, this.previousSummary(payload), resumed)
      await this.remote.writeRunFiles({ alias, stateDir, runId }, {
        prompt,
        command,
        cwd: prepared,
        spec: {
          runId,
          taskId,
          host: alias,
          mode: target.mode,
          agent: target.agent.kind,
          workspace: target.workspace.kind,
          resumed,
          degraded: job.degraded,
          startedAt: run.startedAt,
        },
      })
      let status = await this.remote.start({ alias, stateDir, runId })
      if (status.state !== 'running' && status.state !== 'exited') {
        // A second starter that loses the race for the run's lock answers
        // "lost" even though the run it was racing is alive, so an inconclusive
        // answer is confirmed once before this card is told nothing started.
        // A run that really died stays lost: its pid is gone and it recorded no
        // exit, which the same read reports.
        try {
          status = await this.remote.status({ alias, stateDir, runId })
        } catch (error) {
          this.log(`the state of run ${runId} could not be confirmed after an inconclusive start`, error)
        }
      }
      const current = this.payloadOf(taskId)
      if (current?.activeRun?.runId !== runId) return
      if (status.state === 'running' || status.state === 'exited') {
        this.writePayload(taskId, {
          ...current,
          activeRun: { ...(current.activeRun as SshRunRecord), phase: 'running', ...(status.bytes === undefined ? {} : { bytes: status.bytes }) },
          pending: undefined,
        })
      } else {
        await this.settle(taskId, job, status)
      }
    } catch (error) {
      this.log(`the run ${runId} of task ${taskId} could not be prepared on ${alias}`, error)
      await this.settle(taskId, job, { state: 'lost' }, error)
    }
    this.publishSummary()
  }

  /** Resolve the run's working directory through its placement strategy. */
  private async prepareWorkspace(target: SshTarget, runId: string): Promise<string> {
    const strategy = this.strategyFor(target)
    const prepared = await strategy.prepare(await this.workspaceRun(target, runId))
    if (typeof prepared.cwd !== 'string' || !prepared.cwd.startsWith('/')) {
      throw new Error(`the ${target.workspace.kind} workspace strategy returned no absolute working directory`)
    }
    return prepared.cwd
  }

  /** The strategy one target's workspace runs through, or a diagnosable refusal. */
  private strategyFor(target: SshTarget): SshWorkspaceStrategy {
    const strategy = this.workspaces?.(target.workspace)
    if (strategy === undefined) {
      throw new Error(`this deployment serves no workspace strategy for "${target.workspace.kind}", so the run has nowhere to work`)
    }
    return strategy
  }

  /** Everything a placement strategy needs about one run. */
  private async workspaceRun(target: SshTarget, runId: string): Promise<SshWorkspaceRun> {
    const run: SshWorkspaceRun = {
      runId,
      host: target.host,
      stateDir: await this.remote.stateDir(target.host),
      ssh: this.ssh,
    }
    if (target.workspace.kind === 'git') {
      const source = target.workspace.source
      run.source = source
      if (source.kind === 'workspace') {
        const repository = this.localRepository?.(source.workspaceId)
        if (repository !== undefined && repository !== '') run.localRepository = repository
      }
    }
    return run
  }

  // --- polling -----------------------------------------------------------------

  /** One poll pass over every run this process follows. */
  private async poll(): Promise<void> {
    if (this.disposed || this.polling) return
    this.polling = true
    try {
      for (const job of [...this.jobs.values()]) {
        if (this.disposed) return
        await this.pollJob(job)
      }
    } finally {
      this.polling = false
      this.publishSummary()
    }
  }

  /** Read one run's remote state and act on it. */
  private async pollJob(job: SshJob): Promise<void> {
    const task = this.host.tasks.get(job.taskId)
    const payload = task === undefined ? undefined : this.payloadOf(job.taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (task === undefined || payload === undefined || run === undefined || target === undefined || run.runId !== job.runId) {
      this.jobs.delete(job.taskId)
      return
    }
    let status: LauncherStatus
    try {
      const stateDir = await this.remote.stateDir(target.host)
      status = await this.remote.status({ alias: target.host, stateDir, runId: run.runId })
    } catch (error) {
      job.failures += 1
      this.log(`the state of run ${run.runId} could not be read (${String(job.failures)} in a row)`, error)
      if (job.failures >= LOST_AFTER_FAILURES) await this.settle(job.taskId, job, { state: 'lost' })
      return
    }
    job.failures = 0
    if (status.state === 'running') {
      const bytes = status.bytes ?? run.bytes
      if (bytes !== undefined && bytes !== run.bytes) {
        const current = this.payloadOf(job.taskId)
        if (current?.activeRun?.runId === run.runId) this.writePayload(job.taskId, withActiveRun(current, { ...run, bytes }))
      }
      await this.readLogIncrement(job.taskId, target, run, bytes ?? 0)
      return
    }
    if (status.state === 'unknown') {
      job.failures += 1
      this.log(`the launcher answered run ${run.runId} with something this build does not read`)
      if (job.failures >= LOST_AFTER_FAILURES) await this.settle(job.taskId, job, { state: 'lost' })
      return
    }
    await this.settle(job.taskId, job, status)
  }

  /**
   * Read whatever the run's log gained since the last read and hold it for the
   * next publish.
   *
   * The bytes never touch the card: the window lives in memory until a publish
   * hands it to the browser, which is the only channel that carries them.
   * @param taskId - card the run belongs to.
   * @param target - the target the card pins.
   * @param run - the run in flight.
   * @param remoteBytes - log size the launcher just reported.
   */
  private async readLogIncrement(taskId: string, target: SshTarget, run: SshRunRecord, remoteBytes: number): Promise<void> {
    const cursor = this.logs.cursor(taskId, run.runId) ?? run.bytes ?? 0
    if (remoteBytes <= cursor) return
    try {
      const stateDir = await this.remote.stateDir(target.host)
      const page = await this.remote.tail({ alias: target.host, stateDir, runId: run.runId }, cursor)
      if (page.text !== '') this.logs.push(taskId, run.runId, cursor, page.text)
    } catch (error) {
      this.log(`the log of run ${run.runId} could not be read`, error)
    }
  }

  // --- settlement --------------------------------------------------------------

  /**
   * Close one run: read what it produced, put its verdict on the card exactly
   * once, and hand the card's next instruction (if any) back to the launch gate.
   */
  private async settle(taskId: string, job: SshJob, status: LauncherStatus, failure?: unknown): Promise<void> {
    this.jobs.delete(taskId)
    this.settling.add(taskId)
    try {
      const task = this.host.tasks.get(taskId)
      const payload = this.payloadOf(taskId)
      const run = payload?.activeRun
      const target = payload?.target
      if (task === undefined || payload === undefined || run === undefined || target === undefined || run.runId !== job.runId) return
      const cancelled = this.cancelRequested(target.host, run.runId) || status.state === 'cancelled'
      let text = ''
      let bytes = run.bytes ?? 0
      try {
        const stateDir = await this.remote.stateDir(target.host)
        const page = await this.remote.tail({ alias: target.host, stateDir, runId: run.runId }, 0)
        text = page.text
        bytes = page.bytes
      } catch (error) {
        this.log(`the log of run ${run.runId} could not be read`, error)
      }
      // The whole log was just read for parsing; whatever the browser has not
      // been given yet continues the pending window, contiguously.
      const cursor = this.logs.cursor(taskId, run.runId) ?? 0
      if (text !== '' && byteLength(text) > cursor) {
        this.logs.push(taskId, run.runId, cursor, sliceFromByte(text, cursor))
      }
      const parsed = readAgentOutput({ agent: target.agent.kind, promptFile: '', cwd: '' }, parseWindow(text))
      const branch = cancelled ? undefined : await this.collectWorkspace(target, run.runId)
      const phase = this.phaseOf(cancelled, status, parsed.outcome)
      const summary = parsed.outcome?.ok === true ? bound(parsed.outcome.text, SSH_SUMMARY_MAX_LENGTH) : undefined
      const error = cancelled
        ? undefined
        : parsed.outcome !== undefined && !parsed.outcome.ok
          ? bound(parsed.outcome.error, SSH_ERROR_MAX_LENGTH)
          : status.state === 'lost' || status.state === 'missing'
            ? `the remote run disappeared: ${failure === undefined ? 'its process and its exit record were both gone' : bound(failure instanceof Error ? failure.message : String(failure), SSH_ERROR_MAX_LENGTH)}`
            : phase === 'failed'
              ? bound(`the remote agent exited with code ${String(status.exitCode ?? 'none')}`, SSH_ERROR_MAX_LENGTH)
              : undefined
      const settled: SshRunRecord = {
        runId: run.runId,
        phase,
        startedAt: run.startedAt,
        finishedAt: this.now(),
        bytes,
        ...(status.exitCode === undefined ? {} : { exitCode: status.exitCode }),
        ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
        ...(branch === undefined ? {} : { branch }),
        ...(run.followUps === undefined ? {} : { followUps: run.followUps }),
        ...(summary === undefined ? {} : { summary }),
        ...(error === undefined ? {} : { error }),
      }
      this.recordOutcome(task, settled, job.degraded)
      const current = this.payloadOf(taskId)
      if (current !== undefined) this.writePayload(taskId, withSettledRun(current, settled))
      if (!cancelled && current?.pending !== undefined) this.reenter(taskId, 'ssh-follow-up')
      if (!cancelled) await this.pump(target.host)
    } finally {
      this.settling.delete(taskId)
      this.publishSummary()
    }
  }

  /** The phase one settled run reaches. */
  private phaseOf(cancelled: boolean, status: LauncherStatus, outcome: { ok: boolean } | undefined): SshRunPhase {
    if (cancelled) return 'cancelled'
    if (status.state === 'lost' || status.state === 'missing' || status.state === 'not-running' || status.state === 'unknown') return 'lost'
    if (outcome !== undefined && !outcome.ok) return 'failed'
    if (status.state === 'exited' && status.exitCode === 0) return 'succeeded'
    return 'failed'
  }

  /** Put one settled run's verdict on the card, exactly once. */
  private recordOutcome(task: TaskRecord, run: SshRunRecord, degraded: boolean): void {
    if (run.phase === 'cancelled') return
    if (alreadyRecorded(task, run.runId)) return
    const seat = this.seat?.()
    if (seat === undefined) {
      this.log(`the verdict of run ${run.runId} has nowhere to go: this board revision serves no action applier`)
      return
    }
    const text = run.summary ?? run.error
    const summary = text === undefined ? undefined : bound(degraded ? SSH_DEGRADED_SUMMARY_MARKER + ' ' + text : text, SSH_SUMMARY_MAX_LENGTH)
    try {
      seat.apply(this.uuid(), {
        kind: 'record-external-outcome',
        taskId: task.id,
        result: run.phase === 'succeeded' ? 'succeeded' : 'failed',
        initiatedBy: SSH_INITIATOR_PREFIX + run.runId,
        ...(summary === undefined ? {} : { summary }),
      }, 'ssh')
    } catch (error) {
      this.log(`the board refused the verdict of run ${run.runId}`, error)
    }
  }

  /** Bring back whatever the run's workspace strategy produced. */
  private async collectWorkspace(target: SshTarget, runId: string): Promise<string | undefined> {
    const strategy = this.workspaces?.(target.workspace)
    if (strategy === undefined) return undefined
    try {
      const collection: SshWorkspaceCollection = await strategy.collect(await this.workspaceRun(target, runId))
      return collection.branch
    } catch (error) {
      this.log(`the result of run ${runId} could not be collected`, error)
      return undefined
    }
  }

  /** The summary the card's previous run reported, for a run that cannot resume. */
  private previousSummary(payload: HostSshPayload): string | undefined {
    for (let index = payload.history.length - 1; index >= 0; index -= 1) {
      const record = payload.history[index]
      const text = record?.summary ?? record?.error
      if (text !== undefined && text !== '') return text
    }
    return undefined
  }

  // --- cancellation and deletion ----------------------------------------------

  /**
   * A card that left the running column while its run is live is a cancel
   * request: the remote process is stopped and no verdict is written, because
   * the person moved the card, the person decides what the card says.
   */
  private async onStatusChanged(event: TaskBoardStatusChangedEvent): Promise<void> {
    if (this.disposed || event.previous !== 'running') return
    if (this.settling.has(event.taskId)) return
    const task = this.host.tasks.get(event.taskId)
    if (task === undefined) return
    const payload = this.payloadOf(event.taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (payload === undefined || run === undefined || target === undefined) return
    if (isTerminalRunPhase(run.phase)) return
    if (alreadyRecorded(task, run.runId)) return
    await this.stopRun(event.taskId, payload, target, run)
  }

  /** Cancel one live run, drop any instruction it owed, and write no verdict. */
  private async stopRun(taskId: string, payload: HostSshPayload, target: SshTarget, run: SshRunRecord): Promise<void> {
    this.jobs.delete(taskId)
    this.cancelRequests.add(target.host + '/' + run.runId)
    const cancelled: SshRunRecord = {
      runId: run.runId,
      phase: 'cancelled',
      startedAt: run.startedAt,
      finishedAt: this.now(),
      ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
      ...(run.bytes === undefined ? {} : { bytes: run.bytes }),
      ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    }
    const next = withSettledRun(payload, cancelled)
    delete next.pending
    this.writePayload(taskId, next)
    if (run.phase === 'running') {
      try {
        const stateDir = await this.remote.stateDir(target.host)
        await this.remote.cancel({ alias: target.host, stateDir, runId: run.runId })
      } catch (error) {
        this.log(`the remote run ${run.runId} could not be cancelled`, error)
      }
    }
    this.publishSummary()
  }

  /** A deleted card takes its remote run directory with it. */
  private async onTaskDeleted(event: TaskBoardTaskDeletedEvent): Promise<void> {
    if (this.disposed) return
    const known = this.known.get(event.taskId) ?? this.jobs.get(event.taskId)
    this.known.delete(event.taskId)
    this.jobs.delete(event.taskId)
    if (known === undefined) return
    try {
      const stateDir = await this.remote.stateDir(known.alias)
      try {
        await this.remote.cancel({ alias: known.alias, stateDir, runId: known.runId })
      } catch (error) {
        // A run that already settled has nothing to cancel; the directory below
        // still has to go, so the refusal is logged and not acted on.
        this.log(`the run ${known.runId} of the deleted task ${event.taskId} could not be cancelled`, error)
      }
      await this.remote.removeRun({ alias: known.alias, stateDir, runId: known.runId })
    } catch (error) {
      this.log(`the remote run directory of the deleted task ${event.taskId} could not be removed`, error)
    }
  }

  /** Put a card's waiting instruction back through the board's own rerun action. */
  private reenter(taskId: string, initiator: string): SshEngineReply {
    const seat = this.seat?.()
    if (seat === undefined) return { ok: false, code: 'board-unavailable', error: 'this board revision serves no action applier' }
    try {
      seat.apply(this.uuid(), { kind: 'rerun', taskId }, initiator)
      return { ok: true, taskId, message: 'run requested' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`task ${taskId} could not be sent back into its intercepting run`, error)
      return { ok: false, code: 'rerun-refused', error: message }
    }
  }

  // --- reconciliation ----------------------------------------------------------

  /**
   * Pick up what the previous process left behind: a queued run is served in
   * its place in the queue, a running one is polled at once (that is how a run
   * that finished while this Host was down is recorded, once), and a run whose
   * verdict never reached the board is recorded before anything else.
   */
  private async reconcile(): Promise<void> {
    if (this.disposed) return
    const aliases = new Set<string>()
    for (const entry of this.linkedEntries()) {
      const target = entry.payload?.target
      const run = entry.payload?.activeRun
      if (entry.payload === undefined || target === undefined || run === undefined) continue
      aliases.add(target.host)
      this.known.set(entry.task.id, { alias: target.host, runId: run.runId })
      if (run.phase === 'queued') continue
      if (!isTerminalRunPhase(run.phase)) {
        this.jobs.set(entry.task.id, { taskId: entry.task.id, runId: run.runId, alias: target.host, failures: 0, degraded: false })
        this.logs.adopt(entry.task.id, run.runId, run.bytes ?? 0)
        continue
      }
      // A verdict written before a crash but never moved into the history: it is
      // recorded here (idempotently) and the payload is folded afterwards.
      this.recordOutcome(entry.task, run, false)
      this.writePayload(entry.task.id, withSettledRun(entry.payload, run))
    }
    await this.poll()
    for (const alias of aliases) await this.pump(alias)
  }

  // --- shared plumbing ---------------------------------------------------------

  /** Write one card's payload, tolerating a card that vanished under us. */
  private writePayload(taskId: string, next: HostSshPayload): boolean {
    try {
      this.host.integration.write(taskId, writeHostPayload(next, this.now()))
      return true
    } catch (error) {
      this.log(`the payload of task ${taskId} was refused`, error)
      return false
    }
  }

  /** Publish (or refresh) this extension's summary in the board snapshot. */
  private publishSummary(): void {
    if (this.disposed) return
    const { document, delivered } = this.buildSummary()
    try {
      this.host.publish(document)
    } catch (error) {
      // A refused publish is not a lost window: nothing was delivered, so the
      // next publish carries it again.
      this.log('the summary was refused', error)
      return
    }
    this.logs.markDelivered(delivered)
  }

  /** A run id the remote launcher accepts, ordered by the instant it was requested. */
  private newRunId(): string {
    return 'run-' + this.now().toString(36) + '-' + this.uuid().replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  }

  /** Whether a person asked for this run to stop. */
  private cancelRequested(alias: string, runId: string): boolean {
    return this.cancelRequests.has(alias + '/' + runId)
  }
}
