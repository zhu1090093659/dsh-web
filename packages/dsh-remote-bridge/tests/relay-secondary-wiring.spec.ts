/**
 * The second meeting point on the real mount path: the plugin row's configuration
 * decides whether this host dials a second control plane at all, and how much of
 * the wire the relay channel changes.
 *
 * The first case is the contract the whole change rests on. A host that configures
 * nothing has to make exactly the requests it made before, log exactly what it
 * logged before, leave its roster file byte for byte as it was, and greet a phone
 * with the greeting it always greeted it with. The cases after it only exist to
 * show that the counters in the first one are real: the same probes, on a host
 * configured with a second meeting point, see the second claim, the announced
 * origin and the grant that crossed to it.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { Duplex, PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { ROSTER_PATH } from '../src/index.ts'
import { CAP_RELAY_TIER, WS_PATH } from '../src/core/protocol.ts'
import { nextTurn, settle } from './support/harness.ts'

/** 本文件里每次挂载都回报的 webServer 端口。 */
const WEB_PORT = 41000
/** 第二会合点的控制面基址：一个绝不会真的被拨到的假地址（fetch 已被顶替）。 */
const CONTROL_URL = 'https://relay.test/v1/relay'
/** 第二会合点的公共后缀。 */
const SUFFIX = '.relay.chatwithai.icu'
/** 一个固定的挂载 profile（身份文件按它命名）。 */
const PROFILE = 'web'

/** 一条插件真的发出去的控制面请求。 */
interface ControlCall {
  readonly url: string
  readonly method: string
  /** 解析后的请求体；空体是 undefined。 */
  readonly body: Record<string, unknown> | undefined
}

/** 一次挂载留在假宿主上的全部东西。 */
interface MountedHost {
  readonly disposers: (() => void)[]
  readonly upgrades: { readonly path: string; readonly handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }[]
}

/** 一份 JSON 回应。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 假控制面：逐条记录请求（含请求体），并把「以某条 URL 结尾的请求已到达 n 次」暴露成
 * 确定信号，于是用例等的是被测代码真的发出了那条请求，而不是一段时间。
 */
class FakeControlPlane {
  /** 收到的请求，旧的在前。 */
  readonly calls: ControlCall[] = []
  /** 请求到达时要兑现的等待者。 */
  private readonly listeners = new Set<() => void>()
  /** 一条请求的应答；默认一份成功回应。 */
  private answer: (call: ControlCall) => Promise<Response> | Response = () => jsonResponse({ ok: true })

  /** 换一份应答：非 2xx 与传输层失败都在这里表达。 */
  respondWith(answer: (call: ControlCall) => Promise<Response> | Response): void {
    this.answer = answer
  }

  /** 把全局 fetch 换成这个假控制面。 */
  stub(): void {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.toString() : String((input as { url?: unknown }).url)
      const raw = typeof init?.body === 'string' ? init.body : undefined
      const call: ControlCall = {
        url,
        method: init?.method ?? 'GET',
        body: raw === undefined ? undefined : JSON.parse(raw) as Record<string, unknown>,
      }
      this.calls.push(call)
      for (const listener of Array.from(this.listeners)) {
        this.listeners.delete(listener)
        listener()
      }
      return await this.answer(call)
    })
  }

  /** 以这条 URL 结尾的请求条数。 */
  countOf(url: string): number {
    return this.calls.filter(call => call.url.endsWith(url)).length
  }

  /** 以这条 URL 结尾的最后一条请求。 */
  lastOf(url: string): ControlCall | undefined {
    for (let index = this.calls.length - 1; index >= 0; index -= 1) {
      const call = this.calls[index]
      if (call !== undefined && call.url.endsWith(url)) return call
    }
    return undefined
  }

  /**
   * 等到以这条 URL 结尾的请求到达 count 次。
   * @param url - 请求 URL（按结尾匹配）。
   * @param count - 需要的次数（从 1 起）。
   */
  async until(url: string, count = 1): Promise<void> {
    if (this.countOf(url) >= count) return
    // 一次唤醒只代表「又有请求到了」，不代表数量够了，所以到了再看一次。
    await new Promise<void>((resolve) => { this.listeners.add(resolve) })
    await this.until(url, count)
  }
}

/**
 * 按 loader 的方式挂载插件：同一个 apply、同一份行配置，假宿主只带宿主真的注入的那几个
 * 服务。
 * @param config - 这次挂载的行配置。
 * @returns 宿主；它的 disposers 就是各个 effect 的拆卸函数。
 */
