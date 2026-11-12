/**
 * A browser session the tests can talk to: a real {@link TabManager} and the
 * real {@link BrowserViewService} over the scripted transport.
 *
 * Only the process boundary is faked (no Chrome, no socket); everything above
 * it — tab creation, the ref map, action dispatch, broadcast, dispose order —
 * is the production code path, which is what makes these tests worth anything.
 *
 * @module tests/helpers/fake-browser
 */

import { BrowserViewService, type BrowserSession } from '../../src/host/service.ts'
import { TabManager } from '../../src/core/tabs.ts'
import { FakeTransport } from './fake-cdp.ts'

/** One raw snapshot node the fake page reports. */
const FAKE_NODES = [
  { tag: 'body', depth: 0, selector: 'body' },
  { tag: 'h1', depth: 1, selector: 'body > h1', text: 'ok', role: 'heading', name: 'ok' },
  { tag: 'button', depth: 1, selector: 'body > button', role: 'button', name: 'Go' },
]

/** What the fake session exposes to a test. */
export interface FakeBrowser {
  service: BrowserViewService
  transport: FakeTransport
  /** Whether the fake session was disposed. */
  disposed: () => boolean
  /** How many times a session was opened. */
  opens: () => number
}

/** What one fake browser session should behave like. */
export interface FakeBrowserOptions {
  /** Fail the launch with this error. */
  failLaunch?: () => Error | undefined
  /** Clock for action traces. @default () => 500 */
  now?: () => number
  /** Idle window the sweep reads, in days; absent means the sweep is off. */
  idleCloseDays?: () => number
  /**
   * Pin the emulated viewport, as the isolated session does.
   * Set it to false to model a tab adopted from a real browser.
   * @default true
   */
  pinViewport?: boolean
  /**
   * The CSS layout viewport the fake page reports when the viewport is not
   * pinned; the isolated session never asks.
   * @default { width: 1600, height: 1000 }
   */
  layoutViewport?: { width: number; height: number }
}

/**
 * Build a service wired to the scripted transport.
 * @param options - launch failure, clock, and whether the session pins its viewport.
 * @returns the service plus its test hooks.
 */
export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const transport = new FakeTransport()
  let tabCounter = 0
  let opens = 0
  let disposed = false

  transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${++tabCounter}` }))
  transport.responses.set('Target.attachToTarget', () => ({ sessionId: `session-${tabCounter}` }))
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  // Only an unpinned (adopted real-browser) tab ever asks for this; the answer
  // is the window-sized viewport the page really renders.
  const layoutViewport = options.layoutViewport ?? { width: 1600, height: 1000 }
  transport.responses.set('Page.getLayoutMetrics', {
    cssLayoutViewport: { clientWidth: layoutViewport.width, clientHeight: layoutViewport.height },
  })
  transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
    const expression = String(params.expression ?? '')
    if (expression.includes('document.querySelector')) {
      return { result: { value: { ok: true, x: 12, y: 34, tag: 'button', name: 'Go' } } }
    }
    if (expression.includes('JSON.stringify({ url')) {
      return { result: { value: JSON.stringify({ url: 'https://a.test/', title: 'A' }) } }
    }
    return { result: { value: { url: 'https://a.test/', title: 'A', nodes: FAKE_NODES, truncated: false } } }
  })
  transport.onSend = (call) => {
    // A navigation settles immediately in the fake, so no test waits on the
    // manager's load grace period.
    if (call.method === 'Page.navigate') transport.emit('Page.loadEventFired', {}, call.sessionId)
  }

  const service = new BrowserViewService({
    now: options.now ?? (() => 500),
    idleCloseDays: options.idleCloseDays,
    openSession: async (opts): Promise<BrowserSession> => {
      opens += 1
      const failure = options.failLaunch?.()
      if (failure !== undefined) throw failure
      const tabs = new TabManager({
        transport,
        jpegQuality: opts.jpegQuality,
        viewport: opts.viewport,
        now: options.now ?? (() => 500),
        pinViewport: options.pinViewport ?? true,
        onFrame: opts.onFrame,
        onTabsChanged: opts.onTabsChanged,
      })
      return {
        mode: 'isolated',
        transport,
        tabs,
        async dispose() { disposed = true },
      }
    },
  })

  return {
    service,
    transport,
    disposed: () => disposed,
    opens: () => opens,
  }
}
