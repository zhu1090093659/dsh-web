import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildCompatibilityShims, LEGACY_SKIN_IDS } from './build.mjs'

test('builds resolvable no-op packages for every retired v1 skin junction', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-skins-shims-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  buildCompatibilityShims(out)

  for (const id of LEGACY_SKIN_IDS) {
    const dir = join(out, id)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.name, `@linxin666/dsh-client-ui-skin-${id}`)
    assert.equal(typeof (await import(join(dir, 'lib', 'index.js'))).apply, 'function')
    assert.match(readFileSync(join(dir, 'lib', 'client.js'), 'utf8'), new RegExp(`skin-${id}`))
  }

  const link = join(out, 'node_modules', '@linxin666', 'dsh-client-ui-skin-whale-song')
  mkdirSync(join(link, '..'), { recursive: true })
  symlinkSync(join(out, 'whale-song'), link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(typeof (await import(join(link, 'lib', 'index.js'))).apply, 'function')
})