function mountPlugin(config: Record<string, unknown>): MountedHost {
  const disposers: (() => void)[] = []
  const upgrades: MountedHost['upgrades'] = []
  const ctx = {
    typertGateway: {
      invoke: async () => ({}),
      stream: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
    },
    webServer: {
      port: WEB_PORT,
      getOrigin: () => 'http://127.0.0.1:' + String(WEB_PORT),
      register: () => () => undefined,
      registerUpgrade: (route: MountedHost['upgrades'][number]) => {
        upgrades.push(route)
        return () => undefined
      },
    },
    tools: { register: () => () => undefined },
    effect: (callback: () => () => void) => { disposers.push(callback()); return () => undefined },
    on: () => () => undefined,
  } as unknown as Context
  apply(ctx, config)
  return { disposers, upgrades }
}

/** 按 profile 重载的方式拆掉一次挂载：最新的 effect 先拆。 */
function unmount(host: MountedHost): void {
  for (const dispose of host.disposers.splice(0).toReversed()) dispose()
}

/**
 * 写一份名册文件。租约按需申领：只有名册里已经有设备的宿主才会在挂载时申领。
 * @param home - 这次的 DSH_HOME。
 * @param version - 名册 schema 版本。
 * @param devices - 名册里的设备行。
 */
async function writeRoster(home: string, version: number, devices: Record<string, unknown>[]): Promise<void> {
  const file = join(home, ROSTER_PATH)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version, devices }, null, 2) + '\n', 'utf8')
}

/** @returns the one registered upgrade handler, or throws. */
function upgradeHandlerOf(host: MountedHost): MountedHost['upgrades'][number]['handler'] {
  const route = host.upgrades.find(candidate => candidate.path === WS_PATH)
  if (route === undefined) throw new Error('no upgrade route was registered for ' + WS_PATH)
  return route.handler
}

/** A WebSocket upgrade request as the host would hand it over. */
function upgradeRequest(): IncomingMessage {
  return {
    url: WS_PATH,
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: '127.0.0.1:' + String(WEB_PORT),
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
  } as unknown as IncomingMessage
}

/** A socket pair carrying a real byte stream in both directions. */
function socketPair(): { inbound: PassThrough; socket: Duplex; serverBytes: () => Buffer } {
  const inbound = new PassThrough()
  const outbound = new PassThrough()
  const chunks: Buffer[] = []
  outbound.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  return { inbound, socket: Duplex.from({ readable: inbound, writable: outbound }) as unknown as Duplex, serverBytes: () => Buffer.concat(chunks) }
}

/** One masked client frame. */
function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  return Buffer.concat([
    Buffer.from([0x81, 0x80 | payload.length]),
    mask,
    Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0))),
  ])
}

/** Every unmasked server frame written after the handshake response. */
function serverFrames(bytes: Buffer): unknown[] {
  const boundary = bytes.indexOf(Buffer.from('\r\n\r\n'))
  let rest = bytes.subarray(boundary + 4)
  const answers: unknown[] = []
  while (rest.length >= 2) {
    let length = rest[1] ?? 0
    let offset = 2
    if (length === 126) {
      length = rest.readUInt16BE(2)
      offset = 4
    }
    answers.push(JSON.parse(rest.subarray(offset, offset + length).toString('utf8')) as unknown)
    rest = rest.subarray(offset + length)
  }
  return answers
}

/** 一次挂载的 hello 应答。 */
async function greet(host: MountedHost): Promise<{ capabilities: string[]; relay?: { origin: string } }> {
  const pair = socketPair()
  await upgradeHandlerOf(host)(upgradeRequest(), pair.socket, Buffer.alloc(0))
  pair.inbound.write(maskedTextFrame(JSON.stringify({ t: 'req', id: 1, m: 'hello', p: { proto: 1 } })))
  await nextTurn()
  await settle()
  const answers = serverFrames(pair.serverBytes()) as { r?: { capabilities: string[]; relay?: { origin: string } } }[]
  const answer = answers[0]?.r
  if (answer === undefined) throw new Error('the greeting was never answered')
  return answer
}

/** 名册文件里那一行设备（版本 3 的形状，缺省没有任何 relay 块）。 */
function rosterRow(): Record<string, unknown> {
  return {
    deviceId: 'dev_probe',
    pubKey: 'spki-probe',
    fingerprint: 'fingerprint-probe',
    createdAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    tokenHash: 'hash-probe',
  }
}

