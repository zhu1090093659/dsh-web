#!/usr/bin/env node
/**
 * Assert every published family package version resolves from the npm
 * registry after the release pipeline publishes.
 *
 * The publish step's per-package success lines are not a trust boundary: a
 * version can be reported published while the registry still lacks it
 * (propagation lag, seen for minutes on v0.3.18), or while a publish is
 * silently lost. The mount smoke cannot catch the second case on its own,
 * because its auto rewrite falls back to workspace tarballs for family
 * dependencies that are not on the registry, so a broken consumer install
 * still renders.
 *
 * This gate probes the version document (`<registry>/<name>/<version>`) for
 * every non-private family package and retries the whole sweep until every
 * version resolves or the retry budget runs out. Propagation lag resolves
 * inside the budget; a genuinely missing version fails the release run before
 * the mount smoke and the GitHub Release.
 *
 * Usage:
 *   node scripts/verify-registry.mjs <x.y.z|vX.Y.Z> [--registry URL]
 *     [--attempts N] [--delay-ms M] [--timeout-ms M]
 *
 * Defaults: registry.npmjs.org, 20 attempts, 30s between attempts, 15s per
 * request. Exit 0 when every version resolves, 1 when any is still missing,
 * 2 on usage errors.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
export const DEFAULT_ATTEMPTS = 20
export const DEFAULT_DELAY_MS = 30_000
export const DEFAULT_TIMEOUT_MS = 15_000

/** The version document URL for one package, scope-encoded for the registry. */
export function versionDocUrl(name, version, registry = DEFAULT_REGISTRY) {
  return registry.replace(/\/+$/, '') + '/' + encodeURIComponent(name) + '/' + version
}

/** Names whose probe did not resolve, preserving the input order. */
export function missingVersions(results) {
  return results.filter(result => result.ok !== true).map(result => result.name)
}

/**
 * Probe every package once. Returns one result per package:
 * { name, ok, status, reason }. A network failure or non-200 status is a
 * miss; the caller decides whether to retry.
 */
export async function sweepOnce({ packages, version, registry = DEFAULT_REGISTRY, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  const results = []
  for (const name of packages) {
    const url = versionDocUrl(name, version, registry)
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
      if (res.ok) {
        results.push({ name, ok: true, status: res.status, reason: '' })
      } else {
        // Drain the body so the connection can be reused by the next probe.
        await res.text().catch(() => '')
        results.push({ name, ok: false, status: res.status, reason: 'HTTP ' + res.status })
      }
    } catch (error) {
      results.push({ name, ok: false, status: 0, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

/**
 * Sweep until every package resolves or the attempt budget runs out.
 * Returns the final result list; empty misses mean the assertion passed.
 */
export async function assertPublished({
  packages,
  version,
  registry = DEFAULT_REGISTRY,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {},
}) {
  let results = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    results = await sweepOnce({ packages, version, registry, timeoutMs, fetchImpl })
    const missing = missingVersions(results)
    if (missing.length === 0) {
      log('[verify-registry] attempt ' + attempt + ': all ' + packages.length + ' versions resolve')
      return results
    }
    log('[verify-registry] attempt ' + attempt + '/' + attempts + ': ' + missing.length + ' missing ('
      + results.filter(result => result.ok !== true).map(result => result.name + ' ' + result.reason).join(', ') + ')')
    if (attempt < attempts) await sleep(delayMs)
  }
  return results
}

/** Public family packages (name + source path) from the repository walker. */
export function familyPackages(root = REPO_ROOT) {
  const out = []
  for (const { pkgPath } of walkFamilyPackages(root)) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      continue
    }
    if (pkg.private === true || typeof pkg.name !== 'string') continue
    out.push({ name: pkg.name, pkgPath })
  }
  return out
}

function parseArgs(argv) {
  const options = { version: '', registry: DEFAULT_REGISTRY, attempts: DEFAULT_ATTEMPTS, delayMs: DEFAULT_DELAY_MS, timeoutMs: DEFAULT_TIMEOUT_MS }
  const rest = [...argv]
  const value = flag => {
    const index = rest.indexOf(flag)
    if (index === -1) return undefined
    const raw = rest[index + 1]
    rest.splice(index, 2)
    return raw
  }
  const registry = value('--registry')
  const attempts = value('--attempts')
  const delayMs = value('--delay-ms')
  const timeoutMs = value('--timeout-ms')
  if (registry !== undefined) options.registry = registry
  if (attempts !== undefined) options.attempts = Number(attempts)
  if (delayMs !== undefined) options.delayMs = Number(delayMs)
  if (timeoutMs !== undefined) options.timeoutMs = Number(timeoutMs)
  options.version = rest[0] ?? ''
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(options.version)
  if (match === null) {
    console.error('usage: node scripts/verify-registry.mjs <x.y.z | vX.Y.Z> [--registry URL] [--attempts N] [--delay-ms M] [--timeout-ms M]')
    process.exit(2)
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1
    || !Number.isInteger(options.delayMs) || options.delayMs < 0
    || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    console.error('usage: attempts >= 1, delay-ms >= 0, timeout-ms >= 1')
    process.exit(2)
  }
  const version = match[1]
  const packages = familyPackages()
  if (packages.length === 0) {
    console.error('no publishable family package found under packages/')
    process.exit(1)
  }
  const results = await assertPublished({
    packages: packages.map(pkg => pkg.name),
    version,
    registry: options.registry,
    attempts: options.attempts,
    delayMs: options.delayMs,
    timeoutMs: options.timeoutMs,
    log: message => console.log(message),
  })
  const byName = new Map(results.map(result => [result.name, result]))
  let failed = false
  for (const pkg of packages) {
    const result = byName.get(pkg.name)
    if (result !== undefined && result.ok === true) continue
    failed = true
    console.error('::error file=' + pkg.pkgPath + '::' + pkg.name + '@' + version + ' is not resolvable from ' + options.registry
      + ' (' + (result === undefined ? 'not probed' : result.reason) + ')')
  }
  if (failed) {
    console.error('[verify-registry] FAILED: the registry does not serve every ' + version + ' family version')
    process.exit(1)
  }
  console.log('[verify-registry] all ' + packages.length + ' family packages resolve at ' + version + ' on ' + options.registry)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error('::error::verify-registry crashed: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  })
}
