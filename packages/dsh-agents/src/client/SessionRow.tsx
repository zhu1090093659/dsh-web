/**
 * One row of the squad's live roster or of its run history.
 *
 * Both surfaces answer the same question about a different object - "what is
 * the state of this session, and how do I get to it" - so they are one
 * component family with an explicit variant rather than two card styles that
 * would drift: the lead and teammate variants carry the pinned facts of the
 * member that session runs as, the squad-run and member-run variants carry the
 * instant and the goal of a recorded launch.
 *
 * The status line is rendered whether or not there is anything to say, and its
 * height is reserved in the stylesheet, so a run that starts or settles never
 * moves the rows around it. It is a live region and it carries both a glyph and
 * a text label: status never rides on colour alone.
 */
import type { ReactNode } from 'react'
import { StatusGlyph } from './icons.tsx'
import { t } from './locales.ts'
import type { StatusTone } from './runs.ts'
import css from './agents.module.css'

/** Which surface one row belongs to: a live session, or a recorded run. */
export type SessionRowVariant = 'lead' | 'teammate' | 'squad-run' | 'member-run'

/** One labelled fact of a row, rendered through the shared meta list. */
export interface SessionRowFact {
  label: string
  value: string
}

export interface SessionRowProps {
  variant: SessionRowVariant
  /** The row's own name: a teammate name, or the member a run started. */
  title: string
  /** The role badge: lead, teammate, squad run or member run. */
  badge: string
  status: { label: string; tone: StatusTone }
  /** Pinned facts of the member behind this session; absent on run rows. */
  facts?: readonly SessionRowFact[]
  /** The goal a squad run was given; absent on member runs and live rows. */
  detail?: string
  /** When the run was recorded; absent on live roster rows. */
  time?: { iso: string; label: string }
  /** Switch the GUI to this session; absent when the deployment serves no opener, and the action is then disabled. */
  onOpenSession?: () => void
  /** Label of the open-session action; defaults to the shared label. */
  openLabel?: string
}

/** Colour slot per tone; the label and the glyph carry the state, this only reinforces it. */
const TONE_CLASS: Record<StatusTone, string> = {
  pending: css.tonePending,
  active: css.toneActive,
  success: css.toneSuccess,
  error: css.toneError,
}

/** The part name each variant anchors to (semantic-attrs-v1: owner is the plugin). */
const PARTS: Record<SessionRowVariant, string> = {
  'lead': 'squad-team-row',
  'teammate': 'squad-team-row',
  'squad-run': 'squad-run-row',
  'member-run': 'squad-run-row',
}

/**
 * Render one session row.
 * @param props - the row's facts, status and actions.
 */
export function SessionRow({ variant, title, badge, status, facts, detail, time, onOpenSession, openLabel }: SessionRowProps): ReactNode {
  return (
    <article className={css.row} data-dsh-part={PARTS[variant]} data-dsh-variant={variant}>
      <div className={css.rowHead}>
        <h5 className={css.rowTitle}>{title}</h5>
        <span className={css.rowBadge}>{badge}</span>
      </div>
      <p className={css.rowStatus + ' ' + TONE_CLASS[status.tone]} role="status" data-dsh-part="run-status">
        <StatusGlyph tone={status.tone} />
        <span>{status.label}</span>
      </p>
      {facts === undefined || facts.length === 0 ? null : (
        <dl className={css.meta}>
          {facts.map(fact => (
            <div key={fact.label} className={css.metaItem}>
              <dt className={css.metaLabel}>{fact.label}</dt>
              <dd className={css.metaValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {detail === undefined || detail === '' ? null : <p className={css.rowDetail} data-dsh-part="squad-row-detail">{detail}</p>}
      {time === undefined ? null : <time className={css.rowTime} dateTime={time.iso}>{time.label}</time>}
      {/* Every row here names a real session, so the action is always present.
          When no opener serves this deployment it stays visible and disabled,
          carrying the reason: a row whose session cannot be opened must not
          read as a row without a session. */}
      <div className={css.rowActions}>
        <button
          type="button"
          className={css.secondary}
          disabled={onOpenSession === undefined}
          {...(onOpenSession === undefined ? { title: t('member.openSessionUnavailable') } : {})}
          onClick={onOpenSession}
        >
          {openLabel ?? t('member.openSession')}
        </button>
      </div>
    </article>
  )
}
