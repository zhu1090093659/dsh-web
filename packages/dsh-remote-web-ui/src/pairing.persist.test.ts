/**
 * PairingService device-session persistence: with `devicesFile` set, sessions
 * written on accept/stop survive a process restart (a new PairingService
 * instance), so a previously paired phone — whose cookie already lives 365
 * days — never needs to re-scan the QR after `dsh web` restarts.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PairingService, type PairingClock, type PairingConfig } from './pairing.ts'

const BASE_CONFIG: Omit<PairingConfig, 'devicesFile'> = {
  tokenTtlMs: 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  cookieName: 'dsh_pair',
}

/** Deterministic clock: tokens are issued in a fixed, readable sequence. */
function makeClock(): PairingClock {
  let n = 0
  return {
    now: () => 1_000_000 + n,
    randomToken: () => `tok${(n++).toString().padStart(6, '0')}`,
  }
}

/** Pair a device on a service: issue a token and immediately accept it. */
function pairDevice(service: PairingService): string {
  service.setPublicBaseUrl('https://pairing.example.trycloudflare.com')
  const { token } = service.issue()
  const result = service.accept(token)
  if (!result.ok) throw new Error(`pair failed: ${result.code}`)
  return result.deviceId
}

describe('PairingService device persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remote-web-ui-persist-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('restores paired sessions across a process restart', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    const deviceId = pairDevice(first)
    expect(readFileSync(file, 'utf8')).toContain(deviceId)

    // Simulated restart: a brand-new service instance reading the same file.
    const second = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(true)
  })

  it('keeps sessions memory-only when devicesFile is unset', () => {
    const first = new PairingService({ ...BASE_CONFIG }, makeClock())
    const deviceId = pairDevice(first)
    // No file was written; a fresh instance without the option knows nothing.
    const second = new PairingService({ ...BASE_CONFIG }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(false)
  })

  it('persists revocation by stop() across a restart', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    const deviceId = pairDevice(first)
    first.stop()

    const second = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(false)
  })

  it('persists FIFO eviction when the device cap is reached', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, makeClock())
    const firstDevice = pairDevice(first)
    const secondDevice = pairDevice(first)
    const thirdDevice = pairDevice(first) // evicts firstDevice
    expect(first.hasDevice(firstDevice)).toBe(false)

    const second = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, makeClock())
    expect(second.hasDevice(secondDevice)).toBe(true)
    expect(second.hasDevice(thirdDevice)).toBe(true)
    expect(second.hasDevice(firstDevice)).toBe(false)
  })

  it('tolerates a corrupt or missing file instead of refusing to boot', () => {
    const file = join(dir, 'devices.json')
    writeFileSync(file, '{ this is not json !!!')
    expect(() => new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())).not.toThrow()

    const ghost = join(dir, 'does-not-exist.json')
    expect(() => new PairingService({ ...BASE_CONFIG, devicesFile: ghost }, makeClock())).not.toThrow()
  })
})