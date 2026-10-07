/**
 * Dead-link lifecycle for local port-forward tunnels (#1839): a tunnel whose
 * SSH connection is gone must refuse the next local connection and take
 * itself out of the registry instead of letting an exception escape the net
 * connection handler, where it would terminate the host process.
 *
 * The fake client below reproduces ssh2's behaviour on a dead link: it throws
 * `Not connected` out of `forwardOut` synchronously rather than reporting
 * through the callback, and it emits `close` when the transport goes away.
 */

import { connect } from 'node:net'
import { Duplex } from 'node:stream'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { DEFAULTS, type PoolRecord } from '../src/engine/connection-pool.ts'
import { listTunnels, startTunnel, stopTunnel, type TunnelEngine } from '../src/engine/tunnel.ts'
import type { HostStore } from '../src/store.ts'

const ALIAS = 'db-host'

/** How the fake client answers a channel request. */
type LinkMode =
  /** Channel opens; bytes reach the remote side. */
  | 'healthy'
  /** ssh2 1.17 behaviour on a dead link: forwardOut throws synchronously. */
  | 'throw'

/**
 * Stand-in for one ssh2 Client. It is an EventEmitter because the tunnel
 * module listens for the link's 'close', and it records the bytes a local
 * connection forwards so a test can observe the remote side without a server.
 */
class FakeClient extends EventEmitter {
  /** Channel requests that reached forwardOut. */
  readonly channelRequests: Array<{ remoteHost: string; remotePort: number }> = []
  /** Payloads written by local connections into an opened channel. */
  readonly forwarded: string[] = []
  /** Channels this client was asked to end. */
  ended = 0
  private readonly waiting: Array<(payload: string) => void> = []

  constructor(private readonly mode: LinkMode) {
    super()
  }

  forwardOut(
    _srcIP: string,
    _srcPort: number,
    remoteHost: string,
    remotePort: number,
    cb: (error: Error | undefined, stream?: Duplex) => void,
  ): void {
    this.channelRequests.push({ remoteHost, remotePort })
    if (this.mode === 'throw') throw new Error('Not connected')
    cb(undefined, this.remoteChannel())
  }

  end(): void {
    this.ended += 1
  }

  /** A channel that swallows everything written to it and reports it here. */
  private remoteChannel(): Duplex {
    return new Duplex({
      read() { /* the remote side never speaks in this fixture */ },
      write: (chunk: Buffer, _encoding, done) => {
        const payload = chunk.toString('utf8')
        this.forwarded.push(payload)
        for (const resolve of this.waiting.splice(0)) resolve(payload)
        done()
      },
    })
  }

  /** Resolve with the next payload a local connection forwards. */
  nextForwarded(): Promise<string> {
    const pending = this.forwarded.shift()
    if (pending !== undefined) return Promise.resolve(pending)
    return new Promise<string>((resolve) => { this.waiting.push(resolve) })
  }
}

/** A TunnelEngine with one pre-pooled fake link, so no SSH handshake runs. */
function tunnelEngine(client: FakeClient): { engine: TunnelEngine; record: PoolRecord } {
  const record: PoolRecord = { client: client as unknown as Client, hops: [], idleAt: 0, pinned: false, broken: false, inFlight: 0 }
  const engine: TunnelEngine = {
    store: { find: () => ({ alias: ALIAS }) } as unknown as HostStore,
    opts: { ...DEFAULTS },
    pool: new Map([[ALIAS, record]]),
    acquireQueue: new Map(),
    tunnels: new Map(),
    nextTunnelId: 1,
  }
  return { engine, record }
}

/** Connect to a local tunnel port and report how that connection ended. */
function probeLocalPort(port: number, payload?: string): Promise<{ received: string; settled: 'closed' | 'refused' }> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    let received = ''
    let settled = false
    const finish = (outcome: 'closed' | 'refused'): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ received, settled: outcome })
    }
    socket.on('connect', () => {
      // A listener that is gone answers with ECONNREFUSED instead.
      if (payload !== undefined) socket.write(payload)
    })
    socket.on('data', (chunk: Buffer) => { received += chunk.toString('utf8') })
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' ? 'refused' : 'closed')
    })
    socket.on('close', () => { finish('closed') })
  })
}

