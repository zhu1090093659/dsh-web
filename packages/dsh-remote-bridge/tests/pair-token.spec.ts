import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { isLoopbackAddress, isLoopbackHost, loopbackDenialOf } from '../src/core/loopback.ts'
import { PairingService } from '../src/core/pairing.ts'
import { makePairTokenHandler, makePairTokenRoute } from '../src/host/routes.ts'

/** A response that records what the handler wrote. */
class RecordingResponse {
  status = 0
  headers: Record<string, unknown> = {}
  body = ''

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(text?: string): void {
    this.body = text ?? ''
  }

  asServerResponse(): ServerResponse {
    return this as unknown as ServerResponse
  }
}

/** A request whose socket address and Host header the test chooses. */
function fakeRequest(options: { remoteAddress?: string; host?: string; method?: string }): IncomingMessage {
  return {
    socket: { remoteAddress: options.remoteAddress },
    headers: options.host === undefined ? {} : { host: options.host },
    method: options.method ?? 'GET',
  } as unknown as IncomingMessage
}

/**
 * Call the handler once and report what it wrote.
 *
 * The origin seam defaults to "this machine knows nothing", so the assertions
 * never depend on the environment or the live face of the machine running the suite.
 */
function callHandler(
  request: IncomingMessage,
  pairOrigin: () => { origin: string; source: 'realtime' | 'env' | 'lan' } | undefined = () => undefined,
): RecordingResponse {
  const response = new RecordingResponse()
  makePairTokenHandler({ pairing: new PairingService(), log: () => undefined, pairOrigin })(
    request,
    response.asServerResponse(),
  )
  return response
}

