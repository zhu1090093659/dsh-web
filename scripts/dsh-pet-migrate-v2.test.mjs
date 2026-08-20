/**
 * Tests for scripts/dsh-pet-migrate-v2.mjs — the v1 -> v2 pet manifest
 * codemod (issue #623, milestone M2 P6). Unit tests cover the pure mapping;
 * integration tests run the codemod over fixture directories and validate
 * products through the package's authoritative parser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPetParser, migratePetManifestV1toV2 } from './dsh-pet-migrate-v2.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dsh-pet-migrate-v2.mjs')

function fixtureDir(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-migrate-'))
  writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n')
  return dir
}

const V1_FULL = {
  id: 'whale-girl',
  displayName: 'Whale Girl',
  description: 'A whale girl.',
  spritesheetPath: 'spritesheet.webp',
  cell: { width: 192, height: 208 },
  columns: 8,
  frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
  tracks: { idle: { durations: [400, 400] } },
  sequences: { idle: ['idle', 'waving', 'idle', 'waiting', 'idle'] },
  remarks: { tap: ['hi'] },
  spriteVersionNumber: 2,
}

test('maps the full v1 field set onto the v2 sprite2d shape', () => {
  const { manifest } = migratePetManifestV1toV2(V1_FULL, { license: 'CC0-1.0' })
  assert.equal(manifest.petManifestVersion, 2)
  assert.equal(manifest.renderer, 'sprite2d')
  assert.equal(manifest.license, 'CC0-1.0')
  assert.deepEqual(manifest.sprite2d, {
    spritesheetPath: 'spritesheet.webp',
    cell: { width: 192, height: 208 },
    columns: 8,
    frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    tracks: { idle: { durations: [400, 400] } },
    atlasRows: 11,
  })
  assert.equal(manifest.sprite2d.spritesheetPath, 'spritesheet.webp')
  assert.ok(!('spriteVersionNumber' in manifest), 'legacy version flag folded into atlasRows')
  assert.deepEqual(manifest.sequences, V1_FULL.sequences)
  assert.deepEqual(manifest.remarks, V1_FULL.remarks)
})

test('defaults a missing spritesheetPath to the contract default', () => {
  const { manifest } = migratePetManifestV1toV2({ id: 'bare', displayName: 'Bare' }, { license: 'CC0-1.0' })
  assert.equal(manifest.sprite2d.spritesheetPath, 'spritesheet.webp')
  assert.ok(!('atlasRows' in manifest.sprite2d), 'no atlasRows without spriteVersionNumber 2')
})

test('warns when no license is available from source or options', () => {
  const { manifest, warnings } = migratePetManifestV1toV2({ id: 'bare', displayName: 'Bare' })
  assert.equal(warnings.length, 1)
  assert.ok(!('license' in manifest))
})

test('keeps a source-declared license over the option', () => {
  const { manifest } = migratePetManifestV1toV2({ ...V1_FULL, license: 'MIT' }, { license: 'CC0-1.0' })
  assert.equal(manifest.license, 'MIT')
})

test('migration product passes the authoritative parser', async () => {
  const parsePetManifest = await loadPetParser()
  const { manifest } = migratePetManifestV1toV2(V1_FULL, { license: 'CC0-1.0' })
  const verdict = parsePetManifest(manifest, 'fixture')
  assert.equal(verdict.ok, true, JSON.stringify(verdict.ok ? [] : verdict.diagnostics))
  assert.equal(verdict.manifest.sprite2d.atlasRows, 11)
})

test('codemod dry-run prints the v2 manifest without writing', async () => {
  const dir = fixtureDir(V1_FULL)
  const out = execFileSync(process.execPath, [SCRIPT, dir, '--license', 'CC0-1.0'], { encoding: 'utf8' })
  assert.match(out, /"petManifestVersion": 2/)
  const onDisk = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf8'))
  assert.equal(onDisk.petManifestVersion, undefined, 'source untouched')
  assert.ok(!existsSync(join(dir, 'pet.json.v1.bak')))
})

test('codemod refuses a v1 manifest without any license source', () => {
  const dir = fixtureDir({ id: 'bare', displayName: 'Bare' })
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, dir, '--write'], { encoding: 'utf8', stdio: 'pipe' }),
    /warning|license|exit/i,
  )
  assert.ok(!existsSync(join(dir, 'pet.json.v1.bak')), 'no write on invalid product')
})

test('codemod --write migrates in place with a v1 backup', () => {
  const dir = fixtureDir(V1_FULL)
  execFileSync(process.execPath, [SCRIPT, dir, '--write', '--license', 'CC0-1.0'], { encoding: 'utf8' })
  const migrated = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf8'))
  assert.equal(migrated.petManifestVersion, 2)
  assert.equal(migrated.renderer, 'sprite2d')
  const backup = JSON.parse(readFileSync(join(dir, 'pet.json.v1.bak'), 'utf8'))
  assert.equal(backup.petManifestVersion, undefined, 'backup preserves the v1 source')
  // Re-running on the migrated file reports already-v2 and exits 0.
  const again = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.match(again, /already v2/)
})

test('codemod refuses to overwrite an existing backup without --force', () => {
  const dir = fixtureDir(V1_FULL)
  writeFileSync(join(dir, 'pet.json.v1.bak'), '{}')
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, dir, '--write', '--license', 'CC0-1.0'], { encoding: 'utf8', stdio: 'pipe' }))
})

test('migrating the real built-in pets yields valid v2 manifests', async (t) => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const parsePetManifest = await loadPetParser()
  for (const builtin of ['whale', 'whale-refined']) {
    const file = join(root, 'packages', 'dsh-pet', 'assets', builtin, 'pet.json')
    if (!existsSync(file)) continue
    const source = JSON.parse(readFileSync(file, 'utf8'))
    if (source.petManifestVersion !== undefined) continue // already migrated
    const { manifest } = migratePetManifestV1toV2(source, { license: 'CC0-1.0' })
    const verdict = parsePetManifest(manifest, file)
    assert.equal(verdict.ok, true, builtin + ': ' + JSON.stringify(verdict.ok ? [] : verdict.diagnostics))
  }
})
