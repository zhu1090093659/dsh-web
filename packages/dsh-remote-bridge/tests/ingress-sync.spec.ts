/**
 * Update-only Cloudflare ingress sync (issue #1948).
 *
 * Two layers are pinned here. The pure plan must prove that the document it
 * returns differs from the one it read at exactly one place — the matched
 * rule's `service` — and must return no document at all for every shape it
 * cannot prove that about (missing, duplicated, wildcard, non-array ingress, no
 * catch-all, a service it cannot retarget). The runner must read once on a
 * healthy start, write only a proven drift, stop on an auth or shape refusal,
 * bound its retries, and never rewrite after a conflicting read-back. Every
 * request goes through an injected seam, so no test can reach a real API.
 */
import { describe, expect, it } from 'vitest'
import {
  CLOUDFLARE_API_ORIGIN,
  IngressSync,
  configOfEnvelope,
  defaultIngressFetch,
  errorsOfEnvelope,
  hostnameOf,
  ingressConfigUrl,
  ingressInputOf,
  isRetargetableHost,
  livePortOf,
  planIngressUpdate,
  serviceWithPort,
  withoutTargetService,
  type IngressHttpRequest,
  type IngressHttpResponse,
  type IngressSyncFrame,
} from '../src/host/ingress-sync.ts'

/** The public hostname the named tunnel serves in these tests. */
const HOSTNAME = 'dsh.example.com'
/** The account id the fake tunnel belongs to. */
const ACCOUNT = 'acct-0123456789abcdef'
/** The named tunnel id (never a run token). */
const TUNNEL = '11111111-2222-3333-4444-555555555555'
/** A distinctive credential, so a leak is easy to spot. */
const TOKEN = 'cf-api-token-must-never-leak'

/**
 * One tunnel configuration document in the shape the update-only contract
 * supports: two named rules, a catch-all, and a second top-level key that the
 * plan must leave untouched.
 * @param service - the service string of the target rule.
 * @param ingress - replaced ingress list, for the refusal cases.
 * @returns the document.
 */
function documentWith(service: string, ingress?: unknown[]): Record<string, unknown> {
  return {
    ingress: ingress ?? [
      { hostname: 'other.example.com', service: 'http://127.0.0.1:9999' },
      { hostname: HOSTNAME, service, path: '^/api', originRequest: { httpHostHeader: HOSTNAME } },
      { service: 'http_status:404' },
    ],
    'warp-routing': { enabled: false },
  }
}

/** One API envelope in the shape Cloudflare answers with. */
function envelope(config: unknown, errors: unknown[] = []): Record<string, unknown> {
  return { success: errors.length === 0, result: config === undefined ? {} : { config }, errors }
}

/** A timer double whose debounce and backoff fire immediately. */
const flushTimer = {
  setTimeout: (fn: () => void, _ms: number): unknown => { fn(); return 0 },
  clearTimeout: (_handle: unknown): void => undefined,
}

/** One recorded call list plus the seam that fills it. */
interface Api {
  calls: IngressHttpRequest[]
  fetch: (request: IngressHttpRequest) => Promise<IngressHttpResponse>
}

/**
 * Build a fake Cloudflare API.
 * @param handler - answers one request by call index (0-based).
 * @returns the seam and the calls it recorded.
 */
function makeApi(handler: (request: IngressHttpRequest, index: number) => IngressHttpResponse | Promise<IngressHttpResponse>): Api {
  const calls: IngressHttpRequest[] = []
  return {
    calls,
    fetch: async (request) => {
      calls.push(request)
      return await handler(request, calls.length - 1)
    },
  }
}

/** The frames one runner emitted. */
interface Harness {
  runner: IngressSync
  frames: IngressSyncFrame[]
}

/**
 * Build a runner over a fake API with immediate timers.
 * @param api - the fake API.
 * @param now - the fake clock.
 * @param lanHosts - this machine's addresses; empty by default, so no case can
 *   depend on the NICs of the machine running the suite.
 * @returns the runner and its emitted frames.
 */
function makeRunner(
  api: Api,
  now: () => number = () => 1_000,
  lanHosts: () => readonly string[] = () => [],
): Harness {
  const frames: IngressSyncFrame[] = []
  const runner = new IngressSync({
    fetch: api.fetch,
    timer: flushTimer,
    debounceMs: 0,
    retryBaseMs: 0,
    onFrame: (frame) => { frames.push(frame) },
    now,
    lanHosts,
  })
  return { runner, frames }
}

/** A timer double whose callbacks fire only when a test asks them to. */
interface ManualTimer {
  setTimeout(fn: () => void, ms: number): number // test-standards-allow: no-arbitrary-sleep — injectable timer signature, not a wall-clock sleep
  clearTimeout(handle: unknown): void
  /** Fire the oldest queued callback and let its async continuation run. */
  fire(): Promise<void>
  /** Callbacks still queued. */
  readonly pending: number
  /** Handles a clearTimeout was called with. */
  readonly cleared: number[]
}

/** Build a manual timer, for the cases that must act while a wait is pending. */
function manualTimer(): ManualTimer {
  const queue: Array<{ id: number; fn: () => void }> = []
  const cleared: number[] = []
  let next = 1
  return {
    setTimeout(fn: () => void): number { // test-standards-allow: no-arbitrary-sleep — injectable timer factory, not a wall-clock sleep
      const id = next
      next += 1
      queue.push({ id, fn })
      return id
    },
    clearTimeout(handle: unknown): void {
      cleared.push(Number(handle))
      const index = queue.findIndex(item => item.id === Number(handle))
      if (index >= 0) queue.splice(index, 1)
    },
    async fire(): Promise<void> {
      const item = queue.shift()
      item?.fn()
      // A macrotask boundary: every microtask the fired callback started runs.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) // test-standards-allow: no-arbitrary-sleep — one macrotask boundary so the manual timer's continuations settle, not a timing assertion
    },
    get pending(): number {
      return queue.length
    },
    get cleared(): number[] {
      return cleared
    },
  }
}

