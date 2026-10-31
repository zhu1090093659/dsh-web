/**
 * relay 从开改关的真实路径：插件行会被重新挂载，所以「关掉」不是一次运行时切换，
 * 而是「旧的卸载 + 新的挂载」两段。
 *
 * 旧 effect 的卸载按设计不释放（那行是手机的收藏地址），新 effect 在 relay=false 下
 * 又不建租约半区，于是释放只可能发生在挂载这一条路径上。下面几条走的是真实的挂载路
 * 径：真的把插件挂上去、真的起闸门、真的让租约半区去申领一次租约（控制面用假的
 * fetch 顶替，绝不联网）。等待一律等确定信号——假控制面把「某条路径的请求已到达 n
 * 次」暴露成 promise，用例里没有一处睡时长。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { loadRelayIdentity, relayIdentityFile } from '../src/host/relay-registry.ts'
import { settle } from './support/harness.ts'

/** 一条插件真的发出去的控制面请求。 */
interface ControlCall {
  readonly url: string
  readonly method: string
}

/** 一次挂载留在假宿主上的全部东西。 */
interface MountedHost {
  readonly disposers: (() => void)[]
}

/** 本文件里每次挂载都回报的 webServer 端口。 */
const WEB_PORT = 41000

/** 一份 JSON 回应。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 假控制面：逐条记录请求，并把「以某条路径结尾的请求已到达 n 次」暴露成确定信号，
 * 于是用例等的是被测代码真的发出了那条请求，而不是一段时间。
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
      const call: ControlCall = { url, method: init?.method ?? 'GET' }
      this.calls.push(call)
      for (const listener of [...this.listeners]) {
        this.listeners.delete(listener)
        listener()
      }
      return await this.answer(call)
    })
  }

  /** 以这条路径结尾的请求条数。 */
  countOf(path: string): number {
    return this.calls.filter(call => call.url.endsWith(path)).length
  }

  /**
   * 等到以这条路径结尾的请求到达 count 次。
   * @param path - 控制面路径后缀。
   * @param count - 需要的次数（从 1 起）。
   */
  async until(path: string, count = 1): Promise<void> {
    while (this.countOf(path) < count) {
      await new Promise<void>((resolve) => { this.listeners.add(resolve) })
    }
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

/** 日志里提到上一次挂载留下的 relay 半区的那几行。 */
function previousRelayLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map(args => String(args[0]))
    .filter(line => line.includes('previous relay'))
}

