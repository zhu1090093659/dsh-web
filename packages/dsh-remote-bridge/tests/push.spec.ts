import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRoster, ROSTER_VERSION, type PushRegistration } from '../src/core/devices.ts'
import { CAP_PUSH, MINOR } from '../src/core/protocol.ts'
import {
  PUSH_APPROVAL_CATEGORY,
  PUSH_DEDUPE_MS,
  PUSH_GLOBAL_PER_MINUTE,
  PUSH_SESSION_INTERVAL_MS,
  PushNotifier,
  buildPushNotification,
  pushEventOfTurnEnd,
  type PushAddress,
  type PushNotification,
  type PushSendResult,
} from '../src/core/push.ts'
import { APNS_ENV, apnsConfigFromEnv, apnsRequestSpec, es256Jwt } from '../src/host/apns.ts'
import { ControllableStream, answerOf, makeConnection, makeHub, requestFrame, settle, type ConnectionHarness } from './support/harness.ts'

/** One follow record as DSH writes it. */
function record(type: string, seq: number, time: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time, data } }
}

/** A recording sender: what the notifier actually asked to deliver, in order. */
interface Recorder {
  readonly sent: { readonly target: PushAddress; readonly notification: PushNotification }[]
  readonly sender: { send(target: PushAddress, notification: PushNotification): Promise<PushSendResult> }
}

function recorder(): Recorder {
  const sent: { target: PushAddress; notification: PushNotification }[] = []
  return {
    sent,
    sender: {
      async send(target, notification) {
        sent.push({ target, notification })
        return { ok: true, status: 200 }
      },
    },
  }
}

/** The one device a notification in these suites is addressed to. */
const PHONE: PushAddress = { deviceToken: 'aabbccdd', environment: 'sandbox', bundle: 'dev.dsh.Whale' }

/** A notifier over one fixed address list and a clock the suite owns. */
function notifierAt(sender: Recorder['sender'] | undefined, clock: { now: number }): PushNotifier {
  return new PushNotifier({
    targets: () => [PHONE],
    ...(sender === undefined ? {} : { sender }),
    titles: id => (id === 's-1' ? '重构推送通道' : undefined),
    now: () => clock.now,
  })
}

/** A registration as a phone would send it. */
const REGISTRATION: PushRegistration = {
  deviceToken: 'aabbccdd',
  environment: 'sandbox',
  bundle: 'dev.dsh.Whale',
  registeredAt: 1_700_000_000_000,
}

async function rosterFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-push-'))
  return join(directory, 'remote-bridge', 'devices.json')
}

/** One roster row in the shape every probe entry of a real table has. */
function legacyRow(index: number): Record<string, unknown> {
  return {
    deviceId: `dev_probe${index}`,
    pubKey: `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE${index}`,
    fingerprint: `fingerprint-${index}`,
    createdAt: 1_700_000_000_000 + index,
    lastSeenAt: 1_700_000_000_000 + index,
    tokenHash: `hash-${index}`,
  }
}

/** The one row a harness connection is paired as ({@link makeConnection}'s own id). */
function harnessRow(): Record<string, unknown> {
  return { ...legacyRow(0), deviceId: 'dev_harness' }
}

/** Write one roster file, creating the directory it lives in. */
async function writeRoster(file: string, body: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body), 'utf8')
}

/** Declare one capability on a connection. */
async function declare(harness: ConnectionHarness, capability: string = CAP_PUSH, id = 1): Promise<void> {
  await harness.connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: [capability] }))
}

/** Open one session's follow stream and hand it back for the suite to push into. */
async function follow(harness: ConnectionHarness, sessionId = 's-1'): Promise<ControllableStream> {
  const stream = new ControllableStream()
  harness.gateway.follow = call => stream.attach(call.signal).iterable()
  const pending = harness.connection.handleText(requestFrame(90, 'session.snapshot', { sessionId }))
  stream.push({ type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] })
  await pending
  return stream
}

