#!/usr/bin/env node
/**
 * market-verify-assets - prove the deployed market actually serves every asset
 * its manifests advertise.
 *
 * The manifests are the contract: the Workshop installs from
 * manifest/<kind>.json, so any path listed there that the site cannot serve is
 * a broken install for a user. This gate walks every listed path and fails on
 * the first mismatch, which makes a partial upload or a stale manifest loud
 * instead of silent.
 *
 * Part of every burst sent from a GitHub runner range comes back 403: the
 * zone's own policy on that vantage answers with a managed challenge, which
 * reports paths the origin serves as missing. Transient statuses are retried
 * inside the burst, and the paths still failing after it are re-checked
 * serially once the burst has stopped, so what the gate reports is a verdict
 * the origin repeats rather than one the burst provoked. No sweep from a runner
 * range completes, so the deploy lane does not verify the deployed site: a
 * maintainer runs this sweep from a network the policy allows.
 *
 * Usage:
 *   node scripts/market-verify-assets.mjs [--dist]
 *   node scripts/market-verify-assets.mjs --origin https://dsh-market.com
 *   node scripts/market-verify-assets.mjs --attest https://dsh-market.com
 *   node scripts/market-verify-assets.mjs --kind skins --concurrency 8
 *
 *   --dist            check the local market/dist tree (default)
 *   --origin <url>    check a deployed origin over HTTP
 *   --attest <url>    measure the deployed version through its own asset
 *                     binding (needs MARKET_ATTEST_SECRET); the measurement
 *                     runs inside Cloudflare, while the call itself still
 *                     leaves this vantage
 *   --kind a,b        restrict to skins and/or pets (default: both)
 *   --concurrency N   parallel requests (default 4)
 *   --limit N         stop after N paths (smoke runs)
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')
export const DIST_DIR = join(REPO_ROOT, 'market', 'dist')
const DEFAULT_ORIGIN = 'https://dsh-market.com'
export const KINDS = ['skins', 'pets']

/**
 * Every site-relative path one manifest entry advertises.
 *
 * skins: each entry's file list is relative to assets/skins/<id>/.
 * pets:  each entry's file list is relative to assets/pets/<id>/, while
 *        previews and the sprite sheet are already site-relative.
 */
export function assetPaths(item, kind) {
  const base = `assets/${kind}/${item.id}/`
  const paths = (item.files ?? []).map(file => base + file)
  if (kind === 'skins') {
    for (const preview of Object.values(item.preview ?? {})) if (preview) paths.push(preview)
  } else {
    for (const preview of item.previews ?? []) paths.push(preview)
    if (item.spritesheet) paths.push(item.spritesheet)
  }
  return [...new Set(paths)]
}

/** Read one emitted manifest. */
export function loadManifest(distDir, kind) {
  const file = join(distDir, 'manifest', `${kind}.json`)
  if (!existsSync(file)) throw new Error(`manifest not found: ${file} (run node scripts/market-build)`)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.items)) throw new Error(`manifest ${file} has no "items" array`)
  return parsed
}

/** Every {kind, id, path} the run must verify. */
export function collectTargets(distDir, kinds) {
  const targets = []
  for (const kind of kinds) {
    for (const item of loadManifest(distDir, kind).items) {
      for (const path of assetPaths(item, kind)) targets.push({ kind, id: item.id, path })
    }
  }
  return targets
}

/** Verify one target against the local dist tree. */
export function verifyLocal(distDir, target) {
  const abs = join(distDir, target.path)
  if (!existsSync(abs)) return { ok: false, reason: 'missing from market/dist' }
  return { ok: true, bytes: statSync(abs).size }
}

/** Backoff between retries; injected by tests so they stay deterministic. */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Statuses an edge origin returns transiently under a burst: the deploy sweep
 * walks thousands of paths and Cloudflare answers part of a fast run with 403
 * before the rate window resets, which says nothing about the asset.
 */
export function isTransientStatus(status) {
  return status === 403 || status === 408 || status === 429 || status >= 500
}

/**
 * Whether a reported failure is one the edge may have produced under the burst,
 * and therefore one worth re-checking once the burst has stopped. A status the
 * origin means (404) or a size mismatch is a verdict and is reported as it
 * stands.
 */
export function transientFailure(reason) {
  const status = /^HTTP (\d{3})$/.exec(reason)
  if (status !== null) return isTransientStatus(Number(status[1]))
  return reason.startsWith('request failed')
}

/**
 * Total byte length a deployed origin serves for one path.
 *
 * A HEAD request is not enough: the Workers static-asset layer answers it with
 * `content-length: 0`, which would report every asset as truncated. A one-byte
 * ranged GET reports the real total in `content-range` while still transferring
 * a single byte.
 *
 * A transient status is retried with backoff so a burst cannot fail the sweep
 * for an asset the origin serves; a status that survives every attempt is
 * reported as it came back.
 */
