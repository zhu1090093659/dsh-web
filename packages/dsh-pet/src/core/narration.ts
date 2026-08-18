/** Deterministic, privacy-safe activity narration and emission scheduling. */

import { sanitizeActivityText } from './sanitize.ts'
import type { PetAggregateSnapshot, PetTaskSnapshot } from './protocol.ts'

export type NarrationReason =
  | 'initial'
  | 'waiting-input'
  | 'failure'
  | 'completion'
  | 'primary-task'
  | 'phase'
  | 'tool'
  | 'aggregate'
  | 'long-running'

export interface NarrationContext {
  reason?: NarrationReason
  longRunningMs?: number
  maxChars?: number
}

export interface NarrationDecision {
  text?: string
  emitted: boolean
  reason?: NarrationReason
  /** Stable creation time of the currently displayed speech event. */
  createdAt?: number
}

export interface NarrationEngineOptions {
  minIntervalMs?: number
  duplicateWindowMs?: number
  completionMergeMs?: number
  longRunningThresholdsMs?: number[]
  maxChars?: number
}

interface Trigger {
  reason: NarrationReason
  urgent: boolean
  longRunningMs?: number
}

const DEFAULT_MIN_INTERVAL_MS = 8_000
const DEFAULT_DUPLICATE_WINDOW_MS = 60_000
const DEFAULT_COMPLETION_MERGE_MS = 3_000
const DEFAULT_LONG_THRESHOLDS_MS = [30_000, 60_000, 300_000]

function primaryTask(snapshot: PetAggregateSnapshot): PetTaskSnapshot | undefined {
  return snapshot.tasks.find(task => task.taskId === snapshot.primaryTaskId)
}

function phaseFallback(task: PetTaskSnapshot): string | undefined {
  switch (task.phase) {
    case 'waiting': return '正在等待响应'
    case 'thinking': return '正在思考'
    case 'tool': return task.tool === undefined ? '正在使用工具' : `正在使用 ${task.tool.name}`
    case 'review': return '正在整理回复'
    case 'waiting_input': return '正在等你确认'
    case 'blocked': return '任务受阻，正在等待继续'
    case 'done': return '完成啦'
    case 'failed': return '任务遇到问题了'
    case 'idle': return undefined
  }
}

function taskLine(task: PetTaskSnapshot, maxChars = 16): string {
  const action = task.narration ?? task.statusLine ?? phaseFallback(task) ?? '暂时待机'
  const safeAction = sanitizeActivityText(action, { maxChars })
  if (task.title === undefined) return safeAction
  const title = sanitizeActivityText(task.title, { maxChars: 8 })
  if (title === '') return safeAction
  const actionWithoutPrefix = safeAction.replace(/^正在/u, '')
  return sanitizeActivityText(`${title}正在${actionWithoutPrefix}`, { maxChars })
}

function longRunningLine(task: PetTaskSnapshot, elapsedMs: number): string {
  if (elapsedMs >= 300_000) return '这个任务运行较久，仍在继续。'
  if (elapsedMs >= 60_000) return '任务还在继续，我会帮你盯着。'
  if (task.phase === 'tool') return '这个工具还在运行，我继续等结果。'
  return '这个任务忙了一会儿，我还在盯着。'
}

