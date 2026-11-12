import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { isValidCron, isValidTimeZone, nextRunAtMs, resolveHostTimeZone } from './core/schedule.ts'
import { isTaskRecord, parseLedger } from './core/store.ts'
import { DEFAULT_SPEND_BUDGET_TOKENS, spendCapMessage, spendCapReached } from './core/spend-budget.ts'
import { usedTokensToday } from './host-spend.ts'
import { canMoveManually, hasOpenExecution, retainRecentExecutions, scheduleExhausted, scheduleRunBudget, settleExecution, settledStatus, startExecution, withSchedule, withStatus, type ExecutionOutcome, type ExecutionRecord, type ExecutionRework, type ExecutionSummary, type ScheduleMode, type ScheduleStopReason, type TaskRecord } from './core/tasks.ts'
import {
  DEFAULT_SUBTASK_DEPTH,
  ancestorChain,
  cascadeTargets,
  combineCascadeOutcome,
  hasOutstandingDescendants,
  normalizeSubtaskDepth,
  openGroupExecution,
  outstandingDescendants as lineageOutstandingDescendants,
  pendingCascadeChildren,
  resolveExecutionTargets,
  subtreeTasks,
} from './core/subtask.ts'
import { applyArchiveTask, applyRestoreTask } from './core/use-cases/task-archive.ts'
import { applyCreateTask } from './core/use-cases/task-create.ts'
import type { CardDefaults } from './core/card-defaults.ts'
import { applyDeleteTask } from './core/use-cases/task-delete.ts'
import { applySetSchedule, applyScheduleProgress, applyScheduleRefund, type ScheduleProgress } from './core/use-cases/task-schedule.ts'
import { applySetParent } from './core/use-cases/task-parent.ts'
import { applyDeleteTag, applyRenameTag } from './core/use-cases/task-tag.ts'
import { applyUpdateTask, canEditTaskContent, hasContentPatch } from './core/use-cases/task-update.ts'
import { TASK_BOARD_MIGRATABLE_SCHEMA_VERSIONS, TASK_BOARD_SCHEMA_VERSION, TASK_BOARD_ZONE_STAMP_SCHEMA_VERSION, type TaskBoardAction, type TaskBoardSchedulerSnapshot } from './protocol.ts'
import { DEFAULT_SESSION_PERMISSION, requiresPermissionConfirmation, type TaskPermission } from './core/handover.ts'

interface PersistedScheduler extends TaskBoardSchedulerSnapshot {
  importedSources?: string[]
}

interface PersistedRequest {
  requestId: string
  fingerprint: string
}

/** On-disk document of any schema generation (schemaVersion untyped until the load branches decide). */
type ParsedLedgerDocument = Omit<Partial<LedgerDocument>, 'schemaVersion'> & { schemaVersion?: unknown }

interface LedgerDocument {
  schemaVersion: typeof TASK_BOARD_SCHEMA_VERSION
  revision: number
  tasks: TaskRecord[]
  scheduler: PersistedScheduler
  recentRequests: PersistedRequest[]
}

export interface LedgerState {
  revision: number
  tasks: TaskRecord[]
  scheduler: TaskBoardSchedulerSnapshot
}

/** Human-facing text for a refused binding, per surface. */
function bindingRefusalMessage(
  refusal: { kind: 'root' | 'inherited'; title: string },
  sessionDefault: TaskPermission,
  surface: 'run' | 'schedule',
): string {
  if (surface === 'schedule') return `task "${refusal.title}" has an unconfirmed above-default permission`
  if (refusal.kind === 'root') {
    return `confirmation-required: the effective permission is above the session default (${sessionDefault}); confirm the card's permission binding first`
  }
  return `confirmation-required: subtask "${refusal.title}" inherits an above-default permission; confirm that card's permission binding first`
}

export interface OpenedRun {
  task: TaskRecord
  execution: ExecutionRecord
}

/**
 * Prefix of the `initiatedBy` an inherited descendant verdict carries. The Host
 * recorded it on the run card's behalf (see `inheritVerdictForDescendants`), not
 * an outside agent that reported its own work.
 */
export const PARENT_RUN_INITIATOR_PREFIX = 'parent-run:'

/** Minimal value copy used by the Host session monitor. */
export interface OpenExecutionReference {
  readonly taskId: string
  readonly executionId: string
  readonly sessionId: string | undefined
  readonly startedAt: number
  /**
   * True for a member of a team-mode run other than its Lead. A teammate is a
   * durable member of the Team: it stays alive after its turn ends, so the
   * roster may keep reporting its session as running, and the turn it completed
   * is the only verdict it exposes.
   */
  readonly teamMember: boolean
}

/** Minimal value copy used by the Host scheduler. */
export interface DueScheduleReference {
  readonly taskId: string
  /** Whether this due rule is a recurring cron rule or a single planned instant. */
  readonly mode: ScheduleMode
  /** Cron expression of a recurring rule; absent on a one-shot. */
  readonly cron?: string
  /** Zone this rule's wall clock is read in. */
  readonly timeZone: string
  readonly nextRunAt: number
}

/** Derived runtime data for one session-poll pass. */
export interface LedgerRuntimeView {
  readonly armedSchedules: number
  readonly openExecutions: readonly OpenExecutionReference[]
  /**
   * Session ids of every open execution, including the ones
   * {@link openExecutions} skips because their own outcome is already
   * recorded. A caller that asks whether the board still observes any session
   * must use this list: a stored run-group parent is settled by its members,
   * but it is still an open execution.
   */
  readonly openSessionIds: readonly string[]
  /**
   * Whether this document holds anything the session roster can still decide:
   * an open execution that needs inspecting, or a card in the running column
   * whose verdict may arrive from a settle this process never saw.
   *
   * A board with no running card, no open execution and no armed schedule has
   * no use for the roster at all, which is what lets the Host poll stand down
   * instead of re-reading every persisted session forever.
   */
  readonly needsSessionState: boolean
}

const MAX_REQUEST_CACHE = 256

interface CachedRequest {
  fingerprint: string
}

function timeZone(): string {
  return resolveHostTimeZone()
}

/** The zone a schedule is evaluated in: its own, or the Host zone when it stores none. */
function scheduleZone(schedule: { timeZone?: string }): string {
  return schedule.timeZone ?? timeZone()
}

/**
 * The task collection one board read hands out.
 *
 * A read must not hand a consumer the ledger's own array: the state route, every
 * action response and the agent tools all receive this value in-process, so an
 * in-place rewrite of that array (splice, sort, push, `length = 0`) would edit
 * the authoritative document from outside the write path. One level of copying
 * is what that contract needs, and it is all it needs: every write in this class
 * replaces the document's array (`this.document.tasks = ...`) and replaces the
 * records it changes rather than mutating them, so the records a caller receives
 * are stable values. Copying them as well only rebuilt the entire document on
 * every board read - measured at 0.43 ms per read for 400 cards with 2
 * executions each and 2.72 ms for 400 cards with 20 - and bought nothing a
 * consumer relies on. Callers still must not mutate a record in place; that is
 * what the shared record objects now make possible, and no consumer in this
 * package does it.
 */
function tasksForRead(tasks: readonly TaskRecord[]): TaskRecord[] {
  return [...tasks]
}

/**
 * Process states that are dead but still occupy the PID table: `Z` (zombie)
 * and `X` (dead, being reaped). `process.kill(pid, 0)` reports such PIDs as
 * alive, so a crash leftover whose child was never reaped would otherwise be
 * mistaken for a live owner and block ledger startup forever.
 */
const DEAD_STATES = new Set(['Z', 'X'])

/**
 * Best-effort single-letter process state ('R','S','D','Z',...) or undefined
 * when no probe is available on this platform. Linux reads /proc/<pid>/stat
 * directly (no subprocess); other POSIX shells out to `ps -o stat=`; Windows
 * has no zombie state, so it returns undefined and the kill(0) probe alone
 * is authoritative there.
 */
export function processState(pid: number): string | undefined {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const end = stat.lastIndexOf(')')
      if (end === -1) return undefined
      return stat.slice(end + 2).split(' ')[0] || undefined
    } catch {
      return undefined // no such process (or unreadable)
    }
  }
  if (process.platform === 'win32') return undefined
  try {
    const probe = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { timeout: PROCESS_PROBE_TIMEOUT_MS })
    if (probe.status !== 0 || probe.stdout.length === 0) return undefined
    const state = probe.stdout.toString('utf8').trim()
    return state.length > 0 ? state[0] : undefined
  } catch {
    return undefined
  }
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  const state = processState(pid)
  if (state !== undefined && DEAD_STATES.has(state)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const PROCESS_PROBE_TIMEOUT_MS = 3000
/**
 * The CIM fallback pays a WMI cold start, so it gets a wider budget than the
 * direct `Get-Process` read it backs up.
 */
const CIM_PROBE_TIMEOUT_MS = 8000

let ownStartTime: number | undefined
let ownStartTimeResolved = false

/**
 * Exact process start time (Unix epoch ms) on Linux, read straight from
 * /proc (field 22 = start ticks since boot, btime = boot epoch seconds).
 * No subprocess and no rounding, so the recorded `startedAt` from a previous
 * boot compares exactly against the live process identity.
 */
function linuxStartTimeMs(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const end = stat.lastIndexOf(')')
    if (end === -1) return undefined
    const ticks = Number(stat.slice(end + 2).split(' ')[19])
    if (!Number.isFinite(ticks)) return undefined
    const bootMatch = /^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))
    if (bootMatch === null) return undefined
    const btime = Number(bootMatch[1])
    if (!Number.isFinite(btime)) return undefined
    return btime * 1000 + (ticks * 1000) / 100 // USER_HZ is 100 on Linux
  } catch {
    return undefined
  }
}

