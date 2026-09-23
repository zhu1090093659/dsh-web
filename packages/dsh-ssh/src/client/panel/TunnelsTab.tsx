/**
 * Tunnels tab: the live local port-forward list (auto-refresh every 5s while
 * visible) with per-row stop, a stop-all action scoped to the selected alias,
 * and a new-tunnel form.
 */
import { useEffect, useRef, useState } from 'react'
import type { SshApi } from '../api.ts'
import type { SshHostSummary, TunnelInfo } from '../../protocol.ts'
import { errorMessage, tt } from './helpers.ts'
import css from './panel.module.css'

/** Live-tunnel polling interval while the tab and page are visible (ms). */
export const TUNNEL_POLL_MS = 5000

/**
 * Return `next` only when the tunnel list changed in a user-visible way
 * (identity, ordering or any renderable field), else `null` so a poll tick
 * with no real change keeps the previous reference and React skips the
 * re-render. `prev === null` (first load) always accepts the list.
 */
export function diffTunnels(prev: TunnelInfo[] | null, next: TunnelInfo[]): TunnelInfo[] | null {
  if (prev === null) return next
  if (prev.length !== next.length) return next
  for (let index = 0; index < prev.length; index += 1) {
    const a = prev[index]
    const b = next[index]
    if (a.id !== b.id || a.alias !== b.alias || a.state !== b.state
      || a.localPort !== b.localPort || a.remoteHost !== b.remoteHost
      || a.remotePort !== b.remotePort || a.startedAt !== b.startedAt
      || a.error !== b.error) {
      return next
    }
  }
  return null
}

/** Tunnels tab props. */
export interface TunnelsTabProps {
  api: SshApi
  /** Pause automatic reads while the owning panel is closed, preserving form state. */
  active?: boolean
}