describe('tunnel dead link', () => {
  it('operator: a connection to a tunnel whose link throws Not connected is dropped and the tunnel retires', async () => {
    // Given a tunnel whose pooled link reports the dead connection by throwing
    // out of forwardOut, When the operator connects to the local port, Then the
    // connection carries no traffic, the tunnel leaves the registry, and the
    // host process is never interrupted.
    const client = new FakeClient('throw')
    const { engine } = tunnelEngine(client)
    const tunnel = await startTunnel(engine, ALIAS, { remotePort: 5432 })

    expect(await probeLocalPort(tunnel.localPort, 'select 1')).toEqual({ received: '', settled: 'closed' })
    expect(listTunnels(engine)).toHaveLength(0)
    // The listener is gone, so the next probe cannot even connect.
    expect(await probeLocalPort(tunnel.localPort)).toEqual({ received: '', settled: 'refused' })
  })

  it('operator: a link already marked broken at connect time never opens a channel', async () => {
    // Given a tunnel whose link died between the record lookup and the local
    // connection, When the operator connects, Then the tunnel is refused and
    // torn down without asking the dead connection for a channel.
    const client = new FakeClient('healthy')
    const { engine, record } = tunnelEngine(client)
    const tunnel = await startTunnel(engine, ALIAS, { remotePort: 5432 })
    record.broken = true

    expect(await probeLocalPort(tunnel.localPort, 'select 1')).toEqual({ received: '', settled: 'closed' })
    expect(client.channelRequests).toEqual([])
    expect(listTunnels(engine)).toHaveLength(0)
  })

  it('operator: a tunnel retires by itself when its SSH link closes', async () => {
    // Given a forwarding tunnel, When the SSH transport closes, Then the
    // tunnel leaves the registry, releases the pinned connection, and stops
    // accepting local connections.
    const client = new FakeClient('healthy')
    const { engine } = tunnelEngine(client)
    const tunnel = await startTunnel(engine, ALIAS, { remotePort: 5432 })
    expect(listTunnels(engine)).toHaveLength(1)

    client.emit('close')

    expect(listTunnels(engine)).toHaveLength(0)
    expect(engine.pool.has(ALIAS)).toBe(false)
    expect(await probeLocalPort(tunnel.localPort)).toEqual({ received: '', settled: 'refused' })
  })

  it('operator: sibling tunnels sharing one connection all retire when that link closes', async () => {
    // Given two tunnels multiplexing over one pooled connection, When the
    // link closes, Then both tunnels retire and the connection is released
    // exactly once, by the last tunnel standing.
    const client = new FakeClient('healthy')
    const { engine } = tunnelEngine(client)
    await startTunnel(engine, ALIAS, { remotePort: 5432 })
    await startTunnel(engine, ALIAS, { remotePort: 3306 })
    expect(listTunnels(engine)).toHaveLength(2)

    client.emit('close')

    expect(listTunnels(engine)).toHaveLength(0)
    expect(client.ended).toBe(1)
  })

  it('operator: a healthy tunnel keeps forwarding and a manual stop leaves no link hook behind', async () => {
    // Given a live link, When the operator forwards through the tunnel and then
    // stops it, Then the payload reaches the remote side, the pinned connection
    // is released, and the retired tunnel no longer watches the shared link.
    const client = new FakeClient('healthy')
    const { engine } = tunnelEngine(client)
    const tunnel = await startTunnel(engine, ALIAS, { remotePort: 5432 })

    const socket = connect(tunnel.localPort, '127.0.0.1')
    socket.on('error', () => { /* the channel sink never fails */ })
    socket.on('connect', () => { socket.write('select 1') })
    expect(await client.nextForwarded()).toBe('select 1')
    socket.destroy()

    expect(stopTunnel(engine, tunnel.id)).toBe(true)
    expect(listTunnels(engine)).toHaveLength(0)
    expect(engine.pool.has(ALIAS)).toBe(false)
    // The pooled client outlives its tunnels, so a stopped tunnel must not
    // keep a listener on it.
    expect(client.listenerCount('close')).toBe(0)
  })
})