/** Runs one PowerShell script and returns its trimmed stdout. */
export type PowerShellProbe = (script: string, timeoutMs: number) => string | undefined

/** Default probe: one hidden, profile-free PowerShell process per script. */
const runPowerShellProbe: PowerShellProbe = (script, timeoutMs) => {
  const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: timeoutMs,
    windowsHide: true,
  })
  if (probe.status !== 0 || probe.stdout.length === 0) return undefined
  return probe.stdout.toString('utf8').trim()
}

/** The epoch-millisecond reading a probe printed, or undefined when unusable. */
function parseProbeEpochMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const started = Number(raw.trim())
  return Number.isFinite(started) ? started : undefined
}

/** Start time through Get-Process: precise, but empty for protected processes. */
function getProcessStartScript(pid: number): string {
  return '[DateTimeOffset]::FromFileTime((Get-Process -Id ' + String(pid)
    + ' -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToFileTime()).ToUnixTimeMilliseconds()'
}

/** Start time through Win32_Process: readable for System/svchost too. */
function cimStartScript(pid: number): string {
  return '$p=Get-CimInstance Win32_Process -Filter "ProcessId=' + String(pid)
    + '" -ErrorAction SilentlyContinue;if($p -ne $null){[DateTimeOffset]::FromFileTime($p.CreationDate.ToUniversalTime().ToFileTime()).ToUnixTimeMilliseconds()}'
}

/**
 * Windows start time (Unix epoch ms) of a live process.
 *
 * `Get-Process` is the precise first choice, but an unprivileged caller cannot
 * read `.StartTime` for a protected process (System, svchost): the property is
 * empty, so the probe returns nothing. Without a fallback, a crash leftover
 * lock whose PID was reused by such a process could never be proven stale and
 * blocked every startup until the lock was deleted by hand (issue #1629).
 * Win32_Process through CIM reports the same CreationDate for those processes
 * at the same millisecond precision, so it is the second identity source. The
 * probe is injectable so the fallback chain is testable off Windows.
 */
export function win32StartTimeMs(pid: number, probe: PowerShellProbe = runPowerShellProbe): number | undefined {
  // The pid is interpolated into a PowerShell script, so it must be a plain
  // positive integer before any probe runs.
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const direct = parseProbeEpochMs(probe(getProcessStartScript(pid), PROCESS_PROBE_TIMEOUT_MS))
  if (direct !== undefined) return direct
  return parseProbeEpochMs(probe(cimStartScript(pid), CIM_PROBE_TIMEOUT_MS))
}

/**
 * Best-effort start time (Unix epoch ms) of a live process. Used to prove
 * whether the ledger lock really belongs to the PID recorded in it, so a
 * crash leftover whose PID was reused by an unrelated process (issue #786)
 * is detected as stale instead of blocking startup forever. Returns
 * undefined when the platform probe is unavailable; callers fail closed.
 */
function processStartTimeMs(pid: number): number | undefined {
  if (process.platform === 'linux') return linuxStartTimeMs(pid)
  if (process.platform === 'win32') return win32StartTimeMs(pid)
  // Other POSIX (macOS...): ps lstart with a forced English locale, falling
  // back to the elapsed-seconds column when lstart cannot be parsed.
  const env = { ...process.env, LC_ALL: 'C' }
  const probe = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: PROCESS_PROBE_TIMEOUT_MS, env })
  if (probe.status === 0 && probe.stdout.length > 0) {
    const started = Date.parse(probe.stdout.toString('utf8').trim())
    if (Number.isFinite(started)) return started
  }
  const elapsed = spawnSync('ps', ['-o', 'etimes=', '-p', String(pid)], { timeout: PROCESS_PROBE_TIMEOUT_MS, env })
  if (elapsed.status !== 0 || elapsed.stdout.length === 0) return undefined
  const seconds = Number(elapsed.stdout.toString('utf8').trim())
  if (!Number.isFinite(seconds)) return undefined
  return Date.now() - seconds * 1000
}

function ownProcessStartTimeMs(): number | undefined {
  if (!ownStartTimeResolved) {
    ownStartTimeResolved = true
    ownStartTime = processStartTimeMs(process.pid)
  }
  return ownStartTime
}

/**
 * Bounded tolerance for legacy lock records. Locks written before the
 * ms-precise probe recorded `startedAt` from `ps -o lstart=` at whole-second
 * resolution; probing the SAME live process exactly (via /proc) then differs
 * in the sub-second remainder. Treating that as PID reuse would steal a live
 * owner's lock during a rolling upgrade and start a second ledger writer.
 * Records written by the ms-precise probe carry `probe: 'exact'` and are
 * compared strictly; anything else (older locks, second-granularity probes)
 * falls back to this bounded tolerance.
 */
const LEGACY_START_TOLERANCE_MS = 2000

/**
 * How long an unreadable lock must sit untouched before it may be reclaimed.
 * The owner writes and fsyncs its record immediately after creating the file
 * with O_EXCL, so a lock that cannot be parsed may still be mid-write by a
 * live owner; only one that has been unreadable for longer than any write can
 * take is treated as an unclean-shutdown leftover (issue #1528: a 0-byte lock
 * kept the Host half from mounting until it was deleted by hand).
 */
const UNREADABLE_LOCK_GRACE_MS = 60_000

/** Whether the recorded start time proves the recorded PID is another process. */
function startTimeMismatch(recorded: number, actual: number, exact: boolean): boolean {
  return exact ? recorded !== actual : Math.abs(recorded - actual) > LEGACY_START_TOLERANCE_MS
}

function betterExecution(a: ExecutionRecord, b: ExecutionRecord): ExecutionRecord {
  if (a.endedAt === undefined && b.endedAt !== undefined) return b
  if (b.endedAt === undefined && a.endedAt !== undefined) return a
  return (b.endedAt ?? b.startedAt) >= (a.endedAt ?? a.startedAt) ? b : a
}

function mergeTask(a: TaskRecord, b: TaskRecord): TaskRecord {
  // Existing Host state wins ties so an equally old browser backup cannot
  // roll authoritative fields back during multi-browser v1 migration.
  const newer = b.updatedAt > a.updatedAt ? b : a
  const byId = new Map<string, ExecutionRecord>()
  for (const entry of [...a.executions, ...b.executions]) {
    const previous = byId.get(entry.id)
    byId.set(entry.id, previous === undefined ? entry : betterExecution(previous, entry))
  }
  const executions = [...byId.values()].sort((x, y) => x.startedAt - y.startedAt)
  return { ...newer, executions: retainRecentExecutions(executions) }
}

/**
 * Repair parent links after a load or an import: a link whose parent row is
 * missing, cyclic, or names an archived parent while the child is on board is
 * dropped (the task becomes a root) instead of dropping the task. A chain
 * deeper than the current `maxSubtaskDepth` is deliberately KEPT: the limit
 * gates new links, it never deletes a stored one, and every lineage walk is
 * bounded by the limit anyway. The Host is the only writer of these links, so
 * this is a last-resort guard against a hand-edited or imported document.
 */
export function repairParentLinks(tasks: readonly TaskRecord[]): TaskRecord[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  return tasks.map(task => {
    if (task.parentId === undefined) return task
    const seen = new Set<string>([task.id])
    let current: TaskRecord | undefined = byId.get(task.parentId)
    let depth = 0
    while (current !== undefined) {
      // The first hop is the parent itself: an archived parent holding an
      // on-board child is outside the archive subtree invariant, and only an
      // import can produce it.
      if (seen.has(current.id) || (depth === 0 && current.archivedAt !== undefined && task.archivedAt === undefined)) {
        return { ...task, parentId: undefined }
      }
      seen.add(current.id)
      depth += 1
      current = current.parentId === undefined ? undefined : byId.get(current.parentId)
    }
    // A walk that never started (depth 0) means the parent row did not survive
    // the parse: the link is dangling and the task goes back to the root.
    return depth === 0 ? { ...task, parentId: undefined } : task
  })
}

function parseHostTasks(values: readonly unknown[]): TaskRecord[] {
  const rawById = new Map<string, Record<string, unknown>>()
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue
    const raw = value as Record<string, unknown>
    if (typeof raw.id === 'string') rawById.set(raw.id, raw)
  }
  return repairParentLinks(parseLedger(JSON.stringify(values))).map(task => {
    const rawSchedule = rawById.get(task.id)?.schedule
    if (typeof rawSchedule !== 'object' || rawSchedule === null) return task
    const schedule = rawSchedule as Record<string, unknown>
    // A one-shot carries no cron; its instant is validated by the wire gate and
    // the store repair, so there is nothing to salvage here.
    if (schedule.mode === 'once') return task
    if (typeof schedule.cron !== 'string' || isValidCron(schedule.cron)) return task
    return {
      ...task,
      schedule: {
        enabled: false,
        mode: 'cron',
        cron: schedule.cron,
        ...(typeof schedule.timeZone === 'string' && isValidTimeZone(schedule.timeZone) ? { timeZone: schedule.timeZone } : {}),
        nextRunAt: undefined,
        lastTriggeredAt: typeof schedule.lastTriggeredAt === 'number' && Number.isFinite(schedule.lastTriggeredAt)
          ? schedule.lastTriggeredAt
          : undefined,
        runCount: typeof schedule.runCount === 'number' && Number.isInteger(schedule.runCount) && schedule.runCount >= 0
          ? schedule.runCount
          : 0,
      },
    }
  })
}

export class HostTaskLedger {
  private document: LedgerDocument
  private readonly listeners = new Set<() => void>()
  private readonly requestCache = new Map<string, CachedRequest>()
  private readonly lockToken = crypto.randomUUID()
  private lockFd: number | undefined
  readonly file: string
  readonly lockFile: string
  /** Small sidecar for the 30 s scheduler heartbeat (lastTickAt only). */
  readonly schedulerFile: string

