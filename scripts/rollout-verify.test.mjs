/**
 * Cohort rollout contract tests: the floor literal stays a plain `>=` semver,
 * the host comparison honors prerelease ordering, and the root lockfile must
 * resolve every dsh-family key at the floor's cohort version or at the exact
 * version the workspace overrides pin it to, so only declared exceptions may
 * sit off the floor.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  floorVersion,
  lockfileCohortViolations,
  readDshFloor,
  readWorkspaceOverrides,
  satisfiesFloor,
} from './lib/rollout-verify.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const NL = String.fromCharCode(10)

test('the plugin scaffold declares a >= floor and the current cohort matches it', () => {
  const floor = readDshFloor(join(ROOT, 'scripts/plugin-template/package.json'))
  assert.match(floor, /^>=\s*\d+\.\d+\.\d+/)
  // The scaffold floor names the cohort the repository installs; when the
  // cohort moves, this assertion and the manifest move together.
  assert.equal(floor, '>=0.2.2-rc.3')
})

test('satisfiesFloor follows semver prerelease ordering', () => {
  const floor = '>=0.1.5-alpha.2'
  assert.equal(satisfiesFloor('0.1.5-alpha.2', floor), true)
  assert.equal(satisfiesFloor('0.1.5-alpha.10', floor), true)
  assert.equal(satisfiesFloor('0.1.5-rc.1', floor), true)
  assert.equal(satisfiesFloor('0.1.5', floor), true)
  assert.equal(satisfiesFloor('0.1.6', floor), true)
  assert.equal(satisfiesFloor('0.1.2-rc.1', floor), false)
  assert.equal(satisfiesFloor('0.1.5-alpha.1', floor), false)
  assert.equal(satisfiesFloor('0.1.4', floor), false)
  assert.equal(satisfiesFloor('0.2.0', '>=0.1.5-alpha.2'), true)
})

test('floorVersion strips the comparator', () => {
  assert.equal(floorVersion('>=0.1.5-alpha.2'), '0.1.5-alpha.2')
  assert.equal(floorVersion('>= 1.2.3'), '1.2.3')
})

const PEER_SUFFIX = '(@deepseek-ai/cordis@4.0.2)(@deepseek-ai/dsh-scope@0.1.5-alpha.2(@deepseek-ai/cordis@4.0.2))'
const LOCK = [
  "lockfileVersion: '9.0'",
  'settings:',
  '  autoInstallPeers: false',
  'importers:',
  '  .:',
  '    devDependencies:',
  "      '@deepseek-ai/cordis':",
  '        specifier: ^4.0.2',
  '        version: 4.0.2',
  "      '@deepseek-ai/dsh-agent':",
  '        specifier: ^0.1.5-alpha.2',
  '        version: 0.1.5-alpha.2',
  "      '@deepseek-ai/dsh-llm':",
  '        specifier: ^0.1.5-alpha.2',
  '        version: 0.1.5-alpha.2' + PEER_SUFFIX,
  'packages:',
  "  '@deepseek-ai/dsh-agent@0.1.5-alpha.2':",
  '    resolution: {integrity: sha512-x}',
  "  '@deepseek-ai/dsh-session@0.1.5-alpha.2" + PEER_SUFFIX + "':",
  '    resolution: {integrity: sha512-y}',
  "  '@deepseek-ai/schemastery@3.18.2':",
  '    resolution: {integrity: sha512-z}',
  '  dsh-better-sidebar@0.18.0:',
  '    resolution: {integrity: sha512-a}',
  'snapshots:',
  "  '@deepseek-ai/dsh-agent@0.1.5-alpha.2':",
  '    dependencies:',
  "      '@deepseek-ai/dsh-base': 0.1.5-alpha.2" + PEER_SUFFIX,
  "      '@deepseek-ai/dsh-older': 0.1.2-rc.1",
].join(NL)

test('lockfile purity accepts the aligned cohort with peer suffixes and support pins', () => {
  const drifted = lockfileCohortViolations(LOCK, '>=0.1.5-alpha.2')
  assert.deepEqual(drifted, [['@deepseek-ai/dsh-older', '0.1.2-rc.1']])
})

function driftLock(from, to, base = LOCK) {
  assert.ok(base.includes(from), 'fixture must contain the drifted fragment')
  return base.replace(from, to)
}

test('lockfile purity rejects family keys off the cohort version', () => {
  const drifted = driftLock(
    "'@deepseek-ai/dsh-agent':" + NL + '        specifier: ^0.1.5-alpha.2' + NL + '        version: 0.1.5-alpha.2',
    "'@deepseek-ai/dsh-agent':" + NL + '        specifier: ^0.1.5-alpha.2' + NL + '        version: 0.1.2-rc.1',
  )
  const violations = lockfileCohortViolations(drifted, '>=0.1.5-alpha.2')
  assert.ok(violations.some(([key, version]) => key === '@deepseek-ai/dsh-agent' && version === '0.1.2-rc.1'))
  const driftedSuffix = driftLock(
    'version: 0.1.5-alpha.2' + PEER_SUFFIX,
    'version: 0.1.5-alpha.1' + PEER_SUFFIX,
  )
  assert.ok(
    lockfileCohortViolations(driftedSuffix, '>=0.1.5-alpha.2').some(
      ([key, version]) => key === '@deepseek-ai/dsh-llm' && version === '0.1.5-alpha.1',
    ),
  )
  const driftedPackageKey = driftLock(
    "  '@deepseek-ai/dsh-agent@0.1.5-alpha.2':",
    "  '@deepseek-ai/dsh-agent@0.1.5-alpha.1':",
  )
  assert.ok(
    lockfileCohortViolations(driftedPackageKey, '>=0.1.5-alpha.2').some(
      ([key, version]) => key === '@deepseek-ai/dsh-agent' && version === '0.1.5-alpha.1',
    ),
  )
})

// The workspace override ledger is the only way a family key may sit off the
// floor, so these cases fix what an override excuses and what it cannot.
const OVERRIDE_LOCK = [
  "lockfileVersion: '9.0'",
  'importers:',
  '  .:',
  '    devDependencies:',
  "      '@deepseek-ai/dsh-client-store':",
  '        specifier: ^0.2.2-rc.1',
  '        version: 0.2.1-rc.5(@deepseek-ai/cordis@4.0.5)',
  "      '@deepseek-ai/dsh-session':",
  '        specifier: ^0.2.2-rc.1',
  '        version: 0.2.2-rc.1',
].join(NL)

const CLIENT_STORE_OVERRIDE = { '@deepseek-ai/dsh-client-store': '0.2.1-rc.5' }

test('lockfile purity accepts a family key at its declared override version', () => {
  assert.deepEqual(lockfileCohortViolations(OVERRIDE_LOCK, '>=0.2.2-rc.1', CLIENT_STORE_OVERRIDE), [])
})

test('lockfile purity rejects that same key once the workspace declares no override', () => {
  assert.deepEqual(lockfileCohortViolations(OVERRIDE_LOCK, '>=0.2.2-rc.1'), [
    ['@deepseek-ai/dsh-client-store', '0.2.1-rc.5'],
  ])
})

test('lockfile purity rejects a declared override the lockfile does not honor', () => {
  assert.deepEqual(
    lockfileCohortViolations(OVERRIDE_LOCK, '>=0.2.2-rc.1', {
      '@deepseek-ai/dsh-client-store': '0.2.1-rc.6',
    }),
    [['@deepseek-ai/dsh-client-store', '0.2.1-rc.5']],
  )
})

test('lockfile purity keeps guarding the keys the overrides do not name', () => {
  const drifted = driftLock('version: 0.2.2-rc.1', 'version: 0.2.2-rc.2', OVERRIDE_LOCK)
  assert.deepEqual(lockfileCohortViolations(drifted, '>=0.2.2-rc.1', CLIENT_STORE_OVERRIDE), [
    ['@deepseek-ai/dsh-session', '0.2.2-rc.2'],
  ])
})

test('lockfile purity lets a range override excuse its key without pinning it', () => {
  assert.deepEqual(
    lockfileCohortViolations(OVERRIDE_LOCK, '>=0.2.2-rc.1', {
      '@deepseek-ai/dsh-client-store': '^0.2.2-rc.1',
    }),
    [],
  )
})

test('the real root lockfile resolves the family at the scaffold floor', () => {
  const floor = readDshFloor(join(ROOT, 'scripts/plugin-template/package.json'))
  const overrides = readWorkspaceOverrides(join(ROOT, 'pnpm-workspace.yaml'))
  assert.deepEqual(
    lockfileCohortViolations(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'), floor, overrides),
    [],
  )
})
