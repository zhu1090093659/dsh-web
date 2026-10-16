/**
 * The landing page's source decision (lan-source.ts): the injected script that
 * probes the LAN candidates and, when one answers, moves the phone there. Runs
 * the generated script against a fake window — no browser needed — with the
 * fetch and timeout seams driven by the test so the ~800 ms budget never costs
 * wall-clock time.
 */
import { describe, expect, it } from 'vitest'
import { appShellLanSwitchScript, LAN_SOURCE_PROBE_TIMEOUT_MS, LAN_SOURCE_RETRY_WINDOW_MS, LAN_SOURCE_STORAGE_KEY, type LanSourceHop } from '../src/lan-source.ts'

const HOP: LanSourceHop = {
  candidates: ['http://192.168.1.5:3080', 'http://10.0.0.3:3080'],
  path: '/pair-app',
  pingPath: '/pair-ping',
  grant: 'grant-1',
}

/** The script body without its `<script>` wrapper (the injection contract). */
function scriptBody(hop: LanSourceHop = HOP): string {
  const wrapped = appShellLanSwitchScript(hop)
  const body = /^<script>([\s\S]*)<\/script>$/.exec(wrapped)
  if (body === null) throw new Error('switch script is not one bare script element')
  return body[1] as string
}

interface Harness {
  /** Every document navigation the script asked for. */
  replaced: string[]
  /** The decision as stored, already parsed. */
  decision(): Record<string, unknown> | undefined
  /** Fire the probe's budget expiry. */
  expire(): void
  /** Settle the script's already-resolved fetch continuations. */
  settle(): Promise<void>
}

/** Which candidates answer, and how each one answers. */
type Answer = 'ok' | 'fail' | 'hang'

function run(options: {
  /** The origin the landing was served from. */
  origin?: string
  answers?: Record<string, Answer>
  /** A decision already in sessionStorage (raw JSON). */
  stored?: string
  hop?: LanSourceHop
} = {}): Harness {
  const replaced: string[] = []
  const stored = new Map<string, string>()
  if (options.stored !== undefined) stored.set(LAN_SOURCE_STORAGE_KEY, options.stored)
  const timers: (() => void)[] = []
  const calls: string[] = []
  const answers = options.answers ?? {}
  const win = {
    location: {
      origin: options.origin ?? 'https://relay.example.com',
      replace: (url: string): void => { replaced.push(url) },
    },
    sessionStorage: {
      getItem: (key: string): string | null => stored.get(key) ?? null,
      setItem: (key: string, value: string): void => { stored.set(key, value) },
    },
    fetch: (input: string): Promise<unknown> => {
      calls.push(input)
      switch (answers[new URL(input).origin]) {
        case 'ok': return Promise.resolve({ type: 'opaque' })
        case 'fail': return Promise.reject(new Error('unreachable'))
        default: return new Promise(() => {})
      }
    },
    // The budget is driven by the test: 800 ms of wall clock proves nothing.
    setTimeout: (callback: () => void): number => {
      timers.push(callback)
      return timers.length
    },
    clearTimeout: (): void => {},
  }
  new Function('window', scriptBody(options.hop))(win)
  return {
    replaced,
    decision: () => {
      const raw = stored.get(LAN_SOURCE_STORAGE_KEY)
      return raw === undefined ? undefined : JSON.parse(raw) as Record<string, unknown>
    },
    expire: () => { for (const timer of timers.splice(0)) timer() },
    settle: async () => { await tick() },
  }
}

/**
 * Yield to the microtask queue: the script's fetch stub resolves immediately, so
 * one turn of the queue settles the probe with no timer and no wall-clock wait.
 */
function tick(): Promise<void> {
  return new Promise(resolve => { queueMicrotask(resolve) })
}

describe('appShellLanSwitchScript', () => {
  it('guest: the injected script cannot break out of its script element', () => {
    // Given the script element the landing splices into the official head index,
    const wrapped = appShellLanSwitchScript(HOP)
    // When it is scanned, then it closes exactly once and carries its payload.
    expect(wrapped.startsWith('<script>')).toBe(true)
    expect(wrapped.endsWith('</script>')).toBe(true)
    expect(wrapped.slice('<script>'.length, -'</script>'.length)).not.toContain('</script')
    expect(wrapped).toContain(LAN_SOURCE_STORAGE_KEY)
    expect(wrapped).toContain(String(LAN_SOURCE_PROBE_TIMEOUT_MS))
  })
})

