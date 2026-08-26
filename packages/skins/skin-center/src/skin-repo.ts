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
 *
 * Scans are memoized per (builtinDir, userDir): a snapshot is reused until a
 * cheap fingerprint of both roots (skin-dir names plus skin.json stat)
 * changes, so client requests never rescan the same sources. The fingerprint
 * covers add/remove/change of any skin directory, while writes outside the
 * sources (POST /active state) never invalidate it.
 * @module @linxin666/dsh-client-ui-skin-center/skin-repo
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateSkinManifestV2 } from './core/manifest-v2/validate.ts'
import { auditTokenContract, type TokenAuditStylesheet } from './core/css-safety/token-audit.ts'
import type { SkinManifestV2 } from './core/manifest-v2/types.ts'
import { resolveHarnessHome } from './harness-home.ts'
import { verifyMarketProvenance, verifyReviewedLegacyHooks } from './provenance.ts'

export type SkinOrigin = 'builtin' | 'user'

export interface SkinCatalogEntry {
  /** Validated v2 manifest (immutable; do not mutate). */
  manifest: SkinManifestV2
  origin: SkinOrigin
  /** Absolute path of the skin asset directory. */
  dir: string
  /** Non-fatal notes (deprecated v1 fields ignored, shadowing, etc). */
  warnings: string[]
  /**
   * True when a user-directory skin's declared hooks identity matched
   * official-market provenance or the generated reviewed legacy identity at
   * snapshot time. The HTTP serving gate re-verifies current bytes. Built-in
   * skins are trusted by origin and never carry this flag.
   */
  hooksTrusted?: boolean
}

export interface SkinCatalogDiagnostic {
  /** Directory name or skin id the diagnostic is about. */
  subject: string
  origin: SkinOrigin
  errors: string[]
}