/** Build one bounded line from known facts only; no percentage is inferred. */
export function narrateActivity(
  snapshot: PetAggregateSnapshot,
  context: NarrationContext = {},
): string | undefined {
  const primary = primaryTask(snapshot)
  if (primary === undefined) return undefined

  const maxChars = context.maxChars ?? 32
  let text: string
  if (context.reason === 'long-running' && context.longRunningMs !== undefined) {
    text = longRunningLine(primary, context.longRunningMs)
  } else if (context.reason === 'completion' && snapshot.summary.completedRecently > 0) {
    text = snapshot.summary.active > 0
      ? `有 ${snapshot.summary.completedRecently} 个任务刚完成，另外 ${snapshot.summary.active} 个还在继续。`
      : snapshot.summary.completedRecently === 1
        ? '刚刚完成了一个任务。'
        : `刚刚完成了 ${snapshot.summary.completedRecently} 个任务。`
  } else {
    const freshFailures = snapshot.tasks.filter(task => (
      task.phase === 'failed' && snapshot.emittedAt - task.updatedAt <= 30_000
    )).length
    if (freshFailures > 0) {
      text = `有 ${freshFailures} 个任务遇到问题，我先盯着最急的。`
    } else if (primary.phase === 'waiting_input') {
      text = snapshot.summary.active > 1
        ? `主任务正在等你确认，另外 ${snapshot.summary.active - 1} 个还在继续。`
        : '这个任务正在等你确认。'
    } else if (primary.phase === 'blocked') {
      text = snapshot.summary.blocked > 1
        ? `有 ${snapshot.summary.blocked} 个任务受阻，我先盯着主任务。`
        : '这个任务暂时受阻，正在等待继续。'
    } else if (snapshot.summary.active > 2) {
      text = `现在有 ${snapshot.summary.active} 个任务在跑，主任务${taskLine(primary, 13)}。`
    } else if (snapshot.summary.active === 2) {
      const other = snapshot.tasks.find(task => (
        task.taskId !== primary.taskId && !['idle', 'done', 'failed'].includes(task.phase)
      ))
      text = other === undefined
        ? taskLine(primary, maxChars)
        : `主任务${taskLine(primary, 12)}，另一个任务${taskLine(other, 12)}。`
    } else {
      text = taskLine(primary, maxChars)
    }
  }
  const safe = sanitizeActivityText(text, { maxChars })
  return safe === '' ? undefined : safe
}

function taskById(snapshot: PetAggregateSnapshot | undefined, taskId: string | undefined): PetTaskSnapshot | undefined {
  if (snapshot === undefined || taskId === undefined) return undefined
  return snapshot.tasks.find(task => task.taskId === taskId)
}

function newlyCompleted(previous: PetAggregateSnapshot | undefined, current: PetAggregateSnapshot): boolean {
  if (previous === undefined) return current.tasks.some(task => task.phase === 'done')
  const previousPhases = new Map(previous.tasks.map(task => [task.taskId, task.phase]))
  return current.tasks.some(task => task.phase === 'done' && previousPhases.get(task.taskId) !== 'done')
}

/** Stateful scheduler enforcing narration priority, cooldown, and deduplication. */
export class NarrationEngine {
  private readonly minIntervalMs: number
  private readonly duplicateWindowMs: number
  private readonly completionMergeMs: number
  private readonly longThresholds: number[]
  private readonly maxChars: number
  private previous: PetAggregateSnapshot | undefined
  private currentText: string | undefined
  private currentReason: NarrationReason | undefined
  private currentCreatedAt: number | undefined
  private lastEmittedAt = Number.NEGATIVE_INFINITY
  private lastCompletionAt = Number.NEGATIVE_INFINITY
  private readonly recentTexts = new Map<string, number>()
  private readonly longSeen = new Map<string, number>()
  private pending: Trigger | undefined

  constructor(options: NarrationEngineOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    this.duplicateWindowMs = options.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS
    this.completionMergeMs = options.completionMergeMs ?? DEFAULT_COMPLETION_MERGE_MS
    this.longThresholds = [...(options.longRunningThresholdsMs ?? DEFAULT_LONG_THRESHOLDS_MS)]
      .filter(value => Number.isFinite(value) && value >= 0)
      .sort((left, right) => left - right)
    this.maxChars = options.maxChars ?? 32
  }

  /** Clear all history when activity collection is disabled or restarted. */
  reset(): void {
    this.previous = undefined
    this.currentText = undefined
    this.currentReason = undefined
    this.currentCreatedAt = undefined
    this.lastEmittedAt = Number.NEGATIVE_INFINITY
    this.lastCompletionAt = Number.NEGATIVE_INFINITY
    this.recentTexts.clear()
    this.longSeen.clear()
    this.pending = undefined
  }

  /** Evaluate one full snapshot and return the currently displayable line. */
  next(snapshot: PetAggregateSnapshot): NarrationDecision {
    if (snapshot.tasks.length === 0) {
      this.reset()
      this.previous = snapshot
      return { emitted: false }
    }

    const trigger = this.detectTrigger(snapshot)
    if (trigger !== undefined) this.pending = trigger
    const emitted = this.tryEmit(snapshot)
    this.previous = snapshot
    return emitted ?? {
      ...(this.currentText === undefined ? {} : { text: this.currentText }),
      emitted: false,
      ...(this.currentReason === undefined ? {} : { reason: this.currentReason }),
      ...(this.currentCreatedAt === undefined ? {} : { createdAt: this.currentCreatedAt }),
    }
  }

