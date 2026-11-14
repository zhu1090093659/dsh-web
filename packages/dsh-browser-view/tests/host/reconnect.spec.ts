/**
 * Session replacement after the transport closed: the next call drops the dead
 * session the way a settings change does and opens exactly one replacement —
 * never two at once, never with the dead session's bindings, pinned selection
 * or watched tab still attached, and never as a switch of browser mode.
 *
 * Both modes share that lifecycle because both wedge the same way: the
 * real-browser session is detached and reconnected, the isolated one has its
 * dead Chromium stopped and a fresh one launched. Everything above the scripted
 * transport (session lifecycle, bindings, broadcast, disposal order) is the
 * production code path.
 */

import { describe, expect, it } from 'vitest'
import { TabManager } from '../../src/core/tabs.ts'
import type { BrowserViewEvent } from '../../src/core/protocol.ts'
import {
  BrowserViewService,
  type BrowserMode,
  type BrowserSession,
  type BrowserViewSink,
  type OpenSessionOptions,
} from '../../src/host/service.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** One page the next opened session discovers. */
interface PageTarget {
  targetId: string
  type: string
  url: string
  title: string
}

/** One session the fake factory opened. */
interface OpenedSession {
  transport: FakeTransport
  disposed: boolean
  /**
   * Set when the session's dispose ran in isolated mode, where that dispose is
   * what terminates the Chromium this session launched.
   */
  launchedChromiumStopped: boolean
}

/** What browser source the harness should model. */
interface HarnessOptions {
  /** Source the service resolves. @default 'cdp' */
  mode?: BrowserMode
}

interface Harness {
  service: BrowserViewService
  /** The mode every factory call asked for, in order. */
  attempts: BrowserMode[]
  /** The sessions that were opened successfully, in order. */
  sessions: OpenedSession[]
  /** Make the next factory call fail with this error. */
  failNext(error: Error): void
  /** Pages the next opened session adopts during discovery. */
  adoptNext(targets: PageTarget[]): void
}

