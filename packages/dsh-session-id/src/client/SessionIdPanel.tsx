/**
 * Session ID panel — a centered modal listing every session with its full id
 * and a copy button. Data rides the injected `sessionList` observable
 * (ctx.sessions.list, see SessionRuntime.list) read through
 * useSyncExternalStore, so the panel stays in sync with host list updates and
 * needs no per-session runtime wiring.
 */
import { useEffect, useRef, useSyncExternalStore, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { CheckIcon, CopyIcon, CloseIcon } from './icons.tsx'
import { SESSION_ID_PART_COPY, SESSION_ID_PART_PANEL, SESSION_ID_PART_ROW, SESSION_ID_PART_SEARCH, SESSION_ID_PLUGIN_ATTR } from './semantic.ts'
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

/** One session row: title + id + copy button with transient "copied" / failed state. */
function SessionRow({ session, current, t }: {
  session: SessionSummary
  current: string | undefined
  t: PropsLocale<'session-id'>['t']
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const idleTimer = useRef<number | undefined>(undefined)
  const active = session.id === current
  const title = session.displayTitle || session.id

  // A pending reset timer belongs to the previous copy; drop it when the row
  // leaves the DOM so nothing keeps running after unmount.
  useEffect(() => {
    return () => { window.clearTimeout(idleTimer.current) }
  }, [])

  const handleCopy = (): void => {
    // Clear the previous reset before a new write so rapid repeated clicks
    // never stack timers (only the latest copy reaches the idle reset).
    window.clearTimeout(idleTimer.current)
    // Copy must be gesture-driven; a failed write surfaces an actionable
    // message instead of silently swallowing the error (no permission
    // requests, no background retry).
    void writeClipboard(session.id).then((ok) => {
      if (ok) {
        setStatus('copied')
        idleTimer.current = window.setTimeout(() => { setStatus('idle') }, 1200)
      } else {
        setStatus('failed')
      }
    }).catch(() => {
      // A rejected write is the same actionable failure as ok === false.
      setStatus('failed')
    })
  }

  const copyLabel = status === 'copied' ? t('panel.copied')
    : status === 'failed' ? t('panel.copyFailed') : t('panel.copy')

  return (
    <div className={css.row} data-dsh-part={SESSION_ID_PART_ROW}>
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
        data-dsh-part={SESSION_ID_PART_COPY}
        data-copied={status === 'copied' ? 'true' : undefined}
        data-failed={status === 'failed' ? 'true' : undefined}
        aria-label={`${copyLabel} ${session.id}`}
        onClick={handleCopy}
      >
        {status === 'copied' ? <CheckIcon className={css.iconSmall} /> : <CopyIcon className={css.iconSmall} />}
        {copyLabel}
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
  const sorted = sortSessions(snapshot)
  const [search, setSearch] = useState('')

  // Local, read-only filter over the already-visible list (title or id
  // substring, case-insensitive) — no host API, no disk, no other profile.
  const query = search.trim().toLowerCase()
  const rows = query === ''
    ? sorted
    : sorted.filter(row => row.displayTitle.toLowerCase().includes(query) || row.id.toLowerCase().includes(query))

  return (
    <div className={css.overlay} role="presentation" data-dsh-plugin={SESSION_ID_PLUGIN_ATTR}>
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} data-dsh-part={SESSION_ID_PART_PANEL} role="dialog" aria-modal="true" aria-label={t('panel.title')}>
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
        <input
          type="search"
          className={css.search}
          data-dsh-part={SESSION_ID_PART_SEARCH}
          placeholder={t('panel.search.placeholder')}
          aria-label={t('panel.search.aria')}
          value={search}
          onChange={(event) => { setSearch(event.target.value) }}
        />
        {rows.length === 0 ? (
          <div className={css.empty}>{query === '' ? t('panel.empty') : t('panel.noMatches')}</div>
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
