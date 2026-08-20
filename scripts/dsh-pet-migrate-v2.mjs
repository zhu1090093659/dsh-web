#!/usr/bin/env node
/**
 * dsh-pet-migrate-v2 — one-shot codemod: migrate a v1 pet directory (pet.json
 * without petManifestVersion) onto the pet-center v2 manifest contract
 * (issue #623, milestone M2 P6).
 *
 * Usage:
 *   node scripts/dsh-pet-migrate-v2.mjs <petDir>              # dry-run report
 *   node scripts/dsh-pet-migrate-v2.mjs <petDir> --check      # validate only
 *   node scripts/dsh-pet-migrate-v2.mjs <petDir> --write      # in-place; keeps pet.json.v1.bak
 *
 * Options:
 *   --license <id>   license identifier for the v2 manifest (required when the
 *                    v1 source declares none; v2 requires license)
 *   --author <name>  optional author carried into the v2 manifest
 *   --force          allow overwriting an existing pet.json.v1.bak
 *
 * The mapping (M1 §4): petManifestVersion/renderer are filled in; the flat
 * v1 atlas fields (spritesheetPath/cell/columns/frames/tracks) nest into the
 * sprite2d block; spriteVersionNumber 2 becomes sprite2d.atlasRows 11;
 * id/displayName/description/version/sequences/remarks carry over verbatim.
 *
 * The codemod validates its product through the package's authoritative
 * parser (packages/dsh-pet/src/manifest-v2.ts) and refuses to write output
 * that fails validation. With --write the original pet.json is kept as
 * pet.json.v1.bak; without it the source directory is never modified.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PARSER_URL = pathToFileURL(join(SCRIPT_DIR, '..', 'packages', 'dsh-pet', 'src', 'manifest-v2.ts')).href

/** Load the package's authoritative manifest parser (type-stripped TS). */
export async function loadPetParser() {
  const mod = await import(PARSER_URL)
  return mod.parsePetManifest
}

/**
 * Map a v1 manifest onto the v2 shape. Pure; never mutates the source.
 * @param {Record<string, unknown>} source - the parsed v1 pet.json.
 * @param {{ license?: string, author?: string }} [options]
 * @returns {{ manifest: Record<string, unknown>, warnings: string[] }}
 */
export function migratePetManifestV1toV2(source, options = {}) {
  const warnings = []
  const sprite2d = {}
  if (typeof source.spritesheetPath === 'string' && source.spritesheetPath.trim() !== '') {
    sprite2d.spritesheetPath = source.spritesheetPath.trim()
  } else {
    sprite2d.spritesheetPath = 'spritesheet.webp'
  }
  if (typeof source.cell === 'object' && source.cell !== null) sprite2d.cell = source.cell
  if (typeof source.columns === 'number') sprite2d.columns = source.columns
  if (Array.isArray(source.frames)) sprite2d.frames = source.frames
  if (typeof source.tracks === 'object' && source.tracks !== null) sprite2d.tracks = source.tracks
  // v2 spritesheet atlases (spriteVersionNumber 2) hold 11 rows: 9 + 2 look rows.
  if (source.spriteVersionNumber === 2) sprite2d.atlasRows = 11

  const license = typeof source.license === 'string' && source.license.trim() !== ''
    ? source.license.trim()
    : options.license
  if (license === undefined) {
    warnings.push('v1 manifest declares no license; pass --license <id> (v2 requires it)')
  }
  const manifest = {
    petManifestVersion: 2,
    id: source.id,
    displayName: source.displayName,
    renderer: 'sprite2d',
    sprite2d,
  }
  if (typeof source.description === 'string' && source.description !== '') manifest.description = source.description
  if (typeof source.version === 'string') manifest.version = source.version
  if (typeof source.author === 'string') manifest.author = source.author
  else if (options.author !== undefined) manifest.author = options.author
  if (license !== undefined) manifest.license = license
  if (source.sequences !== undefined) manifest.sequences = source.sequences
  if (source.remarks !== undefined) manifest.remarks = source.remarks
  return { manifest, warnings }
}

function usage() {
  console.log('usage: node scripts/dsh-pet-migrate-v2.mjs <petDir> [--check|--write] [--license <id>] [--author <name>] [--force]')
}

async function main(argv) {
  const args = [...argv]
  const petDir = args.find(a => !a.startsWith('--'))
  if (petDir === undefined) {
    usage()
    return 2
  }
  const write = args.includes('--write')
  const force = args.includes('--force')
  const flagValue = (name) => {
    const index = args.indexOf(name)
    return index !== -1 ? args[index + 1] : undefined
  }
  const dir = resolvePath(petDir)
  const file = join(dir, 'pet.json')
  if (!existsSync(file)) {
    console.error('no pet.json in ' + dir)
    return 1
  }
  const source = JSON.parse(readFileSync(file, 'utf8'))
  const parsePetManifest = await loadPetParser()
  if (source.petManifestVersion !== undefined) {
    const verdict = parsePetManifest(source, file)
    console.log(verdict.ok ? 'already v2: manifest validates, nothing to do' : 'already v2 but INVALID:')
    if (!verdict.ok) for (const d of verdict.diagnostics) console.error('  [' + d.level + '] ' + d.message)
    return verdict.ok ? 0 : 1
  }
  const { manifest, warnings } = migratePetManifestV1toV2(source, {
    license: flagValue('--license'),
    author: flagValue('--author'),
  })
  for (const warning of warnings) console.warn('warning: ' + warning)
  const verdict = parsePetManifest(manifest, file + ' (migrated)')
  if (!verdict.ok) {
    console.error('migration product failed validation; nothing written:')
    for (const d of verdict.diagnostics) console.error('  [' + d.level + '] ' + d.message)
    return 1
  }
  for (const d of verdict.diagnostics) console.warn('  [' + d.level + '] ' + d.message)
  if (!write) {
    console.log(JSON.stringify(manifest, null, 2))
    console.log(warnings.length > 0 ? 'dry-run: valid but unresolved warnings above; --write to apply' : 'dry-run: valid; --write to apply')
    return warnings.length > 0 ? 1 : 0
  }
  const backup = file + '.v1.bak'
  if (existsSync(backup) && !force) {
    console.error(backup + ' already exists; pass --force to overwrite')
    return 1
  }
  copyFileSync(file, backup)
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  console.log('migrated: ' + file + ' (backup at ' + backup + ')')
  return 0
}

const invokedAsScript = process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
