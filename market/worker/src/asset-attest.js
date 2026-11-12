/**
 * Deployed-asset attestation for the deploy lane.
 *
 * The lane that deploys `market/dist` has to prove that the version it just
 * published serves every path its manifests advertise, with the committed byte
 * count. Measuring that over the public origin fails for part of every run: the
 * zone's own policy on a cloud IP range answers those requests with 403, which
 * says nothing about the asset — the same paths answer 200 with the committed
 * byte lengths from other networks, and the refusal survives every retry inside
 * the run (2026-09-23: the same 150 of 3075 paths, six runs).
 *
 * This route moves the measurement inside Cloudflare: the caller posts the paths
 * it wants measured and gets back what the deployed version's asset layer serves
 * for each one. The measurement is the part that stays inside, not the call: a
 * caller met by the zone's policy on its own vantage never reaches this route,
 * which is why the lane reports such a refusal as the edge's answer rather than
 * as a verdict about the assets (2026-09-24: the first attested run from a
 * runner was challenged, `cf-mitigated: challenge`). It is a read-only
 * measurement of already-public assets, gated on a shared secret because one
 * call makes up to ATTEST_MAX_PATHS internal asset fetches and an open route
 * would be an amplification vector. Nothing here is part of the client-facing
 * API surface, so the route stays out of the API catalog and the OpenAPI
 * description.
 *
 * Fail closed: without the configured secret the route answers 503 rather than
 * serving measurements to anyone.
 */
import { readJsonCapped } from './body.js'

/** Paths one request may ask about; bounds the internal fetches it causes. */
export const ATTEST_MAX_PATHS = 500
/** Internal fetches in flight inside one request. */
const ATTEST_CONCURRENCY = 6
/** Body cap: ATTEST_MAX_PATHS site-relative paths and the JSON around them. */
const ATTEST_BODY_MAX_BYTES = 64 * 1024
/** Only the site's own asset space is measurable through this route. */
const ATTEST_PATH_RE = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Length-checked byte comparison, so a wrong secret cannot be probed byte by byte. */
function secretMatches(configured, presented) {
  if (typeof configured !== 'string' || configured.length === 0) return false
  const expected = new TextEncoder().encode(configured)
  const actual = new TextEncoder().encode(presented)
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let index = 0; index < expected.length; index += 1) diff |= expected[index] ^ actual[index]
  return diff === 0
}

/** Whether a requested path is one this route may measure. */
export function attestablePath(path) {
  return typeof path === 'string' && ATTEST_PATH_RE.test(path) && !path.includes('..')
}

/** Release a response body so the connection is not held open. */
async function drain(response) {
  await response.arrayBuffer().catch(() => {})
}

/**
 * Count a streamed body without buffering it, for the response that carries no
 * length header at all.
 */
async function countBody(response) {
  if (response.body === null || typeof response.body[Symbol.asyncIterator] !== 'function') return null
  let total = 0
  try {
    for await (const chunk of response.body) total += chunk.byteLength
  } catch {
    return null
  }
  return total > 0 ? total : null
}

/**
 * What the deployed asset layer serves for one path: the total byte length, or
 * the status that refused it.
 *
 * The binding is the only reader here, because the deployed version's own asset
 * layer is what the answer is about: a public URL fetched from inside this
 * worker routes back into this worker, and what comes back is the site's own
 * response rather than the asset. When the response reports no length — the
 * binding answers the range probe with no `content-range` at all — the body is
 * counted as it streams, so the measurement costs the transfer the verification
 * run needs and never invents a number.
 */
async function measureAsset(env, base, path) {
  const url = new URL(path, base)
  // The range is an optimisation, not the mechanism: a platform that honours it
  // answers with the asset's full length for the price of one byte.
  let response
  try {
    response = await env.ASSETS.fetch(new Request(url, { headers: { Range: 'bytes=0-0' } }))
  } catch {
    return { path, error: 'request failed' }
  }
  if (!response.ok) {
    await drain(response)
    return { path, error: `HTTP ${response.status}` }
  }
  const contentRange = response.headers.get('content-range')
  const ranged = contentRange === null ? Number.NaN : Number(contentRange.split('/').pop())
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(ranged)) {
    await drain(response)
    return { path, bytes: ranged, probe: 'binding-range' }
  }
  if (Number.isFinite(length) && length > 0) {
    await drain(response)
    return { path, bytes: length, probe: 'binding-length' }
  }
  const counted = await countBody(response)
  if (counted !== null) return { path, bytes: counted, probe: 'binding-count' }
  return { path, error: 'not measurable (binding returned no body)' }
}

/** Measure every requested path with bounded concurrency, preserving order. */
async function measureAssets(env, base, paths) {
  const sizes = Array(paths.length)
  let next = 0
  const runners = Array.from({ length: Math.min(ATTEST_CONCURRENCY, paths.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= paths.length) return
      sizes[index] = await measureAsset(env, base, paths[index])
    }
  })
  await Promise.all(runners)
  return sizes
}

/**
 * Answer one attestation request: the byte length the deployed version serves
 * for each posted path, in the order it was asked for.
 */
export async function handleAssetAttest(request, env, json) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405)
  if (!env.ASSET_ATTEST_SECRET) return json({ ok: false, error: 'attest-not-configured' }, 503)
  if (!secretMatches(env.ASSET_ATTEST_SECRET, request.headers.get('x-dsh-market-attest') || '')) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  const body = await readJsonCapped(request, ATTEST_BODY_MAX_BYTES)
  if (!body.ok) return json({ ok: false, error: body.error }, body.error === 'payload-too-large' ? 413 : 400)
  const paths = body.value && Array.isArray(body.value.paths) ? body.value.paths : null
  if (paths === null || paths.length === 0 || paths.length > ATTEST_MAX_PATHS) {
    return json({ ok: false, error: 'invalid-paths' }, 400)
  }
  if (!paths.every(attestablePath)) return json({ ok: false, error: 'invalid-paths' }, 400)

  const url = new URL(request.url)
  const sizes = await measureAssets(env, url, paths)
  const totalBytes = sizes.reduce((total, entry) => total + (entry.bytes ?? 0), 0)
  return json({ ok: true, count: paths.length, totalBytes, sizes })
}
