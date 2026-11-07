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

test('relay encoding leaves a declared encoding untouched', async () => {
  // Given the origin already said its bytes are gzip
  const body = gzipped('declared-body')
  const response = new Response(body, { status: 200, headers: { 'content-encoding': 'gzip' } })

  // When the hop normalizes it
  const normalized = await normalizeWireEncoding(response)

  // Then the declaration and the compressed bytes both travel unchanged: the
  // origin stated the encoding, so re-encoding here would only move the problem
  assert.equal(normalized.headers.get('content-encoding'), 'gzip')
  assert.deepEqual(new Uint8Array(await normalized.arrayBuffer()), new Uint8Array(body))
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
