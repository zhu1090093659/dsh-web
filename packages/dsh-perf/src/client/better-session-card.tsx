/**
 * The Better Session section, rendered inside the dsh-perf settings card
 * (better-session is session-performance governance, so its management
 * surface nests under the perf card instead of owning a sibling group item).
 * Declares the third-party origin, shows the live posture and store counts,
 * and drives enable (with automatic migration) / disable through the plugin's
 * loopback-fenced /api routes. Interactive on purpose — nothing here saves
 * into a settings namespace; the profile patch layer is the state that
 * actually moves rows.
 *
 * Styling is self-contained inline CSS (no module to keep in sync); semantic
 * attributes follow contracts/semantic-attrs-v1.md.
 * @module @linxin666/dsh-perf/client/better-session-card
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { BsmRawKey, BetterSessionKey } from './bs-locales.ts'

/** Upstream project the integration comes from. */
export const UPSTREAM_URL = 'https://github.com/morlay/better-session'
export const UPSTREAM_LABEL = 'morlay/better-session'

export type Posture = 'inactive-by-default' | 'enabled-via-profile' | 'enabled-via-bundle' | 'not-installed'

export interface BetterSessionStatus {
  mountState: Posture
  aggregateArtifactSeen: boolean
  legacyTotalSessions: number
  legacyProjects: Array<{ key: string; sessions: number; bytes: number }>
  storeExists: boolean
  storeSessions?: number
  storeEvents?: number
}

async function post(action: 'enable' | 'disable', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/dsh-perf/better-session/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error ?? `HTTP ${response.status}`))
  return payload
}

export interface CardViewModel {
  posture: Posture | undefined
  statusError: string | undefined
  busy: null | 'enable' | 'disable'
  notice: null | { kind: 'done' | 'disabled'; imported: number; failed: number } | { kind: 'failed'; error: string }
  confirmKind: null | 'enable' | 'disable'
  status: BetterSessionStatus | undefined
}

/** All section state and the actions mutating it; exported for tests and DI. */
export function useCardModel(): {
  model: CardViewModel
  refresh: () => void
  requestEnable: () => void
  confirmEnable: () => Promise<void>
  requestDisable: () => void
  confirmDisable: () => Promise<void>
  cancelConfirm: () => void
} {
  const [model, setModel] = useState<CardViewModel>({
    posture: undefined,
    statusError: undefined,
    busy: null,
    notice: null,
    confirmKind: null,
    status: undefined,
  })
  const patch = (part: Partial<CardViewModel>): void => setModel((current) => ({ ...current, ...part }))

  const refresh = (): void => {
    void (async () => {
      try {
        const response = await fetch('/api/dsh-perf/better-session/status', { cache: 'no-store' })
        const payload = await response.json() as BetterSessionStatus & Record<string, unknown>
        patch({ posture: payload.mountState, status: payload as BetterSessionStatus, statusError: undefined })
      } catch (error) {
        patch({ statusError: (error as Error).message })
      }
    })()
  }

  return {
    model,
    refresh,
    requestEnable: () => patch({ notice: null, confirmKind: 'enable' }),
    requestDisable: () => patch({ notice: null, confirmKind: 'disable' }),
    confirmEnable: async () => {
      patch({ confirmKind: null, busy: 'enable' })
      try {
        const outcome = await post('enable', { acknowledge: true })
        patch({
          busy: null,
          posture: 'enabled-via-profile',
          notice: { kind: 'done', imported: Number(outcome.imported ?? 0), failed: Number(outcome.failed ?? 0) },
        })
      } catch (error) {
        patch({ busy: null, notice: { kind: 'failed', error: (error as Error).message } })
      }
    },
    confirmDisable: async () => {
      patch({ confirmKind: null, busy: 'disable' })
      try {
        await post('disable', {})
        patch({ busy: null, posture: 'inactive-by-default', notice: { kind: 'disabled', imported: 0, failed: 0 } })
      } catch (error) {
        patch({ busy: null, notice: { kind: 'failed', error: (error as Error).message } })
      }
    },
    cancelConfirm: () => patch({ confirmKind: null }),
  }
}

export interface BetterSessionCardProps {
  /** Translate from the shared dsh-perf namespace; reads bsm.* keys. */
  t: (key: BetterSessionKey, params?: Record<string, string | number>) => string
  /** State override for unit tests; production wires the hook above. */
  wired?: ReturnType<typeof useCardModel>
}

type LocaleT = (key: BsmRawKey, params?: Record<string, string | number>) => string

function interpolate(template: string, params: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value))
  return out
}

