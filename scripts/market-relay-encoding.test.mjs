import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import { normalizeWireEncoding } from '../market/worker/src/relay-encoding.js'

/** One gzip member of the given text, as the bytes a tunneled host sends. */
function gzipped(text) {
  return gzipSync(Buffer.from(text, 'utf8'))
}

/** A body assembled from several chunks, so the first-chunk peek is exercised. */
function chunked(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

test('relay encoding leaves a plain body byte-identical with its headers', async () => {
  // Given an origin answer that declares no encoding and sends plain bytes
  const response = new Response('plain-html-body', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '15' },
  })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then the bytes and every header are exactly what the origin sent
  assert.equal(await normalized.text(), 'plain-html-body')
  assert.equal(normalized.status, 200)
  assert.equal(normalized.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(normalized.headers.get('content-length'), '15')
  assert.equal(normalized.headers.get('content-encoding'), null)
  assert.equal(normalized.headers.get('cache-control'), null)
})

test('relay encoding replays a streamed body in order', async () => {
  // Given a plain body the origin sent in three chunks
  const encoder = new TextEncoder()
  const response = new Response(chunked(encoder.encode('first-'), encoder.encode('second-'), encoder.encode('third')), { status: 200 })

  // When the hop peeks the first chunk and re-streams the rest
  const normalized = await normalizeWireEncoding(response)

  // Then no chunk is lost, doubled or reordered
  assert.equal(await normalized.text(), 'first-second-third')
})

test('relay encoding peels one declared gzip layer and states identity bytes', async () => {
  // Given an origin that declared gzip and a body that really is one gzip member
  const body = gzipped('declared-body')
  const response = new Response(body, {
    status: 200,
    headers: { 'content-encoding': 'gzip', 'content-length': String(body.byteLength), 'content-type': 'text/html; charset=utf-8' },
  })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then the phone receives plain bytes with the length that counted the
  // compressed ones gone: what the phone decodes by is not reliably what this
  // hop declares, so the hop hands on bytes that need no decoding at all
  assert.equal(await normalized.text(), 'declared-body')
  assert.equal(normalized.headers.get('content-encoding'), null)
  assert.equal(normalized.headers.get('content-length'), null)
  assert.equal(normalized.headers.get('cache-control'), 'no-transform')
  assert.equal(normalized.headers.get('content-type'), 'text/html; charset=utf-8')
})

test('relay encoding peels both layers of a body the origin compressed twice', async () => {
  // Given the exact shape issue #2052 measured: gzip(gzip(html)) under a single
  // content-encoding declaration
  const html = '<!doctype html><html><body><script type="module" src="/assets/index-Ciz7DZxv.js"></script></body></html>'
  const response = new Response(gzipSync(gzipped(html)), {
    status: 200,
    headers: { 'content-encoding': 'gzip', 'content-type': 'text/html; charset=utf-8' },
  })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then stopping after one layer would have handed the phone a body it still
  // cannot read, so the hop keeps going until the bytes are the document
  assert.equal(await normalized.text(), html)
  assert.equal(normalized.headers.get('content-encoding'), null)
  assert.equal(normalized.headers.get('cache-control'), 'no-transform')
})

test('relay encoding peels a gzip member the origin split across chunks', async () => {
  // Given one gzip member delivered in two chunks
  const member = gzipped('split-member-body')
  const response = new Response(chunked(member.subarray(0, 7), member.subarray(7)), {
    status: 200,
    headers: { 'content-encoding': 'gzip' },
  })

  // When the hop peels it
  const normalized = await normalizeWireEncoding(response)

  // Then the decoded bytes are complete, even though the header of the member
  // and its payload arrived in different chunks
  assert.equal(await normalized.text(), 'split-member-body')
  assert.equal(normalized.headers.get('content-encoding'), null)
})

test('relay encoding leaves a coding it cannot decode untouched', async () => {
  // Given an origin that declared brotli, which this hop has no decoder for
  const response = new Response('brotli-bytes-nobody-here-reads', {
    status: 200,
    headers: { 'content-encoding': 'br', 'content-length': '31', 'content-type': 'text/javascript' },
  })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then every byte and every header travels exactly as the origin sent them
  assert.equal(await normalized.text(), 'brotli-bytes-nobody-here-reads')
  assert.equal(normalized.headers.get('content-encoding'), 'br')
  assert.equal(normalized.headers.get('content-length'), '31')
  assert.equal(normalized.headers.get('cache-control'), null)
})

test('relay encoding decompresses a gzip body the origin never declared', async () => {
  // Given the exact shape issue #2030 measured: gzip bytes under no
  // content-encoding at all, which the edge would compress a second time
  const response = new Response(gzipped('dsh web authentication required'), {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(gzipped('dsh web authentication required').byteLength) },
  })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then the phone receives plain text, the stale length and the encoding
  // declaration are gone, and the response is marked as not to be transformed
  assert.equal(normalized.status, 401)
  assert.equal(await normalized.text(), 'dsh web authentication required')
  assert.equal(normalized.headers.get('content-encoding'), null)
  assert.equal(normalized.headers.get('content-length'), null)
  assert.equal(normalized.headers.get('cache-control'), 'no-transform')
  assert.equal(normalized.headers.get('content-type'), 'text/plain; charset=utf-8')
})

test('relay encoding treats an explicit identity declaration as no declaration', async () => {
  // Given an origin that declared identity and still sent a gzip body
  const response = new Response(gzipped('identity-but-compressed'), { status: 200, headers: { 'content-encoding': 'identity' } })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then the body is read for what it actually is
  assert.equal(await normalized.text(), 'identity-but-compressed')
  assert.equal(normalized.headers.get('content-encoding'), null)
})

test('relay encoding leaves a bodyless answer alone', async () => {
  // Given the statuses that must not be rebuilt with a body: a 204 and a 304
  // the runtime can construct, and a 101 upgrade, which no Response can carry
  // and which is therefore stated as the shape the object really answers with
  const bodyless = [
    new Response(null, { status: 204 }),
    new Response(null, { status: 304 }),
    { body: null, headers: new Headers(), status: 101, statusText: 'Switching Protocols' },
  ]

  // When the hop normalizes each of them
  const normalized = await Promise.all(bodyless.map((response) => normalizeWireEncoding(response)))

  // Then each keeps its status, carries no body and gains no header
  normalized.forEach((response, i) => {
    assert.equal(response.status, bodyless[i].status)
    assert.equal(response.body, null)
    assert.equal(response.headers.get('cache-control'), null)
  })
})
