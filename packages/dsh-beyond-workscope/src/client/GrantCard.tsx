/**
 * The grant confirmation card + grant manager.
 *
 * One floating panel (bottom-right) with two faces:
 *  - confirmation: every pending grant, with a scope picker (the user may
 *    tighten a requested write grant to read), the agent's stated reason,
 *    and a live auto-deny countdown;
 *  - management: active grants with one-click revoke, plus recent audit.
 *
 * Failure policy: fetch problems degrade to a quiet retry loop — the card
 * must never take the GUI down (external-plugin discipline).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActiveGrantView, AuditEntry, GrantScope, PendingGrantView } from '../protocol.ts'
import type { WorkscopeApi } from './api.ts'
import type { BeyondKey } from './locales.ts'
import css from './GrantCard.module.css'

/** Poll cadence for pending grants (ms). */
const POLL_MS = 2000
/** Countdown tick (ms). */
const TICK_MS = 1000

/** Shorten an absolute path for the card body (keep head + tail). */
function shorten(path: string, max = 64): string {
  if (path.length <= max) return path
  const head = 28
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
}

/** Format an ISO instant as a compact local time. */
function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** The panel. */
export function GrantCard(props: { api: WorkscopeApi; t: (key: BeyondKey) => string }) {
  const { api, t } = props
  const [pending, setPending] = useState<PendingGrantView[]>([])
  const [grants, setGrants] = useState<ActiveGrantView[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [managing, setManaging] = useState(false)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const [scopes, setScopes] = useState<Record<string, GrantScope>>({})
  const [error, setError] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextPending, nextGrants] = await Promise.all([api.getPending(), api.getGrants()])
      if (!mounted.current) return
      setPending(nextPending)
      setGrants(nextGrants)
      setError(false)
      // Keep scope selection in sync with what the agent requested.
      setScopes(previous => {
        const merged = { ...previous }
        for (const item of nextPending) if (merged[item.id] === undefined) merged[item.id] = item.scope
        for (const id of Object.keys(merged)) if (!nextPending.some(item => item.id === id)) delete merged[id]
        return merged
      })
    } catch {
      if (mounted.current) setError(true)
    }
  }, [api])

  // Poll pending + grants; refresh audit while managing.
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
      if (managing) {
        api.getAudit().then(entries => { if (mounted.current) setAudit(entries) }).catch(() => undefined)
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh, api, managing])

  // Countdown tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const act = useCallback(async (action: () => Promise<void>, key: string): Promise<void> => {
    if (busy !== undefined) return
    setBusy(key)
    try {
      await action()
      await refresh()
    } catch {
      // A failed decision leaves the card in place for another try.
    }
    if (mounted.current) setBusy(undefined)
  }, [busy, refresh])

  const approve = (id: string): void => {
    void act(() => api.approve(id, scopes[id]), `approve:${id}`)
  }
  const deny = (id: string): void => {
    void act(() => api.deny(id), `deny:${id}`)
  }
  const revoke = (id: string): void => {
    void act(() => api.revoke(id), `revoke:${id}`)
  }

  const remaining = (item: PendingGrantView): number => {
    return Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now) / 1000))
  }

  const countdown = (item: PendingGrantView): ReactNode => {
    const seconds = remaining(item)
    const urgent = seconds <= 15
    const label = urgent ? t('card.expiresSoon') : t('card.expires').replace('{s}', String(seconds))
    return (
      <span className={css.countdown} data-urgent={urgent}>
        {label}
      </span>
    )
  }

  const empty = pending.length === 0 && !managing
  return (
    <div className={css.panel} data-empty={empty}>
      <div className={css.header}>
        <span className={css.headerTitle}>{t('card.title')}</span>
        <span className={css.badge}>{t('card.badge')}</span>
      </div>
      <div className={css.body}>
        {error && <div className={css.empty}>{t('card.offline')}</div>}
        {pending.map(item => (
          <div className={css.pending} key={item.id}>
            <div className={css.path} title={item.path}>
              <span className={css.kindBadge} data-kind={item.kind}>
                {item.kind === 'workspace' ? t('card.kind.workspace') : t('card.kind.grant')}
              </span>
              {item.kind === 'workspace' && item.title ? `${item.title} — ` : ''}{shorten(item.path)}
            </div>
            <div className={css.reason}>{item.reason}</div>
            {item.kind === 'workspace' && <div className={css.hint}>{t('card.workspace.hint')}</div>}
            <div className={css.meta}>
              {t('card.by')} {item.toolName}{item.agentName ? ` · ${item.agentName}` : ''} · {clock(item.requestedAt)} · {countdown(item)}
            </div>
            {item.kind !== 'workspace' && (
              <div className={css.scopes}>
                {(['read', 'write'] as const).map(scope => (
                  <button
                    type="button"
                    key={scope}
                    className={css.scope}
                    data-selected={(scopes[item.id] ?? item.scope) === scope}
                    onClick={() => setScopes(previous => ({ ...previous, [item.id]: scope }))}
                  >
                    {scope === 'read' ? t('card.scope.read') : t('card.scope.write')}
                  </button>
                ))}
              </div>
            )}
            <div className={css.actions}>
              <button
                type="button"
                className={`${css.button} ${css.deny}`}
                data-busy={busy === `deny:${item.id}`}
                onClick={() => deny(item.id)}
              >
                {t('card.deny')}
              </button>
              <button
                type="button"
                className={`${css.button} ${css.approve}`}
                data-busy={busy === `approve:${item.id}`}
                onClick={() => approve(item.id)}
              >
                {t('card.approve')}
              </button>
            </div>
          </div>
        ))}
        {managing && (
          <div className={css.manage}>
            <div className={css.manageTitle}>{t('card.manage.active')}</div>
            {grants.length === 0 && <div className={css.empty}>{t('card.manage.empty')}</div>}
            {grants.map(grant => (
              <div className={css.grantRow} key={grant.id}>
                <span className={css.grantPath} title={grant.path}>{shorten(grant.path, 48)}</span>
                <span className={css.grantScope}>{grant.scope === 'read' ? t('card.scope.read') : t('card.scope.write')}</span>
                <button
                  type="button"
                  className={css.revokeButton}
                  data-busy={busy === `revoke:${grant.id}`}
                  onClick={() => revoke(grant.id)}
                >
                  {t('card.manage.revoke')}
                </button>
              </div>
            ))}
            <div className={css.manageTitle}>{t('card.manage.audit')}</div>
            {audit.length === 0 && <div className={css.empty}>{t('card.manage.audit.empty')}</div>}
            {audit.slice(0, 10).map(entry => (
              <div className={css.auditLine} key={entry.id}>
                {clock(entry.at)} · {entry.kind} · {entry.detail}
              </div>
            ))}
          </div>
        )}
        <button type="button" className={css.manageToggle} onClick={() => setManaging(open => !open)}>
          {managing ? t('card.manage.close') : t('card.manage.open')}
        </button>
      </div>
    </div>
  )
}
