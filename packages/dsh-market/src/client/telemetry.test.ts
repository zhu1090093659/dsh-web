/** @vitest-environment jsdom */

/**
 * The shared telemetry heartbeat (synced copy of shared/client/telemetry.ts):
 * one beat per browser per UTC day, silent failure, day marked only after an
 * accepted send.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isTelemetrySuppressed,
  reportDailyHeartbeat,
  setTelemetryOptedOut,
} from './telemetry.ts'

const ENDPOINT = 'https://dsh-market.com/api/telemetry/event'

/** Minimal Storage double; Node's partial global localStorage leaks into
 * jsdom here, so every test installs its own deterministic instance. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => { map.delete(key) },
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

let store: Storage
const todayKey = () => 'dsh-web-ui-telemetry-day:' + new Date().toISOString().slice(0, 10)

function lastBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1)
  expect(call?.[0]).toBe(ENDPOINT)
  return JSON.parse(String((call![1] as RequestInit).body))
}

describe('daily telemetry heartbeat', () => {
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    vi.stubGlobal('crypto', { randomUUID: () => '0123456789abcdef0123456789abcdef' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends one anonymous beat with the package name and a random visitor id', () => {
    reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-market' }])
    const body = lastBody()
    expect(body.kind).toBe('heartbeat')
    expect(body.visitor).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(body.items).toEqual([{ name: '@linxin666/dsh-client-ui-market' }])
  })

  it('persists the visitor id for later beats', () => {
    reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-market' }])
    reportDailyHeartbeat([])
    expect(store.getItem('dsh-web-ui-telemetry-visitor')).toBe('0123456789abcdef0123456789abcdef')
  })

  it('marks the day only after an accepted send so offline browsers retry', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 503 }))
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getItem(todayKey())).toBeNull()

    vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 200 }))
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getItem(todayKey())).toBe('1')
  })

  it('stays silent for the rest of the day once the beat was accepted', () => {
    store.setItem(todayKey(), '')
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never throws and sends nothing when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips empty item lists', () => {
    reportDailyHeartbeat([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips automated browsers (navigator.webdriver)', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true })
    try {
      reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
    }
  })

  it('carries explicit version and channel, omitting absent fields', () => {
    reportDailyHeartbeat([
      { name: 'skin:harbor', version: '2.0.1', channel: 'market' },
      { name: '@linxin666/dsh-pet' },
    ])
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.items[0]).toEqual({ name: 'skin:harbor', version: '2.0.1', channel: 'market' })
    expect(body.items[1]).toEqual({ name: '@linxin666/dsh-pet' })
  })
})

describe('family-wide telemetry opt-out', () => {
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    vi.stubGlobal('crypto', { randomUUID: () => '0123456789abcdef0123456789abcdef' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Visitor who stored the opt-out sends nothing and mints no visitor id', () => {
    // Given: the family-wide opt-out is stored on this browser.
    store.setItem('dsh-web-ui-telemetry-opt-out', '1')
    // When: a wired plugin mounts and reports its heartbeat.
    reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-market' }])
    // Then: nothing reaches the network and no visitor id is minted.
    expect(fetch).not.toHaveBeenCalled()
    expect(store.getItem('dsh-web-ui-telemetry-visitor')).toBeNull()
    expect(isTelemetrySuppressed()).toBe(true)
  })

  it('Visitor who asks not to be tracked sends nothing for "1" and for "yes"', () => {
    for (const signal of ['1', 'yes']) {
      // Given: the browser answers Do Not Track with the legacy or current value.
      Object.defineProperty(navigator, 'doNotTrack', { value: signal, configurable: true })
      try {
        // When: a wired plugin mounts and reports its heartbeat.
        reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
        // Then: the beat is suppressed and the day stays unmarked.
        expect(fetch).not.toHaveBeenCalled()
        expect(store.getItem(todayKey())).toBeNull()
        expect(isTelemetrySuppressed()).toBe(true)
      } finally {
        Object.defineProperty(navigator, 'doNotTrack', { value: undefined, configurable: true })
      }
    }
  })

  it('Visitor who turns the switch on stops the beat and turning it off resumes it', () => {
    // Given: a browser with everything reporting enabled.
    setTelemetryOptedOut(true)
    // When: a heartbeat is attempted while the switch is on.
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    // Then: no send happens, and switching it off lets a beat through.
    expect(fetch).not.toHaveBeenCalled()
    setTelemetryOptedOut(false)
    expect(store.getItem('dsh-web-ui-telemetry-opt-out')).toBeNull()
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('Visitor who opts out leaves the day unmarked so re-enabling reports the same day', async () => {
    // Given: the opt-out is stored, then cleared later the same UTC day.
    setTelemetryOptedOut(true)
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    // When: the switch is turned back off and a heartbeat is attempted.
    setTelemetryOptedOut(false)
    reportDailyHeartbeat([{ name: '@linxin666/dsh-pet' }])
    await Promise.resolve()
    // Then: the suppressed attempt never marked the day, so today's beat is sent.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.getItem(todayKey())).toBe('1')
    expect(lastBody().items).toEqual([{ name: '@linxin666/dsh-pet' }])
  })
})
