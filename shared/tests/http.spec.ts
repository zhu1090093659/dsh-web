import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { asJsonObject, readBoundedJson, readJsonBody, writeJson } from '../host/http.ts'

/**
 * Async-readable IncomingMessage stand-in built from byte chunks; counts
 * destroy calls. A hand-rolled async iterator keeps destroy counting exact:
 * abandoning the loop must not trigger extra destroy activity.
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
  } as unknown as IncomingMessage
  return { request, destroyCalls: () => destroyCalls }
}

function bytes(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

/** ServerResponse stand-in recording status, headers and the payload. */
function fakeResponse(): { response: ServerResponse; status: () => number; headers: () => Record<string, unknown>; body: () => string } {
  const state = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const response = {
    writeHead(status: number, headers: Record<string, unknown>) {
      state.status = status
      Object.assign(state.headers, headers)
    },
    end(payload?: string) {
      state.body = payload ?? ''
    },
  } as unknown as ServerResponse
  return {
    response,
    status: () => state.status,
    headers: () => state.headers,
    body: () => state.body,
  }
}

describe('readBoundedJson', () => {
  it('parses a JSON body', async () => {
    const { request } = fakeRequest([bytes('{"a":1}')])
    await expect(readBoundedJson(request, 1024)).resolves.toEqual({ a: 1 })
  })

  it('throws past the byte cap', async () => {
    const { request } = fakeRequest([bytes('{"a":1}')])
    await expect(readBoundedJson(request, 4)).rejects.toThrow('body too large')
  })

  it('throws on invalid JSON', async () => {
    const { request } = fakeRequest([bytes('not json')])
    await expect(readBoundedJson(request, 1024)).rejects.toThrow()
  })

  it('throws on an empty body', async () => {
    const { request } = fakeRequest([])
    await expect(readBoundedJson(request, 1024)).rejects.toThrow()
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const { request } = fakeRequest([bytes('{"a":1}')])
    await expect(readJsonBody(request)).resolves.toEqual({ a: 1 })
  })

  it('returns null for an empty body without destroying the request', async () => {
    const { request, destroyCalls } = fakeRequest([])
    await expect(readJsonBody(request)).resolves.toBeNull()
    expect(destroyCalls()).toBe(0)
  })

  it('returns null for invalid JSON without destroying the request', async () => {
    const { request, destroyCalls } = fakeRequest([bytes('not json')])
    await expect(readJsonBody(request)).resolves.toBeNull()
    expect(destroyCalls()).toBe(0)
  })

  it('defaults to a 64 KiB cap', async () => {
    const atCap = fakeRequest([bytes('{"a":"' + 'x'.repeat(64 * 1024 - 8) + '"}')])
    await expect(readJsonBody(atCap.request)).resolves.not.toBeNull()
    const over = fakeRequest([bytes('{"a":"' + 'x'.repeat(64 * 1024 - 6) + '"}')])
    await expect(readJsonBody(over.request)).resolves.toBeNull()
    expect(over.destroyCalls()).toBe(1)
  })

  it('returns null and destroys the request when the body exceeds a custom cap', async () => {
    const { request, destroyCalls } = fakeRequest([bytes('{"a":1}')])
    await expect(readJsonBody(request, { maxBytes: 4 })).resolves.toBeNull()
    expect(destroyCalls()).toBe(1)
  })

  it('returns null for a non-object payload in objectOnly mode', async () => {
    for (const payload of ['[1,2]', '"text"', '42', 'null', 'true']) {
      const { request, destroyCalls } = fakeRequest([bytes(payload)])
      await expect(readJsonBody(request, { objectOnly: true })).resolves.toBeNull()
      expect(destroyCalls()).toBe(0)
    }
  })

  it('accepts an object payload in objectOnly mode', async () => {
    const { request } = fakeRequest([bytes('{"a":1}')])
    await expect(readJsonBody(request, { objectOnly: true })).resolves.toEqual({ a: 1 })
  })

  it('accepts non-object payloads without objectOnly', async () => {
    const { request } = fakeRequest([bytes('[1,2]')])
    await expect(readJsonBody(request)).resolves.toEqual([1, 2])
  })
})

describe('asJsonObject', () => {
  it('narrows plain objects', () => {
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 })
  })

  it('returns undefined for arrays, primitives and null', () => {
    expect(asJsonObject([1, 2])).toBeUndefined()
    expect(asJsonObject('text')).toBeUndefined()
    expect(asJsonObject(42)).toBeUndefined()
    expect(asJsonObject(true)).toBeUndefined()
    expect(asJsonObject(null)).toBeUndefined()
    expect(asJsonObject(undefined)).toBeUndefined()
  })
})

describe('writeJson', () => {
  it('writes the family-default headers with the status and JSON body', () => {
    const { response, status, headers, body } = fakeResponse()
    writeJson(response, 200, { ok: true })
    expect(status()).toBe(200)
    expect(headers()).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'referrer-policy': 'no-referrer',
    })
    expect(body()).toBe('{"ok":true}')
  })

  it('lets caller headers append to and override the defaults', () => {
    const { response, headers } = fakeResponse()
    writeJson(response, 201, { ok: true }, { 'x-trace-id': 't1', 'content-type': 'application/problem+json' })
    expect(headers()).toMatchObject({
      'referrer-policy': 'no-referrer',
      'x-trace-id': 't1',
      'content-type': 'application/problem+json',
    })
  })
})
