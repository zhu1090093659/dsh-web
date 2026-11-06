/**
 * One member card: the name, the pinned preset/permission/model, the brief
 * with its clamp, and the run / open-session / edit / delete actions.
 *
 * The card is presentational: the page owns the transport, so a click only
 * reports the member id back. Delete asks once inline instead of opening a
 * native dialog, which keeps the flow usable from a phone and testable.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { t } from './locales.ts'
import { permissionLabel } from './permissions.ts'
import { runStatusLabel, runStatusTone } from './runs.ts'
import { StatusGlyph } from './icons.tsx'
import type { MemberDefinition, RunRecord } from '../protocol.ts'
import css from './agents.module.css'

/** One run outcome to show on the card it belongs to. */
export interface MemberNotice {
  memberId: string
  kind: 'ok' | 'failed'
  message: string
}

export interface MemberCardProps {
  member: MemberDefinition
  /** Newest run of this member, if it ever ran. */
  run: RunRecord | undefined
  /** A page-level action is in flight; every action on the card is disabled. */
  busy: boolean
  notice: MemberNotice | undefined
  /** Start this member's own session (点播). */
  onRun: () => void
  /** Switch the GUI to an existing session; absent when the deployment has none. */
  onOpenSession: ((sessionId: string) => void) | undefined
  onEdit: () => void
  onDelete: () => void
}

/**
 * One pinned field's value.
 *
 * The sheet clips it to a single line so a long pin cannot grow the track it
 * shares with the cells beside it; the whole string stays in the node's text,
 * its tooltip and its accessible name, so nothing is lost to the clip.
 * @param props - the value as the Host reported it.
 */
function MetaValue({ value }: { value: string }): ReactNode {
  return <dd className={css.metaValue} title={value} aria-label={value}>{value}</dd>
}

/**
 * Render one member card.
 * @param props - the member, its newest run, and the page actions.
 */
export function MemberCard({ member, run, busy, notice, onRun, onOpenSession, onEdit, onDelete }: MemberCardProps): ReactNode {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const brief = member.brief ?? ''
  return (
    <article className={css.memberCard} data-dsh-part="member-card">
      <h4 className={css.memberName}>{member.name}</h4>
      <dl className={css.meta}>
        <div className={css.metaItem}>
          <dt className={css.metaLabel}>{t('member.preset')}</dt>
          <MetaValue value={member.preset === undefined || member.preset === '' ? t('member.inherit') : member.preset} />
        </div>
        <div className={css.metaItem}>
          <dt className={css.metaLabel}>{t('member.permission')}</dt>
          <MetaValue value={permissionLabel(member.permission)} />
        </div>
        <div className={css.metaItem}>
          <dt className={css.metaLabel}>{t('member.model')}</dt>
          <MetaValue value={member.model === undefined || member.model === '' ? t('member.inherit') : member.model} />
        </div>
      </dl>
      <p className={css.memberBrief} data-dsh-part="member-brief">{brief}</p>
      {/* Always mounted: the status line reserves its own height, so the first
          run of a member never moves the actions below it, and it is a live
          region carrying both a glyph and a text label. */}
      <p className={css.runStatus} role="status" data-dsh-part="member-run-status">
        {run === undefined ? null : (
          <>
            <StatusGlyph tone={runStatusTone(run)} />
            <span>{runStatusLabel(run)}</span>
          </>
        )}
      </p>
      {/* A run's own outcome sits above the action row: the row carries the auto
          margin that pins it to the card bottom, so a notice appearing or
          clearing never lifts the buttons off the line they share with the
          neighbouring cards. */}
      {notice === undefined ? null : (
        <p className={notice.kind === 'failed' ? css.noticeError : css.noticeOk} role={notice.kind === 'failed' ? 'alert' : 'status'}>{notice.message}</p>
      )}
      <div className={css.memberActions}>
        <button type="button" className={css.primary} disabled={busy} onClick={onRun}>
          {busy ? t('member.running') : run === undefined ? t('member.run') : t('member.runAgain')}
        </button>
        {run === undefined ? null : (
          // The action is present whenever the member HAS a session, and it is
          // disabled - with the reason stated on it - when nothing serves an
          // opener. Hiding it made a load-order accident look like "this member
          // never ran"; a disabled button says which capability is missing.
          <button
            type="button"
            className={css.secondary}
            disabled={onOpenSession === undefined}
            {...(onOpenSession === undefined ? { title: t('member.openSessionUnavailable') } : {})}
            onClick={onOpenSession === undefined ? undefined : () => { onOpenSession(run.sessionId) }}
          >
            {t('member.openSession')}
          </button>
        )}
        <button type="button" className={css.secondary} disabled={busy} onClick={onEdit}>{t('member.edit')}</button>
        {confirmingDelete ? (
          <>
            <button type="button" className={css.danger} disabled={busy} onClick={() => { setConfirmingDelete(false); onDelete() }}>
              {t('member.deleteConfirm')}
            </button>
            <button type="button" className={css.secondary} onClick={() => { setConfirmingDelete(false) }}>{t('member.cancel')}</button>
          </>
        ) : (
          <button type="button" className={css.secondary} disabled={busy} onClick={() => { setConfirmingDelete(true) }}>{t('member.delete')}</button>
        )}
      </div>
    </article>
  )
}
