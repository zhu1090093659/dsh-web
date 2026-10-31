/**
 * The LAN forwarder (issue #1917): a runtime listener on this machine's LAN
 * address that re-issues every request - HTTP and WebSocket upgrade - to the
 * process's own loopback listener.
 *
 * The specs below are the security and robustness contract, on real sockets:
 *
 * (c) a bind that cannot be taken (port already held, address not on this
 *     machine) is reported and leaves the loopback listener serving - it can
 *     never brick the host, which is what the previous design did when the
 *     pinned address disappeared after a network change;
 * (d) a forwarded request carries the LAN authority, not the client's own Host:
 *     the forwarder drops whatever the client sent (a LAN client can forge
 *     127.0.0.1:<port>) and stamps the authority it was reached at;
 * (e) WebSocket upgrades pass through with the same rewrite;
 * and the lifecycle rule: a dispose closes the listener and every connection it
 * opened, so the port is free again.
 *
 * 判据被替换，不是被搬走。老插件靠 web-ui 包的 src/gate.ts::isLoopbackClient 与
 * src/routes.ts::isTrustedApiRequest 判「这个请求算不算桌面」——本包没有这套服务端
 * 会话/配对门，也不打算复刻它。局域网侧现在的公网面由入站闸门裁定：闸门只放行
 * /ios/v1，其余请求在闸门这一跳就 404 且不拨上游，而 /ios/v1 的准入是协议自己的
 * 无条件令牌判定（未配对连接只能 hello / pair.begin / pair.finish）。因此原来那两条
 * 「经转发器不会被判为桌面」的用例整例移出本文件，性质由这两处覆盖：
 *   - tests/ingress-gate.spec.ts
 *       'operator: the whitelist matches the path, not a whole URL'
 *       'operator: an upgrade outside the whitelist is refused and never dialed'
 *       'operator: a plain request is refused even on the served path'
 *   - tests/ingress-gate-forwarding.spec.ts（用本文件的 LanForwarder 串上闸门）
 *       'operator: 非 /ios/v1 的请求在闸门被 404，webServer 一个连接都没有'
 *       'operator: /ios/v1 的升级穿过去，Host 被改写成闸门拨的回环权威'
 * 移出的两个用例名是 'operator: a forged loopback Host does not survive, and the
 * request is not the desktop' 与 'operator: an ordinary LAN request through the
 * forwarder is not the desktop either'。
 *
 * 同一判据在 recordingUpstream 里产生的 client 观测，以及其余两个用例对它的断言，
 * 随判据一并移除；Host 改写与 X-Forwarded-For 的断言原样保留。为使用例名不越过
 * 实际断言，另有两处改名（原 -> 新）：
 *   'operator: a forged loopback Host is replaced by the LAN authority and the request is not the desktop'
 *     -> 'operator: a forged loopback Host is replaced by the LAN authority'
 *   'operator: the desktop itself still reads as the desktop without the forwarder'
 *     -> 'operator: the desktop keeps its own Host when it dials the loopback listener directly'
 */
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { LanForwarder, authorityOf, forwardedHeaders, type LanForwardState } from '../src/host/lan-forward.ts'

/** Everything a test opened, torn down in reverse order. */
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * Listen one HTTP server on loopback and register its teardown.
 * @param handler - request handler.
 * @returns the port it bound.
 */
async function serveHttp(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; server: Server }> {
  const server = createHttpServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => { resolve() })
  }))
  return { port: (server.address() as AddressInfo).port, server }
}

/**
 * Bind one TCP listener on loopback and register its teardown.
 * @returns the port it holds.
 */
async function holdPort(): Promise<number> {
  const server = createTcpServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  return (server.address() as AddressInfo).port
}

/**
 * Start one forwarder and register its teardown.
 * @param address - listen address.
 * @param port - listen port.
 * @param upstreamPort - loopback port to re-issue to.
 * @returns the forwarder and its settled state.
 */
async function forward(address: string, port: number, upstreamPort: number): Promise<{ forwarder: LanForwarder; state: LanForwardState }> {
  const forwarder = new LanForwarder()
  cleanups.push(() => forwarder.stop())
  const state = await forwarder.start(address, port, upstreamPort)
  return { forwarder, state }
}

/**
 * One HTTP request through a listener.
 * @param port - the port to dial.
 * @param headers - extra request headers (the Host override is the point of the
 *   security case below).
 * @returns the status and body.
 */
