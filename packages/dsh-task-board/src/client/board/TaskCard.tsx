/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button).
 *
 * Memoized: the card re-renders only when its own task record changes, so a
 * status/filter update on one card (or scrolling) never re-renders every
 * card on the board. The per-card onClick is built with a stable task reference
 * by the board, so the memo boundary is effective.
 */
import { memo } from 'react'
import type { TaskRecord } from '../../core/tasks.ts'
import { executionLabel } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** Compact relative/absolute time label. */
export function formatHostTimestamp(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

export function formatTime(ms: number, timeZone?: string): string {
  const date = new Date(ms)
  const now = Date.now()
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  if (timeZone !== undefined) return formatHostTimestamp(ms, timeZone)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function TaskCardInner({ task, pending, timeZone, onClick }: { task: TaskRecord; pending: boolean; timeZone?: string; onClick: () => void }) {
  const latest = task.executions[task.executions.length - 1]
  const runs = task.executions.length
  const archived = task.archivedAt !== undefined
  const isDraggable = !archived && task.status !== 'running' && !pending

  return (
    <button
      type="button"
      className={css.card}
      data-status={archived ? 'archived' : task.status}
      data-dsh-part="card"
      data-pending={pending || undefined}
      draggable={isDraggable}
      onDragStart={isDraggable ? (event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      } : undefined}
      onClick={onClick}
      title={task.description !== '' ? task.description : task.title}
    >
      <span className={css.cardTitle}>{task.title}</span>
      {task.description !== '' && <span className={css.cardExcerpt}>{task.description}</span>}
      <span className={css.cardMeta}>
        <span className={css.cardTime}>{t('board.updated')} {formatTime(task.updatedAt)}</span>
        {task.freeze !== undefined && (
          <span className={css.cardSchedule} title={task.freeze.goal}>{t('card.frozen')}</span>
        )}
        {!archived && task.schedule?.enabled === true && (
          <span
            className={css.cardSchedule}
            title={task.schedule.nextRunAt !== undefined
              ? `${t('card.scheduled')} · ${formatHostTimestamp(task.schedule.nextRunAt, timeZone)}`
              : t('card.scheduled')}
          >
            {t('card.scheduled')}
          </span>
        )}
        {latest !== undefined && (
          <span className={css.cardRun} data-result={archived ? undefined : latest.result}>
            {runs} {t('board.runs')}
          </span>
        )}
        {latest?.sessionId !== undefined && (
          <span className={css.cardSession} title={latest.sessionId}>⌁</span>
        )}
        {!archived && (task.status === 'running' || pending) && <span className={css.cardSpinner} aria-hidden="true" />}
      </span>
      {!archived && pending && <span className={css.cardRunningLabel}>{t('board.pending')}…</span>}
      {!archived && latest !== undefined && executionLabel(latest) === 'running' && (
        <span className={css.cardRunningLabel}>{t('detail.result.running')}…</span>
      )}
    </button>
  )
}

/** Memoized card: re-renders only when the card's own task record changes. */
export const TaskCard = memo(TaskCardInner)