/** One schedule input that is configured and bound. */
function input(port: number | undefined, overrides: Partial<Parameters<IngressSync['schedule']>[0]> = {}): Parameters<IngressSync['schedule']>[0] {
  return {
    enabled: true,
    hostname: HOSTNAME,
    port,
    token: TOKEN,
    accountId: ACCOUNT,
    tunnelId: TUNNEL,
    ...overrides,
  }
}

describe('serviceWithPort', () => {
  it('operator retargets only the port of an http(s) origin', () => {
    // Given a loopback origin service and the port the host actually bound
    // When it is retargeted
    // Then the host, path and query survive and only the port digit moves
    expect(serviceWithPort('http://127.0.0.1:3080/api?x=1', 4123)).toBe('http://127.0.0.1:4123/api?x=1')
    expect(serviceWithPort('http://localhost:3080', 3081)).toBe('http://localhost:3081')
    expect(serviceWithPort('https://box.local:443', 8443)).toBe('https://box.local:8443')
  })

  it('operator keeps an IPv6 literal and userinfo intact', () => {
    // Given IPv6 and userinfo service forms
    // When the port is retargeted
    // Then the literal brackets and credentials survive unchanged
    expect(serviceWithPort('http://[::1]:3080', 4000)).toBe('http://[::1]:4000')
    expect(serviceWithPort('http://user:pw@127.0.0.1:3080', 4000)).toBe('http://user:pw@127.0.0.1:4000')
  })

  it('operator answers the input when the port already matches', () => {
    // Given a service whose port is already current
    // When the same port is retargeted
    // Then the original string is returned without a rewrite
    expect(serviceWithPort('http://127.0.0.1:3080', 3080)).toBe('http://127.0.0.1:3080')
  })

  it('operator refuses a service it cannot retarget', () => {
    // Given a service that is not an http(s) origin, or a port that is not one
    // When it is retargeted
    // Then the answer is undefined instead of a guess
    expect(serviceWithPort('http_status:404', 3080)).toBeUndefined()
    expect(serviceWithPort('tcp://127.0.0.1:3080', 3080)).toBeUndefined()
    expect(serviceWithPort('ssh://127.0.0.1:22', 3080)).toBeUndefined()
    expect(serviceWithPort('http://', 3080)).toBeUndefined()
    expect(serviceWithPort('http://127.0.0.1:3080', 0)).toBeUndefined()
    expect(serviceWithPort('http://127.0.0.1:3080', 65_536)).toBeUndefined()
    expect(serviceWithPort('http://127.0.0.1:3080', 30.5)).toBeUndefined()
  })
})

describe('hostnameOf', () => {
  it('operator lower-cases the hostname and drops the port', () => {
    // Given public URLs with mixed-case hosts and explicit ports
    // When hostnames are derived
    // Then only the lower-cased host names remain
    expect(hostnameOf('https://DSH.Example.com:8443')).toBe('dsh.example.com')
    expect(hostnameOf('http://127.0.0.1:3080')).toBe('127.0.0.1')
  })

  it('operator refuses a value that cannot name one exact host', () => {
    // Given values a named tunnel hostname cannot be read from
    // When the hostname is derived
    // Then nothing matches: a wildcard, another scheme and garbage are refused
    expect(hostnameOf(undefined)).toBeUndefined()
    expect(hostnameOf('')).toBeUndefined()
    expect(hostnameOf('dsh.example.com')).toBeUndefined()
    expect(hostnameOf('ftp://dsh.example.com')).toBeUndefined()
    expect(hostnameOf('https://*.example.com')).toBeUndefined()
  })
})

