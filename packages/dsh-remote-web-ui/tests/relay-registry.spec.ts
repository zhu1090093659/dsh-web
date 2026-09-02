/**
 * The relay-registry client: per-profile identity minting/persistence, the
 * stable origin shape, and the registrar loop (announce with fresh-claim
 * semantics, backoff retry, invalid-params re-claim, unregister).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateRelayIdentity,
  loadRelayIdentity,
  relayBaseOf,
  RelayRegistrar,
  relayIdentityFile,
  RELAY_BASE_SUFFIX,
  type RelayIdentity,
  type RelayState,
} from '../src/relay-registry.ts'

const HOMES: string[] = []

afterEach(() => {
  while (HOMES.length > 0) {
    const home = HOMES.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-relay-'))
  HOMES.push(home)
  return home
}

/** Deterministic random: 0x41 bytes, so ids are '4141…' and secrets repeat 'A'. */
const deterministicRandom = (size: number): Buffer => Buffer.alloc(size, 0x41)

/** Collect the states a registrar reports. */
function stateCollector(): { states: RelayState[]; push: (state: RelayState) => void } {
  const states: RelayState[] = []
  return { states, push: (state) => { states.push(state) } }
}

function identityOf(fresh?: boolean): RelayIdentity {
  return { id: 'abcd1234abcd1234', secret: 'A'.repeat(43), ...(fresh === undefined ? {} : { fresh }) }
}

interface FetchLog { url: string; body: Record<string, unknown> }

/** A fetch seam responding from a scripted status list; logs every body. */
function scriptedFetch(responses: Array<{ status: number; error?: string }>): { fetchFn: typeof fetch; log: FetchLog[] } {
  const log: FetchLog[] = []
  const queue = [...responses]
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as Record<string, unknown>
    log.push({ url: String(url), body })
    const next = queue.shift() ?? { status: 200 }
    return new Response(next.error === undefined ? '{}' : JSON.stringify({ error: next.error }), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchFn, log }
}

/** A timer seam: no real timers; retries fire only when the test flushes. */
function manualTimers(): { timerFn: (fn: () => void, ms: number) => NodeJS.Timeout; flush: () => void; delays: number[] } {
  const pending: Array<{ fn: () => void }> = []
  const delays: number[] = []
  const timerFn = (fn: () => void, ms: number): NodeJS.Timeout => {
    delays.push(ms)
    pending.push({ fn })
    return { unref: () => undefined } as unknown as NodeJS.Timeout
  }
  return { timerFn, delays, flush: () => { while (pending.length > 0) pending.shift()?.fn() } }
}

describe('relayIdentityFile', () => {
  it('builds one file per profile under the registry directory', () => {
    expect(relayIdentityFile('web', '/home')).toBe(join('/home', 'remote-web-ui-registry', 'web.json'))
    expect(relayIdentityFile('trading-web', '/home')).toBe(join('/home', 'remote-web-ui-registry', 'trading-web.json'))
  })

  it('rejects profiles that are not a single safe path segment', () => {
    expect(() => relayIdentityFile('../evil', '/home')).toThrow()
    expect(() => relayIdentityFile('a/b', '/home')).toThrow()
    expect(() => relayIdentityFile('', '/home')).toThrow()
  })
})

describe('generateRelayIdentity', () => {
  it('mints an 8-byte hex id, a 32-byte base64url secret, and the fresh flag', () => {
    const identity = generateRelayIdentity(deterministicRandom)
    expect(identity.id).toMatch(/^[a-z0-9]{16}$/)
    expect(identity.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(identity.fresh).toBe(true)
  })
})

describe('loadRelayIdentity', () => {
  it('mints and persists owner-only on first run, then loads the same identity', () => {
    const home = tempHome()
    const first = loadRelayIdentity('web', home, deterministicRandom)
    const file = relayIdentityFile('web', home)
    expect(existsSync(file)).toBe(true)
    expect((statSync(file).mode & 0o777) === 0o600).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ id: first.id, secret: first.secret })
    const second = loadRelayIdentity('web', home, () => { throw new Error('must not remint') })
    expect(second).toEqual({ id: first.id, secret: first.secret })
  })

  it('remints a malformed file (the phone then re-pairs once)', () => {
    const home = tempHome()
    const file = relayIdentityFile('web', home)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{not json')
    const identity = loadRelayIdentity('web', home, deterministicRandom)
    expect(identity.fresh).toBe(true)
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
  })

  it('keeps profiles isolated from each other', () => {
    const home = tempHome()
    const web = loadRelayIdentity('web', home, deterministicRandom)
    const trading = loadRelayIdentity('trading-web', home, (size) => Buffer.alloc(size, 0x42))
    expect(web.id).not.toBe(trading.id)
    expect(relayIdentityFile('web', home)).not.toBe(relayIdentityFile('trading-web', home))
  })
})