function call(port: number, headers: Record<string, string> = {}, host: string = '127.0.0.1'): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host, port, path: '/api/pair/status', headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk as Buffer))
      response.on('end', () => {
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

/**
 * One raw WebSocket-style upgrade through a listener.
 * @param port - the port to dial.
 * @param hostHeader - the Host the client claims.
 * @returns the response head, and whether the loopback leg echoed a byte back.
 */
function upgrade(port: number, hostHeader: string): Promise<{ head: string; echoed: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let head = ''
    let echoed = ''
    let upgraded = false
    const timer = setTimeout(() => { // test-standards-allow: a test budget for an upgrade that never answers, not a synchronisation sleep
      socket.destroy()
      reject(new Error('upgrade timed out; head=' + head))
    }, 5_000)
    socket.on('error', (error) => { clearTimeout(timer); reject(error) })
    socket.on('connect', () => {
      socket.write([
        'GET /remote/api/remote.mux HTTP/1.1',
        `Host: ${hostHeader}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      if (!upgraded) {
        head += text
        if (!head.includes('\r\n\r\n')) return
        upgraded = true
        socket.write('ping-after-upgrade')
        return
      }
      echoed += text
      if (echoed.includes('ping-after-upgrade')) {
        clearTimeout(timer)
        socket.destroy()
        resolve({ head, echoed })
      }
    })
  })
}

/** The upstream the forwarder is pointed at: records what arrived on the loopback leg. */
function recordingUpstream() {
  const seen: { host: string | undefined; forwarded: string | undefined }[] = []
  return {
    seen,
    handler: (request: IncomingMessage, response: ServerResponse): void => {
      seen.push({
        host: request.headers.host,
        forwarded: request.headers['x-forwarded-for'] as string | undefined,
      })
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('upstream-ok')
    },
  }
}

describe('a forwarded request is never the desktop (issue #1917)', () => {
  it('operator: a forged loopback Host is replaced by the LAN authority', async () => {
    // Given the process's loopback listener behind the LAN forwarder
    const upstream = recordingUpstream()
    const origin = await serveHttp(upstream.handler)
    const { state } = await forward('127.0.0.1', 0, origin.port)
    expect(state.listening).toBe(true)
    // When a LAN client forges the loopback authority the harness trusts
    const response = await call(state.port as number, { host: `127.0.0.1:${String(origin.port)}` })
    // Then the request still reached the loopback listener, and the listener saw
    // the LAN authority plus the forwarding stamp instead of the forged Host.
    expect(response.status).toBe(200)
    expect(response.body).toBe('upstream-ok')
    const seen = upstream.seen.at(-1)
    expect(seen?.host).toBe(authorityOf(state.address as string, state.port as number))
    expect(seen?.host).not.toContain('127.0.0.1:' + String(origin.port))
    expect(seen?.forwarded).toBe('127.0.0.1')
  })

  it('operator: the desktop keeps its own Host when it dials the loopback listener directly', async () => {
    // Given the same listener, dialed directly over loopback
    const upstream = recordingUpstream()
    const origin = await serveHttp(upstream.handler)
    // When a desktop request arrives
    await call(origin.port)
    // Then its Host is still the loopback authority it dialed, so the case above
    // is about the forwarder's rewrite and not about the listener.
    expect(upstream.seen.at(-1)?.host).toBe(`127.0.0.1:${String(origin.port)}`)
  })

  it('operator: a client cannot smuggle its own forwarding headers through', () => {
    // Given a request whose client claims a loopback socket through headers
    const request = {
      headers: {
        host: '127.0.0.1:3080',
        'x-forwarded-for': '127.0.0.1',
        'cf-connecting-ip': '127.0.0.1',
        'x-forwarded-proto': 'https',
        cookie: 'dsh-remote=abc',
        connection: 'keep-alive',
        upgrade: 'websocket',
      },
    } as unknown as IncomingMessage
    // When the headers are rebuilt for the loopback leg
    const headers = forwardedHeaders(request, '192.168.1.5:3080', '192.168.1.77')
    // Then the forwarder-owned headers are its own and the hop-by-hop markers
    // are gone, while ordinary request headers survive.
    expect(headers.host).toBe('192.168.1.5:3080')
    expect(headers['x-forwarded-for']).toBe('192.168.1.77')
    expect(headers['x-forwarded-proto']).toBe('http')
    expect(headers['cf-connecting-ip']).toBeUndefined()
    expect(headers.cookie).toBe('dsh-remote=abc')
    expect(headers.connection).toBeUndefined()
    expect(headers.upgrade).toBeUndefined()
  })
})

describe('the forwarder never competes with the loopback listener (issue #1917)', () => {
  it('operator: the LAN listener shares the web server port on a different address', async () => {
    // Given the web server listening on 127.0.0.1:<port>
    const origin = await serveHttp((_request, response) => { response.end('loopback-leg') })
    // When the forwarder listens on this machine's other loopback address
    // (::1) on that same port - the shape a LAN address takes in production:
    // one port, two addresses, no collision.
    const forwarder = new LanForwarder()
    cleanups.push(() => forwarder.stop())
    const state = await forwarder.start('::1', origin.port, origin.port)
    // Then both listeners coexist, and the LAN-side one answers by forwarding to
    // the loopback one - which is what makes "same port, host stays on loopback"
    // possible at all.
    expect(state.listening).toBe(true)
    expect(state.port).toBe(origin.port)
    expect(authorityOf('::1', origin.port)).toBe(`[::1]:${String(origin.port)}`)
    expect((await call(state.port as number, {}, '::1')).body).toBe('loopback-leg')
  })
})

describe('a bind that cannot be taken only loses the LAN edge (issue #1917)', () => {
  it('operator: an occupied port is reported and the loopback listener keeps serving', async () => {
    // Given a port already held on the address the forwarder would use
    const held = await holdPort()
    const origin = await serveHttp((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('loopback-alive')
    })
    // When the forwarder tries to listen there
    const { state } = await forward('127.0.0.1', held, origin.port)
    // Then the failure is a stated reason, not a crash
    expect(state.listening).toBe(false)
    expect(state.error).toContain('EADDRINUSE')
    expect(state.port).toBe(held)
    // And the process's own loopback listener is untouched.
    const direct = await call(origin.port)
    expect(direct.body).toBe('loopback-alive')
  })

  it('operator: an address this machine no longer has is reported, not fatal', async () => {
    // Given the address a network change took away
    const origin = await serveHttp((_request, response) => {
      response.writeHead(200)
      response.end('loopback-alive')
    })
    // When the forwarder tries to listen on it
    const { forwarder, state } = await forward('203.0.113.7', 0, origin.port)
    // Then it reports why and holds nothing
    expect(state.listening).toBe(false)
    expect(state.error).toContain('EADDRNOTAVAIL')
    expect(forwarder.snapshot().listening).toBe(false)
    // And stop() on a forwarder that never bound is a no-op rather than a throw.
    await expect(forwarder.stop()).resolves.toBeUndefined()
  })
})

describe('a WebSocket upgrade passes through (issue #1917)', () => {
  it('operator: the upgrade reaches the loopback listener with the LAN authority stamped', async () => {
    // Given an upstream that completes a WebSocket handshake and echoes
    const seenHosts: (string | undefined)[] = []
    const upgraded: Duplex[] = []
    const upstream = createHttpServer()
    upstream.on('upgrade', (request, socket) => {
      upgraded.push(socket)
      socket.on('error', () => undefined)
      seenHosts.push(request.headers.host)
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        '',
        '',
      ].join('\r\n'))
      socket.on('data', (chunk) => { socket.write(chunk) })
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => {
      // An upgraded socket is no longer an HTTP connection: close() waits on it,
      // so the test tears it down explicitly.
      for (const socket of upgraded.splice(0)) socket.destroy()
      upstream.closeAllConnections?.()
      upstream.close(() => { resolve() })
    }))
    const upstreamPort = (upstream.address() as AddressInfo).port
    const { state } = await forward('127.0.0.1', 0, upstreamPort)
    expect(state.listening).toBe(true)
    // When a client upgrades through the forwarder claiming a loopback Host
    const result = await upgrade(state.port as number, `127.0.0.1:${String(upstreamPort)}`)
    // Then the handshake was accepted and both directions still carry data.
    expect(result.head).toContain('101 Switching Protocols')
    expect(result.echoed).toContain('ping-after-upgrade')
    // And the loopback leg saw the LAN authority, exactly like the HTTP path.
    expect(seenHosts.at(-1)).toBe(authorityOf(state.address as string, state.port as number))
  })
})

describe('the forwarder leaves nothing behind (issue #1917)', () => {
  it('operator: a dispose releases the port and closes the connections it opened', async () => {
    // Given a listening forwarder and a client connection through it
    const origin = await serveHttp((_request, response) => { response.end('ok') })
    const forwarder = new LanForwarder()
    const state = await forwarder.start('127.0.0.1', 0, origin.port)
    expect(state.listening).toBe(true)
    const client: Socket = connect(state.port as number, '127.0.0.1')
    client.on('error', () => undefined)
    await new Promise<void>(resolve => client.on('connect', () => { resolve() }))
    const closed = new Promise<void>(resolve => client.on('close', () => { resolve() }))
    const bound = state.port as number
    // When the plugin disposes
    await forwarder.stop()
    // Then the client connection is gone and the port is free again.
    await closed
    expect(forwarder.snapshot().listening).toBe(false)
    const probe = createTcpServer()
    await expect(new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(bound, '127.0.0.1', () => { probe.close(() => { resolve() }) })
    })).resolves.toBeUndefined()
  })

  it('operator: starting the same target twice keeps one listener', async () => {
    // Given a running forwarder
    const origin = await serveHttp((_request, response) => { response.end('ok') })
    const forwarder = new LanForwarder()
    cleanups.push(() => forwarder.stop())
    const first = await forwarder.start('127.0.0.1', 0, origin.port)
    // When the same target is started again
    const second = await forwarder.start('127.0.0.1', first.port as number, origin.port)
    // Then the listener is the same one and it still answers.
    expect(second.port).toBe(first.port)
    expect((await call(first.port as number)).body).toBe('ok')
  })
})