describe('planIngressUpdate', () => {
  it('operator plans one write that changes only the target rule service', () => {
    // Given a tunnel document whose target rule points at an old port
    const doc = documentWith('http://127.0.0.1:3080')
    // When the plan is made for the bound port
    const plan = planIngressUpdate(doc, { hostname: HOSTNAME, port: 4321 })
    // Then it is one write, and stripping the one key it owns leaves the rest
    // of the document byte-identical to what was read
    expect(plan.outcome).toBe('apply')
    if (plan.outcome !== 'apply') return
    expect(plan.ruleIndex).toBe(1)
    expect(plan.ruleCount).toBe(3)
    expect(plan.from).toBe('http://127.0.0.1:3080')
    expect(plan.to).toBe('http://127.0.0.1:4321')
    expect(withoutTargetService(doc, plan.ruleIndex)).toBe(withoutTargetService(plan.document, plan.ruleIndex))
    expect(JSON.stringify(plan.document)).toBe(JSON.stringify(documentWith('http://127.0.0.1:4321')))
  })

  it('operator proves the untouched rule and top-level key survive verbatim', () => {
    // Given a document carrying another hostname rule, a catch-all and a
    // second top-level key
    const doc = documentWith('http://127.0.0.1:3080')
    const sourceRules = doc.ingress as Record<string, unknown>[]
    const plan = planIngressUpdate(doc, { hostname: HOSTNAME, port: 4321 })
    if (plan.outcome !== 'apply') throw new Error('expected an apply plan')
    const next = plan.document as { ingress: Record<string, unknown>[]; 'warp-routing': unknown }
    // When the written document is inspected
    // Then the other rule, the catch-all and the top-level key are untouched
    expect(next.ingress[0]).toEqual(sourceRules[0])
    expect(next.ingress[2]).toEqual({ service: 'http_status:404' })
    expect(next['warp-routing']).toEqual({ enabled: false })
    expect(next.ingress).toHaveLength(3)
  })

  it('operator reads an already-current rule as no work at all', () => {
    // Given a rule that already names the bound port
    // When the plan is made
    // Then it reports unchanged and carries no document to write
    const plan = planIngressUpdate(documentWith('http://127.0.0.1:3080'), { hostname: HOSTNAME, port: 3080 })
    expect(plan.outcome).toBe('unchanged')
    expect('document' in plan).toBe(false)
  })

  it('operator refuses every shape it cannot prove safe, and offers no document', () => {
    // Given documents outside the supported shape
    const cases: Array<{ name: string; config: unknown; code: string }> = [
      { name: 'a missing ingress list', config: { 'warp-routing': {} }, code: 'config-shape' },
      { name: 'a non-array ingress', config: { ingress: 'http://127.0.0.1:3080' }, code: 'config-shape' },
      { name: 'an empty ingress list', config: { ingress: [] }, code: 'no-catch-all' },
      { name: 'a rule that is not an object', config: { ingress: [HOSTNAME] }, code: 'rule-shape' },
      {
        name: 'a wildcard rule',
        config: { ingress: [{ hostname: '*.example.com', service: 'http://127.0.0.1:3080' }, { service: 'http_status:404' }] },
        code: 'wildcard',
      },
      {
        name: 'no rule for the hostname',
        config: { ingress: [{ hostname: 'other.example.com', service: 'http://127.0.0.1:3080' }, { service: 'http_status:404' }] },
        code: 'missing',
      },
      {
        name: 'two rules for the hostname',
        config: {
          ingress: [
            { hostname: HOSTNAME, service: 'http://127.0.0.1:3080' },
            { hostname: HOSTNAME.toUpperCase(), service: 'http://127.0.0.1:3090' },
            { service: 'http_status:404' },
          ],
        },
        code: 'duplicate',
      },
      {
        name: 'no catch-all',
        config: { ingress: [{ hostname: HOSTNAME, service: 'http://127.0.0.1:3080' }] },
        code: 'no-catch-all',
      },
      {
        name: 'no service string',
        config: { ingress: [{ hostname: HOSTNAME }, { service: 'http_status:404' }] },
        code: 'service-shape',
      },
      {
        name: 'a service this sync cannot retarget',
        config: { ingress: [{ hostname: HOSTNAME, service: 'tcp://127.0.0.1:3080' }, { service: 'http_status:404' }] },
        code: 'service-shape',
      },
    ]
    for (const scenario of cases) {
      // When the plan is made
      const plan = planIngressUpdate(scenario.config, { hostname: HOSTNAME, port: 4321 })
      // Then it is a conflict with the named reason and nothing to write
      expect(plan.outcome, scenario.name).toBe('conflict')
      if (plan.outcome !== 'conflict') continue
      expect(plan.code, scenario.name).toBe(scenario.code)
      expect('document' in plan, scenario.name).toBe(false)
    }
  })

  it('operator matches the hostname case-insensitively without rewriting it', () => {
    // Given a rule whose hostname is upper-cased in the dashboard
    const doc = documentWith('http://127.0.0.1:3080', [
      { hostname: HOSTNAME.toUpperCase(), service: 'http://127.0.0.1:3080' },
      { service: 'http_status:404' },
    ])
    // When the plan is made for the lower-cased hostname
    const plan = planIngressUpdate(doc, { hostname: HOSTNAME, port: 4321 })
    // Then the one thing that changes is still the service string
    if (plan.outcome !== 'apply') throw new Error('expected an apply plan')
    const next = plan.document as { ingress: Record<string, unknown>[] }
    expect(next.ingress[0]?.hostname).toBe(HOSTNAME.toUpperCase())
    expect(next.ingress[0]?.service).toBe('http://127.0.0.1:4321')
  })
})

describe('API envelopes', () => {
  it('operator reads the config out of the answer and nothing out of a wrong shape', () => {
    // Given valid and malformed API envelopes
    // When the configuration is extracted
    // Then only the valid config object survives
    expect(configOfEnvelope(envelope({ ingress: [] }))).toEqual({ ingress: [] })
    expect(configOfEnvelope({ success: true, result: {} })).toBeUndefined()
    expect(configOfEnvelope({ result: { config: [] } })).toBeUndefined()
    expect(configOfEnvelope('nope')).toBeUndefined()
    expect(configOfEnvelope(undefined)).toBeUndefined()
  })

  it('operator joins the API error messages for the audit frame', () => {
    // Given envelopes carrying API error messages
    // When the messages are read for an audit frame
    // Then they are joined in order and malformed envelopes yield nothing
    expect(errorsOfEnvelope(envelope(undefined, [{ code: 10000, message: 'Authentication error' }]))).toBe('Authentication error')
    expect(errorsOfEnvelope(envelope(undefined, [{ message: 'a' }, { message: 'b' }]))).toBe('a b')
    expect(errorsOfEnvelope(envelope(undefined))).toBeUndefined()
    expect(errorsOfEnvelope('nope')).toBeUndefined()
  })

  it('operator addresses the one tunnel configuration endpoint', () => {
    // Given one account and tunnel id
    // When the configuration URL is built
    // Then it addresses that tunnel's configurations resource
    expect(ingressConfigUrl(ACCOUNT, TUNNEL)).toBe(`${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}/configurations`)
  })

  it('operator refuses to send the token outside api.cloudflare.com without any network call', async () => {
    // Given the default seam and a URL another host would receive
    // When it is called
    // Then it rejects before fetch runs, so the credential cannot leave
    await expect(defaultIngressFetch({
      method: 'GET',
      url: 'https://example.com/client/v4/accounts/x/cfd_tunnel/y/configurations',
      headers: { authorization: `Bearer ${TOKEN}` },
    })).rejects.toThrow(/api\.cloudflare\.com/)
  })
})

