/**
 * Auth top-up tests: the single launch-token retry a loopback navigation to
 * DSH's own authentication page gets, the four situations where it must stay
 * out of the way, and the failure path that must never reach the caller.
 *
 * The page is scripted through the fake transport exactly like
 * tests/helpers/fake-browser.ts does, with two additions: the document text a
 * request results in, and whether the navigation carried the launch token.
 */

import { describe, expect, it } from 'vitest'
import { resolveAuthenticatedUrl, type AuthenticatedUrlContext } from '../../src/index.ts'
import { BrowserViewService, type BrowserSession } from '../../src/host/service.ts'
import { TabManager } from '../../src/core/tabs.ts'
import { FakeTransport, type RecordedCall } from '../helpers/fake-cdp.ts'

/** Body text of the page `dsh web` serves without the launch token or cookie. */
const AUTH_PAGE_TEXT = 'dsh web authentication required; reopen the URL printed by dsh web.'

/** The page one navigation request results in. */
interface ScriptedPage {
  url: string
  title: string
  text: string
}

/** How the fake GUI answers a navigation. */
interface AuthBrowserOptions {
  /** The document a request for `url` results in. */
  resolve: (url: string) => ScriptedPage
  /** The top-up seam; omit it to model a host that mounts no connection service. */
  mintTicket?: (url: string) => string
}

/** What a test needs from the scripted GUI. */
interface AuthBrowser {
  service: BrowserViewService
  transport: FakeTransport
  /** URLs the top-up asked the connection service to ticket, in order. */
  tickets: () => string[]
  /** URLs handed to `Page.navigate`, in order. */
  navigations: () => string[]
}

/**
 * Build a service over a scripted GUI page.
 * @param options - how the page answers and whether the token seam exists.
 * @returns the service plus its observation hooks.
 */
