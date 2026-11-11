/**
 * Task card: the board's column item. The stretched open control opens the
 * task detail — it never executes anything directly (detail holds the Run
 * button).
 *
 * The card is an `article` with one stretched `button` rather than a button
 * itself: interactive content inside a button is invalid HTML, and the card
 * carries its own quick actions (open the execution session, a provider's
 * link such as the tracker issue). The article owns the pointer click and
 * ignores clicks that land on a quick action; the stretched open button is the
 * keyboard and accessibility target, and its click bubbles into the same
 * handler, so the detail opens exactly once either way.
 *
 * Memoized: the card re-renders only when its own task record changes, so a
 * status/filter update on one card (or scrolling) never re-renders every
 * card on the board. The per-card callbacks are built with a stable task
 * reference by the board, so the memo boundary is effective.
 */
import { memo, useMemo } from 'react'
import type { TaskRecord } from '../../core/tasks.ts'
import { executionLabel, hasOpenExecution, tagTone } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import { useTaskBoardSeats } from '../seats.tsx'
import { cardOutcome, cardTimeline, RESULT_KEY, splitTitleKind } from './card-view.ts'
import { IconClock, IconSession } from './icons.tsx'
import css from '../board.module.css'
import { markdownExcerpt, markdownToPlainText } from './task-markdown.tsx'

/**
 * Built formatters, keyed by time zone ('' = the browser's own). Constructing
 * an Intl.DateTimeFormat is orders of magnitude more expensive than formatting
 * with one, and the board renders dozens of timestamps per SSE frame; the
 * cached formatter keeps that cost off the render path.
 */
const HOST_TIMESTAMP_FORMATS = new Map<string, Intl.DateTimeFormat>()

function hostTimestampFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  const cached = HOST_TIMESTAMP_FORMATS.get(key)
  if (cached !== undefined) return cached
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    ...(timeZone === undefined ? {} : { timeZone }),
  })
  HOST_TIMESTAMP_FORMATS.set(key, format)
  return format
}

/** Compact relative/absolute time label. */
export function formatHostTimestamp(ms: number, timeZone?: string): string {
  try {
    return hostTimestampFormat(timeZone).format(new Date(ms))
  } catch {
    // An unsupported time-zone id throws on construction: never cache it, and
    // fall back to the ISO instant for this call.
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

/** Cached YYYY-MM-DD formatters, keyed by time zone ('' = the browser's own). */
const CARD_DATE_FORMATS = new Map<string, Intl.DateTimeFormat>()

/**
 * Card time label: relative within a day, otherwise the calendar date read in
 * the Host time zone (the same zone the tooltip and the detail view use), so a
 * card never shows a browser-local date beside a Host-zone tooltip.
 * @param ms - the instant.
 * @param timeZone - Host IANA zone; absent uses the browser zone.
 * @param now - the current instant.
 */
export function formatCardTime(ms: number, timeZone?: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  const key = timeZone ?? ''
  try {
    let format = CARD_DATE_FORMATS.get(key)
    if (format === undefined) {
      format = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone === undefined ? {} : { timeZone }) })
      CARD_DATE_FORMATS.set(key, format)
    }
    return format.format(new Date(ms))
  } catch {
    // An unsupported zone id: never cached; fall back to the UTC calendar date.
    return new Date(ms).toISOString().slice(0, 10)
  }
}