describe('ingressInputOf', () => {
  /** One resolved-settings slice that would run the sync. */
  const settings = {
    enabled: true,
    ingressSync: true,
    autoTunnel: false,
    publicBaseUrl: 'https://DSH.example.com/',
    cfApiToken: TOKEN,
    cfAccountId: ACCOUNT,
    cfTunnelId: TUNNEL,
  }

  it('operator arms the sync from the resolved settings and derives the hostname', () => {
    // Given the master switch, the ingress toggle and the three fields
    // When the settings are adapted for the bound port
    // Then the hostname comes from publicBaseUrl and the port passes through
    expect(ingressInputOf(settings, 4321)).toEqual({
      enabled: true,
      hostname: 'dsh.example.com',
      port: 4321,
      token: TOKEN,
      accountId: ACCOUNT,
      tunnelId: TUNNEL,
    })
  })

  it('operator stays off unless the master switch and the ingress toggle are both on', () => {
    // Given one switch missing at a time
    // When the settings are adapted
    // Then the sync is off, so no request can be made
    expect(ingressInputOf({ ...settings, enabled: false }, 4321).enabled).toBe(false)
    expect(ingressInputOf({ ...settings, ingressSync: false }, 4321).enabled).toBe(false)
    expect(ingressInputOf({ ...settings, ingressSync: undefined }, 4321).enabled).toBe(false)
  })

  it('operator never treats the quick tunnel as a named-tunnel target', () => {
    // Given the quick tunnel on, which mints its own hostname and owns the base
    // When the settings are adapted
    // Then there is no sync target: the switch reads as off
    expect(ingressInputOf({ ...settings, autoTunnel: true }, 4321).enabled).toBe(false)
  })

  it('operator reports blank fields as missing so the frame names them', () => {
    // Given a copy-pasted field that is only whitespace
    const input = ingressInputOf({ ...settings, cfApiToken: '   ', cfAccountId: '', cfTunnelId: undefined }, 4321)
    // When the input is read
    // Then each blank credential resolves to undefined instead of an empty value
    expect(input.token).toBeUndefined()
    expect(input.accountId).toBeUndefined()
    expect(input.tunnelId).toBeUndefined()
  })

  it('operator reports an unusable public base as no hostname', () => {
    // Given a bare host and a wildcard, neither of which names one exact rule
    // When the settings are adapted
    // Then no hostname is matched and the frame will say so
    expect(ingressInputOf({ ...settings, publicBaseUrl: 'dsh.example.com' }, 4321).hostname).toBeUndefined()
    expect(ingressInputOf({ ...settings, publicBaseUrl: 'https://*.example.com' }, 4321).hostname).toBeUndefined()
  })
})

