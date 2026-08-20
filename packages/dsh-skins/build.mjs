#!/usr/bin/env node
/** Generate no-op leaf packages for paths used by retired v1 skin junctions. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const carrierVersion = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version

export const LEGACY_SKIN_IDS = [
  'blue-fantasy',
  'dragon-heir',
  'harbor',
  'maid-atelier',
  'matrix',
  'miku',
  'minecraft',
  'trading',
  'whale-mom',
  'whale-song',
  'xp',
]

export function renderPackageJson(id) {
  return JSON.stringify({
    name: `@linxin666/dsh-client-ui-skin-${id}`,
    version: carrierVersion,
    description: `No-op compatibility shim for the retired ${id} skin package.`,
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    dsh: { client: { inject: [], platform: 'web' } },
    license: 'Apache-2.0',
  }, null, 2) + '\n'
}

export function buildCompatibilityShims(outDir = join(here, 'skins')) {
  rmSync(outDir, { recursive: true, force: true })
  for (const id of LEGACY_SKIN_IDS) {
    const dir = join(outDir, id)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), renderPackageJson(id))
    writeFileSync(join(dir, 'lib', 'index.js'), '/** Retired v1 skin compatibility shim. */\nexport function apply() {}\n')
    writeFileSync(join(dir, 'lib', 'client.js'), `window.__ModuleLoader__.load({\n  id: "@linxin666/dsh-client-ui-skin-${id}",\n  factory: () => ({ apply() {} }),\n});\n`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildCompatibilityShims()
  console.log(`dsh-skins build: generated ${LEGACY_SKIN_IDS.length} legacy compatibility shims`)
}
