#!/usr/bin/env node
/**
 * Verify every family package version matches the release tag. The tag is
 * the single version source of truth for the dsh-web-ui release pipeline:
 * a mismatch (e.g. a package bumped out of band, or a forgotten bump) fails
 * the publish before anything reaches npm.
 *
 * Prints GitHub error annotations (::error file=...) on mismatch and exits
 * non-zero; the release workflow runs this right before publishing.
 *
 * Usage: node scripts/verify-version.mjs <x.y.z|vX.Y.Z>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

const tag = process.argv[2] ?? ''
const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag)
if (match === null) {
  console.error('usage: node scripts/verify-version.mjs <x.y.z | vX.Y.Z>')
  process.exit(2)
}
const version = match[1]

/** Every package.json under packages/ (non-recursive, both roots). */
function packageFiles() {
  const out = []
  for (const root of ['packages', join('packages', 'skins')]) {
    const abs = join(REPO_ROOT, root)
    if (!existsSync(abs)) continue
    for (const entry of readdirSync(abs)) {
      const pkgPath = join(abs, entry, 'package.json')
      if (existsSync(pkgPath)) out.push(pkgPath)
    }
  }
  return out.sort()
}

const files = packageFiles()
if (files.length === 0) {
  console.error('no package.json found under packages/')
  process.exit(1)
}

let mismatch = 0
for (const file of files) {
  let pkgVersion
  try {
    pkgVersion = JSON.parse(readFileSync(file, 'utf8')).version
  } catch (error) {
    console.error(`::error file=${file}::unreadable package.json (${error instanceof Error ? error.message : String(error)})`)
    mismatch = 1
    continue
  }
  if (pkgVersion !== version) {
    console.error(`::error file=${file}::version ${pkgVersion} does not match tag v${version}`)
    mismatch = 1
  }
}

if (mismatch) process.exit(1)
console.log(`[verify-version] all ${files.length} packages match v${version}`)