describe('push channel: the provider token and the delivery request', () => {
  it('operator reads a token whose header, claims and signature are the ones APNs accepts', () => {
    // Given a P-256 key generated here, so nothing depends on Apple or the network
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    // When one provider token is signed
    const jwt = es256Jwt({ key: pair.privateKey, keyId: 'ABC123DEFG', teamId: 'TEAM123456', issuedAt: 1_700_000_000_000 })
    // Then the header names ES256 and the key id, and the claims name the team and the issue second
    const [header, claims, signature] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 })
    // And the signature verifies over the signing input with the matching public key
    const verified = cryptoVerify(
      'sha256',
      Buffer.from(`${header}.${claims}`, 'utf8'),
      { key: pair.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(verified).toBe(true)
  })

  it('operator reads the delivery request and finds the bundle as the topic and an alert type', () => {
    // Given one production registration and one sandbox registration
    // When each one's delivery request is built
    const production = apnsRequestSpec({ ...PHONE, environment: 'production' }, 'jwt')
    const sandbox = apnsRequestSpec({ ...PHONE, environment: 'sandbox' }, 'jwt')
    // Then the environment chooses the authority, and the token is the path
    expect(production.authority).toBe('api.push.apple.com')
    expect(sandbox.authority).toBe('api.sandbox.push.apple.com')
    expect(production.path).toBe('/3/device/aabbccdd')
    // And the topic is the client's own bundle id, the type is alert, the token is a bearer
    expect(production.headers['apns-topic']).toBe('dev.dsh.Whale')
    expect(production.headers['apns-push-type']).toBe('alert')
    expect(production.headers.authorization).toBe('bearer jwt')
  })

  it('operator runs without a signing key and the channel is off', () => {
    // Given an environment naming no credential, and one naming part of it
    // When each is read back as a credential
    const absent = apnsConfigFromEnv({})
    const partial = apnsConfigFromEnv({ [APNS_ENV.keyFile]: '/tmp/key.p8', [APNS_ENV.keyId]: 'ABC123DEFG' })
    const complete = apnsConfigFromEnv({
      [APNS_ENV.keyFile]: '/tmp/key.p8',
      [APNS_ENV.keyId]: 'ABC123DEFG',
      [APNS_ENV.teamId]: 'TEAM123456',
    })
    // Then an incomplete credential is no credential, and a complete one is read verbatim
    expect(absent).toBeUndefined()
    expect(partial).toBeUndefined()
    expect(complete).toEqual({ keyFile: '/tmp/key.p8', keyId: 'ABC123DEFG', teamId: 'TEAM123456' })
  })
})

