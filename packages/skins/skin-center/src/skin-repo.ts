/**
 * Skin repository (issue #506, M2): dual-source discovery of v2 skin asset
 * directories.
 *
 * Sources, in precedence order:
 *  1. user:   $DSH_HOME/skins/<id>/   (community / locally dropped skins)
 *  2. builtin: <skin-center package>/skins/<id>/  (shipped inside the one
 *     npm package; no per-skin packages, no boot graph, no cordis.patch.yml)
 *
 * A user directory with the same id shadows the built-in one (with a
 * catalog warning) — that is how a community skin overrides a bundled one
 * without touching node_modules.
 *
 * Fail-closed: a directory whose skin.json fails validateSkinManifestV2 is
 * excluded from the catalog and reported under diagnostics; it never loads.
 *
 * The catalog is an immutable snapshot: callers keep the object they got and
 * an activation never sees the catalog change underneath it (contract
 * section 8, "catalog immutable snapshot per activation").
 * @module @linxin666/dsh-client-ui-skin-center/skin-repo
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateSkinManifestV2 } from './core/manifest-v2/validate.ts'
import type { SkinManifestV2 } from './core/manifest-v2/types.ts'
import { resolveHarnessHome } from './harness-home.ts'

export type SkinOrigin = 'builtin' | 'user'

export interface SkinCatalogEntry {
  /** Validated v2 manifest (immutable; do not mutate). */
  manifest: SkinManifestV2
  origin: SkinOrigin
  /** Absolute path of the skin asset directory. */
  dir: string
  /** Non-fatal notes (deprecated v1 fields ignored, shadowing, etc). */
  warnings: string[]
}

export interface SkinCatalogDiagnostic {
  /** Directory name or skin id the diagnostic is about. */
  subject: string
  origin: SkinOrigin
  errors: string[]
}

export interface SkinCatalog {
  skins: SkinCatalogEntry[]
  diagnostics: SkinCatalogDiagnostic[]
  /** When the snapshot was taken (ms since epoch). */
  capturedAt: number
}

/** Built-in skins ship inside the skin-center package under skins/. */
export function builtinSkinsDir(fromUrl: string = import.meta.url): string {
  // src/skin-repo.ts -> package root is one level up from src/.
  return join(dirname(fileURLToPath(fromUrl)), '..', 'skins')
}

/** User skins live in $DSH_HOME/skins with explicit directory overrides. */
export function userSkinsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_SKINS_HOME
  if (home && home.trim() !== '') return resolvePath(home)
  const dir = env.DSH_SKINS_DIR
  if (dir && dir.trim() !== '') return resolvePath(dir)
  return join(resolveHarnessHome(undefined, env), 'skins')
}

function readManifest(dir: string): unknown | null {
  const manifestPath = join(dir, 'skin.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

interface SourceSpec {
  origin: SkinOrigin
  root: string
}

function collectSource(spec: SourceSpec, catalog: SkinCatalog, claimed: Map<string, SkinCatalogEntry>): void {
  if (!existsSync(spec.root)) return
  let dirNames: string[]
  try {
    dirNames = readdirSync(spec.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    return
  }
  for (const dirName of dirNames) {
    const dir = join(spec.root, dirName)
    const raw = readManifest(dir)
    if (raw === null) {
      catalog.diagnostics.push({
        subject: dirName,
        origin: spec.origin,
        errors: ['skin.json missing or not valid JSON'],
      })
      continue
    }
    const result = validateSkinManifestV2(raw)
    if (!result.ok || !result.manifest) {
      catalog.diagnostics.push({ subject: dirName, origin: spec.origin, errors: result.errors })
      continue
    }
    const manifest = result.manifest
    if (manifest.id !== dirName) {
      catalog.diagnostics.push({
        subject: dirName,
        origin: spec.origin,
        errors: [`manifest id "${manifest.id}" must equal the directory name "${dirName}"`],
      })
      continue
    }
    const existing = claimed.get(manifest.id)
    if (existing) {
      if (spec.origin === 'user' && existing.origin === 'builtin') {
        // User shadows builtin: replace and note it on the winning entry.
        catalog.skins = catalog.skins.filter((s) => s !== existing)
        const winnerWarnings = [...result.warnings, `shadows the built-in "${manifest.id}" skin`]
        if (manifest.facets?.client) {
          winnerWarnings.push('declares hooks.mjs, but hooks only run for built-in (same-review) skins; the hooks facet will be refused')
        }
        const winner: SkinCatalogEntry = {
          manifest,
          origin: 'user',
          dir,
          warnings: winnerWarnings,
        }
        claimed.set(manifest.id, winner)
        catalog.skins.push(winner)
      } else {
        existing.warnings.push(`duplicate ${spec.origin} id "${manifest.id}" ignored from ${dir}`)
      }
      continue
    }
    const warnings = [...result.warnings]
    if (spec.origin === 'user' && manifest.facets?.client) {
      warnings.push('declares hooks.mjs, but hooks only run for built-in (same-review) skins; the hooks facet will be refused')
    }
    const entry: SkinCatalogEntry = { manifest, origin: spec.origin, dir, warnings }
    claimed.set(manifest.id, entry)
    catalog.skins.push(entry)
  }
}

/**
 * Snapshot the skin catalog from both sources. Never throws: unreadable
 * roots and invalid skins land in diagnostics instead.
 */
export function loadSkinCatalog(options: {
  builtinDir?: string
  userDir?: string
  now?: () => number
} = {}): SkinCatalog {
  const catalog: SkinCatalog = { skins: [], diagnostics: [], capturedAt: (options.now ?? Date.now)() }
  const claimed = new Map<string, SkinCatalogEntry>()
  // Builtin first so user entries can shadow them.
  collectSource({ origin: 'builtin', root: options.builtinDir ?? builtinSkinsDir() }, catalog, claimed)
  collectSource({ origin: 'user', root: options.userDir ?? userSkinsDir() }, catalog, claimed)
  // Unordered skins sort after every ordered one.
  catalog.skins.sort((a, b) => (a.manifest.order ?? Number.MAX_SAFE_INTEGER)
    - (b.manifest.order ?? Number.MAX_SAFE_INTEGER)
    || a.manifest.id.localeCompare(b.manifest.id))
  return catalog
}

/** Find one skin in a snapshot by id. */
export function findSkin(catalog: SkinCatalog, id: string): SkinCatalogEntry | null {
  return catalog.skins.find((s) => s.manifest.id === id) ?? null
}

/**
 * Resolve a file inside a skin directory, refusing any escape. Returns null
 * when the resolved path leaves the skin root.
 */
export function resolveInsideSkin(entry: SkinCatalogEntry, relPath: string): string | null {
  const abs = resolvePath(entry.dir, relPath)
  const root = resolvePath(entry.dir)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(rootWithSep)) return null
  return abs
}