describe('relayBaseOf', () => {
  it('derives the stable origin from the identity id', () => {
    expect(relayBaseOf({ id: 'abcd1234abcd1234', secret: 's' })).toBe(`https://abcd1234abcd1234${RELAY_BASE_SUFFIX}`)
  })
})

describe('RelayRegistrar', () => {
  it('announces a fresh identity with new_secret and reports the stable origin', async () => {
    const { fetchFn, log } = scriptedFetch([{ status: 200 }])
    const { push, states } = stateCollector()
    const registrar = new RelayRegistrar(identityOf(true), push, { fetchFn })
    const base = await registrar.announce('https://tunnel.trycloudflare.com')
    expect(base).toBe(`https://abcd1234abcd1234${RELAY_BASE_SUFFIX}`)
    expect(log).toHaveLength(1)
    expect(log[0].body.new_secret).toBe(log[0].body.secret)
    expect(states.map(state => state.state)).toEqual(['registering', 'running'])
  })

  it('refreshes without new_secret once the row exists', async () => {
    const { fetchFn, log } = scriptedFetch([{ status: 200 }, { status: 200 }])
    const { push, states } = stateCollector()
    const registrar = new RelayRegistrar(identityOf(true), push, { fetchFn })
    await registrar.announce('https://first.trycloudflare.com')
    expect(log[0].body.new_secret).toBe(log[0].body.secret)
    await registrar.announce('https://second.trycloudflare.com')
    expect(log[1].body.target).toBe('https://second.trycloudflare.com')
    expect(log[1].body.new_secret).toBeUndefined()
    expect(states.at(-1)).toEqual({ state: 'running', url: `https://abcd1234abcd1234${RELAY_BASE_SUFFIX}` })
  })

  it('retries with capped backoff after a failure', async () => {
    const { fetchFn, log } = scriptedFetch([
      { status: 503, error: 'storage-unavailable' },
      { status: 200 },
    ])
    const { push, states } = stateCollector()
    const timers = manualTimers()
    const registrar = new RelayRegistrar(identityOf(), push, { fetchFn, timerFn: timers.timerFn })
    const base = await registrar.announce('https://tunnel.trycloudflare.com')
    expect(base).toBeUndefined()
    expect(states.at(-1)).toEqual({ state: 'failed', error: 'storage-unavailable' })
    expect(timers.delays[0]).toBe(5_000)
    timers.flush()
    await vi.waitFor(() => { expect(log).toHaveLength(2) })
    expect(states.at(-1)?.state).toBe('running')
  })

  it('re-claims the id once when the registry lost the row', async () => {
    const { fetchFn, log } = scriptedFetch([
      { status: 200 },
      { status: 400, error: 'invalid-params' },
      { status: 200 },
    ])
    const { push, states } = stateCollector()
    const timers = manualTimers()
    const registrar = new RelayRegistrar(identityOf(true), push, { fetchFn, timerFn: timers.timerFn })
    await registrar.announce('https://tunnel.trycloudflare.com')
    // The registry lost the row: the next refresh (no new_secret) is rejected.
    await registrar.announce('https://tunnel.trycloudflare.com')
    expect(states.at(-1)).toEqual({ state: 'failed', error: 'invalid-params' })
    // The scheduled retry re-claims with new_secret and recovers.
    timers.flush()
    await vi.waitFor(() => { expect(log).toHaveLength(3) })
    expect(log[2].body.new_secret).toBe(log[2].body.secret)
    expect(states.at(-1)?.state).toBe('running')
  })

  it('dispose stops retries and reports off; unregister POSTs the secret', async () => {
    const { fetchFn, log } = scriptedFetch([{ status: 503, error: 'storage-unavailable' }, { status: 200 }])
    const { push, states } = stateCollector()
    const timers = manualTimers()
    const registrar = new RelayRegistrar(identityOf(), push, {
      fetchFn,
      timerFn: timers.timerFn,
      unregisterUrl: 'https://registry.test/unregister',
    })
    await registrar.announce('https://tunnel.trycloudflare.com')
    registrar.dispose()
    expect(states.at(-1)).toEqual({ state: 'off' })
    timers.flush()
    expect(log).toHaveLength(1)
    await expect(registrar.unregister()).resolves.toBeUndefined()
    expect(log).toHaveLength(2)
    expect(log[1].url).toBe('https://registry.test/unregister')
    expect(log[1].body).toEqual({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43) })
  })
})