describe('push channel: the device table', () => {
  it('operator opens a roster written before this channel and every historical row survives', async () => {
    // Given a version-1 table of the 179 probe rows a live bridge actually holds
    const file = await rosterFile()
    const rows = Array.from({ length: 179 }, (_, index) => legacyRow(index))
    await writeRoster(file, { version: 1, devices: rows })
    const roster = new DeviceRoster({ file })
    // When it is read
    await roster.load()
    // Then every row is still a paired device and none of them asks for a notification
    expect(roster.devices()).toHaveLength(179)
    expect(roster.pushTargets()).toEqual([])
    // When one device registers
    const registered = await roster.registerPush('dev_probe7', REGISTRATION)
    // Then the write lands on that row alone
    expect(registered).toBe(true)
    const written = JSON.parse(await readFile(file, 'utf8')) as { version: number; devices: Record<string, unknown>[] }
    expect(written.version).toBe(ROSTER_VERSION)
    expect(written.devices).toHaveLength(179)
    expect(written.devices[7]?.push).toMatchObject({ deviceToken: 'aabbccdd', environment: 'sandbox' })
    expect(written.devices[8]?.push).toBeUndefined()
    // And a fresh process reads the registration back with every other row intact
    const reloaded = new DeviceRoster({ file })
    await reloaded.load()
    expect(reloaded.devices()).toHaveLength(179)
    expect(reloaded.pushTargets()).toEqual([{ deviceId: 'dev_probe7', push: REGISTRATION }])
  })

  it('operator finds one unreadable push block and the row keeps its identity', async () => {
    // Given a table whose one row carries a broken registration
    const file = await rosterFile()
    const row = legacyRow(0)
    await writeRoster(file, { version: 2, devices: [{ ...row, push: { deviceToken: '', environment: 'staging' } }] })
    const logs: string[] = []
    const roster = new DeviceRoster({ file, log: message => { logs.push(message) } })
    // When it is read
    await roster.load()
    // Then the device is still paired, it is simply not a notification target
    expect(roster.devices()).toHaveLength(1)
    expect(roster.pushTargets()).toEqual([])
    // And the file was not quarantined away: one unreadable token must not un-pair a phone
    const entries = await readdir(dirname(file))
    expect(entries).toEqual(['devices.json'])
    expect(logs.some(line => line.includes('unreadable push block'))).toBe(true)
  })

  it('operator registers twice and the second registration is the one kept', async () => {
    // Given a device that already registered
    const file = await rosterFile()
    await writeRoster(file, { version: 1, devices: [legacyRow(0)] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    await roster.registerPush('dev_probe0', REGISTRATION)
    // When the token rotates and it registers again
    const rotated: PushRegistration = { ...REGISTRATION, deviceToken: 'ffee0011', registeredAt: REGISTRATION.registeredAt + 1 }
    await roster.registerPush('dev_probe0', rotated)
    // Then there is one target and it names the newer token
    const targets = roster.pushTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]?.push.deviceToken).toBe('ffee0011')
    // And an unknown device is refused rather than added
    expect(await roster.registerPush('dev_nobody', REGISTRATION)).toBe(false)
  })

  it('operator opens a table holding one phone twice and one token twice and it is compacted on load', async () => {
    // Given a hand-written table holding one phone twice, one APNs token on two
    // rows of a phone whose key was regenerated, and a row that is nobody's twin
    const file = await rosterFile()
    const old = { ...legacyRow(1), deviceId: 'dev_old', fingerprint: 'fp-phone', lastSeenAt: 1_700_000_000_100, push: { ...REGISTRATION, registeredAt: 1_700_000_000_100 } }
    const fresh = { ...legacyRow(2), deviceId: 'dev_fresh', fingerprint: 'fp-phone', lastSeenAt: 1_700_000_000_900 }
    const rotated = { ...legacyRow(3), deviceId: 'dev_rotated', fingerprint: 'fp-key-1', push: { ...REGISTRATION, deviceToken: 'eeff0011', registeredAt: 1_700_000_000_300 } }
    const latest = { ...legacyRow(4), deviceId: 'dev_latest', fingerprint: 'fp-key-2', push: { ...REGISTRATION, deviceToken: 'eeff0011', registeredAt: 1_700_000_000_800 } }
    await writeRoster(file, { version: ROSTER_VERSION, devices: [old, fresh, rotated, latest, legacyRow(5)] })
    const logs: string[] = []
    // When a process loads it
    const roster = new DeviceRoster({ file, log: message => { logs.push(message) } })
    await roster.load()
    // Then one row per phone survives — the most recently seen one — and the
    // rows nothing shared are untouched
    expect(roster.devices().map(row => row.deviceId).sort()).toEqual(['dev_fresh', 'dev_latest', 'dev_probe5', 'dev_rotated'])
    expect(roster.devices().filter(row => row.fingerprint === 'fp-phone')).toHaveLength(1)
    // And the token sits on the newest registration only, on the row that survived
    expect(roster.pushTargets().map(target => [target.deviceId, target.push.deviceToken]).sort())
      .toEqual([['dev_fresh', REGISTRATION.deviceToken], ['dev_latest', 'eeff0011']])
    // And a row that lost its registration keeps its identity
    expect(roster.devices().find(row => row.deviceId === 'dev_rotated')?.push).toBeUndefined()
    // Then the file itself was rewritten compacted, still in the current schema
    const written = JSON.parse(await readFile(file, 'utf8')) as {
      version: number
      devices: { deviceId: string; push?: { deviceToken: string; registeredAt: number } }[]
    }
    expect(written.version).toBe(ROSTER_VERSION)
    expect(written.devices.map(row => row.deviceId).sort()).toEqual(['dev_fresh', 'dev_latest', 'dev_probe5', 'dev_rotated'])
    expect(written.devices.filter(row => row.push !== undefined).map(row => row.deviceId).sort()).toEqual(['dev_fresh', 'dev_latest'])
    expect(written.devices.find(row => row.deviceId === 'dev_fresh')?.push?.registeredAt).toBe(1_700_000_000_100)
    // And the pass is reported once, because it changed something
    expect(logs.filter(line => line.includes('compacted 1 duplicate row(s), retired 1 stale registration(s)'))).toHaveLength(1)
    // When the compacted file is loaded again, nothing further is retired
    logs.length = 0
    const again = new DeviceRoster({ file, log: message => { logs.push(message) } })
    await again.load()
    expect(logs.some(line => line.includes('compacted'))).toBe(false)
  })
})

