import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Assemble a true clean-checkout fixture: tracking-tree inputs only, no
 * market/shell/dist (the vendored shell build is git-ignored and CI does not
 * rebuild it). market-build --check in such a tree must succeed after the
 * dist was committed by the same sources, and must still reject tampering.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-clean-'))
  const pairs = [
    [join(ROOT, 'scripts', 'market-build'), join(dir, 'scripts', 'market-build')],
    [join(ROOT, 'market', 'src'), join(dir, 'market', 'src')],
    [join(ROOT, 'market', 'dist'), join(dir, 'market', 'dist')],
    [join(ROOT, 'packages', 'skins', 'skin-center', 'skins'), join(dir, 'packages', 'skins', 'skin-center', 'skins')],
    [join(ROOT, 'packages', 'skins', 'skin-center', 'lib', 'index.js'), join(dir, 'packages', 'skins', 'skin-center', 'lib', 'index.js')],
    [join(ROOT, 'packages', 'dsh-pet', 'assets'), join(dir, 'packages', 'dsh-pet', 'assets')],
    [join(ROOT, 'packages', 'dsh-community-plugins', 'community.json'), join(dir, 'packages', 'dsh-community-plugins', 'community.json')],
  ]
  for (const [from, to] of pairs) {
    mkdirSync(join(to, '..'), { recursive: true })
    cpSync(from, to, { recursive: true })
  }
  // Resolve the skin-center lib imports exactly as a pnpm checkout would.
  symlinkSync(join(ROOT, 'packages', 'skins', 'skin-center', 'node_modules'),
    join(dir, 'packages', 'skins', 'skin-center', 'node_modules'))
  return dir
}

function runCheck(dir) {
  return spawnSync(process.execPath, ['scripts/market-build', '--check'], { cwd: dir, encoding: 'utf8' })
}

test('clean checkout (no shell dist) passes market-build --check', () => {
  const dir = fixture()
  try {
    const result = runCheck(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /dist up to date/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check refuses tampered tryon-assets output', () => {
  const dir = fixture()
  try {
    appendFileSync(join(dir, 'market', 'dist', 'tryon-assets', 'skins', 'blue-fantasy', 'skin.css'), '\ntampered{}')
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /tryon-assets\/skins\/blue-fantasy\/skin\.css/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check rejects undeclared files inside the committed tryon dir', () => {
  const dir = fixture()
  try {
    writeFileSync(join(dir, 'market', 'dist', 'tryon', 'rogue.js'), 'rogue')
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /extra: rogue\.js/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
