/**
 * The list-level toolbar: check every installed third-party plugin for a newer
 * registry release, apply them in one run, then restart DSH to load them.
 *
 * It exists because the official Plugins page compares one package at a time
 * (its `plugins.detail.section` contributions render on a bundle's page), while
 * the answer a user wants when they open the page is "is anything of mine out
 * of date, and can I just fix it". It is mounted beside the page's "Installed"
 * heading (see plugin-toolbar-mount.tsx) because that heading is the page's own
 * chrome and the page declares no seat next to it.
 *
 * Policy lives in core/updates.ts (third-party only, compatibility-gated) and
 * the operations come from the injected face, so this component is pure
 * rendering plus the sequence of calls: nothing here touches the DOM beyond its
 * own subtree.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginUpdateItem, RestartMode } from '../core/protocol.ts'
import { applicableUpdates, isUpdateApplicable, thirdPartyUpdates } from '../core/updates.ts'
import { displayMinimumVersion } from '../core/version.ts'
import css from './plugin-manager.module.css'

/** The operations the toolbar drives (the package's dual-channel face). */
export interface PluginListToolbarInjected {
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Compare every installed plugin against the version its source serves. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<unknown>
  /**
   * Read how a restart would be carried out, without carrying it out: the
   * confirmation must name the same consequence the host will produce (an
   * in-place relaunch, the packaged Desktop shell's own recovery dialog, or a
   * manual restart), and a plan read has no side effects.
   */
  restartPlan: () => Promise<RestartMode>
  /** Restart the host so an applied update is loaded. */
  restart: () => Promise<RestartMode>
}

/** Full component props. */
export type PluginListToolbarProps =
  & PropsLocale<'settings.pluginManager'>
  & PluginListToolbarInjected

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** What the toolbar is currently doing. */
type Phase = 'idle' | 'checking' | 'updating'

/** Which flyout is open under the buttons. */
type Panel = 'none' | 'list' | 'restart'

/**
 * The toolbar itself. All state is local: the page around it owns the plugin
 * list, and a restart tears this component down anyway.
 */
