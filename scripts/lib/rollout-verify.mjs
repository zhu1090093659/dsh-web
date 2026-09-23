/**
 * Pure checks for the post-rollout acceptance flow (`scripts/rollout-verify.sh`).
 * The declared DSH host floor is the single cohort contract: the host CLI must
 * satisfy it and the root lockfile must resolve the family at exactly the
 * floor's version, so a host/plugin cohort mismatch is caught before the
 * module-identity split does (see the 0.1.5-alpha.2 cohort Agent Note).
 */

import { readFileSync } from 'node:fs'

/** Read the `dsh.engines.dsh` floor (`>=X`) from the plugin scaffold manifest. */
export function readDshFloor(pluginTemplateManifestPath) {
  const manifest = JSON.parse(readFileSync(pluginTemplateManifestPath, 'utf8'))
  const floor = manifest.dsh?.engines?.dsh
  if (typeof floor !== 'string' || !floor.startsWith('>=')) {
    throw new Error(`plugin scaffold carries no >= floor: ${pluginTemplateManifestPath}`)
  }
  return floor
}

/** `>=X` literal -> bare version. */
export function floorVersion(floor) {
  return floor.replace(/^>=\s*/, '')
}

function comparePrereleaseIdentifier(a, b) {
  const isNum = (v) => /^\d+$/.test(v)
  if (isNum(a) && isNum(b)) return Math.sign(Number(a) - Number(b))
  if (isNum(a)) return -1
  if (isNum(b)) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function compareVersions(a, b) {
  const parse = (v) => {
    const [core, prerelease] = v.split('-', 2)
    return { core: core.split('.').map(Number), prerelease: prerelease ? prerelease.split('.') : [] }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const d = pa.core[i] - pb.core[i]
    if (d !== 0) return Math.sign(d)
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  // A release outranks its own prereleases.
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i += 1) {
    if (i >= pa.prerelease.length) return -1
    if (i >= pb.prerelease.length) return 1
    const d = comparePrereleaseIdentifier(pa.prerelease[i], pb.prerelease[i])
    if (d !== 0) return d
  }
  return 0
}

/** Whether `version` satisfies a `>=X` floor (semver, prerelease aware). */
export function satisfiesFloor(version, floor) {
  return compareVersions(version, floorVersion(floor)) >= 0
}

/**
 * Every dsh-family reference in the lockfile must resolve at exactly the
 * cohort version. pnpm lockfiles carry family versions in three shapes, all
 * checked here: importers list the key on one line and `version: V` on the
 * next, snapshot dependency rows write `'pkg': V` inline, and packages
 * section keys embed the version (`'pkg@V(peers)':`). pnpm 11 also appends
 * peer-resolution suffixes to versions (`V(@deepseek-ai/cordis@4.0.2)...`);
 * only the leading segment identifies the release. Returns the offending
 * `[key, version]` pairs (empty means pure). Independent-version support
 * pins (cordis, cosmokit, schemastery, the landlock add-on) and external
 * plugins do not follow the release line and never match the key pattern.
 */
export function lockfileCohortViolations(lockfileText, floor) {
  const expected = floorVersion(floor)
  const violations = []
  const seen = new Set()
  const report = (key, version) => {
    if (version === expected || seen.has(key)) return
    seen.add(key)
    violations.push([key, version])
  }
  const bare = (raw) => raw.split('(')[0]
  const lines = lockfileText.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // Packages-section keys embed the version after the package name; the
    // name itself carries no `@`, so this must be tried before the bare-key
    // shapes or the trailing `':` lets an importers-style match shadow it.
    const packageKey = line.match(/^\s*'(@deepseek-ai\/dsh[^'@]*)@([0-9][^ '(']*)/)
    if (packageKey) {
      report(packageKey[1], packageKey[2])
      continue
    }
    const inline = line.match(/^\s*'(@deepseek-ai\/dsh[^']*':)\s*([0-9][^ '\s,]*)/)
    if (inline) {
      report(inline[1].replace(/':$/, ''), bare(inline[2]))
      continue
    }
    const importKey = line.match(/^\s*'(@deepseek-ai\/dsh[^']*)':\s*$/)
    if (importKey) {
      // Importers entries read key / specifier / version across three lines.
      for (const next of [lines[i + 1] ?? '', lines[i + 2] ?? '']) {
        const version = next.match(/^\s*version:\s*([0-9][^ '\s,]*)/)
        if (version) {
          report(importKey[1], bare(version[1]))
          break
        }
      }
      continue
    }
  }
  return violations
}
