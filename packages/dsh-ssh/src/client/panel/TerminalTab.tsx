/**
 * Terminal tab: an xterm.js PTY view over the host's WebSocket terminal route.
 * A host <select> plus connect/disconnect controls; the terminal container is
 * sized by FitAddon (default 80x24 before first fit). On remote exit the last
 * output stays visible and input is disabled. xterm's stylesheet is injected
 * once per page load (module-level guard).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { SshApi, TerminalConnection } from '../api.ts'
import type { SshHostSummary } from '../../protocol.ts'
import { XTERM_CSS } from './xterm.css.ts'
import { errorMessage, resolveTerminalFontFamily, tt, type TerminalFontSource } from './helpers.ts'
import css from './panel.module.css'

/** Terminal tab props. */
export interface TerminalTabProps {
  api: SshApi
  /** Alias preselected by a "connect" action from the hosts tab. */
  presetAlias?: string
  /** Monotonic id of the connect request (re-applies presetAlias). */
  requestId?: number
  /**
   * Live terminal-font setting source (issue #577). Absent in tests and
   * legacy mounts: the font then comes from the CSS custom-property chain.
   */
  terminalFont?: TerminalFontSource
}

/** The terminal session lifecycle state shown in the status banner. */
type TerminalStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; alias: string }
  | { kind: 'exited'; alias: string; detail?: string }
  | { kind: 'error'; detail: string }

/** Injected-once guard for the xterm stylesheet (one tag per page load). */
let xtermCssInjected = false

