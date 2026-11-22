/**
 * SSH panel controller: the single owner of the panel's view state.
 *
 * Framework-free (structural runtime faces, task-board core/controller.ts
 * style) so the sidebar row and the React panel share one tiny subscription
 * surface. The state lives only for the browser session (no persistence).
 *
 * The active tab, the hosts-tab connect request, the terminal tabs and their
 * host session ids live here rather than inside the panel components: the
 * layout mounts a keyed page only while its panel is selected, so
 * component-local state would reset the tab on every panel switch and lose
 * the ids a reattach needs.
 *
 * Terminal tabs (issue #1950) are records, not sockets. One tab is the tab
 * shown in the single xterm; a tab that is not shown either owns a detached
 * host session (reattached by id, which replays the host scrollback) or no
 * session at all. The controller is also the place where a still-connecting
 * socket is adopted when a view goes away: a connection that has not reported
 * its session id yet cannot be detached, so dropping it would leave the host
 * PTY with no owner (the orphan the reference implementation produced).
 */

import type { TerminalConnection } from '../api.ts'

/** The panel's tab identifiers. */
export type SshTab = 'hosts' | 'keys' | 'terminal' | 'transfer' | 'tunnels' | 'cluster'

/** Stable id shared by the sidebar panel row and the main-slot page. */
export const SSH_PANEL_ID = 'ssh'

/** Lifecycle of one terminal tab. */
export type TerminalTabStatus =
  /** Socket open, the host has not reported a session id yet. */
  | 'connecting'
  /** The host reported a session id; the shell is live. */
  | 'connected'
  /** The remote shell ended. The tab keeps its screen; the session id is cleared. */
  | 'exited'
  /** The connection failed. The tab keeps the reason; the session id is cleared. */
  | 'error'

/** A keyboard-interactive challenge waiting for this tab's answer. */
export interface TerminalAuthPrompt {
  name: string
  instructions: string
  prompts: Array<{ prompt: string; echo: boolean }>
}

/** One terminal tab, independent of the socket that currently serves it. */
export interface TerminalTabRecord {
  /** Local tab id, stable across panel switches (never the host session id). */
  id: string
  /** Host alias this tab opened. Several tabs may share one alias. */
  alias: string
  status: TerminalTabStatus
  /** Host-side PTY session id, present only while the shell is live. */
  sessionId?: string
  /** Exit or failure text for the `exited` / `error` states. */
  detail?: string
  /** Code of a close that never reached the host; the tab is kept. */
  closeError?: string
  /** Challenge captured for this tab, whoever was on screen when it arrived. */
  authPrompt?: TerminalAuthPrompt
  /**
   * The answer being typed for {@link TerminalTabRecord.authPrompt}, owned by
   * this tab: one shared draft let a challenge on tab B inherit (and submit)
   * the characters typed for tab A.
   */
  authAnswers?: string[]
}

/** The terminal fields a later step may change on one tab. */
export type TerminalTabPatch = Omit<TerminalTabRecord, 'id' | 'alias'>

/** What to do with an adopted connection once the host reports its session. */
export type TerminalLinkIntent = 'detach' | 'close'

/** Immutable controller snapshot for UI subscriptions. */
export interface PanelControllerSnapshot {
  /** Whether the center column shows this panel. */
  panelOpen: boolean
  /** The tab the panel is showing. */
  activeTab: SshTab
  /** Every terminal tab, in strip order. */
  terminalTabs: readonly TerminalTabRecord[]
  /** The tab the single xterm is bound to, or undefined when there is none. */
  activeTerminalTabId: string | undefined
  /** Host picked in the terminal toolbar; the next tab opens on it. */
  draftAlias: string
}

/**
 * The layout's panel-navigation face: selecting the panel is the layout's
 * business, and this is the one call that asks for it (null returns the column
 * to the conversation). Optional, so a shell-less composition keeps the pure
 * state transitions testable.
 */
export interface PanelNavigationFace {
  /** Select this panel, or null to hand the column back to the conversation. */
  select(panelId: string | null): void
}