/** The tunnels tab. */
export function TunnelsTab({ api, active = true }: TunnelsTabProps) {
  const [hosts, setHosts] = useState<SshHostSummary[]>([])
  const [tunnels, setTunnels] = useState<TunnelInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const [remotePort, setRemotePort] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [localPort, setLocalPort] = useState('')
  const [busy, setBusy] = useState(false)

  // Hosts for the new-tunnel form (failure does not block tunnel listing).
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const list = await api.listHosts()
        if (!disposed) setHosts(list)
      } catch {
        // Tunnels may still exist; keep the list usable.
      }
    })()
    return () => { disposed = true }
  }, [api])

  // Live list with a TUNNEL_POLL_MS heartbeat while visible. Every load
  // carries a sequence number so stale responses never overwrite newer
  // state, and the list is diff-set so an unchanged poll tick keeps the
  // previous state reference (no wasted re-render).
  const seqRef = useRef(0)
  const automaticRead = useRef<{ running: boolean; resume?: () => void }>({ running: false })
  useEffect(() => {
    if (!active) return
    let disposed = false
    const read = automaticRead.current
    let timer: ReturnType<typeof setInterval> | undefined
    const load = async (): Promise<void> => {
      if (disposed || read.running || document.visibilityState === 'hidden') return
      read.running = true
      const seq = ++seqRef.current
      try {
        const list = await api.listTunnels()
        if (disposed || seq !== seqRef.current) return
        setTunnels(prev => diffTunnels(prev, list) ?? prev)
        setError(null)
      } catch (cause) {
        if (disposed || seq !== seqRef.current) return
        setError(errorMessage(cause))
      } finally {
        read.running = false
        const resume = read.resume
        read.resume = undefined
        resume?.()
      }
    }
    const resume = (): void => {
      if (disposed || document.visibilityState === 'hidden') return
      // Rapid close/reopen must not start more reads while the old effect's
      // request is pending. Keep only the latest visible refresh.
      if (read.running) read.resume = resume
      else void load()
    }
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        stop()
        if (read.resume === resume) read.resume = undefined
      } else if (timer === undefined) {
        resume()
        timer = setInterval(() => { void load() }, TUNNEL_POLL_MS)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => {
      disposed = true
      seqRef.current += 1
      if (read.resume === resume) read.resume = undefined
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [api, active])

  const refresh = async (): Promise<void> => {
    const seq = ++seqRef.current
    try {
      const list = await api.listTunnels()
      if (seq !== seqRef.current) return
      setTunnels(list)
      setError(null)
    } catch (cause) {
      if (seq !== seqRef.current) return
      setError(errorMessage(cause))
    }
  }

  const stopTunnel = async (tunnelId: string): Promise<void> => {
    try {
      await api.stopTunnel(tunnelId)
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const stopAll = async (): Promise<void> => {
    if (!window.confirm(tt('tunnel.stopAllConfirm'))) return
    setBusy(true)
    try {
      await api.stopAllTunnels(alias === '' ? undefined : alias)
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    if (alias === '' || remotePort.trim() === '') return
    const remotePortNumber = Number(remotePort)
    const localPortNumber = localPort.trim() === '' ? undefined : Number(localPort)
    if (!Number.isInteger(remotePortNumber) || remotePortNumber < 1 || remotePortNumber > 65535) {
      setError(tt('form.portInvalid'))
      return
    }
    if (localPortNumber !== undefined && (!Number.isInteger(localPortNumber) || localPortNumber < 1 || localPortNumber > 65535)) {
      setError(tt('form.portInvalid'))
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const tunnel = await api.startTunnel({
        alias,
        remotePort: remotePortNumber,
        remoteHost: remoteHost.trim() === '' ? undefined : remoteHost.trim(),
        localPort: localPortNumber,
      })
      setNotice(tt('tunnel.started', { localPort: tunnel.localPort }))
      setRemotePort('')
      setRemoteHost('')
      setLocalPort('')
      await refresh()
    } catch (cause) {
      setError(tt('tunnel.failed', { error: errorMessage(cause) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <div className={css.controls}>
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void stopAll() }}>{tt('tunnel.stopAll')}</button>
        <button type="button" className={css.ghostButton} onClick={() => { void refresh() }}>{tt('common.refresh')}</button>
      </div>
      {error !== null && <div className={css.banner} data-kind="error">{error}</div>}
      {notice !== null && <div className={css.banner} data-kind="ok">{notice}</div>}
      {tunnels !== null && tunnels.length === 0 && <div className={css.empty}>{tt('tunnel.empty')}</div>}
      <div className={css.tunnelList}>
        {(tunnels ?? []).map(tunnel => (
          <div key={tunnel.id} className={css.tunnelRow} data-state={tunnel.state}>
            <span className={css.tunnelLabel}>{tt('tunnel.row', { alias: tunnel.alias, localPort: tunnel.localPort, remoteHost: tunnel.remoteHost, remotePort: tunnel.remotePort })}</span>
            <button type="button" className={css.ghostButton} onClick={() => { void stopTunnel(tunnel.id) }}>{tt('tunnel.stop')}</button>
          </div>
        ))}
      </div>
      <div className={css.formCard}>
        <div className={css.formRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('tunnel.alias')}</span>
            <select className={css.input} value={alias} onChange={event => { setAlias(event.target.value) }}>
              <option value="">{tt('terminal.selectHost')}</option>
              {hosts.map(host => <option key={host.alias} value={host.alias}>{host.alias}</option>)}
            </select>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('tunnel.remotePort')}</span>
            <input className={css.input} type="number" min={1} max={65535} value={remotePort} onChange={event => { setRemotePort(event.target.value) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('tunnel.remoteHost')}</span>
            <input className={css.input} value={remoteHost} placeholder={tt('tunnel.remoteHostHint')} onChange={event => { setRemoteHost(event.target.value) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('tunnel.localPort')}</span>
            <input className={css.input} type="number" min={1} max={65535} value={localPort} placeholder={tt('tunnel.localPortHint')} onChange={event => { setLocalPort(event.target.value) }} />
          </label>
        </div>
        <div>
          <button type="button" className={css.primaryButton} disabled={busy || alias === '' || remotePort.trim() === ''} onClick={() => { void start() }}>{tt('tunnel.start')}</button>
        </div>
      </div>
    </div>
  )
}
