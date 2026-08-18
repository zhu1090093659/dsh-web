/** The api/gate policy: loopback passes, remote requests need a live cookie. */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { PairingService } from '../src/pairing.ts'
import { makeGateListener, readCookie, isPairedDeviceRequest } from '../src/gate.ts'

function request(headers: Record<string, string>, remoteAddress = '127.0.0.1'): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage
  Object.assign(req, { headers, socket: { remoteAddress } })
  return req
}

function makeService(cookieName = 'dsh_pair'): PairingService {
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 4,
    cookieName,
  }, {
    now: () => 1_000_000,
    randomToken: () => 'tok-1',
  })
  service.setLanBases([{ address: '192.168.1.5', base: 'http://192.168.1.5:3080' }])
  return service
}

describe('makeGateListener', () => {
  it('passes loopback requests without a device identity', () => {
    const service = makeService()
    const gate = makeGateListener(service)
    let delegated = false
    const result = gate(request({ host: '127.0.0.1:3080' }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(true)
    expect(delegated).toBe(true)
  })

  it('vetoes a spoofed loopback Host from a non-loopback remote address', () => {
    const service = makeService()
    const gate = makeGateListener(service)
    let delegated = false
    const result = gate(request({ host: '127.0.0.1:3080' }, '203.0.113.7'), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(false)
    expect(delegated).toBe(false)
  })

  it('vetoes a non-loopback request without a device cookie', () => {
    const service = makeService()
    const gate = makeGateListener(service)
    let delegated = false
    const result = gate(request({ host: '192.168.1.5:3080' }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(false)
    expect(delegated).toBe(false)
  })

  it('passes a paired device and records its activity', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    expect(accepted.ok).toBe(true)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    const gate = makeGateListener(service)
    let delegated = false
    const result = gate(request({ host: '192.168.1.5:3080', cookie: `dsh_pair=${deviceId}` }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(true)
    expect(delegated).toBe(true)
    expect(service.snapshot().phase).toBe('connected')
  })

  it('vetoes a revoked device (after stop)', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    service.stop()
    const gate = makeGateListener(service)
    let delegated = false
    const result = gate(request({ host: '192.168.1.5:3080', cookie: `dsh_pair=${deviceId}` }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(false)
    expect(delegated).toBe(false)
  })

  it('vetoes an unknown device id', () => {
    const service = makeService()
    const gate = makeGateListener(service)
    const result = gate(request({ host: '192.168.1.5:3080', cookie: 'dsh_pair=unknown' }), 'session.list', () => true)
    expect(result).toBe(false)
  })

  it('passes remote requests when requirePairingForLan is off', () => {
    const service = makeService()
    const gate = makeGateListener(service, false)
    const result = gate(request({ host: '192.168.1.5:3080' }), 'session.list', () => true)
    expect(result).toBe(true)
  })

  it('re-reads requirePairingForLan per request', () => {
    const service = makeService()
    let require = true
    const gate = makeGateListener(service, () => require)
    let delegated = false
    expect(gate(request({ host: '192.168.1.5:3080' }), 'session.list', () => { delegated = true; return true })).toBe(false)
    require = false
    expect(gate(request({ host: '192.168.1.5:3080' }), 'session.list', () => { delegated = true; return true })).toBe(true)
    expect(delegated).toBe(true)
  })

  it('vetoes non-loopback requests while the plugin is disabled', () => {
    const service = makeService()
    const gate = makeGateListener(service, true, () => false)
    let delegated = false
    const result = gate(request({ host: '192.168.1.5:3080' }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(false)
    expect(delegated).toBe(false)
  })

  it('keeps loopback available while the plugin is disabled', () => {
    const service = makeService()
    const gate = makeGateListener(service, true, () => false)
    let delegated = false
    const result = gate(request({ host: '127.0.0.1:3080' }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(true)
    expect(delegated).toBe(true)
  })

  it('re-enabling restores pairing after stop', () => {
    const service = makeService()
    const gate = makeGateListener(service, true, () => true)
    service.stop()
    const { token } = service.issue()
    const accepted = service.accept(token)
    expect(accepted.ok).toBe(true)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    let delegated = false
    const result = gate(request({ host: '192.168.1.5:3080', cookie: `dsh_pair=${deviceId}` }), 'session.list', () => { delegated = true; return true })
    expect(result).toBe(true)
    expect(delegated).toBe(true)
  })

  it('vetoes a request with an unparsable Host', () => {
    const service = makeService()
    const gate = makeGateListener(service)
    expect(gate(request({ host: ':::' }), 'session.list', () => true)).toBe(false)
  })
})

describe('readCookie', () => {
  it('finds a cookie among others and trims whitespace', () => {
    expect(readCookie('a=1; dsh_pair=  abc ; b=2', 'dsh_pair')).toBe('abc')
    expect(readCookie(undefined, 'dsh_pair')).toBeUndefined()
    expect(readCookie('a=1', 'dsh_pair')).toBeUndefined()
  })
})

describe('isPairedDeviceRequest', () => {
  it('refuses a request with no device cookie', () => {
    const service = makeService()
    expect(isPairedDeviceRequest(service, request({ host: 'dsh.example:443' }, '203.0.113.7'))).toBe(false)
  })

  it('accepts a live paired cookie and records activity', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    expect(isPairedDeviceRequest(
      service,
      request({ host: 'dsh.example:443', cookie: `dsh_pair=${deviceId}` }, '203.0.113.7'),
    )).toBe(true)
    expect(service.snapshot().phase).toBe('connected')
  })

  it('refuses a cookie after stop()', () => {
    const service = makeService()
    const { token } = service.issue()
    const accepted = service.accept(token)
    const deviceId = accepted.ok ? accepted.deviceId : ''
    service.stop()
    expect(isPairedDeviceRequest(
      service,
      request({ host: 'dsh.example:443', cookie: `dsh_pair=${deviceId}` }, '203.0.113.7'),
    )).toBe(false)
  })
})