export function PluginListToolbar(props: PluginListToolbarProps) {
  const { t, isLoopback, checkUpdates, update, restartPlan, restart } = props

  const [phase, setPhase] = useState<Phase>('idle')
  const [checked, setChecked] = useState(false)
  /** Every third-party row the last check reported, including the applied ones. */
  const [found, setFound] = useState(0)
  const [rows, setRows] = useState<PluginUpdateItem[]>([])
  const [applied, setApplied] = useState<string[]>([])
  const [cursor, setCursor] = useState<{ name: string; index: number; total: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [panel, setPanel] = useState<Panel>('none')
  /** How the host says it would restart, read before the confirmation is shown. */
  const [plan, setPlan] = useState<RestartMode | undefined>(undefined)
  const [restartMode, setRestartMode] = useState<RestartMode | undefined>(undefined)
  /** Synchronous in-flight mirror of the phase: a click and a keypress can land in one frame. */
  const busyRef = useRef(false)

  const pending = applicableUpdates(rows)

  /** Close the flyout on Escape, the shell's own dismissal gesture. */
  useEffect(() => {
    if (panel === 'none') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanel('none')
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [panel])

  const onCheck = (): void => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase('checking')
    setError(undefined)
    setRestartMode(undefined)
    void checkUpdates().then(items => {
      const thirdParty = thirdPartyUpdates(items)
      setRows(thirdParty)
      setFound(thirdParty.length)
      setApplied([])
      setChecked(true)
      setPanel('list')
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setPanel('list')
    }).finally(() => {
      busyRef.current = false
      setPhase('idle')
    })
  }

  const onUpdateAll = (): void => {
    if (busyRef.current) return
    const queue = applicableUpdates(rows)
    if (queue.length === 0) return
    busyRef.current = true
    setPhase('updating')
    setError(undefined)
    void (async () => {
      const done: string[] = []
      for (const [index, row] of queue.entries()) {
        setCursor({ name: row.id, index: index + 1, total: queue.length })
        try {
          await update(row.id)
        } catch (reason) {
          // Stop at the first failure: the remaining rows stay listed with their
          // versions, so the user sees exactly what did not go through.
          setError(t('failed', { reason: messageOf(reason) }))
          break
        }
        done.push(row.id)
        setApplied([...done])
        setRows(current => current.filter(item => item.id !== row.id))
      }
      setCursor(undefined)
    })().finally(() => {
      busyRef.current = false
      setPhase('idle')
    })
  }

  /** Ask the host how it would restart, then show the confirmation that matches. */
  const onAskRestart = (): void => {
    if (busyRef.current) return
    busyRef.current = true
    setError(undefined)
    void restartPlan().then(mode => {
      setPlan(mode)
      setPanel('restart')
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setPanel('list')
    }).finally(() => {
      busyRef.current = false
    })
  }

  const onRestart = (): void => {
    if (busyRef.current) return
    busyRef.current = true
    setError(undefined)
    void restart().then(mode => {
      setRestartMode(mode)
      setPlan(undefined)
      setPanel('none')
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
    }).finally(() => {
      busyRef.current = false
    })
  }

  const shellProps = {
    'data-dsh-plugin': 'plugin-manager',
    'data-dsh-part': 'update-toolbar',
    'data-update-toolbar': true,
  } as const

  if (!isLoopback) {
    return (
      <div className={css.toolbar} {...shellProps} data-state="local-only">
        <button type="button" className={css.toolbarButton} disabled title={t('localOnlyBody')}>
          {t('checkUpdates')}
        </button>
      </div>
    )
  }

  const busy = phase !== 'idle'
  /** One alert line, rendered in whichever flyout is open when it appears. */
  const errorLine = error === undefined
    ? null
    : <p className={css.error} role="alert" data-update-error>{error}</p>
  /** What is still pending after a partial run (the applied rows leave the list). */
  const remaining = found - applied.length
  const summary = cursor !== undefined
    ? t('updatingAll', { name: cursor.name, index: String(cursor.index), total: String(cursor.total) })
    : remaining > 0
      ? t('updatesAvailable', { count: String(remaining) })
      : applied.length > 0
        ? t('updateAllDone')
        : t('noUpdates')

  return (
    <div className={css.toolbar} {...shellProps} data-state={restartMode ?? phase} aria-busy={busy}>
      <button type="button" className={css.toolbarButton} data-update-check disabled={busy} onClick={onCheck}>
        {phase === 'checking' ? t('checking') : t('checkUpdates')}
      </button>

      {checked && (
        <button
          type="button"
          className={css.toolbarSummary}
          data-update-summary
          data-pending={pending.length}
          aria-expanded={panel === 'list'}
          onClick={() => { setPanel(panel === 'list' ? 'none' : 'list') }}
        >
          {summary}
        </button>
      )}

      <button
        type="button"
        className={applied.length > 0 ? `${css.toolbarButton} ${css.primary}` : css.toolbarButton}
        data-update-restart
        data-restart-pending={applied.length}
        disabled={busy || restartMode === 'relaunch'}
        onClick={() => { if (panel === 'restart') { setPanel('none'); setPlan(undefined); return } onAskRestart() }}
      >
        {restartMode === 'relaunch' ? t('restarting') : t('restartNow')}
      </button>

      {restartMode !== undefined && panel !== 'restart' && (
        <span className={css.toolbarHint} role="status" data-update-restart-hint={restartMode}>
          {restartMode === 'shell' ? t('restartDesktopHint') : restartMode === 'manual' ? t('restartManualHint') : t('restartRelaunchHint')}
        </span>
      )}

      {panel === 'list' && (
        <div className={css.panel} data-update-panel role="group" aria-label={t('updatesPanelTitle')}>
          {errorLine}
          {applied.length > 0 && <p className={css.ok} data-update-applied>{t('updateAllDone')}</p>}
          {rows.length === 0 && applied.length === 0 && error === undefined && <p className={css.hint}>{t('noUpdates')}</p>}
          {rows.length > 0 && (
            <ul className={css.panelList}>
              {rows.map(row => (
                <li key={row.id} className={css.panelRow} data-update-row={row.id} data-compatible={isUpdateApplicable(row) ? 'yes' : 'no'}>
                  <span className={css.panelName}>{row.id}</span>
                  <span className={css.panelVersion}>{row.current} → {row.latest}</span>
                  {row.compatible === false && row.requiresDsh !== undefined && (
                    <span className={css.compatBlocked} data-update-row-compat-reason={row.hostVersion === undefined ? 'unverified' : 'below-minimum'}>
                      {row.hostVersion === undefined
                        ? t('updateUnverifiedDsh', { min: displayMinimumVersion(row.requiresDsh) })
                        : t('updateBlockedDsh', { min: displayMinimumVersion(row.requiresDsh) })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className={css.panelActions}>
            {pending.length > 0 && (
              <button type="button" className={`${css.button} ${css.primary}`} data-update-all disabled={busy} onClick={onUpdateAll}>
                {phase === 'updating' ? t('updating') : t('updateAll', { count: String(pending.length) })}
              </button>
            )}
            {applied.length > 0 && (
              <button type="button" className={`${css.button} ${css.primary}`} data-update-panel-restart disabled={busy} onClick={onAskRestart}>
                {t('restartNow')}
              </button>
            )}
          </div>
          <p className={css.hint}>{t('thirdPartyOnly')}</p>
        </div>
      )}

      {panel === 'restart' && (
        <div className={css.panel} data-update-restart-panel data-restart-plan={plan} role="group" aria-label={t('restartNow')}>
          {errorLine}
          <p className={css.hint} data-restart-plan-hint={plan}>
            {plan === 'shell' ? t('restartPlanShell') : plan === 'manual' ? t('restartPlanManual') : t('restartPlanRelaunch')}
          </p>
          {plan === 'shell' && <p className={css.hint}>{t('restartShellWarning')}</p>}
          <div className={css.panelActions}>
            <button type="button" className={css.button} data-restart-cancel onClick={() => { setPanel('none'); setPlan(undefined) }}>
              {t('cancel')}
            </button>
            {plan !== 'manual' && (
              <button
                type="button"
                className={`${css.button} ${css.primary}`}
                data-restart-confirm
                onClick={onRestart}
              >
                {t('restartConfirm')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
