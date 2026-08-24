/**
 * First-level settings section for dsh-doctor: the recovery console.
 *
 * Renders the supervisor snapshot (system phase, protected profiles,
 * incidents), the browser probe list and the diagnostic actions inside a
 * settings.section slot entry. All dynamic content sits behind a React error
 * boundary so a crash in one subview degrades to a recoverable fallback
 * instead of taking the settings surface down; the boundary reports into the
 * probe list.
 *
 * Semantic attrs: the root carries data-dsh-plugin="doctor"; parts carry bare
 * data-dsh-part values scoped by that plugin attribute.
 * @module @linxin666/dsh-doctor/client
 */

import { Component, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DoctorController, DoctorView } from './doctor-controller.ts'
import type { DoctorSettingsHandle, DoctorSettingsState } from './doctor-settings.ts'
import type { PassiveIncident } from './doctor-passive.ts'
import { composeHarnessPrompt, type HarnessFailureInput } from './harness-send.ts'
import { HarnessSendDialog } from './HarnessSendDialog.tsx'
import { copyText } from './clipboard.ts'
import type { DoctorKey } from './locales.ts'
import css from './doctor.module.css'

/** Business face injected by the slot registration. */
export interface DoctorConsoleInjected {
  controller: DoctorController
  settings: DoctorSettingsHandle | null
}

/** Composed props: the injected face plus the locale seat. */
export interface DoctorConsoleProps extends DoctorConsoleInjected {
  t: TranslateNS<'doctor'>
  /**
   * Render inside the family plugin settings card: the card chrome provides
   * the header and the form staging owns the enable switch, so the console
   * skips both and keeps only the live status, incidents, probe and actions.
   */
  embedded?: boolean
}

/** Fallback settings state when the handle is absent. */
const UNAVAILABLE_SETTINGS: DoctorSettingsState = { status: 'unavailable', enabled: undefined, writable: false }

/** Singleton unavailable handle: getState returns a cached snapshot so the
 * useSyncExternalStore snapshot identity never changes. */
const UNAVAILABLE_ADAPTER: DoctorSettingsHandle = {
  getState: () => UNAVAILABLE_SETTINGS,
  listen: () => () => {},
  setEnabled: async () => ({ ok: false as const, error: 'settings unavailable' }),
}

/** Always-available settings adapter so the hook order never changes. */
function stableSettingsAdapter(settings: DoctorSettingsHandle | null): DoctorSettingsHandle {
  return settings ?? UNAVAILABLE_ADAPTER
}