  private detectTrigger(snapshot: PetAggregateSnapshot): Trigger | undefined {
    const current = primaryTask(snapshot)
    const previousPrimary = taskById(this.previous, this.previous?.primaryTaskId)
    if (current?.phase === 'waiting_input'
      && (previousPrimary?.phase !== 'waiting_input' || previousPrimary.taskId !== current.taskId)) {
      return { reason: 'waiting-input', urgent: true }
    }
    if (current?.phase === 'failed'
      && (previousPrimary?.phase !== 'failed' || previousPrimary.taskId !== current.taskId)) {
      return { reason: 'failure', urgent: true }
    }
    if (newlyCompleted(this.previous, snapshot)) {
      return { reason: 'completion', urgent: true }
    }
    if (this.previous === undefined) return { reason: 'initial', urgent: false }
    if (this.previous.tasks.length !== snapshot.tasks.length
      || this.previous.summary.active !== snapshot.summary.active) {
      return { reason: 'aggregate', urgent: true }
    }
    if (this.previous.primaryTaskId !== snapshot.primaryTaskId) {
      return { reason: 'primary-task', urgent: false }
    }
    if (current !== undefined && previousPrimary?.phase !== current.phase) {
      return { reason: 'phase', urgent: false }
    }
    if (current !== undefined && (
      previousPrimary?.tool?.name !== current.tool?.name
      || previousPrimary?.tool?.activeCount !== current.tool?.activeCount
    )) {
      return { reason: 'tool', urgent: false }
    }
    if (current?.narration !== previousPrimary?.narration) {
      return { reason: 'phase', urgent: false }
    }
    return this.longRunningTrigger(snapshot, current)
  }

  private longRunningTrigger(
    snapshot: PetAggregateSnapshot,
    task: PetTaskSnapshot | undefined,
  ): Trigger | undefined {
    if (task === undefined || ['idle', 'done', 'failed', 'waiting_input'].includes(task.phase)) return undefined
    const elapsed = Math.max(0, snapshot.emittedAt - task.phaseStartedAt)
    const crossed = this.longThresholds.filter(value => elapsed >= value).at(-1)
    if (crossed === undefined) return undefined
    const key = `${task.taskId}:${task.phaseStartedAt}`
    const seen = this.longSeen.get(key) ?? Number.NEGATIVE_INFINITY
    if (crossed <= seen) return undefined
    this.longSeen.set(key, crossed)
    return { reason: 'long-running', urgent: false, longRunningMs: crossed }
  }

  private tryEmit(snapshot: PetAggregateSnapshot): NarrationDecision | undefined {
    const trigger = this.pending
    if (trigger === undefined) return undefined
    const nowMs = snapshot.emittedAt
    if (!trigger.urgent && nowMs - this.lastEmittedAt < this.minIntervalMs) return undefined
    if (trigger.reason === 'completion' && nowMs - this.lastCompletionAt < this.completionMergeMs) {
      return undefined
    }
    const text = narrateActivity(snapshot, {
      reason: trigger.reason,
      ...(trigger.longRunningMs === undefined ? {} : { longRunningMs: trigger.longRunningMs }),
      maxChars: this.maxChars,
    })
    this.pending = undefined
    if (text === undefined || text === this.currentText) return undefined
    const previousAt = this.recentTexts.get(text)
    if (previousAt !== undefined && nowMs - previousAt < this.duplicateWindowMs) return undefined

    for (const [recentText, emittedAt] of this.recentTexts) {
      if (nowMs - emittedAt >= this.duplicateWindowMs) this.recentTexts.delete(recentText)
    }
    this.currentText = text
    this.currentReason = trigger.reason
    this.currentCreatedAt = nowMs
    this.lastEmittedAt = nowMs
    if (trigger.reason === 'completion') this.lastCompletionAt = nowMs
    this.recentTexts.set(text, nowMs)
    return { text, emitted: true, reason: trigger.reason, createdAt: nowMs }
  }
}
