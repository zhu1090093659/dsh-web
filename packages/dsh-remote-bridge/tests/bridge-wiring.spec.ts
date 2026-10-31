/**
 * 接线本身的性质：配置面沿用老插件的字段名与缺省值、公网侧三个端口都是闸门端口、
 * 入站栈的卸载次序。
 *
 * 全部按行为断言：调导出的接线函数，看它算出什么、驱动出什么调用。
 */
import { describe, expect, it } from 'vitest'
import {
  bridgeWiringPlanOf,
  disposeBridgeStack,
  resolveBridgeConfig,
} from '../src/index.ts'

/** 一处空的进程环境。 */
const NO_ENV: NodeJS.ProcessEnv = {}

/** 让排队的微任务与立即任务先跑完。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

describe('配置面沿用老插件的字段名与缺省值', () => {
  it('operator: 什么都不配时读出的就是老插件那套缺省值', () => {
    // Given a row with no config at all
    // When the bridge resolves it
    const config = resolveBridgeConfig(undefined, NO_ENV)
    // Then every field carries the value dsh-remote-web-ui has always used
    expect(config).toEqual({
      relay: true,
      autoTunnel: false,
      tunnelToken: undefined,
      publicBaseUrl: undefined,
      profile: 'desktop',
      lanBind: undefined,
      ingressSync: false,
      cfApiToken: undefined,
      cfAccountId: undefined,
      cfTunnelId: undefined,
    })
  })

  it('operator: profile YAML 直接沿用，空白当没设，写错的布尔回退缺省', () => {
    // Given a YAML row written for the old plugin, plus a few malformed values
    const config = resolveBridgeConfig({
      relay: 'false',
      autoTunnel: true,
      tunnelToken: '  tok  ',
      publicBaseUrl: '',
      profile: 'web',
      lanBind: 'true',
      ingressSync: 'yes',
      cfApiToken: '   ',
      cfAccountId: 'acct',
      cfTunnelId: 'tunnel',
    }, { DSH_PROFILE: 'rescue' })
    // When the bridge resolves it
    // Then the well-formed fields land, and the rest fall back instead of guessing
    expect(config).toEqual({
      relay: false,
      autoTunnel: true,
      tunnelToken: 'tok',
      publicBaseUrl: undefined,
      profile: 'web',
      lanBind: true,
      ingressSync: false,
      cfApiToken: undefined,
      cfAccountId: 'acct',
      cfTunnelId: 'tunnel',
    })
  })

  it('operator: 没写 profile 时取 DSH_PROFILE，再缺省 desktop', () => {
    // Given an environment naming one profile, and then none
    // When each row resolves its profile
    // Then the launched profile wins, and the family default is the last resort
    expect(resolveBridgeConfig({}, { DSH_PROFILE: 'web' }).profile).toBe('web')
    expect(resolveBridgeConfig({}, NO_ENV).profile).toBe('desktop')
  })
})

describe('公网侧的端口是闸门端口，不是 webServer 端口', () => {
  it('operator: 快速隧道的目标 URL 是闸门', () => {
    // Given autoTunnel on and the gate on 41234
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({ autoTunnel: true }, NO_ENV),
      gatePort: 41234,
    })
    // When the plan is made
    // Then cloudflared is pointed at the gate, not at the web server
    expect(plan.tunnel).toEqual({ mode: 'quick', targetUrl: 'http://127.0.0.1:41234', ignored: [] })
  })

  it('operator: 局域网边缘按老插件的判据选地址', () => {
    // Given two candidate addresses
    const capability = { candidates: ['192.168.1.5', '10.0.0.3'], wildcardSupported: false }
    const lanOn = resolveBridgeConfig({ lanBind: true }, NO_ENV)
    // When the plan is made in four situations
    // Then the first candidate is chosen, never the wildcard
    expect(bridgeWiringPlanOf({ config: lanOn, gatePort: 41234, ...capability }).forward)
      .toEqual({ host: '192.168.1.5', reason: undefined })
    // And an operator who bound the host to the network gets the yield, not a second listener
    expect(bridgeWiringPlanOf({ config: lanOn, gatePort: 41234, startupHost: '192.168.1.5', ...capability }).forward)
      .toEqual({ host: undefined, reason: 'host-bind' })
    // And a machine with no LAN address is told, not silently skipped
    expect(bridgeWiringPlanOf({ config: lanOn, gatePort: 41234, candidates: [] }).forward)
      .toEqual({ host: undefined, reason: 'no-address' })
    // And an untouched toggle keeps the edge off
    expect(bridgeWiringPlanOf({ config: resolveBridgeConfig({}, NO_ENV), gatePort: 41234, ...capability }).forward)
      .toEqual({ host: undefined, reason: 'off' })
  })
})

describe('入站栈的卸载次序', () => {
  it('operator: 转发器先走，连接器、隧道其次，闸门最后关', () => {
    // Given one stack where every member records its own release
    const order: string[] = []
    const released = disposeBridgeStack({
      ingress: { dispose: () => { order.push('ingress') } },
      forwarder: { stop: () => { order.push('forwarder') } },
      connectors: { dispose: () => { order.push('connectors') } },
      tunnel: { dispose: () => { order.push('tunnel') } },
      gate: { stop: () => { order.push('gate') } },
    })
    // When the stack is released
    // Then the four required members go exactly in that order, the gate last of all
    expect(released).toEqual(['ingress', 'forwarder', 'connectors', 'tunnel', 'gate'])
    expect(order.indexOf('forwarder')).toBeLessThan(order.indexOf('connectors'))
    expect(order.indexOf('connectors')).toBeLessThan(order.indexOf('tunnel'))
    expect(order.indexOf('tunnel')).toBeLessThan(order.indexOf('gate'))
  })

  it('operator: 一个成员释放失败不影响后面的成员', async () => {
    // Given a forwarder whose asynchronous teardown rejects
    const logs: string[] = []
    // When the stack is released
    const released = disposeBridgeStack({
      forwarder: { stop: async () => { throw new Error('EADDRINUSE') } },
      gate: { stop: () => undefined },
    }, message => { logs.push(message) })
    // Then the gate is still closed
    expect(released).toEqual(['forwarder', 'gate'])
    // And the rejected teardown is stated instead of vanishing into a void
    await flush()
    expect(logs.join(' ')).toContain('EADDRINUSE')
  })
})