describe('IngressSync', () => {
  it('operator makes no request while the switch is off', async () => {
    // Given a configured runner and the switch off
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner, frames } = makeRunner(api)
    // When it is scheduled
    runner.schedule(input(3080, { enabled: false }))
    await runner.settled()
    // Then nothing is read, nothing is written, and the frame says off
    expect(api.calls).toHaveLength(0)
    expect(runner.frame.state).toBe('off')
    expect(frames.at(-1)?.state).toBe('off')
  })

  it('operator waits with no request until the listener binds, then reads once', async () => {
    // Given a runner scheduled before the web server port exists
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    runner.schedule(input(undefined))
    await runner.settled()
    // Then it waits and makes no request, and the port-settle re-plan delivers
    // the port, after which one read is enough because nothing drifted
    expect(api.calls).toHaveLength(0)
    expect(runner.frame.state).toBe('waiting')
    // When the listener later binds a real port
    runner.schedule(input(3080))
    await runner.settled()
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.method).toBe('GET')
    expect(runner.frame.state).toBe('applied')
    expect(runner.frame.changed).toBe(false)
  })

  it('operator reports the missing settings instead of calling an API', async () => {
    // Given a runner with no token, account id, or tunnel id
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    // When the sync is scheduled without the required settings
    runner.schedule(input(3080, { token: undefined, accountId: undefined, tunnelId: undefined }))
    await runner.settled()
    // Then it refuses the configuration and never calls the API
    expect(api.calls).toHaveLength(0)
    expect(runner.frame.state).toBe('failed')
    expect(runner.frame.code).toBe('not-configured')
    expect(runner.frame.detail).toContain('cfApiToken')
    expect(runner.frame.detail).toContain('cfAccountId')
    expect(runner.frame.detail).toContain('cfTunnelId')
  })

  it('operator reports a missing hostname instead of calling an API', async () => {
    // Given a runner whose public hostname is absent
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    // When the sync is scheduled without a hostname
    runner.schedule(input(3080, { hostname: undefined }))
    await runner.settled()
    // Then it reports the missing hostname and makes no request
    expect(api.calls).toHaveLength(0)
    expect(runner.frame.state).toBe('failed')
    expect(runner.frame.code).toBe('hostname')
  })

  it('operator writes the one drifted service, then reads the document back', async () => {
    // Given a remote rule pointing at the old port
    const api = makeApi((_request, index) => {
      if (index === 0) return { status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }
      if (index === 1) return { status: 200, body: envelope(documentWith('http://127.0.0.1:4321')) }
      return { status: 200, body: envelope(documentWith('http://127.0.0.1:4321')) }
    })
    const { runner } = makeRunner(api)
    // When the sync runs for the bound port
    runner.schedule(input(4321))
    await runner.settled()
    // Then the sequence is GET, PUT, GET
    expect(api.calls.map(call => call.method)).toEqual(['GET', 'PUT', 'GET'])
    // And the PUT carries the whole config with exactly one service changed
    const body = JSON.parse(api.calls[1]?.body ?? '{}') as { config: Record<string, unknown> }
    expect(JSON.stringify(body.config)).toBe(JSON.stringify(documentWith('http://127.0.0.1:4321')))
    // And the frame says what moved
    expect(runner.frame.state).toBe('applied')
    expect(runner.frame.changed).toBe(true)
    expect(runner.frame.previousService).toBe('http://127.0.0.1:3080')
    expect(runner.frame.service).toBe('http://127.0.0.1:4321')
    expect(runner.frame.ruleIndex).toBe(1)
    expect(runner.frame.ruleCount).toBe(3)
  })

  it('operator sends the token only to the Cloudflare API, and never into a frame', async () => {
    // Given a drift that needs one write
    const api = makeApi((_request, index) => ({
      status: 200,
      body: envelope(documentWith(index === 0 ? 'http://127.0.0.1:3080' : 'http://127.0.0.1:4321')),
    }))
    const { runner, frames } = makeRunner(api)
    // When the drifted sync runs
    runner.schedule(input(4321))
    await runner.settled()
    // Then every call goes to api.cloudflare.com with the token in the header
    for (const call of api.calls) {
      expect(call.url.startsWith(`${CLOUDFLARE_API_ORIGIN}/`)).toBe(true)
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
    }
    // And no frame, detail, or error string carries the credential
    expect(JSON.stringify(frames)).not.toContain(TOKEN)
    expect(frames.length).toBeGreaterThan(0)
  })

  it('operator stops on an auth refusal and does not retry it', async () => {
    // Given APIs that answer 401 and 403
    const unauthorized = makeApi(() => ({ status: 401, body: envelope(undefined, [{ message: 'Authentication error' }]) }))
    const first = makeRunner(unauthorized)
    // When each auth refusal is handled
    first.runner.schedule(input(4321))
    await first.runner.settled()
    // Then each request stops after one attempt with its named failure
    expect(unauthorized.calls).toHaveLength(1)
    expect(first.runner.frame.state).toBe('failed')
    expect(first.runner.frame.code).toBe('unauthorized')

    const forbidden = makeApi(() => ({ status: 403, body: envelope(undefined, [{ message: 'Unauthorized to access requested resource' }]) }))
    const second = makeRunner(forbidden)
    second.runner.schedule(input(4321))
    await second.runner.settled()
    expect(forbidden.calls).toHaveLength(1)
    expect(second.runner.frame.state).toBe('failed')
    expect(second.runner.frame.code).toBe('forbidden')
    expect(second.runner.frame.detail).toContain('Unauthorized to access requested resource')
  })

  it('operator bounds the retries of a rate-limited or failing API', async () => {
    // Given an API that answers 429 forever
    const api = makeApi(() => ({ status: 429, body: envelope(undefined, [{ message: 'Rate limited' }]) }))
    const { runner } = makeRunner(api)
    // When the sync runs
    runner.schedule(input(4321))
    await runner.settled()
    // Then it makes the first attempt plus two retries and stops
    expect(api.calls).toHaveLength(3)
    expect(runner.frame.state).toBe('failed')
    expect(runner.frame.code).toBe('http')
    expect(runner.frame.detail).toContain('429')
  })

  it('operator bounds the retries of a network failure', async () => {
    // Given a seam that cannot reach the API at all
    const api = makeApi(() => { throw new Error('getaddrinfo ENOTFOUND api.cloudflare.com') })
    const { runner } = makeRunner(api)
    // When the network failure is retried
    runner.schedule(input(4321))
    await runner.settled()
    // Then the same bound applies and the reason is the network one
    expect(api.calls).toHaveLength(3)
    expect(runner.frame.state).toBe('failed')
    expect(runner.frame.code).toBe('network')
    expect(runner.frame.detail).toContain('ENOTFOUND')
  })

  it('operator refuses to write a document outside the supported shape', async () => {
    // Given a remote ingress without the target hostname
    const api = makeApi(() => ({ status: 200, body: envelope({ ingress: [{ service: 'http_status:404' }] }) }))
    const { runner } = makeRunner(api)
    // When the sync runs
    runner.schedule(input(4321))
    await runner.settled()
    // Then it read once, wrote nothing, and reported the conflict
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.method).toBe('GET')
    expect(runner.frame.state).toBe('conflict')
    expect(runner.frame.code).toBe('missing')
  })

  it('operator treats a rejected write as a conflict', async () => {
    // Given a read with a drift and a write the API refuses with 409
    const api = makeApi((_request, index) => index === 0
      ? { status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }
      : { status: 409, body: envelope(undefined, [{ message: 'config is being updated elsewhere' }]) })
    const { runner } = makeRunner(api)
    // When the API rejects the attempted write
    runner.schedule(input(4321))
    await runner.settled()
    // Then the rejection becomes a conflict and no verification write follows
    expect(api.calls).toHaveLength(2)
    expect(runner.frame.state).toBe('conflict')
    expect(runner.frame.code).toBe('write-rejected')
  })

  it('operator never rewrites a document whose read-back disagrees with the write', async () => {
    // Given a write that the next read does not reflect
    const api = makeApi((_request, index) => ({
      status: 200,
      body: envelope(documentWith(index === 1 ? 'http://127.0.0.1:4321' : 'http://127.0.0.1:3080')),
    }))
    const { runner } = makeRunner(api)
    // When the sync runs
    runner.schedule(input(4321))
    await runner.settled()
    // Then there is exactly one PUT, no second write to force the state, and
    // the frame is a conflict that says another writer may own the document
    expect(api.calls.map(call => call.method)).toEqual(['GET', 'PUT', 'GET'])
    expect(runner.frame.state).toBe('conflict')
    expect(runner.frame.code).toBe('verify-mismatch')
    expect(runner.frame.changed).toBe(true)
  })

  it('operator does not re-read a target it already proved converged', async () => {
    // Given a converged sync
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    runner.schedule(input(3080))
    await runner.settled()
    expect(api.calls).toHaveLength(1)
    // When the same settings save arrives again
    runner.schedule(input(3080))
    await runner.settled()
    // Then it does not read again
    expect(api.calls).toHaveLength(1)
  })

  it('operator retries a failed target on the next schedule', async () => {
    // Given a first run that failed with a rate limit
    let fail = true
    const api = makeApi(() => fail
      ? { status: 429, body: envelope(undefined, [{ message: 'Rate limited' }]) }
      : { status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) })
    const { runner } = makeRunner(api)
    runner.schedule(input(3080))
    await runner.settled()
    expect(runner.frame.state).toBe('failed')
    // When a later save schedules the same target
    fail = false
    runner.schedule(input(3080))
    await runner.settled()
    // Then it converges instead of staying stuck on the old failure
    expect(runner.frame.state).toBe('applied')
  })

  it('operator drops a stale run before its only write', async () => {
    // Given a run whose read is still in flight
    let release: (() => void) | undefined
    const calls: IngressHttpRequest[] = []
    const api: Api = {
      calls,
      fetch: async (request) => {
        calls.push(request)
        if (calls.length === 1) {
          await new Promise<void>((resolve) => { release = resolve })
          return { status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }
        }
        const written = calls.some(call => call.method === 'PUT')
        return { status: 200, body: envelope(documentWith(written ? 'http://127.0.0.1:4321' : 'http://127.0.0.1:3080')) }
      },
    }
    const { runner } = makeRunner(api)
    runner.schedule(input(4321))
    // Let the stale run reach its read before a newer target arrives
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) // test-standards-allow: no-arbitrary-sleep — one macrotask boundary so the manual timer's continuations settle, not a timing assertion
    // When a newer target arrives while that read is still out
    runner.schedule(input(5555))
    release?.()
    await runner.settled()
    // Then the stale run never wrote the old target, and the queued one did
    const puts = calls.filter(call => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    const body = JSON.parse(puts[0]?.body ?? '{}') as { config: { ingress: Record<string, unknown>[] } }
    expect(body.config.ingress[1]?.service).toBe('http://127.0.0.1:5555')
    expect(runner.frame.state).toBe('conflict')
  })

  it('operator stops making requests once disposed', async () => {
    // Given a runner that has already been disposed
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    // When a new sync is scheduled after disposal
    runner.dispose()
    runner.schedule(input(4321))
    await runner.settled()
    // Then it stays silent and makes no request
    expect(api.calls).toHaveLength(0)
  })
})