/** 日志里提到第二会合点的那几行。 */
function secondMeetingPointLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map(args => String(args[0]))
    .filter(line => line.includes('second meeting point') || line.includes('relay secondary'))
}

describe('a host that configures no second meeting point', () => {
  let home: string
  let plane: FakeControlPlane

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-tier-wiring-'))
    process.env.DSH_HOME = home
    plane = new FakeControlPlane()
    plane.stub()
    // A bridged lease with no bridge grant: the claim stays a pure control-plane
    // exchange and nothing spawns a connector.
    plane.respondWith(call => (call.url.endsWith('/claim')
      ? jsonResponse({ mode: 'bridge', hostname: 'abcdefghijklmnop.dsh-market.com' })
      : jsonResponse({ ok: true })))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })

  it('operator mounts with no relay secondary configured and nothing about it reaches the network, the log or the roster', async () => {
    // Given a profile whose roster file is a version-3 table, and a counted console
    const file = join(home, ROSTER_PATH)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 3, devices: [rosterRow()] }, null, 2) + '\n', 'utf8')
    const before = await readFile(file, 'utf8')
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined) // test-standards-allow: applyImpl 的 log 直连 console.log，没有注入缝；这里只接管输出以数日志行，不 patch 模块图，finally 里 mockRestore
    try {
      // When the plugin mounts and its lease claim lands
      const host = mountPlugin({ profile: PROFILE })
      await plane.until('/api/relay/claim')
      await settle()
      // Then the mount made exactly the one request it always made — no second
      // control plane was dialled at all
      expect(plane.calls.map(call => call.url)).toEqual(['https://dsh-market.com/api/relay/claim'])
      expect(plane.calls.filter(call => call.url.includes('relay.test'))).toEqual([])
      // And no line about a second meeting point was written
      expect(secondMeetingPointLines(logged)).toEqual([])
      // When a phone greets it over the socket
      const hello = await greet(host)
      // Then the greeting carries no relay announcement and no tier capability
      expect('relay' in hello).toBe(false)
      expect(hello.capabilities).not.toContain(CAP_RELAY_TIER)
      // And the roster file on disk is still exactly the version-3 file it was
      expect(await readFile(file, 'utf8')).toBe(before)
      unmount(host)
    } finally {
      logged.mockRestore()
    }
  })
})

describe('a host whose relay half is switched off', () => {
  let home: string
  let plane: FakeControlPlane

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-tier-wiring-'))
    process.env.DSH_HOME = home
    plane = new FakeControlPlane()
    plane.stub()
    plane.respondWith(() => jsonResponse({ ok: true }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })

  it('operator configures a second meeting point but turns the relay off and no meeting point is dialled', async () => {
    // Given a profile that names a second meeting point and disables the relay half
    // When the plugin mounts
    const host = mountPlugin({
      relay: false,
      profile: PROFILE,
      relaySecondaryControlUrl: CONTROL_URL,
      relaySecondaryPublicSuffix: SUFFIX,
    })
    await settle()
    // Then neither meeting point is claimed: a relay that is off claims nothing,
    // whatever else the profile configures
    expect(plane.calls).toEqual([])
    // And the greeting announces nothing and advertises no tier channel
    const hello = await greet(host)
    expect('relay' in hello).toBe(false)
    expect(hello.capabilities).not.toContain(CAP_RELAY_TIER)
    unmount(host)
  })
})

