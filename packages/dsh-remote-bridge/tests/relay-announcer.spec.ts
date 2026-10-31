/**
 * Worker 上那行「稳定子域名 -> 本机隧道」的注册（relay announcer），以及二维码地址
 * 的取用顺序。
 *
 * 缺陷背景：控制面把租约判成 quick 时，Worker 的快速路径要靠注册表里那条隧道 URL
 * 才能把稳定子域名代理到本机；没有 announcer，那条子域名指向离线页，而二维码如果
 * 优先取租约 hostname，手机扫到的就是一个拨不通的地址。
 *
 * 全部按行为断言：真实的 RelayRegistrar 配一个记账的假 fetch（不联网），再把这套
 * 状态喂给 livePublicOriginOf / discoverPairOrigin 看二维码实际会带哪个地址。
 */
import { describe, expect, it } from 'vitest'
import {
  createRelayAnnouncer,
  createRelayHalfSwitch,
  leaseConnectorSeams,
  livePublicOriginOf,
  relayAnnounceTargetOf,
  type RelayAnnouncer,
} from '../src/index.ts'
import type { RelayClaim } from '../src/host/relay-control.ts'
import { RelayConnectorPair } from '../src/host/relay-connector.ts'
import { RELAY_REGISTER_URL, RELAY_UNREGISTER_URL, RelayRegistrar, type RelayIdentity } from '../src/host/relay-registry.ts'
import { discoverPairOrigin } from '../src/host/pair-origin.ts'

/** 本 profile 的 relay 身份（注册与撤销都只读它）。 */
const IDENTITY: RelayIdentity = { id: 'abc123', secret: 'secret' }

/** 本机快速隧道这一次运行报出的 URL。 */
const TUNNEL = 'https://warm-river-42.trycloudflare.com'

/** 稳定子域名的 hostname。 */
const HOSTNAME = 'abc123.dsh-market.com'

/** 一条桥租约：控制面把传输交给桥连接器，本机不必跑 cloudflared。 */
const BRIDGED_CLAIM: RelayClaim = {
  mode: 'bridge',
  hostname: HOSTNAME,
  bridge: { endpoint: 'http://127.0.0.1:1/relay/bridge', instance: 'abc123', credential: 'lease-secret' },
}

/** 一次假 fetch 收到的调用。 */
interface FakeCall {
  url: string
  method: string
  target: string | undefined
}

/** 让排队的微任务与立即任务先跑完。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

/**
 * 一个记账的假 fetch，从不联网。
 * @param outcome - ok 答 200，fail 答 500。
 * @returns fetch 与它收到的调用。
 */
