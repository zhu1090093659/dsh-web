import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import type { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

function loopbackGet(): IncomingMessage {
  const stream = Readable.from([]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'GET'
  return stream
}

function captureResponse(): { res: ServerResponse; body: () => string; status: () => number } {
  let status = 200
  let text = ''
  const res = {
    writeHead(code: number) { status = code },
    end(chunk: string) { text = chunk },
  } as unknown as ServerResponse
  return { res, body: () => text, status: () => status }
}

function modeHandler(official: () => Promise<boolean>, desktop = false) {
  const facts = { profileName: 'web', profileDir: '', patchPath: '', packageJsonPath: '', desktop } as ProfileFacts
  const gateway = {} as CliGateway
  const routes = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, officialChannels: official })
  return routes.find(route => route.path === '/api/plugin-manager/mode')!.handler
}

describe('/mode route', () => {
  it('reports the official-channel verdict', async () => {
    const { res, body, status } = captureResponse()
    await modeHandler(async () => true)(loopbackGet(), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ official: true })
  })

  it('reports the gateway verdict on the npm web runtime', async () => {
    const { res, body } = captureResponse()
    await modeHandler(async () => false)(loopbackGet(), res)
    expect(JSON.parse(body())).toEqual({ official: false })
  })

  it('defers to the browser capability probe on desktop runtimes', async () => {
    const { res, body } = captureResponse()
    await modeHandler(async () => false, true)(loopbackGet(), res)
    expect(JSON.parse(body())).toEqual({ official: null })
  })
})