describe('a host that configures a second meeting point', () => {
  let home: string
  let plane: FakeControlPlane

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-tier-wiring-'))
    process.env.DSH_HOME = home
    plane = new FakeControlPlane()
    plane.stub()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })

  it('operator configures the second meeting point and both meetings are claimed with one identity', async () => {
    // Given a host already paired with a device (leases are claimed on demand, so an
    // unpaired host claims nothing), no grant yet, and a second control plane that admits it
    await writeRoster(home, 3, [rosterRow()])
    plane.respondWith(call => (call.url.endsWith('/claim')
      ? jsonResponse({ mode: 'bridge', hostname: 'abcdefghijklmnop' + SUFFIX })
      : jsonResponse({ ok: true })))
    // When the plugin mounts
    const host = mountPlugin({
      profile: PROFILE,
      relaySecondaryControlUrl: CONTROL_URL,
      relaySecondaryPublicSuffix: SUFFIX,
    })
    await plane.until(CONTROL_URL + '/claim')
    await settle()
    // Then the market edge and the second meeting point were each claimed once
    const market = plane.lastOf('https://dsh-market.com/api/relay/claim')
    const second = plane.lastOf(CONTROL_URL + '/claim')
    expect(plane.countOf('https://dsh-market.com/api/relay/claim')).toBe(1)
    expect(plane.countOf(CONTROL_URL + '/claim')).toBe(1)
    // And they carried the same identity, which is the whole point of a second
    // meeting point: no second identity was ever minted
    expect(second?.body?.id).toBe(market?.body?.id)
    expect(second?.body?.secret).toBe(market?.body?.secret)
    // And the second claim carried no grant key, because no phone handed one over
    expect('grant' in (second?.body ?? {})).toBe(false)
    // When a phone greets it
    const hello = await greet(host)
    // Then the origin built from that same id and the configured suffix is announced
    expect(hello.relay).toEqual({ origin: 'wss://' + String(market?.body?.id) + SUFFIX })
    expect(hello.capabilities).toContain(CAP_RELAY_TIER)
    unmount(host)
  })

  it('user hands a grant over and the second claim carries it while the market edge never sees it', async () => {
    // Given a roster row that already holds the grant a phone handed over
    const file = join(home, ROSTER_PATH)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      version: 4,
      devices: [{ ...rosterRow(), relay: { grant: 'grant-from-phone', receivedAt: 1_700_000_000 } }],
    }, null, 2) + '\n', 'utf8')
    plane.respondWith(call => (call.url.endsWith('/claim')
      ? jsonResponse({ mode: 'bridge', hostname: 'abcdefghijklmnop' + SUFFIX })
      : jsonResponse({ ok: true })))
    // When the plugin mounts
    const host = mountPlugin({
      profile: PROFILE,
      relaySecondaryControlUrl: CONTROL_URL,
      relaySecondaryPublicSuffix: SUFFIX,
    })
    await plane.until(CONTROL_URL + '/claim')
    await settle()
    // Then the second claim presented that grant, and the market edge's claim
    // carried none: the tier credential belongs to one meeting point only
    expect(plane.lastOf(CONTROL_URL + '/claim')?.body?.grant).toBe('grant-from-phone')
    expect('grant' in (plane.lastOf('https://dsh-market.com/api/relay/claim')?.body ?? {})).toBe(false)
    unmount(host)
  })

  it('operator is refused the tier and the lease is released while the greeting stops announcing it', async () => {
    // Given a host already paired with a device (leases are claimed on demand, so an
    // unpaired host claims nothing), a second control plane that refuses the tier, and a
    // counted console
    await writeRoster(home, 3, [rosterRow()])
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined) // test-standards-allow: applyImpl 的 log 直连 console.log，没有注入缝；这里只接管输出以断言那几行，不 patch 模块图，finally 里 mockRestore
    plane.respondWith(call => {
      if (call.url.endsWith(CONTROL_URL + '/claim')) return jsonResponse({ error: 'tier-required' }, 403)
      if (call.url.endsWith('/claim')) return jsonResponse({ mode: 'bridge', hostname: 'abcdefghijklmnop.dsh-market.com' })
      return jsonResponse({ ok: true })
    })
    try {
      // When the plugin mounts and the second claim is refused
      const host = mountPlugin({
        profile: PROFILE,
        relaySecondaryControlUrl: CONTROL_URL,
        relaySecondaryPublicSuffix: SUFFIX,
      })
      await plane.until(CONTROL_URL + '/release')
      await settle()
      // Then the second lease was released through the second control plane, and
      // the market edge's own lease was neither released nor re-claimed
      expect(plane.countOf(CONTROL_URL + '/release')).toBe(1)
      expect(plane.countOf('https://dsh-market.com/api/relay/release')).toBe(0)
      expect(plane.countOf(CONTROL_URL + '/claim')).toBe(1)
      expect(plane.countOf('https://dsh-market.com/api/relay/claim')).toBe(1)
      // And the refusal is stated on one line, naming the tier answer
      const lines = secondMeetingPointLines(logged)
      expect(lines.some(line => line.includes('tier-required'))).toBe(true)
      // When a phone greets it
      const hello = await greet(host)
      // Then nothing is announced, although the tier name is still advertised
      expect('relay' in hello).toBe(false)
      expect(hello.capabilities).toContain(CAP_RELAY_TIER)
      unmount(host)
    } finally {
      logged.mockRestore()
    }
  })
})
