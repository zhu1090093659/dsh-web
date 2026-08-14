#!/usr/bin/env node
/**
 * Bundle every skin INTO the dsh-skins aggregate package so npm installs
 * need no per-skin packages (npm charges per new package name - the family
 * keeps future skins inside this one existing package).
 *
 * For each packages/skins/<id> with a skin.json, copies into
 * packages/dsh-skins/skins/<id>/:
 *   - skin.json (registry metadata)
 *   - lib/client.js (try-on bundle, served by /api/skin-center/bundle/<id>)
 *   - lib/index.js (the skin's host entry, a trivial apply(){} - Cordis
 *     needs a resolvable main for the boot-graph insert row)
 *   - package.json (generated minimal leaf package so the profile symlink /
 *     profile node_modules can resolve @linxin666/dsh-client-ui-skin-<id>)
 *   - cordis.patch.yml (the skin's own patch row, for `dsh plugin add`)
 * Directories without a skin.json (skin-center itself, workspace
 * scaffolding) are skipped.
 *
 * Without the package.json + host entry, an npm install of the aggregate
 * leaves skin dirs that the skin-center's useSkin insert row cannot resolve
 * (MODULE_NOT_FOUND .../dsh-client-ui-skin-<id>/package.json) even though the
 * patch and the profile symlink were written - the boot then fails after the
 * apply already reported ok:true.
 *
 * Re-run whenever a skin is added/changed, then rebuild:
 *   pnpm --filter @linxin666/dsh-skins build
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const SOURCE_DIR = path.join(ROOT, 'packages', 'skins')
const OUT_DIR = path.join(__dirname, 'skins')

/** Read and parse a JSON file, returning null when missing/unreadable. */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Render the minimal resolvable leaf package.json a bundled skin needs to be
 * loadable as @linxin666/dsh-client-ui-skin-<id> from the profile. Mirrors the
 * source skin package's exports shape (minus the non-shipped ./src/*) and
 * carries the official dsh.bundle manifest so the carrier is also a valid
 * turtle-ui bundle for `dsh plugin add`.
 * @param sourcePkg - the source skin package.json (name/version source).
 * @returns the serialized package.json text.
 */
function renderCarrierPackageJson(sourcePkg) {
  const pkg = {
    name: sourcePkg.name,
    version: sourcePkg.version,
    description: 'Bundled skin inside @linxin666/dsh-skins (' + sourcePkg.name + ').',
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { inject: [], platform: 'web' },
    },
    license: 'BSD-3-Clause',
    files: ['lib', 'skin.json', 'cordis.patch.yml'],
    repository: { type: 'git', url: 'https://github.com/zhu1090093659/dsh-web-ui.git' },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function syncDir(src, dst) {
  // Render into a staging dir first, then atomically swap it into place, so
  // a failed/mid-way run never leaves dst half-written and never silently
  // drops committed assets that disappeared from the source set.
  const staging = dst + '.staging'
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  const built = new Set()
  for (const dir of fs.readdirSync(src)) {
    const srcDir = path.join(src, dir)
    const skinJson = path.join(srcDir, 'skin.json')
    if (!fs.statSync(skinJson, { throwIfNoEntry: false })) continue
    const bundle = path.join(srcDir, 'lib', 'client.js')
    if (!fs.statSync(bundle, { throwIfNoEntry: false })) {
      console.warn('skipped skin (missing lib/client.js, build the bundle first):', dir)
      continue
    }
    const hostEntry = path.join(srcDir, 'lib', 'index.js')
    if (!fs.statSync(hostEntry, { throwIfNoEntry: false })) {
      console.warn('skipped skin (missing lib/index.js, build the host entry first):', dir)
      continue
    }
    const sourcePkg = readJson(path.join(srcDir, 'package.json'))
    if (sourcePkg === null || typeof sourcePkg.name !== 'string') {
      console.warn('skipped skin (missing or invalid package.json):', dir)
      continue
    }
    const patch = path.join(srcDir, 'cordis.patch.yml')
    if (!fs.statSync(patch, { throwIfNoEntry: false })) {
      console.warn('skipped skin (missing cordis.patch.yml):', dir)
      continue
    }
    const target = path.join(staging, dir)
    fs.mkdirSync(path.join(target, 'lib'), { recursive: true })
    fs.copyFileSync(skinJson, path.join(target, 'skin.json'))
    fs.copyFileSync(bundle, path.join(target, 'lib', 'client.js'))
    fs.copyFileSync(hostEntry, path.join(target, 'lib', 'index.js'))
    fs.copyFileSync(patch, path.join(target, 'cordis.patch.yml'))
    fs.writeFileSync(path.join(target, 'package.json'), renderCarrierPackageJson(sourcePkg))
    built.add(dir)
    console.log('bundled skin:', dir)
  }
  // Warn about committed dst entries that the source set no longer produces,
  // so removals are explicit rather than silent (and are re-added on next run
  // should the source reappear).
  if (fs.existsSync(dst)) {
    for (const dir of fs.readdirSync(dst)) {
      if (!built.has(dir)) console.warn('will be removed from dst (not in source set):', dir)
    }
  }
  fs.rmSync(dst, { recursive: true, force: true })
  fs.renameSync(staging, dst)
}

syncDir(SOURCE_DIR, OUT_DIR)
console.log('dsh-skins bundled skins ->', OUT_DIR)
