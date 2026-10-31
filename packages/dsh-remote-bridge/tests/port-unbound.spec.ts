/**
 * 端口未落定的那一段：0.2.1-rc.2 的 webServer 类型在监听器 bind 之前给 undefined，
 * 一次 recompose 又可以把 apply 跑到 bind 前面。
 *
 * 三条性质全部按行为钉住（不读源码正文）：一个可注入时钟的重试计划、无隧道分支
 * 仍然发起租约申领、ingress-sync 跟随闸门端口。
 */
import { describe, expect, it } from 'vitest'
import {
  PORT_SETTLE_RETRY_MS,
  bridgeWiringPlanOf,
  createLeaseClaimer,
  createPortSettleRetry,
  resolveBridgeConfig,
  type PortSettleTimer,
} from '../src/index.ts'

/** 一个记账的假计时器：记下排了什么、什么时候放，从不真的等。 */
function recordingTimer(): PortSettleTimer & { fireAll(): void; readonly armedMs: number[] } {
  const pending = new Map<unknown, () => void>()
  const armedMs: number[] = []
  const arm = (fn: () => void, ms: number): unknown => {
    const handle = Symbol('handle')
    pending.set(handle, fn)
    armedMs.push(ms)
    return handle
  }
  const disarm = (handle: unknown): void => { pending.delete(handle) }
  return {
    armedMs,
    setTimeout: arm,
    clearTimeout: disarm,
    fireAll(): void {
      for (const fn of [...pending.values()]) fn()
      pending.clear()
    },
  }
}

/** 一处空的进程环境，供配置解析用。 */
const NO_ENV: NodeJS.ProcessEnv = {}

/** 让排队里的微任务与立即任务先跑完。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

describe('端口没落定时的重试计划', () => {
  it('operator: 只排一个重试，回放一次之后才能再排', () => {
    // Given a plan over a fake clock
    const timer = recordingTimer()
    let retries = 0
    const retry = createPortSettleRetry({ onRetry: () => { retries += 1 }, timer })
    // When it is asked twice for the same unsettled port
    expect(retry.request()).toBe(true)
    expect(retry.request()).toBe(false)
    // Then one timer is armed, at the constant the family has always used
    expect(timer.armedMs).toEqual([PORT_SETTLE_RETRY_MS])
    expect(retry.pending).toBe(true)
    // When it fires
    timer.fireAll()
    // Then the re-plan ran exactly once and the slot is free again
    expect(retries).toBe(1)
    expect(retry.pending).toBe(false)
    expect(retry.request()).toBe(true)
  })

  it('operator: 端口落定后丢掉那个重试，同一个未落定窗口只告警一次', () => {
    // Given a plan that already complained once
    const timer = recordingTimer()
    const warns: string[] = []
    let retries = 0
    const retry = createPortSettleRetry({
      onRetry: () => { retries += 1 },
      timer,
      warn: message => { warns.push(message) },
    })
    retry.request()
    retry.request()
    expect(warns).toHaveLength(1)
    // When the port settles
    retry.reset()
    // Then the armed retry is gone and never replays
    expect(retry.pending).toBe(false)
    timer.fireAll()
    expect(retries).toBe(0)
    // And a later unsettled window complains again instead of staying silent
    retry.request()
    expect(warns).toHaveLength(2)
  })

  it('operator: 卸载之后既不再排也不再回放', () => {
    // Given an armed retry
    const timer = recordingTimer()
    let retries = 0
    const retry = createPortSettleRetry({ onRetry: () => { retries += 1 }, timer })
    retry.request()
    // When the plugin disposes
    retry.dispose()
    // Then nothing is armed, and no new request is taken
    expect(retry.request()).toBe(false)
    timer.fireAll()
    expect(retries).toBe(0)
  })
})

describe('端口没落定时每一面都等它', () => {
  it('operator: 快速隧道不计划未落定的目标，租约不申领，ingress 是一次零请求等待', () => {
    // Given autoTunnel + ingressSync on and no gate port yet
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({ autoTunnel: true, ingressSync: true }, NO_ENV),
      gatePort: undefined,
    })
    // When the plan is made
    // Then it says the port is missing and schedules nothing against it
    expect(plan.awaitPort).toBe(true)
    expect(plan.tunnel).toBeUndefined()
    expect(plan.claim).toBe(false)
    expect(plan.ingress.port).toBeUndefined()
  })

  it('operator: 命名隧道不用端口，端口没落定也照样计划', () => {
    // Given a named tunnel configured and no gate port yet
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({ tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, NO_ENV),
      gatePort: undefined,
    })
    // When the plan is made
    // Then its target is on the cloud side, so it plans anyway
    expect(plan.awaitPort).toBe(true)
    expect(plan.tunnel).toEqual({ mode: 'named', token: 'tok', publicUrl: 'https://dsh.example.com' })
  })
})

describe('无隧道时租约照样申领', () => {
  it('operator: 隧道计划为 off，租约仍然申领，而且只发一次', async () => {
    // Given autoTunnel off and the relay on
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({ autoTunnel: false, relay: true }, NO_ENV),
      gatePort: 41000,
    })
    // Then the tunnel runs nothing, and the claim is still on
    expect(plan.tunnel).toEqual({ mode: 'off' })
    expect(plan.claim).toBe(true)
    // When the sync asks for that same claim twice
    const claims: number[] = []
    const claimer = createLeaseClaimer({ start: async (input) => { claims.push(input.port) } })
    expect(claimer.claim(41000, undefined)).toBe(true)
    expect(claimer.claim(41000, undefined)).toBe(false)
    await flush()
    // Then one request left the process, keyed by that port and no tunnel URL
    expect(claims).toEqual([41000])
    expect(claimer.key).toBe('41000|')
  })

  it('operator: relay 关掉时租约不申领', () => {
    // Given the relay toggle off
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({ relay: false }, NO_ENV),
      gatePort: 41000,
    })
    // When the plan is made
    // Then nothing is claimed
    expect(plan.claim).toBe(false)
  })
})

describe('ingress-sync 跟随闸门端口', () => {
  it('operator: 端口落定后 sync 的就是闸门端口', () => {
    // Given the ingress toggle on with a named tunnel
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({
        ingressSync: true,
        publicBaseUrl: 'https://dsh.example.com',
        cfApiToken: 'token',
        cfAccountId: 'acct',
        cfTunnelId: 'tunnel',
      }, NO_ENV),
      gatePort: 41000,
    })
    // When the plan is made
    // Then the sync targets the gate port, not the web server port
    expect(plan.ingress).toEqual({
      enabled: true,
      hostname: 'dsh.example.com',
      port: 41000,
      token: 'token',
      accountId: 'acct',
      tunnelId: 'tunnel',
    })
  })

  it('operator: 端口没落定时同一份配置只换成一个零请求等待', () => {
    // Given the same toggle and no gate port
    const plan = bridgeWiringPlanOf({
      config: resolveBridgeConfig({
        ingressSync: true,
        publicBaseUrl: 'https://dsh.example.com',
        cfApiToken: 'token',
        cfAccountId: 'acct',
        cfTunnelId: 'tunnel',
      }, NO_ENV),
      gatePort: undefined,
    })
    // When the plan is made
    // Then the switch reads as on but the port is absent: no request can be made
    expect(plan.ingress.port).toBeUndefined()
    expect(plan.ingress.hostname).toBe('dsh.example.com')
  })
})