/** The recovery console: a first-level settings section, or the card body when embedded. */
export function DoctorRecoveryConsole(props: DoctorConsoleProps): ReactNode {
  const { t, controller } = props
  const embedded = props.embedded === true
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const adapter = useMemo(() => stableSettingsAdapter(props.settings), [props.settings])
  const settingsState = useSyncExternalStore(adapter.listen, adapter.getState)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [harnessOpen, setHarnessOpen] = useState(false)
  const [harnessBusy, setHarnessBusy] = useState(false)
  const [harnessError, setHarnessError] = useState<string | undefined>(undefined)
  const toggleLock = useRef(false)

  // Composed send-to-Harness facts (recomputed per render; the dialog seeds
  // its editable text only when it opens).
  const harnessFailure = newestFailure(t, view)
  const harnessInitialText = harnessFailure === undefined
    ? ''
    : composeHarnessPrompt(harnessFailure, {
      webVersion: view.hostVersion,
      supervisorVersion: view.snapshot?.version,
    }, {
      title: t('harness.prompt.title'),
      summary: t('harness.prompt.summary'),
      kind: t('harness.prompt.kind'),
      stack: t('harness.prompt.stack'),
      environment: t('harness.prompt.environment'),
    })
  const harnessTarget = controller.harnessTarget()
  const hasFailures = view.probe.length > 0 || view.incidents.length > 0

  const openHarness = (): void => {
    setHarnessError(undefined)
    setHarnessOpen(true)
  }

  const sendHarness = async (text: string): Promise<void> => {
    setHarnessBusy(true)
    setHarnessError(undefined)
    try {
      const result = await controller.sendToHarness(text)
      if (result.ok) {
        setHarnessOpen(false)
      } else {
        setHarnessError(result.message)
      }
    } catch (error) {
      setHarnessError(error instanceof Error ? error.message : String(error))
    } finally {
      setHarnessBusy(false)
    }
  }

  const toggleEnabled = async (): Promise<void> => {
    if (settingsState.status !== 'ready' || !settingsState.writable || toggleLock.current) return
    const next = settingsState.enabled !== true
    toggleLock.current = true
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await adapter.setEnabled(next)
      if (!result.ok) setSaveError(result.error)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
      toggleLock.current = false
      void controller.refresh()
    }
  }

  return (
    <section
      data-dsh-plugin="doctor"
      className={css.section}
      aria-label={t('settings.title')}
    >
      {embedded === false
        ? (
          <header className={css.header} data-dsh-part="header">
            <h2 className={css.title}>{t('settings.title')}</h2>
            <p className={css.subtitle}>{t('settings.subtitle')}</p>
          </header>
        )
        : null}

      {embedded === false
        ? (
          <div className={css.enableRow} data-dsh-part="enable">
        <div className={css.enableCopy}>
          <span className={css.enableLabel}>{t('enable.label')}</span>
          <span className={css.enableHint}>{enableHint(t, settingsState)}</span>
        </div>
        <button
          type="button"
          role="switch"
          data-testid="doctor-enable-switch"
          aria-checked={settingsState.enabled === true}
          aria-label={t('enable.label')}
          disabled={settingsState.status !== 'ready' || !settingsState.writable || saving}
          className={css.switchButton}
          onClick={() => { void toggleEnabled() }}
        >
          <span className={css.switchTrack} data-checked={settingsState.enabled === true ? 'on' : 'off'}>
            <span className={css.switchThumb} />
          </span>
          <span className={css.switchText}>
            {saving ? t('enable.saving') : settingsState.enabled === true ? t('enable.on') : t('enable.off')}
          </span>
        </button>
        {saveError !== undefined && <p className={css.errorLine} role="status">{t('enable.saveFailed', { reason: saveError })}</p>}
          </div>
        )
        : null}

      <DoctorErrorBoundary
        t={t}
        onReport={error => { controller.recordBoundary(error) }}
        onRecover={() => { void controller.refresh() }}
      >
        {() => (
          <div className={css.dynamic}>
            <StatusCard t={t} view={view} settings={settingsState} />
            <LifecycleCard
              t={t}
              view={view}
              onEnsure={() => { void controller.runProvision() }}
              onUninstall={() => { void controller.runUninstall() }}
            />
            <IncidentsCard t={t} view={view} />
            <ProbeCard t={t} view={view} controller={controller} />
            <ActionsCard
              t={t}
              view={view}
              onDiagnose={() => { void controller.runDiagnose() }}
              onRepair={() => { void controller.runRepair() }}
              onConfirm={() => { void controller.runConfirm() }}
              onReport={() => { void controller.reportProbe() }}
              onSendToHarness={openHarness}
              onRefresh={() => { void controller.refresh() }}
              onClear={() => { controller.clearProbe() }}
              hasFailures={hasFailures}
            />
          </div>
        )}
      </DoctorErrorBoundary>
      <HarnessSendDialog
        t={t}
        open={harnessOpen}
        initialText={harnessInitialText}
        target={harnessTarget}
        canSend={hasFailures && harnessTarget !== undefined}
        busy={harnessBusy}
        error={harnessError}
        onClose={() => { if (!harnessBusy) setHarnessOpen(false) }}
        onSend={(text) => { void sendHarness(text) }}
      />
    </section>
  )
}

/** Newest recorded failure for the send-to-Harness prompt (probe first, then supervisor incidents). */
function newestFailure(t: TranslateNS<'doctor'>, view: DoctorView): HarnessFailureInput | undefined {
  const probe = view.probe[view.probe.length - 1]
  if (probe !== undefined) {
    try {
      return {
        summary: probe.message,
        kind: t(probeKindKey(probe.kind)),
        stack: probe.detail,
        at: probe.at,
      }
    } catch {
      return { summary: probe.message, stack: probe.detail, at: probe.at }
    }
  }
  const incident = view.incidents[view.incidents.length - 1]
  if (incident === undefined) return undefined
  const evidence = (incident.evidence ?? []).filter((line: unknown): line is string => typeof line === 'string' && line.trim() !== '')
  return {
    summary: incident.summary,
    kind: kindLabel(t, incident.kind),
    stack: evidence.join('\n'),
    at: incident.updatedAt === undefined ? undefined : parseTime(incident.updatedAt),
  }
}

/** Enable-switch helper copy. */
function enableHint(t: TranslateNS<'doctor'>, state: DoctorSettingsState): string {
  if (state.status !== 'ready') return t('enable.unavailable')
  if (state.enabled === true) return t('enable.on')
  return t('enable.off')
}

