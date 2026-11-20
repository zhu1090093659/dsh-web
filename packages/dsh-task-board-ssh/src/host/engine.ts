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
import { REMOTE_STATE_SUFFIX, runFilePath, type LauncherStatus } from '../core/launcher.ts'
import { isTerminalRunPhase, type SshAgentKind, type SshAgentTarget, type SshRunPhase, type SshRunRecord, type SshTarget } from '../core/target.ts'
import type { TaskRecord } from '../core/task-record.ts'
import type { SshWorkspaceCollection, SshWorkspaceRun, SshWorkspaceStrategy } from '../core/workspace.ts'
import { SSH_INITIATOR_PREFIX, alreadyRecorded, type BoardActionSeat } from './board.ts'
import {
  SSH_INTEGRATION_KEY,
  findRun,
  latestSessionId,
  liveRunOf,
  readHostPayload,
  withActiveRun,
  withSettledRun,
  writeHostPayload,
  type HostSshPayload,
  type SshPendingInstruction,
} from './payload.ts'
import { LOG_WINDOW_BUDGET_BYTES, PUBLISH_BODY_LIMIT_BYTES, SshLogWindows, byteLength, sliceFromByte, takeWithinBudget } from './logs.ts'
import { SSH_DEGRADED_SUMMARY_MARKER, proxyPreamble, runPrompt } from './prompt.ts'
import { admitRuns, type SshQueueEntry } from './queue.ts'
import { SshRemote } from './remote.ts'
import {
  agentProgram,
  lastActivity,
  logCommand,
  preflightCommand,
  readLogAnswer,
  readPreflight,
  tailStart,
  type SshActivity,
  type SshLogQuery,
  type SshLogStats,
  type SshPreflightFailure,
} from './inspect.ts'
import type { SshProviderSettings } from './settings.ts'
import type { HostTimerFace } from './timers.ts'
import { readUntrackedFiles, untrackedNote, type SshWorkspaceStrategyResolver } from './workspace-seam.ts'

/** Poll cadence when a deployment configures none, in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 2_000

/** Consecutive unreadable polls after which a run is recorded as lost. */
export const LOST_AFTER_FAILURES = 3

/** Expected run length when no earlier run says better, in milliseconds. */
export const DEFAULT_ESTIMATED_DURATION_MS = 180_000

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
  /** Wait source for a blocking status call; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
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
  /** Target pinned when the run started (immutable for the life of this run). */
  target: SshTarget
  /** Worktree run id this run owns (reused from an earlier run on git follow-up/rework). */
  workspaceRunId: string
  /** Cancellation signal wired into workspace preparation and checked around remote start. */
  abort: AbortController
  /** Consecutive polls that produced no usable answer. */
  failures: number
  /** Whether this run carries a follow-up the agent could not be resumed for. */
  degraded: boolean
  /**
   * Whether this process is still preparing the run's remote side.
   *
   * The job is registered and the card enters the running column before the
   * remote directory exists, because a concurrent admission must see the slot
   * taken. A poll that lands in that window reads "no such run" from a host
   * whose directory has not been written yet, which is not a lost run: the
   * start owns the verdict until it has an answer of its own.
   */
  starting: boolean
}

