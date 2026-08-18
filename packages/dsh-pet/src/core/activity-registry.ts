/** Process-local registry retaining one immutable activity view per session. */

import { selectPrimaryTask } from './primary-task.ts'
import { sanitizeActivityText } from './sanitize.ts'
import {
  PET_ACTIVITY_PROTOCOL_VERSION,
  petTaskId,
  type PetAggregateSnapshot,
  type PetTaskIdentity,
  type PetTaskPhase,
  type PetTaskProgress,
  type PetTaskSnapshot,
  type PetTaskTokenUsage,
  type PetTaskToolSnapshot,
} from './protocol.ts'

/** Facts accepted when one session emits meaningful activity. */
export interface PetTaskUpdate extends PetTaskIdentity {
  profile?: string
  workspaceLabel?: string
  title?: string
  phase: PetTaskPhase
  statusLine?: string
  narration?: string
  tool?: PetTaskToolSnapshot
  startedAt?: number
  phaseStartedAt?: number
  updatedAt?: number
  finishedAt?: number
  tokenUsage?: PetTaskTokenUsage
  progress?: PetTaskProgress
}

/** Registry retention and clock controls. */
export interface ActivityRegistryOptions {
  completedRecentlyMs?: number
  failedPriorityMs?: number
  now?: () => number
}

const DEFAULT_COMPLETED_RECENTLY_MS = 30_000

function cloneTask(task: PetTaskSnapshot): PetTaskSnapshot {
  return {
    ...task,
    ...(task.tool === undefined ? {} : { tool: { ...task.tool } }),
    ...(task.tokenUsage === undefined ? {} : { tokenUsage: { ...task.tokenUsage } }),
    ...(task.progress === undefined ? {} : { progress: { ...task.progress } }),
  }
}

function isActive(phase: PetTaskPhase): boolean {
  return !['idle', 'done', 'failed'].includes(phase)
}

function safeOptional(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined) return undefined
  const safe = sanitizeActivityText(value, { maxChars })
  return safe === '' ? undefined : safe
}

function safeTool(tool: PetTaskToolSnapshot | undefined): PetTaskToolSnapshot | undefined {
  if (tool === undefined) return undefined
  const name = sanitizeActivityText(tool.name, { maxChars: 24 }) || '工具'
  const label = safeOptional(tool.label, 32)
  const detail = safeOptional(tool.detail, 48)
  return {
    name,
    ...(label === undefined ? {} : { label }),
    ...(detail === undefined ? {} : { detail }),
    activeCount: Math.max(0, Math.trunc(tool.activeCount)),
    completedCount: Math.max(0, Math.trunc(tool.completedCount)),
    ...(tool.failedCount === undefined ? {} : { failedCount: Math.max(0, Math.trunc(tool.failedCount)) }),
  }
}

function safeProgress(progress: PetTaskProgress | undefined): PetTaskProgress | undefined {
  if (progress === undefined || !Number.isFinite(progress.current) || !Number.isFinite(progress.total)
    || progress.current < 0 || progress.total <= 0 || progress.current > progress.total) return undefined
  const unit = safeOptional(progress.unit, 16)
  return {
    current: progress.current,
    total: progress.total,
    ...(unit === undefined ? {} : { unit }),
  }
}

/** Mutable owner of session activity; every public snapshot is copied. */
export class ActivityRegistry {
  private readonly tasks = new Map<string, PetTaskSnapshot>()
  private readonly now: () => number
  private readonly completedRecentlyMs: number
  private readonly failedPriorityMs: number | undefined
  private sequence = 0
  private pinnedTaskId: string | undefined
  private focusedTaskId: string | undefined
  private recentTaskId: string | undefined

  constructor(options: ActivityRegistryOptions = {}) {
    this.now = options.now ?? Date.now
    this.completedRecentlyMs = options.completedRecentlyMs ?? DEFAULT_COMPLETED_RECENTLY_MS
    this.failedPriorityMs = options.failedPriorityMs
  }

