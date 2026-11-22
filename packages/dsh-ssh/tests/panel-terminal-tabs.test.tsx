// @vitest-environment jsdom
/**
 * SSH terminal tabs (issue #1950): one xterm over several host PTYs.
 *
 * The contract under test is the tab state machine plus the two places where it
 * touches the single real xterm (the clear before a rebind, and the replay of a
 * retained screen), observed through that instance's own methods: an opened tab
 * owns its host session, a hidden tab detaches and reattaches by session id, a
 * socket that has not reported its id yet is adopted instead of dropped (the
 * orphan the reference implementation produced), a remote exit keeps the tab and
 * its last screen, a pending challenge and its answer belong to their tab, and a
 * background close only removes the tab when the session is known to be gone.
 *
 * jsdom has no canvas, so xterm logs "Not implemented: HTMLCanvasElement
 * .getContext" on stderr while these tests run; that is renderer noise from the
 * real terminal, not a failure — every assertion below is on domain state.
 */

import { act } from 'react'
import type { ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalTab, challengeBelongsToLink } from '../src/client/panel/TerminalTab.tsx'
import { SshPanel } from '../src/client/panel/SshPanel.tsx'
import { PanelController } from '../src/client/panel/controller.ts'
import { tt } from '../src/client/panel/helpers.ts'
import { SshApi, type TerminalConnection } from '../src/client/api.ts'
import type { SshHostSummary } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}

/** A terminal connection whose frames the test drives by hand. */
interface FakeConnection extends TerminalConnection {
  send: TerminalConnection['send'] & ReturnType<typeof vi.fn>
  resize: TerminalConnection['resize'] & ReturnType<typeof vi.fn>
  sendAuthResponse: TerminalConnection['sendAuthResponse'] & ReturnType<typeof vi.fn>
  detach: TerminalConnection['detach'] & ReturnType<typeof vi.fn>
  close: TerminalConnection['close'] & ReturnType<typeof vi.fn>
}

/** The client harness: one api, one controller, and what the view opened. */
interface Harness {
  api: SshApi
  controller: PanelController
  /** Connections opened by the view, in call order. */
  opened: FakeConnection[]
  /** Connections opened as a reattach, with the session each asked for. */
  attached: Array<{ sessionId: string; connection: FakeConnection }>
  /** Sessions a background close was attempted for, in call order. */
  closeAttempts: string[]
  /** Whether the next background close claims the frame reached the host. */
  setCloseDelivered(delivered: boolean): void
}

/** One host summary with the fields the panel reads. */
function host(alias: string): SshHostSummary {
  return {
    alias,
    host: alias + '.test',
    port: 22,
    user: 'ops',
    auth: 'password',
    keyReady: false,
    proxyJump: [],
    tags: [],
    forwardAgent: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** A connection the panel can drive frame by frame. */
function fakeConnection(): FakeConnection {
  const connection = {
    onReady: undefined,
    onOutput: undefined,
    onExit: undefined,
    onAuthPrompt: undefined,
    send: vi.fn(),
    resize: vi.fn(),
    sendAuthResponse: vi.fn(),
    detach: vi.fn(),
    close: vi.fn(),
  }
  return connection as unknown as FakeConnection
}

/** Build the client harness. */
function harness(options: { hosts?: string[] } = {}): Harness {
  const opened: FakeConnection[] = []
  const attached: Array<{ sessionId: string; connection: FakeConnection }> = []
  const closeAttempts: string[] = []
  let closeDelivered = true
  const hosts = (options.hosts ?? ['edge']).map(host)
  const api = {
    listHosts: vi.fn(async () => hosts),
    openTerminal: vi.fn(() => {
      const connection = fakeConnection()
      opened.push(connection)
      return connection
    }),
    attachTerminal: vi.fn((sessionId: string) => {
      const connection = fakeConnection()
      attached.push({ sessionId, connection })
      return connection
    }),
    closeTerminalSession: vi.fn(async (sessionId: string) => {
      closeAttempts.push(sessionId)
      return closeDelivered
    }),
  } as unknown as SshApi
  return {
    api,
    controller: new PanelController(),
    opened,
    attached,
    closeAttempts,
    setCloseDelivered: (delivered) => { closeDelivered = delivered },
  }
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Mount an element and flush its first effects. */
async function mount(element: ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(element) })
  await act(async () => { await Promise.resolve() })
  return container
}

/** The toolbar's Connect control (the strip buttons come first once a tab exists). */
function connectControl(container: HTMLElement): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => button.textContent === tt('terminal.connect'))
  if (found === undefined) throw new Error('connect control missing')
  return found
}

