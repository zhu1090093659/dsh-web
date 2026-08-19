import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { makeScreenshotRoutes, readBoundedJson, type WebRoute } from '../src/routes.ts'
import type { CaptureService, ScreenshotResult } from '../src/screenshot/service.ts'

/** A minimal fake incoming request for the route handlers. */
function fakeRequest(body?: unknown, method = 'POST', remoteAddress = '127.0.0.1'): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  let index = 0
  const req = {
    method,
    url: '/page-annotate/screenshot',
    headers: { host: '127.0.0.1:51128', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:51128' },
    socket: { remoteAddress },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (index >= chunks.length) return Promise.resolve({ done: true, value: undefined as never })
          return Promise.resolve({ done: false, value: chunks[index++] as never })
        },
      }
    },
  }
  return req as unknown as IncomingMessage
}

/** A minimal fake response capturing status/body. */
function fakeResponse(): { res: ServerResponse; status: number; body: string } {
  const state = { status: 0, body: '' }
  const res = {
    writeHead(status: number) {
      state.status = status
      return res
    },
    end(body?: string) {
      state.body = typeof body === 'string' ? body : ''
      return res
    },
  }
  return {
    res: res as unknown as ServerResponse,
    get status() {
      return state.status
    },
    get body() {
      return state.body
    },
  }
}

function stubService(result: ScreenshotResult): CaptureService & { calls: number } {
  let calls = 0
  return {
    calls,
    capture: async () => {
      calls += 1
      return result
    },
    health: async () => ({ engines: ['playwright'], chromiumPath: '/x/chrome' }),
  }
}

describe('screenshot route', () => {
  it('rejects non-loopback requests', async () => {
    const service = stubService({ data: Buffer.from(''), mimeType: 'image/png', width: 1, height: 1, engine: 'playwright' })
    const [health, screenshot] = makeScreenshotRoutes(service)
    const capture = fakeResponse()
    await screenshot.handler(fakeRequest({ url: 'https://example.com' }, 'POST', '192.168.1.5'), capture.res)
    expect(capture.status).toBe(403)
  })

  it('captures a validated URL and returns base64', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const service = stubService({ data: png, mimeType: 'image/png', width: 1280, height: 800, engine: 'playwright' })
    const [, screenshot] = makeScreenshotRoutes(service)
    const capture = fakeResponse()
    await screenshot.handler(fakeRequest({ url: 'example.com', viewport: { width: 1000, height: 700 } }), capture.res)
    expect(capture.status).toBe(200)
    const envelope = JSON.parse(capture.body) as { ok: boolean; value: { data: string; width: number; height: number; engine: string } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.data).toBe(png.toString('base64'))
    expect(envelope.value.engine).toBe('playwright')
  })

  it('rejects bad URLs with a coded error', async () => {
    const service = stubService({ data: Buffer.from(''), mimeType: 'image/png', width: 1, height: 1, engine: 'playwright' })
    const [, screenshot] = makeScreenshotRoutes(service)
    const capture = fakeResponse()
    await screenshot.handler(fakeRequest({ url: 'file:///etc/passwd' }), capture.res)
    expect(capture.status).toBe(400)
    const envelope = JSON.parse(capture.body) as { ok: boolean; error: { code: string } }
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('unsupported-scheme')
  })

  it('maps capture failures to coded 500s', async () => {
    const service: CaptureService = {
      capture: async () => {
        throw { code: 'no-engine', message: 'no engine' }
      },
      health: async () => ({ engines: [], chromiumPath: undefined }),
    }
    const [, screenshot] = makeScreenshotRoutes(service)
    const capture = fakeResponse()
    await screenshot.handler(fakeRequest({ url: 'https://example.com' }), capture.res)
    expect(capture.status).toBe(500)
    const envelope = JSON.parse(capture.body) as { ok: boolean; error: { code: string } }
    expect(envelope.error.code).toBe('no-engine')
  })

  it('health reports the available engines', async () => {
    const service = stubService({ data: Buffer.from(''), mimeType: 'image/png', width: 1, height: 1, engine: 'playwright' })
    const [health] = makeScreenshotRoutes(service)
    const capture = fakeResponse()
    await health.handler(fakeRequest(undefined, 'GET'), capture.res)
    expect(capture.status).toBe(200)
    expect(JSON.parse(capture.body)).toEqual({ ok: true, value: { engines: ['playwright'], chromiumPath: '/x/chrome' } })
  })
})

describe('readBoundedJson', () => {
  it('parses a JSON body and rejects oversize input', async () => {
    const ok = await readBoundedJson(fakeRequest({ url: 'https://example.com' }))
    expect(ok).toEqual({ url: 'https://example.com' })
    const big = await readBoundedJson(fakeRequest({ pad: 'x'.repeat(1024 * 1024) }), 1024).catch((error: Error) => error.message)
    expect(big).toBe('body-too-large')
  })
})