describe('push channel: push.register on the wire', () => {
  it('user registers its token and the answer is an empty acknowledgement', async () => {
    // Given a paired connection over a real roster file, and a bridge with no APNs key
    const file = await rosterFile()
    await writeRoster(file, { version: 1, devices: [harnessRow()] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const harness = makeConnection({ paired: true, roster })
    await declare(harness)
    // When it registers
    await harness.connection.handleText(requestFrame(2, 'push.register', {
      deviceToken: 'aabbccdd',
      environment: 'sandbox',
      bundle: 'dev.dsh.Whale',
      liveActivityTokens: [{ activityId: 'act-1', token: 'ff00' }],
      locale: 'zh-Hans',
    }))
    // Then the answer is exactly an acknowledgement — no echo, no "ready" flag
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    // And the registration is on the device's own row
    const written = JSON.parse(await readFile(file, 'utf8')) as { devices: { push?: Record<string, unknown> }[] }
    expect(written.devices[0]?.push).toMatchObject({
      deviceToken: 'aabbccdd',
      environment: 'sandbox',
      bundle: 'dev.dsh.Whale',
      locale: 'zh-Hans',
      liveActivityTokens: [{ activityId: 'act-1', token: 'ff00' }],
    })
  })

  it('user that never declared the capability is told the method does not exist', async () => {
    // Given a paired connection that declared nothing
    const harness = makeConnection({ paired: true })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // When it registers anyway
    await harness.connection.handleText(requestFrame(2, 'push.register', { deviceToken: 'aa', environment: 'sandbox', bundle: 'b' }))
    // Then the answer is the one it would have received before this channel existed
    expect(answerOf(harness, 2).e?.code).toBe('unknown-method')
  })

  it('user sends an unusable registration and nothing is written', async () => {
    // Given a paired connection that declared the capability
    const file = await rosterFile()
    await writeRoster(file, { version: 1, devices: [harnessRow()] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const harness = makeConnection({ paired: true, roster })
    await declare(harness)
    // When each malformed request is sent
    const bad = [
      { deviceToken: '', environment: 'sandbox', bundle: 'b' },
      { deviceToken: 'aabb', environment: 'staging', bundle: 'b' },
      { deviceToken: 'aabb', environment: 'sandbox', bundle: '' },
      { deviceToken: 'aabb', environment: 'sandbox', bundle: 'b', liveActivityTokens: [{ activityId: '', token: 'ff' }] },
      { deviceToken: 'not-hex', environment: 'sandbox', bundle: 'b' },
    ]
    for (const [index, payload] of bad.entries()) {
      await harness.connection.handleText(requestFrame(10 + index, 'push.register', payload))
      // Then each is refused as invalid arguments
      expect(answerOf(harness, 10 + index).e?.code).toBe('invalid-args')
    }
    // And the roster was not touched
    const written = JSON.parse(await readFile(file, 'utf8')) as { devices: { push?: unknown }[] }
    expect(written.devices[0]?.push).toBeUndefined()
  })

  it('guest is refused before the device table is read', async () => {
    // Given a connection with no device token
    const harness = makeConnection({ paired: false })
    await declare(harness)
    // When it registers
    await harness.connection.handleText(requestFrame(2, 'push.register', { deviceToken: 'aabb', environment: 'sandbox', bundle: 'b' }))
    // Then it is unpaired, exactly as every other method answers it
    expect(answerOf(harness, 2).e?.code).toBe('unpaired')
  })
})

describe('push channel: what is sent and when', () => {
  it('user is told a turn ended and, separately, that it failed', async () => {
    // Given a paired connection whose bridge can deliver
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    const harness = makeConnection({ paired: true, push })
    await declare(harness)
    const stream = await follow(harness)
    // When one turn completes
    stream.push(record('turn/end', 12, 201, { turn: 1, reason: { kind: 'completed' } }))
    await settle()
    // Then one notification says a turn ended
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification).toEqual({
      aps: { alert: { title: '重构推送通道', body: '回合结束' }, sound: 'default' },
      s: 's-1',
      st: 'turn-end',
      url: 'whale://session/s-1',
    })
    // When a later turn fails
    clock.now += PUSH_DEDUPE_MS + 1
    stream.push(record('turn/end', 20, 301, { turn: 2, reason: { kind: 'error' } }))
    await settle()
    // Then the second notification is the abnormal one, and it carries no reason text
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent[1]?.notification.st).toBe('turn-error')
    expect(sink.sent[1]?.notification.aps.alert.body).toBe('回合异常结束')
    // And the state is the only thing that names the failure: no reason text rides along
    expect(Object.keys(sink.sent[1]?.notification ?? {}).sort()).toEqual(['aps', 's', 'st', 'url'])
  })

  it('operator holds two rows for one APNs token and that one phone is told once', async () => {
    // Given two roster rows carrying the same APNs token: one phone, paired twice
    const clock = { now: 1_000 }
    const sink = recorder()
    const pairedAgain: PushAddress = { deviceToken: PHONE.deviceToken, environment: 'sandbox', bundle: 'dev.dsh.Whale', locale: 'zh-Hans' }
    const other: PushAddress = { deviceToken: 'eeff0011', environment: 'production', bundle: 'dev.dsh.Whale' }
    const addresses: PushAddress[] = [PHONE, pairedAgain]
    const push = new PushNotifier({
      targets: () => addresses,
      sender: sink.sender,
      titles: id => (id === 's-1' ? '重构推送通道' : undefined),
      now: () => clock.now,
    })
    // When one turn ends
    push.notify('turn-end', 's-1')
    await settle()
    // Then the token was delivered to once, at the first row holding it
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.target).toBe(PHONE)
    // And the payload is that one event's
    expect(sink.sent[0]?.notification).toEqual({
      aps: { alert: { title: '重构推送通道', body: '回合结束' }, sound: 'default' },
      s: 's-1',
      st: 'turn-end',
      url: 'whale://session/s-1',
    })
    // When a second phone with a token of its own is registered
    clock.now += PUSH_DEDUPE_MS + 1
    addresses.push(other)
    push.notify('turn-end', 's-1')
    await settle()
    // Then each distinct token was delivered to once, so convergence is per token
    expect(sink.sent.map(entry => entry.target.deviceToken)).toEqual([PHONE.deviceToken, PHONE.deviceToken, other.deviceToken])
  })

  it('operator sees one notification per event however many connections saw it', async () => {
    // Given one bridge whose two phones follow the same session
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    // When the same event is announced twice inside the window
    push.notify('turn-end', 's-1')
    push.notify('turn-end', 's-1')
    await settle()
    // Then one notification was sent
    expect(sink.sent).toHaveLength(1)
    // When the window passes
    clock.now += PUSH_DEDUPE_MS + 1
    push.notify('turn-end', 's-1')
    await settle()
    // Then the same event is announced again
    expect(sink.sent).toHaveLength(2)
  })

  it('operator sees one notification per session inside the interval, whatever the event', async () => {
    // Given a bridge that just announced a turn end
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    push.notify('turn-end', 's-1')
    await settle()
    // When a different event about the same session follows immediately
    clock.now += 1
    push.notify('approval', 's-1')
    await settle()
    // Then it is suppressed by the per-session interval
    expect(sink.sent).toHaveLength(1)
    // When the interval passes
    clock.now += PUSH_SESSION_INTERVAL_MS + 1
    push.notify('approval', 's-1')
    await settle()
    // Then it goes out
    expect(sink.sent.map(entry => entry.notification.st)).toEqual(['turn-end', 'approval'])
  })

  it('operator sees the global minute capped instead of a burst', async () => {
    // Given a bridge that keeps announcing
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    // When more distinct sessions than the cap each raise one event
    for (let index = 0; index < PUSH_GLOBAL_PER_MINUTE + 5; index += 1) push.notify('question', `s-${index}`)
    await settle()
    // Then exactly the cap went out and the rest was dropped, not queued
    expect(sink.sent).toHaveLength(PUSH_GLOBAL_PER_MINUTE)
  })

  it('operator runs a bridge with no sender and every notification path stays silent', async () => {
    // Given a notifier with no sender at all — the default bridge
    const clock = { now: 1_000 }
    const push = notifierAt(undefined, clock)
    // Then it reports itself disabled
    expect(push.enabled).toBe(false)
    // When an event is announced
    push.notify('turn-end', 's-1')
    await settle()
    // Then nothing happened at all, and no clock was even read
    clock.now = 2_000
    expect(push.enabled).toBe(false)
  })

  it('user is not notified about a session it never listed and the payload simply omits the workspace', async () => {
    // Given a bridge whose roster carried a workspace for one session only
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    push.noteSessions([{ id: 's-1', cwd: '/Users/zcl/code/dsh-web' }, { id: 's-2' }])
    // When both sessions end a turn
    push.notify('turn-end', 's-1')
    push.notify('turn-end', 's-2')
    await settle()
    // Then the listed one carries the short workspace name and the other omits the key
    expect(sink.sent[0]?.notification.w).toBe('dsh-web')
    expect(sink.sent[1]?.notification).not.toHaveProperty('w')
  })
})

describe('push channel: the payload carries no session content', () => {
  it('operator reads an approval notification and the question it is about is nowhere in it', async () => {
    // Given a hub whose bridge can deliver, with one phone declaring the approval channel
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    const harness = makeHub({ push })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['approvals.v1'] }))
    // When a tool asks a question whose reason text is the thing that must not leak
    void harness.hub.approve({
      agent: { id: 's-1' },
      toolName: 'bash',
      displayReason: { en: 'Remove the build directory', zh: '删除构建目录' },
    }, async () => 'rejected')
    await settle()
    // Then the notification exists
    expect(sink.sent).toHaveLength(1)
    const notification = sink.sent[0]?.notification as PushNotification
    // And it carries exactly the four keys the protocol allows, no more
    expect(Object.keys(notification).sort()).toEqual(['aps', 's', 'st', 'url'])
    expect(Object.keys(notification.aps.alert).sort()).toEqual(['body', 'title'])
    // And not one word of the approval itself crossed: no reason, no tool name, no text
    const wire = JSON.stringify(notification)
    expect(wire).not.toContain('删除构建目录')
    expect(wire).not.toContain('Remove the build directory')
    expect(wire).not.toContain('bash')
    // And the state is the fixed one this event carries
    expect(notification.aps.alert.body).toBe('有待确认的审批')
    expect(notification.st).toBe('approval')
  })

  it('operator reads a question notification and the question body is nowhere in it', async () => {
    // Given a hub whose bridge can deliver, with one phone declaring the question channel
    const clock = { now: 1_000 }
    const sink = recorder()
    const push = notifierAt(sink.sender, clock)
    const harness = makeHub({ push })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['questions.v1'] }))
    // When the host asks something whose body must not leak
    void harness.hub.question({
      agent: { id: 's-1' },
      questions: [{
        id: 'q-1',
        question: 'Which deck should ship?',
        header: 'Deck',
        detail: 'Pick exactly one.',
        options: [{ label: 'Alpha' }],
        multiSelect: false,
      }],
    }, async () => ({ answers: [] }))
    await settle()
    // Then one notification says something is waiting
    expect(sink.sent).toHaveLength(1)
    const wire = JSON.stringify(sink.sent[0]?.notification)
    // And the question text is not part of it
    expect(wire).not.toContain('Which deck should ship?')
    expect(wire).not.toContain('Pick exactly one.')
    expect(sink.sent[0]?.notification.st).toBe('question')
    expect(sink.sent[0]?.notification.aps.alert.body).toBe('有待回答的问题')
  })

  it('operator builds the payload directly and it says only what the protocol allows', () => {
    // Given a session with a name and a workspace
    // When the turn-end payload is built directly
    const notification = buildPushNotification('turn-end', 'session-abc', { title: 'Refactor the push channel', workspace: 'dsh-web' })
    // Then the payload is the documented five keys and one deep link
    expect(notification).toEqual({
      aps: { alert: { title: 'Refactor the push channel', body: '回合结束' }, sound: 'default' },
      w: 'dsh-web',
      s: 'session-abc',
      st: 'turn-end',
      url: 'whale://session/session-abc',
    })
    // And a session with no name falls back to the fixed status line rather than to an empty string
    expect(buildPushNotification('approval', 'x').aps.alert.title).toBe('有待确认的审批')
  })

  it('operator names the approval category so a banner can draw its two buttons', () => {
    // Given the identifier the client registered statically for an approval
    expect(PUSH_APPROVAL_CATEGORY).toBe('dev.dsh.Whale.category.approval')
    // When an approval is built
    const approval = buildPushNotification('approval', 'session-abc', { title: 'Refactor the push channel', workspace: 'dsh-web' })
    // Then it is the documented payload with that one category added inside aps
    expect(approval).toEqual({
      aps: {
        alert: { title: 'Refactor the push channel', body: '有待确认的审批' },
        sound: 'default',
        category: 'dev.dsh.Whale.category.approval',
      },
      w: 'dsh-web',
      s: 'session-abc',
      st: 'approval',
      url: 'whale://session/session-abc',
    })
    // And the category rides inside aps, so the top-level key set is untouched
    expect(Object.keys(approval).sort()).toEqual(['aps', 's', 'st', 'url', 'w'])
    // And every other event leaves the key out entirely — absent, never empty
    for (const event of ['turn-end', 'turn-error', 'question'] as const) {
      expect('category' in buildPushNotification(event, 'session-abc').aps).toBe(false)
    }
  })

  it('user reads the turn-end state off the reason and never guesses', () => {
    // Given the reasons a host reports
    // When each is turned into the event this channel names
    // Then only the normal one is a normal end, and every other value — including
    // the unknown an unreadable reason reports — is an abnormal one
    expect(pushEventOfTurnEnd('completed')).toBe('turn-end')
    expect(pushEventOfTurnEnd('error')).toBe('turn-error')
    expect(pushEventOfTurnEnd('interrupted')).toBe('turn-error')
    expect(pushEventOfTurnEnd('unknown')).toBe('turn-error')
  })

  it('operator reads the minor this channel raised and the name it announces', () => {
    // Given the handshake a client of this channel reads
    // When it reads the minor and the capability name
    // Then both are the published ones
    expect(MINOR).toBe(21)
    expect(CAP_PUSH).toBe('push.v1')
  })
})
