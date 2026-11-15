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
 * The bridge transport produced the same reading by a different route (issue
 * #2052): it carries the origin's bytes across a socket, so an already-gzipped
 * body arrives here with its `content-encoding` intact, and the edge
 * compressed it a second time all the same. Declaring the encoding once is
 * therefore not enough on this hop -- what the phone decodes by is not reliably
 * what this hop says.
 *
 * So this hop guarantees one thing about every response it hands on, and both
 * transports leave through it: the bytes it delivers are not compressed.
 *
 * - a body that starts with the gzip magic is decompressed HERE, one layer at a
 *   time, and handed on as identity bytes with `cache-control: no-transform`.
 *   Whatever compresses it downstream then produces one decodable layer instead
 *   of two opaque ones.
 * - a plain body is returned byte-identical with every header intact.
 * - a coding this hop cannot decode (br, zstd, deflate) passes through
 *   untouched: rewriting bytes nobody here can read is how a relay turns a
 *   working instance into a broken one. What keeps those out of the path is the
 *   connector asking its own upstream for `identity`, so a bridged body is
 *   never compressed in the first place (see `bridgeUpstreamHeaders` in
 *   `packages/dsh-remote-web-ui` and `packages/dsh-remote-bridge`).
 */

/** Gzip's two magic bytes, in order, as the first two bytes of a gzip member. */
const GZIP_MAGIC = [0x1f, 0x8b]

/** Header a normalized response drops: its value counts the compressed bytes. */
const LENGTH_HEADER = 'content-length'

/** Header that declares the transfer coding of the body it travels with. */
const ENCODING_HEADER = 'content-encoding'

/** The declared codings that state no coding at all, so the bytes get sniffed. */
const NO_CODING = new Set(['', 'identity'])

/** The one coding this hop decodes. */
const GZIP_CODING = 'gzip'

/**
 * How many gzip layers one answer is peeled through. One is the origin's own
 * layer; two is the double-compressed shape issue #2052 measured. A body only
 * gets deeper by being wrong, so a third layer is handed on rather than looped
 * over.
 */
const MAX_GZIP_LAYERS = 2

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
 * Open one gzip layer: the bytes under it, beginning at their first chunk.
 * @param reader - the reader positioned right after `first`.
 * @param first - the raw first chunk of the encoded layer.
 * @returns a reader for the decoded bytes and its first chunk.
 */
async function decodeGzipLayer(reader, first) {
  const decoded = replayStream(reader, first).pipeThrough(new DecompressionStream(GZIP_CODING)).getReader()
  return { reader: decoded, first: await decoded.read() }
}

/**
 * The headers of a response this hop states as identity bytes: the declaration
 * and the length that counted the compressed bytes are gone, and `no-transform`
 * states the intent to every cache and intermediary the response crosses --
 * the bytes are already what the client should receive.
 * @param source - the origin's response, whose headers are copied.
 * @returns the rewritten header set.
 */
function identityHeaders(source) {
  const headers = new Headers(source.headers)
  headers.delete(ENCODING_HEADER)
  headers.delete(LENGTH_HEADER)
  headers.set('cache-control', 'no-transform')
  return headers
}

/**
 * Normalize one proxied response so the phone decodes exactly what it was
 * promised: identity bytes, compressed at most once on the way out.
 * @param response - the origin's response as this hop received it.
 * @returns a response whose declared encoding matches its bytes.
 */
export async function normalizeWireEncoding(response) {
  // A 101 upgrade, a 204/304 and a HEAD answer carry no body to judge, and a
  // rebuilt status text is the one thing a socket-backed 101 cannot survive.
  if (response.body === null) return response
  const declared = (response.headers.get(ENCODING_HEADER) ?? '').trim().toLowerCase()
  // A coding this hop cannot decode, and a list of them, travel as they arrived.
  if (!NO_CODING.has(declared) && declared !== GZIP_CODING) return response

  let reader = response.body.getReader()
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

  let bytes = first.value
  let layers = 0
  while (layers < MAX_GZIP_LAYERS && startsWithGzip(bytes)) {
    let opened
    try {
      opened = await decodeGzipLayer(reader, bytes)
    } catch (error) {
      // The declaration said gzip and the bytes were not: there is no honest
      // layer count to state, so the answer says the hop could not read it
      // instead of handing the phone a body it cannot decode either.
      console.warn(JSON.stringify({ relay: 'encoding-decode-failed', message: error instanceof Error ? error.message : String(error) }))
      return new Response('relay: the instance answered a body this hop could not decode', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    layers += 1
    reader = opened.reader
    if (opened.first.done) {
      return new Response(null, { status: response.status, statusText: response.statusText, headers: identityHeaders(response) })
    }
    bytes = opened.first.value
  }

  // Nothing was compressed. Every header travels exactly as the origin sent it.
  if (layers === 0) {
    return new Response(replayStream(reader, bytes), { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  // Deeper than this hop peels. The origin's own declaration still describes
  // one decodable layer, so it stays in force rather than being dropped here.
  if (startsWithGzip(bytes)) {
    console.warn(JSON.stringify({ relay: 'encoding-layers', layers: MAX_GZIP_LAYERS }))
    return new Response(replayStream(reader, bytes), { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  return new Response(replayStream(reader, bytes), { status: response.status, statusText: response.statusText, headers: identityHeaders(response) })
}