/** Combined status card: host verdict, system phase, profiles. */
function StatusCard({ t, view, settings }: { t: TranslateNS<'doctor'>; view: DoctorView; settings: DoctorSettingsState }): ReactNode {
  const phase = view.snapshot?.phase
  const state = view.host === 'unavailable' ? 'down' : view.phase === 'loading' || view.host === 'unknown' ? 'unknown' : phaseState(phase)
  const stateText = view.host === 'unavailable' ? t('host.unavailable') : view.host === 'available' ? t('host.available') : t('status.unknown')
  return (
    <div className={css.card} data-dsh-part="status">
      <h3 className={css.cardTitle}>{t('status.title')}</h3>
      <div className={css.stateLine}>
        <span className={css.dot} data-state={state} />
        <span className={css.stateText}>{stateText}</span>
        <span className={css.verdict}>{phase === undefined ? t('status.unknown') : phaseLabel(t, 'phase.' + phase)}</span>
      </div>
      <p className={css.meta}>
        {view.lastCheckedAt === undefined
          ? t('status.neverChecked')
          : t('status.lastChecked', { time: formatTime(view.lastCheckedAt) })}
      </p>
      {settings.status === 'ready' && settings.enabled !== true && <p className={css.hint}>{t('host.disabledHint')}</p>}
      {view.lastError !== undefined && <p className={css.errorLine} role="status">{view.lastError}</p>}
      {view.host === 'unavailable' && <p className={css.hint}>{offlineHint(t, view.lastErrorCode)}</p>}
      {view.snapshot?.degradedReason !== undefined && <p className={css.hint}>{view.snapshot.degradedReason}</p>}
      {view.snapshot?.version !== undefined && (
        <p className={css.meta}>{view.hostVersion !== undefined
          ? t('lifecycle.version', { supervisor: view.snapshot.version, web: view.hostVersion })
          : t('snapshot.version', { version: view.snapshot.version })}</p>
      )}
      <ProfilesList t={t} view={view} />
    </div>
  )
}

/** Lifecycle card: one-click service install/repair/upgrade and uninstall. */
function LifecycleCard({ t, view, onEnsure, onUninstall }: { t: TranslateNS<'doctor'>; view: DoctorView; onEnsure: () => void; onUninstall: () => void }): ReactNode {
  const busy = view.actionRunning
  const offline = view.host === 'unavailable'
  const version = view.snapshot?.version
  const mismatch = !offline && version !== undefined && view.hostVersion !== undefined && version !== view.hostVersion
  const ensureLabel = offline && view.lastErrorCode === 'SUPERVISOR_UNPROVISIONED'
    ? t('lifecycle.install')
    : offline
      ? t('lifecycle.repair')
      : mismatch
        ? t('lifecycle.upgrade')
        : undefined
  return (
    <div className={css.card} data-dsh-part="lifecycle">
      <h3 className={css.cardTitle}>{t('lifecycle.title')}</h3>
      {offline && view.lastErrorCode === 'SUPERVISOR_UNPROVISIONED' && <p className={css.hint}>{t('lifecycle.neverInstalled')}</p>}
      {offline && view.lastErrorCode === 'SUPERVISOR_DOWN' && <p className={css.hint}>{t('lifecycle.serviceDown')}</p>}
      {mismatch && <p className={css.hint}>{t('lifecycle.versionMismatch', { supervisor: version ?? '', web: view.hostVersion ?? '' })}</p>}
      <div className={css.actionRow}>
        {ensureLabel !== undefined && (
          <button type="button" className={css.button} data-variant="primary" data-testid="doctor-ensure-button" disabled={busy} onClick={onEnsure}>
            {busy ? t('lifecycle.running') : ensureLabel}
          </button>
        )}
        {!offline && (
          <button type="button" className={css.button} data-testid="doctor-uninstall-button" disabled={busy} onClick={onUninstall}>
            {t('lifecycle.uninstall')}
          </button>
        )}
      </div>
      {!offline && <p className={css.meta}>{t('lifecycle.uninstallHint')}</p>}
    </div>
  )
}

/** Offline copy keyed by the host failure code. */
function offlineHint(t: TranslateNS<'doctor'>, code: string | undefined): string {
  if (code === 'SUPERVISOR_UNPROVISIONED') return t('api.unprovisioned')
  if (code === 'SUPERVISOR_DOWN') return t('api.supervisorDown')
  return t('host.unavailableHint')
}