/** Self-contained styles: theme-aware via system colors for the dialog surface. */
const css: Record<string, CSSProperties> = {
  section: { borderTop: '1px solid rgba(127,127,127,0.28)', marginTop: 18, paddingTop: 14 },
  title: { margin: '0 0 6px', fontSize: '0.95em', fontWeight: 600 },
  para: { margin: '4px 0', fontSize: '0.88em', opacity: 0.75, lineHeight: 1.55 },
  link: { color: 'inherit' },
  state: { margin: '10px 0 2px', fontSize: '0.88em', cursor: 'pointer', width: 'fit-content' },
  metrics: { margin: '4px 0 10px', paddingLeft: 18, fontSize: '0.85em', opacity: 0.75, lineHeight: 1.7 },
  notice: { margin: '6px 0', fontSize: '0.85em', opacity: 0.85 },
  error: { margin: '6px 0', fontSize: '0.85em', color: '#d4544c' },
  actions: { display: 'flex', gap: 8, margin: '10px 0 4px' },
  button: {
    padding: '5px 14px', borderRadius: 6, fontSize: '0.88em', cursor: 'pointer',
    border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit',
  },
  primary: { background: '#3b6ef6', borderColor: '#3b6ef6', color: '#fff' },
  danger: { color: '#d4544c', borderColor: 'rgba(212,84,76,0.55)' },
  progress: { margin: '6px 0', fontSize: '0.85em', opacity: 0.75 },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,0.42)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    background: 'Canvas', color: 'CanvasText', borderRadius: 10, padding: '16px 18px',
    maxWidth: 480, width: '92%', boxShadow: '0 8px 30px rgba(0,0,0,0.25)', fontSize: '0.92em',
  },
  dialogTitle: { margin: '0 0 8px', fontSize: '1em' },
  dialogBody: { margin: 0, lineHeight: 1.6 },
  dialogActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
}

/** The Better Session section rendered inside the dsh-perf card body. */
export function BetterSessionCard(props: BetterSessionCardProps): JSX.Element {
  const wired = props.wired ?? useCardModel()
  const { model } = wired
  const t: LocaleT = (key, params) => props.t(`bsm.${key}`, params)

  // One status fetch on mount (the perf card mounts this section when expanded);
  // manual refresh stays available via the state row click.
  useEffect(() => { wired.refresh() }, [])

  if (model.statusError !== undefined) {
    return (
      <section style={css.section} data-dsh-plugin="dsh-perf" data-dsh-part="better-session">
        <h3 style={css.title}>{t('settings.title')}</h3>
        <p style={css.error} role="alert">{t('notice.failed', { error: model.statusError })}</p>
      </section>
    )
  }

  const enabled = model.posture === 'enabled-via-profile' || model.posture === 'enabled-via-bundle'
  const stateKey: BsmRawKey = model.posture === 'enabled-via-profile' ? 'state.enabled'
    : model.posture === 'enabled-via-bundle' ? 'state.enabledBundle'
      : model.posture === undefined ? 'state.unknown' : 'state.inactive'

  return (
    <section style={css.section} data-dsh-plugin="dsh-perf" data-dsh-part="better-session">
      <h3 style={css.title}>{t('settings.title')}</h3>
      <p style={css.para}>{t('settings.description')}</p>
      <p style={css.para}>
        {t('settings.sourcePrefix')}{' '}
        <a href={UPSTREAM_URL} target="_blank" rel="noreferrer" style={css.link}>{UPSTREAM_LABEL}</a>
        {t('settings.sourceSuffix')}
      </p>
      <p
        style={css.state}
        data-dsh-part="state"
        onClick={() => wired.refresh()}
      >{t(stateKey)}</p>
      <ul style={css.metrics}>
        <li>{interpolate(t('label.legacyCount'), { total: model.status?.legacyTotalSessions ?? 0, projects: model.status?.legacyProjects?.length ?? 0 })}</li>
        {(model.status?.storeSessions !== undefined) && (
          <li>{interpolate(t('label.storeCount'), { sessions: model.status.storeSessions ?? 0, events: model.status.storeEvents ?? 0 })}</li>
        )}
      </ul>

      {model.notice !== null && model.notice.kind === 'done' && (
        <p style={css.notice} data-dsh-part="notice">
          {interpolate(t('notice.done'), { imported: model.notice.imported, failed: model.notice.failed })}
        </p>
      )}
      {model.notice !== null && model.notice.kind === 'disabled' && (
        <p style={css.notice} data-dsh-part="notice">{t('notice.disabled')}</p>
      )}
      {model.notice !== null && model.notice.kind === 'failed' && (
        <p style={css.error} role="alert">{t('notice.failed', { error: model.notice.error })}</p>
      )}

      <div style={css.actions}>
        {enabled ? (
          <button type="button" style={{ ...css.button, ...css.danger }} disabled={model.busy !== null}
            onClick={() => wired.requestDisable()}>{model.busy === 'disable' ? t('action.working') : t('action.disable')}</button>
        ) : (
          <button type="button" style={{ ...css.button, ...css.primary }} disabled={model.busy !== null}
            onClick={() => wired.requestEnable()}>{model.busy === 'enable' ? t('action.working') : t('action.enable')}</button>
        )}
      </div>

      {model.busy === 'enable' && <p style={css.progress} data-dsh-part="progress">{t('label.migrating')}</p>}

      {model.confirmKind !== null && (
        <div style={css.overlay} role="dialog" aria-modal="true" data-dsh-part="confirm">
          <div style={css.dialog}>
            <h4 style={css.dialogTitle}>{t(model.confirmKind === 'enable' ? 'warn.enableTitle' : 'warn.disableTitle')}</h4>
            <p style={css.dialogBody}>{t(model.confirmKind === 'enable' ? 'warn.enableBody' : 'warn.disableBody')}</p>
            <div style={css.dialogActions}>
              <button type="button" style={css.button} onClick={() => wired.cancelConfirm()}>{t('dialog.cancel')}</button>
              <button type="button"
                style={model.confirmKind === 'enable' ? { ...css.button, ...css.primary } : { ...css.button, ...css.danger }}
                onClick={() => { void (model.confirmKind === 'enable' ? wired.confirmEnable() : wired.confirmDisable()) }}>
                {t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
