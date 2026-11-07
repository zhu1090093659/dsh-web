/**
 * Wire-encoding normalization for the relay hop.
 *
 * The tunneled DSH host compresses some responses whatever the request asked
 * for, and does not always say so: a request this Worker forwards can come back
 * as gzip BYTES under no `content-encoding` at all (measured on the login
 * refusal and the shell HTML). The Worker hands that response to the edge, the
 * edge sees ordinary compressible content with nothing declared, applies its
 * own gzip, and the phone then decodes exactly one of the two layers -- the
 * page arrives as mojibake (issue #2030).
 *
 * This hop therefore states what the bytes actually are, in one place both
 * transports share:
 *
 * - a body with no `content-encoding` (or `identity`, which declares nothing) is
 *   sniffed for the gzip magic. A plain body is returned byte-identical with
 *   every header intact.
 * - an undeclared gzip body is decompressed HERE and handed on as identity
 *   bytes with `cache-control: no-transform`, so anything downstream that
 *   compresses again produces one decodable layer instead of two opaque ones.
 * - a declared `content-encoding` passes through untouched: the origin already
 *   said what its bytes are, and re-encoding them would only move the same
 *   problem one hop later.
 *
 * Nothing else is interpreted: br/zstd/zstd bodies that arrive undeclared keep
 * today's behaviour, because guessing an undeclared codec is how a relay turns
 * a working instance into a broken one.
 */

/** Gzip's two magic bytes, in order, as the first two bytes of a gzip member. */
const GZIP_MAGIC = [0x1f, 0x8b]

/** Header a normalized response drops: its value counts the compressed bytes. */
const LENGTH_HEADER = 'content-length'

/** Header that declares the transfer coding of the body it travels with. */
const ENCODING_HEADER = 'content-encoding'

/**
 * Whether the first chunk starts a gzip member.
 * @param chunk - the body's first chunk.
 * @returns true when the bytes carry the gzip magic.
 */
function startsWithGzip(chunk) {
  if (chunk === undefined || chunk.byteLength < GZIP_MAGIC.length) return false
  const head = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  return head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]
}

/**
 * A body that replays an already-read first chunk and then drains the rest of
 * the origin's reader, keeping cancellation attached to the source.
 * @param reader - the reader the first chunk was taken from.
 * @param first - the chunk already read.
 * @returns the replayed stream.
 */
function replayStream(reader, first) {
  let drained = false
  return new ReadableStream({
    async pull(controller) {
      if (!drained) {
        drained = true
        controller.enqueue(first)
        return
      }
      const next = await reader.read()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Normalize one proxied response so the phone decodes at least what it was
 * promised. Only the undeclared-gzip case changes bytes; every other response
 * leaves this function exactly as it entered, headers and all.
 * @param response - the origin's response as this hop received it.
 * @returns a response whose declared encoding matches its bytes.
 */
export async function normalizeWireEncoding(response) {
  // A 101 upgrade, a 204/304 and a HEAD answer carry no body to judge, and a
  // rebuilt status text is the one thing a socket-backed 101 cannot survive.
  if (response.body === null) return response
  const declared = response.headers.get(ENCODING_HEADER)
  if (declared !== null && declared.trim().toLowerCase() !== 'identity') return response

  const reader = response.body.getReader()
  let first
  try {
    first = await reader.read()
  } catch (error) {
    await reader.cancel().catch(() => {})
    console.warn(JSON.stringify({ relay: 'encoding-read-failed', message: error instanceof Error ? error.message : String(error) }))
    return new Response('relay: the instance stream failed before its first byte', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (first.done) return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
  if (!startsWithGzip(first.value)) {
    return new Response(replayStream(reader, first.value), { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  const headers = new Headers(response.headers)
  headers.delete(ENCODING_HEADER)
  headers.delete(LENGTH_HEADER)
  // `no-transform` states the intent to every cache and intermediary this
  // response crosses: the bytes are already what the client should receive.
  headers.set('cache-control', 'no-transform')
  const body = replayStream(reader, first.value).pipeThrough(new DecompressionStream('gzip'))
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}