/** Protected profile rows. */
function ProfilesList({ t, view }: { t: TranslateNS<'doctor'>; view: DoctorView }): ReactNode {
  if (view.profiles.length === 0 && view.host === 'available') return <p className={css.empty}>{t('profiles.empty')}</p>
  if (view.profiles.length === 0) return null
  return (
    <div className={css.profileBlock} data-dsh-part="profiles">
      <span className={css.blockLabel}>{t('profiles.title')}</span>
      <ul className={css.checkList}>
        {view.profiles.map((profile, index) => {
          const name = profile.identity?.name ?? profile.identity?.id ?? '#' + String(index)
          const phase = profile.phase
          return (
            <li key={profile.identity?.id ?? 'p' + String(index)} className={css.checkRow} data-phase={phase ?? 'unknown'}>
              <span className={css.dot} data-state={phaseState(phase)} />
              <span className={css.checkName}>{name}</span>
              <span className={css.incidentDetail}>{phase === undefined ? t('status.unknown') : phaseLabel(t, 'phase.' + phase)}</span>
              {profile.pid !== undefined && <span className={css.incidentDetail}>{t('profile.pid', { pid: profile.pid })}</span>}
              {profile.restartCount !== undefined && profile.restartCount > 0 && (
                <span className={css.incidentDetail}>{t('profile.restarts', { count: profile.restartCount })}</span>
              )}
              <span className={css.incidentDetail}>
                {profile.managed === true ? t('profile.managed') : profile.managed === false ? t('profile.unmanaged') : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Incident rows. */
function IncidentsCard({ t, view }: { t: TranslateNS<'doctor'>; view: DoctorView }): ReactNode {
  return (
    <div className={css.card} data-dsh-part="incidents">
      <h3 className={css.cardTitle}>{t('incidents.title')}</h3>
      {view.incidents.length === 0
        ? <p className={css.empty}>{t('incidents.empty')}</p>
        : (
          <ul className={css.incidentList}>
            {view.incidents.map((incident, index) => (
              <li key={incident.id + '-' + String(index)} className={css.incidentRow} data-severity={incidentSeverity(incident.phase)}>
                <span className={css.dot} data-state={incidentSeverity(incident.phase)} />
                <span className={css.incidentTitle}>{kindLabel(t, incident.kind)}</span>
                <span className={css.incidentDetail}>{incident.summary}</span>
                <span className={css.incidentDetail}>{phaseLabel(t, 'phase.' + incident.phase)}</span>
                {incident.updatedAt !== undefined && <span className={css.incidentDetail}>{formatTime(parseTime(incident.updatedAt))}</span>}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/** Browser probe card (passive incidents). */
function ProbeCard({ t, view, controller }: { t: TranslateNS<'doctor'>; view: DoctorView; controller: DoctorController }): ReactNode {
  const [copiedId, setCopiedId] = useState<string | undefined>(undefined)
  const copyFailure = (incident: PassiveIncident): void => {
    const stack = failureStackFor(incident, view)
    const text = t(probeKindKey(incident.kind)) + ': ' + incident.message + (stack !== '' ? '\n\n' + stack : '')
    void copyText(text).then(ok => {
      if (ok) setCopiedId(incident.id)
    })
  }
  const disablePlugin = (incident: PassiveIncident): void => {
    void controller.disablePlugin(pluginIdOf(incident.message))
  }
  return (
    <div className={css.card} data-dsh-part="probe">
      <h3 className={css.cardTitle}>{t('probe.title')}</h3>
      {view.probe.length === 0
        ? <p className={css.empty}>{t('probe.empty')}</p>
        : (
          <ul className={css.incidentList}>
            {view.probe.map((incident, index) => (
              <li key={incident.id + '-' + String(index)} className={css.incidentRow} data-kind={incident.kind}>
                <span className={css.dot} data-state={incident.kind === 'unhandled-rejection' ? 'warn' : 'fail'} />
                <span className={css.incidentTitle}>{t(probeKindKey(incident.kind))}</span>
                <span className={css.incidentDetail}>{probeIncidentText(t, incident)}</span>
                {incident.kind === 'plugin-startup-failure' && (
                  <span className={css.rowActions} data-dsh-part="plugin-row-actions">
                    <button
                      type="button"
                      className={css.miniButton}
                      data-testid={'doctor-copy-' + String(index)}
                      disabled={controller.getSnapshot().actionRunning}
                      onClick={() => { copyFailure(incident) }}
                    >
                      {copiedId === incident.id ? t('actions.copied') : t('actions.copyError')}
                    </button>
                    <button
                      type="button"
                      className={css.miniButton}
                      data-testid={'doctor-disable-' + String(index)}
                      disabled={controller.getSnapshot().actionRunning}
                      onClick={() => { disablePlugin(incident) }}
                    >
                      {t('actions.disable')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      {view.bootSignals.length > 0 && (
        <p className={css.meta}>
          {t('kind.connection-reset')} x {String(view.bootSignals.length)}
        </p>
      )}
    </div>
  )
}

/** The plugin id recorded in a startup-failure probe message. */
export function pluginIdOf(message: string): string {
  const prefix = 'plugin failed to start: '
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
}

/** Best available stack for one probe failure: probe detail, then the plugin-manager ring. */
function failureStackFor(incident: PassiveIncident, view: DoctorView): string {
  if (incident.kind !== 'plugin-startup-failure') return incident.detail ?? ''
  if (incident.detail !== undefined && incident.detail !== '') return incident.detail
  const id = pluginIdOf(incident.message)
  const recorded = view.pluginFailures.find(item => item.pluginId === id)
  return recorded?.stack ?? ''
}

/** Actions card. */
function ActionsCard({ t, view, onDiagnose, onRepair, onConfirm, onReport, onSendToHarness, onRefresh, onClear, hasFailures }: {
  t: TranslateNS<'doctor'>
  view: DoctorView
  onDiagnose: () => void
  onRepair: () => void
  onConfirm: () => void
  onReport: () => void
  onSendToHarness: () => void
  onRefresh: () => void
  onClear: () => void
  /** Whether a recorded failure exists to compose the prompt from. */
  hasFailures: boolean
}): ReactNode {
  const busy = view.actionRunning
  const offline = view.host === 'unavailable'
  const awaitingConfirm = view.incidents.some(incident => incident.phase === 'awaiting-confirmation' && incident.candidateId !== undefined)
  const repairId = view.incidents.some(incident => incident.repairable === true && incident.phase !== 'awaiting-confirmation' && incident.phase !== 'recovered' && incident.phase !== 'rolled-back' && incident.phase !== 'unresolved')
  return (
    <div className={css.card} data-dsh-part="actions">
      <h3 className={css.cardTitle}>{t('actions.title')}</h3>
      <div className={css.actionRow}>
        <button type="button" className={css.button} data-variant="primary" disabled={busy || offline} onClick={onDiagnose}>
          {busy ? t('actions.running') : t('actions.diagnose')}
        </button>
        <button type="button" className={css.button} disabled={busy || offline || !repairId} onClick={onRepair}>
          {t('actions.repair')}
        </button>
        <button type="button" className={css.button} data-variant="primary" disabled={busy || offline || !awaitingConfirm} onClick={onConfirm}>
          {t('actions.confirm')}
        </button>
        <button type="button" className={css.button} disabled={busy || offline || view.probe.length === 0} onClick={onReport}>
          {t('actions.report')}
        </button>
        <button type="button" className={css.button} data-variant="primary" disabled={busy || !hasFailures} onClick={onSendToHarness}>
          {t('actions.sendToHarness')}
        </button>
        <button type="button" className={css.button} disabled={busy || offline} onClick={onRefresh}>
          {t('actions.refresh')}
        </button>
        <button type="button" className={css.button} disabled={view.probe.length === 0} onClick={onClear}>
          {t('actions.clearProbe')}
        </button>
      </div>
      {view.action !== undefined && <ActionOutcome t={t} outcome={view.action} />}
    </div>
  )
}

/** Action result line. */
function ActionOutcome({ t, outcome }: { t: TranslateNS<'doctor'>; outcome: { ok: boolean; kind?: 'reported' | 'completed' | 'sent' | 'disabled'; id?: string; message?: string } }): ReactNode {
  if (outcome.ok) {
    const label = outcome.kind === 'reported'
      ? t('actions.reported')
      : outcome.kind === 'sent'
        ? t('actions.sent')
        : outcome.kind === 'disabled'
          ? t('actions.disabled', { id: outcome.id ?? '' })
          : t('actions.completed')
    return <p className={css.meta} role="status">{label}</p>
  }
  return <p className={css.errorLine} role="status">{outcome.message ?? t('api.supervisor', { reason: '' })}</p>
}

/**
 * Error boundary for the dynamic console area. Reports into the probe list and
 * renders a recoverable fallback; retry resets the boundary and refreshes.
 */
export class DoctorErrorBoundary extends Component<{
  t: TranslateNS<'doctor'>
  onReport: (error: unknown) => void
  onRecover: () => void
  /** Lazy children: re-evaluated on every boundary render so a retry gets
   * fresh inputs instead of the stale element tree that crashed. */
  children: () => ReactNode
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    try {
      this.props.onReport(error)
    } catch {
      // Reporting must never take the shell down.
    }
  }

  private reset = (): void => {
    try {
      this.setState({ failed: false })
      this.props.onRecover()
    } catch {
      // Reset must never throw.
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children()
    return (
      <div className={css.boundary} data-dsh-part="boundary" role="alert">
        <p className={css.boundaryText}>{this.props.t('boundary.fallback')}</p>
        <button type="button" className={css.button} onClick={this.reset}>
          {this.props.t('boundary.retry')}
        </button>
      </div>
    )
  }
}

/** Locale key of a passive kind. */
function probeKindKey(kind: PassiveIncident['kind']): DoctorKey {
  switch (kind) {
    case 'window-error': return 'kind.window-error'
    case 'unhandled-rejection': return 'kind.unhandled-rejection'
    case 'react-boundary': return 'kind.react-boundary'
    case 'connection-reset': return 'kind.connection-reset'
    case 'plugin-startup-failure': return 'kind.plugin-startup-failure'
  }
}

/** Incident kind label with raw fallback. */
function kindLabel(t: TranslateNS<'doctor'>, kind: string): string {
  const key = ('incident.kind.' + kind) as DoctorKey
  if (incidentKindKeys.includes(key)) return t(key)
  return kind
}

const incidentKindKeys: DoctorKey[] = [
  'incident.kind.boot-failure',
  'incident.kind.process-crash',
  'incident.kind.heartbeat-timeout',
  'incident.kind.http-failure',
  'incident.kind.client-failure',
  'incident.kind.dependency-failure',
  'incident.kind.configuration-failure',
]

/** Phase label with raw fallback. */
function phaseLabel(t: TranslateNS<'doctor'>, key: string): string {
  const candidate = key as DoctorKey
  if (phaseKeys.includes(candidate)) return t(candidate)
  return key.replace(/^phase\./, '')
}

const phaseKeys: DoctorKey[] = [
  'phase.disabled', 'phase.provisioning', 'phase.armed', 'phase.degraded', 'phase.updating',
  'phase.rolling-back', 'phase.uninstalling', 'phase.broken', 'phase.idle', 'phase.starting',
  'phase.healthy', 'phase.stopping', 'phase.exited', 'phase.suspected', 'phase.failed',
  'phase.quarantined',
]

/** Combined detail text of one passive incident. */
function probeIncidentText(t: TranslateNS<'doctor'>, incident: PassiveIncident): string {
  const parts: string[] = [incident.message]
  if (incident.line !== undefined && incident.column !== undefined) {
    parts.push(t('incident.detail', { summary: 'line ' + String(incident.line) + ', column ' + String(incident.column) }))
  } else if (incident.source !== undefined) {
    parts.push(t('incident.detail', { summary: 'source ' + incident.source }))
  }
  if (incident.detail !== undefined && incident.detail !== '') parts.push(incident.detail)
  return parts.join(' — ')
}

/** data-state of a phase. */
function phaseState(phase: string | undefined): 'ok' | 'warn' | 'fail' | 'unknown' {
  switch (phase) {
    case 'healthy': case 'armed': case 'recovered': return 'ok'
    case 'degraded': case 'starting': case 'suspected': case 'awaiting-confirmation': case 'repairing': return 'warn'
    case 'failed': case 'broken': case 'quarantined': case 'unresolved': return 'fail'
    default: return 'unknown'
  }
}

/** Incident severity derived from its phase. */
function incidentSeverity(phase: string): 'ok' | 'warn' | 'fail' {
  if (phase === 'recovered' || phase === 'rolled-back') return 'ok'
  if (phase === 'awaiting-confirmation' || phase === 'repairing' || phase === 'candidate-testing') return 'warn'
  return 'fail'
}

/** Parse an ISO timestamp; never throws. */
function parseTime(value: string): number {
  const at = Date.parse(value)
  return Number.isFinite(at) ? at : 0
}

/** Locale-neutral time rendering. */
function formatTime(at: number): string {
  if (at <= 0) return '-'
  try {
    return new Date(at).toLocaleTimeString()
  } catch {
    return String(at)
  }
}
