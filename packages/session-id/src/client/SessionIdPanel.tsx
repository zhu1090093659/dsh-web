/**
 * Session ID panel — a centered modal listing every session with its full id
 * and a copy button. Data rides the injected `sessionList` observable
 * (ctx.sessions.list, see SessionRuntime.list) read through
 * useSyncExternalStore, so the panel stays in sync with host list updates and
 * needs no per-session runtime wiring.
 */
import { useSyncExternalStore, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionIdIcon, CheckIcon, CopyIcon, CloseIcon } from './icons.tsx'
import css from './session-id.module.css'

/** The sessions-list read face injected by the plugin (ObservableSnapshot). */
export type SessionListReadSource = {
  getSnapshot(): SessionListState
  subscribe(fn: () => void): () => void
}

/** Panel props: the list source + the locale seat. */
export type SessionIdPanelProps = PropsLocale<'session-id'> & {
  list: SessionListReadSource
  onClose: () => void
}

/** Short relative label for a session's update time (zh/en shared w/ locales). */
function relativeTimeLabel(updatedAt: number, now: number, t: PropsLocale<'session-id'>['t']): string {
  const diff = Math.max(0, now - updatedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t('panel.updatedAt', { t: t('panel.time.now') })
  if (diff < hour) return t('panel.updatedAt', { t: t('panel.time.minutes', { n: Math.floor(diff / minute) }) })
  if (diff < day) return t('panel.updatedAt', { t: t('panel.time.hours', { n: Math.floor(diff / hour) }) })
  return t('panel.updatedAt', { t: t('panel.time.days', { n: Math.floor(diff / day) }) })
}

/** Sort sessions by update time, newest first; blank rows sink to the bottom. */
function sortSessions(list: SessionListState): SessionSummary[] {
  const rows = list.ids
    .map(id => list.byId[id])
    .filter((row): row is SessionSummary => row !== undefined)
  return [...rows].sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1
    return b.updatedAt - a.updatedAt
  })
}

/** One session row: title + id + copy button with transient "copied" state. */
function SessionRow({ session, current, t }: {
  session: SessionSummary
  current: string | undefined
  t: PropsLocale<'session-id'>['t']
}) {
  const [copied, setCopied] = useState(false)
  const active = session.id === current
  const title = session.displayTitle || session.id
  const now = Date.now()

  const handleCopy = (): void => {
    void writeClipboard(session.id).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1200)
    })
  }

  return (
    <div className={css.row}>
      <span className={css.rowInfo}>
        <span className={`${css.rowTitle}${active ? ` ${css.rowActive}` : ''}`} title={title}>
          {title}
        </span>
        {active && <span className={css.rowMeta}>{t('panel.current')}</span>}
        <span className={css.rowId} title={session.id}>{session.id}</span>
      </span>
      <button
        type="button"
        className={css.copyButton}
        data-copied={copied ? 'true' : undefined}
        aria-label={`${t('panel.copy')} ${session.id}`}
        onClick={handleCopy}
      >
        {copied ? <CheckIcon className={css.iconSmall} /> : <CopyIcon className={css.iconSmall} />}
        {copied ? t('panel.copied') : t('panel.copy')}
      </button>
    </div>
  )
}

/**
 * Render the session-id panel body.
 * @param props - injected list source + locale seat + close callback.
 * @returns the modal panel.
 */
export function SessionIdPanel({ list, onClose, t }: SessionIdPanelProps) {
  const snapshot = useSyncExternalStore(list.subscribe, list.getSnapshot)
  const rows = sortSessions(snapshot)

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('panel.title')}>
        <div className={css.header}>
          <div className={css.heading}>
            <h2 className={css.title}>{t('panel.title')}</h2>
          </div>
          <button
            type="button"
            className={css.closeButton}
            aria-label={t('panel.close')}
            onClick={onClose}
          >
            <CloseIcon className={css.icon} />
          </button>
        </div>
        {rows.length === 0 ? (
          <div className={css.empty}>{t('panel.empty')}</div>
        ) : (
          <div className={css.list}>
            {rows.map(row => (
              <SessionRow key={row.id} session={row} current={snapshot.current} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