function ensureXtermCss(): void {
  if (xtermCssInjected || typeof document === 'undefined') return
  xtermCssInjected = true
  if (document.querySelector('style[data-dsh-ssh-xterm]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshSshXterm = ''
  style.textContent = XTERM_CSS
  document.head.appendChild(style)
}

/** No-op source stand-in so the hook order stays stable without the prop. */
const NO_FONT_SOURCE: TerminalFontSource = {
  get: () => undefined,
  subscribe: () => () => undefined,
}

/** The xterm terminal view. */
export function TerminalTab({ api, presetAlias, requestId, terminalFont }: TerminalTabProps) {
  const [hosts, setHosts] = useState<SshHostSummary[]>([])
  const [alias, setAlias] = useState(presetAlias ?? '')
  const [status, setStatus] = useState<TerminalStatus>({ kind: 'idle' })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connRef = useRef<TerminalConnection | null>(null)
  const dataSubRef = useRef<IDisposable | null>(null)
  const fontSource = terminalFont ?? NO_FONT_SOURCE
  const fontOverride = useSyncExternalStore(fontSource.subscribe, fontSource.get)

  useEffect(() => { ensureXtermCss() }, [])

  // Live re-apply a terminal-font change (issue #577): xterm re-measures
  // and repaints on the options write; a refit keeps cols/rows aligned with
  // the new metrics and the remote PTY learns the new size.
  useEffect(() => {
    const term = termRef.current
    if (term === null) return
    const next = resolveTerminalFontFamily(fontOverride)
    if (term.options.fontFamily === next) return
    term.options.fontFamily = next
    fitRef.current?.fit()
    connRef.current?.resize(term.cols, term.rows)
  }, [fontOverride])

  // Fetch the host list on tab activation.
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const list = await api.listHosts()
        if (!disposed) setHosts(list)
      } catch (cause) {
        if (!disposed) setStatus({ kind: 'error', detail: errorMessage(cause) })
      }
    })()
    return () => { disposed = true }
  }, [api])

  // A hosts-tab connect action preselects its alias here.
  useEffect(() => {
    if (presetAlias !== undefined) setAlias(presetAlias)
  }, [presetAlias, requestId])

  const teardown = (): void => {
    const connection = connRef.current
    connRef.current = null
    if (connection !== null) {
      connection.onReady = undefined
      connection.onOutput = undefined
      connection.onExit = undefined
      connection.close()
    }
    // Release the xterm input subscription explicitly and dispose the
    // terminal so no listener (or the terminal Renderer) survives a
    // disconnect or the tab unmounting.
    dataSubRef.current?.dispose()
    dataSubRef.current = null
    termRef.current?.dispose()
    termRef.current = null
    fitRef.current = null
  }

  // Unmount cleanup (never touches state on an unmounting component).
  useEffect(() => () => { teardown() }, [])

  // Keep the terminal fitted to its container. A window resize is only one
  // trigger: the status banner appearing after connect, panel resizes, and
  // sidebar toggles all change the container without a window resize, so the
  // container itself is observed (otherwise the viewport keeps the pre-banner
  // height and the last line is clipped below the fold). ResizeObserver may
  // be absent (jsdom tests); the window listener then remains the only path.
  useEffect(() => {
    let lastCols = -1
    let lastRows = -1
    const sync = (): void => {
      const term = termRef.current
      const fit = fitRef.current
      if (term === null || fit === null) return
      fit.fit()
      const conn = connRef.current
      if (conn !== null && (term.cols !== lastCols || term.rows !== lastRows)) {
        lastCols = term.cols
        lastRows = term.rows
        conn.resize(term.cols, term.rows)
      }
    }
    window.addEventListener('resize', sync)
    const container = containerRef.current
    if (container === null || typeof ResizeObserver === 'undefined') {
      return () => { window.removeEventListener('resize', sync) }
    }
    const observer = new ResizeObserver(() => { sync() })
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  const connect = (): void => {
    const target = alias
    const container = containerRef.current
    if (target === '' || container === null) return
    if (status.kind === 'connecting' || status.kind === 'connected') return
    teardown()
    setStatus({ kind: 'connecting' })
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: resolveTerminalFontFamily(fontOverride),
      theme: { background: '#0b0e14', foreground: '#d8dee9', cursor: '#a3b8d0' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    const connection = api.openTerminal(target, term.cols, term.rows)
    termRef.current = term
    fitRef.current = fit
    connRef.current = connection
    let settled = false
    dataSubRef.current = term.onData(data => { connection.send(data) })
    connection.onReady = () => { setStatus({ kind: 'connected', alias: target }) }
    connection.onOutput = data => { term.write(data) }
    connection.onExit = (_code, error) => {
      if (settled) return
      settled = true
      dataSubRef.current?.dispose()
      dataSubRef.current = null
      term.options.disableStdin = true
      connRef.current = null
      // Keep the last output visible; input is now disabled.
      setStatus({ kind: 'exited', alias: target, detail: error })
    }
  }

  const disconnect = (): void => {
    teardown()
    setStatus({ kind: 'idle' })
  }

  const active = status.kind === 'connecting' || status.kind === 'connected'

  return (
    <div className={css.termBody}>
      <div className={css.controls}>
        <select className={css.input} value={alias} onChange={event => { setAlias(event.target.value) }}>
          <option value="">{tt('terminal.selectHost')}</option>
          {hosts.map(host => <option key={host.alias} value={host.alias}>{host.alias} ({host.host})</option>)}
        </select>
        <button type="button" className={css.primaryButton} disabled={alias === '' || active} onClick={connect}>{tt('terminal.connect')}</button>
        <button type="button" className={css.ghostButton} disabled={!active} onClick={disconnect}>{tt('terminal.disconnect')}</button>
      </div>
      {status.kind === 'connecting' && <div className={css.banner} data-kind="info">{tt('terminal.connecting')}</div>}
      {status.kind === 'connected' && <div className={css.banner} data-kind="ok">{tt('terminal.ready', { alias: status.alias })}</div>}
      {status.kind === 'exited' && (
        <div className={css.banner} data-kind="info">{tt('terminal.exited', { alias: status.alias })}{status.detail !== undefined ? ' (' + status.detail + ')' : ''}</div>
      )}
      {status.kind === 'error' && <div className={css.banner} data-kind="error">{tt('terminal.error', { error: status.detail })}</div>}
      <div className={css.termWrap}>
        <div ref={containerRef} className={css.termContainer} data-dsh-part="terminal" />
        {status.kind === 'idle' && (
          <div className={css.termPlaceholder}>{hosts.length === 0 ? tt('hosts.empty') : tt('terminal.placeholder')}</div>
        )}
      </div>
    </div>
  )
}
