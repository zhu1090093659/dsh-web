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
import type { PluginBatchUpdateResult, PluginUpdateItem, RestartMode, RestartPlanWire } from '../core/protocol.ts'
import { applicableUpdates, thirdPartyUpdates } from '../core/updates.ts'
import { displayMinimumVersion } from '../core/version.ts'
import { dshGateOf } from './PluginUpdatePatch.tsx'
import css from './plugin-manager.module.css'

/** The operations the toolbar drives (the package's dual-channel face). */
export interface PluginListToolbarInjected {
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Compare every installed plugin against the version its source serves. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
  /**
   * Apply every listed update in one run and answer which rows landed and which
   * did not.
   *
   * One call rather than one call per plugin: the sequence (and the decision that
   * a refused row does not end the run) is the host's, so the toolbar no longer
   * spends a request and a job on each row. A row that landed but needs a restart
   * is still an applied row — it joins the restart list instead of failing.
   */
  updateAll: (ids: string[], onRow?: (row: UpdateCursor) => void) => Promise<PluginBatchUpdateResult>
  /**
   * Read how a restart would be carried out, without carrying it out: the
   * confirmation must name the same consequence the host will produce (an
   * in-place relaunch, the packaged Desktop shell's own recovery dialog, a
   * systemd unit restart, or a manual restart), and a plan read has no side
   * effects. A systemd plan carries the unit it would restart.
   */
  restartPlan: () => Promise<RestartPlanWire>
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

/** Translate in this package's namespace. */
type Translate = PluginListToolbarProps['t']

/**
 * The consequence confirming produces, in the reader's language. It states
 * what the host will actually do, so a systemd plan names the unit that goes
 * down and comes back.
 */
function planCopy(plan: RestartPlanWire | undefined, t: Translate): string {
  // The wire is a discriminated union: a systemd plan carries the unit this
  // copy must name, and no other mode has one to read.
  if (plan?.mode === 'systemd') return t('restartPlanSystemd', { unit: plan.unit })
  if (plan?.mode === 'shell') return t('restartPlanShell')
  if (plan?.mode === 'manual') return t('restartPlanManual')
  return t('restartPlanRelaunch')
}

/** Which row a running batch is on, as the face reports it. */
export interface UpdateCursor {
  /** Package name of the row in flight. */
  id: string
  /** One-based position of that row in the run. */
  index: number
  /** How many rows the run was asked to apply. */
  total: number
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
  const { t, isLoopback, checkUpdates, updateAll, restartPlan, restart } = props

  const [phase, setPhase] = useState<Phase>('idle')
  const [checked, setChecked] = useState(false)
  /** Every third-party row the last check reported, including the applied ones. */
  const [rows, setRows] = useState<PluginUpdateItem[]>([])
  const [applied, setApplied] = useState<string[]>([])
  /**
   * Updates this run applied whose new version the running host has not loaded,
   * with the version that landed. They stay in `applied` — the update did go
   * through — and are listed as needing a restart instead of leaving the panel
   * claiming a plain success.
   */
  const [restartRequired, setRestartRequired] = useState<{ id: string; version: string }[]>([])
  /**
   * Rows the last run could not apply, with the host's reason. They stay in
   * `rows` — the user has to see which plugin is stuck and why, beside the
   * version it is stuck on — and only the whole-call failure reaches `error`.
   */
  const [failures, setFailures] = useState<{ id: string; error: string }[]>([])
  const [cursor, setCursor] = useState<{ name: string; index: number; total: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [panel, setPanel] = useState<Panel>('none')
  /** How the host says it would restart, read before the confirmation is shown. */
  const [plan, setPlan] = useState<RestartPlanWire | undefined>(undefined)
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
      setApplied([])
      setRestartRequired([])
      setFailures([])
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
    setFailures([])
    void updateAll(queue.map(row => row.id), row => {
      setCursor({ name: row.id, index: row.index, total: row.total })
    }).then(result => {
      // Every landed row leaves the list, including the ones this process cannot
      // load yet: those are applied (and name their restart), not failures.
      const landed = new Set(result.applied.map(row => row.id))
      const restart = result.applied
        .filter(row => row.restartRequired === true)
        .map(row => ({ id: row.id, version: row.landed ?? '' }))
      setApplied(current => [...current, ...result.applied.map(row => row.id)])
      setRestartRequired(current => [...current, ...restart])
      // A refused row stays listed with the reason the host gave, so the run's
      // partial result is visible row by row instead of as one alert line.
      setFailures(result.failed.map(row => ({ id: row.id, error: row.error ?? t('updateFailedUnknown') })))
      setRows(current => current.filter(item => !landed.has(item.id)))
    }).catch(reason => {
      // The request itself failed (route refused, transport, no writer): nothing
      // ran, so the list stays exactly as it was and the alert explains why.
      setError(t('failed', { reason: messageOf(reason) }))
    }).finally(() => {
      setCursor(undefined)
      busyRef.current = false
      setPhase('idle')
    })
  }

