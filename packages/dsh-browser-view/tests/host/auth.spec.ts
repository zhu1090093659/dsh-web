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
import { isAdmissionRejectionText, isHostRootUrl, isSameLoopbackOrigin } from '../../src/host/auth.ts'
import { BrowserViewService, type BrowserSession } from '../../src/host/service.ts'
import { TabManager } from '../../src/core/tabs.ts'
import { FakeTransport, type RecordedCall } from '../helpers/fake-cdp.ts'

/** Body text of the page `dsh web` serves without the launch token or cookie. */
const AUTH_PAGE_TEXT = 'dsh web authentication required; reopen the URL printed by dsh web.'

/** Body of the bare refusal a post-#8266 Host answers when route admission denies the request. */
const ADMISSION_REJECTION_TEXT = 'unauthorized'

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
  /** The host's own listener origin; omit it to model a host that has not bound. */
  hostOrigin?: string
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
    hostOrigin: options.hostOrigin === undefined ? undefined : () => options.hostOrigin,
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

  it('operator opens the GUI on a host whose route admission answers a bare refusal and one ticketed navigation replaces it', async () => {
    // Given a post-#8266 host that refuses the clean root with the bare admission body before its token exchange runs
    // When the operator navigates to the GUI root
    // Then the bare body is read as the challenge, exactly one token is minted and the ticketed page loads
    const browser = createAuthBrowser({
      hostOrigin: 'http://127.0.0.1:3080',
      resolve: url => url.includes('token=')
        ? { url: 'http://127.0.0.1:3080/', title: 'DeepSeek Harness', text: 'Conversations' }
        : { url, title: '401', text: ADMISSION_REJECTION_TEXT },
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(browser.tickets()).toEqual(['http://127.0.0.1:3080/'])
    expect(browser.navigations()).toEqual([
      'http://127.0.0.1:3080/',
      'http://127.0.0.1:3080/?token=process-token',
    ])
    expect(navigated.tab.title).toBe('DeepSeek Harness')
  })

  it('operator opens another local service that answers a bare refusal and no token is minted', async () => {
    // Given a different loopback port that answers the same generic refusal body
    // When the operator navigates to it
    // Then the page is another local service rather than this host, so nothing is re-ticketed
    const browser = createAuthBrowser({
      hostOrigin: 'http://127.0.0.1:3080',
      resolve: url => ({ url, title: '401', text: ADMISSION_REJECTION_TEXT }),
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:5173/')

    expect(browser.tickets()).toEqual([])
    expect(browser.navigations()).toEqual(['http://127.0.0.1:5173/'])
    expect(navigated.tab.title).toBe('401')
  })

  it('operator opens this host before its listener publishes an origin and the bare refusal is left alone', async () => {
    // Given a host that has not bound its listener origin yet
    // When the operator navigates to the GUI root and the answer is the bare refusal
    // Then the generic body cannot be attributed to this host, so no token is minted
    const browser = createAuthBrowser({
      resolve: url => ({ url, title: '401', text: ADMISSION_REJECTION_TEXT }),
      mintTicket: withTicket,
    })

    const navigated = await browser.service.navigate('session-a', 'http://127.0.0.1:3080/')

    expect(browser.tickets()).toEqual([])
    expect(browser.navigations()).toEqual(['http://127.0.0.1:3080/'])
    expect(navigated.tab.title).toBe('401')
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

describe('admission refusal detection', () => {
  it('operator loads a page that only says unauthorized and it is read as the admission refusal', () => {
    // Given the body a post-#8266 host answers when route admission denies the request
    // When the body is inspected as a possible challenge
    // Then the bare word matches, with surrounding whitespace tolerated
    expect(isAdmissionRejectionText(ADMISSION_REJECTION_TEXT)).toBe(true)
    expect(isAdmissionRejectionText('  unauthorized\n')).toBe(true)
  })

  it('operator loads an ordinary page that happens to contain the word and it is not an admission refusal', () => {
    // Given a real page whose text merely mentions the word
    // When the body is inspected as a possible challenge
    // Then only a body that is nothing but that word counts
    expect(isAdmissionRejectionText('Conversations')).toBe(false)
    expect(isAdmissionRejectionText('Error: unauthorized access is not allowed for this file')).toBe(false)
    expect(isAdmissionRejectionText('')).toBe(false)
  })

  it('operator navigates to this host and the same listener is recognized by protocol and port', () => {
    // Given the host's own published listener origin
    // When candidate URLs name the same listener, another port, or another scheme
    // Then only the same loopback listener matches
    expect(isSameLoopbackOrigin('http://127.0.0.1:3080/', 'http://127.0.0.1:3080')).toBe(true)
    expect(isSameLoopbackOrigin('http://localhost:3080/page', 'http://127.0.0.1:3080')).toBe(true)
    expect(isSameLoopbackOrigin('http://127.0.0.1:5173/', 'http://127.0.0.1:3080')).toBe(false)
    expect(isSameLoopbackOrigin('https://127.0.0.1:3080/', 'http://127.0.0.1:3080')).toBe(false)
    expect(isSameLoopbackOrigin('http://127.0.0.2:3080/', 'http://127.0.0.1:3080')).toBe(false)
  })

  it('operator navigates to a remote site and it never matches a loopback listener', () => {
    // Given a non-loopback host and a malformed origin
    // When the comparison runs
    // Then no remote authority is treated as this host
    expect(isSameLoopbackOrigin('https://example.test:3080/', 'http://127.0.0.1:3080')).toBe(false)
    expect(isSameLoopbackOrigin('not a url', 'http://127.0.0.1:3080')).toBe(false)
  })

  it('operator navigates to a deeper path and only the site root qualifies for the bare refusal', () => {
    // Given the token exchange answers only GET /, a bare refusal elsewhere cannot be cleared
    // When the candidate URLs are inspected
    // Then only the root path counts
    expect(isHostRootUrl('http://127.0.0.1:3080/')).toBe(true)
    expect(isHostRootUrl('http://127.0.0.1:3080/?x=1')).toBe(true)
    expect(isHostRootUrl('http://127.0.0.1:3080/api/health')).toBe(false)
    expect(isHostRootUrl('not a url')).toBe(false)
  })
})