/** Controller dependencies. */
export interface PanelControllerDeps {
  /** Layout panel selection; absent keeps the controller state-only. */
  panel?: PanelNavigationFace
}

/** Byte cap for the retained screen of one tab (the host buffers 256 KiB too). */
const MAX_RETAINED_BYTES = 256 * 1024

/**
 * UTF-8 byte length of one chunk, without node's Buffer (this half is bundled
 * for the browser). Surrogate pairs count as the four bytes they encode to.
 * @param text - the output chunk.
 * @returns its UTF-8 byte length.
 */
function utf8Bytes(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4
        i += 1
        continue
      }
    }
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
  }
  return bytes
}

/** Trim leading code units from an oversized chunk so its tail fits maxBytes without splitting surrogate pairs. */
function trimTrailingUtf8(text: string, maxBytes: number): { text: string; bytes: number } {
  let bytes = 0
  let start = text.length
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const code = text.charCodeAt(i)
    let charBytes: number
    let stepStart = i
    if (code >= 0xdc00 && code <= 0xdfff && i > 0) {
      const high = text.charCodeAt(i - 1)
      if (high >= 0xd800 && high <= 0xdbff) {
        charBytes = 4
        stepStart = i - 1
      } else {
        charBytes = 3
      }
    } else {
      charBytes = code < 0x80 ? 1 : code < 0x800 ? 2 : 3
    }
    if (bytes + charBytes > maxBytes) break
    bytes += charBytes
    start = stepStart
    i = stepStart
  }
  return { text: start === 0 ? text : text.slice(start), bytes }
}

interface RetainedScreen {
  chunks: string[]
  chunkBytes: number[]
  head: number
  bytes: number
}

/** The panel state owner the sidebar row and the view both read. */
export class PanelController {
  private panelOpen = false
  private activeTab: SshTab = 'hosts'
  private terminalTabs: readonly TerminalTabRecord[] = []
  private activeTerminalTabId: string | undefined
  private draftAlias = ''
  private nextTerminalTabSeq = 0
  private listeners = new Set<() => void>()
  /**
   * Last screen of each tab, kept outside the snapshot: terminal output must
   * not re-render the panel on every chunk, and only the terminal view reads
   * this (when a tab has no session left to replay from).
   */
  private readonly retainedScreens = new Map<string, RetainedScreen>()
  /**
   * Sockets that outlived their view while still connecting. Their session id
   * is unknown, so they cannot be detached yet; keeping them here is what
   * prevents a host PTY with no owner.
   */
  private readonly adoptedLinks = new Map<string, { connection: TerminalConnection; intent: TerminalLinkIntent }>()
  /** Cached so getSnapshot is referentially stable between changes. */
  private snapshot: PanelControllerSnapshot = {
    panelOpen: false,
    activeTab: 'hosts',
    terminalTabs: [],
    activeTerminalTabId: undefined,
    draftAlias: '',
  }

  constructor(private readonly deps: PanelControllerDeps = {}) {}

  getSnapshot(): PanelControllerSnapshot {
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Show the panel. The layout owns which panel the column renders, so the
   * state flip and the selection travel together; the selection is requested
   * after the snapshot flips, so a subscriber never observes "open" while the
   * shell still shows the conversation.
   */
  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.commit()
    this.selectPanel(SSH_PANEL_ID)
  }

  /** Return the column to the conversation, asking the layout explicitly. */
  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.commit()
    this.selectPanel(null)
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  /**
   * Reflect a selection made outside this controller (the user clicked another
   * sidebar row, or the layout dropped the panel id).
   * @param panelId - the layout's current panel id, or null for the conversation.
   */
  syncPanelSelection(panelId: string | null): void {
    const open = panelId === SSH_PANEL_ID
    if (open === this.panelOpen) return
    this.panelOpen = open
    this.commit()
  }

