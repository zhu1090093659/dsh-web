/**
 * 局域网转发器 -> 入站闸门 -> webServer 这一段。
 *
 * 转发器的上游是闸门时，公网侧能看见的东西只剩一条路径：不是 /ios/v1 的请求在
 * 闸门这一跳就被 404，webServer 一个连接都不会收到；只有 /ios/v1 的升级能穿过去，
 * 而且它的 Host 被改写成闸门自己拨的那个回环权威。真实 socket，不用桩。
 */
import { createServer, type IncomingMessage } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { INGRESS_NOT_FOUND_BODY, createIngressGate } from '../src/host/ingress-gate.ts'
import { LanForwarder } from '../src/host/lan-forward.ts'

/** 每个用例打开的东西，按开起来的反序拆掉。 */
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** 一个假的 webServer：数连接，并把 /ios/v1 的升级接住。 */
interface FakeWebServer {
  port: number
  connections: () => number
  upgrades: IncomingMessage[]
}

/**
 * 起一个假 webServer。
 * @returns 端口、连接计数与收到的升级请求。
 */
async function fakeWebServer(): Promise<FakeWebServer> {
  let connections = 0
  const upgrades: IncomingMessage[] = []
  const held = new Set<Duplex>()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('web-server')
  })
  server.on('connection', () => { connections += 1 })
  server.on('upgrade', (request, socket) => {
    upgrades.push(request)
    held.add(socket)
    socket.on('close', () => { held.delete(socket) })
    // 答完 101 就收线：这一段测的是穿透与 Host 改写，两端都不必留住连接。
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => {
    for (const socket of held) socket.destroy()
    held.clear()
    server.closeAllConnections?.()
    server.close(() => { resolve() })
  }))
  return { port: (server.address() as AddressInfo).port, connections: () => connections, upgrades }
}

/**
 * 起一个闸门加一个指向它的转发器。
 * @returns 假 webServer 与转发器的监听端口。
 */
async function gateBehindForwarder(): Promise<{ upstream: FakeWebServer; forwardPort: number }> {
  const upstream = await fakeWebServer()
  const gate = createIngressGate({ upstreamHost: '127.0.0.1', upstreamPort: upstream.port })
  const started = await gate.start()
  cleanups.push(() => { gate.stop() })
  const forwarder = new LanForwarder()
  cleanups.push(() => forwarder.stop())
  const state = await forwarder.start('127.0.0.1', 0, started.port)
  expect(state.listening).toBe(true)
  return { upstream, forwardPort: state.port as number }
}

/**
 * 发一个普通 HTTP/1.1 请求，收完整条应答。
 * @param port - 转发器的监听端口。
 * @param path - 请求路径。
 * @returns 服务端答的原文。
 */
function plainRequest(port: number, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write('GET ' + path + ' HTTP/1.1\r\nHost: 192.168.1.5:' + String(port) + '\r\nConnection: close\r\n\r\n')
    })
    let text = ''
    socket.on('data', (chunk) => { text += chunk.toString('latin1') })
    socket.on('error', reject)
    socket.on('close', () => { resolve(text) })
  })
}

/**
 * 发一个 WebSocket 升级，只收状态行。
 * @param port - 转发器的监听端口。
 * @param path - 请求路径。
 * @returns 状态行，例如 'HTTP/1.1 101 Switching Protocols'。
 */
function upgradeRequest(port: number, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write('GET ' + path + ' HTTP/1.1\r\nHost: 192.168.1.5:' + String(port)
        + '\r\nUpgrade: websocket\r\nConnection: Upgrade'
        + '\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
        + '\r\nSec-WebSocket-Version: 13\r\n\r\n')
    })
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk.toString('latin1')
      if (text.includes('\r\n')) {
        socket.destroy()
        resolve(text.slice(0, text.indexOf('\r\n')))
      }
    })
    socket.on('error', reject)
  })
}

describe('转发器把公网面钉在闸门上', () => {
  it('operator: 非 /ios/v1 的请求在闸门被 404，webServer 一个连接都没有', async () => {
    // Given a forwarder whose upstream is the gate
    const { upstream, forwardPort } = await gateBehindForwarder()
    // When a LAN client asks for a path the bridge does not serve
    const answer = await plainRequest(forwardPort, '/api/pair/status?x=1')
    // Then the gate refused it itself
    expect(answer.startsWith('HTTP/1.1 404')).toBe(true)
    expect(answer).toContain(INGRESS_NOT_FOUND_BODY)
    // And the host's own routes never saw a connection
    expect(upstream.connections()).toBe(0)
  })

  it('operator: /ios/v1 的升级穿过去，Host 被改写成闸门拨的回环权威', async () => {
    // Given the same chain
    const { upstream, forwardPort } = await gateBehindForwarder()
    // When the phone's upgrade arrives at the forwarder
    const status = await upgradeRequest(forwardPort, '/ios/v1')
    // Then the host's upgrade surface answered it
    expect(status).toBe('HTTP/1.1 101 Switching Protocols')
    expect(upstream.connections()).toBe(1)
    expect(upstream.upgrades).toHaveLength(1)
    expect(upstream.upgrades[0]?.url).toBe('/ios/v1')
    // And the Host is the loopback authority the gate dialed, never the LAN one
    expect(upstream.upgrades[0]?.headers.host).toBe('127.0.0.1:' + String(upstream.port))
  })
})