/** Read the manifest-referenced stylesheets for one skin directory. */
function stylesheetEntries(manifest: SkinManifestV2, dir: string): TokenAuditStylesheet[] {
  const entries: TokenAuditStylesheet[] = []
  const rels = [manifest.contributes.stylesheet, manifest.contributes.patches ?? null]
  for (const rel of rels) {
    if (!rel) continue
    const abs = join(dir, rel)
    if (existsSync(abs)) entries.push({ filename: rel, css: readFileSync(abs, 'utf8') })
  }
  return entries
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

/**
 * Shipped builtin skin ids: the npm package.json files whitelist entries
 * under `skins/` (the "<id>/" directory name). The published package
 * contains only these directories, so a builtin catalog directory outside
 * the set is a repository catalog source rather than an installed skin —
 * the settings catalog lists shipped builtins plus user dirs and leaves
 * the rest to the market store.
 */
export function shippedSkinIds(fromUrl: string = import.meta.url): Set<string> {
  try {
    const pkgPath = join(dirname(fileURLToPath(fromUrl)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { files?: unknown }
    const ids = new Set<string>()
    for (const f of Array.isArray(pkg.files) ? pkg.files : []) {
      if (typeof f !== 'string' || !f.startsWith('skins/')) continue
      const id = f.slice('skins/'.length).split('/')[0]
      if (id !== undefined && id !== '' && id !== '.') ids.add(id)
    }
    return ids
  } catch {
    return new Set<string>()
  }
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

/**
 * Hooks trust for one user-directory skin: official-market installs whose
 * skin.json and hooks entry hash-match recorded provenance run their hooks.
 * Historical Workshop installs from before provenance existed recover only
 * when both files match this release's generated reviewed identity. Anything
 * else keeps the refusal warning. Built-in skins never reach this — their
 * origin is the trust signal.
 */
function marketHooksTrust(manifest: SkinManifestV2, dir: string): { trusted: boolean; warning: string | null } {
  const facet = manifest.facets?.client
  if (!facet) return { trusted: false, warning: null }
  if (verifyMarketProvenance(dir, manifest.id, facet.entry)
    || verifyReviewedLegacyHooks(dir, manifest.id, facet.entry)) {
    return { trusted: true, warning: null }
  }
  return {
    trusted: false,
    warning: 'declares hooks.mjs, but hooks only run for built-in or byte-verified official-market (same-review) skins; the hooks facet will be refused',
  }
}

/** Re-evaluate the executable trust gate against the current on-disk bytes. */
export function canServeSkinHooks(entry: SkinCatalogEntry): boolean {
  if (entry.manifest.facets?.client === undefined) return false
  return entry.origin === 'builtin' || marketHooksTrust(entry.manifest, entry.dir).trusted
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
        const trust = marketHooksTrust(manifest, dir)
        if (trust.warning !== null) winnerWarnings.push(trust.warning)
        const winner: SkinCatalogEntry = {
          manifest,
          origin: 'user',
          dir,
          warnings: winnerWarnings,
          ...(trust.trusted ? { hooksTrusted: true } : {}),
        }
        claimed.set(manifest.id, winner)
        catalog.skins.push(winner)
      } else {
        existing.warnings.push(`duplicate ${spec.origin} id "${manifest.id}" ignored from ${dir}`)
      }
      continue
    }
    const warnings = [...result.warnings]
    const trust = spec.origin === 'user'
      ? marketHooksTrust(manifest, dir)
      : { trusted: false, warning: null }
    if (trust.warning !== null) warnings.push(trust.warning)
    // Token contract audit is warning-only (the loader completes partial
    // sets); surface it on the catalog so third-party skins show their gaps.
    const contractWarnings = auditTokenContract(stylesheetEntries(manifest, dir))
    warnings.push(...contractWarnings.warnings)
    const entry: SkinCatalogEntry = { manifest, origin: spec.origin, dir, warnings, ...(trust.trusted ? { hooksTrusted: true } : {}) }
    claimed.set(manifest.id, entry)
    catalog.skins.push(entry)
  }
}

/** One memoized catalog snapshot plus the fingerprint it was scanned under. */
export interface CatalogCacheEntry {
  /** Fingerprint of both roots at scan time (see rootFingerprint). */
  fingerprint: string
  catalog: SkinCatalog
}

/**
 * Process-wide cache: (builtinDir, userDir) -> latest snapshot. Shared by
 * every loadSkinCatalog caller in the host process (index tap, v2 routes,
 * seed). Tests inject their own Map through the catalogCache option.
 */
const DEFAULT_CATALOG_CACHE = new Map<string, CatalogCacheEntry>()

/** Bound the process cache so a long-lived process can never accumulate. */
const CATALOG_CACHE_MAX_ENTRIES = 16

/**
 * Cheap invalidation fingerprint of one catalog root: the sorted skin-dir
 * names plus the stat of each skin.json. The catalog content depends only on
 * skin.json, so this is the exact change signal — a new or removed skin dir
 * changes the name set, an in-place manifest change changes the stat. A
 * missing or unreadable root yields the same marker as an empty source,
 * mirroring collectSource's silent empty result.
 */
function rootFingerprint(root: string): string {
  let dirNames: string[]
  try {
    dirNames = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    return ''
  }
  const lines: string[] = []
  for (const dirName of dirNames) {
    const manifestPath = join(root, dirName, 'skin.json')
    try {
      const st = statSync(manifestPath)
      lines.push(JSON.stringify([dirName, st.mtimeMs, st.size, st.mode]))
    } catch {
      lines.push(JSON.stringify([dirName]))
    }
  }
  return lines.join('\n')
}

/**
 * Snapshot the skin catalog from both sources. Never throws: unreadable
 * roots and invalid skins land in diagnostics instead. When the source
 * fingerprint matches the last scan the memoized snapshot is returned as-is
 * (capturedAt re-stamped to the observation time); a changed fingerprint
 * triggers a fresh scan and updates the cache.
 */
export function loadSkinCatalog(options: {
  builtinDir?: string
  userDir?: string
  now?: () => number
  /** Explicit cache (tests); defaults to the process-wide cache. */
  catalogCache?: Map<string, CatalogCacheEntry>
} = {}): SkinCatalog {
  const builtinDir = options.builtinDir ?? builtinSkinsDir()
  const userDir = options.userDir ?? userSkinsDir()
  const cache = options.catalogCache ?? DEFAULT_CATALOG_CACHE
  const cacheKey = builtinDir + '\u0000' + userDir
  const fingerprint = JSON.stringify([rootFingerprint(builtinDir), rootFingerprint(userDir)])
  const hit = cache.get(cacheKey)
  if (hit && hit.fingerprint === fingerprint) {
    // Sources unchanged: reuse the immutable snapshot. Only capturedAt is
    // re-stamped so responses keep reflecting observation time; activation
    // state lives outside both roots (defaultActiveStatePath), so POST
    // /active never causes a rescan.
    return { ...hit.catalog, capturedAt: (options.now ?? Date.now)() }
  }
  const catalog: SkinCatalog = { skins: [], diagnostics: [], capturedAt: (options.now ?? Date.now)() }
  const claimed = new Map<string, SkinCatalogEntry>()
  // Builtin first so user entries can shadow them.
  collectSource({ origin: 'builtin', root: builtinDir }, catalog, claimed)
  collectSource({ origin: 'user', root: userDir }, catalog, claimed)
  // Unordered skins sort after every ordered one.
  catalog.skins.sort((a, b) => (a.manifest.order ?? Number.MAX_SAFE_INTEGER)
    - (b.manifest.order ?? Number.MAX_SAFE_INTEGER)
    || a.manifest.id.localeCompare(b.manifest.id))
  cache.set(cacheKey, { fingerprint, catalog })
  if (cache.size > CATALOG_CACHE_MAX_ENTRIES) cache.clear()
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