  /** Switch tabs, keeping every other piece of view state. */
  setActiveTab(tab: SshTab): void {
    if (this.activeTab === tab) return
    this.activeTab = tab
    this.commit()
  }

  /**
   * Hand the terminal tab a host to connect to (the hosts-tab "connect"
   * action): the tab exists before the view does, so a panel switch during the
   * handshake still shows the connecting tab and adopts its socket.
   * @param alias - the configured host alias.
   */
  requestConnect(alias: string): void {
    this.activeTab = 'terminal'
    this.openTerminalTab(alias)
  }

  /**
   * Add a terminal tab on the alias and make it the shown one. Several tabs
   * may target one alias on purpose: each owns its own host PTY.
   * @param alias - the configured host alias.
   * @returns the new tab id.
   */
  openTerminalTab(alias: string): string {
    this.nextTerminalTabSeq += 1
    const id = 'tab-' + String(this.nextTerminalTabSeq)
    this.terminalTabs = [...this.terminalTabs, { id, alias, status: 'connecting' }]
    this.activeTerminalTabId = id
    this.draftAlias = alias
    this.retainedScreens.delete(id)
    this.commit()
    return id
  }

  /**
   * Show an existing tab and make the toolbar follow its host, so a new tab
   * opens on the host the user is looking at.
   * @param id - the tab id.
   */
  setActiveTerminalTab(id: string): void {
    if (this.activeTerminalTabId === id) return
    const tab = this.terminalTab(id)
    if (tab === undefined) return
    this.activeTerminalTabId = id
    this.draftAlias = tab.alias
    this.commit()
  }

  /**
   * Remove one tab and forget its screen. When the shown tab closes, the
   * neighbours decide what the xterm shows next: the tab that took its place,
   * else the one before it, else nothing.
   * @param id - the tab id.
   */
  closeTerminalTab(id: string): void {
    const index = this.terminalTabs.findIndex(tab => tab.id === id)
    this.retainedScreens.delete(id)
    // A still-connecting socket was adopted, not detached, and the tab is going
    // away: its session must end rather than be left without an owner. The
    // intent is retargeted in the live entry instead of being forgotten, because
    // forgetting it leaves the old detach handler in charge of the ready frame.
    const adopted = this.adoptedLinks.get(id)
    if (adopted !== undefined) adopted.intent = 'close'
    if (index < 0) return
    const wasActive = this.activeTerminalTabId === id
    this.terminalTabs = this.terminalTabs.filter(tab => tab.id !== id)
    if (wasActive) {
      const neighbour = this.terminalTabs[index] ?? this.terminalTabs[index - 1]
      this.activeTerminalTabId = neighbour?.id
      if (neighbour !== undefined) this.draftAlias = neighbour.alias
    }
    this.commit()
  }

  /** The tab record with this id, or undefined when it no longer exists. */
  terminalTab(id: string): TerminalTabRecord | undefined {
    return this.terminalTabs.find(tab => tab.id === id)
  }

  /**
   * Apply a partial update to one tab; a tab that was closed in the meantime
   * is left alone rather than resurrected.
   * @param id - the tab id.
   * @param patch - the fields to change.
   */
  patchTerminalTab(id: string, patch: Partial<TerminalTabPatch>): void {
    let found = false
    const next = this.terminalTabs.map(tab => {
      if (tab.id !== id) return tab
      found = true
      return { ...tab, ...patch }
    })
    if (!found) return
    this.terminalTabs = next
    this.commit()
  }

  /**
   * Record the host session of a ready tab and clear the challenge it carried.
   * @param id - the tab id.
   * @param sessionId - the id the host reported on its ready frame.
   */
  readyTerminalTab(id: string, sessionId: string): void {
    this.patchTerminalTab(id, {
      status: 'connected',
      sessionId,
      detail: undefined,
      closeError: undefined,
      authPrompt: undefined,
      authAnswers: undefined,
    })
  }