/** The strip's "new tab" control. */
function newTabControl(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector('[aria-label="' + tt('terminal.newTab') + '"]')
  if (found === null) throw new Error('new-tab control missing')
  return found as HTMLButtonElement
}

/** The strip's per-tab close controls, in strip order. */
function closeControls(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('[aria-label="' + tt('terminal.closeTab') + '"]')] as HTMLButtonElement[]
}

/** The strip's tab controls, in strip order. */
function tabControls(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
}

/** Pick a host in the toolbar's select. */
async function chooseHost(container: HTMLElement, alias: string): Promise<void> {
  const select = container.querySelector('select') as HTMLSelectElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, alias)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Open a tab on the given alias through the toolbar. */
async function connectHost(container: HTMLElement, alias?: string): Promise<void> {
  if (alias !== undefined) await chooseHost(container, alias)
  await act(async () => { connectControl(container).click() })
}

/** The challenge form's inputs, in prompt order. */
function challengeInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll('form input')] as HTMLInputElement[]
}

/** Type one answer field of the visible challenge. */
async function typeChallenge(container: HTMLElement, index: number, text: string): Promise<void> {
  const input = challengeInputs(container)[index]!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Submit the visible challenge form. */
async function submitChallenge(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form') as HTMLFormElement
  await act(async () => {
    const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement
    submit.click()
  })
}

/** Type into the first answer field and submit the challenge form. */
async function answerChallenge(container: HTMLElement, code: string): Promise<void> {
  await typeChallenge(container, 0, code)
  await submitChallenge(container)
}

/** Flush the follow-up work of an async click handler. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('SSH terminal tabs (#1950)', () => {
  it('Operator opens two tabs on one host and each tab keeps its own host session', async () => {
    // Given a terminal view with one configured host
    const h = harness()
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="edge" />)

    // When the operator connects twice on that same host
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-edge-1', 'edge') })
    await connectHost(container)
    await act(async () => { h.opened[1]!.onReady?.('s-edge-2', 'edge') })

    // Then both tabs exist on the same host, each with its own PTY session
    const tabs = h.controller.getSnapshot().terminalTabs
    expect(tabs.map(tab => tab.alias)).toEqual(['edge', 'edge'])
    expect(tabs.map(tab => tab.sessionId)).toEqual(['s-edge-1', 's-edge-2'])
    expect(tabControls(container)).toHaveLength(2)
    expect(h.opened).toHaveLength(2)
  })

  it('Operator switches between tabs and the hidden session detaches while the shown one replays', async () => {
    // Given two tabs connected to two hosts
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })

    // When the operator selects the first tab again
    await act(async () => { tabControls(container)[0]!.click() })

    // Then the second tab's socket detached and the first was reattached by id
    expect(h.opened[1]!.detach).toHaveBeenCalledWith()
    expect(h.attached.map(entry => entry.sessionId)).toEqual(['s-alpha'])
    expect(h.controller.getSnapshot().activeTerminalTabId).toBe(h.controller.getSnapshot().terminalTabs[0]!.id)
  })

  it('Operator closes one tab while the other keeps running', async () => {
    // Given two connected tabs with the second one shown
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })

    // When the operator closes the background tab
    await act(async () => { closeControls(container)[0]!.click() })
    await flush()

    // Then only that tab is gone, ended through a short attach on its session
    expect(h.controller.getSnapshot().terminalTabs.map(tab => tab.alias)).toEqual(['beta'])
    expect(h.closeAttempts).toEqual(['s-alpha'])
    expect(h.opened[1]!.close).toHaveBeenCalledTimes(0)
  })

  it('Operator keeps a background tab whose close never reached the host', async () => {
    // Given two connected tabs and a host that cannot confirm a close
    const h = harness({ hosts: ['alpha', 'beta'] })
    h.setCloseDelivered(false)
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })

    // When the operator closes the background tab
    await act(async () => { closeControls(container)[0]!.click() })
    await flush()

    // Then the tab is kept, still holding its session, and marked undelivered
    const tab = h.controller.getSnapshot().terminalTabs[0]!
    expect(h.controller.getSnapshot().terminalTabs).toHaveLength(2)
    expect(tab.alias).toBe('alpha')
    expect(tab.sessionId).toBe('s-alpha')
    expect(tab.closeError).toBe('undelivered')
    expect(tabControls(container)[0]!.textContent).toContain(tt('terminal.tabError'))
  })

  it('Operator switching away before a tab is ready leaves no host PTY without an owner', async () => {
    // Given a tab that has opened its socket but not reported its session yet
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    expect(h.controller.getSnapshot().terminalTabs[0]!.status).toBe('connecting')

    // When the operator opens another tab before the host answers
    await connectHost(container, 'beta')
    const firstTab = h.controller.getSnapshot().terminalTabs[0]!
    expect(firstTab.status).toBe('connecting')

    // Then the still-connecting socket is adopted, not dropped, and detaches
    // the moment the host reports the session it was holding
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    expect(h.controller.getSnapshot().terminalTabs[0]!.sessionId).toBe('s-alpha')
    expect(h.opened[0]!.detach).toHaveBeenCalledWith()
  })

  it('Operator leaving the panel before a tab is ready still hands the session to a later view', async () => {
    // Given one connecting tab on a mounted view
    const h = harness()
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="edge" />)
    await connectHost(container)

    // When the panel page unmounts during the handshake
    await act(async () => { roots.pop()!.unmount() })

    // Then the socket survives the unmount and detaches once the id arrives
    await act(async () => { h.opened[0]!.onReady?.('s-edge', 'edge') })
    expect(h.opened[0]!.detach).toHaveBeenCalledWith()
    expect(h.controller.getSnapshot().terminalTabs[0]!.sessionId).toBe('s-edge')
  })

  it('Operator answers a 2FA challenge that arrived while another tab was shown', async () => {
    // Given two tabs still connecting and a challenge delivered to the first
    const h = harness({ hosts: ['jump', 'ops'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="jump" />)
    await connectHost(container)
    await connectHost(container, 'ops')
    await act(async () => {
      h.opened[0]!.onAuthPrompt?.('Jump 2FA', 'Enter the token', [{ prompt: 'Code: ', echo: true }])
    })

    // When the operator switches back to the challenged tab
    await act(async () => { tabControls(container)[0]!.click() })

    // Then the challenge is still there and its answer goes to that tab's socket
    expect(container.querySelector('h3')?.textContent).toBe('Jump 2FA')
    await answerChallenge(container, '654321')
    expect(h.opened[0]!.sendAuthResponse).toHaveBeenCalledWith(['654321'])
  })

  it('Operator keeps the tab and its last screen when the remote shell exits', async () => {
    // Given a connected tab that printed something
    const h = harness()
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="edge" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-edge', 'edge') })
    await act(async () => { h.opened[0]!.onOutput?.('logout\n') })

    // When the remote shell ends
    await act(async () => { h.opened[0]!.onExit?.(0, undefined) })

    // Then the tab stays with its screen and without a dead session id
    const tabs = h.controller.getSnapshot().terminalTabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.status).toBe('exited')
    expect(tabs[0]!.sessionId).toBeUndefined()
    expect(h.controller.readTerminalOutput(tabs[0]!.id)).toBe('logout\n')
    expect(container.textContent).not.toContain(tt('terminal.placeholder'))
    expect(container.textContent).toContain(tt('terminal.exited', { alias: 'edge' }))
  })

  it('Operator connecting from the hosts page follows that host in the terminal toolbar', async () => {
    // Given a hosts page listing one host
    const h = harness({ hosts: ['edge'] })
    const container = await mount(<SshPanel api={h.api} controller={h.controller} />)
    const connectRow = [...container.querySelectorAll('button')].find(button => button.textContent === tt('hosts.connected'))
    if (connectRow === undefined) throw new Error('hosts connect row missing')

    // When the operator presses that row's connect control
    await act(async () => { connectRow.click() })
    await flush()

    // Then the terminal tab is shown, a tab is open, and the toolbar follows
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('edge')
    expect(h.controller.getSnapshot().terminalTabs.map(tab => tab.alias)).toEqual(['edge'])
    expect(h.opened).toHaveLength(1)
  })

  it('Operator opens an extra tab on the host the toolbar currently shows', async () => {
    // Given two tabs, with the first one shown again
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })
    await act(async () => { tabControls(container)[0]!.click() })

    // When the operator presses the strip's new-tab control
    await act(async () => { newTabControl(container).click() })

    // Then a third tab opens on the shown host, without disturbing the others
    const tabs = h.controller.getSnapshot().terminalTabs
    expect(tabs.map(tab => tab.alias)).toEqual(['alpha', 'beta', 'alpha'])
    expect(tabs[2]!.status).toBe('connecting')
    expect(h.opened).toHaveLength(3)
  })

  it('Operator closing a tab that is still connecting ends its session instead of detaching it', async () => {
    // Given a connecting tab that was adopted when a second tab opened
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await connectHost(container, 'beta')

    // When the operator closes that still-connecting tab
    await act(async () => { closeControls(container)[0]!.click() })

    // Then its session is closed once the host reports it, never detached into
    // a PTY nobody can attach to
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    expect(h.opened[0]!.close).toHaveBeenCalledWith()
    expect(h.opened[0]!.detach.mock.calls).toHaveLength(0)
  })

  it('Operator opening another tab starts from a blank screen instead of the previous tab', async () => {
    // Given a connected tab that printed its own line
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await act(async () => { h.opened[0]!.onOutput?.('alpha-only\n') })
    const alphaId = h.controller.getSnapshot().terminalTabs[0]!.id

    // When the operator opens a second tab
    await connectHost(container, 'beta')
    const betaId = h.controller.getSnapshot().terminalTabs[1]!.id

    // Then the new tab owns no inherited output, and the first tab keeps its own
    expect(h.controller.readTerminalOutput(betaId)).toBe('')
    expect(h.controller.readTerminalOutput(alphaId)).toBe('alpha-only\n')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })
    await act(async () => { h.opened[1]!.onOutput?.('beta-only\n') })
    expect(h.controller.readTerminalOutput(betaId)).toBe('beta-only\n')
    expect(h.controller.readTerminalOutput(alphaId)).toBe('alpha-only\n')
  })

  it('Operator switching back to a tab that was connecting sees the output it produced meanwhile', async () => {
    // Given a connecting tab that produced output while it was in the background
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await connectHost(container, 'beta')
    const alphaId = h.controller.getSnapshot().terminalTabs[0]!.id
    await act(async () => { h.opened[0]!.onOutput?.('early\n') })

    // When the operator switches back before that tab reported its session
    await act(async () => { tabControls(container)[0]!.click() })

    // Then the adopt-window output survived and the same socket carries on
    expect(h.controller.readTerminalOutput(alphaId)).toBe('early\n')
    expect(h.attached).toHaveLength(0)
    expect(h.opened).toHaveLength(2)
    await act(async () => { h.opened[0]!.onOutput?.('late\n') })
    expect(h.controller.readTerminalOutput(alphaId)).toBe('early\nlate\n')
  })

  it('Operator answering two challenges on two tabs never mixes their answers', async () => {
    // Given two tabs whose hosts ask for different challenges, and an answer
    // already typed into the shown one
    const h = harness({ hosts: ['jump', 'ops'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="jump" />)
    await connectHost(container)
    await connectHost(container, 'ops')
    await act(async () => {
      h.opened[1]!.onAuthPrompt?.('Ops 2FA', '', [
        { prompt: 'User: ', echo: true },
        { prompt: 'Code: ', echo: true },
      ])
    })
    await typeChallenge(container, 0, 'b1')

    // When a challenge for the background tab arrives
    await act(async () => {
      h.opened[0]!.onAuthPrompt?.('Jump 2FA', 'Enter the token', [{ prompt: 'Code: ', echo: true }])
    })

    // Then the shown form keeps its two fields and the typed characters
    expect(challengeInputs(container)).toHaveLength(2)
    expect(challengeInputs(container)[0]!.value).toBe('b1')

    // When the operator answers the background tab's challenge
    await act(async () => { tabControls(container)[0]!.click() })
    expect(challengeInputs(container)).toHaveLength(1)
    expect(challengeInputs(container)[0]!.value).toBe('')
    await typeChallenge(container, 0, 'a1')
    await submitChallenge(container)
    expect(h.opened[0]!.sendAuthResponse).toHaveBeenCalledWith(['a1'])
    expect(h.opened[1]!.sendAuthResponse.mock.calls).toHaveLength(0)

    // Then the other tab's challenge still holds its own answer and submits it
    await act(async () => { tabControls(container)[1]!.click() })
    expect(challengeInputs(container)[0]!.value).toBe('b1')
    await typeChallenge(container, 1, 'b2')
    await submitChallenge(container)
    expect(h.opened[1]!.sendAuthResponse).toHaveBeenCalledWith(['b1', 'b2'])
    expect(h.opened[0]!.sendAuthResponse).toHaveBeenCalledTimes(1)
  })

  it('Operator recovering a tab whose close failed once the host reports it gone', async () => {
    // Given two connected tabs and a background close the host never confirmed
    const h = harness({ hosts: ['alpha', 'beta'] })
    h.setCloseDelivered(false)
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })
    await act(async () => { closeControls(container)[0]!.click() })
    await flush()
    expect(h.controller.getSnapshot().terminalTabs[0]!.closeError).toBe('undelivered')

    // When the operator brings that tab to the front and the host reports the
    // session it held is gone
    await act(async () => { tabControls(container)[0]!.click() })
    expect(h.attached.map(entry => entry.sessionId)).toEqual(['s-alpha'])
    await act(async () => { h.attached[0]!.connection.onExit?.(0, undefined) })

    // Then the stale close failure is gone and the tab is a plain exited tab
    const tab = h.controller.getSnapshot().terminalTabs[0]!
    expect(tab.status).toBe('exited')
    expect(tab.closeError).toBeUndefined()
    expect(container.textContent).not.toContain(tt('terminal.closeFailed'))
  })

  it('Operator closing the shown tab hands the terminal to the next tab', async () => {
    // Given three connected tabs with the middle one shown
    const h = harness({ hosts: ['alpha', 'beta', 'gamma'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await connectHost(container, 'beta')
    await act(async () => { h.opened[1]!.onReady?.('s-beta', 'beta') })
    await connectHost(container, 'gamma')
    await act(async () => { h.opened[2]!.onReady?.('s-gamma', 'gamma') })
    await act(async () => { tabControls(container)[1]!.click() })

    // When the operator closes it
    await act(async () => { closeControls(container)[1]!.click() })

    // Then the tab that took its place is shown and reattached by its session
    const snapshot = h.controller.getSnapshot()
    expect(snapshot.terminalTabs.map(tab => tab.alias)).toEqual(['alpha', 'gamma'])
    expect(snapshot.activeTerminalTabId).toBe(snapshot.terminalTabs[1]!.id)
    expect(h.attached[h.attached.length - 1]!.sessionId).toBe('s-gamma')
    // The closed tab ended its shell over the socket that was serving it.
    const betaSocket = h.attached.find(entry => entry.sessionId === 's-beta')!
    expect(betaSocket.connection.close).toHaveBeenCalledWith()
  })

  it('Operator closing every tab returns the terminal to its placeholder', async () => {
    // Given one connected tab on screen
    const h = harness()
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="edge" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-edge', 'edge') })

    // When the operator closes it
    await act(async () => { closeControls(container)[0]!.click() })
    await flush()

    // Then no tab is left, no terminal is bound, and the empty state is back
    const snapshot = h.controller.getSnapshot()
    expect(snapshot.terminalTabs).toHaveLength(0)
    expect(snapshot.activeTerminalTabId).toBeUndefined()
    expect(container.textContent).toContain(tt('terminal.placeholder'))
    expect(h.opened[0]!.close).toHaveBeenCalledWith()
  })

  it('Operator closing a connecting tab stops its output from rebuilding a screen', async () => {
    // Given a connecting tab whose socket was adopted when a second tab opened
    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    const alphaId = h.controller.getSnapshot().terminalTabs[0]!.id
    await connectHost(container, 'beta')

    // When the operator closes that tab and the socket keeps reporting
    await act(async () => { closeControls(container)[0]!.click() })
    await act(async () => { h.opened[0]!.onOutput?.('ghost\n') })

    // Then the closed tab came back neither as a record nor as a screen
    expect(h.controller.terminalTab(alphaId)).toBeUndefined()
    expect(h.controller.readTerminalOutput(alphaId)).toBe('')
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    expect(h.opened[0]!.close).toHaveBeenCalledWith()
  })

  it('Operator submitting while a tab switch is in flight never sends answers on another tab socket', async () => {
    // Given two tabs with their own challenges and their own typed answers
    const h = harness({ hosts: ['jump', 'ops'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="jump" />)
    await connectHost(container)
    await act(async () => {
      h.opened[0]!.onAuthPrompt?.('Jump 2FA', '', [{ prompt: 'Code: ', echo: true }])
    })
    await typeChallenge(container, 0, 'a1')
    await connectHost(container, 'ops')
    await act(async () => {
      h.opened[1]!.onAuthPrompt?.('Ops 2FA', '', [
        { prompt: 'User: ', echo: true },
        { prompt: 'Code: ', echo: true },
      ])
    })
    await typeChallenge(container, 0, 'b1')
    const form = container.querySelector('form') as HTMLFormElement

    // When the operator submits in the same task as switching back to the
    // first tab, before the view has rebound its socket
    await act(async () => {
      tabControls(container)[0]!.click()
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Then exactly one response left a socket, on the socket of the tab whose
    // draft it carries, so no response ever spans the other tab's challenge
    const jumpAnswers = h.opened[0]!.sendAuthResponse.mock.calls.map(call => call[0] as string[])
    const opsAnswers = h.opened[1]!.sendAuthResponse.mock.calls.map(call => call[0] as string[])
    expect(jumpAnswers.length + opsAnswers.length).toBe(1)
    expect(jumpAnswers.every(answer => answer.length === 1)).toBe(true)
    expect(opsAnswers.every(answer => answer.length === 2)).toBe(true)
    await act(async () => {
      const submit = container.querySelector('form button[type="submit"]')
      if (submit !== null) (submit as HTMLButtonElement).click()
    })
    expect(h.opened[0]!.sendAuthResponse).toHaveBeenCalledWith(['a1'])
  })

  it('Operator switching to another tab clears the one real terminal before rebinding it', async () => {
    // Given a terminal that already shows the first tab's output
    const resetSpy = vi.spyOn(Terminal.prototype, 'reset') // test-standards-allow: no-ad-hoc-mock — the single real xterm is the subject; watching its own reset is the only observation that proves the screen was cleared, and a seam in the product would not be the product

    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await act(async () => { h.opened[0]!.onReady?.('s-alpha', 'alpha') })
    await act(async () => { h.opened[0]!.onOutput?.('alpha-only\n') })
    const clearsBefore = resetSpy.mock.calls.length

    // When the operator opens a second tab
    await connectHost(container, 'beta')

    // Then the shared terminal was cleared instead of keeping the old text
    expect(resetSpy.mock.calls.length).toBeGreaterThan(clearsBefore)
  })

  it('Operator switching back to a connecting tab writes its retained output into the terminal', async () => {
    // Given a tab that produced output while it was adopted in the background
    const writeSpy = vi.spyOn(Terminal.prototype, 'write') // test-standards-allow: no-ad-hoc-mock — same real-xterm observation as the clear guard above; the replay must be visible on the single instance

    const h = harness({ hosts: ['alpha', 'beta'] })
    const container = await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="alpha" />)
    await connectHost(container)
    await connectHost(container, 'beta')
    await act(async () => { h.opened[0]!.onOutput?.('early\n') })
    // nothing drew that text while the tab was in the background
    expect(writeSpy.mock.calls.filter(args => args[0] === 'early\n')).toHaveLength(0)

    // When the operator switches back before the host reported the session
    await act(async () => { tabControls(container)[0]!.click() })

    // Then the retained screen was replayed into the one terminal, exactly once
    expect(writeSpy.mock.calls.filter(args => args[0] === 'early\n')).toHaveLength(1)
  })

  it('Operator remounting TerminalTab clears retained output before host replay so scrollback is not duplicated', async () => {
    // Given a connected tab with output captured in the controller before panel unmount
    const h = harness()
    await mount(<TerminalTab api={h.api} controller={h.controller} presetAlias="edge" />)
    await act(async () => {
      const container = document.body.lastElementChild as HTMLElement
      await connectHost(container)
    })
    await act(async () => { h.opened[0]!.onReady?.('s-edge', 'edge') })
    await act(async () => { h.opened[0]!.onOutput?.('prompt$ uname\n') })
    const tabId = h.controller.getSnapshot().terminalTabs[0]!.id
    expect(h.controller.readTerminalOutput(tabId)).toBe('prompt$ uname\n')

    // When the panel unmounts, remounts, and the host replays its scrollback on reattach
    await act(async () => { roots.pop()!.unmount() })
    await mount(<TerminalTab api={h.api} controller={h.controller} />)
    await act(async () => { h.attached[0]!.connection.onOutput?.('prompt$ uname\n') })

    // Then the controller holds one copy of the scrollback instead of doubling it
    expect(h.controller.readTerminalOutput(tabId)).toBe('prompt$ uname\n')
  })

  it('Operator receiving a single chunk larger than 256 KiB trims to UTF-8 budget without splitting surrogate pairs', () => {
    // Given a PanelController and a single 280,000-byte chunk of 4-byte emoji code points
    const controller = new PanelController()
    const oversized = '\u{1F600}'.repeat(70_000)

    // When that chunk is appended to a tab screen
    controller.appendTerminalOutput('tab-big', oversized)
    const retained = controller.readTerminalOutput('tab-big')

    // Then the retained output stays within 256 KiB and preserves valid UTF-16 surrogate pairs
    expect(Buffer.byteLength(retained, 'utf8')).toBe(256 * 1024)
    expect(retained).toBe('\u{1F600}'.repeat((256 * 1024) / 4))
    expect(Buffer.from(retained, 'utf8').toString('utf8')).toBe(retained)
  })
})

describe('SSH challenge ownership (#1950)', () => {
  it('Operator answers only travel on the socket of the tab whose form is shown', () => {
    // Given a bound socket and a challenge form, each naming a tab
    // When the two are compared before a response is sent
    // Then only the same tab may put its answer on that socket
    expect(challengeBelongsToLink('tab-1', 'tab-1')).toBe(true)
    expect(challengeBelongsToLink('tab-1', 'tab-2')).toBe(false)
    expect(challengeBelongsToLink(undefined, 'tab-1')).toBe(false)
  })
})

/** A WebSocket stand-in whose opening is driven by the test. */
class FakeSocket {
  static instances: FakeSocket[] = []
  url: string
  sent: string[] = []
  /** Make the next send fail, the way a socket that dies mid-frame would. */
  throwOnSend = false
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  send(data: string): void {
    if (this.throwOnSend) throw new Error('send failed')
    this.sent.push(data)
  }
  close(): void { this.onclose?.() }
  open(): void { this.onopen?.() }
  fail(): void { this.onerror?.() }
  /** Deliver one host frame. */
  emit(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

describe('SSH background tab close (#1950)', () => {
  it('Operator closing a background tab sends the close frame on a short-lived attach', async () => {
    // Given a page whose terminal route can carry a socket
    const original = globalThis.WebSocket
    FakeSocket.instances = []
    globalThis.WebSocket = FakeSocket as never
    try {
      const api = new SshApi()

      // When the attach opens and the close frame is delivered
      const pending = api.closeTerminalSession('s-edge')
      FakeSocket.instances[0]!.open()

      // Then one close frame went out on that attach and it counts as closed
      expect(FakeSocket.instances[0]!.url).toContain('session=s-edge')
      expect(FakeSocket.instances[0]!.sent).toEqual(['{"type":"close"}'])
      expect(await pending).toBe(true)
    } finally {
      globalThis.WebSocket = original
    }
  })

  it('Operator closing a background tab never claims a close the host did not receive', async () => {
    // Given a page whose terminal route cannot open the socket
    const original = globalThis.WebSocket
    FakeSocket.instances = []
    globalThis.WebSocket = FakeSocket as never
    try {
      const api = new SshApi()

      // When the attach fails before it opens
      const pending = api.closeTerminalSession('s-ops')
      FakeSocket.instances[0]!.fail()

      // Then nothing was sent and the close is reported as not delivered
      expect(FakeSocket.instances[0]!.sent).toHaveLength(0)
      expect(await pending).toBe(false)
    } finally {
      globalThis.WebSocket = original
    }
  })

  it('Operator closing an expired session counts it as already closed', async () => {
    // Given a page whose socket opens but whose close frame cannot be sent
    const original = globalThis.WebSocket
    FakeSocket.instances = []
    globalThis.WebSocket = FakeSocket as never
    try {
      const api = new SshApi()

      // When the host answers the attach for an unknown session with its
      // "terminal session expired" exit frame
      const pending = api.closeTerminalSession('s-gone')
      const socket = FakeSocket.instances[0]!
      socket.throwOnSend = true
      socket.open()
      socket.emit({ type: 'exit', code: null, error: 'terminal session expired' })

      // Then nothing is running, so the session counts as closed
      expect(await pending).toBe(true)
    } finally {
      globalThis.WebSocket = original
    }
  })

  it('Operator closing a session that never answers gives up inside the bounded wait', async () => {
    // Given a socket that opens but swallows the close frame
    const original = globalThis.WebSocket
    FakeSocket.instances = []
    globalThis.WebSocket = FakeSocket as never
    vi.useFakeTimers()
    try {
      const api = new SshApi()

      // When the host never answers
      const pending = api.closeTerminalSession('s-quiet', 1000)
      const socket = FakeSocket.instances[0]!
      socket.throwOnSend = true
      socket.open()
      vi.advanceTimersByTime(1000)

      // Then the attempt is reported as not delivered instead of hanging
      expect(await pending).toBe(false)
    } finally {
      vi.useRealTimers()
      globalThis.WebSocket = original
    }
  })
})