function recordingFetch(outcome: 'ok' | 'fail'): { fetchFn: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const fetchFn = async (input: unknown, init?: { method?: string; body?: unknown }): Promise<unknown> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { target?: string } : {}
    calls.push({ url: String(input), method: init?.method ?? 'GET', target: body.target })
    if (outcome === 'fail') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

/**
 * 用真实的 RelayRegistrar 驱动一个 announcer；退避重试用一个空计时器，测试窗口里
 * 不会真的重试，也不会留下待触发的定时器。
 * @param outcome - 假 Worker 的答法。
 * @returns announcer 与它发出的调用。
 */
function announcerOver(outcome: 'ok' | 'fail'): { announcer: RelayAnnouncer; calls: FakeCall[] } {
  const fake = recordingFetch(outcome)
  const announcer = createRelayAnnouncer({
    identity: () => ({ ...IDENTITY }),
    registrar: (identity, onState) => new RelayRegistrar(identity, onState, {
      fetchFn: fake.fetchFn,
      timerFn: () => ({ unref: () => undefined } as unknown as NodeJS.Timeout),
    }),
  })
  return { announcer, calls: fake.calls }
}

describe('快速隧道的注册行', () => {
  it('operator: 隧道 running 时注册一次，重复的 running 事件不再注册', async () => {
    // Given a quick plan over a real registrar with a recording Worker
    const { announcer, calls } = announcerOver('ok')
    // When the tunnel reports its URL twice
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    // Then the Worker saw exactly one registration, naming that URL
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(RELAY_REGISTER_URL)
    expect(calls[0]?.target).toBe(TUNNEL)
    // And the announcer now knows the stable subdomain is served
    expect(announcer.registered).toBe(TUNNEL)
    announcer.dispose()
  })

  it('operator: relay 关掉时不注册，从开到关会撤掉那行', async () => {
    // Given a row whose relay toggle is off
    const { announcer, calls } = announcerOver('ok')
    // When a running quick tunnel is reported
    announcer.sync({ relay: false, mode: 'quick', url: TUNNEL })
    await flush()
    // Then nothing is registered at all
    expect(calls).toEqual([])
    // When the toggle is on and the tunnel runs, then turned off again
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    expect(calls.map(call => call.url)).toEqual([RELAY_REGISTER_URL])
    announcer.sync({ relay: false, mode: 'quick', url: TUNNEL })
    await flush()
    // Then the registry row is withdrawn and the stable origin is not claimed
    expect(calls.map(call => call.url)).toEqual([RELAY_REGISTER_URL, RELAY_UNREGISTER_URL])
    expect(announcer.registered).toBeUndefined()
    announcer.dispose()
  })

  it('operator: 只有快速隧道计划才写这行，命名隧道与关着的隧道都不写', () => {
    // Given four tunnel states
    // When each is asked what it should register
    const decisions = [
      relayAnnounceTargetOf({ relay: true, mode: 'quick', url: TUNNEL }),
      relayAnnounceTargetOf({ relay: true, mode: 'named', url: TUNNEL }),
      relayAnnounceTargetOf({ relay: true, mode: 'off', url: undefined }),
      relayAnnounceTargetOf({ relay: false, mode: 'quick', url: TUNNEL }),
    ]
    // Then only the running quick tunnel has a target
    expect(decisions).toEqual([TUNNEL, undefined, undefined, undefined])
  })
})

describe('二维码的地址取用顺序', () => {
  it('operator: 租约是 quick 而注册还没成功时，二维码退回隧道 URL 而不是空子域名', async () => {
    // Given a quick lease and a Worker that refuses the registration
    const { announcer } = announcerOver('fail')
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    // Then nothing landed in the registry
    expect(announcer.registered).toBeUndefined()
    // When the pairing origin is computed from that state
    const facts = discoverPairOrigin({
      realtime: () => livePublicOriginOf({
        lease: { mode: 'quick', hostname: HOSTNAME },
        registered: announcer.registered,
        tunnel: { phase: 'running', url: TUNNEL },
      }),
    })
    // Then the QR names the tunnel the phone can actually reach
    expect(facts).toEqual({ origin: TUNNEL, source: 'realtime' })
    announcer.dispose()
  })

  it('operator: 租约是 bridge 或 named 时稳定子域名照旧优先', () => {
    // Given leases whose own transport serves the hostname
    // When the origin is computed with a running tunnel behind them
    // Then the stable subdomain is what the QR carries
    expect(livePublicOriginOf({
      lease: { mode: 'bridge', hostname: HOSTNAME },
      registered: undefined,
      tunnel: { phase: 'running', url: TUNNEL },
    })).toBe('https://' + HOSTNAME)
    expect(livePublicOriginOf({
      lease: { mode: 'named', hostname: HOSTNAME },
      registered: undefined,
      tunnel: { phase: 'running', url: TUNNEL },
    })).toBe('https://' + HOSTNAME)
    // And a quick lease whose registration landed prefers it too
    expect(livePublicOriginOf({
      lease: { mode: 'quick', hostname: HOSTNAME },
      registered: TUNNEL,
      tunnel: { phase: 'running', url: TUNNEL },
    })).toBe('https://' + HOSTNAME)
  })

  it('operator: 没有租约时用隧道 URL，什么都没起时什么都不给', () => {
    // Given no accepted lease
    // When the tunnel is running, and then not running
    // Then the tunnel URL answers first, and a stopped tunnel names nothing
    expect(livePublicOriginOf({ lease: undefined, registered: undefined, tunnel: { phase: 'running', url: TUNNEL } }))
      .toBe(TUNNEL)
    expect(livePublicOriginOf({ lease: undefined, registered: undefined, tunnel: { phase: 'stopped' } }))
      .toBeUndefined()
    expect(livePublicOriginOf({ lease: undefined, registered: undefined, tunnel: undefined })).toBeUndefined()
  })
})
describe('relay 关掉与卸载是两件事', () => {
  it('operator: 关掉 relay 时恰好释放租约一次，并在释放之后关掉连接器', async () => {
    // Given a running relay half: one accepted bridged lease beside its registry row
    const events: string[] = []
    const { announcer, calls } = announcerOver('ok')
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    const pair = new RelayConnectorPair(IDENTITY, {
      claim: async () => ({ ok: true, claim: BRIDGED_CLAIM }),
      release: async () => { events.push('release') },
      ...leaseConnectorSeams({
        plan: () => ({ mode: 'off' }),
        startNamed: () => { events.push('named') },
        startBridge: () => { events.push('start') },
        stopBridge: () => { events.push('dispose') },
      }),
    })
    await pair.start({ port: 41000 })
    expect(events).toEqual(['start'])
    const half = createRelayHalfSwitch({ announcer, pair: () => pair })
    // When the relay is switched off twice
    half.off()
    await flush()
    half.off()
    await flush()
    // Then the lease was released exactly once, after the connector came up and
    // before it was closed (the pair stops its own connectors on release, and the
    // switch's dispose is what stops the retry timer behind them)
    expect(events.filter(name => name === 'release')).toHaveLength(1)
    expect(events.indexOf('release')).toBeGreaterThan(events.indexOf('start'))
    expect(events.indexOf('dispose')).toBeGreaterThan(events.indexOf('release'))
    // And the Worker row went with it
    expect(calls.map(call => call.url)).toEqual([RELAY_REGISTER_URL, RELAY_UNREGISTER_URL])
    expect(announcer.registered).toBeUndefined()
  })

  it('operator: 卸载不释放租约，也不撤注册行', async () => {
    // Given the same running half
    const events: string[] = []
    const { announcer, calls } = announcerOver('ok')
    announcer.sync({ relay: true, mode: 'quick', url: TUNNEL })
    await flush()
    const pair = new RelayConnectorPair(IDENTITY, {
      claim: async () => ({ ok: true, claim: BRIDGED_CLAIM }),
      release: async () => { events.push('release') },
      ...leaseConnectorSeams({
        plan: () => ({ mode: 'off' }),
        startNamed: () => undefined,
        startBridge: () => undefined,
      }),
    })
    await pair.start({ port: 41000 })
    const half = createRelayHalfSwitch({ announcer, pair: () => pair })
    // When the plugin unmounts
    half.dispose()
    await flush()
    // Then neither the lease nor the registry row is touched: both are the phone's
    // bookmark, and a Host restart must not erase it
    expect(events).toEqual([])
    expect(calls.map(call => call.url)).toEqual([RELAY_REGISTER_URL])
  })
})