/** Remote runs and git target remembered per card so card deletion cleans up everything. */
interface KnownTaskRuns {
  alias: string
  target?: SshTarget
  runIds: Set<string>
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

/** A target as the agent-facing views report it. */
export interface SshTargetView {
  host: string
  agent: SshAgentKind
  mode: 'direct' | 'proxy'
  workspaceKind: 'in-place' | 'git'
  workspacePath?: string
}

/** The one shape a run is reported in, running or settled; absent facts are null. */
export interface SshStatusView {
  taskId: string
  target: SshTargetView | null
  /** `none` before any run, otherwise the run's phase; never missing. */
  phase: SshRunPhase | 'none'
  /** Whether the run reached a terminal phase and its verdict is recorded. */
  settled: boolean
  runId: string | null
  executionId: string | null
  exitCode: number | null
  /** The verdict once settled (succeeded, failed, cancelled, lost); null while running. */
  result: SshRunPhase | null
  /** What the agent reported on success. */
  summary: string | null
  /** The failure only: code, message and a retry hint. */
  error: { code: string; message: string; retryHint: string } | null
  durationMs: number | null
  remoteSessionId: string | null
  lastActivityAt: number | null
  bytes: number | null
  pendingInstruction: 'follow-up' | 'rework' | null
}

/** One filtered page of a run's log, or the refusal that says why there is none. */
export type SshLogReply =
  | {
      ok: true
      runId: string
      filtered: boolean
      stats: SshLogStats
      /** First filtered line in `text`, 1-based. */
      from: number
      lines: number
      /** Pass as `since` to continue where this page ended. */
      nextSince: number
      more: boolean
      text: string
    }
  | { ok: false; code: string; error: string }

/** The target as a model reads it. */
function targetView(target: SshTarget): SshTargetView {
  return {
    host: target.host,
    agent: target.agent.kind,
    mode: target.mode,
    workspaceKind: target.workspace.kind,
    ...(target.workspace.kind === 'in-place' ? { workspacePath: target.workspace.path } : {}),
  }
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

/** Stable code of a failed run, from what the launcher and the agent reported. */
function failureCode(phase: SshRunPhase, status: LauncherStatus, collection: boolean, thrown: boolean): string {
  if (thrown) return 'run-error'
  if (collection) return 'collection-failed'
  if (phase === 'lost') return 'run-lost'
  if (status.exitCode !== undefined && status.exitCode !== 0) return 'agent-exit'
  return 'agent-error'
}

/** One sentence on whether and how to retry a failed run. */
function retryHintFor(code: string): string {
  switch (code) {
    case 'agent-exit': return 'Read the log tail (task_board_ssh action "log"), fix the cause, then run again; a follow-up resumes the same remote session.'
    case 'run-lost': return 'The remote process vanished (host restart or kill); running again starts a fresh run.'
    case 'collection-failed': return 'The agent finished but its result could not be brought back; the remote branch or directory still holds the work.'
    case 'run-error': return 'The run could not be driven (see the error text); retry once the host is reachable.'
    default: return 'Read the log tail for the agent error, then run again or send a follow-up.'
  }
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
  private readonly sleep: (ms: number) => Promise<void>
  /** Ids handed out at launch, keyed by card, until the run record takes them over. */
  private readonly reserved = new Map<string, { runId: string; executionId: string; startedAt: number }>()
  private readonly log: (message: string, detail?: unknown) => void
  private readonly remote: SshRemote
  /** Runs this process follows, keyed by card id: a card has at most one. */
  private readonly jobs = new Map<string, SshJob>()
  /** Known runs per card (including pre-restart history), so card deletion cleans up all remote dirs/worktrees. */
  private readonly known = new Map<string, KnownTaskRuns>()
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
  /**
   * Local files one live run did not receive, keyed by card id.
   *
   * A workspace detail, not a run fact: the frozen run record has no member for
   * it and the ledger keeps the account of runs, so it is carried here from the
   * moment the workspace is prepared until the verdict is written. A Host that
   * restarts mid-run no longer knows it, and that run's verdict then says only
   * what the agent itself reported.
   */
  private readonly untracked = new Map<string, { runId: string; files: number }>()
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
    this.sleep = options.sleep ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms) }))
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
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear()
    this.known.clear()
    this.pumping.clear()
    this.pumpAgain.clear()
    this.settling.clear()
    this.reserved.clear()
    this.untracked.clear()
    this.logs.clear()
    this.remote.forget()
  }

  /**
   * React to a volatile settings update (for example raising `perHostCap` or
   * changing defaults): pump every host with waiting runs and publish the new summary.
   */
  onSettingsUpdated(): void {
    if (this.disposed || !this.enabled()) return
    for (const alias of this.aliasesInFlight()) {
      void this.pump(alias).catch(error => { this.log(`admission pump after settings update failed for ${alias}`, error) })
    }
    this.publishSummary()
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

  // --- agent-facing views --------------------------------------------------------

  /**
   * One card's run in a single shape, whether it is still running or settled.
   *
   * The active run wins; with none, the newest settled one answers, so the same
   * fields exist before and after the run ends and `phase` is never missing.
   * Absent facts are `null`, never undefined, so a caller reads one schema.
   * @param taskId - card to read.
   * @returns the uniform view.
   */
  statusView(taskId: string): SshStatusView {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    const empty: SshStatusView = {
      taskId,
      target: target === undefined ? null : targetView(target),
      phase: 'none',
      settled: false,
      runId: null,
      executionId: null,
      exitCode: null,
      result: null,
      summary: null,
      error: null,
      durationMs: null,
      remoteSessionId: null,
      lastActivityAt: null,
      bytes: null,
      pendingInstruction: payload?.pending?.kind ?? null,
    }
    if (payload === undefined) return empty
    const reservation = this.reserved.get(taskId)
    if (reservation !== undefined && payload.activeRun === undefined) {
      return { ...empty, phase: 'queued', runId: reservation.runId, executionId: reservation.executionId, durationMs: this.now() - reservation.startedAt, lastActivityAt: reservation.startedAt }
    }
    const run = payload.activeRun ?? payload.history[payload.history.length - 1]
    if (run === undefined) return empty
    const settled = isTerminalRunPhase(run.phase) && !this.settling.has(taskId)
    const phase: SshRunPhase | 'settling' = !settled && isTerminalRunPhase(run.phase) ? 'running' : run.phase
    return {
      ...empty,
      phase,
      settled,
      runId: run.runId,
      executionId: run.executionId ?? null,
      exitCode: run.exitCode ?? null,
      result: settled ? run.phase : null,
      summary: run.summary ?? null,
      error: run.error === undefined
        ? null
        : { code: run.errorCode ?? 'agent-error', message: run.error, retryHint: retryHintFor(run.errorCode ?? 'agent-error') },
      durationMs: (run.finishedAt ?? this.now()) - run.startedAt,
      remoteSessionId: run.sessionId ?? null,
      lastActivityAt: run.lastActivityAt ?? run.finishedAt ?? run.startedAt,
      bytes: run.bytes ?? null,
    }
  }

  /**
   * Block until the card's run settles or the wait runs out.
   * @param taskId - card to wait on.
   * @param timeoutMs - longest wait, clamped to ten minutes.
   * @returns the uniform view and whether the wait ran out.
   */
  async waitStatus(taskId: string, timeoutMs = 120_000): Promise<{ view: SshStatusView; timedOut: boolean }> {
    const limit = Math.max(0, Math.min(Math.trunc(timeoutMs), 10 * 60_000))
    const deadline = this.now() + limit
    for (;;) {
      const view = this.statusView(taskId)
      if (view.settled || view.phase === 'none') return { view, timedOut: false }
      const left = deadline - this.now()
      if (left <= 0 || this.disposed) return { view, timedOut: true }
      await this.sleep(Math.min(1_000, left))
    }
  }

  /**
   * What the agent did last, read from the tail of the run's filtered log.
   * @param taskId - card to inspect.
   * @returns the last tool call or message, or undefined when none can be read.
   */
  async activityOf(taskId: string): Promise<SshActivity | undefined> {
    const page = await this.queryLog(taskId, { tail: 30, maxBytes: 48 * 1024 })
    return page.ok ? lastActivity(page.text) : undefined
  }

  /**
   * One filtered, bounded read of a run's log.
   *
   * The filter, the line selection and the byte cap all run on the host, so a
   * 12 MB stream-json log costs one short reply; the reply carries the filtered
   * line count and size so a caller sees the cost before asking for more.
   * @param taskId - card whose run to read.
   * @param options - run, tail/since window, raw switch, cap and stats-only.
   * @returns the page, or the refusal that says why there is none.
   */
  async queryLog(
    taskId: string,
    options: { runId?: string; tail?: number; since?: number; raw?: boolean; maxBytes?: number; statsOnly?: boolean } = {},
  ): Promise<SshLogReply> {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    if (payload === undefined || target === undefined) {
      return { ok: false, code: 'no-target', error: `task ${taskId} pins no SSH target` }
    }
    if (options.runId !== undefined && findRun(payload, options.runId) === undefined) {
      return { ok: false, code: 'unknown-run', error: `task ${taskId} has no run ${options.runId}` }
    }
    const runId = options.runId ?? payload.activeRun?.runId ?? this.reserved.get(taskId)?.runId ?? payload.history[payload.history.length - 1]?.runId
    if (runId === undefined) return { ok: false, code: 'no-run', error: `task ${taskId} has never run remotely` }
    let stateDir: string
    try {
      stateDir = await this.remote.stateDir(target.host)
    } catch (error) {
      return { ok: false, code: 'host-unreachable', error: error instanceof Error ? error.message : String(error) }
    }
    const query: SshLogQuery = {
      file: runFilePath(stateDir, runId, 'stdout.log'),
      ...(options.tail === undefined ? {} : { tail: options.tail }),
      ...(options.since === undefined ? {} : { since: options.since }),
      ...(options.raw === true ? { raw: true } : {}),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.statsOnly === true ? { statsOnly: true } : {}),
    }
    const result = await this.remote.probe(target.host, logCommand(query))
    if (!result.success) {
      return { ok: false, code: 'log-unavailable', error: result.error ?? (result.stderr.trim() || 'the log could not be read') }
    }
    const answer = readLogAnswer(result.stdout, query)
    if (answer.stats === undefined) return { ok: false, code: 'no-log-yet', error: `run ${runId} has not written a log yet` }
    const from = query.since ?? tailStart(answer.stats, options.tail ?? 40)
    return {
      ok: true,
      runId,
      filtered: options.raw !== true,
      stats: answer.stats,
      from,
      lines: answer.lines,
      nextSince: from + answer.lines,
      more: answer.more,
      text: answer.text,
    }
  }

  /**
   * Check a target can work before a card is bound to it or a run starts.
   * @param target - the candidate target.
   * @returns the first failed check, or undefined when the target is usable.
   */
  async preflight(target: SshTarget): Promise<SshPreflightFailure | undefined> {
    if (this.hostByAlias(target.host) === undefined) {
      const known = this.hosts().slice(0, 20).map(host => host.alias)
      return {
        code: 'host-unreachable',
        message: `dsh-ssh has no host with alias "${target.host}"${known.length === 0 ? ' (no host is configured at all)' : `; configured aliases: ${known.join(', ')}`}`,
        hint: 'Use one of the configured aliases, or add the host in the dsh-ssh settings first.',
      }
    }
    const overridden = this.settings().agentCommands[target.agent.kind] !== undefined
    const program = overridden ? undefined : agentProgram(target.agent)
    const result = await this.remote.probe(target.host, preflightCommand(target, program), 15_000)
    return readPreflight(target, program, result)
  }

  /** Summary of one card this provider owns, for `task_board_get` / `task_board_list`. */
  describeTask(task: TaskRecord): Record<string, unknown> | undefined {
    const payload = readHostPayload(task.integrations?.[SSH_INTEGRATION_KEY])
    const target = payload?.target
    if (payload === undefined || target === undefined) return undefined
    const live = liveRunOf(payload)
    const last = payload.activeRun ?? payload.history[payload.history.length - 1]
    const canFollowUp = target.mode === 'direct' && task.archivedAt === undefined && payload.pending === undefined
    return {
      kind: 'ssh',
      host: target.host,
      agent: target.agent.kind,
      mode: target.mode,
      workspace: target.workspace.kind,
      canFollowUp,
      ...(canFollowUp ? {} : { followUpBlockedBy: target.mode !== 'direct' ? 'proxy cards take follow-ups in their local session' : task.archivedAt !== undefined ? 'archived' : 'an instruction is already queued' }),
      ...(last === undefined ? {} : { phase: this.reserved.has(task.id) ? 'queued' : last.phase, runId: last.runId }),
      ...(live === undefined && !this.reserved.has(task.id) ? {} : { runActive: true }),
      // A direct card runs on the host with its own agent: the board's local
      // session permission gate never applies to it.
      localPermission: target.mode !== 'direct',
    }
  }

  /** The handle of the run just taken over for one card, for `task_board_run`. */
  describeRun(taskId: string): Record<string, unknown> | undefined {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    if (target === undefined || target.mode !== 'direct') return undefined
    const reservation = this.reserved.get(taskId)
    const run = payload?.activeRun
    const runId = run?.runId ?? reservation?.runId
    if (runId === undefined) return undefined
    const stateDir = this.remote.cachedStateDir(target.host) ?? `~/${REMOTE_STATE_SUFFIX}`
    const estimate = this.estimateDuration(taskId, target)
    return {
      kind: 'ssh',
      executionId: run?.executionId ?? reservation?.executionId ?? null,
      runId,
      logPath: `${target.host}:${runFilePath(stateDir, runId, 'stdout.log')}`,
      target: targetView(target),
      estimatedDurationMs: estimate.ms,
      estimateBasis: estimate.basis,
      next: `The run is remote and has no board execution until it settles. Block on it with task_board_ssh {action:"status", taskId:"${taskId}", wait:true}; read its filtered log with {action:"log", taskId:"${taskId}"}.`,
    }
  }

  /** Expected duration of a run: the median of earlier successful runs, else a default. */
  private estimateDuration(taskId: string, target: SshTarget): { ms: number; basis: 'card-history' | 'host-history' | 'default' } {
    const durations = (records: readonly SshRunRecord[]): number[] => records
      .filter(record => record.phase === 'succeeded' && record.finishedAt !== undefined)
      .map(record => (record.finishedAt as number) - record.startedAt)
    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)] as number
    }
    const own = durations(this.payloadOf(taskId)?.history ?? [])
    if (own.length > 0) return { ms: median(own), basis: 'card-history' }
    const shared = this.linkedEntries()
      .filter(entry => entry.payload?.target?.host === target.host && entry.payload.target.agent.kind === target.agent.kind)
      .flatMap(entry => durations(entry.payload?.history ?? []))
    if (shared.length > 0) return { ms: median(shared), basis: 'host-history' }
    return { ms: DEFAULT_ESTIMATED_DURATION_MS, basis: 'default' }
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
    if (task.archivedAt !== undefined) return { ok: false, code: 'task-archived', error: `task ${taskId} is archived` }
    if (this.hostByAlias(target.host) === undefined) {
      return { ok: false, code: 'host-not-configured', error: `dsh-ssh has no host with alias "${target.host}"` }
    }
    const payload = this.payloadOf(taskId)
    if (payload !== undefined && liveRunOf(payload) !== undefined) {
      return { ok: false, code: 'run-active', error: `cannot change the SSH target of task ${taskId} while a run is queued or running` }
    }
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
   * Create a card already bound to a target, in one step.
   *
   * The target is checked first and the card is created only when the check
   * passes, with the target in the same write, so a refused target leaves no
   * half-made card behind and a created card is never unbound.
   * @param draft - card content.
   * @param target - the target to bind.
   * @param options - `preflight: false` skips the reachability check.
   * @returns the new card id, or the stable refusal.
   */
  async createBound(
    draft: { title: string; prompt: string; description?: string; workspaceId?: string; parentId?: string },
    target: SshTarget,
    options: { preflight?: boolean } = {},
  ): Promise<SshEngineReply> {
    if (options.preflight !== false) {
      const failure = await this.preflight(target)
      if (failure !== undefined) return { ok: false, code: failure.code, error: `${failure.message}. ${failure.hint}` }
    } else if (this.hostByAlias(target.host) === undefined) {
      return { ok: false, code: 'host-unreachable', error: `dsh-ssh has no host with alias "${target.host}"` }
    }
    try {
      const task = this.host.tasks.create({
        title: draft.title,
        description: draft.description ?? '',
        prompt: draft.prompt,
        ...(draft.workspaceId === undefined ? {} : { workspaceId: draft.workspaceId }),
        ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      }, { payload: writeHostPayload({ updatedAt: this.now(), history: [], target }, this.now()) })
      this.publishSummary()
      return { ok: true, taskId: task.id, message: 'card created with its target' }
    } catch (error) {
      return { ok: false, code: 'create-refused', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Start a card's pinned run and wait for the board to accept or refuse it, so
   * the run's handle exists when this returns.
   * @param taskId - card to run.
   * @returns the reply; a board or provider refusal keeps its stable code.
   */
  async runCard(taskId: string): Promise<SshEngineReply> {
    const target = this.targetOf(taskId)
    if (target === undefined) return { ok: false, code: 'no-target', error: `task ${taskId} pins no SSH target` }
    if (target.mode !== 'direct') {
      return { ok: false, code: 'proxy-mode', error: 'a proxy card runs in a local session: start it from the board with task_board_run' }
    }
    const seat = this.seat?.()
    if (seat === undefined) return { ok: false, code: 'board-unavailable', error: 'this board revision serves no action applier' }
    try {
      await seat.apply(this.uuid(), { kind: 'run', taskId }, 'ssh')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const coded = /^([a-z][a-z0-9-]*): ([\s\S]+)$/.exec(message)
      return coded === null ? { ok: false, code: 'run-refused', error: message } : { ok: false, code: coded[1] as string, error: coded[2] as string }
    }
    return { ok: true, taskId, ...(this.reserved.get(taskId) === undefined ? {} : { runId: this.reserved.get(taskId)?.runId }), message: 'run started' }
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
    if (payload.target.mode !== 'direct') {
      return { ok: false, code: 'proxy-mode', error: 'a proxy card runs in a local session: send follow-ups to that session instead' }
    }
    const trimmed = text.trim()
    if (trimmed === '') return { ok: false, code: 'empty-instruction', error: 'an instruction must not be blank' }
    if (payload.pending !== undefined) {
      return { ok: false, code: 'instruction-already-queued', error: 'an instruction is already queued for this card' }
    }
    const live = liveRunOf(payload)
    // Only snapshot `resumeSessionId` when starting immediately on a settled
    // card; while a run is in flight, leave it unset so `startRun` resolves
    // the fresh session id the in-flight run emits upon settling.
    const previous = live === undefined ? latestSessionId(payload) : undefined
    const pending: SshPendingInstruction = {
      kind,
      text: trimmed,
      queuedAt: this.now(),
      ...(previous === undefined ? {} : { resumeSessionId: previous }),
    }
    const next: HostSshPayload = live === undefined
      ? { ...payload, pending }
      : { ...payload, pending, activeRun: { ...live, followUps: (live.followUps ?? 0) + 1 } }
    if (!this.writePayload(taskId, next)) {
      return { ok: false, code: 'payload-refused', error: 'the board refused the queued instruction' }
    }
    if (live !== undefined) {
      this.publishSummary()
      return { ok: true, taskId, runId: live.runId, phase: live.phase, message: 'queued behind the run in flight' }
    }
    const reentered = this.reenter(taskId, 'ssh-' + kind)
    if (!reentered.ok) {
      // Roll back the queued instruction so a refused rerun never silently
      // hijacks a future regular run of this card.
      const latest = this.payloadOf(taskId)
      if (latest !== undefined && latest.pending?.queuedAt === pending.queuedAt) {
        const rolledBack: HostSshPayload = { ...latest }
        delete rolledBack.pending
        this.writePayload(taskId, rolledBack)
      }
      return reentered
    }
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
    // A run stopped from the card surface leaves the card where it can be
    // picked up again, which is the same place a card dragged out of the running
    // column lands: the todo column, with no verdict written.
    void this.stopRun(taskId, payload, target, run, { restore: true }).catch(error => { this.log('the cancel request failed', error) })
    return { ok: true, taskId, runId: run.runId, phase: 'cancelled', message: 'cancel requested' }
  }

  /**
   * Re-read remote state now instead of waiting for the next tick.
   * @param taskId - one card, or undefined for every card this mount follows.
   * @returns the reply the caller renders.
   */
  async refresh(taskId?: string, runId?: string, offset?: number): Promise<SshEngineReply> {
    if (runId !== undefined && taskId === undefined) {
      return { ok: false, code: 'task-required', error: 'a run is named inside its card: pass the taskId with the runId' }
    }
    if (taskId !== undefined) {
      if (runId !== undefined && findRun(this.payloadOf(taskId), runId) === undefined) {
        return { ok: false, code: 'unknown-run', error: `task ${taskId} has no run ${runId}` }
      }
      // A viewer that just opened (or reopened) asks for this card, and can
      // also page forward through settled logs past the 8 KiB window budget by
      // passing `offset`.
      await this.replayLog(taskId, runId, offset ?? 0)
      const job = this.jobs.get(taskId)
      if (offset === undefined && job !== undefined && !this.polling && !this.settling.has(taskId)) {
        await this.pollJob(job)
      }
      this.publishSummary()
      return { ok: true, taskId, message: 'refreshed' }
    }
    await this.poll()
    for (const alias of this.aliasesInFlight()) await this.pump(alias)
    this.publishSummary()
    return { ok: true, taskId: '', message: 'refreshed every followed card' }
  }

  /**
   * Re-read one bounded page of one card's log from `offset` into the pending window.
   * @param taskId - card whose run log to replay.
   * @param runId - a specific run, when the viewer named one.
   * @param offset - byte offset to replay from (defaults to 0).
   */
  private async replayLog(taskId: string, runId?: string, offset = 0): Promise<void> {
    const payload = this.payloadOf(taskId)
    const target = payload?.target
    if (payload === undefined || target === undefined) return
    const run = (runId === undefined ? undefined : findRun(payload, runId))
      ?? payload.activeRun
      ?? payload.history[payload.history.length - 1]
    if (run === undefined) return
    try {
      const stateDir = await this.remote.stateDir(target.host)
      const page = await this.remote.tail({ alias: target.host, stateDir, runId: run.runId }, offset, LOG_WINDOW_BUDGET_BYTES + 1)
      const hasMore = byteLength(page.text) > LOG_WINDOW_BUDGET_BYTES
      this.logs.replay(taskId, run.runId, offset, page.text, hasMore)
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
    if (options.runId !== undefined && findRun(payload, options.runId) === undefined) {
      return { ok: false, code: 'unknown-run', error: `task ${taskId} has no run ${options.runId}` }
    }
    const runId = options.runId
      ?? payload.activeRun?.runId
      ?? payload.history[payload.history.length - 1]?.runId
    if (runId === undefined) return { ok: false, code: 'no-run', error: `task ${taskId} has never run remotely` }
    const offset = options.offset !== undefined && Number.isFinite(options.offset) && options.offset >= 0
      ? Math.trunc(options.offset)
      : 0
    const limit = options.limit !== undefined && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.trunc(options.limit), 128 * 1024)
      : 64 * 1024
    try {
      const stateDir = await this.remote.stateDir(target.host)
      const page = await this.remote.tail({ alias: target.host, stateDir, runId }, offset, limit + 1)
      const taken = takeWithinBudget(page.text, limit)
      const bytes = offset + taken.bytes
      return {
        ok: true,
        taskId,
        runId,
        offset,
        nextOffset: bytes,
        bytes,
        eof: byteLength(page.text) <= limit,
        text: taken.text,
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
        const untracked = this.untracked.get(entry.task.id)
        const files = untracked !== undefined && untracked.runId === run.runId ? untracked.files : undefined
        runs.push({
          taskId: entry.task.id,
          runId: run.runId,
          phase: run.phase,
          host: payload.target.host,
          ...(run.bytes === undefined ? {} : { bytes: run.bytes }),
          ...(files === undefined ? {} : { untrackedFiles: files }),
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
      // Fail closed: never return `undefined` (which would silently launch a
      // remote-pinned direct card as a local session on this machine).
      this.log(`task ${task.id} pins a remote host but this board revision serves no launch interception or action applier, so it cannot run remotely`)
      return { kind: 'external' }
    }
    // One run per card: a second request while a run is in flight (or its start
    // is being prepared) is refused out loud instead of overwriting the first.
    const live = liveRunOf(payload)
    if (live !== undefined || this.reserved.has(task.id)) {
      return {
        kind: 'refuse',
        code: 'run-active',
        reason: `task ${task.id} already has a remote run in flight (${live?.runId ?? this.reserved.get(task.id)?.runId ?? 'starting'}); wait for it with task_board_ssh status (wait: true), or cancel it before running again`,
      }
    }
    // The ids are chosen here, synchronously, so the run tool can hand them back
    // before the remote side has done anything.
    this.reserved.set(task.id, { runId: this.newRunId(), executionId: this.uuid(), startedAt: this.now() })
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
    if (task === undefined || task.archivedAt !== undefined || task.status !== 'running') {
      this.reserved.delete(taskId)
      return
    }
    const payload = this.payloadOf(taskId)
    if (payload?.target === undefined) {
      this.reserved.delete(taskId)
      return
    }
    const live = liveRunOf(payload)
    if (live !== undefined) return
    const reservation = this.reserved.get(taskId)
    this.reserved.delete(taskId)
    const run: SshRunRecord = reservation === undefined
      ? { runId: this.newRunId(), phase: 'queued', startedAt: this.now() }
      : { runId: reservation.runId, phase: 'queued', startedAt: reservation.startedAt, executionId: reservation.executionId }
    this.rememberRun(taskId, alias, run.runId, payload.target)
    if (!this.writePayload(taskId, { ...payload, activeRun: run })) return
    await this.pump(alias)
    this.publishSummary()
  }

  /** Record a run id against a card so card deletion cleans up every remote artifact. */
  private rememberRun(taskId: string, alias: string, runId: string, target?: SshTarget): void {
    const existing = this.known.get(taskId)
    if (existing !== undefined) {
      existing.alias = alias
      if (target !== undefined) existing.target = target
      existing.runIds.add(runId)
      return
    }
    this.known.set(taskId, {
      alias,
      ...(target === undefined ? {} : { target }),
      runIds: new Set([runId]),
    })
  }

  /** Previous git worktree run id to reuse for a follow-up / rework, when available. */
  private priorWorktreeRunId(payload: HostSshPayload): string | undefined {
    for (let index = payload.history.length - 1; index >= 0; index -= 1) {
      const record = payload.history[index]
      if (record === undefined) continue
      if (record.branch !== undefined && record.branch.startsWith('dsh-task/')) {
        return record.branch.slice('dsh-task/'.length)
      }
      if (record.phase === 'succeeded' || record.phase === 'failed') {
        return record.runId
      }
    }
    return undefined
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
    if (this.disposed || !this.enabled()) return
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
      this.rememberRun(entry.task.id, alias, run.runId, target)
      if (run.phase === 'running') {
        running += 1
        this.logs.adopt(entry.task.id, run.runId, run.bytes ?? 0)
        if (!this.jobs.has(entry.task.id)) {
          this.jobs.set(entry.task.id, {
            taskId: entry.task.id,
            runId: run.runId,
            alias,
            target,
            workspaceRunId: run.runId,
            abort: new AbortController(),
            failures: 0,
            degraded: false,
            starting: false,
          })
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
    if (this.disposed || !this.enabled()) return
    const task = this.host.tasks.get(taskId)
    const payload = this.payloadOf(taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (task === undefined || task.archivedAt !== undefined || task.status !== 'running') return
    if (payload === undefined || run === undefined || target === undefined) return
    if (run.runId !== runId || run.phase !== 'queued') return
    const settings = this.settings()
    const pending = payload.pending
    const reusedWorktree = pending !== undefined && target.workspace.kind === 'git'
      ? this.priorWorktreeRunId(payload)
      : undefined
    const workspaceRunId = reusedWorktree ?? runId
    const abort = new AbortController()
    const job: SshJob = {
      taskId,
      runId,
      alias,
      target,
      workspaceRunId,
      abort,
      failures: 0,
      degraded: false,
      starting: true,
    }
    this.jobs.set(taskId, job)
    this.rememberRun(taskId, alias, runId, target)
    this.logs.adopt(taskId, runId, run.bytes ?? 0)
    // The slot is taken before any remote work: a concurrent admission sees a
    // running run instead of starting the same card twice.
    this.writePayload(taskId, withActiveRun(payload, { ...run, phase: 'running' }))
    const templates = agentTemplates(target.agent, settings)
    const resumeSession = pending === undefined ? undefined : pending.resumeSessionId ?? latestSessionId(payload)
    const resumed = pending !== undefined && resumeSession !== undefined && agentResumeSupported(target.agent.kind, templates)
    job.degraded = pending !== undefined && !resumed
    const isCancelledOrSuperseded = (): boolean => (
      this.disposed
      || abort.signal.aborted
      || this.cancelRequested(alias, runId)
      || this.payloadOf(taskId)?.activeRun?.runId !== runId
    )
    try {
      const stateDir = await this.remote.stateDir(alias)
      if (isCancelledOrSuperseded()) { this.jobs.delete(taskId); return }
      await this.remote.installLauncher({ alias, stateDir })
      if (isCancelledOrSuperseded()) { this.jobs.delete(taskId); return }
      const prepared = await this.prepareWorkspace(target, runId, {
        signal: abort.signal,
        ...(reusedWorktree === undefined ? {} : { reuseWorktreeRunId: reusedWorktree }),
      })
      if (isCancelledOrSuperseded()) { this.jobs.delete(taskId); return }
      if (prepared.untrackedFiles !== undefined) {
        this.untracked.set(taskId, { runId, files: prepared.untrackedFiles })
      }
      const promptFile = runFilePath(stateDir, runId, 'prompt.txt')
      const input: SshAgentRunInput = {
        agent: target.agent.kind,
        promptFile,
        cwd: prepared.cwd,
        ...(resumed && resumeSession !== undefined ? { resumeSessionId: resumeSession } : {}),
      }
      const command = agentCommandLine(input, templates)
      const prompt = runPrompt(task, pending, this.previousSummary(payload), resumed)
      await this.remote.writeRunFiles({ alias, stateDir, runId }, {
        prompt,
        command,
        cwd: prepared.cwd,
        spec: {
          runId,
          taskId,
          host: alias,
          mode: target.mode,
          agent: target.agent.kind,
          workspace: target.workspace.kind,
          workspaceRunId,
          resumed,
          degraded: job.degraded,
          startedAt: run.startedAt,
        },
      })
      if (isCancelledOrSuperseded()) {
        this.jobs.delete(taskId)
        return
      }
      let status = await this.remote.start({ alias, stateDir, runId })
      // From here the remote side owns the verdict: the run directory exists, so
      // a poll's "no such run" is a real disappearance.
      job.starting = false
      if (isCancelledOrSuperseded()) {
        // Cancel arrived right as `remote.start` launched the agent: terminate
        // the newly spawned process immediately so no unattended orphan survives.
        this.jobs.delete(taskId)
        try {
          await this.remote.cancel({ alias, stateDir, runId })
        } catch (cancelError) {
          this.log(`late cancel of run ${runId} on ${alias} failed`, cancelError)
        }
        return
      }
      if (status.state !== 'running' && status.state !== 'exited') {
        try {
          status = await this.remote.status({ alias, stateDir, runId })
        } catch (error) {
          this.log(`the state of run ${runId} could not be confirmed after an inconclusive start`, error)
        }
      }
      const current = this.payloadOf(taskId)
      if (isCancelledOrSuperseded() || current?.activeRun?.runId !== runId) {
        this.jobs.delete(taskId)
        try {
          await this.remote.cancel({ alias, stateDir, runId })
        } catch { /* best-effort */ }
        return
      }
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
      if (isCancelledOrSuperseded()) {
        this.jobs.delete(taskId)
        return
      }
      this.log(`the run ${runId} of task ${taskId} could not be prepared on ${alias}`, error)
      await this.settle(taskId, job, { state: 'lost' }, error)
    }
    this.publishSummary()
  }

  /**
   * Resolve the run's working directory through its placement strategy.
   *
   * The strategy may also report how much of the local work it could not send —
   * a bundle carries commits, not the untracked working tree — and that note is
   * kept rather than dropped: the card publishes it while the run is going and
   * the verdict says it out loud.
   * @param target - the target the card pins.
   * @param runId - run being prepared.
   * @param options - cancellation signal and optional worktree reuse id.
   * @returns the absolute remote directory and the untracked-file note, when any.
   */
  private async prepareWorkspace(
    target: SshTarget,
    runId: string,
    options: { signal?: AbortSignal; reuseWorktreeRunId?: string } = {},
  ): Promise<{ cwd: string; untrackedFiles?: number }> {
    const strategy = this.strategyFor(target)
    const prepared = await strategy.prepare(await this.workspaceRun(target, runId, options))
    if (typeof prepared.cwd !== 'string' || !prepared.cwd.startsWith('/')) {
      throw new Error(`the ${target.workspace.kind} workspace strategy returned no absolute working directory`)
    }
    const untrackedFiles = readUntrackedFiles(prepared)
    return untrackedFiles === undefined ? { cwd: prepared.cwd } : { cwd: prepared.cwd, untrackedFiles }
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
  private async workspaceRun(
    target: SshTarget,
    runId: string,
    options: { signal?: AbortSignal; reuseWorktreeRunId?: string } = {},
  ): Promise<SshWorkspaceRun> {
    const run: SshWorkspaceRun = {
      runId,
      host: target.host,
      stateDir: await this.remote.stateDir(target.host),
      ssh: this.ssh,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.reuseWorktreeRunId === undefined ? {} : { reuseWorktreeRunId: options.reuseWorktreeRunId }),
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
    // The switch is read here as well as in the registration: a deployment whose
    // settings reach this instance without unloading it must still stop talking
    // to its hosts the moment the provider is switched off.
    if (this.disposed || this.polling || !this.enabled()) return
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
    if (this.settling.has(job.taskId)) return
    const task = this.host.tasks.get(job.taskId)
    const payload = task === undefined ? undefined : this.payloadOf(job.taskId)
    const run = payload?.activeRun
    const target = job.target
    if (task === undefined || payload === undefined || run === undefined || run.runId !== job.runId) {
      this.jobs.delete(job.taskId)
      return
    }
    let status: LauncherStatus
    try {
      const stateDir = await this.remote.stateDir(job.alias)
      status = await this.remote.status({ alias: job.alias, stateDir, runId: run.runId })
    } catch (error) {
      job.failures += 1
      this.log(`the state of run ${run.runId} could not be read (${String(job.failures)} in a row)`, error)
      if (job.failures >= LOST_AFTER_FAILURES) await this.settle(job.taskId, job, { state: 'lost' })
      return
    }
    job.failures = 0
    if (job.starting && (status.state === 'missing' || status.state === 'lost')) {
      // The start is still preparing this run: the remote directory it is about
      // to write is absent by definition, and the start's own answer settles
      // the card when it has one.
      return
    }
    if (status.state === 'running') {
      const bytes = status.bytes ?? run.bytes
      if (bytes !== undefined && bytes !== run.bytes) {
        const current = this.payloadOf(job.taskId)
        if (current?.activeRun?.runId === run.runId) this.writePayload(job.taskId, withActiveRun(current, { ...run, bytes, lastActivityAt: this.now() }))
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
   * Bounded to one window budget per poll so a multi-megabyte burst never hits
   * `dsh-ssh`'s 2 MiB stdout cap.
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
      const page = await this.remote.tail({ alias: target.host, stateDir, runId: run.runId }, cursor, LOG_WINDOW_BUDGET_BYTES)
      if (page.text !== '') this.logs.push(taskId, run.runId, cursor, page.text, remoteBytes)
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
    if (this.settling.has(taskId)) return
    this.jobs.delete(taskId)
    this.settling.add(taskId)
    try {
      const task = this.host.tasks.get(taskId)
      const payload = this.payloadOf(taskId)
      const run = payload?.activeRun
      const target = job.target
      const runAlias = job.alias
      if (task === undefined || payload === undefined || run === undefined || run.runId !== job.runId) return
      let cancelled = this.cancelRequested(runAlias, run.runId) || status.state === 'cancelled'
      let text = ''
      let tailOffset = 0
      let bytes = status.bytes ?? run.bytes ?? 0
      try {
        const stateDir = await this.remote.stateDir(runAlias)
        // Read only the trailing PARSE_WINDOW bytes so logs exceeding dsh-ssh's
        // 2 MiB output cap never lose their closing final/result JSONL event.
        tailOffset = Math.max(0, bytes - PARSE_WINDOW)
        const page = await this.remote.tail({ alias: runAlias, stateDir, runId: run.runId }, tailOffset, PARSE_WINDOW)
        text = page.text
        bytes = Math.max(bytes, page.bytes)
        // Advance the pending browser log window contiguously past its cursor.
        const cursor = this.logs.cursor(taskId, run.runId) ?? 0
        if (bytes > cursor) {
          if (cursor >= tailOffset && text !== '') {
            this.logs.push(taskId, run.runId, cursor, sliceFromByte(text, cursor - tailOffset), bytes)
          } else {
            try {
              const inc = await this.remote.tail({ alias: runAlias, stateDir, runId: run.runId }, cursor, LOG_WINDOW_BUDGET_BYTES)
              if (inc.text !== '') this.logs.push(taskId, run.runId, cursor, inc.text, bytes)
            } catch { /* best-effort window fill */ }
          }
        }
      } catch (error) {
        this.log(`the log of run ${run.runId} could not be read`, error)
      }
      const parsed = readAgentOutput({ agent: target.agent.kind, promptFile: '', cwd: '' }, parseWindow(text))
      // Re-check cancellation before collecting workspace (cancel may have arrived while reading logs).
      cancelled = cancelled || this.cancelRequested(runAlias, run.runId) || this.disposed
      const collection = cancelled
        ? {}
        : await this.collectWorkspace(target, run.runId, job.workspaceRunId)
      // Re-check cancellation, task status and ownership AFTER all awaits so a
      // cancel, manual column move, archive, or replacement run that arrived
      // during slow git push/bundle download is never overwritten with a verdict.
      cancelled = cancelled || this.cancelRequested(runAlias, run.runId)
      if (this.disposed) return
      const taskAfterAwait = this.host.tasks.get(taskId)
      const currentAfterAwait = this.payloadOf(taskId)
      if (taskAfterAwait === undefined || currentAfterAwait === undefined || currentAfterAwait.activeRun?.runId !== run.runId) return
      if (cancelled || taskAfterAwait.archivedAt !== undefined || taskAfterAwait.status !== 'running') {
        if (!cancelled) {
          const stopped: SshRunRecord = {
            runId: run.runId,
            phase: 'cancelled',
            startedAt: run.startedAt,
            finishedAt: this.now(),
            ...(bytes > 0 ? { bytes } : {}),
            ...(status.exitCode === undefined ? {} : { exitCode: status.exitCode }),
          }
          const nextCancelled = withSettledRun(currentAfterAwait, stopped)
          delete nextCancelled.pending
          this.writePayload(taskId, nextCancelled)
        }
        return
      }

      const collectionError = collection.error
      const basePhase = this.phaseOf(cancelled, status, parsed.outcome)
      const phase: SshRunPhase = collectionError !== undefined && basePhase === 'succeeded' ? 'failed' : basePhase
      const rawSummary = parsed.outcome?.ok === true ? bound(parsed.outcome.text, SSH_SUMMARY_MAX_LENGTH) : undefined
      const summary = rawSummary !== undefined && rawSummary !== '' ? rawSummary : undefined
      let rawError: string | undefined
      if (failure !== undefined) {
        rawError = bound(failure instanceof Error ? failure.message : String(failure), SSH_ERROR_MAX_LENGTH)
      } else if (collectionError !== undefined) {
        rawError = bound(collectionError, SSH_ERROR_MAX_LENGTH)
      } else if ((parsed.outcome !== undefined && !parsed.outcome.ok) || phase === 'failed') {
        // When a remote run exits non-zero, fetch bounded stderr.log so CLI
        // startup errors (missing binary, bad flag, auth failure) surface on the card.
        let stderrHint = ''
        if (status.exitCode !== undefined && status.exitCode !== 0) {
          try {
            const stateDir = await this.remote.stateDir(runAlias)
            stderrHint = await this.remote.stderr({ alias: runAlias, stateDir, runId: run.runId }, 512)
          } catch { /* best-effort */ }
        }
        const baseMessage = parsed.outcome !== undefined && !parsed.outcome.ok
          ? parsed.outcome.error
          : `the remote agent exited with code ${String(status.exitCode ?? 'none')}`
        const detail = stderrHint !== ''
          ? `${baseMessage} (exit ${String(status.exitCode)}: ${stderrHint})`
          : baseMessage
        rawError = bound(detail, SSH_ERROR_MAX_LENGTH)
      } else if (status.state === 'lost' || status.state === 'missing') {
        rawError = 'the remote run disappeared: its process and its exit record were both gone'
      }
      const errorText = rawError !== undefined && rawError !== '' ? rawError : undefined
      const sessionId = parsed.sessionId !== undefined && parsed.sessionId !== '' ? parsed.sessionId : undefined
      const branch = collection.branch !== undefined && collection.branch !== '' ? collection.branch : undefined
      const settled: SshRunRecord = {
        runId: run.runId,
        phase,
        startedAt: run.startedAt,
        finishedAt: this.now(),
        bytes,
        ...(status.exitCode === undefined ? {} : { exitCode: status.exitCode }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(branch === undefined ? {} : { branch }),
        ...(run.followUps === undefined ? {} : { followUps: run.followUps }),
        ...(summary === undefined ? {} : { summary }),
        ...(errorText === undefined ? {} : { error: errorText }),
        ...(run.executionId === undefined ? {} : { executionId: run.executionId }),
        ...(run.lastActivityAt === undefined ? {} : { lastActivityAt: run.lastActivityAt }),
        ...(errorText === undefined || phase === 'succeeded' ? {} : { errorCode: failureCode(phase, status, collectionError !== undefined, failure !== undefined) }),
      }
      const untracked = this.untracked.get(taskId)
      const note = untrackedNote(untracked !== undefined && untracked.runId === run.runId ? untracked.files : undefined)
      this.recordOutcome(task, settled, job.degraded, note)
      this.untracked.delete(taskId)
      const current = this.payloadOf(taskId)
      if (current !== undefined) this.writePayload(taskId, withSettledRun(current, settled))
      if (current?.pending !== undefined) this.reenter(taskId, 'ssh-follow-up')
      await this.pump(runAlias)
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

  /**
   * Put one settled run's verdict on the card, exactly once.
   *
   * The verdict travels in the one free-text field an external record has, so
   * everything that belongs with it is composed here: the degradation marker when
   * the run was a fresh one, what the agent reported, and the workspace note when
   * local files stayed behind. The note is reserved room before the agent's own
   * text is cut, so a long summary can never push it out of the record.
   */
  private recordOutcome(task: TaskRecord, run: SshRunRecord, degraded: boolean, note = ''): void {
    if (run.phase === 'cancelled') return
    if (alreadyRecorded(task, run.runId)) return
    const seat = this.seat?.()
    if (seat === undefined) {
      this.log(`the verdict of run ${run.runId} has nowhere to go: this board revision serves no action applier`)
      return
    }
    const marker = degraded ? SSH_DEGRADED_SUMMARY_MARKER + ' ' : ''
    const room = Math.max(0, SSH_SUMMARY_MAX_LENGTH - marker.length - (note === '' ? 0 : note.length + 1))
    const text = run.phase === 'succeeded' ? run.summary : (run.error ?? run.summary)
    const body = text === undefined ? '' : bound(text, room)
    const composed = [marker + body, note].filter(part => part !== '').join(' ')
    const summary = composed === '' ? undefined : bound(composed, SSH_SUMMARY_MAX_LENGTH)
    try {
      seat.apply(this.uuid(), {
        kind: 'record-external-outcome',
        taskId: task.id,
        result: run.phase === 'succeeded' ? 'succeeded' : 'failed',
        initiatedBy: SSH_INITIATOR_PREFIX + run.runId,
        ...(summary === undefined ? {} : { summary }),
        startedAt: run.startedAt,
        ...(run.executionId === undefined ? {} : { executionId: run.executionId }),
        ...(run.phase === 'succeeded' || run.errorCode === undefined ? {} : { errorCode: run.errorCode, retryHint: retryHintFor(run.errorCode) }),
      }, 'ssh')
    } catch (error) {
      this.log(`the board refused the verdict of run ${run.runId}`, error)
    }
  }

  /** Bring back whatever the run's workspace strategy produced, surfacing collection failures explicitly. */
  private async collectWorkspace(
    target: SshTarget,
    runId: string,
    workspaceRunId: string = runId,
  ): Promise<{ branch?: string; error?: string }> {
    const strategy = this.workspaces?.(target.workspace)
    if (strategy === undefined) return {}
    try {
      const collection: SshWorkspaceCollection = await strategy.collect(
        await this.workspaceRun(target, runId, {
          ...(workspaceRunId === runId ? {} : { reuseWorktreeRunId: workspaceRunId }),
        }),
      )
      return collection.branch === undefined ? {} : { branch: collection.branch }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`the result of run ${runId} could not be collected`, error)
      const branchHint = target.workspace.kind === 'git' ? ` (remote branch dsh-task/${workspaceRunId} on ${target.host})` : ''
      return { error: `workspace collection failed${branchHint}: ${reason}` }
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
    const task = this.host.tasks.get(event.taskId)
    if (task === undefined) return
    const payload = this.payloadOf(event.taskId)
    const run = payload?.activeRun
    const target = payload?.target
    if (payload === undefined || run === undefined || target === undefined) return
    if (isTerminalRunPhase(run.phase)) return
    if (alreadyRecorded(task, run.runId)) return
    // The person already chose the column, so this path never moves the card.
    await this.stopRun(event.taskId, payload, target, run, { restore: false })
  }

  /**
   * Cancel one live run, drop any instruction it owed, and write no verdict.
   *
   * A card the provider itself stopped would otherwise sit in the running column
   * with nothing left to observe it, and the detail view offers no cancel button
   * for a settled run: the restore flag is what puts it back where a person can
   * run it again.
   */
  private async stopRun(
    taskId: string,
    payload: HostSshPayload,
    target: SshTarget,
    run: SshRunRecord,
    options: { restore: boolean },
  ): Promise<void> {
    const activeJob = this.jobs.get(taskId)
    activeJob?.abort.abort()
    this.jobs.delete(taskId)
    const cancelAlias = activeJob?.alias ?? target.host
    this.cancelRequests.add(cancelAlias + '/' + run.runId)
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
        const stateDir = await this.remote.stateDir(cancelAlias)
        await this.remote.cancel({ alias: cancelAlias, stateDir, runId: run.runId })
      } catch (error) {
        this.log(`the remote run ${run.runId} could not be cancelled`, error)
      }
    }
    if (options.restore) this.restoreToTodo(taskId, run.runId)
    // The slot this run held is free again: whoever waited for it is served now
    // rather than on the next tick.
    await this.pump(cancelAlias)
    this.publishSummary()
  }

  /**
   * Put a card the provider stopped back in the todo column.
   *
   * Only acts when the card is STILL in the running column with no newer live
   * run: if the operator already moved the card or started a fresh run while
   * `remote.cancel` waited out SIGTERM, leaving it alone prevents overwriting
   * the manual move or cancelling the newer run.
   * @param taskId - card to move.
   * @param runId - run that was stopped, recorded as the initiating party.
   */
  private restoreToTodo(taskId: string, runId: string): void {
    const task = this.host.tasks.get(taskId)
    if (task === undefined || task.archivedAt !== undefined || task.status !== 'running') return
    const latest = this.payloadOf(taskId)
    if (latest !== undefined && liveRunOf(latest) !== undefined) return
    try {
      this.host.tasks.setStatus(taskId, 'todo', SSH_INITIATOR_PREFIX + runId)
    } catch (error) {
      this.log(`task ${taskId} could not be put back in the todo column after its run was cancelled`, error)
    }
  }

  /** A deleted card takes all its remote run directories and git worktrees with it. */
  private async onTaskDeleted(event: TaskBoardTaskDeletedEvent): Promise<void> {
    if (this.disposed) return
    const job = this.jobs.get(event.taskId)
    job?.abort.abort()
    this.jobs.delete(event.taskId)
    this.logs.remove(event.taskId)
    this.untracked.delete(event.taskId)
    const known = this.known.get(event.taskId)
    this.known.delete(event.taskId)
    const alias = known?.alias ?? job?.alias
    const target = known?.target ?? job?.target
    const runIds = new Set<string>(known?.runIds ?? [])
    if (job !== undefined) {
      runIds.add(job.runId)
      runIds.add(job.workspaceRunId)
    }
    if (alias === undefined || runIds.size === 0) return
    try {
      const stateDir = await this.remote.stateDir(alias)
      const strategy = target !== undefined && target.workspace.kind === 'git' ? this.workspaces?.(target.workspace) : undefined
      for (const runId of runIds) {
        try {
          await this.remote.cancel({ alias, stateDir, runId })
        } catch (error) {
          this.log(`the run ${runId} of the deleted task ${event.taskId} could not be cancelled`, error)
        }
        try {
          await this.remote.removeRun({ alias, stateDir, runId })
        } catch (error) {
          this.log(`the remote run directory ${runId} of the deleted task ${event.taskId} could not be removed`, error)
        }
        if (strategy?.cleanup !== undefined && target !== undefined) {
          try {
            await strategy.cleanup(await this.workspaceRun(target, runId))
          } catch (error) {
            this.log(`the remote workspace ${runId} of the deleted task ${event.taskId} could not be removed`, error)
          }
        }
      }
      // A deleted card frees its slot like any other settlement.
      await this.pump(alias)
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
      if (entry.payload === undefined || target === undefined) continue
      for (const historic of entry.payload.history) {
        this.rememberRun(entry.task.id, target.host, historic.runId, target)
      }
      const run = entry.payload.activeRun
      if (run === undefined) continue
      aliases.add(target.host)
      this.rememberRun(entry.task.id, target.host, run.runId, target)
      if (run.phase === 'queued') continue
      if (!isTerminalRunPhase(run.phase)) {
        this.jobs.set(entry.task.id, {
          taskId: entry.task.id,
          runId: run.runId,
          alias: target.host,
          target,
          workspaceRunId: run.runId,
          abort: new AbortController(),
          failures: 0,
          degraded: false,
          starting: false,
        })
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
