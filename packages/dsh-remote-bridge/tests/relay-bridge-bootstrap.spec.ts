/**
 * 桥连接器与租约的接线性质，按行为钉住。
 *
 * 老插件把这几条写在源码正文里（bodyOf），本包换成驱动真实的 RelayConnectorPair
 * 与接线函数：计划与租约的每一格里，看到的是「起来了什么、没起来什么」。
 *
 * 迁移保留的一条：连接器默认把状态写盘，因为 Desktop 宿主跑在没有人读 stdout 的
 * 进程里。这一条也按行为断言——不给 stateFile，让它自己落到 $DSH_HOME 里，再读回来
 * 看状态机写了什么，不读源码正文。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bridgeWiringPlanOf,
  createLeaseClaimer,
  leaseConnectorSeams,
  resolveBridgeConfig,
} from '../src/index.ts'
import type { RelayClaim } from '../src/host/relay-control.ts'
import { createRelayBridgeRunner, type RelayBridgeStateRecord } from '../src/host/relay-bridge-connector.ts'
import { RelayConnectorPair } from '../src/host/relay-connector.ts'
import type { TunnelPlan } from '../src/host/tunnel-plan.ts'

/** 用例动过的 DSH_HOME 与临时目录，结束时一律还原。 */
const savedHome = process.env.DSH_HOME
const tempHomes: string[] = []

afterEach(() => {
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  while (tempHomes.length > 0) rmSync(tempHomes.pop() as string, { recursive: true, force: true })
})

/**
 * 等到条件成立。
 * @param ready - 条件。
 * @returns 条件成立或轮询用尽。
 */