describe('the service host is this machine, or nothing is written', () => {
  it('operator accepts loopback literals and the machine own LAN addresses only', () => {
    // Given host names a rule could point at
    // When each is judged against one owned LAN address
    // Then only loopback and the machine's own address pass
    expect(isRetargetableHost('127.0.0.1')).toBe(true)
    expect(isRetargetableHost('127.9.9.9')).toBe(true)
    expect(isRetargetableHost('[::1]')).toBe(true)
    expect(isRetargetableHost('localhost')).toBe(true)
    expect(isRetargetableHost('192.168.1.5', ['192.168.1.5'])).toBe(true)
    expect(isRetargetableHost('192.168.1.5')).toBe(false)
    expect(isRetargetableHost('dsh-nas')).toBe(false)
    expect(isRetargetableHost('0.0.0.0')).toBe(false)
    expect(isRetargetableHost('')).toBe(false)
    // Every dotted segment has to be an octet, or a non-address would read as
    // loopback and this sync would retarget a service nobody owns.
    expect(isRetargetableHost('127.999.999.999')).toBe(false)
    expect(isRetargetableHost('127.0.0.256')).toBe(false)
    expect(isRetargetableHost('127.0.0')).toBe(false)
    expect(isRetargetableHost('127.0.0.1.5')).toBe(false)
    expect(isRetargetableHost('127.0.0.-1')).toBe(false)
  })

  it('operator refuses a service hosted anywhere but on this machine', () => {
    // Given rules pointing at a LAN neighbour, a DNS name and another network
    const foreign = ['http://192.168.1.5:8080', 'http://dsh-nas:3080', 'http://10.0.0.7:3080']
    for (const service of foreign) {
      // When the plan is made while this machine owns a different address
      const plan = planIngressUpdate(documentWith(service), { hostname: HOSTNAME, port: 4321, allowedHosts: ['192.168.2.20'] })
      // Then it is a conflict with no document: that port is another host's
      expect(plan.outcome, service).toBe('conflict')
      if (plan.outcome !== 'conflict') continue
      expect(plan.code, service).toBe('service-host')
      expect('document' in plan, service).toBe(false)
      expect(plan.detail, service).toContain('neither loopback nor one of this machine')
    }
  })

  it('operator retargets the loopback and own-LAN services it does own', () => {
    // Given services this host really serves, on loopback and on its own address
    const owned = ['http://127.0.0.1:3080', 'http://127.5.6.7:3080', 'http://localhost:3080', 'http://[::1]:3080', 'http://192.168.1.5:8080']
    for (const service of owned) {
      // When the plan is made
      const plan = planIngressUpdate(documentWith(service), { hostname: HOSTNAME, port: 4321, allowedHosts: ['192.168.1.5'] })
      // Then the port is the only thing that moves
      expect(plan.outcome, service).toBe('apply')
      if (plan.outcome !== 'apply') continue
      expect(plan.from, service).toBe(service)
      expect(plan.to, service).toContain(':4321')
    }
  })

  it('operator never writes a foreign service through the runner', async () => {
    // Given a remote rule that points at another machine
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://192.168.1.5:8080')) }))
    const { runner } = makeRunner(api)
    // When the sync runs with an empty own-address list
    runner.schedule(input(4321))
    await runner.settled()
    // Then it read once, wrote nothing, and said why
    expect(api.calls.map(call => call.method)).toEqual(['GET'])
    expect(runner.frame.state).toBe('conflict')
    expect(runner.frame.code).toBe('service-host')
  })

  it('operator retargets an own-LAN service passed through the injected address list', async () => {
    // Given the same rule, but this machine owns 192.168.1.5
    const api = makeApi((_request, index) => ({
      status: 200,
      body: envelope(documentWith(index === 2 ? 'http://192.168.1.5:4321' : 'http://192.168.1.5:8080')),
    }))
    const { runner } = makeRunner(api, () => 1_000, () => ['192.168.1.5'])
    // When the sync runs with that owned address
    runner.schedule(input(4321))
    await runner.settled()
    // Then the one drifted port is written
    expect(api.calls.map(call => call.method)).toEqual(['GET', 'PUT', 'GET'])
    expect(runner.frame.state).toBe('applied')
  })
})

