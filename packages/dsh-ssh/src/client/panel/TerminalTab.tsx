/**
 * Terminal tab: ONE xterm.js view over the host's WebSocket terminal route,
 * with a tab strip over host-side PTY sessions.
 *
 * Session ownership stays on the Host (\`src/engine/terminal-sessions.ts\`): a
 * view that is not showing a session detaches its socket, and the host keeps
 * the shell alive plus a bounded scrollback that a reattach replays. That is
 * what lets the panel hold several tabs while this component keeps a single
 * xterm instance: switching a tab rebinds the one terminal instead of stacking
 * terminals, and every tab's alias, host session id, status and pending
 * keyboard-interactive challenge lives in the panel controller because the
 * layout unmounts this page whenever another panel is selected.
 *
 * A tab that has NOT reported its session id yet cannot be detached (there is
 * no id to reattach with), so switching away or unmounting hands the socket to
 * the controller, which applies "detach" or "close" the moment the id arrives.
 * That is the orphan-free rule: no host PTY is ever left without an owner.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { SshApi, TerminalConnection } from '../api.ts'
import type { SshHostSummary } from '../../protocol.ts'
import type { PanelController, TerminalTabRecord } from './controller.ts'
import { XTERM_CSS } from './xterm.css.ts'
import { errorMessage, resolveTerminalFontFamily, tt, type TerminalFontSource } from './helpers.ts'
import css from './panel.module.css'

/** Terminal tab props. */
export interface TerminalTabProps {
  api: SshApi
  /** The panel controller that owns the tabs and their host session ids. */
  controller: PanelController
  /** Alias preselected by a "connect" action from the hosts tab. */
  presetAlias?: string
  /**
   * Live terminal-font setting source (issue #577). Absent in tests and
   * legacy mounts: the font then comes from the CSS custom-property chain.
   */
  terminalFont?: TerminalFontSource
}

/** The socket currently bound to the single terminal view. */
interface BoundLink {
  tabId: string
  connection: TerminalConnection
}

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

/**
 * The state word a tab shows in the strip, or undefined when it is simply up.
 * A pending challenge wins over the lifecycle word: it is the one state the
 * user has to act on.
 * @param tab - the tab record.
 * @returns the short label, or undefined for a connected tab.
 */
function tabStateLabel(tab: TerminalTabRecord): string | undefined {
  if (tab.authPrompt !== undefined) return tt('terminal.authPending')
  if (tab.status === 'connecting') return tt('terminal.connecting')
  if (tab.status === 'exited') return tt('terminal.tabExited')
  // A close that never reached the host keeps a live session, so it is not an
  // `error` tab; it still has to be visible without making that tab current.
  if (tab.closeError !== undefined) return tt('terminal.tabError')
  if (tab.status === 'error') return tt('terminal.tabError')
  return undefined
}

/**
 * Whether the visible challenge form may answer on the bound socket: the form
 * and the socket must belong to the same tab. Both are read at submit time, and
 * the window between a tab switch's commit and the effect that rebinds the
 * socket is exactly when they can disagree.
 * @param linkTabId - the tab the bound socket belongs to.
 * @param formTabId - the tab whose challenge form is on screen.
 */
export function challengeBelongsToLink(linkTabId: string | undefined, formTabId: string | undefined): boolean {
  return linkTabId !== undefined && linkTabId === formTabId
}

