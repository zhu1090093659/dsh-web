import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INSTALLER = join(ROOT, 'packages', 'dsh-market', 'src', 'core', 'installer.ts')

/** The installer's per-asset cap, read exactly the way market-build reads it. */
function installerMaxFiles() {
  const m = /export const MAX_FILES_PER_ASSET = (\d+)/.exec(readFileSync(INSTALLER, 'utf8'))
  assert.ok(m, 'installer.ts must export MAX_FILES_PER_ASSET')
  return Number(m[1])
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

/**
 * Minimal build tree: the real market-build script, one valid skin, and a
 * stand-in installer source carrying the cap under test. The policy gate runs
 * on source data only, so this fixture needs no generated build inputs.
 */
function fixture(maxFiles, extraSkinFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-cap-'))
  const scriptDir = join(dir, 'scripts')
  mkdirSync(scriptDir, { recursive: true })
  const script = join(scriptDir, 'market-build')
  writeFileSync(script, readFileSync(join(ROOT, 'scripts', 'market-build')))
  const installerDir = join(dir, 'packages', 'dsh-market', 'src', 'core')
  mkdirSync(installerDir, { recursive: true })
  writeFileSync(join(installerDir, 'installer.ts'), 'export const MAX_FILES_PER_ASSET = ' + maxFiles + '\n')
  const skinDir = join(dir, 'packages', 'skins', 'skin-center', 'skins', 'fixture-skin')
  mkdirSync(skinDir, { recursive: true })
  writeFileSync(join(skinDir, 'skin.json'), JSON.stringify({
    skinManifestVersion: 2,
    id: 'fixture-skin',
    name: 'Fixture',
    nameEn: 'Fixture',
    author: 'fixture',
    version: '1.0.0',
    accent: '#000000',
    preview: { light: 'preview-light.png', dark: 'preview-dark.png' },
  }))
  writeFileSync(join(skinDir, 'preview-light.png'), PNG)
  writeFileSync(join(skinDir, 'preview-dark.png'), PNG)
  for (let i = 0; i < extraSkinFiles; i++) writeFileSync(join(skinDir, 'f' + i + '.png'), PNG)
  return { dir, script }
}

function runCheck(dir, script) {
  return spawnSync(process.execPath, [script, '--check'], { cwd: dir, encoding: 'utf8' })
}

test('installer cap clears the largest published pet asset', () => {
  const max = installerMaxFiles()
  assert.ok(max >= 1565, 'cap must clear the published jyn asset (1565 files), got ' + max)
})

test('market-build reads the installer cap and accepts a catalog within it', () => {
  // skin.json + two previews + one extra = 4 files, inside a cap of 10.
  const { dir, script } = fixture(10, 1)
  try {
    const result = runCheck(dir, script)
    assert.ok(!/installer limit/.test(result.stderr), result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('market-build rejects a catalog asset over the installer cap', () => {
  // The same 4-file skin crosses a cap of 3.
  const { dir, script } = fixture(3, 1)
  try {
    const result = runCheck(dir, script)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /fixture-skin: declares 4 files, over the installer limit of 3/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
