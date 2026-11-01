/**
 * `relay.tier.v1` on the wire: what a default host answers, what a host with a
 * second meeting point answers, and where the grant a phone hands over lands.
 *
 * The default host is the half of this file that matters most. Its greeting, its
 * capability list and its refusal of `relay.grant` have to be exactly what they
 * were before this channel existed, because every host that configures nothing is
 * a host whose phones would otherwise read a name and start sending a frame.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAP_RELAY_TIER, MINOR, SERVED_CAPABILITIES } from '../src/core/protocol.ts'
import { DeviceRoster, ROSTER_VERSION } from '../src/core/devices.ts'
import type { RelayTierFace } from '../src/core/connection.ts'
import { answerOf, makeConnection, requestFrame } from './support/harness.ts'

const ID = 'abcd1234abcd1234'
const SUFFIX = '.relay.chatwithai.icu'
const ORIGIN = 'wss://' + ID + SUFFIX
const GRANT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.grant-body.signature'

/** The device id the harness's paired connection proves. */
const DEVICE_ID = 'dev_harness'
/** The millisecond clock the roster stores its epoch seconds from. */
const NOW_MS = 1_700_000_000_000
/** …which is this epoch second, the value a row must carry. */
const NOW_S = 1_700_000_000

/** One roster row in the shape the file carries. */
function rowOf(index = 0): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    pubKey: 'spki-' + String(index),
    fingerprint: 'fingerprint-' + String(index),
    createdAt: NOW_MS + index,
    lastSeenAt: NOW_MS + index,
    tokenHash: 'hash-' + String(index),
  }
}

/** A temporary roster path under a fresh directory. */
async function rosterFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-tier-'))
  return join(directory, 'remote-bridge', 'devices.json')
}

/** Write one roster file, creating the directory it lives in. */
async function writeRoster(file: string, body: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body), 'utf8')
}

/** A roster loaded from one file, on a fixed clock. */
async function loadedRoster(file: string): Promise<DeviceRoster> {
  const roster = new DeviceRoster({ file, now: () => NOW_MS })
  await roster.load()
  return roster
}

/**
 * The second meeting point a suite hands the bridge.
 * @param origin - what the host announces right now; undefined models a host with no lease.
 * @returns the face, plus the count of times it was asked to re-claim.
 */
function faceOf(origin: () => string | undefined): RelayTierFace & { readonly reclaims: number[] } {
  const reclaims: number[] = []
  const face = {
    origin,
    grantLanded(): void { reclaims.push(reclaims.length + 1) },
  }
  return { ...face, reclaims }
}

describe('the greeting of a host with one meeting point', () => {
  it('user greets a default host and reads exactly the greeting it always read', async () => {
    // Given a bridge mounted with no second meeting point at all
    const harness = makeConnection()
    // When the client greets
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // Then the answer is the frozen body, key for key: no relay announcement, and
    // the capability list is the served one and nothing else
    expect(answerOf(harness, 1).r).toEqual({
      proto: 1,
      minor: MINOR,
      server: 'dsh-remote-bridge',
      capabilities: [...SERVED_CAPABILITIES],
      resume: 'snapshot',
      auth: 'unpaired',
    })
    const hello = answerOf(harness, 1).r as { capabilities: string[]; relay?: unknown }
    expect('relay' in hello).toBe(false)
    expect(hello.capabilities).not.toContain(CAP_RELAY_TIER)
  })

  it('user sends a grant to a default host and the method does not exist for it', async () => {
    // Given a host with no second meeting point, and connections in both states
    const unpaired = makeConnection()
    const paired = makeConnection({ paired: true })
    // When each sends the tier channel's frame
    await unpaired.connection.handleText(requestFrame(2, 'relay.grant', { grant: GRANT }))
    await paired.connection.handleText(requestFrame(3, 'relay.grant', { grant: GRANT }))
    // Then both are told what they were told before the channel existed, whether
    // or not they carry a device token
    expect(answerOf(unpaired, 2).e?.code).toBe('unknown-method')
    expect(answerOf(paired, 3).e?.code).toBe('unknown-method')
  })
})

describe('the greeting of a host with a second meeting point', () => {
  it('operator configures the second meeting point and the greeting announces its origin beside the tier name', async () => {
    // Given a bridge holding a second lease on the configured suffix
    const face = faceOf(() => ORIGIN)
    const harness = makeConnection({ relay: face })
    // When the client greets
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // Then the tier name follows the served list, and the origin is on the answer
    const hello = answerOf(harness, 1).r as { capabilities: string[]; relay?: { origin: string } }
    expect(hello.capabilities.slice(0, SERVED_CAPABILITIES.length)).toEqual([...SERVED_CAPABILITIES])
    expect(hello.capabilities[SERVED_CAPABILITIES.length]).toBe(CAP_RELAY_TIER)
    expect(hello.capabilities).toHaveLength(SERVED_CAPABILITIES.length + 1)
    expect(hello.relay).toEqual({ origin: ORIGIN })
  })

  it('operator holds no second lease yet and the announcement is absent while the name stays', async () => {
    // Given a bridge configured with a second meeting point that holds no lease
    const harness = makeConnection({ relay: faceOf(() => undefined) })
    // When the client greets
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // Then no origin is announced — an address nobody serves is worse than none —
    // while the name still tells the phone the frame exists
    const hello = answerOf(harness, 1).r as { capabilities: string[]; relay?: unknown }
    expect('relay' in hello).toBe(false)
    expect(hello.capabilities).toContain(CAP_RELAY_TIER)
  })
})

