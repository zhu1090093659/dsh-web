/**
 * DSH compatibility contract invariant: every published family package and the
 * plugin scaffold declare the minimum runtime metadata consumed by the
 * plugin-manager update guard (issue #754) plus the host peer an npm-resolution
 * consumer reads, and no family package — the aggregate package included, whose
 * floor is the family's machine-readable compatibility statement — may declare
 * either below the scaffold's cohort floor. Generated nested compatibility
 * shims are intentionally outside the family package walker.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'
import { floorVersion, readDshFloor, satisfiesFloor } from './lib/rollout-verify.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SUPPORTED_MINIMUM = /^>=\s*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const HOST_PEER = '@deepseek-ai/dsh'
const SCAFFOLD = join(ROOT, 'scripts', 'plugin-template', 'package.json')
const AGGREGATE = join(ROOT, 'packages', 'dsh-web-all', 'package.json')

function readManifest(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8'))
}

/** Returns the declared floor after asserting its shape. */
function assertSupportedMinimum(pkgPath) {
  const minimum = readManifest(pkgPath)?.dsh?.engines?.dsh
  assert.equal(typeof minimum, 'string', `${relative(ROOT, pkgPath)} must declare dsh.engines.dsh`)
  assert.match(minimum, SUPPORTED_MINIMUM, `${relative(ROOT, pkgPath)} must use the supported >=<semver> form`)
  return minimum
}

/** Returns the declared host peer after asserting its shape. */
function assertSupportedHostPeer(pkgPath) {
  const peer = readManifest(pkgPath)?.peerDependencies?.[HOST_PEER]
  assert.equal(typeof peer, 'string', `${relative(ROOT, pkgPath)} must declare the ${HOST_PEER} peer`)
  assert.match(peer, SUPPORTED_MINIMUM, `${relative(ROOT, pkgPath)} host peer must use the supported >=<semver> form`)
  return peer
}

/** Every family manifest plus the scaffold, with the aggregate proven covered. */
function familyManifests() {
  const packages = walkFamilyPackages(ROOT)
  assert.ok(packages.length > 0, 'family walker found no packages')
  assert.ok(
    packages.some(({ pkgPath }) => pkgPath === AGGREGATE),
    'the family walker must cover the aggregate package',
  )
  return [...packages.map(({ pkgPath }) => pkgPath), SCAFFOLD]
}

function belowFloor(cohort, read) {
  const below = []
  for (const pkgPath of familyManifests()) {
    const declared = read(pkgPath)
    if (!satisfiesFloor(floorVersion(declared), cohort)) {
      below.push(`${relative(ROOT, pkgPath)}: ${declared} < ${cohort}`)
    }
  }
  assert.deepEqual(below, [], `floors below the cohort floor ${cohort}:\n${below.join('\n')}`)
}

test('every family package declares a supported DSH runtime floor', () => {
  for (const pkgPath of familyManifests()) assertSupportedMinimum(pkgPath)
})

test('every family package declares a supported DSH host peer', () => {
  for (const pkgPath of familyManifests()) assertSupportedHostPeer(pkgPath)
})

test('no family declaration trails the scaffold cohort floor, the aggregate included', () => {
  const cohort = readDshFloor(SCAFFOLD)
  belowFloor(cohort, assertSupportedMinimum)
  belowFloor(cohort, assertSupportedHostPeer)
})
