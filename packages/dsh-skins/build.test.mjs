import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncDir } from './build.mjs'

test('carrier preserves component license and attribution without dsh.bundle', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skins-build-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const source = path.join(root, 'source')
  const output = path.join(root, 'output')
  const skin = path.join(source, 'licensed-skin')
  fs.mkdirSync(path.join(skin, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(skin, 'skin.json'), JSON.stringify({ id: 'licensed-skin' }))
  fs.writeFileSync(path.join(skin, 'lib', 'client.js'), 'client')
  fs.writeFileSync(path.join(skin, 'lib', 'index.js'), 'host')
  fs.writeFileSync(path.join(skin, 'package.json'), JSON.stringify({
    name: '@example/licensed-skin',
    version: '1.2.3',
    license: 'CC-BY-NC-SA-4.0',
  }))
  fs.writeFileSync(path.join(skin, 'LICENSE'), 'license text')
  fs.writeFileSync(path.join(skin, 'NOTICE'), 'attribution text')

  syncDir(source, output)

  const carrier = path.join(output, 'licensed-skin')
  const manifest = JSON.parse(fs.readFileSync(path.join(carrier, 'package.json'), 'utf8'))
  assert.equal(manifest.license, 'CC-BY-NC-SA-4.0')
  assert.deepEqual(manifest.dsh, { client: { inject: [], platform: 'web' } })
  assert.equal(fs.readFileSync(path.join(carrier, 'LICENSE'), 'utf8'), 'license text')
  assert.equal(fs.readFileSync(path.join(carrier, 'NOTICE'), 'utf8'), 'attribution text')
})
