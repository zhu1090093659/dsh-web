import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import type { FieldProps } from './PluginSettingsCard.tsx'
import css from './desktop-runtime.module.css'

type RuntimeMirror = 'official' | 'npmmirror' | 'custom'
type RuntimePhase = 'not-installed' | 'downloading' | 'installing' | 'ready' | 'failed' | 'unsupported'

interface RuntimeView {
  version: string
  platform: string
  arch: string
  phase: RuntimePhase
  installed: boolean
  managed: boolean
  source: RuntimeMirror
  customMirror?: string
  progress?: { transferred: number, total: number | null, percent: number }
  error?: string
}

interface DesktopRuntimeFieldProps extends FieldProps {
  t: PropsLocale<'pet'>['t']
  /** Persist the enable flag after the explicitly approved runtime is ready. */
  enableDesktop: () => Promise<boolean>
}

const ACTIVE_PHASES = new Set<RuntimePhase>(['downloading', 'installing'])

async function runtimeRequest(path = '', body?: unknown): Promise<RuntimeView> {
  const response = await fetch(`/api/pet/runtime${path}`, body === undefined
    ? undefined
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
  const value = await response.json() as RuntimeView | { error?: string }
  if (!response.ok) {
    throw new Error('error' in value && typeof value.error === 'string'
      ? value.error
      : 'runtime-request-failed')
  }
  return value as RuntimeView
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function runtimeErrorCopy(t: DesktopRuntimeFieldProps['t'], code: string | undefined): string {
  const key = code === 'runtime-install-busy'
    ? 'settings.runtimeErrorBusy'
    : code === 'runtime-checksum-failed'
      ? 'settings.runtimeErrorChecksum'
      : code === 'runtime-mirror-insecure'
        ? 'settings.runtimeErrorInsecureMirror'
        : code === 'runtime-mirror-invalid' || code === 'runtime-mirror-required'
          ? 'settings.runtimeErrorMirror'
          : code === 'runtime-install-failed'
            ? 'settings.runtimeErrorInstall'
            : code === undefined ? '' : 'settings.runtimeErrorDownload'
  return key === '' ? '' : t(key)
}

function validCustomMirror(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

/** Desktop switch plus first-use, checksum-verified Electron installation. */
export function DesktopRuntimeField(props: DesktopRuntimeFieldProps) {
  const checked = props.text === 'true'
  const [runtime, setRuntime] = useState<RuntimeView | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [source, setSource] = useState<RuntimeMirror>('official')
  const [customMirror, setCustomMirror] = useState('')
  const [requestError, setRequestError] = useState<string>()
  const activateWhenReady = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const accept = (next: RuntimeView): RuntimeView => {
    setRuntime(next)
    setSource(next.source)
    setCustomMirror(next.customMirror ?? '')
    return next
  }

  const refresh = async (): Promise<RuntimeView | undefined> => {
    try {
      setRequestError(undefined)
      return accept(await runtimeRequest())
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'runtime-request-failed')
      return undefined
    }
  }

  useEffect(() => {
    let active = true
    void runtimeRequest().then((next) => {
      if (!active) return
      setRequestError(undefined)
      accept(next)
      if (ACTIVE_PHASES.has(next.phase)) {
        // The Host owns installation. A page refresh reconnects to that one
        // operation instead of offering a second download.
        activateWhenReady.current = true
        setDialogOpen(true)
      }
    }, (error: unknown) => {
      if (!active) return
      setRequestError(error instanceof Error ? error.message : 'runtime-request-failed')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!dialogOpen || runtime === null || !ACTIVE_PHASES.has(runtime.phase)) return
    let active = true
    let timer: number | undefined
    const poll = (delay = 400): void => {
      timer = window.setTimeout(() => {
        void runtimeRequest().then((next) => {
          if (!active) return
          setRequestError(undefined)
          setRuntime(next)
          if (ACTIVE_PHASES.has(next.phase)) poll()
        }, (error: unknown) => {
          if (!active) return
          setRequestError(error instanceof Error ? error.message : 'runtime-request-failed')
          // Installation belongs to the Host and may still be progressing.
          // Keep reconnecting after a transient browser/network failure.
          poll(1_600)
        })
      }, delay)
    }
    poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [dialogOpen, runtime?.phase])

  useEffect(() => {
    if (!dialogOpen || runtime?.phase !== 'ready' || !activateWhenReady.current) return
    activateWhenReady.current = false
    void props.enableDesktop().then((enabled) => {
      if (enabled) setDialogOpen(false)
      else setRequestError('runtime-enable-failed')
    })
  }, [dialogOpen, runtime?.phase, props.enableDesktop])

  const openInstaller = async (): Promise<void> => {
    const latest = await refresh()
    if (latest?.phase === 'ready') {
      props.onEdit('true')
      return
    }
    setDialogOpen(true)
  }

  const toggle = (): void => {
    if (checked) {
      props.onEdit('false')
      return
    }
    if (runtime?.phase === 'ready') props.onEdit('true')
    else void openInstaller()
  }

  const install = async (): Promise<void> => {
    setRequestError(undefined)
    if (source === 'custom' && !validCustomMirror(customMirror)) {
      setRequestError('runtime-mirror-invalid')
      return
    }
    activateWhenReady.current = true
    try {
      setRuntime(await runtimeRequest('/install', {
        source,
        ...(source === 'custom' ? { customMirror } : {}),
      }))
    } catch (error) {
      activateWhenReady.current = false
      setRequestError(error instanceof Error ? error.message : 'runtime-request-failed')
    }
  }

  const cancel = async (): Promise<void> => {
    activateWhenReady.current = false
    if (runtime !== null && ACTIVE_PHASES.has(runtime.phase)) {
      try {
        setRuntime(await runtimeRequest('/cancel', {}))
      } catch (error) {
        setRequestError(error instanceof Error ? error.message : 'runtime-request-failed')
        return
      }
    }
    setDialogOpen(false)
  }
  cancelRef.current = cancel

  const busy = runtime !== null && ACTIVE_PHASES.has(runtime.phase)
  const installing = runtime?.phase === 'installing'
  const percent = Math.max(0, Math.min(1, runtime?.progress?.percent ?? 0))
  const error = requestError ?? runtime?.error
  const status = runtime === null
    ? requestError === undefined
      ? props.t('settings.runtimeChecking')
      : runtimeErrorCopy(props.t, requestError)
    : runtime.phase === 'ready'
      ? props.t('settings.runtimeReady', { version: runtime.version })
      : runtime.phase === 'unsupported'
        ? props.t('settings.runtimeUnsupported')
        : props.t('settings.runtimeMissing')

  useEffect(() => {
    if (!dialogOpen) return
    const dialog = dialogRef.current
    if (dialog === null) return
    const activeElement = document.activeElement
    previousFocus.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : triggerRef.current
    const focusable = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]',
    )).filter(element => element.tabIndex >= 0)
    const initial = focusable()[0]
    ;(initial ?? dialog).focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        void cancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const candidates = focusable()
      if (candidates.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const active = document.activeElement
      const index = candidates.indexOf(active as HTMLElement)
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        candidates[candidates.length - 1]!.focus()
      } else if (!event.shiftKey && (index < 0 || index === candidates.length - 1)) {
        event.preventDefault()
        candidates[0]!.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      const restore = previousFocus.current ?? triggerRef.current
      previousFocus.current = null
      const restoreFocus = (): void => {
        if (restore?.isConnected === true) restore.focus()
      }
      // The surrounding settings modal may finish its own focus bookkeeping
      // after this passive-effect cleanup. Restore on the next frame so that
      // nested dialog teardown cannot leave focus on document.body.
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(restoreFocus)
      } else {
        window.setTimeout(restoreFocus, 0)
      }
    }
  }, [dialogOpen])

  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.copy}>
          <label className={css.label} htmlFor={props.id}>{props.label}</label>
          <span className={css.hint}>{props.hint}</span>
          <span className={css.runtimeStatus} role="status" aria-live="polite">{status}</span>
        </span>
        <span className={css.actions}>
          {props.overridden
            ? (
              <button type="button" className={css.reset} disabled={props.disabled || busy} onClick={props.onReset}>
                {props.resetLabel}
              </button>
            )
            : null}
          <button
            ref={triggerRef}
            id={props.id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={props.label}
            className={checked ? css.switchOn : css.switch}
            disabled={props.disabled || busy || runtime?.phase === 'unsupported'}
            onClick={toggle}
          >
            <span className={css.thumb} />
          </button>
        </span>
      </div>

      {checked && runtime !== null && runtime.phase !== 'ready' && runtime.phase !== 'unsupported'
        ? (
          <button type="button" className={css.installMissing} onClick={() => { void openInstaller() }}>
            {props.t('settings.runtimeInstallAction')}
          </button>
        )
        : null}

      {dialogOpen
        ? (
          <div className={css.backdrop} data-dsh-plugin="pet">
            <section
              ref={dialogRef}
              className={css.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pet-runtime-title"
              aria-describedby="pet-runtime-description"
              tabIndex={-1}
            >
              <header className={css.dialogHeader}>
                <h3 id="pet-runtime-title">{props.t('settings.runtimeDialogTitle')}</h3>
                <p id="pet-runtime-description">{props.t('settings.runtimeDialogDescription', { version: runtime?.version ?? '' })}</p>
              </header>

              <label className={css.sourceLabel} htmlFor="settings-pet-runtime-source">
                {props.t('settings.runtimeSource')}
              </label>
              <select
                id="settings-pet-runtime-source"
                className={css.sourceSelect}
                value={source}
                disabled={busy}
                onChange={(event) => { setSource(event.target.value as RuntimeMirror) }}
              >
                <option value="official">{props.t('settings.runtimeSourceOfficial')}</option>
                <option value="npmmirror">{props.t('settings.runtimeSourceNpmmirror')}</option>
                <option value="custom">{props.t('settings.runtimeSourceCustom')}</option>
              </select>
              {source === 'custom'
                ? (
                  <input
                    className={css.sourceInput}
                    type="url"
                    aria-label={props.t('settings.runtimeCustomMirror')}
                    placeholder="https://example.com/electron/"
                    value={customMirror}
                    disabled={busy}
                    onChange={(event) => { setCustomMirror(event.target.value) }}
                  />
                )
                : null}

              {busy
                ? (
                  <div className={css.progressBlock}>
                    <div className={css.progressText}>
                      <span>{props.t(installing ? 'settings.runtimeInstalling' : 'settings.runtimeDownloading')}</span>
                      {installing ? null : <span>{Math.round(percent * 100)}%</span>}
                    </div>
                    {installing
                      ? <progress className={css.progress} max={1} />
                      : <progress className={css.progress} max={1} value={percent} />}
                    {installing
                      ? <span className={css.bytes}>{props.t('settings.runtimeInstallingHint')}</span>
                      : (
                        <span className={css.bytes}>
                          {runtime?.progress?.total === null || runtime?.progress?.total === undefined
                            ? formatBytes(runtime?.progress?.transferred ?? 0)
                            : `${formatBytes(runtime.progress.transferred)} / ${formatBytes(runtime.progress.total)}`}
                        </span>
                        )}
                  </div>
                )
                : null}

              {error !== undefined
                ? (
                  <p className={css.error} role="alert">
                    {error === 'runtime-enable-failed'
                      ? props.t('settings.runtimeErrorEnable')
                      : runtimeErrorCopy(props.t, error)}
                  </p>
                  )
                : null}

              <p className={css.security}>{props.t('settings.runtimeSecurity')}</p>
              <footer className={css.dialogActions}>
                <button type="button" className={css.cancel} onClick={() => { void cancel() }}>
                  {props.t(busy ? 'settings.runtimeCancelDownload' : 'settings.runtimeCancel')}
                </button>
                <button type="button" className={css.install} disabled={busy} onClick={() => { void install() }}>
                  {props.t(runtime?.phase === 'failed' ? 'settings.runtimeRetry' : 'settings.runtimeDownloadAction')}
                </button>
              </footer>
            </section>
          </div>
        )
        : null}
    </div>
  )
}
