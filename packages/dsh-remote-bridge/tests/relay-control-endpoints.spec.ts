/**
 * 中继控制面端点与稳定子域名的配置化：relayControlUrl 与 relayPublicSuffix。
 *
 * 两条性质在这里固定下来。什么都不配时，四个端点 URL、稳定主机名与今天逐字一致，
 * 缺省值只来自 relay-control.ts / relay-registry.ts 里的常量；配成自建会合点时，
 * claim / release / register / unregister 与主机名一起按派生规则搬家。
 *
 * 全部按行为断言：真实的 RelayConnectorPair / RelayRegistrar / announcer 配一个记账
 * 的假控制面（stub 全局 fetch，绝不联网），等的是「那条请求真的到了」这个确定信号。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, createRelayAnnouncer, resolveBridgeConfig } from '../src/index.ts'
import { RELAY_CLAIM_URL, RELAY_CONTROL_URL, RELAY_RELEASE_URL, relayControlEndpointOf } from '../src/host/relay-control.ts'
import { RelayConnectorPair } from '../src/host/relay-connector.ts'
import {
  loadRelayIdentity,
  RELAY_BASE_SUFFIX,
  RELAY_REGISTER_URL,
  RELAY_UNREGISTER_URL,
  RelayRegistrar,
  relayBaseOf,
  type RelayIdentity,
} from '../src/host/relay-registry.ts'

/** 一处空的进程环境。 */
const NO_ENV: NodeJS.ProcessEnv = {}

/** 本 profile 的 relay 身份（每条路径都只读它）。 */
const IDENTITY: RelayIdentity = { id: 'abcd1234abcd1234', secret: 'A'.repeat(43) }

/** 自建会合点的控制面基址，与缺省的那个不同。 */
const SELF_HOSTED_BASE = 'https://relay.chatwithai.icu/v1/relay'

/** 自建会合点的稳定子域名后缀。 */
const SELF_HOSTED_SUFFIX = '.relay.chatwithai.icu'

/** 快速隧道这一次运行报出的 URL。 */
const TUNNEL = 'https://warm-river-42.trycloudflare.com'

/** 一次挂载回报的 webServer 端口（假宿主只报数，不监听）。 */
const WEB_PORT = 41000

/** 一条控制面请求的要点。 */
interface ControlCall {
  readonly url: string
  readonly method: string
}

/** 一个记账的假控制面。 */
interface FakeControlPlane {
  /** 收到的请求，旧的在前。 */
  readonly calls: ControlCall[]
  /** 等到这条 URL 的请求到达 count 次。 */
  until(url: string, count?: number): Promise<void>
}

/** 一份 JSON 回应。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 把全局 fetch 换成一个记账的假控制面，绝不联网。
 *
 * 申领一律答一条 bridge 租约：它既没有隧道也没有桥授权，于是这条路径上不会真的起
 * 任何连接器，剩下的只有控制面请求本身。请求到达就兑现等待者，所以用例等的是
 * 「那条请求真的发出去了」，不是一段时间。
 * @returns 假控制面自己，带着它收到的请求与等待器。
 */
function stubControlPlane(): FakeControlPlane {
  const calls: ControlCall[] = []
  const listeners = new Set<() => void>()
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : String((input as { url?: unknown }).url)
    calls.push({ url, method: init?.method ?? 'GET' })
    for (const listener of [...listeners]) {
      listeners.delete(listener)
      listener()
    }
    return url.endsWith('/claim')
      ? jsonResponse({ mode: 'bridge', hostname: IDENTITY.id + '.dsh-market.com' })
      : jsonResponse({ ok: true })
  })
  return {
    calls,
    async until(url: string, count = 1): Promise<void> {
      while (calls.filter(call => call.url === url).length < count) {
        await new Promise<void>((resolve) => { listeners.add(resolve) })
      }
    },
  }
}

/** 让排队的微任务与立即任务先跑完。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** 一次挂载留在假宿主上的全部东西。 */
interface MountedHost {
  readonly disposers: (() => void)[]
}