describe('the probe', () => {
  it('guest: the first LAN candidate that answers becomes the origin', async () => {
    // Given a guest whose phone can reach the second advertised LAN origin,
    const harness = run({ answers: { 'http://10.0.0.3:3080': 'ok' } })
    // When the probe settles, then it moves there with the one-time grant and
    // records the choice for the rest of the session.
    await harness.settle()
    expect(harness.replaced).toEqual(['http://10.0.0.3:3080/pair-app?grant=grant-1'])
    expect(harness.decision()).toMatchObject({ src: 'lan', base: 'http://10.0.0.3:3080' })
  })

  it('guest: the probe requests the LAN beacon and nothing that carries a credential', async () => {
    // Given a landing whose probe is about to run against two candidates,
    const calls: string[] = []
    const win = {
      location: { origin: 'https://relay.example.com', replace: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      fetch: (input: string): Promise<unknown> => {
        calls.push(input)
        return Promise.resolve({})
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
    }
    // When the probe runs, then each candidate is asked for the beacon path only.
    new Function('window', scriptBody())(win)
    await tick()
    expect(calls.sort()).toEqual(['http://10.0.0.3:3080/pair-ping', 'http://192.168.1.5:3080/pair-ping'])
  })

  it('guest: the one-time grant is percent-encoded into the hop URL', async () => {
    // Given a granted secret carrying spaces and URL-significant characters,
    const harness = run({ answers: { 'http://192.168.1.5:3080': 'ok' }, hop: { ...HOP, grant: 'a b/c+=' } })
    // When the hop is taken, then the whole grant survives the query.
    await harness.settle()
    expect(harness.replaced).toEqual(['http://192.168.1.5:3080/pair-app?grant=a%20b%2Fc%2B%3D'])
  })

  it('guest: an unanswered probe leaves the public page exactly where it was', async () => {
    // Given a phone off the advertised network: one candidate refuses the probe
    // and the other never answers.
    const harness = run({ answers: { 'http://192.168.1.5:3080': 'fail', 'http://10.0.0.3:3080': 'hang' } })
    // When the refusal lands and the budget then expires, then the page is never
    // navigated and the session settles on the public source.
    await harness.settle()
    expect(harness.replaced).toEqual([])
    harness.expire()
    expect(harness.replaced).toEqual([])
    expect(harness.decision()).toMatchObject({ src: 'public' })
  })

  it('guest: a second candidate answering later cannot navigate a second time', async () => {
    // Given both candidates reachable and answering at once,
    const harness = run({ answers: { 'http://192.168.1.5:3080': 'ok', 'http://10.0.0.3:3080': 'ok' } })
    // When the probe settles and the budget expires, then exactly one hop was taken.
    await harness.settle()
    harness.expire()
    expect(harness.replaced).toHaveLength(1)
  })
})

describe('the recorded decision', () => {
  it('guest: a landing already on a LAN candidate records that source without probing', () => {
    // Given a page served from one of the advertised LAN origins,
    const harness = run({ origin: 'http://10.0.0.3:3080', answers: {} })
    // When the decision runs, then it records the LAN source and hops nowhere.
    expect(harness.decision()).toMatchObject({ src: 'lan', base: 'http://10.0.0.3:3080' })
    expect(harness.replaced).toEqual([])
  })

  it('guest: a recorded decision is not probed again while the candidates are unchanged', async () => {
    // Given a session that already settled on the public source for this set,
    const stored = JSON.stringify({ src: 'public', sig: 'http://192.168.1.5:3080,http://10.0.0.3:3080', at: 1 })
    const harness = run({ stored, answers: { 'http://10.0.0.3:3080': 'ok' } })
    // When the landing is rendered again, then no probe is sent and the decision stands.
    await harness.settle()
    expect(harness.replaced).toEqual([])
    expect(harness.decision()).toMatchObject({ src: 'public', at: 1 })
  })

  it('guest: a decision recorded against a different candidate set is probed again', async () => {
    // Given a decision taken when the host advertised another address,
    const stored = JSON.stringify({ src: 'public', sig: 'http://192.168.9.9:3080', at: 1 })
    const harness = run({ stored, answers: { 'http://10.0.0.3:3080': 'ok' } })
    // When the landing renders with the new set, then the probe runs again.
    await harness.settle()
    expect(harness.replaced).toEqual(['http://10.0.0.3:3080/pair-app?grant=grant-1'])
  })

  it('guest: a LAN hop that did not stick settles on the public source', async () => {
    // Given a phone that took a hop moments ago and is back on the public
    // landing, because the LAN page never loaded, so hopping again would repeat
    // the failure,
    const stored = JSON.stringify({ src: 'lan', sig: 'http://192.168.1.5:3080,http://10.0.0.3:3080', base: 'http://10.0.0.3:3080', at: Date.now() - 1_000 })
    const harness = run({ stored, answers: { 'http://10.0.0.3:3080': 'ok' } })
    // When the decision runs, then it settles on the public source and stays put.
    await harness.settle()
    expect(harness.replaced).toEqual([])
    expect(harness.decision()).toMatchObject({ src: 'public' })
  })

  it('guest: a LAN decision older than the retry window is probed again', async () => {
    // Given a LAN decision taken well before the window (a deliberate return),
    const stored = JSON.stringify({ src: 'lan', sig: 'http://192.168.1.5:3080,http://10.0.0.3:3080', base: 'http://10.0.0.3:3080', at: Date.now() - LAN_SOURCE_RETRY_WINDOW_MS - 1 })
    const harness = run({ stored, answers: { 'http://192.168.1.5:3080': 'ok' } })
    // When the landing renders, then the probe re-runs instead of trusting it.
    await harness.settle()
    expect(harness.replaced).toEqual(['http://192.168.1.5:3080/pair-app?grant=grant-1'])
  })

  it('guest: an unreadable stored decision reads as no decision at all', async () => {
    // Given a truncated record left in sessionStorage,
    const harness = run({ stored: '{not json', answers: { 'http://10.0.0.3:3080': 'ok' } })
    // When the decision runs, then it probes as if nothing had been recorded.
    await harness.settle()
    expect(harness.replaced).toEqual(['http://10.0.0.3:3080/pair-app?grant=grant-1'])
  })

  it('guest: a sessionStorage that throws does not stop the probe', async () => {
    // Given a browser that denies every sessionStorage call,
    const replaced: string[] = []
    const win = {
      location: { origin: 'https://relay.example.com', replace: (url: string): void => { replaced.push(url) } },
      sessionStorage: {
        getItem: (): string => { throw new Error('denied') },
        setItem: (): void => { throw new Error('denied') },
      },
      fetch: (): Promise<unknown> => Promise.resolve({}),
      setTimeout: () => 1,
      clearTimeout: () => {},
    }
    // When the probe settles, then the hop is taken from the first live answer
    // and the denied writes are simply lost.
    new Function('window', scriptBody())(win)
    await tick()
    expect(replaced).toEqual(['http://192.168.1.5:3080/pair-app?grant=grant-1'])
  })
})
