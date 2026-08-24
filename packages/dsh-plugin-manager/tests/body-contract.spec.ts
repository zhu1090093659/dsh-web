/**
 * Route-level JSON body failure contract: every body-reading gateway route
 * answers an empty, malformed, non-object, or oversized body with its
 * existing 400 validation response instead of the old 500 (the local readers
 * used to throw and the guard caught them), and an oversized body destroys
 * the request instead of draining it (shared readJsonBody no-drain contract).
 * Valid object bodies keep their unchanged paths.
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

/**
 * Async-readable loopback request stand-in built from byte chunks; counts
 * destroy calls exactly (the shared reader abandons the iterator on overflow).
 */
function fakeRequest(chunks: Buffer[] = []): { request: IncomingMessage; destroyCalls: () => number } {
  let destroyCalls = 0
  const request = {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
      }
    },
    destroy() {
      destroyCalls += 1
    },
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080' },
  } as unknown as IncomingMessage
  return { request, destroyCalls: () => destroyCalls }
}

function captureResponse(): { res: ServerResponse; body: () => string; status: () => number; headers: () => Record<string, string> } {
  let status = 200
  let text = ''
  let headers: Record<string, string> = {}
  const res = {
    writeHead(code: number, head: Record<string, string> = {}) { status = code; headers = { ...head } },
    end(chunk: string) { text = chunk },
  } as unknown as ServerResponse
  return { res, body: () => text, status: () => status, headers: () => headers }
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

const invalidPayloads: Array<[string, Buffer]> = [
  ['an empty body', Buffer.alloc(0)],
  ['an invalid JSON body', Buffer.from('not json')],
  ['a non-object body', Buffer.from('[1,2]')],
]

const cases: Array<[string, string]> = [
  ['/api/plugin-manager/install', 'plugin-manager: install needs a spec'],
  ['/api/plugin-manager/update', 'plugin-manager: update needs an id'],
  ['/api/plugin-manager/remove', 'plugin-manager: remove needs an id'],
  ['/api/plugin-manager/set-enabled', 'plugin-manager: set-enabled needs an id and a boolean enabled'],
]

describe('gateway body failure contract', () => {
  for (const [path, error] of cases) {
    for (const [label, payload] of invalidPayloads) {
      it(`answers ${label} on ${path} with 400 and the validation error`, async () => {
        const { request, destroyCalls } = fakeRequest([payload])
        const { res, body, status } = captureResponse()
        await route(path)(request, res)
        expect(status()).toBe(400)
        expect(JSON.parse(body()).error).toBe(error)
        expect(destroyCalls()).toBe(0)
      })
    }
    it(`answers an oversized body on ${path} with 400 and destroys the request`, async () => {
      const { request, destroyCalls } = fakeRequest([Buffer.from('{"spec":"' + 'x'.repeat(64 * 1024) + '"}')])
      const { res, status } = captureResponse()
      await route(path)(request, res)
      expect(status()).toBe(400)
      expect(destroyCalls()).toBe(1)
    })
  }

  it('keeps a valid object body on the install route (job created)', async () => {
    const { request } = fakeRequest([Buffer.from('{"spec":"dsh-pet"}')])
    const { res, status } = captureResponse()
    await route('/api/plugin-manager/install')(request, res)
    expect(status()).toBe(200)
  })

  it('writes a JSON loopback rejection envelope with family headers', async () => {
    const { request } = fakeRequest()
    Object.assign(request, { socket: { remoteAddress: '10.0.0.5' } })
    const { res, body, status, headers } = captureResponse()
    await route('/api/plugin-manager/install')(request, res)
    expect(status()).toBe(403)
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'forbidden: loopback-only' })
    expect(headers()['content-type']).toBe('application/json; charset=utf-8')
    expect(headers()['referrer-policy']).toBe('no-referrer')
  })

  it('writes family JSON headers through the shared writer', async () => {
    const { request } = fakeRequest([Buffer.from('{"spec":"dsh-pet"}')])
    const { res, status, headers } = captureResponse()
    await route('/api/plugin-manager/install')(request, res)
    expect(status()).toBe(200)
    expect(headers()['content-type']).toBe('application/json; charset=utf-8')
    expect(headers()['referrer-policy']).toBe('no-referrer')
  })
})