function createAuthBrowser(options: AuthBrowserOptions): AuthBrowser {
  const transport = new FakeTransport()
  const tickets: string[] = []
  let page: ScriptedPage = { url: 'about:blank', title: '', text: '' }
  let tabCounter = 0

  transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${++tabCounter}` }))
  transport.responses.set('Target.attachToTarget', () => ({ sessionId: `session-${tabCounter}` }))
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
    const expression = String(params.expression ?? '')
    if (expression.includes('innerText')) return { result: { value: page.text } }
    return { result: { value: JSON.stringify({ url: page.url, title: page.title }) } }
  })
  transport.onSend = (call: RecordedCall) => {
    // A navigation settles immediately in the fake so no test waits on the
    // tab manager's load grace period.
    if (call.method !== 'Page.navigate') return
    page = options.resolve(String(call.params.url))
    transport.emit('Page.loadEventFired', {}, call.sessionId)
  }

  const service = new BrowserViewService({
    authenticatedUrl: options.mintTicket === undefined
      ? undefined
      : (url: string) => {
        tickets.push(url)
        return options.mintTicket?.(url)
      },
    openSession: async (): Promise<BrowserSession> => {
      const tabs = new TabManager({ transport })
      return {
        mode: 'isolated',
        transport,
        tabs,
        async dispose() { await tabs.dispose() },
      }
    },
  })

  return {
    service,
    transport,
    tickets: () => tickets,
    // Opening a tab navigates it to about:blank first, which is not a request
    // any of these tests makes.
    navigations: () => transport.callsOf('Page.navigate')
      .map(call => String(call.params.url))
      .filter(url => url !== 'about:blank'),
  }
}

/** The launch-token URL DSH's connection service would mint for `url`. */
function withTicket(url: string): string {
  const ticketed = new URL(url)
  ticketed.searchParams.set('token', 'process-token')
  return ticketed.href
}

describe('auth top-up', () => {
  it('operator opens the GUI on loopback and one ticketed navigation replaces the auth page', async () => {
    // Given a GUI that answers the login URL with the DSH auth page and the ticketed URL with the real page
    // When the operator navigates to the GUI root
    // Then exactly one token was minted, the retry carried it, and the returned tab is the real page rather than the challenge
    const browser = createAuthBrowser({
      resolve: url => url.includes('token=')
        ? { url: 'http://127.0.0.1:3080/', title: 'DeepSeek Harness', text: 'Conversations' }
        : { url, title: '401', text: AUTH_PAGE_TEXT },
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(browser.tickets()).toEqual(['http://127.0.0.1:3080/'])
    expect(browser.navigations()).toEqual([
      'http://127.0.0.1:3080/',
      'http://127.0.0.1:3080/?token=process-token',
    ])
    expect(navigated.tab.url).toBe('http://127.0.0.1:3080/')
    expect(navigated.tab.title).toBe('DeepSeek Harness')
  })

  it('operator opens the GUI on a host with no connection service and the auth page stays without an error', async () => {
    // Given a GUI that always answers with the DSH auth page and a host that mounts no connection service
    // When the operator navigates to the GUI root
    // Then the navigation ran once, no token was asked for, and the challenge page is reported as it is
    const browser = createAuthBrowser({
      resolve: url => ({ url, title: '401', text: AUTH_PAGE_TEXT }),
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(browser.navigations()).toHaveLength(1)
    expect(browser.tickets()).toEqual([])
    expect(navigated.tab.title).toBe('401')
    expect(navigated.outcome.summary).toContain('http://127.0.0.1:3080/')
  })

  it('operator opens an ordinary loopback page and no token is ever minted', async () => {
    // Given a local dev server whose body carries no auth wording
    // When the operator navigates to it
    // Then the page loaded once and the connection service was never consulted
    const browser = createAuthBrowser({
      resolve: () => ({ url: 'http://127.0.0.1:5173/', title: 'Vite + React', text: 'Hello from the dev server' }),
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:5173/')

    expect(browser.navigations()).toEqual(['http://127.0.0.1:5173/'])
    expect(browser.tickets()).toEqual([])
    expect(navigated.tab.title).toBe('Vite + React')
  })

  it('operator opens a remote site that looks like the auth page and no token is minted', async () => {
    // Given a non-loopback site whose body reproduces the DSH auth wording
    // When the operator navigates to it
    // Then nothing is re-ticketed and the remote page is reported as loaded
    const browser = createAuthBrowser({
      resolve: url => ({ url, title: 'Authentication required', text: AUTH_PAGE_TEXT }),
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'https://example.test/')

    expect(browser.tickets()).toEqual([])
    expect(browser.navigations()).toEqual(['https://example.test/'])
    expect(navigated.tab.url).toBe('https://example.test/')
  })

  it('operator navigates to the auth page twice in one tab and each navigation retries exactly once', async () => {
    // Given a GUI whose token never clears the challenge, so every retry lands on the auth page again
    // When the same tab navigates to it twice
    // Then the first navigation produced one retry and stopped, and the second was allowed its own single retry
    const browser = createAuthBrowser({
      resolve: url => ({ url, title: '401', text: AUTH_PAGE_TEXT }),
      mintTicket: withTicket,
    })

    const first = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')
    expect(browser.navigations()).toHaveLength(2)

    const second = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(second.tab.id).toBe(first.tab.id)
    expect(browser.navigations()).toHaveLength(4)
    expect(browser.tickets()).toEqual(['http://127.0.0.1:3080/', 'http://127.0.0.1:3080/'])
  })

  it('operator opens the GUI when minting the token throws and the navigation result is untouched', async () => {
    // Given a connection service whose token request fails
    // When the operator navigates to the auth page on loopback
    // Then the failure is swallowed, no retry navigation happens, and the challenge page is reported
    const browser = createAuthBrowser({
      resolve: url => ({ url, title: '401', text: AUTH_PAGE_TEXT }),
      mintTicket: () => { throw new Error('the connection service is shutting down') },
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(browser.tickets()).toEqual(['http://127.0.0.1:3080/'])
    expect(browser.navigations()).toHaveLength(1)
    expect(navigated.tab.title).toBe('401')
  })
})

describe('resolveAuthenticatedUrl', () => {
  it('operator resolves legacy connection.authenticatedUrl when present', () => {
    // Given a legacy SDK cohort host whose connection service mints launch-token URLs directly
    const ctx: AuthenticatedUrlContext = {
      get: (name) => (name === 'connection'
        ? { authenticatedUrl: (baseUrl: string) => `${baseUrl}?token=legacy` }
        : undefined),
    }

    // When resolving the entry URL for a loopback base URL
    const resolved = resolveAuthenticatedUrl(ctx, 'http://127.0.0.1:4321/')

    // Then the legacy connection URL is returned directly
    expect(resolved).toBe('http://127.0.0.1:4321/?token=legacy')
  })

  it('operator collects peer-auth entry URLs from webserver/entry-url preferring open=true', () => {
    // Given a peer-auth host where connection exposes no authenticatedUrl and providers respond via webserver/entry-url
    const serverToken = { tag: 'webserver' }
    const ctx: AuthenticatedUrlContext = {
      webServer: serverToken,
      get: () => undefined,
      emit: (subject, event, baseUrl, entries) => {
        if (subject === serverToken && event === 'webserver/entry-url') {
          entries.push({ url: `${baseUrl}?token=secondary`, open: false })
          entries.push({ url: `${baseUrl}?token=primary`, open: true })
        }
      },
    }

    // When resolving the entry URL across registered providers
    const resolved = resolveAuthenticatedUrl(ctx, 'http://127.0.0.1:4321/')

    // Then the open=true provider URL takes priority
    expect(resolved).toBe('http://127.0.0.1:4321/?token=primary')
  })

  it('operator falls back to the first non-empty entry URL when none sets open=true', () => {
    // Given providers returning an empty URL followed by a regular entry without open=true
    const serverToken = { tag: 'webserver' }
    const ctx: AuthenticatedUrlContext = {
      get: (name) => (name === 'webServer' ? serverToken : undefined),
      emit: (_subject, _event, baseUrl, entries) => {
        entries.push({ url: '' })
        entries.push({ url: `${baseUrl}?token=fallback`, open: false })
      },
    }

    // When resolving the entry URL
    const resolved = resolveAuthenticatedUrl(ctx, 'http://127.0.0.1:4321/')

    // Then the first non-empty candidate URL is returned
    expect(resolved).toBe('http://127.0.0.1:4321/?token=fallback')
  })

  it('operator receives undefined when no entry URL exists or minting throws', () => {
    // Given both an empty peer-auth provider response and a throwing legacy connection
    const emptyCtx: AuthenticatedUrlContext = {
      webServer: {},
      get: () => undefined,
      emit: () => undefined,
    }
    const throwingCtx: AuthenticatedUrlContext = {
      get: () => ({ authenticatedUrl: () => { throw new Error('mint failed') } }),
    }

    // When resolving entry URLs against both contexts
    const emptyResolved = resolveAuthenticatedUrl(emptyCtx, 'http://127.0.0.1:4321/')
    const throwingResolved = resolveAuthenticatedUrl(throwingCtx, 'http://127.0.0.1:4321/')

    // Then both return undefined safely
    expect(emptyResolved).toBeUndefined()
    expect(throwingResolved).toBeUndefined()
  })
})
