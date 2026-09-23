#!/usr/bin/env node
/**
 * Committed lib/ artifact guard.
 *
 * Four packages commit their build output (a lib/ directory per package): a consumer that
 * resolves the package without rebuilding it gets exactly those bytes. When
 * that output was produced from a source snapshot that later moved on, the
 * repository ships stale code — the maid-atelier reviewed-hooks table did
 * exactly that (the committed bundle kept the previous hash while
 * src/reviewed-hooks.generated.ts already held the new one), and the aggregate
 * package inlines every child plugin's src/client, which its own AGENTS.md
 * documents as the cause of the 2026-09-09 "restart changed nothing" incident.
 *
 * Comparing the committed bytes against a fresh build cannot work here: a build
 * embeds the checkout's absolute path into bundles (CSS-module hashes), so
 * rebuilt bytes differ per machine — the CI workflow says the same. This check
 * therefore fingerprints the SOURCE INPUTS each committed lib/ was built from
 * (own src/, plus every child package's src/ for the aggregate) and fails when
 * those inputs moved without the fingerprint being refreshed.
 *
 * Usage:
 *   node scripts/lib-artifact-check.mjs           # check (CI gate)
 *   node scripts/lib-artifact-check.mjs --write   # after rebuilding lib/
 * Tests: node --test scripts/lib-artifact-check.test.mjs
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = join(ROOT, 'scripts', 'lib-artifact-fingerprints.json')
const AGGREGATE = join(ROOT, 'packages', 'dsh-web-all', 'aggregate.yml')
/** The aggregate inlines its children's client sources, so it owns their inputs too. */
const AGGREGATE_PACKAGE = 'packages/dsh-web-all'

/**
 * Whether one source path reaches a bundle.
 *
 * Test files never do, so editing them must not demand a rebuild.
 * @param relPath - path relative to the package's src directory.
 * @returns true when the file is part of the bundled program.
 */
export function isBundledSource(relPath) {
  const posix = relPath.split(sep).join('/')
  if (/(^|\/)tests?\//.test(posix)) return false
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(posix)
}

/**
 * Fingerprint a set of path/digest pairs.
 * Order-independent, so directory-walk order never matters.
 * @param entries - [path, sha256] pairs.
 * @returns the hex digest.
 */
export function fingerprintEntries(entries) {
  const hash = createHash('sha256')
  const sorted = [...entries].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  for (const [rel, digest] of sorted) {
    hash.update(rel)
    hash.update('\0')
    hash.update(digest)
    hash.update('\n')
  }
  return hash.digest('hex')
}

/**
 * Package directories the aggregate manifest pulls in.
 * @param text - aggregate.yml contents.
 * @returns sorted package directories, repo-relative.
 */
export function parseAggregateInputs(text) {
  const dirs = new Set()
  for (const line of text.split('\n')) {
    const match = /^\s*-\s+\.\.\/(.+?)\s*$/.exec(line)
    if (match === null) continue
    dirs.add('packages/' + match[1].replace(/\/+$/, ''))
  }
  return [...dirs].sort()
}

/** Every bundled source file under one directory, as sorted POSIX paths. */
function sourceFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(dir, full).split(sep).join('/')
      if (isBundledSource(rel)) out.push(rel)
    }
  }
  walk(dir)
  return out.sort()
}

/** Content digests for one package's bundled sources (empty when it has no src). */
function sourceEntries(pkgDir) {
  const dir = join(ROOT, pkgDir, 'src')
  if (!existsSync(dir)) return []
  return sourceFiles(dir).map((rel) => [rel, createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')])
}

/** Package directories whose lib/ is committed to git (the only shipped artifacts). */
function trackedLibPackages() {
  const files = execFileSync('git', ['ls-files', 'packages'], { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean)
  const tracked = new Set(files)
  const packages = new Set()
  for (const file of files) {
    if (!file.includes('/lib/')) continue
    let dir = dirname(file)
    while (dir !== '.' && dir !== 'packages' && !tracked.has(dir + '/package.json')) dir = dirname(dir)
    if (!tracked.has(dir + '/package.json')) continue
    if (file.slice(dir.length + 1).startsWith('lib/')) packages.add(dir)
  }
  return [...packages].sort()
}

/** Fingerprint one package's inputs, including the aggregate's children. */
function packageFingerprint(pkgDir) {
  let entries = sourceEntries(pkgDir)
  if (pkgDir === AGGREGATE_PACKAGE && existsSync(AGGREGATE)) {
    for (const child of parseAggregateInputs(readFileSync(AGGREGATE, 'utf8'))) {
      entries = entries.concat(sourceEntries(child).map(([rel, digest]) => [child + '/' + rel, digest]))
    }
  }
  return fingerprintEntries(entries)
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isCli) {
  const packages = trackedLibPackages()
  const fingerprints = Object.fromEntries(packages.map((dir) => [dir, packageFingerprint(dir)]))
  if (process.argv.includes('--write')) {
    writeFileSync(MANIFEST, JSON.stringify(fingerprints, null, 2) + '\n')
    console.log('lib-artifact-check: recorded ' + packages.length + ' source fingerprints in ' + relative(ROOT, MANIFEST))
  } else {
    const recorded = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
    const stale = []
    for (const dir of packages) {
      const expected = recorded[dir]
      if (expected === undefined) stale.push(dir + ' (no recorded fingerprint)')
      else if (expected !== fingerprints[dir]) stale.push(dir + ' (sources moved since the recorded build)')
    }
    if (stale.length > 0) {
      console.error('lib-artifact-check: committed lib/ output is stale:')
      for (const line of stale) console.error('  - ' + line)
      console.error('\nRebuild the listed packages (pnpm build), then run:')
      console.error('  node scripts/lib-artifact-check.mjs --write')
      console.error('and commit the refreshed lib/ output together with the manifest.')
      process.exit(1)
    }
    console.log('lib-artifact-check: OK (' + packages.length + ' committed lib/ packages match their sources)')
  }
}
