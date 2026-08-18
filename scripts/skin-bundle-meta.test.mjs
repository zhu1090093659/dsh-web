/**
 * bundleWired:false skins must not declare dsh.bundle.patch. Otherwise
 * `dsh plugin` reconcile re-adds them to dsh.profile.bundles and they
 * collide with the home-layer insert (duplicate loader entry id).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skinsRoot = join(repoRoot, 'packages', 'skins')
const carrierRoot = join(repoRoot, 'packages', 'dsh-skins', 'skins')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('skin-center stays a real bundle; bundleWired:false skins omit dsh.bundle.patch', () => {
  const center = readJson(join(skinsRoot, 'skin-center', 'package.json'))
  assert.equal(center.dsh?.bundle?.patch, './cordis.patch.yml')

  const skins = readdirSync(skinsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'skin-center')
    .map((entry) => entry.name)

  assert.ok(skins.length > 0)
  for (const name of skins) {
    const skin = readJson(join(skinsRoot, name, 'skin.json'))
    const pkg = readJson(join(skinsRoot, name, 'package.json'))
    assert.equal(skin.wiring?.bundleWired, false, name)
    assert.equal(pkg.dsh?.bundle, undefined, name)
    const carrier = readJson(join(carrierRoot, name, 'package.json'))
    assert.equal(carrier.dsh?.bundle, undefined, `carrier ${name}`)
  }
})