export async function remoteLength(url, fetchImpl = fetch, { attempts = 3, delay = sleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } })
    let retry = false
    try {
      if (!res.ok && res.status !== 206) {
        retry = attempt < attempts && isTransientStatus(res.status)
        if (!retry) return { error: `HTTP ${res.status}` }
      } else {
        const contentRange = res.headers.get('content-range')
        const ranged = contentRange === null ? Number.NaN : Number(contentRange.split('/').pop())
        if (Number.isFinite(ranged)) return { bytes: ranged }
        const length = Number(res.headers.get('content-length'))
        return { bytes: Number.isFinite(length) ? length : undefined }
      }
    } finally {
      // Drain the single byte (or cancel) so the connection is released.
      await res.arrayBuffer().catch(() => {})
    }
    if (retry) await delay(attempt * 500)
  }
}

/**
 * Compare one served byte count with the committed file, so both the public and
 * the attestation path judge a path by the same rule.
 */
export function compareServedBytes(distDir, target, bytes) {
  const localFile = join(distDir, target.path)
  if (bytes !== undefined && existsSync(localFile)) {
    const local = statSync(localFile).size
    if (bytes !== local) return { ok: false, reason: `served ${bytes} bytes, dist has ${local}` }
  }
  return { ok: true, bytes }
}

/** Verify one target against a deployed origin. */
export async function verifyOrigin(origin, target, { fetchImpl = fetch, distDir, attempts, delay } = {}) {
  const url = `${origin.replace(/\/+$/, '')}/${target.path}`
  let measured
  try {
    measured = await remoteLength(url, fetchImpl, { attempts, delay })
  } catch (error) {
    return { ok: false, reason: `request failed: ${error.message}` }
  }
  if (measured.error !== undefined) return { ok: false, reason: measured.error }
  return compareServedBytes(distDir, target, measured.bytes)
}

/** Paths one attestation request may cover; the route bounds its internal fetches the same way. */
export const ATTEST_WINDOW = 500
/** Re-posts of a window that the edge answered in place of the route. */
export const ATTEST_ATTEMPTS = 3
/** Pause before such a re-post; the first ask of a window carries none. */
const ATTEST_RETRY_MS = 2000

/**
 * The shared secret for the attestation route: from the environment, or, for a
 * local run, from the worker's git-ignored dev secret store (the same file
 * `wrangler dev` reads). CI passes it in the environment; a maintainer running
 * the deploy lane locally does not have to re-export it.
 */
export function attestSecret(env = process.env, file = env.MARKET_ATTEST_ENV_FILE || 'market/worker/.dev.vars') {
  const fromEnv = (env.MARKET_ATTEST_SECRET || '').trim()
  if (fromEnv) return fromEnv
  const path = isAbsolute(file) ? file : join(REPO_ROOT, file)
  if (!existsSync(path)) return ''
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*ASSET_ATTEST_SECRET\s*=\s*(.*)$/.exec(line)
    if (match !== null) return match[1].trim()
  }
  return ''
}