describe('relay 关掉的真实路径', () => {
  let home: string
  let plane: FakeControlPlane

  beforeEach(async () => {
    // The relay identity file lives under DSH_HOME; point it at a temp directory so
    // the suite never reads or writes the identity of this machine's installation.
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-relay-off-'))
    process.env.DSH_HOME = home
    plane = new FakeControlPlane()
    plane.stub()
    // A bridged lease carries no tunnel and no bridge grant, so nothing spawns a
    // connector for it: the claim stays a pure control-plane exchange.
    plane.respondWith(call => (call.url.endsWith('/api/relay/claim')
      ? jsonResponse({ mode: 'bridge', hostname: 'abcdefghijklmnop.dsh-market.com' })
      : jsonResponse({ ok: true })))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })

  it('operator: relay 打开挂载出的租约，在 relay 关掉的那次挂载里恰好释放一次、注册行撤一次', async () => {
    // Given a host mounted with the relay on, which claims its lease and mints its identity
    const withRelay = mountPlugin({ relay: true, autoTunnel: false, profile: 'web' })
    await plane.until('/api/relay/claim')
    expect(plane.countOf('/api/relay/claim')).toBe(1)
    expect(existsSync(relayIdentityFile('web', home))).toBe(true)
    // When that row is unmounted (the relay toggle write that precedes the remount)
    unmount(withRelay)
    await settle()
    // Then the unmount itself releases nothing: that row is the phone's bookmark
    expect(plane.countOf('/api/relay/release')).toBe(0)
    expect(plane.countOf('/api/relay/unregister')).toBe(0)
    // When the row is mounted again with the relay off
    const withoutRelay = mountPlugin({ relay: false, autoTunnel: false, profile: 'web' })
    // Then the release goes out on this mount, right after the registration is withdrawn
    await plane.until('/api/relay/release')
    await settle()
    expect(plane.countOf('/api/relay/release')).toBe(1)
    expect(plane.countOf('/api/relay/unregister')).toBe(1)
    // In that order: withdraw the row first, then free the lease
    expect(plane.calls.map(call => call.url.split('/').pop())).toEqual(['claim', 'unregister', 'release'])
    expect(plane.calls[1]?.method).toBe('POST')
    expect(plane.calls[2]?.method).toBe('POST')
    // And that mount built no relay half of its own: it claimed nothing
    expect(plane.countOf('/api/relay/claim')).toBe(1)
    unmount(withoutRelay)
  })

  it('operator: relay 关且身份文件不存在时零 release、零 register，挂载也不铸造身份', async () => {
    // Given a DSH home with no relay identity on disk
    const identityFile = relayIdentityFile('web', home)
    expect(existsSync(identityFile)).toBe(false)
    // When the plugin mounts with the relay off
    const host = mountPlugin({ relay: false, autoTunnel: false, profile: 'web' })
    await settle()
    // Then no control-plane call was made at all: nothing to release, nothing to register
    expect(plane.calls).toHaveLength(0)
    expect(plane.countOf('/api/relay/release')).toBe(0)
    expect(plane.countOf('/api/relay/register')).toBe(0)
    expect(plane.countOf('/api/relay/claim')).toBe(0)
    // And the identity path is still absent: a mount never mints an identity to release
    expect(existsSync(identityFile)).toBe(false)
    expect(existsSync(join(home, 'remote-web-ui-registry'))).toBe(false)
    unmount(host)
  })

  it('operator: 控制面回 500 时挂载照常，撤行与释放都不记行（实现只看 fetch 是否成功）', async () => {
    // Given an identity on disk and a control plane that answers 500 to everything
    loadRelayIdentity('web', home)
    plane.respondWith(() => jsonResponse({ error: 'relay control plane unavailable' }, 500))
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined) // test-standards-allow: applyImpl 的 log 直连 console.log，没有注入缝；这里只接管输出以数日志行，不 patch 模块图，finally 里 mockRestore
    try {
      // When the plugin mounts with the relay off
      const host = mountPlugin({ relay: false, autoTunnel: false, profile: 'web' })
      // Then both best-effort calls still leave the process and the caller sees no exception
      await plane.until('/api/relay/release')
      await settle()
      expect(plane.countOf('/api/relay/unregister')).toBe(1)
      expect(plane.countOf('/api/relay/release')).toBe(1)
      // And a non-2xx reply is not a transport failure: the status code is never read, so
      // this path records no line at all (the one-line log belongs to a rejected fetch)
      expect(previousRelayLines(logged)).toEqual([])
      unmount(host)
    } finally {
      logged.mockRestore()
    }
  })

  it('operator: 控制面在传输层失败时挂载照常，撤行与释放各只记一行', async () => {
    // Given an identity on disk and a control plane the process cannot reach at all
    loadRelayIdentity('web', home)
    plane.respondWith(() => Promise.reject(new Error('connect ECONNREFUSED 104.21.0.1:443')))
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined) // test-standards-allow: applyImpl 的 log 直连 console.log，没有注入缝；这里只接管输出以数日志行，不 patch 模块图，finally 里 mockRestore
    try {
      // When the plugin mounts with the relay off
      const host = mountPlugin({ relay: false, autoTunnel: false, profile: 'web' })
      // Then both attempts were made and the mount itself did not throw
      await plane.until('/api/relay/release')
      await settle()
      expect(plane.countOf('/api/relay/unregister')).toBe(1)
      expect(plane.countOf('/api/relay/release')).toBe(1)
      // And each failure is stated exactly once, carrying its own reason
      const lines = previousRelayLines(logged)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('could not be withdrawn')
      expect(lines[0]).toContain('ECONNREFUSED')
      expect(lines[1]).toContain('could not be released')
      expect(lines[1]).toContain('ECONNREFUSED')
      unmount(host)
    } finally {
      logged.mockRestore()
    }
  })
})