  /** Ask the host how it would restart, then show the confirmation that matches. */
  const onAskRestart = (): void => {
    if (busyRef.current) return
    busyRef.current = true
    setError(undefined)
    void restartPlan().then(answer => {
      setPlan(answer)
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
  /**
   * The host leaves once the route accepts a relaunch or a systemd restart:
   * both replace this process, so the action is spent and reads as in progress.
   */
  const hostLeaves = restartMode === 'relaunch' || restartMode === 'systemd'
  /** The mode the plan read named; the confirmation only opens after one arrived. */
  const planMode = plan?.mode
  /** One alert line, rendered in whichever flyout is open when it appears. */
  const errorLine = error === undefined
    ? null
    : <p className={css.error} role="alert" data-update-error>{error}</p>
  /** What is still pending after a partial run (the applied rows leave the list). */
  const remaining = rows.length
  const failedCount = failures.length
  /**
   * One line for the whole run: the row in flight, what is still pending, and —
   * once nothing is — whether the run landed everything or only part of it. A
   * partial run must not read as a clean one.
   */
  const summary = cursor !== undefined
    ? t('updatingAll', { name: cursor.name, index: String(cursor.index), total: String(cursor.total) })
    : remaining > 0
      ? t('updatesAvailable', { count: String(remaining) })
      : failedCount > 0
        ? t('updateAllPartial', { done: String(applied.length), failed: String(failedCount) })
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
        disabled={busy || hostLeaves}
        onClick={() => { if (panel === 'restart') { setPanel('none'); setPlan(undefined); return } onAskRestart() }}
      >
        {hostLeaves ? t('restarting') : t('restartNow')}
      </button>

      {restartMode !== undefined && panel !== 'restart' && (
        <span className={css.toolbarHint} role="status" data-update-restart-hint={restartMode}>
          {restartMode === 'shell' ? t('restartDesktopHint') : restartMode === 'manual' ? t('restartManualHint') : t('restartRelaunchHint')}
        </span>
      )}

      {panel === 'list' && (
        <div className={css.panel} data-update-panel role="group" aria-label={t('updatesPanelTitle')}>
          {errorLine}
          {applied.length > 0 && (
            <p className={css.ok} data-update-applied>
              {failedCount > 0
                ? t('updateAllPartial', { done: String(applied.length), failed: String(failedCount) })
                : t('updateAllDone')}
            </p>
          )}
          {restartRequired.length > 0 && (
            <ul className={css.restartRequired} data-update-restart-required>
              {restartRequired.map(item => (
                <li key={item.id} className={css.panelRow} data-update-restart-row={item.id}>
                  <span className={css.panelName}>{item.id}</span>
                  <span className={css.restartRequiredLine}>{t('updateRestartRequired', { version: item.version })}</span>
                </li>
              ))}
            </ul>
          )}
          {rows.length === 0 && applied.length === 0 && error === undefined && <p className={css.hint}>{t('noUpdates')}</p>}
          {rows.length > 0 && (
            <ul className={css.panelList}>
              {rows.map(row => {
                // One verdict per row, read once: the badge, its copy and the
                // bulk action's exclusion all come from the same answer.
                const gate = dshGateOf(row)
                const failure = failures.find(item => item.id === row.id)
                return (
                  <li key={row.id} className={css.panelRow} data-update-row={row.id} data-compatible={gate === 'open' ? 'yes' : 'no'}>
                    <span className={css.panelName}>{row.id}</span>
                    <span className={css.panelVersion}>{row.current} → {row.latest}</span>
                    {gate === 'open' ? null : (
                      <span className={css.compatBlocked} data-update-row-compat-reason={gate}>
                        {row.requiresDsh !== undefined
                          ? t(gate === 'unverified' ? 'updateUnverifiedDsh' : 'updateBlockedDsh', {
                            min: displayMinimumVersion(row.requiresDsh),
                          })
                          : t('updateUnverifiedDshUnknownRange')}
                      </span>
                    )}
                    {failure === undefined ? null : (
                      <span className={css.compatBlocked} data-update-row-error={failure.id}>
                        {t('updateFailedRow', { reason: failure.error })}
                      </span>
                    )}
                  </li>
                )
              })}
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
        <div className={css.panel} data-update-restart-panel data-restart-plan={planMode} role="group" aria-label={t('restartNow')}>
          {errorLine}
          <p className={css.hint} data-restart-plan-hint={planMode}>
            {planCopy(plan, t)}
          </p>
          {planMode === 'shell' && <p className={css.hint}>{t('restartShellWarning')}</p>}
          <div className={css.panelActions}>
            <button type="button" className={css.button} data-restart-cancel onClick={() => { setPanel('none'); setPlan(undefined) }}>
              {t('cancel')}
            </button>
            {planMode !== 'manual' && (
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