function TaskCardInner({
  task,
  pending,
  timeZone,
  onClick,
  onOpenSession,
  compact = false,
  subtaskCount = 0,
  isSubtask = false,
  subtasksDone = 0,
  subtasksRunning = 0,
  subtasksFailed = 0,
}: {
  task: TaskRecord
  pending: boolean
  timeZone?: string
  onClick: () => void
  /** Open an execution session; absent renders the session mark inert. */
  onOpenSession?: (sessionId: string) => void
  /** Single-line density used by long settled columns. */
  compact?: boolean
  /** Direct subtasks of this card, shown as a badge (0 hides it). */
  subtaskCount?: number
  /** Whether this card is itself a subtask. */
  isSubtask?: boolean
  /** Direct subtasks already settled as done, for the roll-up badge. */
  subtasksDone?: number
  /** Direct subtasks currently running, for the roll-up badge. */
  subtasksRunning?: number
  /** Direct subtasks that failed, for the roll-up badge. */
  subtasksFailed?: number
}) {
  const { cardDecoration } = useTaskBoardSeats()
  const runs = task.executions.length
  const summary = useMemo(() => markdownToPlainText(task.title) || task.title, [task.title])
  const title = useMemo(() => splitTitleKind(summary), [summary])
  const excerpt = useMemo(() => (compact ? '' : markdownExcerpt(task.description)), [task.description, compact])
  const archived = task.archivedAt !== undefined
  // The lock is an open execution, not the column: a card parked in 'running'
  // by hand stays draggable, and an executing card never is.
  const busy = hasOpenExecution(task)
  const isDraggable = !archived && !busy && !pending
  const outcome = cardOutcome(task, archived)
  const latest = outcome.latest
  const timeline = cardTimeline(task, archived)
  const resultText = latest?.result !== undefined ? t(RESULT_KEY[latest.result]) : ''
  const sessionId = latest?.sessionId
  const tagNames = (task.tags ?? []).map(tag => tag.name)

  const ariaLabel = [
    title.kind === undefined ? summary : `${title.kind}: ${title.text}`,
    !archived && pending ? t('board.pending') : '',
    !archived && busy ? t('detail.result.running') : '',
    !archived && !busy && resultText !== '' ? resultText : '',
    outcome.declared ? t('card.declared') : '',
    subtasksFailed > 0 ? t('card.subtasksFailed', { count: String(subtasksFailed) }) : '',
    tagNames.length > 0 ? t('card.tagsLabel', { tags: tagNames.join(', ') }) : '',
  ].filter(Boolean).join(' · ')
  // The tooltip names what the clamped surface cannot show — the full title and
  // the absolute instant — not the whole excerpt again.
  const tooltip = [
    summary,
    t(timeline.key, { time: formatHostTimestamp(timeline.at, timeZone) }),
    outcome.declared ? t('card.declaredHint') : '',
  ].filter(Boolean).join('\n')

  // The status rail is one reserved row in every state: a label while a run is
  // in flight, the settled result badge beside the run count, and the spinner
  // box that is the same size whether or not it holds a spinner. Nothing here
  // can add or remove a row, so a state change cannot resize the card.
  const runningLabel = !archived && latest !== undefined && executionLabel(latest) === 'running'
    ? (latest.ownResult === undefined ? t('detail.result.running') : t('detail.subtasks.waiting'))
    : ''
  // Archived cards settle outside the board's judgement, so they keep the plain
  // text result instead of a badge that would paint a tone they do not own.
  const settledResult = archived ? undefined : latest?.result
  const resultPrefix = settledResult === undefined && !busy && resultText !== '' ? `${resultText} · ` : ''
  const runLine = latest === undefined ? undefined : (
    <span
      className={css.cardRun}
      data-dsh-part="card-run"
      data-result={settledResult}
      data-declared={outcome.declared || undefined}
      title={outcome.declared ? t('card.declaredHint') : undefined}
    >
      {settledResult !== undefined && (
        <span className={css.cardResult} data-result={settledResult}>{resultText}</span>
      )}
      <span className={css.cardRuns}>
        {resultPrefix}{runs} {t('board.runs')}
        {outcome.declared ? ` · ${t('card.declared')}` : ''}
      </span>
    </span>
  )
  const sessionMark = sessionId !== undefined && (onOpenSession !== undefined ? (
    <button
      type="button"
      className={`${css.cardSession} ${css.cardAction}`}
      data-dsh-part="card-session"
      title={t('card.openSession')}
      aria-label={t('card.openSession')}
      onClick={() => { onOpenSession(sessionId) }}
    >
      <IconSession size={14} />
    </button>
  ) : (
    <span className={css.cardSession} title={sessionId}>
      <IconSession size={12} />
    </span>
  ))
  const decoration = <span className={css.cardDecoration}>{cardDecoration({ task })}</span>
  const timeLabel = <span className={css.cardTime} data-dsh-part="card-time">{t(timeline.key, { time: formatCardTime(timeline.at, timeZone) })}</span>
  const kindBadge = title.kind !== undefined && (
    <span className={css.cardKind} data-dsh-part="card-kind">{title.kind}</span>
  )

  return (
    <article
      className={css.card}
      data-status={archived ? 'archived' : task.status}
      data-tone={outcome.tone}
      data-compact={compact || undefined}
      data-dsh-part="card"
      data-pending={pending || undefined}
      draggable={isDraggable}
      onDragStart={isDraggable ? (event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      } : undefined}
      title={tooltip}
      onClick={(event) => {
        // A quick action (session, provider link) handles its own click.
        const target = event.target as Element
        if (target.closest('a, button:not([data-dsh-part="card-open"])') !== null) return
        onClick()
      }}
    >
      <button type="button" className={css.cardOpen} data-dsh-part="card-open" aria-label={ariaLabel} />
      <span className={css.cardTitleRow}>
        {kindBadge}
        <span className={css.cardTitle} data-dsh-part="card-title">{title.text}</span>
      </span>
      {compact ? (
        <span className={css.cardMeta}>
          {decoration}
          {timeLabel}
          <span className={css.cardSpinnerSlot} aria-hidden="true">
            {!archived && (busy || pending) && <span className={css.cardSpinner} />}
          </span>
        </span>
      ) : (
        <>
          {task.tags !== undefined && task.tags.length > 0 && (
            <span className={css.cardTags}>
              {task.tags.map(tag => (
                <span
                  key={tag.name}
                  className={css.cardTag}
                  data-tag-tone={tagTone(tag.name)}
                  data-dsh-part="tag-badge"
                  data-tag-hint={tag.promptPrefix === undefined ? undefined : tag.promptPrefix}
                  title={tag.promptPrefix === undefined ? tag.name : tag.promptPrefix}
                >
                  {tag.name}
                </span>
              ))}
            </span>
          )}
          {excerpt !== '' && <span className={css.cardExcerpt} data-dsh-part="card-excerpt">{excerpt}</span>}
          <span className={css.cardMeta}>
            {decoration}
            {isSubtask && (
              <span className={css.cardSubtask} data-dsh-part="subtask-badge">{t('card.subtask')}</span>
            )}
            {subtaskCount > 0 && (
              // A board that hides subtask cards still has to report them: the badge
              // rolls up the direct children and takes the tone of the worst state,
              // so a hidden failing tree cannot look green.
              <span
                className={css.cardSubtask}
                data-dsh-part="subtask-count"
                data-tone={subtasksFailed > 0 ? 'failed' : subtasksRunning > 0 ? 'running' : subtasksDone === subtaskCount ? 'done' : undefined}
                title={t('card.subtasksBreakdown', {
                  total: String(subtaskCount),
                  done: String(subtasksDone),
                  running: String(subtasksRunning),
                  failed: String(subtasksFailed),
                })}
              >
                {t('card.subtasks', { count: String(subtaskCount) })}
                {subtasksFailed > 0 ? ' · ' + t('card.subtasksFailed', { count: String(subtasksFailed) }) : ''}
                {subtasksFailed === 0 && subtasksRunning > 0 ? ' · ' + t('card.subtasksRunning', { count: String(subtasksRunning) }) : ''}
              </span>
            )}
            {timeLabel}
            {task.freeze !== undefined && (
              <span className={css.cardSchedule} title={task.freeze.goal}>{t('card.frozen')}</span>
            )}
            {!archived && task.schedule?.enabled === true && (
              <span
                className={css.cardSchedule}
                title={task.schedule.nextRunAt !== undefined
                  ? `${t(task.schedule.mode === 'once' ? 'card.scheduledOnce' : 'card.scheduled')} · ${formatHostTimestamp(task.schedule.nextRunAt, timeZone)}`
                  : t(task.schedule.mode === 'once' ? 'card.scheduledOnce' : 'card.scheduled')}
              >
                <IconClock size={12} />
                {t(task.schedule.mode === 'once' ? 'card.scheduledOnce' : 'card.scheduled')}
              </span>
            )}
          </span>
          <span className={css.cardStatus}>
            <span className={css.cardStatusText}>
              {!archived && pending && <span className={css.cardRunningLabel}>{t('board.pending')}…</span>}
              {runningLabel !== '' && <span className={css.cardRunningLabel}>{runningLabel}…</span>}
              {runLine}
            </span>
            <span className={css.cardStatusTrail}>
              <span className={css.cardSpinnerSlot} aria-hidden="true">
                {!archived && (busy || pending) && <span className={css.cardSpinner} />}
              </span>
              {sessionMark}
            </span>
          </span>
        </>
      )}
    </article>
  )
}

/** Memoized card: re-renders only when the card's own task record changes. */
export const TaskCard = memo(TaskCardInner)
