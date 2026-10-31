/**
 * The LAN-bind status frame `GET /api/pair/lan-bind` serves (issue #1917).
 *
 * The frame used to describe a managed block the boot re-assert wrote into the
 * profile. It now describes the runtime LAN edge: the address the forwarder
 * listens on, why it is off, and what the removed legacy block was. These specs
 * hold the contract the card reads, including the two states the incident
 * needed and did not have - a failed bind that is reported instead of bricking,
 * and a forwarder that yields to an explicit `--host`.
 */
import { describe, expect, it } from 'vitest'
import { forwardPlanOf, type LanBindCapability } from '../src/host/lan-bind-plan.ts'
import { IDLE_FORWARD_STATE, type LanForwardState } from '../src/host/lan-forward.ts'
import { lanBindFrameOf, type LanBindFrameInput } from '../src/index.ts'

/** No firewall manager on this platform, so the frame never probes the real OS. */
const NO_FIREWALL = { ok: true, managed: false } as const

/** The forwarder while it serves the LAN address. */
const LISTENING_FORWARD: LanForwardState = {
  listening: true,
  address: '192.168.1.5',
  port: 3080,
  upstreamPort: 3080,
  error: undefined,
}

/** The forwarder after a bind that could not be taken. */
const FAILED_FORWARD: LanForwardState = {
  listening: false,
  address: '192.168.1.5',
  port: 3080,
  upstreamPort: 3080,
  error: 'EADDRINUSE: listen EADDRINUSE: address already in use 192.168.1.5:3080',
}

/**
 * The frame input one test pins, with the neutral defaults the other fields
 * would otherwise carry.
 * @param overrides - the fields this test pins.
 * @returns the input the frame is built from.
 */
function inputOf(overrides: Partial<LanBindFrameInput>): LanBindFrameInput {
  return {
    profile: 'web',
    setting: undefined,
    blockHost: undefined,
    bindHost: '127.0.0.1',
    forward: IDLE_FORWARD_STATE,
    forwardReason: 'off',
    legacyBlockRemoved: false,
    port: 3080,
    wildcardSupported: false,
    candidates: ['192.168.1.5', '10.0.0.3'],
    startupHost: undefined,
    ...overrides,
  }
}

describe('the LAN edge the frame plans', () => {
  it('operator: the toggle on plans this machine first LAN address', () => {
    // Given a host whose web server stays on loopback and two interfaces
    // When the status frame is built with the toggle on
    // Then the planned listen address is the first candidate, and it is never
    // the wildcard (that would collide with the loopback listener)
    const frame = lanBindFrameOf(inputOf({ setting: true }), () => NO_FIREWALL)
    expect(frame).toMatchObject({
      profile: 'web',
      setting: true,
      desiredHost: '192.168.1.5',
      supportedHosts: ['192.168.1.5', '10.0.0.3'],
      lanBlocked: false,
    })
  })

  it('operator: a machine with no LAN address reports the blocked toggle', () => {
    // Given no advertisable IPv4 address
    // When the toggle is on
    // Then nothing is planned and lanBlocked says why, so the card explains the
    // state instead of showing a dead toggle
    const frame = lanBindFrameOf(inputOf({ setting: true, candidates: [] }), () => NO_FIREWALL)
    expect(frame).toMatchObject({ desiredHost: null, supportedHosts: [], lanBlocked: true, lanUrls: [] })
  })

  it('operator: a non-loopback --host makes the frame report the yield, not a fault', () => {
    // Given the toggle on and a --host that binds the network itself
    // When the frame is built
    // Then nothing is planned here, the reason names the yield, and the state
    // is not called blocked: LAN access comes from the host's own bind
    const frame = lanBindFrameOf(inputOf({
      setting: true,
      startupHost: '192.168.1.5',
      bindHost: '192.168.1.5',
      forwardReason: 'host-bind',
    }), () => NO_FIREWALL)
    expect(frame).toMatchObject({ desiredHost: null, lanBlocked: false })
    expect(frame.forward).toMatchObject({ listening: false, reason: 'host-bind' })
    expect(frame.lanUrls).toEqual(['http://192.168.1.5:3080'])
  })

  it('operator: an untouched toggle plans nothing', () => {
    // Given a profile whose toggle was never flipped
    // When the status frame is built
    // Then no address is planned and the setting reads null
    const frame = lanBindFrameOf(inputOf({ setting: undefined }), () => NO_FIREWALL)
    expect(frame).toMatchObject({ setting: null, desiredHost: null, lanBlocked: false })
    expect(forwardPlanOf(undefined, undefined, { wildcardSupported: false, candidates: [] }))
      .toEqual({ host: undefined, reason: 'off' })
  })
})