async function until(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (ready()) return
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

/**
 * 读回状态记录。
 * @param file - 记录路径。
 * @returns 记录，文件还没落盘时 undefined。
 */
function recordAt(file: string): RelayBridgeStateRecord | undefined {
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8')) as RelayBridgeStateRecord
}

/** 本进程的 relay 身份（租约半区只读它，不校验）。 */
const IDENTITY = { id: '0123456789abcdef', secret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }

/** 一条带隧道的租约：控制面要本机自己跑 cloudflared。 */
const NAMED_CLAIM: RelayClaim = {
  mode: 'named',
  hostname: 'abc123.dsh-market.com',
  tunnel: { id: '11111111-2222-3333-4444-555555555555', token: 'run-token' },
}

/** 一条桥租约：控制面让本机拨对象，没有隧道可跑。 */
const BRIDGED_CLAIM: RelayClaim = {
  mode: 'bridge',
  hostname: 'abc123.dsh-market.com',
  bridge: { endpoint: 'wss://edge.dsh-market.com/relay/bridge', instance: 'abc123', credential: 'lease-secret' },
}

/** 一条拨本机空端口的桥租约：本用例不碰任何外部主机。 */
const LOCAL_CLAIM: RelayClaim = {
  mode: 'bridge',
  hostname: 'abc123.dsh-market.com',
  bridge: { endpoint: 'http://127.0.0.1:1/relay/bridge', instance: 'abc123', credential: 'lease-secret' },
}

/** 一处空的进程环境。 */
const NO_ENV: NodeJS.ProcessEnv = {}

/** 让排队里的微任务与立即任务先跑完。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

/**
 * 用给定计划驱动一次真实的租约半区。
 * @param plan - 这次计划（undefined = 端口还没落定）。
 * @param claim - 控制面要答的租约。
 * @param started - 记账数组。
 * @returns 跑完的 pair。
 */
async function drive(plan: TunnelPlan | undefined, claim: RelayClaim, started: string[]): Promise<RelayConnectorPair> {
  const pair = new RelayConnectorPair(IDENTITY, {
    claim: async () => ({ ok: true, claim }),
    ...leaseConnectorSeams({
      plan: () => plan,
      startNamed: (_token, hostname) => { started.push('named:' + hostname) },
      startBridge: (start) => { started.push('bridge:' + String(start.port)) },
    }),
  })
  await pair.start({ port: 41000 })
  return pair
}

describe('租约跟着传输走，不跟着隧道走', () => {
  it('operator: 隧道计划无论是 off、named 还是 quick，设置同步都申领租约', () => {
    // Given three rows: no tunnel, a named tunnel, and the quick tunnel
    const configs = [
      resolveBridgeConfig({ autoTunnel: false }, NO_ENV),
      resolveBridgeConfig({ autoTunnel: false, tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, NO_ENV),
      resolveBridgeConfig({ autoTunnel: true }, NO_ENV),
    ]
    // When each is planned against a settled gate port
    const plans = configs.map(config => bridgeWiringPlanOf({ config, gatePort: 41000 }))
    // Then every one of them claims, whatever the tunnel branch decided
    expect(plans.map(plan => plan.claim)).toEqual([true, true, true])
    expect(plans.map(plan => plan.tunnel?.mode)).toEqual(['off', 'named', 'quick'])
  })

  it('operator: 申领只有一个出口，同一把键不会重复申领', async () => {
    // Given the one claimer the whole bridge goes through
    const claims: number[] = []
    const claimer = createLeaseClaimer({ start: async (input) => { claims.push(input.port) } })
    // When the same trigger fires twice
    expect(claimer.claim(41000, undefined)).toBe(true)
    expect(claimer.claim(41000, undefined)).toBe(false)
    await flush()
    // Then one request left the process
    expect(claims).toEqual([41000])
    // When the tunnel mints a URL the key moves, so the lease is refreshed
    expect(claimer.claim(41000, 'https://new.trycloudflare.com')).toBe(true)
    await flush()
    expect(claims).toEqual([41000, 41000])
    // And a disposed claimer never claims again
    claimer.dispose()
    expect(claimer.claim(42000, undefined)).toBe(false)
  })

  it('operator: 没有快速隧道的计划仍然起桥连接器，而且拨的是闸门端口', async () => {
    // Given a bridged lease and a plan that runs no tunnel
    const started: string[] = []
    // When the pair accepts the lease
    const pair = await drive({ mode: 'off' }, BRIDGED_CLAIM, started)
    // Then the bridge connector is up on the gate port, and no second cloudflared ran
    expect(started).toEqual(['bridge:41000'])
    expect(pair.served).toBe('bridge')
  })

  it('operator: 租约里的命名连接器只在快速隧道计划下启动', async () => {
    // Given a lease that carries a tunnel, under a plan that runs none
    const offPlan: string[] = []
    await drive({ mode: 'off' }, NAMED_CLAIM, offPlan)
    // Then the named connector stays off: the bridge does not spawn a tunnel
    // behind the operator's back
    expect(offPlan).toEqual([])
    // When the plan is the quick tunnel, the lease's tunnel is its sibling
    const quickPlan: string[] = []
    await drive({ mode: 'quick', targetUrl: 'http://127.0.0.1:41000', ignored: [] }, NAMED_CLAIM, quickPlan)
    expect(quickPlan).toEqual(['named:abc123.dsh-market.com'])
  })
})

describe('the connector records its state where no stdout is', () => {
  it('operator: 不给 stateFile 时状态真的落在 $DSH_HOME 里，并跟着状态机改写', async () => {
    // Given a throwaway DSH home and the runner the host builds with no stateFile
    const home = mkdtempSync(join(tmpdir(), 'relay-bridge-state-'))
    tempHomes.push(home)
    process.env.DSH_HOME = home
    const file = join(home, 'remote-web-ui-relay-bridge.json')
    const runner = createRelayBridgeRunner()
    // When one bridged lease starts it against a loopback port nothing listens on
    runner.start({ claim: LOCAL_CLAIM, identity: IDENTITY, port: 41000 })
    // Then the dialling record is already on disk, naming the lease it dials
    const dialling = recordAt(file)
    expect(dialling).toMatchObject({
      state: 'dialing',
      instance: IDENTITY.id,
      hostname: LOCAL_CLAIM.hostname,
      endpoint: LOCAL_CLAIM.bridge?.endpoint,
      upstream: 'http://127.0.0.1:41000',
    })
    expect(dialling?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // When the refused dial settles
    await until(() => recordAt(file)?.state === 'failed')
    // Then the same file carries the failure the state machine reported
    const failed = recordAt(file)
    expect(failed?.state).toBe('failed')
    expect(typeof failed?.error).toBe('string')
    runner.stop()
  })
})