describe('handing a grant over on a paired connection', () => {
  it('user sends its grant and the device row records it with the second it arrived', async () => {
    // Given a paired connection over a real roster file, and a host with a second
    // meeting point
    const file = await rosterFile()
    await writeRoster(file, { version: ROSTER_VERSION, devices: [rowOf()] })
    const roster = await loadedRoster(file)
    const face = faceOf(() => undefined)
    const harness = makeConnection({ paired: true, roster, relay: face })
    // When the phone hands the grant over
    await harness.connection.handleText(requestFrame(2, 'relay.grant', { grant: GRANT }))
    // Then the frame is acknowledged, the row carries the text and the epoch second,
    // and the host was asked to claim the second meeting point again
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    const written = JSON.parse(await readFile(file, 'utf8')) as { version: number; devices: { relay?: unknown }[] }
    expect(written.version).toBe(ROSTER_VERSION)
    expect(written.devices[0]?.relay).toEqual({ grant: GRANT, receivedAt: NOW_S })
    expect(roster.relayGrant()).toEqual({ grant: GRANT, receivedAt: NOW_S })
    expect(face.reclaims).toEqual([1])
  })

  it('user sends a grant on an unpaired connection and is told it is not paired', async () => {
    // Given a host with a second meeting point and a connection carrying no token
    const file = await rosterFile()
    await writeRoster(file, { version: ROSTER_VERSION, devices: [rowOf()] })
    const roster = await loadedRoster(file)
    const harness = makeConnection({ roster, relay: faceOf(() => undefined) })
    // When that connection sends the frame
    await harness.connection.handleText(requestFrame(2, 'relay.grant', { grant: GRANT }))
    // Then the pairing gate answers it, and no row gained a grant
    expect(answerOf(harness, 2).e?.code).toBe('unpaired')
    expect(roster.relayGrant()).toBeUndefined()
    const written = JSON.parse(await readFile(file, 'utf8')) as { devices: { relay?: unknown }[] }
    expect(written.devices[0]?.relay).toBeUndefined()
  })

  it('user sends a grant that is not a string and nothing is written', async () => {
    // Given a paired connection over a roster with no grant
    const file = await rosterFile()
    await writeRoster(file, { version: ROSTER_VERSION, devices: [rowOf()] })
    const roster = await loadedRoster(file)
    const face = faceOf(() => undefined)
    const harness = makeConnection({ paired: true, roster, relay: face })
    // When the frame carries something the account service would never issue
    await harness.connection.handleText(requestFrame(2, 'relay.grant', { grant: 7 }))
    // Then it is refused as bad arguments, the row stays as it was, and no claim
    // was asked for on its behalf
    expect(answerOf(harness, 2).e?.code).toBe('invalid-args')
    expect(roster.relayGrant()).toBeUndefined()
    expect(face.reclaims).toEqual([])
  })
})

describe('the roster a grant arrives in', () => {
  it('operator opens a version-3 table and every phone survives into version 4', async () => {
    // Given a version-3 table with two paired phones and a registration on one
    const file = await rosterFile()
    await writeRoster(file, {
      version: 3,
      devices: [
        { ...rowOf(0), push: { deviceToken: 'ff00', environment: 'sandbox', bundle: 'com.example.app', registeredAt: NOW_MS } },
        rowOf(1),
      ],
    })
    // When it is read
    const roster = await loadedRoster(file)
    // Then both phones are there with every field they had, and the file itself was
    // left alone: reading an older schema writes nothing
    expect(roster.devices()).toHaveLength(2)
    expect(roster.pushTargets()).toHaveLength(1)
    const untouched = JSON.parse(await readFile(file, 'utf8')) as { version: number }
    expect(untouched.version).toBe(3)
    // When the next write happens (a phone hands a grant over)
    const harness = makeConnection({ paired: true, roster, relay: faceOf(() => undefined) })
    await harness.connection.handleText(requestFrame(2, 'relay.grant', { grant: GRANT }))
    // Then the file is version 4, the old fields are all still there, and the grant
    // rides on the row that proved itself
    const written = JSON.parse(await readFile(file, 'utf8')) as {
      version: number
      devices: { deviceId: string; push?: Record<string, unknown>; relay?: unknown }[]
    }
    expect(written.version).toBe(4)
    expect(written.devices).toHaveLength(2)
    expect(written.devices[0]?.deviceId).toBe(DEVICE_ID)
    expect(written.devices[0]?.push).toMatchObject({ deviceToken: 'ff00', bundle: 'com.example.app', registeredAt: NOW_MS })
    expect(written.devices[0]?.relay).toEqual({ grant: GRANT, receivedAt: NOW_S })
    expect(written.devices[1]?.relay).toBeUndefined()
  })

  it('operator holds two grants and the newest one is the one the host claims with', async () => {
    // Given a table where two phones each handed a grant over, one later than the other
    const file = await rosterFile()
    await writeRoster(file, {
      version: 4,
      devices: [
        { ...rowOf(0), relay: { grant: 'older', receivedAt: NOW_S - 60 } },
        { ...rowOf(1), relay: { grant: 'newer', receivedAt: NOW_S } },
      ],
    })
    // When the roster is read
    const roster = await loadedRoster(file)
    // Then the newest grant is the one a claim carries: one host holds one second
    // lease, and the phone that just handed a grant over is the one being claimed for
    expect(roster.relayGrant()).toEqual({ grant: 'newer', receivedAt: NOW_S })
  })
})
