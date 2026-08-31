/** PairingService semantics: one-time tokens, expiry, refresh, stop, presence. */
import { describe, expect, it } from 'vitest'
import { PairingService, UnknownLanAddressError, type PairingConfig } from '../src/pairing.ts'

function makeService(overrides: Partial<PairingConfig> = {}) {
  let counter = 0
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 2,
    cookieName: 'dsh_pair',
    ...overrides,
  }, {
    now: () => now,
    randomToken: () => `tok-${String(++counter).padStart(4, '0')}`,
  })
  service.setLanBases([{ address: '192.168.1.5', base: 'http://192.168.1.5:3080' }])
  return service
}

let now = 0
beforeEach0()

function beforeEach0(): void {
  now = 1_000_000
}

describe('PairingService', () => {
  it('issues one active token and replaces it on refresh (old link dies)', () => {
    const service = makeService()
    const first = service.issue()
    expect(service.accept(first.token)).toMatchObject({ ok: true })
    // Refresh: the previous token record is gone, so reuse is invalid.
    const second = service.issue()
    expect(second.token).not.toBe(first.token)
    expect(service.accept(first.token)).toEqual({ ok: false, code: 'invalid' })
    expect(service.accept(second.token)).toMatchObject({ ok: true })
  })

  it('never exposes the pairing secret in the snapshot', () => {
    const service = makeService()
    const { token } = service.issue()
    const snapshot = service.snapshot()
    expect(snapshot.tokenId).toBeDefined()
    expect(snapshot.tokenId).not.toBe(token)
  })

  it('re-accepts a consumed token within the window, minting a fresh device', () => {
    const service = makeService()
    const { token } = service.issue()
    const first = service.accept(token)
    expect(first).toMatchObject({ ok: true })
    const second = service.accept(token)
    expect(second).toMatchObject({ ok: true })
    expect(second.ok && first.ok ? second.deviceId !== first.deviceId : false).toBe(true)
    expect(service.hasDevice(second.ok ? second.deviceId : '')).toBe(true)
  })

  it('refuses an expired token as invalid', () => {
    const service = makeService()
    const { token } = service.issue()
    now += 61_000
    expect(service.accept(token)).toEqual({ ok: false, code: 'invalid' })
  })

  it('refuses an unknown token as invalid', () => {
    const service = makeService()
    expect(service.accept('nope')).toEqual({ ok: false, code: 'invalid' })
  })

  it('throws lan-required when no LAN base is set (no unusable QR)', () => {
    const service = makeService()
    service.setLanBases([])
    expect(() => service.issue()).toThrow(/--host 0.0.0.0/)
  })

  it('mints against a chosen address and refuses unknown literals', () => {
    const service = makeService()
    service.setLanBases([
      { address: '192.168.1.5', base: 'http://192.168.1.5:3080' },
      { address: '10.0.0.3', base: 'http://10.0.0.3:3080' },
    ])
    expect(service.lanAddresses).toEqual(['192.168.1.5', '10.0.0.3'])
    // Default stays the first interface; an explicit address is honored.
    const first = service.issue('ws-1')
    const second = service.issue('ws-2', '10.0.0.3')
    expect(first.token).not.toBe(second.token)
    expect(() => service.issue(undefined, '192.0.2.1')).toThrow(UnknownLanAddressError)
    // The snapshot advertises every constructible literal (interface order).
    expect(service.snapshot().lanAddresses).toEqual(['192.168.1.5', '10.0.0.3'])
  })

  it('publicBaseUrl satisfies the reachable-bind requirement and surfaces in snapshots', () => {
    const service = makeService()
    service.setLanBases([])
    service.setPublicBaseUrl('https://phone.example.com')
    // No LAN bind, but the public base is a constructible link — no throw.
    expect(() => service.issue()).not.toThrow()
    // The snapshot advertises the public base alongside the (empty) LAN set.
    expect(service.snapshot()).toMatchObject({
      phase: 'waiting',
      lanAvailable: false,
      lanAddresses: [],
      publicUrl: 'https://phone.example.com',
    })
    // Clearing the public base restores the lan-required condition.
    service.setPublicBaseUrl(undefined)
    expect(() => service.issue()).toThrow(/--host 0.0.0.0/)
    expect(service.snapshot().phase).toBe('lan-required')
  })

  it('surfaces auto-tunnel status frames and clears them with the feature', () => {
    const service = makeService()
    service.setLanBases([])
    service.setPublicBaseUrl(undefined)
    expect(service.snapshot().tunnel).toBeUndefined()
    service.setTunnelStatus({ state: 'starting' })
    expect(service.snapshot().tunnel).toEqual({ state: 'starting' })
    // The status alone does not make a QR constructible (that is publicBaseUrl).
    expect(() => service.issue()).toThrow(/--host 0.0.0.0/)
    service.setPublicBaseUrl('https://tunnel.example.com')
    service.setTunnelStatus({ state: 'running', url: 'https://tunnel.example.com' })
    expect(service.snapshot()).toMatchObject({
      publicUrl: 'https://tunnel.example.com',
      tunnel: { state: 'running', url: 'https://tunnel.example.com' },
    })
    // Turning the feature off clears the frame.
    service.setTunnelStatus(undefined)
    expect(service.snapshot().tunnel).toBeUndefined()
    // A failed frame with an error detail surfaces too.
    service.setTunnelStatus({ state: 'failed', error: 'binary offline' })
    expect(service.snapshot().tunnel).toEqual({ state: 'failed', error: 'binary offline' })
    // Listener dedupe: a repeated identical frame emits nothing.
    const seen: unknown[] = []
    service.onState(snapshot => { seen.push(snapshot.tunnel) })
    service.setTunnelStatus({ state: 'failed', error: 'binary offline' })
    expect(seen).toEqual([])
  })

  it('stop revokes devices and tokens; a fresh issue re-arms', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    expect(accepted.ok).toBe(true)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    expect(service.hasDevice(deviceId)).toBe(true)
    service.stop()
    expect(service.hasDevice(deviceId)).toBe(false)
    expect(service.touchDevice(deviceId)).toBe(false)
    expect(service.accept(token)).toEqual({ ok: false, code: 'invalid' })
    expect(service.snapshot().phase).toBe('stopped')
    // Refresh re-arms from the stopped state.
    service.issue()
    expect(service.snapshot().phase).toBe('waiting')
  })

  it('tracks presence: touch keeps a device online, then it ages offline', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    expect(service.snapshot().phase).toBe('connected')
    now += 9_000
    service.sweep()
    expect(service.snapshot().phase).toBe('connected')
    now += 2_000
    service.sweep()
    expect(service.snapshot().phase).toBe('disconnected')
    // Activity brings it back online.
    expect(service.touchDevice(deviceId)).toBe(true)
    expect(service.snapshot().phase).toBe('connected')
  })

  it('notifies listeners only on real snapshot changes', () => {
    const service = makeService()
    const seen: string[] = []
    service.onState(snapshot => { seen.push(snapshot.phase) })
    service.issue()
    expect(seen).toEqual(['waiting'])
    service.sweep()
    expect(seen).toEqual(['waiting'])
    const { token } = service.issue()
    const accepted = service.accept(token)
    expect(accepted.ok).toBe(true)
    expect(seen).toEqual(['waiting', 'waiting', 'connected'])
  })

  it('throttles presence broadcasts: touch/heartbeat stay quiet until the sweep', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    const seen: { phase: string; lastSeenAt?: number }[] = []
    service.onState(snapshot => { seen.push({ phase: snapshot.phase, lastSeenAt: snapshot.devices[0]?.lastSeenAt }) })
    // A gated request refreshes presence but must not fan a snapshot out to
    // the status listeners on the hot path.
    const base = now
    now += 3_000
    expect(service.touchDevice(deviceId)).toBe(true)
    expect(seen).toEqual([])
    // The next sweep coalesces the refresh into exactly one broadcast.
    service.sweep()
    expect(seen).toEqual([{ phase: 'connected', lastSeenAt: base + 3_000 }])
    // A heartbeat before the next sweep coalesces too, and a no-op sweep stays quiet.
    now += 1_000
    expect(service.heartbeat(deviceId)).toBe(true)
    now += 1_000
    service.sweep()
    expect(seen).toEqual([
      { phase: 'connected', lastSeenAt: base + 3_000 },
      { phase: 'connected', lastSeenAt: base + 4_000 },
    ])
    service.sweep()
    expect(seen).toHaveLength(2)
  })

  it('keeps structural notifications immediate (accept and revoke broadcast without a sweep)', () => {
    const service = makeService()
    const { token } = service.issue()
    const seen: number[] = []
    service.onState(snapshot => { seen.push(snapshot.deviceCount) })
    const accepted = service.accept(token)
    expect(accepted.ok).toBe(true)
    expect(seen).toEqual([1])
    const deviceId = accepted.ok ? accepted.deviceId : ''
    expect(service.revoke(deviceId)).toBe(true)
    expect(seen).toEqual([1, 0])
  })

  it('evicts the oldest device at the session cap', () => {
    const service = makeService({ maxDevices: 2 })
    const first = service.issue()
    const a = service.accept(first.token)
    const second = service.issue()
    const b = service.accept(second.token)
    const third = service.issue()
    const c = service.accept(third.token)
    const aId = a.ok ? a.deviceId : ''
    const bId = b.ok ? b.deviceId : ''
    const cId = c.ok ? c.deviceId : ''
    expect(service.hasDevice(aId)).toBe(false)
    expect(service.hasDevice(bId)).toBe(true)
    expect(service.hasDevice(cId)).toBe(true)
    expect(service.snapshot().deviceCount).toBe(2)
  })

  it('sweep deletes a session idle longer than idleExpireMs', () => {
    const service = makeService({ idleExpireMs: 60_000 })
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    now += 60_001
    service.sweep()
    expect(service.hasDevice(deviceId)).toBe(false)
    expect(service.snapshot().deviceCount).toBe(0)
  })

  it('touchDevice refuses an idle cookie without waiting for sweep', () => {
    const service = makeService({ idleExpireMs: 60_000 })
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    now += 60_001
    expect(service.touchDevice(deviceId)).toBe(false)
    expect(service.hasDevice(deviceId)).toBe(false)
  })

  it('revoke drops one device and leaves the others', () => {
    const service = makeService({ maxDevices: 4 })
    const first = service.issue()
    const a = service.accept(first.token)
    const second = service.issue()
    const b = service.accept(second.token)
    const aId = a.ok ? a.deviceId : ''
    const bId = b.ok ? b.deviceId : ''
    expect(service.revoke(aId)).toBe(true)
    expect(service.hasDevice(aId)).toBe(false)
    expect(service.hasDevice(bId)).toBe(true)
    expect(service.revoke('missing')).toBe(false)
  })

  it('surfaces devices in the snapshot with sanitized User-Agent', () => {
    const service = makeService()
    const { token } = service.issue()
    service.accept(token, 'Mozilla/5.0 Phone')
    const [device] = service.snapshot().devices
    expect(device).toMatchObject({ online: true, userAgent: 'Mozilla/5.0 Phone' })
    expect(device?.id).toMatch(/^tok-/)
  })
})
