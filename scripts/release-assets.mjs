#!/usr/bin/env node
/**
 * Download the published npm tarballs for a release tag so the pipeline can
 * attach them to the GitHub Release as real installable artifacts (a
 * bare `gh release create` leaves only GitHub's auto-generated source
 * archives).
 *
 * Walks the same package set as verify-version.mjs (packages/* and
 * packages/skins/*, non-recursive), reads each package.json name + version,
 * skips private packages (pnpm -r publish never pushes them, so they would
 * 404 forever — v0.2.4: dsh-chat-recovery), waits for every publishable
 * version to become readable on the npm registry (fresh publishes are
 * eventually consistent and can 404 briefly), and runs
 * `npm pack <name>@<version>` against the registry. Packing from the
 * registry (not the working tree) makes every uploaded tarball
 * byte-identical to what `pnpm -r publish` pushed moments earlier.
 *
 * Prints one tarball path per line plus a summary. Fails (exit 1) when a
 * package version does not match the tag or npm pack fails.
 *
 * Usage: node scripts/release-assets.mjs <vX.Y.Z> <outDir>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

/** Every package.json under packages/ (non-recursive, both roots). */
export function packageFiles(cwd) {
  return walkFamilyPackages(cwd).map(({ pkgPath }) => pkgPath)
}

/**
 * Pack one published package from the registry into outDir and return the
 * resulting tarball path. `run` mirrors execFileSync and is injectable for
 * tests.
 */
export function packOne(name, version, outDir, run = (file, args, options) => execFileSync(file, args, options)) {
  const stdout = run('npm', ['pack', name + '@' + version, '--pack-destination', outDir, '--json'], { encoding: 'utf8' })
  const filename = JSON.parse(stdout)[0]?.filename
  if (typeof filename !== 'string' || filename === '') {
    throw new Error('npm pack returned no filename for ' + name + '@' + version)
  }
  return join(outDir, filename)
}

function defaultView(name, version) {
  execFileSync('npm', ['view', name + '@' + version, 'version'], { encoding: 'utf8' })
}

/**
 * Family packages that actually reach the registry: private packages are
 * bundled into a carrier (or referenced as a workspace dep) and `pnpm -r
 * publish` skips them, so packing them from the registry can never succeed.
 */
export function publishablePackages(packages) {
  return packages.filter(pkg => pkg.private !== true)
}

/**
 * The npm registry is eventually consistent for fresh publishes: a version
 * `pnpm publish` reported as pushed can still 404 for a short window
 * (v0.1.17 and v0.1.18 both failed here). Wait until every release package
 * version is readable via `npm view` (bounded), so the pack loop never hits
 * a transient 404. `view` is injectable for tests.
 */
export function waitForPublished(packages, version, view = defaultView, { attempts = 30, delayMs = 10000 } = {}) {
  const missing = new Set(packages.map(pkg => pkg.name))
  for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const name of [...missing]) {
      try {
        view(name, version)
        missing.delete(name)
      } catch {
        // Not propagated yet; retried in the next attempt.
      }
    }
    if (missing.size === 0) return
    if (attempt < attempts) {
      console.warn('[release-assets] waiting for npm propagation: ' + [...missing].join(', ') + ' (attempt ' + attempt + '/' + attempts + ')')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)
    }
  }
  throw new Error('[release-assets] timed out waiting for npm propagation: ' + [...missing].join(', '))
}

function main() {
  const tag = process.argv[2] ?? ''
  const outDir = process.argv[3] ?? ''
  if (!/^v?\d+\.\d+\.\d+$/.test(tag) || outDir === '') {
    console.error('usage: node scripts/release-assets.mjs <vX.Y.Z> <outDir>')
    process.exit(2)
  }
  const version = tag.replace(/^v/, '')
  mkdirSync(outDir, { recursive: true })
  const files = packageFiles(REPO_ROOT)
  if (files.length === 0) {
    console.error('no package.json found under packages/')
    process.exit(1)
  }
  const packages = []
  for (const file of files) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (pkg.version !== version) {
      console.error('::error file=' + file + '::version ' + pkg.version + ' does not match tag ' + tag)
      process.exit(1)
    }
    packages.push(pkg)
  }
  // Version parity above covers every family package; only publishable
  // packages can ever be packed back from the registry.
  const publishable = publishablePackages(packages)
  waitForPublished(publishable, version)
  const packed = []
  for (const pkg of publishable) {
    const tgz = packOne(pkg.name, version, outDir)
    packed.push(tgz)
    console.log(tgz)
  }
  console.log('[release-assets] packed ' + packed.length + ' tarballs into ' + outDir)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