  /**
   * The remote shell ended: the tab keeps its screen and its place, and the
   * dead session id is dropped so nothing tries to reattach to it.
   * @param id - the tab id.
   * @param detail - why it ended, when the transport said.
   */
  exitTerminalTab(id: string, detail?: string): void {
    // The close failure belonged to a session that no longer exists: keeping it
    // would leave a tab that keeps reporting a close it already got.
    this.patchTerminalTab(id, {
      status: 'exited',
      sessionId: undefined,
      detail,
      authPrompt: undefined,
      authAnswers: undefined,
      closeError: undefined,
    })
  }

  /**
   * The connection failed. The tab stays with the reason so the user can read
   * it and close the tab themselves.
   * @param id - the tab id.
   * @param detail - the failure text.
   */
  failTerminalTab(id: string, detail: string): void {
    this.patchTerminalTab(id, {
      status: 'error',
      sessionId: undefined,
      detail,
      authPrompt: undefined,
      authAnswers: undefined,
      closeError: undefined,
    })
  }

  /**
   * A background close never reached the host. The tab keeps its live session
   * id (so a retry can still end it) and says so instead of vanishing.
   * @param id - the tab id.
   * @param reason - the reason code shown by the view.
   */
  markTerminalCloseFailed(id: string, reason: string): void {
    this.patchTerminalTab(id, { closeError: reason })
  }

  /**
   * Store the keyboard-interactive challenge this tab has to answer, with a
   * blank answer of this challenge's own length. A prompt on another tab never
   * touches this record, which is what keeps two challenges from sharing input.
   * @param id - the tab id.
   * @param prompt - the challenge the host asked for.
   */
  setTerminalAuthPrompt(id: string, prompt: TerminalAuthPrompt): void {
    this.patchTerminalTab(id, { authPrompt: prompt, authAnswers: prompt.prompts.map(() => '') })
  }

  /**
   * Record one character typed for this tab's challenge.
   * @param id - the tab id.
   * @param index - which prompt of the challenge.
   * @param value - the field's current text.
   */
  setTerminalAuthAnswer(id: string, index: number, value: string): void {
    const tab = this.terminalTab(id)
    if (tab === undefined || tab.authPrompt === undefined) return
    const answers = [...(tab.authAnswers ?? tab.authPrompt.prompts.map(() => ''))]
    answers[index] = value
    this.patchTerminalTab(id, { authAnswers: answers })
  }

  /** Drop the challenge once it was answered, cancelled, or could not apply. */
  clearTerminalAuthPrompt(id: string): void {
    if (this.terminalTab(id)?.authPrompt === undefined) return
    this.patchTerminalTab(id, { authPrompt: undefined, authAnswers: undefined })
  }

  /** Choose the alias the next terminal tab opens on. */
  setDraftAlias(alias: string): void {
    if (this.draftAlias === alias) return
    this.draftAlias = alias
    this.commit()
  }

  /** Append one output chunk to the retained screen of a tab. */
  appendTerminalOutput(id: string, chunk: string): void {
    if (chunk === '') return
    const size = utf8Bytes(chunk)
    if (size > MAX_RETAINED_BYTES) {
      const trimmed = trimTrailingUtf8(chunk, MAX_RETAINED_BYTES)
      this.retainedScreens.set(id, {
        chunks: trimmed.text === '' ? [] : [trimmed.text],
        chunkBytes: trimmed.text === '' ? [] : [trimmed.bytes],
        head: 0,
        bytes: trimmed.bytes,
      })
      return
    }
    let screen = this.retainedScreens.get(id)
    if (screen === undefined) {
      this.retainedScreens.set(id, { chunks: [chunk], chunkBytes: [size], head: 0, bytes: size })
      return
    }
    screen.chunks.push(chunk)
    screen.chunkBytes.push(size)
    screen.bytes += size
    while (screen.bytes > MAX_RETAINED_BYTES && screen.chunks.length - screen.head > 1) {
      screen.bytes -= screen.chunkBytes[screen.head]!
      screen.head += 1
    }
    if (screen.head >= 256 && screen.head * 2 >= screen.chunks.length) {
      screen.chunks = screen.chunks.slice(screen.head)
      screen.chunkBytes = screen.chunkBytes.slice(screen.head)
      screen.head = 0
    }
  }