  /** Insert or replace the latest meaningful state for one task. */
  update(update: PetTaskUpdate): PetTaskSnapshot {
    const taskId = petTaskId(update)
    const previous = this.tasks.get(taskId)
    const updatedAt = update.updatedAt ?? this.now()
    const phaseChanged = previous === undefined || previous.phase !== update.phase
    const terminal = update.phase === 'done' || update.phase === 'failed'
    const tokenUsage = update.tokenUsage ?? previous?.tokenUsage
    const profile = safeOptional(update.profile ?? previous?.profile, 32)
    const workspaceLabel = safeOptional(update.workspaceLabel ?? previous?.workspaceLabel, 48)
    const title = safeOptional(update.title ?? previous?.title, 48)
    const statusLine = safeOptional(update.statusLine, 48)
    const narration = safeOptional(update.narration, 48)
    const tool = safeTool(update.tool)
    const progress = safeProgress(update.progress ?? previous?.progress)
    const next: PetTaskSnapshot = {
      taskId,
      instanceId: update.instanceId,
      bootId: update.bootId,
      sessionId: update.sessionId,
      ...(profile === undefined ? {} : { profile }),
      ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
      ...(title === undefined ? {} : { title }),
      phase: update.phase,
      ...(statusLine === undefined ? {} : { statusLine }),
      ...(narration === undefined ? {} : { narration }),
      ...(tool === undefined ? {} : { tool }),
      startedAt: previous?.startedAt ?? update.startedAt ?? updatedAt,
      phaseStartedAt: phaseChanged
        ? update.phaseStartedAt ?? updatedAt
        : previous.phaseStartedAt,
      updatedAt,
      ...(terminal
        ? { finishedAt: update.finishedAt ?? (phaseChanged ? updatedAt : previous?.finishedAt ?? updatedAt) }
        : {}),
      ...(tokenUsage === undefined ? {} : { tokenUsage: { ...tokenUsage } }),
      ...(progress === undefined ? {} : { progress }),
    }
    this.tasks.set(taskId, next)
    this.recentTaskId = taskId
    this.sequence += 1
    return cloneTask(next)
  }

  /** Remove a task after its owning session is disposed. */
  remove(identity: PetTaskIdentity): boolean {
    const taskId = petTaskId(identity)
    const removed = this.tasks.delete(taskId)
    if (!removed) return false
    if (this.pinnedTaskId === taskId) this.pinnedTaskId = undefined
    if (this.focusedTaskId === taskId) this.focusedTaskId = undefined
    if (this.recentTaskId === taskId) this.recentTaskId = undefined
    this.sequence += 1
    return true
  }

  /** Drop every task, for example when activity collection is disabled. */
  clear(): void {
    if (this.tasks.size === 0 && this.pinnedTaskId === undefined && this.focusedTaskId === undefined) return
    this.tasks.clear()
    this.pinnedTaskId = undefined
    this.focusedTaskId = undefined
    this.recentTaskId = undefined
    this.sequence += 1
  }

  /** Set the user-pinned primary task hint. Unknown IDs clear the pin. */
  pin(taskId?: string): void {
    const next = taskId !== undefined && this.tasks.has(taskId) ? taskId : undefined
    if (next === this.pinnedTaskId) return
    this.pinnedTaskId = next
    this.sequence += 1
  }

  /** Set the foreground web-session hint. Unknown IDs clear focus. */
  focus(taskId?: string): void {
    const next = taskId !== undefined && this.tasks.has(taskId) ? taskId : undefined
    if (next === this.focusedTaskId) return
    this.focusedTaskId = next
    this.sequence += 1
  }

  /** Return a deterministic full snapshot suitable for REST or a bridge. */
  snapshot(): PetAggregateSnapshot {
    const emittedAt = this.now()
    const tasks = [...this.tasks.values()]
      .map(cloneTask)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.taskId.localeCompare(right.taskId))
    const primary = selectPrimaryTask(tasks, {
      nowMs: emittedAt,
      ...(this.pinnedTaskId === undefined ? {} : { pinnedTaskId: this.pinnedTaskId }),
      ...(this.focusedTaskId === undefined ? {} : { focusedTaskId: this.focusedTaskId }),
      ...(this.recentTaskId === undefined ? {} : { recentTaskId: this.recentTaskId }),
      ...(this.failedPriorityMs === undefined ? {} : { failedPriorityMs: this.failedPriorityMs }),
    })
    const summary = {
      active: tasks.filter(task => isActive(task.phase)).length,
      waiting: tasks.filter(task => task.phase === 'waiting' || task.phase === 'waiting_input').length,
      blocked: tasks.filter(task => task.phase === 'blocked').length,
      failed: tasks.filter(task => task.phase === 'failed').length,
      completedRecently: tasks.filter(task => (
        task.phase === 'done'
        && task.finishedAt !== undefined
        && emittedAt - task.finishedAt <= this.completedRecentlyMs
      )).length,
    }
    return {
      protocolVersion: PET_ACTIVITY_PROTOCOL_VERSION,
      sequence: this.sequence,
      emittedAt,
      ...(primary === undefined ? {} : { primaryTaskId: primary.taskId }),
      tasks,
      summary,
    }
  }
}