describe('bootstrap token endpoint', () => {
  it('operator opens the pairing link on the host itself and receives a fresh token', () => {
    // Given a request from this machine naming this machine
    const response = callHandler(fakeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3000' }))
    // When the handler answers
    const body = JSON.parse(response.body) as { token: string; expiresAt: number; url: string }
    // Then the token, its expiry and a directly usable WebSocket link cross
    expect(response.status).toBe(200)
    expect(body.token.length).toBeGreaterThan(20)
    expect(body.expiresAt).toBeGreaterThan(0)
    expect(body.url).toBe(`ws://127.0.0.1:3000/ios/v1?token=${body.token}`)
  })

  it('operator on a host that knows its public origin is handed the one-scan code', () => {
    // Given a loopback request and a host that located its live public face
    const response = callHandler(
      fakeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3000' }),
      () => ({ origin: 'wss://abc123.dsh-market.com', source: 'realtime' }),
    )
    // When the handler answers
    const body = JSON.parse(response.body) as {
      token: string
      url: string
      origin: string
      originSource: string
      pairingUrl: string
    }
    // Then the phone-facing code names that origin and carries the same token,
    // while the machine-local link keeps its loopback Host
    expect(response.status).toBe(200)
    expect(body.origin).toBe('wss://abc123.dsh-market.com')
    expect(body.originSource).toBe('realtime')
    expect(body.pairingUrl).toBe(`wss://abc123.dsh-market.com/ios/v1?token=${body.token}`)
    expect(body.url).toBe(`ws://127.0.0.1:3000/ios/v1?token=${body.token}`)
  })

  it('operator on a host that cannot name its public origin gets no phone-facing code', () => {
    // Given a loopback request and no discoverable origin
    const response = callHandler(fakeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3000' }))
    // When the handler answers
    const body = JSON.parse(response.body) as { token: string; origin?: string; pairingUrl?: string }
    // Then the fields are absent rather than wrong, so the panel falls back to the bare token
    expect(response.status).toBe(200)
    expect(body.origin).toBeUndefined()
    expect(body.pairingUrl).toBeUndefined()
    expect(body.token.length).toBeGreaterThan(20)
  })

  it('operator reaches the pairing link through a public tunnel and is refused', () => {
    // Given a request the tunnel client delivers over loopback but whose Host is the public relay
    const response = callHandler(fakeRequest({ remoteAddress: '127.0.0.1', host: 'abc123.dsh-market.com' }))
    // When the handler answers
    const body = JSON.parse(response.body) as { reason: string }
    // Then no token is minted: the socket address alone is not a loopback proof
    expect(response.status).toBe(403)
    expect(body.reason).toBe('the request names a Host that is not this machine')
    expect(response.body.includes('token')).toBe(false)
  })

  it('operator reaches the pairing link from another machine and is refused', () => {
    // Given a request from a peer on the local network that claims a loopback Host
    const response = callHandler(fakeRequest({ remoteAddress: '192.168.1.5', host: 'localhost:3000' }))
    // When the handler answers
    const body = JSON.parse(response.body) as { reason: string }
    // Then the socket address is what refuses it
    expect(response.status).toBe(403)
    expect(body.reason).toBe('the request did not arrive from this machine')
  })

  it('operator sends a body to the pairing link and is refused with the allowed method', () => {
    // Given a POST from this machine
    const response = callHandler(fakeRequest({ remoteAddress: '::1', host: '[::1]:3000', method: 'POST' }))
    // When the handler answers
    // Then the route reports that it only reads
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET')
  })

  it('operator registers the route at one exact path', () => {
    // Given the route the plugin installs
    const route = makePairTokenRoute({ pairing: new PairingService(), log: () => undefined })
    // When its path and kind are read
    // Then it is an exact path with no trailing slash, as the host server requires
    expect(route.kind).toBe('exact')
    expect(route.path).toBe('/remote-bridge/pair/token')
  })

  it('operator checks the loopback rules against the literals a proxy may send', () => {
    // Given the address and host literals a proxy may present
    const addresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.4', undefined]
    const hosts = ['127.0.0.1', '127.0.0.1:3000', 'localhost:8080', '[::1]:443', 'example.com', 'localhost.evil.com', undefined]
    // When both rules are applied
    const addressVerdicts = addresses.map(value => isLoopbackAddress(value))
    const hostVerdicts = hosts.map(value => isLoopbackHost(value))
    // Then only the loopback literals pass, and a lookalike hostname does not
    expect(addressVerdicts).toEqual([true, true, true, false, false])
    expect(hostVerdicts).toEqual([true, true, true, true, false, false, false])
  })

  it('operator checks what one refusal says about a request with no Host header', () => {
    // Given a loopback request that carries no Host header at all
    const request = fakeRequest({ remoteAddress: '127.0.0.1' })
    // When the gate inspects it
    const denial = loopbackDenialOf(request)
    // Then an unnameable host is refused rather than assumed local
    expect(denial).toBe('the request names a Host that is not this machine')
  })
})

/** A loopback request naming this machine, the only shape the route admits. */
function loopbackRequest(): IncomingMessage {
  return {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3000' },
    method: 'GET',
  } as unknown as IncomingMessage
}

describe('the token response carries the address the route now reads', () => {
  it('operator: the live public face reaches the QR payload', () => {
    // Given a bridge that knows its own live public face
    let asked = 0
    const response = new RecordingResponse()
    makePairTokenHandler({
      pairing: new PairingService(),
      log: () => undefined,
      realtime: () => {
        asked += 1
        return 'https://edge.example.com'
      },
      lan: () => ({ address: '192.168.1.5', port: 3080 }),
    })(loopbackRequest(), response.asServerResponse())
    // When the loopback request is answered
    // Then the seam was consulted once, and the payload names that origin
    const body = JSON.parse(response.body) as { token: string; origin?: string; originSource?: string; pairingUrl?: string }
    expect(asked).toBe(1)
    expect(body.origin).toBe('https://edge.example.com')
    expect(body.originSource).toBe('realtime')
    // And the one-scan link is built on it
    expect(body.pairingUrl).toBe('https://edge.example.com/ios/v1?token=' + body.token)
  })

  it('operator: the payload stays coherent whatever source answered', () => {
    // Given a host with no live face, so the later sources decide
    const response = new RecordingResponse()
    makePairTokenHandler({
      pairing: new PairingService(),
      log: () => undefined,
      realtime: () => undefined,
      lan: () => ({ address: '192.168.1.5', port: 3080 }),
    })(loopbackRequest(), response.asServerResponse())
    // When the loopback request is answered
    // Then the link a phone dials is built on the origin the same answer named,
    // and the keys the panel reads are unchanged
    const body = JSON.parse(response.body) as { token: string; url: string; origin: string; originSource: string; pairingUrl: string }
    expect(body.pairingUrl.startsWith(body.origin)).toBe(true)
    expect(body.pairingUrl.endsWith('/ios/v1?token=' + body.token)).toBe(true)
    expect(body.url).toBe('ws://127.0.0.1:3000/ios/v1?token=' + body.token)
    expect(['realtime', 'env', 'lan']).toContain(body.originSource)
  })
})