/** A service whose factory talks to a scripted transport per session. */
function harness(harnessOptions: HarnessOptions = {}): Harness {
  const mode: BrowserMode = harnessOptions.mode ?? 'cdp'
  const isolated = mode === 'isolated'
  const attempts: BrowserMode[] = []
  const sessions: OpenedSession[] = []
  let failure: Error | undefined
  let pendingTargets: PageTarget[] = []
  const service = new BrowserViewService({
    // The scripted factory never dials this endpoint; the port only has to be
    // a valid loopback configuration.
    resolveConfig: () => (isolated ? { mode: 'isolated' } : { mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
    openSession: async (options: OpenSessionOptions): Promise<BrowserSession> => {
      attempts.push(options.mode)
      const rejected = failure
      failure = undefined
      if (rejected !== undefined) throw rejected
      // Tab ids carry the session number, so a test can tell one session's tab
      // from another's even though each scripted transport counts from one.
      const index = sessions.length + 1
      let created = 0
      const transport = new FakeTransport()
      transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${index}-${++created}` }))
      transport.responses.set('Target.attachToTarget', (params: Record<string, unknown>) => ({ sessionId: `cdp-${String(params.targetId)}` }))
      transport.responses.set('Target.getTargets', { targetInfos: pendingTargets })
      transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
      transport.onSend = call => {
        // A created tab navigates to about:blank and waits for its load; the
        // scripted browser settles it at once instead of after the grace period.
        if (call.method === 'Page.navigate') {
          if (typeof call.params.url === 'string') {
            transport.emit('Page.frameNavigated', { frame: { url: call.params.url } }, call.sessionId)
          }
          transport.emit('Page.loadEventFired', {}, call.sessionId)
        }
      }
      pendingTargets = []
      const tabs = new TabManager({
        transport,
        jpegQuality: options.jpegQuality,
        viewport: options.viewport,
        // The isolated session pins its own viewport and owns its tabs; the real
        // one adopts existing pages and never overrides a real viewport.
        pinViewport: isolated,
        discoverTargets: !isolated,
        onFrame: options.onFrame,
        onTabsChanged: options.onTabsChanged,
      })
      if (!isolated) await tabs.discoverExistingTabs()
      const opened: OpenedSession = { transport, disposed: false, launchedChromiumStopped: false }
      sessions.push(opened)
      return {
        mode,
        transport,
        tabs,
        async dispose() {
          opened.disposed = true
          if (isolated) opened.launchedChromiumStopped = true
          await tabs.dispose()
          transport.close()
        },
      }
    },
  })
  return {
    service,
    attempts,
    sessions,
    failNext: error => { failure = error },
    adoptNext: targets => { pendingTargets = targets },
  }
}

/** A sink that records every event it is handed. */
function recordingSink(): { sink: BrowserViewSink; events: BrowserViewEvent[] } {
  const events: BrowserViewEvent[] = []
  return { events, sink: { send: event => { events.push(event) }, close: () => undefined } }
}

describe('closed transport replacement', () => {
  it('operator browser restarted and the next tool call opens a fresh session instead of failing', async () => {
    // Given a real-browser session with one bound tab
    const h = harness()
    const first = await h.service.ensureTab('session-a')
    expect(h.sessions).toHaveLength(1)

    // When the browser goes away and the next tool call runs
    h.sessions[0]?.transport.close()
    const recovered = await h.service.ensureTab('session-a')

    // Then the dead session was detached, not closed, and a replacement served the call
    expect(h.sessions).toHaveLength(2)
    expect(h.sessions[0]?.disposed).toBe(true)
    expect(h.sessions[0]?.transport.callsOf('Target.closeTarget')).toHaveLength(0)
    expect(h.sessions[1]?.transport.callsOf('Target.createTarget')).toHaveLength(1)
    expect(recovered.id).not.toBe(first.id)
    expect(h.service.state()).toMatchObject({ mode: 'cdp', running: true })
  })

  it('operator runs two calls at once after the socket died and only one replacement opens', async () => {
    // Given a live session whose transport then closed
    const h = harness()
    await h.service.listTabs()
    h.sessions[0]?.transport.close()

    // When two calls run concurrently
    const [first, second] = await Promise.all([h.service.listTabs(), h.service.listTabs()])

    // Then one replacement was opened and both calls read it
    expect(h.sessions).toHaveLength(2)
    expect(first).toEqual({ tabs: [], activeTabId: null })
    expect(second).toEqual({ tabs: [], activeTabId: null })
  })

  it('operator browser is gone for good and the call reports it without falling back to isolated', async () => {
    // Given a live session that went away and an endpoint that refuses the next connection
    const h = harness()
    const panel = recordingSink()
    await h.service.ensureTab('session-a')
    h.service.attach(panel.sink)
    h.sessions[0]?.transport.close()
    h.failNext(new Error('connection refused'))

    // When the next tool call runs
    await expect(h.service.ensureTab('session-a')).rejects.toThrow('connection refused')

    // Then the failure is reported for the configured real browser and no isolated session was requested
    expect(h.service.state()).toMatchObject({ mode: 'cdp', running: false, message: 'connection refused' })
    expect(panel.events.some(event => event.kind === 'error' && event.code === 'browser-connect-failed' && event.message === 'connection refused')).toBe(true)
    expect(h.attempts).toEqual(['cdp', 'cdp'])
  })

  it('operator had a tab bound and pinned before the socket died and the recovery reuses neither', async () => {
    // Given a session whose tab is bound to the agent and pinned in the panel
    const h = harness()
    const first = await h.service.ensureTab('session-a')
    const panel = recordingSink()
    h.service.attach(panel.sink)
    await h.service.handleCommand(panel.sink, { v: 1, kind: 'select-tab', tabId: first.id })

    // When the transport closes and the replacement adopts a page with the same tab id
    h.sessions[0]?.transport.close()
    h.adoptNext([{ targetId: first.id, type: 'page', url: 'https://a.test/', title: 'A' }])
    const recovered = await h.service.ensureTab('session-a')

    // Then the stale binding is not reused, a new tab is opened, and the panel follows it
    expect(h.sessions[1]?.transport.callsOf('Target.createTarget')).toHaveLength(1)
    expect(recovered.id).not.toBe(first.id)
    expect(h.service.state().activeTabId).toBe(recovered.id)
  })
})

describe('isolated browser replacement', () => {
  it('operator isolated Chromium exited and the next call stops it and launches a replacement', async () => {
    // Given an isolated session whose Chromium went away
    const h = harness({ mode: 'isolated' })
    const first = await h.service.ensureTab('session-a')
    expect(h.sessions).toHaveLength(1)
    h.sessions[0]?.transport.close()

    // When the next tool call runs
    const recovered = await h.service.ensureTab('session-a')

    // Then the dead session's Chromium was stopped through its own dispose and exactly one fresh one was launched
    expect(h.sessions).toHaveLength(2)
    expect(h.sessions[0]?.disposed).toBe(true)
    expect(h.sessions[0]?.launchedChromiumStopped).toBe(true)
    expect(h.sessions[1]?.disposed).toBe(false)
    expect(h.attempts).toEqual(['isolated', 'isolated'])
    expect(h.sessions[1]?.transport.callsOf('Target.createTarget')).toHaveLength(1)
    expect(recovered.id).not.toBe(first.id)
    expect(h.service.state()).toMatchObject({ mode: 'isolated', running: true })
  })

  it('operator recycles a reused session and replays in-flight when a mid-command write closes the transport (#2051)', async () => {
    // Given an isolated session that looks connected until navigate triggers a socket write failure
    const h = harness({ mode: 'isolated' })
    await h.service.ensureTab('session-a')
    const first = h.sessions[0]!
    const prevOnSend = first.transport.onSend
    first.transport.onSend = (call) => {
      if (call.method === 'Page.navigate' && call.params.url === 'https://heal.test/') {
        first.transport.close()
        throw new Error('the DevTools socket write failed: EPIPE')
      }
      prevOnSend?.(call)
    }

    // When navigate runs once on the stale session
    const result = await h.service.navigate('session-a', 'https://heal.test/')

    // Then the dead session is disposed, a replacement launches, and the navigation succeeds on the first call
    expect(h.sessions).toHaveLength(2)
    expect(first.disposed).toBe(true)
    expect(h.attempts).toEqual(['isolated', 'isolated'])
    expect(result.outcome.summary).toContain('heal.test')
    expect(result.tab.url).toBe('https://heal.test/')
  })

  it('operator retries isolated startup once on a transient launch failure (#2051)', async () => {
    // Given an isolated browser where the first launch fails transiently on a port lock
    const h = harness({ mode: 'isolated' })
    h.failNext(new Error('Chrome exited before its DevTools endpoint came up'))

    // When the first tool call triggers startup
    const tab = await h.service.ensureTab('session-a')

    // Then isolated mode recovers automatically on the second attempt without failing the call
    expect(h.attempts).toEqual(['isolated', 'isolated'])
    expect(h.sessions).toHaveLength(1)
    expect(tab.id).toBe('tab-1-1')
    expect(h.service.state()).toMatchObject({ mode: 'isolated', running: true })
  })

  it('operator sees running: false and clears dead isolated handle on listTabs without cold-starting (#2051)', async () => {
    // Given an isolated session whose transport then died cleanly
    const h = harness({ mode: 'isolated' })
    await h.service.ensureTab('session-a')
    expect(h.service.running).toBe(true)
    expect(h.service.state().running).toBe(true)

    // When the transport closes
    h.sessions[0]?.transport.close()

    // Then state reports stopped immediately, and listTabs drops the zombie without launching a new Chrome
    expect(h.service.running).toBe(false)
    expect(h.service.state()).toMatchObject({ mode: 'isolated', running: false, tabs: [], activeTabId: null })
    expect(await h.service.listTabs()).toEqual({ tabs: [], activeTabId: null })
    expect(h.sessions).toHaveLength(1)
    expect(h.sessions[0]?.disposed).toBe(true)
  })
})