describe('the frame reports the LAN edge itself', () => {
  it('operator: a listening forwarder is the address the card shows and the URL it advertises', () => {
    // Given the forwarder serving the LAN address on the server's own port
    // When the frame is built
    // Then bindHost names that address (it is what a phone dials), the local
    // loopback bind stays visible beside it, and the LAN URL points there
    const frame = lanBindFrameOf(inputOf({ setting: true, forward: LISTENING_FORWARD }), () => NO_FIREWALL)
    expect(frame).toMatchObject({
      bindHost: '192.168.1.5',
      localBindHost: '127.0.0.1',
      port: 3080,
      pendingRestart: false,
    })
    expect(frame.lanUrls).toEqual(['http://192.168.1.5:3080'])
    expect(frame.forward).toEqual({
      listening: true,
      host: '192.168.1.5',
      port: 3080,
      reason: null,
      error: null,
    })
  })

  // Issue #1917 (c) on the reporting side: a bind that could not be taken is a
  // stated reason, never a crash and never a silent "on".
  it('operator: a failed bind is reported while loopback stays the advertised address', () => {
    // Given a forwarder whose bind failed (the address is gone, the port taken)
    // When the frame is built
    // Then the error text is on the frame, nothing LAN is advertised, the card
    // still shows the loopback bind, and no restart is asked for
    const frame = lanBindFrameOf(inputOf({ setting: true, forward: FAILED_FORWARD }), () => NO_FIREWALL)
    expect(frame).toMatchObject({ bindHost: '127.0.0.1', lanUrls: [], pendingRestart: false })
    expect(frame.forward).toMatchObject({
      listening: false,
      host: '192.168.1.5',
      error: 'EADDRINUSE: listen EADDRINUSE: address already in use 192.168.1.5:3080',
    })
  })

  it('operator: a removed legacy block is visible on the frame', () => {
    // Given this process removed the block a previous version wrote
    // When the frame is built
    // Then the cleanup is stated, so the card can show it (the wording lands
    // with the client/i18n follow-up) and no block host is claimed
    const frame = lanBindFrameOf(inputOf({ legacyBlockRemoved: true }), () => NO_FIREWALL)
    expect(frame).toMatchObject({ legacyBlockRemoved: true, blockHost: null })
  })

  it('operator: the firewall summary is read with LAN on only while the edge serves', () => {
    // Given a listening forwarder and then a failed bind
    // When the frame is built
    // Then the summary is read with LAN on for the first and off for the second
    const seen: boolean[] = []
    const read = (_port: number, lanOn: boolean): typeof NO_FIREWALL => {
      seen.push(lanOn)
      return NO_FIREWALL
    }
    lanBindFrameOf(inputOf({ setting: true, forward: LISTENING_FORWARD }), read)
    lanBindFrameOf(inputOf({ setting: true, forward: FAILED_FORWARD }), read)
    expect(seen).toEqual([true, false])
  })

  it('operator: the frame keeps every field the card already reads, plus the new ones', () => {
    // Given a settled frame
    // When its fields are read back
    // Then every pre-existing name is still there and the new LAN-edge fields
    // sit beside them
    const frame = lanBindFrameOf(inputOf({ setting: true, forward: LISTENING_FORWARD }), () => NO_FIREWALL)
    expect(Object.keys(frame).sort()).toEqual([
      'bindHost',
      'blockHost',
      'desiredHost',
      'firewall',
      'forward',
      'lanBlocked',
      'lanUrls',
      'legacyBlockRemoved',
      'localBindHost',
      'pendingRestart',
      'platform',
      'port',
      'profile',
      'setting',
      'supportedHosts',
      'wildcardSupported',
    ])
    expect(frame).toMatchObject({
      profile: 'web',
      setting: true,
      blockHost: null,
      bindHost: '192.168.1.5',
      port: 3080,
      platform: process.platform,
      firewall: NO_FIREWALL,
    })
  })
})

/** The candidates the plan helpers are read with in this file. */
const CAPABILITY: LanBindCapability = { wildcardSupported: false, candidates: ['192.168.1.5', '10.0.0.3'] }

describe('the frame and the planner agree', () => {
  it('operator: the planned address on the frame is the one the forwarder would bind', () => {
    // Given the same facts the frame and the sync path read
    // When both compute the LAN edge
    // Then they name the same address, so the card never explains a listener
    // the sync path would not have started
    const plan = forwardPlanOf(true, undefined, CAPABILITY)
    const frame = lanBindFrameOf(inputOf({ setting: true, candidates: CAPABILITY.candidates }), () => NO_FIREWALL)
    expect(frame.desiredHost).toBe(plan.host)
  })
})