/**
 * 按 loader 的方式挂载插件：同一个 apply、同一份行配置，假宿主只带宿主真的注入的
 * 那几个服务。
 * @param config - 这次挂载的行配置。
 * @returns 宿主；它的 disposers 就是各个 effect 的拆卸函数。
 */
function mountPlugin(config: Record<string, unknown>): MountedHost {
  const disposers: (() => void)[] = []
  const ctx = {
    typertGateway: {
      invoke: async () => ({}),
      stream: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
    },
    webServer: {
      port: WEB_PORT,
      getOrigin: () => 'http://127.0.0.1:' + String(WEB_PORT),
      register: () => () => undefined,
      registerUpgrade: () => () => undefined,
    },
    tools: { register: () => () => undefined },
    effect: (callback: () => () => void) => { disposers.push(callback()); return () => undefined },
    on: () => () => undefined,
  } as unknown as Context
  apply(ctx, config)
  return { disposers }
}

/** 按 profile 重载的方式拆掉一次挂载：最新的 effect 先拆。 */
function unmount(host: MountedHost): void {
  for (const dispose of host.disposers.splice(0).reverse()) dispose()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('什么都不配时控制面地址与今天逐字一致', () => {
  it('operator: 两个新字段的缺省值就是那两个 host 模块导出的常量', () => {
    // Given a row with no relay configuration at all
    const config = resolveBridgeConfig(undefined, NO_ENV)
    // When the bridge resolves it into a complete config face
    // Then the two new fields are the constants themselves, not a second copy in index.ts
    expect(config.relayControlUrl).toBe(RELAY_CONTROL_URL)
    expect(config.relayPublicSuffix).toBe(RELAY_BASE_SUFFIX)
    // And they are byte for byte the values this package has always dialled
    expect(config.relayControlUrl).toBe('https://dsh-market.com/api/relay')
    expect(config.relayPublicSuffix).toBe('.dsh-market.com')
  })

  it('operator: 缺省时四个端点 URL 与今天的字面量逐字相同', () => {
    // Given the shipped control-plane base
    // When its four endpoints are derived
    // Then each one is exactly the URL this package has always called
    expect(relayControlEndpointOf('claim')).toBe('https://dsh-market.com/api/relay/claim')
    expect(relayControlEndpointOf('release')).toBe('https://dsh-market.com/api/relay/release')
    expect(relayControlEndpointOf('register')).toBe('https://dsh-market.com/api/relay/register')
    expect(relayControlEndpointOf('unregister')).toBe('https://dsh-market.com/api/relay/unregister')
    // And the four exported constants are those four URLs, so the base is their one home
    expect([RELAY_CLAIM_URL, RELAY_RELEASE_URL, RELAY_REGISTER_URL, RELAY_UNREGISTER_URL]).toEqual([
      'https://dsh-market.com/api/relay/claim',
      'https://dsh-market.com/api/relay/release',
      'https://dsh-market.com/api/relay/register',
      'https://dsh-market.com/api/relay/unregister',
    ])
  })

  it('operator: 两个字段写成空白时回退缺省，不拼出半个地址', () => {
    // Given a hand-written row whose two relay address fields are blank
    const config = resolveBridgeConfig({ relayControlUrl: '   ', relayPublicSuffix: '' }, NO_ENV)
    // When the bridge resolves it
    // Then both fall back to the shipped constants instead of an empty base
    expect(config.relayControlUrl).toBe(RELAY_CONTROL_URL)
    expect(config.relayPublicSuffix).toBe(RELAY_BASE_SUFFIX)
    // And the claim URL is still a whole URL, not a bare path
    expect(relayControlEndpointOf('claim', config.relayControlUrl)).toBe('https://dsh-market.com/api/relay/claim')
  })

  it('operator: 缺省时稳定主机名仍是一级子域名模板', () => {
    // Given one relay identity
    // When its stable base is built with no suffix configured
    // Then the hostname is the one this package has always handed out
    expect(relayBaseOf(IDENTITY)).toBe('https://abcd1234abcd1234.dsh-market.com')
    expect(relayBaseOf(IDENTITY)).toBe('https://' + IDENTITY.id + RELAY_BASE_SUFFIX)
  })

  it('operator: 缺省时租约申领与释放仍打到市场控制面那两个地址', async () => {
    // Given a recording control plane and a lease half that configures nothing
    const plane = stubControlPlane()
    const pair = new RelayConnectorPair({ ...IDENTITY })
    // When it claims one lease and then releases it
    const claim = await pair.start({ port: 3080 })
    await pair.release()
    // Then both requests land on today's two URLs, with today's methods
    expect(plane.calls).toEqual([
      { url: 'https://dsh-market.com/api/relay/claim', method: 'PUT' },
      { url: 'https://dsh-market.com/api/relay/release', method: 'POST' },
    ])
    // And the claim really landed as one lease
    expect(claim?.mode).toBe('bridge')
    pair.dispose()
  })

  it('operator: 缺省时注册与撤注册仍打到市场控制面那两个地址', async () => {
    // Given a recording control plane and an announcer that configures nothing
    const plane = stubControlPlane()
    const announcer = createRelayAnnouncer({ identity: () => ({ ...IDENTITY }) })
    // When a quick tunnel reports its URL and the relay is then turned off
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    announcer.sync({ relay: false, mode: 'quick', url: TUNNEL })
    await flush()
    // Then the registration row is written on today's URL and withdrawn on today's
    expect(plane.calls).toEqual([
      { url: 'https://dsh-market.com/api/relay/register', method: 'PUT' },
      { url: 'https://dsh-market.com/api/relay/unregister', method: 'POST' },
    ])
    expect(announcer.registered).toBeUndefined()
    announcer.dispose()
  })
})

describe('配成自建会合点后地址随配置搬家', () => {
  /** 一份指向自建控制面的行配置。 */
  const selfHosted = resolveBridgeConfig({
    relayControlUrl: SELF_HOSTED_BASE,
    relayPublicSuffix: SELF_HOSTED_SUFFIX,
  }, NO_ENV)

  it('operator: 配好的基址与后缀原样落在解出的配置面上', () => {
    // Given a row pointing at a self-hosted meeting point
    // When the bridge resolves it
    // Then the two fields are the values the operator wrote
    expect(selfHosted.relayControlUrl).toBe(SELF_HOSTED_BASE)
    expect(selfHosted.relayPublicSuffix).toBe(SELF_HOSTED_SUFFIX)
  })

  it('operator: 自建基址派生出四个自建端点', () => {
    // Given the resolved self-hosted base
    // When the four endpoints are derived from it
    // Then every one of them hangs off that base
    expect(relayControlEndpointOf('claim', selfHosted.relayControlUrl)).toBe('https://relay.chatwithai.icu/v1/relay/claim')
    expect(relayControlEndpointOf('release', selfHosted.relayControlUrl)).toBe('https://relay.chatwithai.icu/v1/relay/release')
    expect(relayControlEndpointOf('register', selfHosted.relayControlUrl)).toBe('https://relay.chatwithai.icu/v1/relay/register')
    expect(relayControlEndpointOf('unregister', selfHosted.relayControlUrl)).toBe('https://relay.chatwithai.icu/v1/relay/unregister')
    // And a base written with a trailing slash does not double the separator
    expect(relayControlEndpointOf('claim', SELF_HOSTED_BASE + '/')).toBe('https://relay.chatwithai.icu/v1/relay/claim')
  })

  it('operator: 配了自建后缀后稳定主机名跟着换', () => {
    // Given the resolved self-hosted suffix
    // When the stable base is built for one identity
    // Then the hostname sits under that suffix instead of the market one
    expect(relayBaseOf(IDENTITY, selfHosted.relayPublicSuffix)).toBe('https://abcd1234abcd1234.relay.chatwithai.icu')
    expect(relayBaseOf(IDENTITY, selfHosted.relayPublicSuffix)).toBe('https://' + IDENTITY.id + SELF_HOSTED_SUFFIX)
  })

  it('operator: 自建基址下租约申领、释放、注册与撤注册都打到自建控制面', async () => {
    // Given a recording control plane
    const plane = stubControlPlane()
    // When the lease half and the announcer both take the configured base and suffix
    const pair = new RelayConnectorPair({ ...IDENTITY }, { controlUrl: selfHosted.relayControlUrl })
    await pair.start({ port: 3080 })
    await pair.release()
    const announcer = createRelayAnnouncer({
      identity: () => ({ ...IDENTITY }),
      controlUrl: selfHosted.relayControlUrl,
      publicSuffix: selfHosted.relayPublicSuffix,
    })
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    announcer.sync({ relay: false, mode: 'quick', url: TUNNEL })
    await flush()
    // Then all four requests land under the self-hosted base and none touches the market
    expect(plane.calls).toEqual([
      { url: 'https://relay.chatwithai.icu/v1/relay/claim', method: 'PUT' },
      { url: 'https://relay.chatwithai.icu/v1/relay/release', method: 'POST' },
      { url: 'https://relay.chatwithai.icu/v1/relay/register', method: 'PUT' },
      { url: 'https://relay.chatwithai.icu/v1/relay/unregister', method: 'POST' },
    ])
    pair.dispose()
    announcer.dispose()
  })

  it('operator: 注册循环的主机名模板跟着配置的后缀走', () => {
    // Given one registrar built for the self-hosted suffix, and one that configures nothing
    const selfHostedRegistrar = new RelayRegistrar({ ...IDENTITY }, () => undefined, { publicSuffix: selfHosted.relayPublicSuffix })
    const shippedRegistrar = new RelayRegistrar({ ...IDENTITY }, () => undefined)
    // When each reports the stable base the QR would carry
    // Then the configured one moves and the untouched one keeps today's suffix
    expect(selfHostedRegistrar.baseUrl).toBe('https://abcd1234abcd1234.relay.chatwithai.icu')
    expect(shippedRegistrar.baseUrl).toBe('https://abcd1234abcd1234.dsh-market.com')
  })
})

describe('挂载路径把配置一路传到底', () => {
  let home: string

  beforeEach(async () => {
    // The relay identity file lives under DSH_HOME: point it at a temp directory so the
    // suite never reads or writes this machine's own installation.
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-control-'))
    process.env.DSH_HOME = home
  })

  afterEach(async () => {
    delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })

  it('operator: relay 打开时租约申领打到配置的控制面', async () => {
    // Given a row pointing at a self-hosted control plane, and a recording control plane
    const plane = stubControlPlane()
    // When the plugin mounts with that row
    const host = mountPlugin({
      relay: true,
      autoTunnel: false,
      profile: 'web',
      relayControlUrl: SELF_HOSTED_BASE,
      relayPublicSuffix: SELF_HOSTED_SUFFIX,
    })
    // Then the claim really goes out on the configured base
    await plane.until('https://relay.chatwithai.icu/v1/relay/claim')
    expect(plane.calls).toEqual([{ url: 'https://relay.chatwithai.icu/v1/relay/claim', method: 'PUT' }])
    unmount(host)
  })

  it('operator: relay 关掉时撤行与释放也打到配置的控制面', async () => {
    // Given an identity already on disk and a row pointing at a self-hosted control plane
    loadRelayIdentity('web', home)
    const plane = stubControlPlane()
    // When the plugin mounts with the relay off
    const host = mountPlugin({ relay: false, autoTunnel: false, profile: 'web', relayControlUrl: SELF_HOSTED_BASE })
    // Then the previous mount's row is withdrawn and its lease released, both on that base
    await plane.until('https://relay.chatwithai.icu/v1/relay/release')
    expect(plane.calls).toEqual([
      { url: 'https://relay.chatwithai.icu/v1/relay/unregister', method: 'POST' },
      { url: 'https://relay.chatwithai.icu/v1/relay/release', method: 'POST' },
    ])
    unmount(host)
  })
})