  /** Resolves the baseline the confirmation gate compares a binding against. */
  private readonly sessionDefault: () => TaskPermission

  /**
   * Session-default permission the confirmation gate compares against. Read
   * through the resolver on every use, so a baseline that follows the Host's
   * own default preset tracks a Settings change made while the board runs.
   */
  get sessionDefaultPermission(): TaskPermission {
    return this.sessionDefault()
  }

  /**
   * Deployment subtask depth limit (1..3): the lineage gate every write obeys.
   * The settings card edits it live, so {@link setMaxSubtaskDepth} mutates it
   * instead of remounting the row.
   */
  private depthLimit: number

  /** Live reader of the deployment's new-card defaults (a volatile config read). */
  private readonly cardDefaults: () => CardDefaults

  /**
   * Live reader of the daily token cap (0 = no gate). The scheduled path asks it
   * per due occurrence, so a cap raised after a skipped occurrence admits the
   * next one without a restart.
   */
  private readonly spendBudget: () => number

  /** Today's measured spend in tokens, or undefined when nothing can be measured. */
  private readonly spendUsed: (now: number) => number | undefined

  constructor(dir: string = join(dshHome(), 'task-board'), private readonly now: () => number = Date.now, options: { sessionDefaultPermission?: TaskPermission | (() => TaskPermission); maxSubtaskDepth?: number; cardDefaults?: () => CardDefaults; spendBudgetTokens?: () => number; spendUsedToday?: (now: number) => number | undefined } = {}) {
    // Resolved before the load/repair passes below: they can evaluate the gate.
    const baseline = options.sessionDefaultPermission
    this.sessionDefault = typeof baseline === 'function' ? baseline : () => baseline ?? DEFAULT_SESSION_PERMISSION
    this.depthLimit = normalizeSubtaskDepth(options.maxSubtaskDepth ?? DEFAULT_SUBTASK_DEPTH)
    this.cardDefaults = options.cardDefaults ?? (() => ({}))
    this.spendBudget = options.spendBudgetTokens ?? (() => DEFAULT_SPEND_BUDGET_TOKENS)
    this.spendUsed = options.spendUsedToday ?? (now => usedTokensToday(now))
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'ledger-v2.json')
    this.lockFile = join(dir, 'ledger-v2.lock')
    this.schedulerFile = join(dir, 'scheduler-v2.json')
    this.cleanStaleTemporaryFiles(dir)
    this.lockFd = this.acquireLock()
    try {
      this.document = this.load(dir)
      for (const request of this.document.recentRequests) {
        this.requestCache.set(request.requestId, { fingerprint: request.fingerprint })
      }
      this.repairSchedules(true)
      this.reconcileInterruptedStarts()
      // Boot recovery also folds every already-decided run: a team run whose
      // Lead recorded its verdict in an earlier process, and a lineage whose
      // last settle never reached its parent, both leave the running column here.
      this.finalizeReadyRuns(false)
      // Persist a freshly generated ledger identity and any recovery error
      // immediately, even when there are no tasks to trigger a later action.
      this.commit(false)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  /** Current subtask depth limit (1..3). */
  get maxSubtaskDepth(): number {
    return this.depthLimit
  }

  /**
   * Apply a live settings edit of the subtask depth limit. A no-op when the
   * normalized limit is unchanged, so a coarse volatile invalidation that
   * changed nothing emits nothing.
   */
  setMaxSubtaskDepth(depth: number): void {
    const next = normalizeSubtaskDepth(depth)
    if (next === this.depthLimit) return
    this.depthLimit = next
    this.notify()
  }

  /** Remove leftover *.tmp-* files from previous crashes or interrupted writes. */
  private cleanStaleTemporaryFiles(dir: string): void {
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.includes('.tmp-')) {
          try {
            unlinkSync(join(dir, entry))
          } catch {
            // Best-effort cleanup
          }
        }
      }
    } catch {
      // Directory may not exist yet or cannot be read
    }
  }

  /** Revision + scheduler without any task cloning; feeds the SSE event frame. */
  summary(): { revision: number; scheduler: TaskBoardSchedulerSnapshot } {
    const { importedSources: _imports, ...scheduler } = this.document.scheduler
    return { revision: this.document.revision, scheduler: { ...scheduler } }
  }

  state(): LedgerState {
    const { revision, scheduler } = this.summary()
    return { revision, tasks: tasksForRead(this.document.tasks), scheduler }
  }

  /**
   * Runtime-only projection for the Host poll. It copies just primitive
   * identifiers and timestamps, never the complete task/execution history or
   * an authoritative mutable object from the ledger.
   */
  runtimeView(): LedgerRuntimeView {
    let armedSchedules = 0
    let runningCards = 0
    // Stored run groups a team-mode card opened before team runs were retired:
    // every other member of those groups ran as a teammate inside that card's
    // Lead session, which is why its turn is read even while its session runs.
    const teamGroups = new Set<string>()
    for (const task of this.document.tasks) {
      if (task.teamRun !== true) continue
      for (const execution of task.executions) {
        if (execution.runGroupId !== undefined) teamGroups.add(execution.runGroupId)
      }
    }
    const openExecutions: OpenExecutionReference[] = []
    const openSessionIds: string[] = []
    for (const task of this.document.tasks) {
      if (task.archivedAt === undefined && task.schedule?.enabled === true) armedSchedules += 1
      if (task.status === 'running') runningCards += 1
      for (const execution of task.executions) {
        if (execution.endedAt !== undefined) continue
        if (execution.sessionId !== undefined) openSessionIds.push(execution.sessionId)
        // A stored run-group parent already knows its own outcome; the monitor
        // has nothing left to inspect, and its members' settles finalize it.
        if (execution.ownResult !== undefined) continue
        openExecutions.push({
          taskId: task.id,
          executionId: execution.id,
          sessionId: execution.sessionId,
          startedAt: execution.startedAt,
          teamMember: task.teamRun !== true
            && execution.runGroupId !== undefined
            && teamGroups.has(execution.runGroupId),
        })
      }
    }
    return {
      armedSchedules,
      openExecutions,
      openSessionIds,
      needsSessionState: openExecutions.length > 0 || runningCards > 0,
    }
  }

  /** Count armed, non-archived schedules without cloning task histories. */
  armedScheduleCount(): number {
    let count = 0
    for (const task of this.document.tasks) {
      if (task.archivedAt === undefined && task.schedule?.enabled === true) count += 1
    }
    return count
  }

  /**
   * The earliest armed `nextRunAt` strictly after the supplied Host time, or
   * undefined when no schedule is armed in the future. This is the instant the
   * Host arms its native timer at, so the board wakes exactly when work is due
   * instead of polling a fixed heartbeat.
   * @param now - current Host time in ms epoch.
   * @returns the nearest future trigger, or undefined when none is armed.
   */
  nextArmedRunAt(now: number): number | undefined {
    let nearest: number | undefined
    for (const task of this.document.tasks) {
      if (task.archivedAt !== undefined) continue
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined) continue
      if (schedule.nextRunAt <= now) continue
      if (nearest === undefined || schedule.nextRunAt < nearest) nearest = schedule.nextRunAt
    }
    return nearest
  }

  /** Return value-only references for schedules due at the supplied Host time. */
  dueSchedules(now: number): DueScheduleReference[] {
    const due: DueScheduleReference[] = []
    for (const task of this.document.tasks) {
      if (task.archivedAt !== undefined) continue
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) continue
      due.push({
        taskId: task.id,
        mode: schedule.mode,
        ...(schedule.cron === undefined ? {} : { cron: schedule.cron }),
        timeZone: scheduleZone(schedule),
        nextRunAt: schedule.nextRunAt,
      })
    }
    return due
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    const fd = this.lockFd
    if (fd === undefined) return
    this.lockFd = undefined
    closeSync(fd)
    try {
      const owner = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { token?: unknown }
      if (owner.token === this.lockToken) unlinkSync(this.lockFile)
    } catch {
      // A missing or externally replaced lock must not be removed blindly.
    }
  }

  applyRequest(
    requestId: string,
    action: TaskBoardAction,
    initiator?: string,
  ): { state: LedgerState; runs?: OpenedRun[] } {
    const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex')
    const cached = this.requestCache.get(requestId)
    if (cached !== undefined) {
      if (cached.fingerprint !== fingerprint) throw new Error('request id was reused with a different action')
      return { state: this.state() }
    }

    // Add the fingerprint before apply(): successful actions persist it in the
    // same atomic ledger write as their state transition.
    this.requestCache.set(requestId, { fingerprint })
    while (this.requestCache.size > MAX_REQUEST_CACHE) this.requestCache.delete(this.requestCache.keys().next().value as string)
    this.syncRecentRequests()
    try {
      return this.apply(action, initiator)
    } catch (error) {
      this.requestCache.delete(requestId)
      this.syncRecentRequests()
      throw error
    }
  }

  /**
   * Open the one run a due schedule triggers: an empty array means nothing ran
   * (already running, a card whose elevated permission is still unconfirmed, a
   * one-shot whose instant was missed, or an exhausted budget), and the rule's
   * own state says which.
   *
   * The run budget is enforced HERE, inside the single ledger writer: a rule
   * whose counter already reached its cap is stopped instead of opened, so no
   * restart, repeated timer fire or re-arm can overrun it.
   * @param taskId - the task whose rule came due.
   * @param triggeredAt - the instant the occurrence came due.
   * @returns the executions this occurrence opened.
   */
  openScheduled(taskId: string, triggeredAt: number): OpenedRun[] {
    const task = this.document.tasks.find(item => item.id === taskId)
    if (task === undefined || task.archivedAt !== undefined) return []
    const schedule = task.schedule
    if (schedule === undefined || !schedule.enabled) return []

    // A rule that has spent its budget never opens another run. The stop is
    // recorded here rather than trusted to the firing timer, so a rule that
    // was hand-edited into an exhausted state still terminates visibly.
    if (scheduleExhausted(schedule)) {
      this.progressSchedule(taskId, {
        consumed: 0,
        endedReason: schedule.mode === 'once' ? 'fired' : 'limit',
      }, triggeredAt)
      return []
    }

    const refusal = this.bindingRefusal(task)
    if (refusal !== undefined) {
      // An unconfirmed above-default permission must never run unattended: the
      // whole tree is refused and the occurrence is skipped without consuming
      // the run budget, exactly like the already-running refusal.
      this.document.scheduler.error = `scheduled run refused for task ${taskId}: ${bindingRefusalMessage(refusal, this.sessionDefaultPermission, 'schedule')}`
      this.skipOccurrence(taskId, 'permission', triggeredAt)
      return []
    }
    if (hasOpenExecution(task)) {
      this.skipOccurrence(taskId, 'busy', triggeredAt)
      return []
    }

    const spendRefusal = this.spendRefusal(triggeredAt)
    if (spendRefusal !== undefined) {
      // A scheduled occurrence has no client to throw at, so the refusal lands
      // on the board's own scheduler error and the occurrence is skipped without
      // consuming the rule's run budget: raising the cap, or the day rolling
      // over, admits the next trigger instead of leaving a spent rule behind.
      this.document.scheduler.error = `scheduled run refused for task ${taskId}: ${spendRefusal}`
      this.skipOccurrence(taskId, 'limit', triggeredAt)
      return []
    }

    if (schedule.mode === 'once') {
      // The single planned instant is due: open its one run and stop the rule
      // in the same commit, so the budget can never produce a second one.
      return this.startRun(task, triggeredAt, undefined, false, {
        consumed: 1,
        lastTriggeredAt: triggeredAt,
        endedReason: 'fired',
      })
    }

    const next = nextRunAtMs(schedule.cron ?? '', schedule.nextRunAt ?? triggeredAt, scheduleZone(schedule))
    if (next === undefined) {
      this.progressSchedule(taskId, { consumed: 0, endedReason: 'no-target' }, triggeredAt)
      return []
    }
    const consumed = schedule.runCount + 1
    const budget = scheduleRunBudget(schedule)
    const spent = budget !== undefined && consumed >= budget
    return this.startRun(task, triggeredAt, undefined, false, {
      consumed: 1,
      nextRunAt: spent ? undefined : next,
      lastTriggeredAt: triggeredAt,
      ...(spent ? { endedReason: 'limit' as const } : {}),
    })
  }

  /**
   * Why a due occurrence may not open a run because the day already spent the
   * cap, or undefined when it may. A cap of 0 — the default — answers before the
   * measurement is read, so a board with no gate reads no ledger file.
   * @param now - clock instant (ms epoch).
   * @returns the refusal message, when the cap is reached.
   */
  private spendRefusal(now: number): string | undefined {
    const cap = this.spendBudget()
    if (!(cap > 0)) return undefined
    const used = this.spendUsed(now)
    if (used === undefined || !spendCapReached(used, cap)) return undefined
    return spendCapMessage(used, cap)
  }

  /**
   * Record a due occurrence that opened no execution: roll a recurring rule to
   * its next occurrence (budget untouched), or stop it when there is none. A
   * one-shot has no second occurrence, so it always stops here with the reason.
   */
  private skipOccurrence(taskId: string, reason: ScheduleStopReason, now: number): void {
    const task = this.document.tasks.find(item => item.id === taskId)
    const schedule = task?.schedule
    if (schedule === undefined) return
    if (schedule.mode === 'once') {
      this.progressSchedule(taskId, { consumed: 0, endedReason: reason }, now)
      return
    }
    const next = nextRunAtMs(schedule.cron ?? '', schedule.nextRunAt ?? now, scheduleZone(schedule))
    if (next === undefined) this.progressSchedule(taskId, { consumed: 0, endedReason: 'no-target' }, now)
    else this.progressSchedule(taskId, { consumed: 0, nextRunAt: next, skippedReason: reason }, now)
  }

  /** Apply a schedule-occurrence transition and persist it atomically. */
  private progressSchedule(taskId: string, progress: ScheduleProgress, now: number): void {
    this.document.tasks = [...applyScheduleProgress(this.document.tasks, taskId, progress, now)]
    this.commit()
  }

  /**
   * Refund the one scheduled run an occurrence consumed before its launch
   * failed without creating a session (see
   * {@link applyScheduleRefund}). Called by the service on the failed-launch
   * path only; a manual run and a launch that did reach a session are never
   * refunded. A no-op for a task with no rule, so a failed run does not touch
   * anything.
   * @param taskId - the task whose occurrence is being refunded.
   * @param now - clock instant (ms epoch).
   */
  refundScheduledOccurrence(taskId: string, now: number): void {
    const before = this.document.tasks.find(item => item.id === taskId)?.schedule
    if (before === undefined) return
    const next = applyScheduleRefund(this.document.tasks, taskId, now, timeZone())
    const after = next.find(item => item.id === taskId)?.schedule
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.document.tasks = [...next]
    this.commit()
  }

  /**
   * Boot / resume recovery: skip every occurrence that came due while the board
   * was not running through it. A recurring rule rolls to its next future
   * target; a one-shot whose instant has passed is stopped as missed, because
   * there is no later occurrence left to run. Rendering the missed occurrence
   * is deliberately not attempted: the ACL of a card that fired hours ago is
   * stale, and the board's own recovery contract is "missed triggers are
   * skipped, never replayed".
   */
  skipMissed(now: number): void {
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) return task
      changed = true
      if (schedule.mode === 'once') {
        return withSchedule(task, { enabled: false, nextRunAt: undefined, endedAt: now, endedReason: 'missed' }, now)
      }
      const next = nextRunAtMs(schedule.cron ?? '', now, scheduleZone(schedule))
      if (next === undefined) {
        return withSchedule(task, { enabled: false, nextRunAt: undefined, endedAt: now, endedReason: 'no-target' }, now)
      }
      return withSchedule(task, { nextRunAt: next, skippedAt: now, skippedReason: 'missed' }, now)
    })
    if (changed) this.commit()
  }

  setScheduler(patch: Partial<TaskBoardSchedulerSnapshot>): void {
    this.document.scheduler = { ...this.document.scheduler, ...patch }
    // The 30 s heartbeat only moves lastTickAt; rewriting the whole ledger
    // for it made idle idle cost O(ledger bytes) every tick. Persist it to a
    // tiny sidecar instead; any other patch still goes through the full
    // atomic commit.
    if (patch.lastTickAt !== undefined && Object.keys(patch).every(key => key === 'lastTickAt')) {
      try {
        this.writeSchedulerSidecar()
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') {
          // Disk is full; sidecar persistence fails, but in-memory heartbeat
          // remains updated. Swallow to prevent unhandled log cascade crashes.
          return
        }
        throw error
      }
      return
    }
    this.commit(false)
  }

  /**
   * Settle one execution. A NEW run is a single-member group, so it settles on
   * its own turn. A run group the Host opened before it stopped spreading one
   * run across a subtree is folded here instead: a stored participant records
   * its OWN outcome and only finalizes once every child execution in its group
   * has settled, so a parent card leaves 'running' with the whole group's
   * verdict rather than its own turn alone.
   *
   * `summary` is what the run left behind (see `ExecutionSummary`), passed in
   * by whichever reader observed the session. It is informational: a caller
   * without one settles exactly as before, and a settlement never waits on it.
   */
  settle(taskId: string, executionId: string, outcome: ExecutionOutcome, error?: string, summary?: ExecutionSummary): void {
    const now = this.now()
    const task = this.document.tasks.find(item => item.id === taskId)
    const execution = task?.executions.find(entry => entry.id === executionId)
    if (task === undefined || execution === undefined || execution.endedAt !== undefined) return
    const groupId = execution.runGroupId
    if (groupId === undefined) {
      this.document.tasks = this.document.tasks.map(item => item.id === taskId
        ? settleExecution(item, executionId, outcome, now, error, summary)
        : item)
      this.commit()
      return
    }
    let changed = false
    if (execution.ownResult === undefined) {
      // A stored run-group parent records its own turn's closing text with its
      // own outcome; the fold that finalizes the card carries no session of its
      // own and leaves what is already here in place.
      this.document.tasks = this.document.tasks.map(item => item.id !== taskId ? item : {
        ...item,
        updatedAt: now,
        executions: item.executions.map(entry => entry.id === executionId
          ? { ...entry, ownResult: outcome, ownError: error, ...(summary === undefined ? {} : { summary }) }
          : entry),
      })
      changed = true
    }
    // A team run is governed by its Lead: the Lead's own outcome closes whatever
    // the Team still holds open, so the tree can never wait on a teammate that
    // will never report one.
    if (task.teamRun === true
      && this.closeTeamMembers(taskId, groupId, execution.ownResult ?? outcome, execution.ownError ?? error, now)) changed = true
    if (this.settleCascade(taskId, groupId, now)) changed = true
    // The run's own card may now be terminal: hand its verdict down to the
    // subtasks it was expected to dispatch.
    if (this.inheritVerdictForDescendants(taskId, executionId, groupId, now)) changed = true
    if (changed) this.commit()
  }

  /**
   * Record the run's verdict on the outstanding descendants its root was asked
   * to dispatch.
   *
   * A card with unfinished subtasks runs as an autonomous dispatcher: its
   * session reads the subtasks, dispatches them with subagents, and is asked to
   * write their conclusions back with
   * `task_board_manage({action:'record-external-outcome'})` before it finishes.
   * A run that never wrote one back would leave those cards parked with no
   * record of what the parent decided about them, so once the RUN CARD's
   * execution reached a decisive terminal record, every outstanding descendant
   * this run opened no execution for inherits that verdict as an external
   * record.
   *
   * Idempotent by construction: a card that already carries an execution in
   * this run group (the fold owns it), an open execution (it is running on its
   * own), or a terminal record stamped after this run started (the dispatching
   * agent's own backfill, or an earlier pass of this one) is left alone. Only a
   * decisive verdict is inherited: a cancelled run judged nothing about the
   * subtasks, and a subtask already in the done column has nothing left to
   * inherit.
   * @param taskId - the card whose execution just settled.
   * @param executionId - that execution.
   * @param groupId - its run group.
   * @param now - clock instant (ms epoch).
   * @returns whether the document changed.
   */
  private inheritVerdictForDescendants(taskId: string, executionId: string, groupId: string, now: number): boolean {
    const root = this.document.tasks.find(item => item.id === taskId)
    if (root === undefined) return false
    const execution = root.executions.find(entry => entry.id === executionId)
    if (execution?.endedAt === undefined || execution.result === undefined) return false
    if (execution.result !== 'succeeded' && execution.result !== 'failed') return false
    const verdict: ExecutionOutcome = execution.result
    // Only the card this run opened settles a tree it did not run itself: a
    // member of a historical multi-member group must not hand its own verdict
    // down to its siblings.
    if (ancestorChain(this.document.tasks, root).some(ancestor =>
      ancestor.executions.some(entry => entry.runGroupId === groupId))) return false
    const descendants = new Set(lineageOutstandingDescendants(this.document.tasks, root.id, this.maxSubtaskDepth).map(task => task.id))
    if (descendants.size === 0) return false
    const note = `本次执行由父卡「${root.title}」统一判定，本卡未单独开会话执行；结论继承自父卡运行`
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      if (!descendants.has(task.id)) return task
      if (task.executions.some(entry => entry.runGroupId === groupId)) return task
      if (task.executions.some(entry => entry.endedAt === undefined)) return task
      if (task.executions.some(entry => entry.endedAt !== undefined && entry.startedAt >= execution.startedAt)) return task
      changed = true
      const inherited: ExecutionRecord = {
        id: crypto.randomUUID(),
        sessionId: undefined,
        startedAt: now,
        endedAt: now,
        result: verdict,
        error: note,
        initiatedBy: PARENT_RUN_INITIATOR_PREFIX + root.id,
        external: true,
        runGroupId: groupId,
      }
      return {
        ...task,
        status: settledStatus(task, verdict),
        updatedAt: now,
        executions: retainRecentExecutions([...task.executions, inherited]),
      }
    })
    return changed
  }

  attachSession(taskId: string, executionId: string, sessionId: string): void {
    const now = this.now()
    const task = this.document.tasks.find(item => item.id === taskId)
    // A run the Lead's verdict already closed keeps its record: attaching a
    // session to a settled execution would rewrite history the Host no longer
    // observes (a teammate spawn that resolved after its Team was closed).
    if (task?.executions.find(entry => entry.id === executionId)?.endedAt !== undefined) return
    this.document.tasks = this.document.tasks.map(item => item.id !== taskId ? item : {
      ...item,
      updatedAt: now,
      executions: item.executions.map(entry => entry.id === executionId ? { ...entry, sessionId } : entry),
    })
    this.commit()
  }

  allTasks(): readonly TaskRecord[] {
    return this.document.tasks
  }

  getTask(id: string): TaskRecord | undefined {
    return this.document.tasks.find(item => item.id === id)
  }

  saveTaskRecord(task: TaskRecord): void {
    const exists = this.document.tasks.some(item => item.id === task.id)
    if (exists) {
      this.document.tasks = this.document.tasks.map(item => item.id === task.id ? task : item)
    } else {
      this.document.tasks = [...this.document.tasks, task]
    }
    this.commit()
  }

  private apply(action: TaskBoardAction, initiator?: string): { state: LedgerState; runs?: OpenedRun[] } {
    const now = this.now()
    let runs: OpenedRun[] | undefined
    switch (action.kind) {
      case 'import': {
        const sources = new Set(this.document.scheduler.importedSources ?? [])
        if (sources.has(action.sourceId)) return { state: this.state() }
        const invalidScheduleIds = action.tasks
          .filter(task => task.schedule !== undefined
            && task.schedule.mode !== 'once'
            && !isValidCron(task.schedule.cron ?? ''))
          .map(task => task.id)
        const incoming = parseHostTasks(action.tasks)
        const merged = new Map(this.document.tasks.map(task => [task.id, task]))
        for (const task of incoming) merged.set(task.id, merged.has(task.id) ? mergeTask(merged.get(task.id)!, task) : task)
        // An imported child can name a parent this ledger has never seen (a
        // partial export): the dangling link is dropped, the task survives.
        this.document.tasks = repairParentLinks([...merged.values()])
        this.document.scheduler.importedSources = [...sources, action.sourceId]
        this.document.scheduler.error = invalidScheduleIds.length === 0
          ? undefined
          : `invalid cron disabled for task(s): ${invalidScheduleIds.join(', ')}`
        this.repairSchedules(true, false)
        this.reconcileInterruptedStarts(false)
        // An imported document may carry a decided-but-open run; fold it in the
        // same action (apply() commits once at the end).
        this.finalizeReadyRuns(false)
        break
      }
      case 'create': {
        if (this.document.tasks.some(task => task.id === action.id)) throw new Error('task id already exists')
        const requested = action.input.schedule
        if (requested?.enabled === true && !this.validScheduleRequest(requested, now)) {
          throw new Error('invalid schedule')
        }
        const input = action.input.freeze === undefined || initiator === undefined || initiator === ''
          ? action.input
          : { ...action.input, freeze: { ...action.input.freeze, frozenBy: initiator } }
        const result = applyCreateTask(this.document.tasks, input, now, action.id, this.maxSubtaskDepth, timeZone(), this.cardDefaults())
        if (result.task === undefined) throw new Error(result.error ?? 'invalid task')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'update': {
        const task = this.document.tasks.find(task => task.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        // The task content (title/description/prompt) is the record of what
        // was planned; once an execution started it must not change under a
        // running session or an executed history. Execution targets stay
        // editable (they only affect future runs).
        if (hasContentPatch(action.patch) && !canEditTaskContent(task)) {
          throw new Error('task has already been executed')
        }
        if ('title' in action.patch && action.patch.title?.trim() === '') throw new Error('title is required')
        // A replaced snapshot is re-stamped with the updating session (the
        // initiator), so a swapped freeze cannot keep the old author stamp.
        const patch = action.patch.freeze === null || action.patch.freeze === undefined || initiator === undefined || initiator === ''
          ? action.patch
          : { ...action.patch, freeze: { ...action.patch.freeze, frozenBy: initiator } }
        this.document.tasks = [...applyUpdateTask(this.document.tasks, action.taskId, patch, now)]
        break
      }
      case 'delete': {
        const task = this.document.tasks.find(task => task.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (hasOpenExecution(task)) throw new Error('running task cannot be deleted')
        // Subtasks keep their link: deleting the parent would leave dangling
        // children, so the user detaches or deletes them explicitly first.
        if (this.document.tasks.some(item => item.parentId === action.taskId)) {
          throw new Error('task has subtasks; detach or delete them first')
        }
        this.document.tasks = [...applyDeleteTask(this.document.tasks, undefined, action.taskId).tasks]
        break
      }
      case 'set-parent': {
        const result = applySetParent(this.document.tasks, action.taskId, action.parentId, now, this.maxSubtaskDepth)
        if (!result.applied) throw new Error(result.error ?? 'parent link refused')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'move': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        // The lock belongs to an open execution, not to the column: a card
        // parked in 'running' by hand has no session and stays movable, while
        // a card the runner is executing cannot be moved out from under it.
        if (hasOpenExecution(task)) throw new Error('running task cannot be moved')
        if (!canMoveManually(task.status, action.status)) throw new Error('invalid manual status')
        this.document.tasks = this.document.tasks.map(item => item.id === action.taskId ? withStatus(item, action.status, now) : item)
        break
      }
      case 'archive': {
        if (this.subtreeHasOpenExecution(action.taskId)) throw new Error('running task cannot be archived')
        const result = applyArchiveTask(this.document.tasks, action.taskId, now, this.maxSubtaskDepth)
        if (!result.archived) throw new Error('task cannot be archived')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'record-external-outcome': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        // The one guardrail that matters: while the Host still owns a run it is
        // the only authority on the card, so an outside agent may not write the
        // terminal verdict over it. This is also what keeps a stale report from
        // racing the session it claims to have replaced.
        if (hasOpenExecution(task)) throw new Error('running task cannot receive an external outcome')
        const execution: ExecutionRecord = {
          // A fresh id, exactly like a Host-launched run: the external work is a
          // new attempt in the history, never an overwrite of an earlier record.
          id: crypto.randomUUID(),
          sessionId: undefined,
          startedAt: now,
          endedAt: now,
          result: action.result,
          error: action.summary,
          initiatedBy: action.initiatedBy,
          external: true,
        }
        this.document.tasks = this.document.tasks.map(item => item.id !== action.taskId
          ? item
          : {
            ...item,
            status: settledStatus(item, action.result),
            updatedAt: now,
            executions: retainRecentExecutions([...item.executions, execution]),
          })
        break
      }
      case 'settle': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        if (!task.executions.some(entry => entry.endedAt === undefined)) throw new Error('task has no open execution')
        // Force-close the executions this card governs. The verdict is
        // 'cancelled', never 'succeeded': a card whose execution produced no
        // evidence of a completed turn must not be recorded as finished work,
        // and a cancelled settlement returns the card to the todo column so the
        // operator can run it again. Nothing else clears a running card: move,
        // archive and delete all refuse one, which is what made a stuck card
        // unrecoverable from the board.
        const reason = 'execution closed manually by '
          + (initiator === undefined || initiator === '' ? 'the operator' : initiator)
          + ': no verdict was recorded'
        for (const member of subtreeTasks(this.document.tasks, action.taskId, this.maxSubtaskDepth)) {
          for (const execution of member.executions) {
            if (execution.endedAt !== undefined) continue
            this.document.tasks = this.document.tasks.map(item => item.id !== member.id
              ? item
              : settleExecution(item, execution.id, 'cancelled', now, reason))
          }
        }
        // Fold whatever became ready in the same action: an ancestor whose last
        // member this closed leaves the running column with it.
        this.finalizeReadyRuns(false)
        break
      }
      case 'restore': {
        if (this.subtreeHasOpenExecution(action.taskId)) throw new Error('running task cannot be restored')
        const result = applyRestoreTask(this.document.tasks, action.taskId, now, this.maxSubtaskDepth)
        if (!result.archived) throw new Error('task is not archived')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'confirm-permission': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.permissionConfirmedAt !== undefined) break
        this.document.tasks = this.document.tasks.map(item => item.id === action.taskId
          ? { ...item, permissionConfirmedAt: now, updatedAt: now }
          : item)
        break
      }
      case 'rename-tag': {
        const result = applyRenameTag(this.document.tasks, action.from, action.to, now)
        if (result.error !== undefined) throw new Error(result.error)
        if (result.changed) this.document.tasks = [...result.tasks]
        break
      }
      case 'delete-tag': {
        const result = applyDeleteTag(this.document.tasks, action.name, now)
        if (result.error !== undefined) throw new Error(result.error)
        if (result.changed) this.document.tasks = [...result.tasks]
        break
      }
      case 'set-schedule': {
        const task = this.document.tasks.find(task => task.id === action.taskId)
        if (task?.archivedAt !== undefined) throw new Error('archived task is read-only')
        const result = applySetSchedule(this.document.tasks, action.taskId, action.patch, now, timeZone())
        if (!result.applied) throw new Error('invalid schedule')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'rework':
      case 'rerun':
      case 'run': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task?.archivedAt !== undefined) throw new Error('archived task is read-only')
        if (task === undefined || hasOpenExecution(task)) throw new Error('task is already running or missing')
        // A rework asks for a second attempt at work this card's own conversation
        // already holds; the ledger alone decides whether that conversation
        // exists, so the run can never be opened with instructions no session
        // ever saw.
        const rework = action.kind === 'rework' ? this.reworkInput(task, action.instructions) : undefined
        // The confirmation gate judges the RESOLVED binding: a subtask that
        // inherits an elevated permission from its parent is exactly as
        // unconfirmed as the parent would be without its own stamp.
        const refusal = this.bindingRefusal(task)
        if (refusal !== undefined) throw new Error(bindingRefusalMessage(refusal, this.sessionDefaultPermission, 'run'))
        runs = this.startRun(task, now, initiator, action.kind !== 'run', undefined, rework)
        break
      }
      default: {
        // Defence in depth. Every kind above is reachable only through
        // TaskBoardHostService.apply(), which validates the kind first; this
        // default exists so a future call path that reaches the ledger directly
        // fails loudly instead of falling through to the commit below — which is
        // exactly what an unknown kind did while the switch had no default:
        // unchanged document, new revision.
        throw new Error(`unknown task board action kind: ${String((action as { kind?: unknown }).kind)}`)
      }
    }
    // startRun committed the opened execution itself; committing again here
    // would bump the revision twice for one action.
    if (runs === undefined || runs.length === 0) this.commit()
    return { state: this.state(), ...(runs === undefined ? {} : { runs }) }
  }

  /**
   * Whether a creation-time schedule request is usable. A one-shot must carry
   * a whole-millisecond instant in the future; a recurring rule must carry a
   * valid expression with a reachable occurrence and, when capped, a positive
   * whole run budget. An unusable zone is refused rather than reinterpreted as
   * the Host zone.
   */
  private validScheduleRequest(request: {
    readonly enabled: boolean
    readonly mode?: ScheduleMode
    readonly cron?: string
    readonly at?: number
    readonly timeZone?: string
    readonly maxRuns?: number
  }, now: number): boolean {
    if (request.timeZone !== undefined && !isValidTimeZone(request.timeZone)) return false
    if (request.mode === 'once') {
      return typeof request.at === 'number' && Number.isInteger(request.at) && request.at > now
    }
    const cron = (request.cron ?? '').trim()
    if (cron === '' || !isValidCron(cron)) return false
    if (request.maxRuns !== undefined && (!Number.isInteger(request.maxRuns) || request.maxRuns < 1)) return false
    return nextRunAtMs(cron, now, request.timeZone ?? timeZone()) !== undefined
  }

  /**
   * The binding that makes a run illegal, if any.
   *
   * Only the card being run gets a session, so only ITS resolved binding gates
   * the run: a subtask's own elevated permission is that subtask's gate when the
   * subtask is run, and no longer blocks its parent from running.
   * @param root - the task being run.
   * @returns the first refusal, or undefined when the run may start.
   */
  private bindingRefusal(root: TaskRecord): { kind: 'root' | 'inherited'; title: string } | undefined {
    const resolved = resolveExecutionTargets(root, this.document.tasks, this.maxSubtaskDepth)
    if (!requiresPermissionConfirmation(resolved, this.sessionDefaultPermission)) return undefined
    return { kind: root.parentId === undefined ? 'root' : 'inherited', title: root.title }
  }

  /**
   * The rework block a rework request opens its execution with, or the refusal
   * that names why there is nothing to rework.
   *
   * Read from the ledger alone: a card that never ran, and a card whose runs
   * recorded no session, have no conversation to send the reviewer's
   * instructions into. Minting one would hand those instructions to an agent
   * that never saw the work being sent back, which is the opposite of what a
   * rework asks for.
   * @param task - the card being reworked.
   * @param instructions - the reviewer's instructions, already validated.
   * @returns the block recorded on the opened execution.
   */
  private reworkInput(task: TaskRecord, instructions: string): ExecutionRework {
    if (task.executions.length === 0) throw new Error('task ' + task.id + ' has never executed; there is no run to rework')
    const settled = [...task.executions].reverse().find(entry => entry.endedAt !== undefined && entry.sessionId !== undefined)
    if (settled?.sessionId === undefined) throw new Error('task ' + task.id + ' records no execution session to continue')
    return { instructions }
  }

  /** Whether a task or any of its subtasks still has an open execution. */
  private subtreeHasOpenExecution(id: string): boolean {
    return subtreeTasks(this.document.tasks, id, this.maxSubtaskDepth)
      .some(task => hasOpenExecution(task))
  }

  /** The descendants of a card that still hold work, as the launch prompt names them. */
  outstandingDescendants(taskId: string): TaskRecord[] {
    return lineageOutstandingDescendants(this.document.tasks, taskId, this.maxSubtaskDepth)
  }

  /** Whether a card still has a subtask outside the done column. */
  hasOutstandingDescendants(taskId: string): boolean {
    return hasOutstandingDescendants(this.document.tasks, taskId, this.maxSubtaskDepth)
  }

  /**
   * Open ONE execution for the requested card, under a fresh run group, and
   * commit the ledger once. The group stays single-member on purpose: a run
   * never opens a session for a subtask (that card's own agent dispatches
   * subagents inside this session), and the group id is what later lets the
   * settlement fold a HISTORICAL multi-member group it opened before this
   * behavior changed.
   * @param root - the task the user ran.
   * @param now - clock instant (ms epoch).
   * @param initiator - the DSH session that asked for the run (audit only).
   * @param rerun - true to reset the root to 'todo' before starting it.
   * @param progress - when set, this run was a due occurrence and the root's
   *   rule is advanced (counter, next target, stop/skip record) in the same
   *   atomic commit that opened the execution.
   * @param rework - the reviewer's instructions, when this run redoes previous
   *   work; recorded on the execution it opens.
   */
  private startRun(root: TaskRecord, now: number, initiator?: string, rerun = false, progress?: ScheduleProgress, rework?: ExecutionRework): OpenedRun[] {
    const before = this.document.tasks
    const [participant] = cascadeTargets(before, root.id)
    if (participant === undefined || participant.archivedAt !== undefined) return []
    if (hasOpenExecution(participant)) return []
    const groupId = crypto.randomUUID()
    const base = rerun ? withStatus(participant, 'todo', now) : participant
    const opened = startExecution(base, now, crypto.randomUUID(), initiator, groupId, rework)
    let tasks: readonly TaskRecord[] = before.map(task => task.id === participant.id ? opened.task : task)
    if (progress !== undefined) tasks = applyScheduleProgress(tasks, root.id, progress, now)
    this.document.tasks = [...tasks]
    this.commit()
    return [{ task: resolveExecutionTargets(opened.task, before, this.maxSubtaskDepth), execution: opened.execution }]
  }

  /**
   * Finalize every stored run-group parent that is ready, walking from `taskId`
   * up the lineage: a member settles once its own outcome is recorded and none
   * of its group children is still open, and its verdict folds those children in
   * (failure dominates, then cancellation). A single-member group — every run
   * this Host opens now — settles on its own turn exactly as any plain run does.
   */
  private settleCascade(taskId: string, groupId: string, now: number): boolean {
    let changed = false
    const visited = new Set<string>()
    let current: string | undefined = taskId
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const task: TaskRecord | undefined = this.document.tasks.find(item => item.id === current)
      if (task === undefined) break
      const execution = openGroupExecution(task, groupId)
      if (execution === undefined || execution.ownResult === undefined) break
      if (pendingCascadeChildren(this.document.tasks, current, groupId).length > 0) break
      const entries: Array<{ result: ExecutionOutcome; error?: string }> = [
        { result: execution.ownResult, ...(execution.ownError === undefined ? {} : { error: execution.ownError }) },
      ]
      for (const child of this.document.tasks) {
        if (child.parentId !== current) continue
        const childExecution = child.executions.find(entry => entry.runGroupId === groupId && entry.result !== undefined)
        if (childExecution?.result === undefined) continue
        entries.push({ result: childExecution.result, ...(childExecution.error === undefined ? {} : { error: childExecution.error }) })
      }
      const combined = combineCascadeOutcome(entries)
      this.document.tasks = this.document.tasks.map(item => item.id === current
        ? settleExecution(item, execution.id, combined.result, now, combined.error)
        : item)
      changed = true
      current = task.parentId
    }
    return changed
  }

  /**
   * Close every run that is already decided, and fold every lineage whose
   * members are all settled. The Host poll calls this on every tick, so a run
   * can no longer be left in the running column by a settle nobody observed:
   *
   * - A stored team run is governed by its Lead. Once the Lead's own outcome is
   *   recorded, its still-open members are settled with that verdict. A
   *   teammate is a durable member of the Team and may never report a turn of
   *   its own, and without this the whole lineage waits on it forever. New runs
   *   never start a team, so this only closes a group the ledger already holds.
   * - A stored group parent whose members are all settled is finalized here even
   *   when the settle that completed the tree happened in another process, or
   *   was interrupted between its child write and its parent write.
   *
   * Idempotent: a run that is already folded is left untouched, so a caller may
   * invoke it on every tick.
   * @param persist - false to leave the document for the caller to commit.
   * @returns whether the document changed.
   */
  finalizeReadyRuns(persist = true): boolean {
    const now = this.now()
    let changed = false
    const groups = new Set<string>()
    for (const task of this.document.tasks) {
      for (const execution of task.executions) {
        if (execution.endedAt === undefined && execution.runGroupId !== undefined) groups.add(execution.runGroupId)
      }
    }
    for (const groupId of groups) {
      const lead = this.document.tasks.find(task => task.teamRun === true
        && task.executions.some(entry => entry.runGroupId === groupId))
      const verdict = lead === undefined ? undefined : this.leadVerdict(lead, groupId)
      if (lead !== undefined && verdict !== undefined
        && this.closeTeamMembers(lead.id, groupId, verdict.result, verdict.error, now)) changed = true
      // Fold the lineage: a member may itself be a parent of a deeper member.
      for (const task of this.document.tasks) {
        if (this.settleCascade(task.id, groupId, now)) changed = true
      }
    }
    if (changed && persist) this.commit()
    return changed
  }

  /**
   * The verdict a team run's Lead has already recorded: its own turn outcome
   * once that turn ended, or the folded outcome once its card settled.
   */
  private leadVerdict(lead: TaskRecord, groupId: string): { result: ExecutionOutcome; error: string | undefined } | undefined {
    const execution = lead.executions.find(entry => entry.runGroupId === groupId)
    const result = execution?.ownResult ?? execution?.result
    if (result === undefined) return undefined
    return { result, error: execution?.ownError ?? execution?.error }
  }

  /**
   * Settle every still-open member of a team run with the Lead's verdict.
   * A teammate that already reported its own outcome keeps it: the ordinary
   * fold still lets a failure dominate.
   * @param leadId - the Lead card's task id (never settled here).
   * @param groupId - the team run's group.
   * @param verdict - the Lead's outcome, inherited by members that never reported.
   * @param error - the Lead's failure text, inherited with a failed verdict.
   * @param now - clock instant (ms epoch).
   * @returns whether the document changed.
   */
  private closeTeamMembers(leadId: string, groupId: string, verdict: ExecutionOutcome, error: string | undefined, now: number): boolean {
    const members: string[] = []
    let recorded = false
    this.document.tasks = this.document.tasks.map(task => {
      if (task.id === leadId) return task
      const execution = openGroupExecution(task, groupId)
      if (execution === undefined) return task
      members.push(task.id)
      if (execution.ownResult !== undefined) return task
      recorded = true
      return {
        ...task,
        updatedAt: now,
        executions: task.executions.map(entry => entry.id === execution.id
          ? { ...entry, ownResult: verdict, ownError: error }
          : entry),
      }
    })
    let changed = recorded
    for (const memberId of members) {
      if (this.settleCascade(memberId, groupId, now)) changed = true
    }
    return changed
  }

  /**
   * Re-align every armed rule at load/import. A recurring rule is recomputed
   * from the current instant; a one-shot is armed at its planned instant when
   * that is still in the future, and stopped as missed once it has passed
   * (there is no later occurrence to run). A recurring rule recomputed past an
   * occurrence records the skip, so the board can show that a fire was passed
   * over rather than silently rewinding.
   */
  private repairSchedules(skipPast: boolean, persist = true): void {
    const now = this.now()
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled) return task
      if (!skipPast && schedule.nextRunAt !== undefined) return task
      if (schedule.mode === 'once') {
        const at = schedule.at
        if (at === undefined) {
          changed = true
          return withSchedule(task, { enabled: false, nextRunAt: undefined, endedAt: now, endedReason: 'no-target' }, now)
        }
        if (at <= now) {
          changed = true
          return withSchedule(task, { enabled: false, nextRunAt: undefined, endedAt: now, endedReason: 'missed' }, now)
        }
        if (schedule.nextRunAt === at) return task
        changed = true
        return withSchedule(task, { nextRunAt: at }, now)
      }
      const next = nextRunAtMs(schedule.cron ?? '', now, scheduleZone(schedule))
      if (next === undefined) {
        changed = true
        this.document.scheduler.error = `invalid cron disabled for task: ${task.id}`
        return withSchedule(task, { enabled: false, nextRunAt: undefined, endedAt: now, endedReason: 'no-target' }, now)
      }
      const passed = schedule.nextRunAt !== undefined && schedule.nextRunAt <= now
      if (schedule.nextRunAt === next && !passed) return task
      changed = true
      return withSchedule(task, passed
        ? { nextRunAt: next, skippedAt: now, skippedReason: 'missed' }
        : { nextRunAt: next }, now)
    })
    if (changed && persist) this.commit()
  }

  private reconcileInterruptedStarts(persist = true): void {
    const now = this.now()
    let changed = false
    const interrupted: Array<{ taskId: string; runGroupId: string | undefined }> = []
    this.document.tasks = this.document.tasks.map(task => {
      const execution = task.executions.at(-1)
      if (execution === undefined || execution.endedAt !== undefined || execution.sessionId !== undefined) return task
      changed = true
      interrupted.push({ taskId: task.id, runGroupId: execution.runGroupId })
      return settleExecution(task, execution.id, 'cancelled', now, 'host restarted before the execution session was recorded')
    })
    // A cancelled participant may have been the last pending child of a
    // deferred cascade parent; walking up from its parent is what lets that
    // parent finalize instead of staying in the running column forever.
    for (const entry of interrupted) {
      if (entry.runGroupId === undefined) continue
      const parentId = this.document.tasks.find(task => task.id === entry.taskId)?.parentId
      if (parentId !== undefined && this.settleCascade(parentId, entry.runGroupId, now)) changed = true
    }
    if (changed && persist) this.commit()
  }

  /**
   * Field-preserving migration of an older document. It first proves every task
   * row is structurally valid, so a document that would silently drop or coerce
   * rows fails loudly instead (no quarantined-empty restart), and then reuses
   * the current normalization.
   *
   * v4 adds `ScheduleRule.timeZone`. A rule written before v4 was evaluated in
   * whatever zone the Host process happened to report, so the migration stamps
   * that zone onto every enabled rule: the trigger instant is preserved exactly
   * (the stored `nextRunAt` already encodes the old zone), but the rule stops
   * following a later `TZ` change, which is what made an existing schedule
   * silently move when the Host's zone changed.
   *
   * v5 adds the per-execution acceptance block. The migration deliberately does
   * NOT stamp one: an execution opened before v5 keeps no contract, so it
   * settles on its own historical verdict and no in-flight run is retroactively
   * judged by a gate that was never armed for it.
   */
  private migrateLegacyDocument(parsed: ParsedLedgerDocument): LedgerDocument {
    if (!Array.isArray(parsed.tasks) || !parsed.tasks.every(row => isTaskRecord(row))) {
      throw new Error(`v${String(parsed.schemaVersion)} document contains structurally invalid task rows`)
    }
    // Only generations before the stored zone was introduced (plus the one that
    // introduced it) get the Host zone stamped: a v5 rule either carries its own
    // zone or deliberately follows the Host, and re-stamping it would freeze it
    // to the zone in effect at this load.
    const stampZone = typeof parsed.schemaVersion === 'number'
      && parsed.schemaVersion <= TASK_BOARD_ZONE_STAMP_SCHEMA_VERSION
    // Every row passed `isTaskRecord` above, so the stamped rows are still
    // task records; the cast only re-narrows the unknown-typed on-disk array.
    const rows = stampZone
      ? (parsed.tasks as readonly unknown[]).map((value) => {
          const row = value as { schedule?: unknown }
          const schedule = row.schedule
          if (typeof schedule !== 'object' || schedule === null) return value
          if (typeof (schedule as { timeZone?: unknown }).timeZone === 'string') return value
          return { ...(value as object), schedule: { ...(schedule as object), timeZone: timeZone() } }
        })
      : parsed.tasks
    return this.normalizeDocument({ ...parsed, tasks: rows as TaskRecord[] })
  }

  private load(dir: string): LedgerDocument {
    const existed = existsSync(this.file)
    // schemaVersion stays unknown-typed here: on-disk documents may be v2 or
    // v3 (legacy), v4, or any future/invalid value the branches below sort out.
    let parsed: ParsedLedgerDocument
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8')) as ParsedLedgerDocument
    } catch (error) {
      return this.recoverCorrupt(dir, existed, error)
    }
    if (typeof parsed.schemaVersion === 'number'
      && TASK_BOARD_MIGRATABLE_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) {
      try {
        return this.migrateLegacyDocument(parsed)
      } catch (error) {
        // Migration failure is explicit: the original file stays in place
        // for manual recovery and the ledger refuses to start (fail closed).
        throw new Error(`ledger v${String(parsed.schemaVersion)} to v${TASK_BOARD_SCHEMA_VERSION} migration failed; original file kept at ${this.file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    }
    try {
      if (parsed.schemaVersion !== TASK_BOARD_SCHEMA_VERSION || !Array.isArray(parsed.tasks)) throw new Error('unsupported ledger schema')
      return this.normalizeDocument(parsed)
    } catch (error) {
      return this.recoverCorrupt(dir, existed, error)
    }
  }

  private normalizeDocument(parsed: ParsedLedgerDocument): LedgerDocument {
    const tasks = parseHostTasks(parsed.tasks as readonly unknown[]).map(task => ({ ...task, executions: retainRecentExecutions(task.executions) }))
    const invalidScheduleIds = (parsed.tasks as unknown[]).flatMap(value => {
      if (typeof value !== 'object' || value === null) return []
      const row = value as { id?: unknown; schedule?: unknown }
      if (typeof row.schedule !== 'object' || row.schedule === null) return []
      const rule = row.schedule as { cron?: unknown; mode?: unknown; at?: unknown }
      // A one-shot has no cron: its instant is what must be usable.
      if (rule.mode === 'once') {
        return typeof rule.at === 'number' && Number.isFinite(rule.at)
          ? []
          : [typeof row.id === 'string' ? row.id : 'unknown']
      }
      return typeof rule.cron !== 'string' || !isValidCron(rule.cron)
        ? [typeof row.id === 'string' ? row.id : 'unknown']
        : []
    })
    const documentLastTickAt = typeof parsed.scheduler?.lastTickAt === 'number' ? parsed.scheduler.lastTickAt : undefined
    const sidecarLastTickAt = this.readSchedulerSidecar()
    // A sidecar write can be newer than the last full commit (crash between
    // the two); lastTickAt only ever moves forward, so take the greater.
    const lastTickAt = sidecarLastTickAt === undefined || (documentLastTickAt !== undefined && documentLastTickAt >= sidecarLastTickAt)
      ? documentLastTickAt
      : sidecarLastTickAt
    return {
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: Number.isSafeInteger(parsed.revision) && (parsed.revision as number) >= 0 ? parsed.revision as number : 0,
      tasks,
      scheduler: {
        timeZone: timeZone(),
        ledgerId: typeof parsed.scheduler?.ledgerId === 'string' && parsed.scheduler.ledgerId !== '' ? parsed.scheduler.ledgerId : crypto.randomUUID(),
        ...(lastTickAt === undefined ? {} : { lastTickAt }),
        ...(typeof parsed.scheduler?.error === 'string' ? { error: parsed.scheduler.error } : {}),
        ...(invalidScheduleIds.length > 0 ? { error: `invalid cron disabled for task(s): ${invalidScheduleIds.join(', ')}` } : {}),
        ...(Array.isArray(parsed.scheduler?.importedSources) ? { importedSources: parsed.scheduler.importedSources.filter(x => typeof x === 'string') } : {}),
      },
      recentRequests: Array.isArray(parsed.recentRequests)
        ? parsed.recentRequests.flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null) return []
            const request = entry as { requestId?: unknown; fingerprint?: unknown }
            return typeof request.requestId === 'string' && request.requestId !== '' && typeof request.fingerprint === 'string'
              ? [{ requestId: request.requestId, fingerprint: request.fingerprint }]
              : []
          }).slice(-MAX_REQUEST_CACHE)
        : [],
    }
  }

  /** Quarantine an unreadable document and start from an empty ledger. */
  private recoverCorrupt(dir: string, existed: boolean, error: unknown): LedgerDocument {
    if (existed) renameSync(this.file, `${this.file}.corrupt-${this.now()}-${process.pid}-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    return {
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: 0,
      tasks: [],
      scheduler: { timeZone: timeZone(), ledgerId: crypto.randomUUID(), ...(existed ? { error: `corrupt ledger was quarantined: ${error instanceof Error ? error.message : String(error)}` } : {}) },
      recentRequests: [],
    }
  }

  private syncRecentRequests(): void {
    this.document.recentRequests = [...this.requestCache].map(([requestId, request]) => ({
      requestId,
      fingerprint: request.fingerprint,
    }))
  }

  private readSchedulerSidecar(): number | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.schedulerFile, 'utf8')) as { lastTickAt?: unknown }
      return typeof parsed.lastTickAt === 'number' && Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : undefined
    } catch {
      return undefined
    }
  }

  /** Atomic write of the scheduler heartbeat sidecar (0600, tmp + rename + fsync). */
  private writeSchedulerSidecar(): void {
    const payload = JSON.stringify({ lastTickAt: this.document.scheduler.lastTickAt })
    mkdirSync(dirname(this.schedulerFile), { recursive: true })
    const tmp = `${this.schedulerFile}.tmp-${process.pid}`
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, payload, { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try { chmodSync(tmp, 0o600) } catch { /* Windows ACLs own access */ }
      renameSync(tmp, this.schedulerFile)
      try {
        const dirFd = openSync(dirname(this.schedulerFile), 'r')
        try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      } catch {
        // Windows does not permit fsync on a directory handle; rename remains atomic.
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(tmp) } catch { /* best-effort temporary cleanup */ }
      throw error
    }
    this.notify()
  }

  private commit(bumpRevision = true): void {
    if (bumpRevision) this.document.revision += 1
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, JSON.stringify(this.document, null, 2), { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try { chmodSync(tmp, 0o600) } catch { /* Windows ACLs own access */ }
      renameSync(tmp, this.file)
      try {
        const dirFd = openSync(dirname(this.file), 'r')
        try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      } catch {
        // Windows does not permit fsync on a directory handle; rename remains atomic.
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(tmp) } catch { /* best-effort temporary cleanup */ }
      throw error
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private acquireLock(): number {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.lockFile, 'wx', 0o600)
        const startedAt = ownProcessStartTimeMs()
        // Linux /proc and Windows PowerShell probes are ms-precise; locks they
        // write are compared strictly. Other POSIX probes (ps) stay
        // second-granularity, so their records are compared with the bounded
        // legacy tolerance.
        const probe = process.platform === 'linux' || process.platform === 'win32' ? 'exact' : 'legacy'
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.lockToken, startedAt, probe }), { encoding: 'utf8' })
        fsyncSync(fd)
        try { chmodSync(this.lockFile, 0o600) } catch { /* Windows ACLs own access */ }
        return fd
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw error
        let pid: number | undefined
        let ownerStartedAt: number | undefined
        let ownerExact = false
        try {
          const owner = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { pid?: unknown; startedAt?: unknown; probe?: unknown }
          if (typeof owner.pid === 'number') pid = owner.pid
          if (typeof owner.startedAt === 'number') ownerStartedAt = owner.startedAt
          ownerExact = owner.probe === 'exact'
        } catch {
          // A power-loss mid-write can leave an empty or truncated lock. Such a
          // lock still fails closed while it is fresh (a live owner may be
          // mid-write); once it is older than the grace window nothing can be
          // writing it, so the leftover is reclaimed instead of blocking every
          // later start until someone deletes it by hand (issue #1528).
          const age = (() => {
            try { return this.now() - statSync(this.lockFile).mtimeMs } catch { return Number.POSITIVE_INFINITY }
          })()
          if (age < UNREADABLE_LOCK_GRACE_MS) {
            throw new Error(`task-board ledger lock is unreadable: ${this.lockFile}; if this is a leftover from an unclean shutdown and no other DSH host is running, remove it manually and retry`)
          }
          try { unlinkSync(this.lockFile) } catch (unlinkError) {
            if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
          }
          continue
        }
        if (pid !== undefined && processIsAlive(pid)) {
          const actualStartedAt = pid === process.pid ? ownProcessStartTimeMs() : processStartTimeMs(pid)
          // A reused PID is exposed when the live process identity no longer
          // matches the recorded one: either the recorded start time differs
          // beyond the probe's resolution (strict for ms-precise 'exact'
          // records, a bounded legacy tolerance for old second-granularity
          // records written by ps), or (legacy locks without a start time)
          // the lock file predates the live process and therefore cannot
          // have been written by it. Takeover is safe in both cases — the
          // original owner is gone.
          const staleReuse = actualStartedAt !== undefined && (
            ownerStartedAt !== undefined
              ? startTimeMismatch(ownerStartedAt, actualStartedAt, ownerExact)
              : (() => {
                try { return statSync(this.lockFile).mtimeMs < actualStartedAt } catch { return true }
              })()
          )
          if (!staleReuse) {
            const confirmedOwner = ownerStartedAt !== undefined && actualStartedAt !== undefined && !startTimeMismatch(ownerStartedAt, actualStartedAt, ownerExact)
            const hint = confirmedOwner
              ? ''
              : `; if this PID was reused after a crash and no other DSH host is running, remove ${this.lockFile} manually and retry`
            throw new Error(`task-board ledger is already owned by process ${pid}${hint}`, { cause: error })
          }
        }
        try { unlinkSync(this.lockFile) } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
        }
      }
    }
    throw new Error(`task-board ledger lock could not be acquired: ${this.lockFile}`)
  }
}