describe('the settle identity includes a digest of the credential', () => {
  it('operator re-reads a converged target when the token changed, and only then', async () => {
    // Given a converged target
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    runner.schedule(input(3080))
    await runner.settled()
    expect(api.calls).toHaveLength(1)
    // When the same port is scheduled again with the same token
    runner.schedule(input(3080))
    await runner.settled()
    // Then nothing is re-read
    expect(api.calls).toHaveLength(1)
    // When the same port is scheduled with a rotated token
    runner.schedule(input(3080, { token: 'cf-api-token-rotated' }))
    await runner.settled()
    // Then the new credential reads the document again, under the new header
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.headers.authorization).toBe('Bearer cf-api-token-rotated')
  })

  it('operator keeps the raw token in no frame, even across a rotation', async () => {
    // Given two runs with two different credentials
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner, frames } = makeRunner(api)
    runner.schedule(input(3080))
    await runner.settled()
    // When the credential is rotated and the sync runs again
    runner.schedule(input(3080, { token: 'cf-api-token-rotated' }))
    await runner.settled()
    // Then neither credential appears in any emitted frame
    expect(JSON.stringify(frames)).not.toContain(TOKEN)
    expect(JSON.stringify(frames)).not.toContain('cf-api-token-rotated')
  })
})

describe('a backoff never outlives its target', () => {
  it('operator drops a stale target during a 429 backoff instead of writing it', async () => {
    // Given a run whose first read is rate-limited, so a retry is pending
    const timer = manualTimer()
    const frames: IngressSyncFrame[] = []
    const calls: IngressHttpRequest[] = []
    const api: Api = {
      calls,
      fetch: async (request) => {
        calls.push(request)
        if (request.method === 'PUT') return { status: 200, body: envelope(documentWith('http://127.0.0.1:5555')) }
        if (calls.length === 1) return { status: 429, body: envelope(undefined, [{ message: 'Rate limited' }]) }
        const written = calls.some(call => call.method === 'PUT')
        return { status: 200, body: envelope(documentWith(written ? 'http://127.0.0.1:5555' : 'http://127.0.0.1:3080')) }
      },
    }
    const runner = new IngressSync({
      fetch: api.fetch,
      timer,
      debounceMs: 0,
      retryBaseMs: 1_000,
      onFrame: (frame) => { frames.push(frame) },
      now: () => 1_000,
      lanHosts: () => [],
    })
    runner.schedule(input(4321))
    await timer.fire()
    expect(calls).toHaveLength(1)
    expect(timer.pending).toBe(1)
    // When a newer target arrives while that backoff is pending
    runner.schedule(input(5555))
    await timer.fire()
    await runner.settled()
    // Then the stale target never retried and never wrote, and the queued one
    // made the only write, toward the port this host actually serves
    const puts = calls.filter(call => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    const body = JSON.parse(puts[0]?.body ?? '{}') as { config: { ingress: Record<string, unknown>[] } }
    expect(body.config.ingress[1]?.service).toBe('http://127.0.0.1:5555')
    expect(frames.some(frame => frame.code === 'stale')).toBe(false)
    // Nor is the 429 it was waiting out published as a failure: the queued
    // target owns the state, exactly as the dispose case asserts below.
    expect(frames.some(frame => frame.state === 'failed')).toBe(false)
    expect(runner.frame.state).toBe('applied')
  })

  it('operator releases a pending backoff wait on dispose and stops requesting', async () => {
    // Given a run that is waiting out a 429 backoff
    const timer = manualTimer()
    const frames: IngressSyncFrame[] = []
    const api = makeApi(() => ({ status: 429, body: envelope(undefined, [{ message: 'Rate limited' }]) }))
    const runner = new IngressSync({
      fetch: api.fetch,
      timer,
      debounceMs: 0,
      retryBaseMs: 1_000,
      onFrame: (frame) => { frames.push(frame) },
      now: () => 1_000,
      lanHosts: () => [],
    })
    runner.schedule(input(4321))
    await timer.fire()
    expect(api.calls).toHaveLength(1)
    expect(timer.pending).toBe(1)
    // When the plugin is torn down while the wait is pending
    runner.dispose()
    await runner.settled()
    // Then the wait is cancelled rather than slept out, no second request is
    // made, and nothing is published after the teardown
    expect(timer.pending).toBe(0)
    expect(timer.cleared).toHaveLength(1)
    expect(api.calls).toHaveLength(1)
    expect(frames.some(frame => frame.state === 'failed')).toBe(false)
  })
})

describe('service credentials never reach an audit field', () => {
  it('operator redacts userinfo from the apply verdict and keeps it in the write', () => {
    // Given a service carrying an origin credential in its userinfo
    const service = 'http://origin-user:origin-pass@127.0.0.1:3080'
    // When the plan is made
    const plan = planIngressUpdate(documentWith(service), { hostname: HOSTNAME, port: 4321 })
    if (plan.outcome !== 'apply') throw new Error('expected an apply plan')
    // Then the audit strings are redacted while the document keeps the credential
    expect(plan.from).toBe('http://127.0.0.1:3080')
    expect(plan.to).toBe('http://127.0.0.1:4321')
    const next = plan.document as { ingress: Record<string, unknown>[] }
    expect(next.ingress[1]?.service).toBe('http://origin-user:origin-pass@127.0.0.1:4321')
  })

  it('operator redacts userinfo from the unchanged verdict too', () => {
    // Given a rule that already names the bound port, behind a credential
    const plan = planIngressUpdate(documentWith('http://origin-user:origin-pass@127.0.0.1:3080'), { hostname: HOSTNAME, port: 3080 })
    // When the plan is made
    if (plan.outcome !== 'unchanged') throw new Error('expected an unchanged plan')
    // Then the reported service is the redacted one
    expect(plan.service).toBe('http://127.0.0.1:3080')
  })

  it('operator publishes no service credential in any frame', async () => {
    // Given a drift behind a credential-bearing service
    const api = makeApi((_request, index) => ({
      status: 200,
      body: envelope(documentWith(index === 0 ? 'http://origin-user:origin-pass@127.0.0.1:3080' : 'http://origin-user:origin-pass@127.0.0.1:4321')),
    }))
    const { runner, frames } = makeRunner(api)
    // When the sync runs
    runner.schedule(input(4321))
    await runner.settled()
    // Then the frame reports the redacted service and the write kept the credential
    expect(runner.frame.state).toBe('applied')
    expect(JSON.stringify(frames)).not.toContain('origin-pass')
    expect(JSON.stringify(frames)).not.toContain('origin-user')
    const put = api.calls.find(call => call.method === 'PUT')
    expect(put?.body).toContain('origin-pass')
  })
})

describe('a port that is not a number is not a target', () => {
  it('operator normalizes a non-finite port to no target', () => {
    // Given the adapter receives a half-read webServer port
    // When the settings are adapted
    // Then the port is undefined, so the sync waits instead of planning
    expect(ingressInputOf({
      enabled: true,
      ingressSync: true,
      publicBaseUrl: 'https://dsh.example.com',
      cfApiToken: TOKEN,
      cfAccountId: ACCOUNT,
      cfTunnelId: TUNNEL,
    }, Number.NaN).port).toBeUndefined()
    expect(ingressInputOf({
      enabled: true,
      ingressSync: true,
      publicBaseUrl: 'https://dsh.example.com',
      cfApiToken: TOKEN,
      cfAccountId: ACCOUNT,
      cfTunnelId: TUNNEL,
    }, Number.POSITIVE_INFINITY).port).toBeUndefined()
  })

  it('operator waits with no request for a non-finite port', async () => {
    // Given a runner scheduled with NaN as the bound port
    const api = makeApi(() => ({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) }))
    const { runner } = makeRunner(api)
    // When it is scheduled
    runner.schedule(input(Number.NaN))
    await runner.settled()
    // Then no request is made and the state is a wait, not a conflict
    expect(api.calls).toHaveLength(0)
    expect(runner.frame.state).toBe('waiting')
  })

  it('operator normalizes the live port the host reads, so a non-finite one waits', () => {
    // Given the values a half-read webServer can hand the host
    // When the host reads the port through the normalizer
    // Then only a finite number is a target, so the caller reaches the settle
    // retry an unbound port already takes instead of waiting forever
    expect(livePortOf(undefined)).toBeUndefined()
    expect(livePortOf(Number.NaN)).toBeUndefined()
    expect(livePortOf(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(livePortOf(Number.NEGATIVE_INFINITY)).toBeUndefined()
    expect(livePortOf(3080)).toBe(3080)
    // And the input built from it is a zero-request wait, not a target
    expect(ingressInputOf({
      enabled: true,
      ingressSync: true,
      publicBaseUrl: 'https://dsh.example.com',
      cfApiToken: TOKEN,
      cfAccountId: ACCOUNT,
      cfTunnelId: TUNNEL,
    }, livePortOf(Number.NaN)).port).toBeUndefined()
  })
})

describe('a target cleared mid-flight cannot write or settle', () => {
  /**
   * One run held at its first GET, so a schedule can land while that read is
   * still out. Releasing it with a drifted document is the case the old claim
   * would have written.
   * @returns the runner, its frames, and the release handle.
   */
  function suspendedRun() {
    const calls: IngressHttpRequest[] = []
    let release: ((response: IngressHttpResponse) => void) | undefined
    const api: Api = {
      calls,
      fetch: (request) => new Promise<IngressHttpResponse>((resolve) => {
        calls.push(request)
        release = resolve
      }),
    }
    const timer = manualTimer()
    const frames: IngressSyncFrame[] = []
    const runner = new IngressSync({
      fetch: api.fetch,
      timer,
      debounceMs: 0,
      retryBaseMs: 0,
      onFrame: (frame) => { frames.push(frame) },
      now: () => 1_000,
      lanHosts: () => [],
    })
    return {
      calls,
      frames,
      runner,
      timer,
      releaseWith: (response: IngressHttpResponse): void => { release?.(response) },
    }
  }

  it('operator reports a cleared token instead of writing the drift the old claim found', async () => {
    // Given a run whose read is still in flight
    const harness = suspendedRun()
    harness.runner.schedule(input(4321))
    await harness.timer.fire()
    expect(harness.calls).toHaveLength(1)
    // When the credential is cleared while that read is out
    harness.runner.schedule(input(4321, { token: undefined }))
    // And the stale read answers with a drift the old target would have written
    harness.releaseWith({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) })
    await harness.runner.settled()
    // Then the stale run wrote nothing, settled nothing, and reported nothing
    // as applied; the terminal frame is the cleared configuration
    expect(harness.calls.filter(call => call.method === 'PUT')).toHaveLength(0)
    expect(harness.frames.some(frame => frame.state === 'applied')).toBe(false)
    expect(harness.runner.frame.state).toBe('failed')
    expect(harness.runner.frame.code).toBe('not-configured')
  })

  it('operator reports a cleared hostname instead of writing the drift the old claim found', async () => {
    // Given the same in-flight read
    const harness = suspendedRun()
    harness.runner.schedule(input(4321))
    await harness.timer.fire()
    // When publicBaseUrl stops naming a hostname while that read is out
    harness.runner.schedule(input(4321, { hostname: undefined }))
    harness.releaseWith({ status: 200, body: envelope(documentWith('http://127.0.0.1:3080')) })
    await harness.runner.settled()
    // Then nothing was written or settled, and the frame is the missing hostname
    expect(harness.calls.filter(call => call.method === 'PUT')).toHaveLength(0)
    expect(harness.frames.some(frame => frame.state === 'applied')).toBe(false)
    expect(harness.runner.frame.state).toBe('failed')
    expect(harness.runner.frame.code).toBe('hostname')
  })
})
