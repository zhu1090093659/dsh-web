/**
 * 配对二维码的局域网兜底：地址只从局域网转发器自己报出的监听事实来。
 *
 * 默认配置（lanBind 关、宿主绑回环）下本机的局域网地址上没有监听者，于是拿地址列表
 * 的第一个去拼二维码就是一个拨不通的地址。下面两条钉住「有监听者才有地址」：第一条
 * 要一次真实的监听（端口 0 由内核分配），第二条向配对令牌路由要一次真实响应。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { PairingService } from '../src/core/pairing.ts'
import { WS_PATH } from '../src/core/protocol.ts'
import { lanOriginOf } from '../src/index.ts'
import { LanForwarder } from '../src/host/lan-forward.ts'
import { makePairTokenRoute } from '../src/host/routes.ts'

/** 一个把路由写出的内容记下来的响应。 */
class RecordingResponse {
  status = 0
  body = ''

  writeHead(status: number): this {
    this.status = status
    return this
  }

  end(text?: string): void {
    this.body = text ?? ''
  }

  asServerResponse(): ServerResponse {
    return this as unknown as ServerResponse
  }
}

/** 一次回环请求：令牌路由只认这一种来源。 */
function loopbackRequest(): IncomingMessage {
  return {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3000' },
    method: 'GET',
  } as unknown as IncomingMessage
}

/**
 * 向真实的配对令牌路由要一次响应：局域网这条缝接在这个转发器上，其它来源全部拿掉，
 * 于是响应里写出来的地址只可能来自转发器自己的监听事实。
 * @param forwarder - 提供实时状态的那个转发器。
 * @returns 解析后的响应体。
 */
function tokenBodyOf(forwarder: LanForwarder): Record<string, unknown> {
  const saved = process.env.DSH_REMOTE_PUBLIC_BASE_URL
  delete process.env.DSH_REMOTE_PUBLIC_BASE_URL
  try {
    const response = new RecordingResponse()
    const route = makePairTokenRoute({
      pairing: new PairingService(),
      log: () => undefined,
      realtime: () => undefined,
      lan: () => lanOriginOf(forwarder.snapshot()),
    })
    void route.handler(loopbackRequest(), response.asServerResponse())
    expect(response.status).toBe(200)
    return JSON.parse(response.body) as Record<string, unknown>
  } finally {
    if (saved !== undefined) process.env.DSH_REMOTE_PUBLIC_BASE_URL = saved
  }
}

describe('局域网兜底地址只来自真实监听', () => {
  it('operator: 没有监听者就没有兜底地址，配对令牌响应里不带 origin 与 pairingUrl', () => {
    // Given a forwarder that was never started (the default configuration)
    const forwarder = new LanForwarder()
    // Then the LAN fallback has no answer at all
    expect(lanOriginOf(forwarder.snapshot())).toBeUndefined()
    // When the pairing token route answers
    const body = tokenBodyOf(forwarder)
    // Then the phone-facing origin and code are absent rather than unreachable
    expect(body.origin).toBeUndefined()
    expect(body.originSource).toBeUndefined()
    expect(body.pairingUrl).toBeUndefined()
    // And the machine-local link survives, so pairing still works on the host itself
    expect(typeof body.token).toBe('string')
    expect(String(body.url)).toContain(WS_PATH)
  })

  it('operator: 转发器在监听时给出它实际绑定的地址与端口，停掉之后又没有兜底地址', async () => {
    // Given a forwarder asked to listen on a kernel-assigned port
    const forwarder = new LanForwarder()
    const state = await forwarder.start('127.0.0.1', 0)
    try {
      // Then the LAN fallback is the address and port the listener actually bound
      expect(state.listening).toBe(true)
      expect(state.port).toBeGreaterThan(0)
      expect(lanOriginOf(forwarder.snapshot())).toEqual({ address: '127.0.0.1', port: state.port })
      // And the pairing code names that listener, not a guess from the address list
      const body = tokenBodyOf(forwarder)
      const address = '127.0.0.1:' + String(state.port)
      expect(body.origin).toBe('http://' + address)
      expect(body.originSource).toBe('lan')
      // The code a phone opens is a socket, so it carries the ws scheme rather
      // than the plain-HTTP one the origin is reported with
      expect(body.pairingUrl).toBe('ws://' + address + WS_PATH + '?token=' + String(body.token))
    } finally {
      await forwarder.stop()
    }
    // When the listener goes away the fallback goes with it: the fact is live, not sticky
    expect(lanOriginOf(forwarder.snapshot())).toBeUndefined()
  })
})