  /** The retained screen of a tab, concatenated for a redraw. */
  readTerminalOutput(id: string): string {
    const screen = this.retainedScreens.get(id)
    if (screen === undefined) return ''
    return screen.head === 0 ? screen.chunks.join('') : screen.chunks.slice(screen.head).join('')
  }

  /** Forget the retained screen (a fresh replay from the host replaces it). */
  clearTerminalOutput(id: string): void {
    this.retainedScreens.delete(id)
  }

  /**
   * Keep a still-connecting socket alive after its view went away. The socket
   * cannot be detached yet (no session id), so the intent is applied when the
   * host reports it: `detach` leaves the shell for a later reattach, `close`
   * ends the session of a tab the user closed.
   * @param tabId - the tab the socket belongs to.
   * @param connection - the live connection.
   * @param intent - what to do once the session id arrives.
   */
  adoptTerminalLink(tabId: string, connection: TerminalConnection, intent: TerminalLinkIntent): void {
    const entry = { connection, intent }
    this.adoptedLinks.set(tabId, entry)
    // Output that arrives while no view is bound still belongs to the tab, so it
    // goes into the retained screen: reclaiming the socket then replays the
    // whole adopt window instead of showing a gap. A tab that was closed in the
    // meantime stays closed — appending would recreate its retained entry and
    // hand a deleted tab a screen again.
    connection.onOutput = (data) => {
      if (this.terminalTab(tabId) === undefined) return
      this.appendTerminalOutput(tabId, data)
    }
    connection.onAuthPrompt = (name, instructions, prompts) => {
      if (this.terminalTab(tabId) === undefined) return
      this.setTerminalAuthPrompt(tabId, { name, instructions, prompts })
    }
    connection.onReady = (sessionId) => {
      // The intent is read now, not when the socket was adopted: closing the tab
      // while it connects retargets the entry to `close`, and a detach here
      // would leave a host PTY nobody owns.
      const decided = this.adoptedLinks.get(tabId)?.intent ?? entry.intent
      this.adoptedLinks.delete(tabId)
      this.readyTerminalTab(tabId, sessionId)
      if (decided === 'close') connection.close()
      else connection.detach()
    }
    connection.onExit = (_code, error) => {
      this.adoptedLinks.delete(tabId)
      this.failTerminalTab(tabId, error ?? 'connection closed')
    }
  }

  /**
   * Take an adopted socket back when its tab is shown again, so the host never
   * opens a second PTY for the same tab.
   * @param tabId - the tab id.
   * @returns the connection, or undefined when nothing was adopted.
   */
  reclaimTerminalLink(tabId: string): TerminalConnection | undefined {
    const adopted = this.adoptedLinks.get(tabId)
    if (adopted === undefined) return undefined
    // A close intent is already on its way out; leave it to finish.
    if (adopted.intent === 'close') return undefined
    this.adoptedLinks.delete(tabId)
    adopted.connection.onReady = undefined
    adopted.connection.onExit = undefined
    adopted.connection.onAuthPrompt = undefined
    // onOutput stays: the view replaces it when it binds, and keeping it until
    // then means no chunk is lost between reclaim and bind.
    return adopted.connection
  }

  private commit(): void {
    this.snapshot = {
      panelOpen: this.panelOpen,
      activeTab: this.activeTab,
      terminalTabs: this.terminalTabs,
      activeTerminalTabId: this.activeTerminalTabId,
      draftAlias: this.draftAlias,
    }
    for (const fn of [...this.listeners]) fn()
  }

  /** Ask the layout to select a panel; a shell without the face is a no-op. */
  private selectPanel(panelId: string | null): void {
    try {
      this.deps.panel?.select(panelId)
    } catch {
      // The layout service throws by contract before its root entry mounts;
      // the state flip above already stands and the next selection retries.
    }
  }
}