/** The terminal view with its tab strip. */
export function TerminalTab({ api, controller, presetAlias, terminalFont }: TerminalTabProps) {
  const { terminalTabs, activeTerminalTabId, draftAlias } = useSyncExternalStore(
    useCallback(listener => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getSnapshot(), [controller]),
  )
  const [hosts, setHosts] = useState<SshHostSummary[]>([])
  const [listError, setListError] = useState<string | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const linkRef = useRef<BoundLink | null>(null)
  const dataSubRef = useRef<IDisposable | null>(null)
  /** Tab whose screen the terminal currently holds. */
  const renderedRef = useRef<string | undefined>(undefined)
  /** Last geometry pushed to the active socket to skip duplicate resizes. */
  const lastSentSizeRef = useRef<{ connection: TerminalConnection; cols: number; rows: number } | null>(null)
  /** Tabs with a background close in flight, so one click cannot open two. */
  const closingRef = useRef<Set<string>>(new Set())
  const fontSource = terminalFont ?? NO_FONT_SOURCE
  const fontOverride = useSyncExternalStore(fontSource.subscribe, fontSource.get)
  const activeTab = terminalTabs.find(tab => tab.id === activeTerminalTabId)

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
    const link = linkRef.current
    if (link !== null) {
      link.connection.resize(term.cols, term.rows)
      lastSentSizeRef.current = { connection: link.connection, cols: term.cols, rows: term.rows }
    }
  }, [fontOverride])

  // Fetch the host list on tab activation.
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const list = await api.listHosts()
        if (!disposed) setHosts(list)
      } catch (cause) {
        if (!disposed) setListError(errorMessage(cause))
      }
    })()
    return () => { disposed = true }
  }, [api])

  // A hosts-tab connect action preselects its alias in the toolbar.
  useEffect(() => {
    if (presetAlias === undefined || presetAlias === '') return
    controller.setDraftAlias(presetAlias)
  }, [presetAlias, controller])

  // Keep the terminal fitted to its container. A window resize is only one
  // trigger: the status banner appearing after connect, panel resizes, and
  // sidebar toggles all change the container without a window resize, so the
  // container itself is observed (otherwise the viewport keeps the pre-banner
  // height and the last line is clipped below the fold). ResizeObserver may
  // be absent (jsdom tests); the window listener then remains the only path.
  useEffect(() => {
    const sync = (): void => {
      const term = termRef.current
      const fit = fitRef.current
      if (term === null || fit === null) return
      fit.fit()
      const link = linkRef.current
      if (link === null) return
      const last = lastSentSizeRef.current
      if (last === null || last.connection !== link.connection || term.cols !== last.cols || term.rows !== last.rows) {
        lastSentSizeRef.current = { connection: link.connection, cols: term.cols, rows: term.rows }
        link.connection.resize(term.cols, term.rows)
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

  /** Build the one xterm instance and its input subscription, once. */
  const ensureTerm = (): { term: Terminal; fit: FitAddon } | undefined => {
    const openTerm = termRef.current
    const openFit = fitRef.current
    if (openTerm !== null && openFit !== null) return { term: openTerm, fit: openFit }
    const container = containerRef.current
    if (container === null) return undefined
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
    termRef.current = term
    fitRef.current = fit
    // One input subscription for the terminal, routed to whichever tab is
    // bound: rebinding a tab must not stack listeners on the xterm.
    dataSubRef.current = term.onData(data => { linkRef.current?.connection.send(data) })
    return { term, fit }
  }

  /** Dispose the xterm and its subscription (no tabs left, or unmount). */
  const disposeTerm = (): void => {
    dataSubRef.current?.dispose()
    dataSubRef.current = null
    termRef.current?.dispose()
    termRef.current = null
    fitRef.current = null
    renderedRef.current = undefined
  }

  /** Release the bound socket: detach it, or adopt it while it connects. */
  const releaseLink = (): void => {
    const link = linkRef.current
    linkRef.current = null
    if (link === null) return
    const connection = link.connection
    connection.onReady = undefined
    connection.onOutput = undefined
    connection.onExit = undefined
    connection.onAuthPrompt = undefined
    const tab = controller.terminalTab(link.tabId)
    if (tab === undefined) {
      // The tab was closed while this socket was already releasing: nothing can
      // reattach to it, so the session has to end rather than be detached into
      // an ownerless PTY.
      controller.adoptTerminalLink(link.tabId, connection, 'close')
      return
    }
    if (tab.status === 'connecting') {
      // No session id yet, so a detach frame would end nothing: the host would
      // keep connecting into a session nobody can attach to. Hand it to the
      // controller, which detaches (or closes) the moment the id arrives.
      controller.adoptTerminalLink(link.tabId, connection, 'detach')
      return
    }
    connection.detach()
  }

  /**
   * Whether the single terminal still shows another tab. A terminal that was
   * just created (or disposed) holds nothing, so it needs no clear; every other
   * rebind must start from a blank screen or the previous tab's output and
   * cursor stay on it.
   * @param tabId - the tab about to be bound.
   */
  const needsScreenClear = (tabId: string): boolean => {
    const rendered = renderedRef.current
    return rendered !== undefined && rendered !== tabId
  }

  /**
   * Draw a retained screen the host cannot replay (adopted output, or a tab
   * whose session is gone) and mark the terminal as this tab's.
   * @param term - the single terminal.
   * @param tabId - the tab that owns the text.
   * @param retained - the text to draw; empty leaves a blank screen.
   */
  const drawRetained = (term: Terminal, tabId: string, retained: string): void => {
    if (needsScreenClear(tabId)) term.reset()
    if (retained !== '') term.write(retained)
    renderedRef.current = tabId
  }

  /** Bind one connection's frames onto the single terminal. */
  const bindConnection = (tab: TerminalTabRecord, connection: TerminalConnection): void => {
    const view = ensureTerm()
    if (view === undefined) return
    linkRef.current = { tabId: tab.id, connection }
    renderedRef.current = tab.id
    view.term.options.disableStdin = false
    connection.onReady = (sessionId) => {
      controller.clearTerminalAuthPrompt(tab.id)
      controller.readyTerminalTab(tab.id, sessionId)
    }
    connection.onOutput = (data) => {
      view.term.write(data)
      controller.appendTerminalOutput(tab.id, data)
    }
    connection.onAuthPrompt = (name, instructions, prompts) => {
      // The challenge and the answer being typed live on the tab record: a
      // prompt for another tab must not touch the field on screen, and two
      // challenges must never share one draft.
      controller.setTerminalAuthPrompt(tab.id, { name, instructions, prompts })
    }
    connection.onExit = (_code, error) => {
      const bound = linkRef.current
      const wasBound = bound !== null && bound.connection === connection
      if (wasBound) linkRef.current = null
      connection.onReady = undefined
      connection.onOutput = undefined
      connection.onAuthPrompt = undefined
      connection.onExit = undefined
      view.term.options.disableStdin = true
      if (!wasBound) return
      // The tab keeps its screen and its place; only the dead id is dropped.
      controller.exitTerminalTab(tab.id, error)
    }
  }

  /** Bind the tab the controller says is current, without opening a second PTY. */
  const bindTab = (tab: TerminalTabRecord): void => {
    const view = ensureTerm()
    if (view === undefined) return
    if (tab.status === 'connecting' || (tab.status === 'connected' && tab.sessionId !== undefined)) {
      const adopted = controller.reclaimTerminalLink(tab.id)
      if (adopted !== undefined) {
        // The socket kept reporting while the tab was in the background, so its
        // retained screen holds that window; draw it before the live frames
        // resume rather than showing a gap.
        drawRetained(view.term, tab.id, controller.readTerminalOutput(tab.id))
        bindConnection(tab, adopted)
        return
      }
    }
    if (tab.status === 'connecting') {
      // A tab that opens a socket starts from a blank screen: without this the
      // previous tab's output stays on the one terminal until the host speaks.
      drawRetained(view.term, tab.id, '')
      controller.clearTerminalOutput(tab.id)
      bindConnection(tab, api.openTerminal(tab.alias, view.term.cols, view.term.rows))
      return
    }
    if (tab.status === 'connected' && tab.sessionId !== undefined) {
      const sessionId = tab.sessionId
      // Always clear retained output before attaching: the host replays its
      // full scrollback on attach, including after a panel remount where the
      // local xterm starts fresh (renderedRef.current === undefined).
      controller.clearTerminalOutput(tab.id)
      if (needsScreenClear(tab.id)) {
        view.term.reset()
        renderedRef.current = tab.id
      }
      bindConnection(tab, api.attachTerminal(sessionId, view.term.cols, view.term.rows))
      return
    }
    // exited / error: no live session to attach to. The tab keeps the screen it
    // last showed instead of an empty terminal under a placeholder.
    view.term.options.disableStdin = true
    if (renderedRef.current === tab.id) return
    drawRetained(view.term, tab.id, controller.readTerminalOutput(tab.id))
  }

  // Bind the shown tab, releasing whatever the previous one held.
  useEffect(() => {
    const bound = linkRef.current
    if (bound !== null && bound.tabId === activeTerminalTabId) return
    releaseLink()
    if (activeTerminalTabId === undefined) {
      disposeTerm()
      return
    }
    const tab = controller.terminalTab(activeTerminalTabId)
    if (tab === undefined) return
    bindTab(tab)
    // Only the tab identity and its lifecycle decide a rebind: output and auth
    // frames update the controller without touching the terminal geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalTabId, activeTab?.status, activeTab?.sessionId])

  // Unmount cleanup: the host keeps every shell alive, so returning to this
  // panel reattaches by session id and replays the scrollback. A connection
  // that has not reported its id yet is adopted rather than dropped.
  useEffect(() => () => {
    releaseLink()
    disposeTerm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Open a tab on the toolbar's host (the "+"/Connect control). */
  const connect = (): void => {
    const target = draftAlias
    if (target === '') return
    controller.openTerminalTab(target)
  }

  /**
   * Close one tab. The shown one ends its session over its own socket; a
   * background tab is ended through one short-lived attach, and a close that
   * cannot be delivered keeps the tab instead of pretending it is gone.
   * @param tabId - the tab to close.
   */
  const closeTab = (tabId: string): void => {
    const tab = controller.terminalTab(tabId)
    if (tab === undefined) return
    const bound = linkRef.current
    if (bound !== null && bound.tabId === tabId) {
      linkRef.current = null
      const connection = bound.connection
      connection.onReady = undefined
      connection.onOutput = undefined
      connection.onExit = undefined
      connection.onAuthPrompt = undefined
      if (tab.status === 'connecting') controller.adoptTerminalLink(tabId, connection, 'close')
      else connection.close()
      controller.closeTerminalTab(tabId)
      return
    }
    if (tab.status === 'connected' && tab.sessionId !== undefined) {
      // One attempt at a time: a second click while the attach is in flight
      // would open another socket for the same session and could report the
      // later outcome over the earlier one.
      if (closingRef.current.has(tabId)) return
      closingRef.current.add(tabId)
      const sessionId = tab.sessionId
      void (async () => {
        try {
          const gone = await api.closeTerminalSession(sessionId)
          if (gone) {
            controller.closeTerminalTab(tabId)
            return
          }
          // Not delivered: the session may still be running, so the tab stays
          // with its session id. Recovery is the same control (retry) or the
          // tab in front, whose own socket can end the shell for certain.
          controller.markTerminalCloseFailed(tabId, 'undelivered')
        } finally {
          closingRef.current.delete(tabId)
        }
      })()
      return
    }
    controller.closeTerminalTab(tabId)
  }

  const submitAuth = (e?: React.FormEvent): void => {
    e?.preventDefault()
    const link = linkRef.current
    const tab = activeTab
    if (link === null || tab === undefined || tab.authPrompt === undefined) return
    // The form and the socket must agree on the tab. A submit that arrives in
    // the window between a tab switch and the rebind would otherwise carry this
    // tab's answers onto the previous tab's connection.
    if (!challengeBelongsToLink(link.tabId, tab.id)) return
    // The answers belong to the tab that shows the form: another tab's draft
    // can never be submitted here.
    link.connection.sendAuthResponse(tab.authAnswers ?? [])
    controller.clearTerminalAuthPrompt(tab.id)
  }

  const stateLabel = activeTab === undefined ? undefined : tabStateLabel(activeTab)

  return (
    <div className={css.termBody}>
      {terminalTabs.length > 0 && (
        <div className={css.termTabs} role="tablist" aria-label={tt('terminal.tabs')} data-dsh-part="tab-bar">
          {terminalTabs.map(tab => {
            const label = tabStateLabel(tab)
            return (
              <div key={tab.id} className={css.termTab} data-active={tab.id === activeTab?.id ? '' : undefined}>
                <button
                  type="button"
                  role="tab"
                  className={css.termTabLabel}
                  aria-selected={tab.id === activeTab?.id}
                  data-dsh-part="tab"
                  title={tab.alias}
                  onClick={() => { controller.setActiveTerminalTab(tab.id) }}
                >
                  <span className={css.termTabAlias}>{tab.alias}</span>
                  {label !== undefined && <span className={css.termTabState} data-state={tab.status}>{label}</span>}
                </button>
                <button
                  type="button"
                  className={css.termTabClose}
                  aria-label={tt('terminal.closeTab')}
                  title={tt('terminal.closeTab')}
                  onClick={() => { closeTab(tab.id) }}
                >
                  <span aria-hidden="true">{'\u00d7'}</span>
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className={css.termTabNew}
            aria-label={tt('terminal.newTab')}
            title={tt('terminal.newTab')}
            disabled={draftAlias === ''}
            onClick={connect}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      )}
      <div className={css.controls}>
        <select className={css.input} value={draftAlias} onChange={event => { controller.setDraftAlias(event.target.value) }}>
          <option value="">{tt('terminal.selectHost')}</option>
          {hosts.map(host => <option key={host.alias} value={host.alias}>{host.alias} ({host.host})</option>)}
        </select>
        <button type="button" className={css.primaryButton} disabled={draftAlias === ''} onClick={connect}>{tt('terminal.connect')}</button>
        <button type="button" className={css.ghostButton} disabled={activeTab === undefined} onClick={() => { if (activeTab !== undefined) closeTab(activeTab.id) }}>{tt('terminal.disconnect')}</button>
      </div>
      {activeTab?.status === 'connecting' && <div className={css.banner} data-kind="info">{tt('terminal.connecting')}</div>}
      {activeTab?.status === 'connected' && stateLabel === undefined && <div className={css.banner} data-kind="ok">{tt('terminal.ready', { alias: activeTab.alias })}</div>}
      {activeTab?.status === 'exited' && (
        <div className={css.banner} data-kind="info">{tt('terminal.exited', { alias: activeTab.alias })}{activeTab.detail !== undefined ? ' (' + activeTab.detail + ')' : ''}</div>
      )}
      {activeTab?.status === 'error' && <div className={css.banner} data-kind="error">{tt('terminal.error', { error: activeTab.detail ?? '' })}</div>}
      {activeTab?.closeError !== undefined && <div className={css.banner} data-kind="error">{tt('terminal.closeFailed')}</div>}
      {listError !== undefined && <div className={css.banner} data-kind="error">{tt('terminal.error', { error: listError })}</div>}
      <div className={css.termWrap}>
        <div ref={containerRef} className={css.termContainer} data-dsh-part="terminal" />
        {terminalTabs.length === 0 && (
          <div className={css.termPlaceholder}>{hosts.length === 0 ? tt('hosts.empty') : tt('terminal.placeholder')}</div>
        )}
        {activeTab?.authPrompt !== undefined && (
          <div className={css.modalBackdrop} style={{ position: 'absolute', zIndex: 10 }}>
            <form className={css.modalCard} style={{ maxWidth: 420 }} onSubmit={submitAuth}>
              <div className={css.modalHeader}>
                <h3 className={css.modalTitle}>{activeTab.authPrompt.name || tt('terminal.auth.title')}</h3>
              </div>
              <p className={css.hint}>{activeTab.authPrompt.instructions || tt('terminal.auth.hint')}</p>
              {activeTab.authPrompt.prompts.map((p, idx) => (
                <label key={idx} className={css.field}>
                  <span className={css.fieldLabel}>{p.prompt.trim() || tt('terminal.auth.title')}</span>
                  <input
                    autoFocus={idx === 0}
                    className={css.input}
                    type={p.echo ? 'text' : 'password'}
                    placeholder={tt('terminal.auth.placeholder')}
                    value={activeTab.authAnswers?.[idx] ?? ''}
                    onChange={event => { controller.setTerminalAuthAnswer(activeTab.id, idx, event.target.value) }}
                  />
                </label>
              ))}
              <div className={css.modalFooter}>
                <button type="button" className={css.ghostButton} onClick={() => { if (activeTab !== undefined) closeTab(activeTab.id) }}>{tt('terminal.auth.cancel')}</button>
                <button type="submit" className={css.primaryButton}>{tt('terminal.auth.submit')}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
