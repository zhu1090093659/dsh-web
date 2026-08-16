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
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = Date.now()
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** One card in a column. */
function TaskCardInner({ task, pending, onClick }: { task: TaskRecord; pending: boolean; onClick: () => void }) {
  const latest = task.executions[task.executions.length - 1]
  const runs = task.executions.length
  return (
    <button
      type="button"
      className={css.card}
      data-status={task.status}
      data-pending={pending || undefined}
      onClick={onClick}
      title={task.description !== '' ? task.description : task.title}
    >
      <span className={css.cardTitle}>{task.title}</span>
      {task.description !== '' && <span className={css.cardExcerpt}>{task.description}</span>}
      <span className={css.cardMeta}>
        <span className={css.cardTime}>{t('board.updated')} {formatTime(task.updatedAt)}</span>
        {task.schedule?.enabled === true && (
          <span
            className={css.cardSchedule}
            title={task.schedule.nextRunAt !== undefined
              ? `${t('card.scheduled')} · ${new Date(task.schedule.nextRunAt).toLocaleString()}`
              : t('card.scheduled')}
          >
            {t('card.scheduled')}
          </span>
        )}
        {latest !== undefined && (
          <span className={css.cardRun} data-result={latest.result}>
            {runs} {t('board.runs')}
          </span>
        )}
        {latest?.sessionId !== undefined && (
          <span className={css.cardSession} title={latest.sessionId}>⌁</span>
        )}
        {(task.status === 'running' || pending) && <span className={css.cardSpinner} aria-hidden="true" />}
      </span>
      {pending && <span className={css.cardRunningLabel}>{t('board.pending')}…</span>}
      {latest !== undefined && executionLabel(latest) === 'running' && (
        <span className={css.cardRunningLabel}>{t('detail.result.running')}…</span>
      )}
    </button>
  )
}

/** Memoized card: re-renders only when the card's own task record changes. */
export const TaskCard = memo(TaskCardInner)