/** One response header, or null when the response does not carry it. */
function headerValue(response, name) {
  const headers = response === null || response === undefined ? undefined : response.headers
  if (headers === undefined || headers === null || typeof headers.get !== 'function') return null
  const value = headers.get(name)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Name what refused a window.
 *
 * A refusal the route itself wrote carries its own error name. Anything that
 * answered in the route's place — a challenge page, a block page, a gateway
 * error — is nameable only by what the reader can look up afterwards: the
 * status, the edge identifiers, and the start of the body.
 */
export function describeRefusal(response, text) {
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  if (payload !== null && typeof payload.error === 'string') return { message: `HTTP ${response.status} (${payload.error})`, verdict: true }
  const parts = [`HTTP ${response.status}`]
  for (const name of ['cf-ray', 'cf-mitigated', 'server']) {
    const value = headerValue(response, name)
    if (value !== null) parts.push(`${name}=${value}`)
  }
  const snippet = String(text).replace(/\s+/g, ' ').trim().slice(0, 120)
  if (snippet !== '') parts.push(`body="${snippet}"`)
  return { message: parts.join(' '), verdict: false }
}

/** Ask the route for one window: its measurements, or what refused them. */
async function attestWindow(base, chunk, secret, fetchImpl) {
  const response = await fetchImpl(`${base}/api/asset-attest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-market-attest': secret },
    body: JSON.stringify({ paths: chunk.map(target => `/${target.path}`) }),
  })
  const text = await response.text().catch(() => '')
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  if (payload !== null && payload.ok === true && Array.isArray(payload.sizes)) return { sizes: payload.sizes }
  return { refusal: describeRefusal(response, text) }
}

/**
 * Verify the committed byte counts against what the deployed version measures
 * through its own asset binding.
 *
 * The measurement runs inside Cloudflare against the deployed assets, which
 * keeps the caller's network out of the answer. The call itself still leaves
 * that network, so the zone's policy on it can refuse the request before the
 * route sees it: that refusal is reported as what refused the call — the status,
 * the edge identifiers, the start of the body — and never as a verdict about the
 * assets. The caller posts the paths of one window and the route answers with
 * the byte length each one serves; a refusal — a status the route itself could
 * not measure, a window the route rejects, or a path the answer skipped — is
 * reported as an error rather than excused, because nothing about the assets was
 * verified in that case. A refusal the route did not write is re-asked, since it
 * came from in front of the route rather than from it; a challenge on the vantage
 * repeats on every ask, and the sweep reports it as such.
 */
export async function attestTargets(origin, targets, { secret, distDir, windowSize = ATTEST_WINDOW, fetchImpl = fetch, delay = sleep, attempts = ATTEST_ATTEMPTS } = {}) {
  const results = []
  const base = origin.replace(/\/+$/, '')
  for (let start = 0; start < targets.length; start += windowSize) {
    const chunk = targets.slice(start, start + windowSize)
    let measured
    let refusal = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const answer = await attestWindow(base, chunk, secret, fetchImpl)
        if (answer.sizes !== undefined) {
          measured = answer.sizes
          break
        }
        refusal = answer.refusal
      } catch (error) {
        refusal = { message: `request failed: ${error.message}`, verdict: false }
      }
      // The route's own verdict repeats on a second ask; what the edge answered
      // in its place need not.
      if (refusal.verdict || attempt === attempts) break
      await delay(attempt * ATTEST_RETRY_MS)
    }
    if (measured === undefined) return { error: `attestation refused: ${refusal.message}` }
    const byPath = new Map(measured.map(entry => [String(entry.path).replace(/^\//, ''), entry]))
    for (const target of chunk) {
      const entry = byPath.get(target.path)
      if (entry === undefined) {
        results.push({ target, result: { ok: false, reason: 'not measured by the attestation' } })
      } else if (entry.error !== undefined) {
        results.push({ target, result: { ok: false, reason: entry.error } })
      } else {
        results.push({ target, result: compareServedBytes(distDir, target, entry.bytes) })
      }
    }
  }
  return { results }
}

/**
 * Re-check the paths a burst reported once it has stopped.
 *
 * The edge answers part of a fast sweep from a cloud IP range with 403 until
 * its rate window resets, which is a statement about the burst rather than
 * about the asset. The re-check first probes the first failed path until it
 * answers, inside a budget, so the pass does not read a window still in force
 * as a verdict; then it walks the paths one at a time, so a path the origin
 * serves comes back served while a path it really refuses fails again.
 *
 * A run of consecutive failures after the probe means the origin is not
 * answering, so the pass stops there and the remaining paths keep the status
 * the burst reported rather than being excused by an outage.
 *
 * @param origin - deployed origin to re-check against.
 * @param targets - targets whose burst status was transient, in walk order.
 * @param options - distDir plus injected delay and fetch, probe budget, pacing, streak bound.
 * @returns the per-path results keyed by path, and whether the pass gave up.
 */
export async function reverifySerially(origin, targets, {
  distDir,
  delay = sleep,
  fetchImpl,
  attempts = 3,
  probeStepMs = 5_000,
  probeBudgetMs = 180_000,
  spacingMs = 300,
  giveUpAfter = 20,
} = {}) {
  const results = new Map()
  if (targets.length === 0) return { results, gaveUp: false }
  const check = (target) => verifyOrigin(origin, target, { distDir, attempts, delay, fetchImpl })

  let probed = await check(targets[0])
  for (let waited = 0; !probed.ok && waited < probeBudgetMs; waited += probeStepMs) {
    await delay(probeStepMs)
    probed = await check(targets[0])
  }
  results.set(targets[0].path, probed)

  let streak = probed.ok ? 0 : 1
  let gaveUp = false
  for (const [index, target] of targets.slice(1).entries()) {
    if (streak >= giveUpAfter) {
      gaveUp = true
      break
    }
    if (index > 0) await delay(spacingMs)
    const result = await check(target)
    results.set(target.path, result)
    streak = result.ok ? 0 : streak + 1
  }
  return { results, gaveUp }
}

/**
 * What a sweep the edge refused outright means.
 *
 * From a cloud range the edge can answer every failed path with 403 for the
 * whole run while serving every other path; the same paths answer 200 with the
 * committed byte lengths from other networks, so the refusal is a policy on
 * this vantage rather than a verdict about the asset. Naming it in the output
 * is what keeps the lane's red from being read as a deployment defect.
 */
export function refusalNotice(failures) {
  if (failures.length === 0) return ''
  if (!failures.every(entry => entry.result.reason === 'HTTP 403')) return ''
  return `[market-verify-assets] all ${failures.length} failure(s) are HTTP 403 and the same paths serve the committed byte lengths from other networks: read this as an edge policy on this vantage, not as missing assets`
}

/** Run `worker` over `items` with bounded concurrency, preserving order. */
export async function runPool(items, concurrency, worker) {
  const results = Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function parseArgs(argv) {
  const options = { mode: 'dist', origin: DEFAULT_ORIGIN, kinds: [...KINDS], concurrency: 4, limit: 0 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dist') options.mode = 'dist'
    else if (arg === '--attest') {
      options.mode = 'attest'
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--attest needs a URL')
      options.origin = value
    } else if (arg === '--origin') {
      options.mode = 'origin'
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--origin needs a URL')
      options.origin = value
    } else if (arg === '--kind') {
      const value = argv[++i]
      if (value === undefined) throw new Error('--kind needs a value')
      options.kinds = value.split(',').map(kind => kind.trim()).filter(Boolean)
    } else if (arg === '--concurrency') {
      options.concurrency = Number(argv[++i])
    } else if (arg === '--limit') {
      options.limit = Number(argv[++i])
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`market-verify-assets: ${error.message}`)
    process.exit(2)
  }
  if (options.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    return
  }
  const unknown = options.kinds.filter(kind => !KINDS.includes(kind))
  if (unknown.length > 0) {
    console.error(`market-verify-assets: unknown kind(s): ${unknown.join(', ')}`)
    process.exit(2)
  }

  let targets
  try {
    targets = collectTargets(DIST_DIR, options.kinds)
  } catch (error) {
    console.error(`market-verify-assets: ${error.message}`)
    process.exit(1)
  }
  if (options.limit > 0) targets = targets.slice(0, options.limit)

  const where = options.mode === 'dist' ? DIST_DIR : options.origin
  console.log(`[market-verify-assets] ${targets.length} path(s) from ${options.kinds.join(', ')} against ${where}${options.mode === 'attest' ? ' (through the deployed asset binding)' : ''}`)

  let results
  if (options.mode === 'attest') {
    const secret = attestSecret()
    if (!secret) {
      console.error('[market-verify-assets] no attestation secret: set MARKET_ATTEST_SECRET (CI) or put ASSET_ATTEST_SECRET in market/worker/.dev.vars (local); the route refuses an unauthenticated call and nothing about the assets would be verified')
      process.exit(2)
    }
    const attested = await attestTargets(options.origin, targets, { secret, distDir: DIST_DIR })
    if (attested.error !== undefined) {
      console.error(`[market-verify-assets] ${attested.error}`)
      process.exit(1)
    }
    results = attested.results
  } else {
    results = await runPool(targets, options.concurrency, async (target) => {
      const result = options.mode === 'origin'
        ? await verifyOrigin(options.origin, target, { distDir: DIST_DIR })
        : verifyLocal(DIST_DIR, target)
      return { target, result }
    })
  }

  // A cloud IP range gets part of a burst answered with a transient status, so
  // the paths the burst failed are re-checked serially after the burst has
  // stopped. A verdict the origin repeats survives that pass and is reported.
  const retryable = options.mode === 'origin'
    ? results.filter(entry => !entry.result.ok && transientFailure(entry.result.reason))
    : []
  if (retryable.length > 0) {
    const { results: rechecked, gaveUp } = await reverifySerially(
      options.origin,
      retryable.map(entry => entry.target),
      { distDir: DIST_DIR },
    )
    let recovered = 0
    for (const entry of retryable) {
      const updated = rechecked.get(entry.target.path)
      if (updated === undefined) continue
      if (updated.ok) recovered += 1
      entry.result = updated
    }
    const outcome = gaveUp ? '; stopped on a run of failures' : ''
    console.log(`[market-verify-assets] re-checked ${retryable.length} transient path(s) serially: ${recovered} recovered${outcome}`)
  }

  const failures = results.filter(entry => !entry.result.ok)
  const bytes = results.reduce((total, entry) => total + (entry.result.bytes ?? 0), 0)
  for (const entry of failures.slice(0, 20)) {
    console.error(`[market-verify-assets] FAIL ${entry.target.kind}/${entry.target.id}: ${entry.target.path} - ${entry.result.reason}`)
  }
  if (failures.length > 20) console.error(`[market-verify-assets] ... and ${failures.length - 20} more`)
  const notice = refusalNotice(failures)
  if (notice !== '') console.error(notice)

  if (failures.length > 0) {
    console.error(`[market-verify-assets] ${failures.length}/${targets.length} path(s) failed`)
    process.exit(1)
  }
  console.log(`[market-verify-assets] OK: ${targets.length} path(s), ${(bytes / 1048576).toFixed(1)} MiB`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main()
}
