/**
 * Route-level input fencing: install specs and remove ids carrying shell
 * metacharacters are rejected with 400 before any CLI job exists (the
 * acceptance criterion for the cmd.exe injection class: a metachar spec must
 * error, never report success).
 */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

function loopbackPost(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
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

const facts = { profileName: 'web', profileDir: '', patchPath: '', packageJsonPath: '' } as ProfileFacts

function route(path: string) {
  const idleSpawn = () => ({
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    kill: () => {},
    on: (event: string, handler: (code?: number | null) => void) => { if (event === 'close') setTimeout(() => handler(0), 0) },
  })
  const gateway = new CliGateway(facts, {} as NodeJS.ProcessEnv, { findBinary: () => '/fake/dsh', spawnImpl: idleSpawn as never })
  return makeGatewayRoutes({ facts, gateway, cliAvailable: () => true }).find(r => r.path === path)!.handler
}

describe('install route spec fencing', () => {
  it('rejects a metachar spec with 400 and spawns nothing', async () => {
    const { res, body, status } = captureResponse()
    await route('/api/plugin-manager/install')(loopbackPost({ spec: 'dsh-nonexistent-pkg-zzz9 & echo marker' }), res)
    expect(status()).toBe(400)
    expect(JSON.parse(body()).error).toContain('shell')
  })

  it('accepts an ordinary registry spec (job created)', async () => {
    const { res, status } = captureResponse()
    await route('/api/plugin-manager/install')(loopbackPost({ spec: 'dsh-pet' }), res)
    expect(status()).toBe(200)
  })
})

describe('remove route id fencing', () => {
  it('rejects a metachar id with 400', async () => {
    const { res, status } = captureResponse()
    await route('/api/plugin-manager/remove')(loopbackPost({ id: 'dsh-pet & echo marker' }), res)
    expect(status()).toBe(400)
  })
})

describe('set-enabled route id fencing', () => {
  it('rejects a metachar id with 400', async () => {
    const { res, status } = captureResponse()
    await route('/api/plugin-manager/set-enabled')(loopbackPost({ id: 'memoir & echo marker', enabled: false }), res)
    expect(status()).toBe(400)
  })
})
