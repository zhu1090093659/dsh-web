/**
 * The remote desktop event-stream upgrades: the paired-cookie gate, and the
 * loopback-shaped handshake rebuild + bidirectional pipe against a real
 * upstream that answers the WebSocket upgrade.
 */
import type { IncomingMessage } from 'node:http'
import { connect, createServer as createTcpServer, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { PairingService } from '../src/pairing.ts'
import { makeRemoteApiUpgradeRoutes, REMOTE_API_PATHS } from '../src/remote-api.ts'

function makeService(): PairingService {
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  }, {
    now: () => 1_000_000,
    randomToken: () => 'tok-1',
  })
  service.setLanBases([{ address: '192.168.1.5', base: 'http://192.168.1.5:3080' }])
  return service
}

function pairedCookie(service: PairingService): string {
  service.issue()
  const accepted = service.accept('tok-1')
  if (!accepted.ok) throw new Error('accept failed')
  return `dsh_pair=${accepted.deviceId}`
}

/** An upstream that records the handshake and echoes bytes after 101. */
interface Upstream {
  port: number
  seen: { path: string; headers: Record<string, string> }[]
  close(): Promise<void>
}

/**
 * A raw TCP upstream speaking just enough HTTP: read the GET, answer 101,
 * echo bytes. A net server (not http.Server) so its close is unconditional.
 */
async function startUpstream(): Promise<Upstream> {
  const seen: Upstream['seen'] = []
  const sockets = new Set<Socket>()
  const server = createTcpServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
    socket.on('data', (chunk) => {
      if (seen.length === 0 && String(chunk).startsWith('GET ')) {
        const lines = String(chunk).split('\r\n')
        const headers: Record<string, string> = {}
        for (const line of lines.slice(1)) {
          const colon = line.indexOf(':')
          if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
        }
        seen.push({ path: lines[0].split(' ')[1] ?? '', headers })
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixed\r\n\r\n')
        return
      }
      socket.write(`echo:${String(chunk)}`)
    })
    socket.on('error', () => {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    seen,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    }),
  }
}

/** Drive one upgrade through a real TCP socket pair. */
async function driveUpgrade(
  handler: (req: IncomingMessage, socket: Socket, head: Buffer) => void,
  requestHeaders: Record<string, string | string[] | undefined>,
  url?: string,
): Promise<{ client: Socket; close(): Promise<void> }> {
  const tcp = createTcpServer()
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve))
  const { port } = tcp.address() as AddressInfo
  const sockets = new Set<Socket>()
  tcp.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
    const req = { headers: requestHeaders } as IncomingMessage
    if (url !== undefined) req.url = url
    handler(req, socket, Buffer.alloc(0))
  })
  const client = connect(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    client.on('connect', resolve)
    client.on('error', reject)
  })
  return {
    client,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy()
      client.destroy()
      tcp.close(() => resolve())
    }),
  }
}

function readAll(socket: Socket): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = []
    const timer = setTimeout(() => { socket.destroy(); resolve(Buffer.concat(chunks).toString('utf8')) }, 1_500)
    socket.on('data', (chunk) => {
      chunks.push(chunk as Buffer)
      if (Buffer.concat(chunks).includes('echo:ping-from-client')) {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    })
    socket.on('close', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

/** Resolve once the socket has received the 101 (real clients wait for it before sending frames). */
function waitFor101(socket: Socket): Promise<void> {
  return new Promise<void>((resolve) => {
    const check = (chunk: Buffer): void => { if (String(chunk).includes('101')) { socket.off('data', check); resolve() } }
    socket.on('data', check)
  })
}

describe('remote desktop event-stream upgrades', () => {
  it('destroys the socket of an unpaired client without reaching upstream', async () => {
    const service = makeService()
    const upstream = await startUpstream()
    const [route] = makeRemoteApiUpgradeRoutes({ service, port: upstream.port })
    const headers = { cookie: undefined, 'sec-websocket-key': 'k', 'sec-websocket-version': '13' }
    const driven = await driveUpgrade(route.handler, headers)
    const received = await readAll(driven.client)
    try {
      expect(driven.client.destroyed || received).toBeTruthy()
      expect(upstream.seen.length).toBe(0)
    } finally {
      await driven.close()
      await upstream.close()
    }
  })

  it('proxies an unpaired upgrade when the pairing policy is off', async () => {
    const service = makeService()
    const upstream = await startUpstream()
    const [route] = makeRemoteApiUpgradeRoutes({ service, port: upstream.port, requirePairingForLan: false })
    const driven = await driveUpgrade(route.handler, { 'sec-websocket-key': 'k', 'sec-websocket-version': '13' })
    const waiter = readAll(driven.client)
    await waitFor101(driven.client)
    driven.client.write('ping-from-client')
    const received = await waiter
    try {
      expect(upstream.seen.length).toBe(1)
      expect(upstream.seen[0].path).toBe('/api/remote.mux')
      expect(received).toContain('101 Switching Protocols')
      expect(received).toContain('echo:ping-from-client')
    } finally {
      await driven.close()
      await upstream.close()
    }
  })

  it('rebuilds a loopback handshake and pipes bytes both ways', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream()
    const [route] = makeRemoteApiUpgradeRoutes({ service, port: upstream.port })
    expect(route.path).toBe(REMOTE_API_PATHS.mux)
    const driven = await driveUpgrade(route.handler, {
      cookie,
      origin: 'https://tunnel.example.com',
      'sec-websocket-key': 'client-key',
      'sec-websocket-version': '13',
      'sec-websocket-extensions': 'permessage-deflate',
    })
    const waiter = readAll(driven.client)
    await waitFor101(driven.client)
    driven.client.write('ping-from-client')
    const received = await waiter
    try {
      // The upstream saw the rewritten path, a loopback Host, the forwarded
      // WS headers, and no Origin.
      expect(upstream.seen.length).toBe(1)
      expect(upstream.seen[0].path).toBe('/api/remote.mux')
      expect(upstream.seen[0].headers.host).toBe(`127.0.0.1:${String(upstream.port)}`)
      expect(upstream.seen[0].headers.origin).toBeUndefined()
      expect(upstream.seen[0].headers['sec-websocket-key']).toBe('client-key')
      expect(upstream.seen[0].headers['sec-websocket-extensions']).toBe('permessage-deflate')
      // The 101 plus the echo both flowed back through the pipe.
      expect(received).toContain('101 Switching Protocols')
      expect(received).toContain('echo:ping-from-client')
    } finally {
      await driven.close()
      await upstream.close()
    }
  })

  it('maps the gated mux onto the inner /api/remote.mux and preserves the device query', async () => {
    // The official client opens wss://…/api/remote.mux; the boot patch rewrites
    // it to /remote/api/remote.mux?device=<id>, and the upgrade route must
    // forward the mux path plus the query to the loopback gateway.
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream()
    const routes = makeRemoteApiUpgradeRoutes({ service, port: upstream.port })
    const muxRoute = routes.find(route => route.path === REMOTE_API_PATHS.mux)
    expect(muxRoute).toBeDefined()
    const driven = await driveUpgrade(
      muxRoute!.handler,
      { cookie, 'sec-websocket-key': 'k', 'sec-websocket-version': '13' },
      '/remote/api/remote.mux?device=dev-42',
    )
    const waiter = readAll(driven.client)
    await waitFor101(driven.client)
    driven.client.write('hi')
    await waiter
    try {
      expect(upstream.seen[0].path).toBe('/api/remote.mux?device=dev-42')
    } finally {
      await driven.close()
      await upstream.close()
    }
  })
})
