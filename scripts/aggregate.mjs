#!/usr/bin/env node
/**
 * Aggregate plugin generator for the dsh-web monorepo.
 *
 * An aggregate bundle is a plain carrier package whose cordis.patch.yml is the
 * concatenation of its child plugins' insert rows and whose package.json
 * dependencies pull in every child with "workspace:*". The DSH loader
 * resolves patch rows from the profile root, so the children are installed as
 * normal dependencies (pnpm hoists them to the top level in the default
 * hoisted layout); the README documents the hoist setting for strict-layout
 * profiles.
 *
 * Usage:
 *   node scripts/aggregate.mjs            # regenerate + write everything
 *   node scripts/aggregate.mjs --check    # verify only; exit 1 on any drift
 *
 * Each aggregate package carries a hand-written aggregate.yml manifest:
 *
 *   patchFrom:
 *     - ../skins/skin-center
 *   deps:
 *     - ../skins/skin-center
 *     - ../skins/xp
 *   rows:
 *     - {"id": "external-id", "name": "some-external-plugin"}
 *
 *   - patchFrom entries contribute their child's cordis.patch.yml insert rows
 *     to the aggregate patch (nested aggregates expand recursively, in
 *     patchFrom order, with per-source comment headers);
 *   - deps entries are resolved to each child's package.json "name" and
 *     written into the aggregate's dependencies as "workspace:*";
 *   - rows entries (single-line JSON flow mappings) are EXTERNAL plugin rows
 *     for npm packages outside this repo (the row's `name` resolves from the
 *     profile root like any child); they are emitted after the patchFrom
 *     blocks, with their id namespaced like every other row. A row whose
 *     package declares `dsh.bundle` is expanded: its cordis.patch.yml is
 *     parsed with the same row rules, insert rows are emitted under their
 *     namespaced aggregate id (their `name` is a real importable plugin
 *     package), and bundle-level bare rows stay verbatim patches.
 *   - patches entries (single-line JSON flow mappings) are CONFIG-OVERRIDE
 *     patches for this aggregate's OWN inserted rows (single-object form:
 *     {"id", "config"}; id must be a namespaced aggregate row id, config is
 *     written verbatim as inline YAML flow). They emit after all inserts so
 *     later patches can target earlier rows; use them to seed per-row defaults
 *     (e.g. enabled:false) without touching the standalone package distribution.
 *   - inactive entries (plain row-id strings) mark OWN inserted rows that ship
 *     DISABLED by default: each renders a trailing bare "disabled: true"
 *     override after all inserts. New installs leave the row unmounted (its
 *     settings entries stay off the page via the rows-route gating); users
 *     opt in per row in the plugin manager, whose enable writes a user-layer
 *     "disabled: false" override that wins over the bundle default.
 *   - familyIds entries ("<child row id>: <aggregate row id>" mapping lines) pin
 *     the aggregate row id one child is mounted under when the derived id would
 *     move a published identifier. A child that must change its OWN standalone
 *     row id (a standalone install claims the global loader id space, so an id
 *     another bundle already takes is a silent row loss) would otherwise drag
 *     the aggregate row id and its family subpath export along with it. The
 *     override must name a row this aggregate really mounts and must stay in
 *     the web-ui-* id space; the derived id remains the default for every row.
 *   - retire entries (plain row-id strings) mark FOREIGN rows this aggregate
 *     supersedes: each renders a trailing bare "disabled: true" override
 *     naming the id verbatim (no namespace), so a row another bundle inserted
 *     earlier in the profile stops mounting while this aggregate's own row
 *     takes its place. Use it when the native implementation owns the entry a
 *     family plugin supersedes, and the composition must not show two
 *     near-identical first-level entries. A row listed here must NOT be one of
 *     this aggregate's own rows (that is what inactive is for); a user-layer
 *     "disabled: false" override still wins.
 *   - shellNotes entries (single-line JSON flow mappings) carry each family
 *     row's one-line purpose text, the gray line the official plugin inventory
 *     renders under the row title: {"id": "<family subpath>", "zh", "en", "ru"}.
 *     They are written into shell-metadata/<sub>/locale/<lang>.json as
 *     meta.description, the same channel that carries the row title. The
 *     section is the only source for that text: every family subpath the
 *     aggregate exports (tombstones included) needs an entry, and a missing,
 *     unknown, or duplicate id fails the run instead of shipping a row with no
 *     visible purpose.
 *   - retiredPlugins entries (single-line JSON flow mappings) are the shell's
 *     retirement registry: {"family": "<tombstone subpath>", "plugin": "<real
 *     package name>"} for every family plugin that was removed while its row
 *     may still sit in an older profile. They are written as a generated module
 *     (src/retired-plugins.generated.ts) the shell imports, so the list of
 *     no-op specifiers has one source; the hand-written copy beside it drifted
 *     and reported a normal retirement as a degraded plugin. A family must be a
 *     tombstone (its subpath export has to stay alive for those old rows) and
 *     its plugin must not also be a dependency; both are hard errors.
 *
 * Idempotent: safe to rerun at any time. Writes only inside the aggregate
 * packages it owns; never touches other packages or git state.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(SCRIPT_DIR, '..')
const CHECK = process.argv.includes('--check')
const require = createRequire(join(REPO_ROOT, 'package.json'))

/**
 * Namespace one child row id for the aggregate patch. The bundle prefix
 * (web-ui-) keeps every aggregate row distinct from its standalone package's
 * own id, so installing both no longer trips the loader's duplicate-entry
 * check. Idempotent for ids that already carry the prefix.
 */
function namespaceId(id) {
  if (id.startsWith('web-ui-')) return id
  return `web-ui-${id.replace(/^(ui-|web-ui-)+/, '')}`
}

/**
 * The aggregate row id one child row is mounted under: the family's declared
 * override when the manifest pins one, otherwise the derived namespaced id.
 * @param id - the child package's own insert row id.
 * @param familyIds - the manifest's familyIds mapping.
 * @returns the aggregate row id.
 */
function familyIdOf(id, familyIds) {
  return familyIds[id] ?? namespaceId(id)
}

const PATCH_HEADER = [
  '# AUTO-GENERATED by scripts/aggregate.mjs — do not edit',
  '# This file is derived from the aggregate.yml manifest in this package;',
  '# edit aggregate.yml and rerun `node scripts/aggregate.mjs`.',
  '# Rows are namespaced web-ui-* so the bundle can coexist with standalone installs.',
  '# Family rows mount the real plugin package: the loader then serves that package\'s',
  '# own browser half, and one family switch is one loader switch.',
]

/**
 * This package's own name. It is still the row the compat shim mounts (the
 * `self` manifest entry) and the package the retirement registry and the
 * family subpaths belong to, but it is no longer the mount point of the
 * family rows themselves: those name their real packages (issue #1901).
 *
 * History that still explains the shell code: family rows used to mount a
 * per-family subpath of this package and carry the real package in
 * `config.plugin`, so that a family plugin failing to import could not roll
 * back the whole boot group. That bought fault isolation at the cost of the
 * family browser halves: the official client module scanner only mounts a
 * client face on the entry whose name equals the package, so every family UI
 * had to be inlined into this package's own ./client bundle — 13 plugins,
 * 2.9 MB served to every page before any family surface could render. The
 * rows now mount the real packages and the browser halves come from their
 * own loader entries; the isolation trade is recorded in
 * [aggregate family rows mount real packages]
 * (.agents/notes/implemented/architecture/2026-10-18-aggregate-family-rows-mount-real-packages.md).
 * The shell module itself stays: a profile written before this change still
 * records `@linxin666/dsh-web-all/<family>` row names, and those subpath
 * exports keep resolving to it.
 */
const AGGREGATE_SHELL_PACKAGE = '@linxin666/dsh-web-all'

/**
 * Every family subpath export resolves to the shared shell re-export module
 * (src/shells/shell.ts): the subpath is a display label, the mount contract
 * lives entirely in the row config. The target must sit under lib/shells/ —
 * the client module scanner walks up from the imported module to the nearest
 * package.json, and the marker manifest beside it (src/shells/package.json,
 * copied to lib/shells/ by the build) stops that walk before it reaches the
 * package root, whose dsh.client face belongs to the compat row alone.
 */
const SHELL_EXPORT_TARGET = './lib/shells/shell.js'
const SHELL_ICON_TARGET = './icon.svg'
const SHELL_METADATA_DIR = 'shell-metadata'
/**
 * Languages every family subpath ships display metadata in. The host reader
 * (@deepseek-ai/dsh-app-boot readPluginMeta -> dictionariesOf) enumerates the
 * whole <specifier>/locale directory and keys every "*.json" by its filename,
 * so a language is supported as soon as its file exists: en and zh are the
 * host's own languages, and ru rides the dsh-i18n language pack this aggregate
 * mounts (id "ru", fallback en).
 */
const SHELL_METADATA_LOCALES = ['en', 'ru', 'zh']

/** Longest Chinese note the inventory can render on one line under a row title. */
const SHELL_NOTE_MAX_HAN = 20

/**
 * Files the official plugin metadata reader resolves for one family subpath.
 * DSH 0.2.1 no longer reads a subpath's nearest package.json: display text
 * comes from `<specifier>/locale/<lang>.json`, and the icon from
 * `<specifier>/icon`. The generator owns this tree so removed families do not
 * leave stale display resources behind. The title is the row label; the
 * description is the gray purpose line rendered right under it.
 */
function shellMetadataFiles(pkgDir, shellSubpaths, notes) {
  return shellSubpaths.flatMap((sub) => SHELL_METADATA_LOCALES.map((locale) => {
    const meta = { title: `web-all/${sub}` }
    const description = notes.get(sub)?.[locale]
    if (description !== undefined) meta.description = description
    return {
      path: join(pkgDir, SHELL_METADATA_DIR, sub, 'locale', `${locale}.json`),
      content: JSON.stringify({ meta }, null, 2) + '\n',
    }
  }))
}

/** Remove generated metadata for subpaths/locales the current manifest no longer owns. */
function pruneShellMetadata(pkgDir, shellSubpaths) {
  const root = join(pkgDir, SHELL_METADATA_DIR)
  if (!existsSync(root)) return
  const expected = new Set(shellSubpaths)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !expected.has(entry.name)) rmSync(join(root, entry.name), { recursive: true, force: true })
  }
  for (const sub of shellSubpaths) {
    const localeDir = join(root, sub, 'locale')
    if (!existsSync(localeDir)) continue
    const expectedLocales = new Set(SHELL_METADATA_LOCALES.map((locale) => `${locale}.json`))
    for (const entry of readdirSync(localeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !expectedLocales.has(entry.name)) rmSync(join(localeDir, entry.name), { force: true })
    }
  }
}

/**
 * List the generated metadata the current manifest no longer owns, judged
 * exactly like {@link pruneShellMetadata} deletes it: one entry per unexpected
 * family directory, and one per unexpected file in a family's locale
 * directory. Write mode prunes these; check mode must NAME them, or a stale
 * family nobody writes any more is invisible to `--check` — the same drift
 * class this generator exists to catch, one level up from file content.
 * @param pkgDir - the aggregate package directory.
 * @param shellSubpaths - family subpaths the manifest owns.
 * @returns repo-confirmable paths that should not be on disk, sorted.
 */
function strayShellMetadata(pkgDir, shellSubpaths) {
  const root = join(pkgDir, SHELL_METADATA_DIR)
  if (!existsSync(root)) return []
  const expected = new Set(shellSubpaths)
  const stray = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !expected.has(entry.name)) stray.push(join(root, entry.name))
  }
  for (const sub of shellSubpaths) {
    const localeDir = join(root, sub, 'locale')
    if (!existsSync(localeDir)) continue
    const expectedLocales = new Set(SHELL_METADATA_LOCALES.map((locale) => `${locale}.json`))
    for (const entry of readdirSync(localeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !expectedLocales.has(entry.name)) stray.push(join(localeDir, entry.name))
    }
  }
  return stray.sort()
}

/**
 * Resolve the manifest's shellNotes section into one description per family
 * subpath, failing closed on anything that would ship a row without its
 * purpose line. The official reader renders whatever the locale JSON carries,
 * so an unknown id (a note for a family no row mounts) is as wrong as a missing
 * one; the Chinese note is capped because the inventory renders it on a single
 * line under the title.
 * @returns id -> { en, ru, zh } description map.
 */
function resolveShellNotes(entries, shellSubpaths, rel, errors) {
  const notes = new Map()
  const known = new Set(shellSubpaths)
  const declared = new Set()
  for (const entry of entries) {
    const id = entry.id
    if (typeof id !== 'string' || id === '') {
      errors.push(`${rel}: shellNotes entry needs a string "id" (the family subpath): ${JSON.stringify(entry)}`)
      continue
    }
    if (!known.has(id)) {
      errors.push(`${rel}: shellNotes "${id}" names no family subpath of this aggregate`)
      continue
    }
    if (declared.has(id)) {
      errors.push(`${rel}: duplicate shellNotes entry for "${id}"`)
      continue
    }
    declared.add(id)
    const note = {}
    let complete = true
    for (const locale of SHELL_METADATA_LOCALES) {
      const value = typeof entry[locale] === 'string' ? entry[locale].trim() : ''
      if (value === '') {
        errors.push(`${rel}: shellNotes "${id}" needs a non-empty "${locale}" note`)
        complete = false
        continue
      }
      note[locale] = value
    }
    if (!complete) continue
    const han = [...note.zh].filter((char) => /\p{Script=Han}/u.test(char)).length
    if (han > SHELL_NOTE_MAX_HAN) {
      errors.push(`${rel}: shellNotes "${id}" zh note has ${han} Han characters (max ${SHELL_NOTE_MAX_HAN}: the inventory renders it on one line)`)
      continue
    }
    if (note.zh === note.en) {
      errors.push(`${rel}: shellNotes "${id}" zh and en notes are the same text`)
      continue
    }
    notes.set(id, note)
  }
  for (const sub of shellSubpaths) {
    if (!declared.has(sub)) errors.push(`${rel}: shellNotes has no entry for family subpath "${sub}"`)
  }
  return notes
}

/**
 * Resolve the manifest's retiredPlugins section into the shell's retirement
 * registry, failing closed on anything that would ship a wrong no-op set.
 *
 * The registry exists for one behavior: a stale row in an older profile names
 * a removed package, and the shell must skip the import instead of recording a
 * failed import as a degraded plugin. So every entry is checked against the
 * two facts that make that skip safe — the family is a tombstone (the subpath
 * export those old rows resolve still exists; a retired family without one is
 * the boot-level ERR_PACKAGE_PATH_NOT_EXPORTED failure) and the plugin is NOT
 * one of this aggregate's dependencies (a package that is still mounted must
 * never be swallowed by the no-op branch).
 * @param entries - retiredPlugins section entries.
 * @param tombstones - the manifest's tombstone subpaths.
 * @param resolvedDeps - the aggregate's resolved dependencies.
 * @returns {family, plugin} pairs sorted by family.
 */
function resolveRetiredPlugins(entries, tombstones, resolvedDeps, rel, errors) {
  const tombstonesSet = new Set(tombstones)
  const depNames = new Set(resolvedDeps.map((dep) => dep.name))
  const families = new Set()
  const plugins = new Set()
  const retired = []
  for (const entry of entries) {
    const family = entry.family
    const plugin = entry.plugin
    if (typeof family !== 'string' || family === '') {
      errors.push(`${rel}: retiredPlugins entry needs a string "family" (the tombstone subpath): ${JSON.stringify(entry)}`)
      continue
    }
    if (typeof plugin !== 'string' || plugin === '') {
      errors.push(`${rel}: retiredPlugins entry "${family}" needs a string "plugin" (the retired package name)`)
      continue
    }
    if (!/^[a-z0-9-]+$/.test(family)) {
      errors.push(`${rel}: retiredPlugins family "${family}" must match ^[a-z0-9-]+$ (it is a family subpath)`)
      continue
    }
    if (!tombstonesSet.has(family)) {
      errors.push(`${rel}: retiredPlugins family "${family}" is not a tombstone; a retired family keeps its subpath export for older profiles, so add "${family}" to tombstones in the same change`)
      continue
    }
    if (families.has(family)) {
      errors.push(`${rel}: duplicate retiredPlugins entry for family "${family}"`)
      continue
    }
    if (plugins.has(plugin)) {
      errors.push(`${rel}: duplicate retiredPlugins entry for plugin "${plugin}"`)
      continue
    }
    if (depNames.has(plugin)) {
      errors.push(`${rel}: retiredPlugins plugin "${plugin}" is also a dependency of this aggregate; a mounted plugin must never be skipped as retired`)
      continue
    }
    families.add(family)
    plugins.add(plugin)
    retired.push({ family, plugin })
  }
  return retired.sort((left, right) => (left.family < right.family ? -1 : left.family > right.family ? 1 : 0))
}

const RETIRED_PLUGINS_HEADER = [
  '/* Generated by scripts/aggregate.mjs from the aggregate.yml manifest — do not edit.',
  ' * Retirement registry of the fault-isolation shell: every family plugin the',
  ' * aggregate removed while older profiles may still carry a row that mounts',
  ' * it by package name. The shell skips the import for a specifier listed here,',
  ' * so a normal retirement stays a silent no-op instead of being recorded as a',
  ' * degraded plugin on the health route. A hand-written copy of this list lived',
  ' * beside the shell and drifted: the 2026-09-23 removal left its two package',
  ' * names out of it, so a host whose profile still carried those rows recorded',
  ' * them as failed imports on every boot. Edit aggregate.yml (retiredPlugins,',
  ' * together with the matching tombstones entry) and rerun',
  ' * `node scripts/aggregate.mjs`.',
  ' */',
]

/**
 * Render the generated retirement registry module the shell imports.
 * @param retired - {family, plugin} pairs sorted by family.
 * @returns the module source.
 */
function renderRetiredPlugins(retired) {
  const lines = [...RETIRED_PLUGINS_HEADER]
  lines.push(
    '',
    '/** Retired family subpath -> real package name of the plugin that used to mount there. */',
    'export const RETIRED_FAMILIES: Readonly<Record<string, string>> = {',
  )
  for (const { family, plugin } of retired) lines.push(`  '${family}': '${plugin}',`)
  lines.push(
    '}',
    '',
    '/** Every retired package name, sorted: what the shell skips without importing. Derived from',
    ' *  RETIRED_FAMILIES so the two can never disagree. */',
    'export const RETIRED_PLUGINS: readonly string[] = Object.freeze(',
    '  Object.values(RETIRED_FAMILIES).sort(),',
    ')',
    '',
  )
  return lines.join('\n')
}

/**
 * The display subpath of one shell-wrapped family row: the namespaced row id
 * without the web-ui- prefix (web-ui-usage -> usage), so the subpath, the row
 * id, and the inventory title stay traceable 1:1.
 */
function shellSubpath(id) {
  return namespaceId(id).replace(/^web-ui-/, '')
}

/**
 * Family subpaths of one aggregate, deduped and sorted for exports emission.
 *
 * A family row mounts its child's REAL package now, so the child owns its
 * inventory title and needs no subpath of ours. The subpaths that stay are the
 * tombstoned ones: a profile written before the change records
 * `@linxin666/dsh-web-all/<family>` as a row name, and dropping the export
 * would turn that profile's boot into an ERR_PACKAGE_PATH_NOT_EXPORTED
 * failure. Keeping it costs one file in the tarball.
 */
function collectShellSubpaths(tombstones = []) {
  return [...new Set(tombstones)].sort()
}

/**
 * Source packages mounted as direct bare rows even though their patch row is
 * not shell-wrapped (paths are relative patchFrom spellings):
 * - self: compat shim IS this package's own plugin;
 * - dsh-i18n: host half is a no-op;
 * - skins/skin-center: carried the Config schema for background/custom-theme/
 *   wallpaper that the 0.1.7 SettingsForms loader had to inspect directly. It
 *   is no longer an in-repo patchFrom source (the skin center became a
 *   satellite npm row), so the entry is inert today; it stays because the
 *   exemption list also decides which historical family subpaths keep their
 *   compat export.
 */
const SHELL_EXEMPT = new Set(['../dsh-i18n', '../skins/skin-center'])

/** Directories directly under a path (non-recursive, sorted). */
function listSubdirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => {
      try {
        return statSync(join(dir, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/** Find every aggregate package: packages/* with an aggregate.yml. */
function findAggregates() {
  const candidates = []
  for (const name of listSubdirs(join(REPO_ROOT, 'packages'))) {
    candidates.push(join(REPO_ROOT, 'packages', name))
  }
  return candidates
    .filter((dir) => existsSync(join(dir, 'aggregate.yml')))
    .map((pkgDir) => ({ pkgDir, ymlPath: join(pkgDir, 'aggregate.yml') }))
}

/**
 * Parse the hand-written manifest. YAML subset on purpose: comment lines and
 * blank lines are skipped, "<key>:" lines start a section, "- <value>" lines
 * belong to the current section. The `rows` section holds single-line JSON
 * flow mappings (JSON is valid YAML, so the manifest stays YAML-readable
 * while the generator can JSON.parse each entry).
 */
function parseManifest(ymlPath, errors) {
  const manifest = { patchFrom: [], deps: [], self: null, rows: [], patches: [], inactive: [], retire: [], tombstones: [], familyIds: {}, shellNotes: [], retiredPlugins: [] }
  let section = null
  for (const raw of readFileSync(ymlPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (!(section in manifest)) {
      // Unknown section header (or preamble): drop its entries instead of
      // letting them fall into whichever known section was parsed last.
      // Manifest ordering must not matter.
      continue
    }
    if (section === 'familyIds') {
      // Mapping section: a child's own row id -> the aggregate row id this
      // aggregate mounts it under (see the familyIds contract in the header).
      const mapping = line.replace(/\s+#.*$/, '').match(/^([A-Za-z0-9_.-]+):\s*(\S+)$/)
      if (!mapping) {
        errors.push(`${ymlPath}: familyIds entry must be "<child row id>: <aggregate row id>": ${line}`)
        continue
      }
      if (mapping[1] in manifest.familyIds) {
        errors.push(`${ymlPath}: duplicate familyIds entry for ${mapping[1]}`)
        continue
      }
      manifest.familyIds[mapping[1]] = mapping[2]
      continue
    }
    const entryMatch = line.match(/^-\s+(.+)$/)
    if (!entryMatch) continue
    const entry = entryMatch[1].trim().replace(/\s+#.*$/, '')
    if (section === 'patchFrom') manifest.patchFrom.push(entry)
    else if (section === 'deps') manifest.deps.push(entry)
    else if (section === 'tombstones') manifest.tombstones.push(entry)
    else if (section === 'inactive') manifest.inactive.push(entry)
    else if (section === 'retire') manifest.retire.push(entry)
    else if (section === 'rows') {
      let parsed
      try {
        parsed = JSON.parse(entry)
      } catch {
        errors.push(`${ymlPath}: rows entry must be a JSON flow mapping: ${entry}`)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push(`${ymlPath}: rows entry must be an object: ${entry}`)
        continue
      }
      manifest.rows.push(parsed)
    } else if (section === 'patches') {
      let parsed
      try {
        parsed = JSON.parse(entry)
      } catch {
        errors.push(`${ymlPath}: patches entry must be a JSON flow mapping: ${entry}`)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push(`${ymlPath}: patches entry must be an object: ${entry}`)
        continue
      }
      manifest.patches.push(parsed)
    } else if (section === 'shellNotes') {
      let parsed
      try {
        parsed = JSON.parse(entry)
      } catch {
        errors.push(`${ymlPath}: shellNotes entry must be a JSON flow mapping: ${entry}`)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push(`${ymlPath}: shellNotes entry must be an object: ${entry}`)
        continue
      }
      manifest.shellNotes.push(parsed)
    } else if (section === 'retiredPlugins') {
      let parsed
      try {
        parsed = JSON.parse(entry)
      } catch {
        errors.push(`${ymlPath}: retiredPlugins entry must be a JSON flow mapping: ${entry}`)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push(`${ymlPath}: retiredPlugins entry must be an object: ${entry}`)
        continue
      }
      manifest.retiredPlugins.push(parsed)
    } else if (section === 'self') {
      if (manifest.self !== null && manifest.self !== entry) {
        console.warn(`aggregate.yml defines several self entries (${manifest.self}, ${entry}); keeping the last one`)
      }
      manifest.self = entry
    }
  }
  return manifest
}

/**
 * Parse a child's cordis.patch.yml into row blocks. Two kinds are supported:
 * - insert rows under a "- insert:" block (own plugin rows; id is namespaced
 *   later, config preserved when present); these must carry a "name:" line.
 * - top-level bare rows ("- id:" directly, no insert wrapper): patches to an
 *   already-mounted harness/plugin row by id (config replaced as a whole), so
 *   their id and config survive verbatim into the aggregate patch. A bare
 *   patch may omit "name:" because a harness patch can disable/override a row
 *   it does not own (for example `- id: session-persistence-jsonl` plus
 *   `disabled: true`); "name:" is still parsed when present.
 * The file format is the repo's fixed YAML subset: "- id:" followed by
 * optional "name:", then optional "config:" with deeper-indented key lines.
 */
function parsePatchBlocks(patchPath, errors) {
  const significant = []
  for (const [i, raw] of readFileSync(patchPath, 'utf8').split(/\r?\n/).entries()) {
    if (raw.trim() && !raw.trim().startsWith('#')) {
      significant.push({ text: raw.trimEnd(), line: i + 1 })
    }
  }
  const blocks = []
  let inInsert = false
  for (let i = 0; i < significant.length; i++) {
    const line = significant[i]
    if (/^- insert:\s*$/.test(line.text.trim())) {
      inInsert = true
      continue
    }
    const idMatch = line.text.match(/^(\s*)- id:\s*(\S+)\s*$/)
    if (!idMatch) continue
    const idIndent = idMatch[1].length
    if (idIndent > 0 && !inInsert) {
      errors.push(`${patchPath}:${line.line}: expected a "- insert:" block before indented "- id:${idMatch[1]}"`)
      continue
    }
    // An indented "- id:" line closes the current insert block when the
    // previous insert row is complete; a top-level bare row is always a patch.
    if (idIndent === 0) inInsert = false
    const block = { kind: inInsert ? 'insert' : 'patch', id: idMatch[2], name: '', extraLines: [], configLines: [] }
    const subIndent = idIndent + 2
    let j = i + 1
    const nameLine = significant[j]
    if (nameLine && nameLine.text.startsWith(' '.repeat(subIndent)) && /^name:/.test(nameLine.text.slice(subIndent))) {
      const nameMatch = nameLine.text.slice(subIndent).match(/^name:\s*(['"])([^'"]+)\1\s*$/)
        || nameLine.text.slice(subIndent).match(/^name:\s*(\S+)\s*$/)
      if (nameMatch) {
        block.name = nameMatch[2] ?? nameMatch[1]
        j++
      }
    }
    // Rows of both kinds may carry keys besides name/config — a patch row's
    // scalar overrides (`disabled: true`), or an insert row's own row options
    // (`disabled: !!js process.platform !== 'win32'`, the platform guard a
    // host-only child ships). They are preserved verbatim, subtree included:
    // a key whose value is a nested block must move as a whole, or the
    // aggregate patch would carry a truncated mapping and fail to parse.
    while (j < significant.length) {
      const candidate = significant[j]
      const indent = candidate.text.length - candidate.text.trimStart().length
      if (indent <= idIndent) break
      if (indent <= subIndent) {
        const payload = candidate.text.slice(subIndent)
        if (/^config:/.test(payload)) {
          j++
          while (j < significant.length) {
            const nested = significant[j]
            const nestedIndent = nested.text.length - nested.text.trimStart().length
            if (nestedIndent <= subIndent) break
            block.configLines.push(nested.text)
            j++
          }
          continue
        }
        if (!/^name:/.test(payload)) {
          block.extraLines.push(candidate.text)
          j++
          while (j < significant.length) {
            const nested = significant[j]
            const nestedIndent = nested.text.length - nested.text.trimStart().length
            if (nestedIndent <= subIndent) break
            block.extraLines.push(nested.text)
            j++
          }
          continue
        }
      }
      break
    }
    if (block.kind === 'insert' && !block.name) {
      errors.push(`${patchPath}:${line.line}: expected a "name:" line after "- id: ${block.id}"`)
      i = j - 1
      continue
    }
    blocks.push(block)
    i = j - 1
  }
  return blocks
}

/**
 * Collect patch rows for one patchFrom entry. Aggregates expand recursively
 * (cycle-guarded); leaf bundles contribute the rows parsed from their own
 * cordis.patch.yml. Every block remembers its leaf entry and the chain of
 * aggregate entries it was reached through, for the comment headers.
 */
function collectRows(pkgDir, entry, via, visited, errors, blocks) {
  const manifestPath = join(pkgDir, 'aggregate.yml')
  if (existsSync(manifestPath)) {
    if (visited.has(pkgDir)) {
      errors.push(`aggregate cycle: ${[...visited, pkgDir].join(' -> ')}`)
      return
    }
    visited.add(pkgDir)
    const manifest = parseManifest(manifestPath, errors)
    for (const sub of manifest.patchFrom) {
      const subDir = resolvePath(pkgDir, sub)
      if (!existsSync(subDir)) {
        errors.push(`patchFrom target not found: ${manifestPath} -> ${sub} (${subDir})`)
        continue
      }
      collectRows(subDir, sub, [...via, entry], visited, errors, blocks)
    }
    visited.delete(pkgDir)
    return
  }
  const patchPath = join(pkgDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    errors.push(`patchFrom target has no cordis.patch.yml: ${pkgDir} (via ${[...via, entry].join(' -> ')})`)
    return
  }
  const rows = parsePatchBlocks(patchPath, errors)
  if (rows.length === 0) {
    errors.push(`no plugin rows parsed from ${patchPath}`)
    return
  }
  blocks.push({ entry, via, rows })
}

/** Append one row's config lines (already properly indented in the source) after its "config:" key. */
function pushConfig(lines, configLines, keyIndent) {
  if (configLines.length === 0) return
  lines.push(`${' '.repeat(keyIndent)}config:`)
  for (const configLine of configLines) lines.push(configLine)
}

/**
 * Resolve one external row package to its directory. npm resolution anchors
 * at the aggregate package, mirroring the pnpm-hoisted profile layout that
 * the generated patch rows rely on.
 */
function resolveExternalPackage(name, aggregateDir, errors, rel) {
  try {
    const pkgPath = require.resolve(`${name}/package.json`, { paths: [aggregateDir] })
    return dirname(pkgPath)
  } catch (e) {
    errors.push(`${rel}: cannot resolve external package ${name}: ${e.message}`)
    return null
  }
}

/**
 * Expand one external row. A plain plugin package stays a single insert row;
 * a `dsh.bundle` package contributes its patch rows directly, because the
 * loader resolves row `name:` values as importable plugins and cannot import
 * a bundle-only package (such packages ship only `dsh.bundle.patch`).
 */
function expandExternalRow(row, aggregateDir, errors, rel) {
  const dir = resolveExternalPackage(row.name, aggregateDir, errors, rel)
  if (!dir) return null
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch (e) {
    errors.push(`${rel}: cannot read external package manifest for ${row.name}: ${e.message}`)
    return null
  }
  const bundlePatch = manifest.dsh?.bundle?.patch
  if (typeof bundlePatch !== 'string') {
    return { kind: 'row', row }
  }
  const patchPath = join(dir, bundlePatch)
  if (!existsSync(patchPath)) {
    errors.push(`${rel}: external bundle ${row.name} declares dsh.bundle.patch ${bundlePatch} but the file is missing`)
    return null
  }
  return { kind: 'bundle', name: row.name, dir, rows: parsePatchBlocks(patchPath, errors) }
}


/** Render the aggregate cordis.patch.yml: header + per-source insert blocks, plus verbatim harness-row patches and own-row config overrides. */
function renderPatch(blocks, externalRows, ownPatches, inactiveRows, retireRows, familyIds, errors, rel, aggregateDir) {
  const lines = [...PATCH_HEADER]
  const seen = new Set()
  const patchedIds = new Set()
  for (const block of blocks) {
    const chain = block.via.length ? ` (via ${block.via.join(' -> ')})` : ''
    const sourceHeader = `# from ${block.entry}${chain}`
    const insertRows = block.rows.filter((row) => row.kind !== 'patch')
    const patchRows = block.rows.filter((row) => row.kind === 'patch')
    if (insertRows.length > 0) {
      lines.push('', sourceHeader, '- insert:')
      for (const row of insertRows) {
        const id = familyIdOf(row.id, familyIds)
        if (seen.has(id)) errors.push(`${rel}: duplicate aggregate row id after namespacing: ${id} (${row.name})`)
        seen.add(id)
        lines.push(`    - id: ${id}`)
        // Every family row mounts its child's REAL package name. That is what
        // puts the child's browser half on the page: the official client module
        // scanner only mounts a client face on the loader entry whose name equals
        // the package, so a subpath-spelled row left the browser half to this
        // package's own ./client bundle - one copy of every family UI inside a
        // single 2.9 MB bundle that had to download in full before any family
        // surface could render (issue #1901, remote/high-RTT forwarders). A real
        // row also makes the row's own switch honest: the loader's `disabled` now
        // decides the family, where it used to gate only a shell whose client half
        // was then re-gated in the browser. The row id stays web-ui-* so profile
        // overrides written before this change keep applying.
        lines.push(`      name: '${row.name}'`)
        pushConfig(lines, row.configLines ?? [], 6)
        // The child's own row options, verbatim and AFTER the name/config pair:
        // a host-only child ships a platform guard this way
        // (`disabled: !!js process.platform !== 'win32'`), and dropping it would
        // mount that row on a host the package refuses. Emitting last keeps the
        // "`name:` then `config:`" adjacency every row parser in this repository
        // (and the settings surface's config-root contract) already relies on.
        for (const extra of row.extraLines ?? []) lines.push(extra)
      }
    }
    for (const row of patchRows) {
      if (patchedIds.has(row.id)) errors.push(`${rel}: duplicate harness row patch across sources: ${row.id} (${row.name})`)
      patchedIds.add(row.id)
      lines.push('', `${sourceHeader} (patch row ${row.id})`)
      lines.push(`- id: ${row.id}`)
      lines.push(`  name: '${row.name}'`)
      pushConfig(lines, row.configLines ?? [], 2)
    }
  }
  // Own-row config overrides: emitted after every insert so a later patch
  // targets an earlier inserted row (the boot layer indexes inserts as they
  // are added). The id must reference one of this aggregate's own rows.
  for (const patch of ownPatches) {
    if (typeof patch.id !== 'string' || !patch.id) {
      errors.push(`${rel}: patches entry is missing a string "id": ${JSON.stringify(patch)}`)
      continue
    }
    if (typeof patch.config !== 'object' || patch.config === null || Array.isArray(patch.config)) {
      errors.push(`${rel}: patches entry "${patch.id}" needs an object "config"`)
      continue
    }
    const targetId = familyIdOf(patch.id, familyIds)
    if (!seen.has(targetId)) {
      errors.push(`${rel}: patches entry "${patch.id}" does not match any row of this aggregate`)
      continue
    }
    if (patchedIds.has(targetId)) errors.push(`${rel}: duplicate own-row patch for ${targetId}`)
    patchedIds.add(targetId)
    lines.push('', `# config override for ${targetId} (seed default; settings wins once the user edits it)`, `- id: ${targetId}`)
    lines.push(`  config: ${JSON.stringify(patch.config)}`)
  }
  // Declared familyIds overrides must name a row this aggregate really mounts
  // and must stay inside the aggregate's own id space: a key that matches no
  // row is dead config, and a value outside web-ui-* could collide with the
  // child package's own standalone row, which is the very collision the
  // namespacing exists to prevent.
  for (const [childId, familyId] of Object.entries(familyIds)) {
    if (!/^web-ui-[a-z0-9-]+$/.test(familyId)) {
      errors.push(`${rel}: familyIds entry "${childId}" must name a web-ui-* aggregate row id: ${familyId}`)
      continue
    }
    const childRow = blocks.some((block) => block.rows.some((row) => row.kind !== 'patch' && row.id === childId))
    if (!childRow) {
      errors.push(`${rel}: familyIds entry "${childId}" does not match any insert row of this aggregate`)
    }
  }
  // Own rows that ship disabled by default (opt-in rows): trailing bare
  // overrides emitted after every insert, so the row never mounts until the
  // user enables it in the plugin manager (a user-layer disabled:false
  // override wins over this bundle default). The id must reference one of
  // this aggregate's own inserted rows.
  const inactiveTargets = []
  for (const rawId of inactiveRows) {
    if (typeof rawId !== 'string' || !rawId) {
      errors.push(`${rel}: inactive entry must be a non-empty row id string: ${JSON.stringify(rawId)}`)
      continue
    }
    const targetId = familyIdOf(rawId, familyIds)
    if (!seen.has(targetId)) {
      errors.push(`${rel}: inactive entry "${rawId}" does not match any row of this aggregate`)
      continue
    }
    if (inactiveTargets.includes(targetId)) {
      errors.push(`${rel}: duplicate inactive entry for ${targetId}`)
      continue
    }
    inactiveTargets.push(targetId)
  }
  if (inactiveTargets.length > 0) {
    lines.push('', '# inactive by default (opt-in rows): these ship disabled; each is enabled per row in the',
      '# plugin manager, whose enable writes a user-layer "disabled: false" override that wins.')
    for (const id of inactiveTargets) {
      lines.push(`- id: ${id}`, '  disabled: true')
    }
  }
  // Foreign rows this aggregate supersedes. The id is written verbatim (it
  // belongs to another bundle's layer), and the override is emitted last so it
  // wins over the layer that inserted the row.
  const retiredTargets = []
  for (const rawId of retireRows) {
    if (typeof rawId !== 'string' || !rawId) {
      errors.push(`${rel}: retire entry must be a non-empty row id string: ${JSON.stringify(rawId)}`)
      continue
    }
    if (seen.has(rawId)) {
      errors.push(`${rel}: retire entry "${rawId}" names this aggregate's own row; use inactive for own rows`)
      continue
    }
    if (retiredTargets.includes(rawId)) {
      errors.push(`${rel}: duplicate retire entry for ${rawId}`)
      continue
    }
    retiredTargets.push(rawId)
  }
  if (retiredTargets.length > 0) {
    lines.push('', '# superseded foreign rows: this aggregate replaces these rows from another bundle with',
      '# its own entry, so the composition does not show two near-identical first-level entries.',
      '# A user-layer "disabled: false" override still wins.')
    for (const id of retiredTargets) {
      lines.push(`- id: ${id}`, '  disabled: true')
    }
  }
  // External rows: npm packages outside this repo. Plain plugins mount like
  // any child; external bundles expand their own patch rows here so their
  // importable plugin rows land in the composed tree (bundle-only packages
  // cannot be imported by the loader themselves). A row may declare
  // `"inactive": true` (for example better-session, which would otherwise
  // swap the session persistence backend on upgrade): bundle patch rows are
  // omitted entirely and every emitted insert row gets a trailing
  // `disabled: true` override, so the bits stay installed while nothing
  // mounts until the user opts in.
  for (const row of externalRows) {
    if (typeof row.id !== 'string' || !row.id) {
      errors.push(`${rel}: external row is missing a string "id": ${JSON.stringify(row)}`)
      continue
    }
    if (typeof row.name !== 'string' || !row.name) {
      errors.push(`${rel}: external row "${row.id}" is missing a string "name"`)
      continue
    }
    if (row.inactive !== undefined && typeof row.inactive !== 'boolean') {
      errors.push(`${rel}: external row "${row.id}" declares non-boolean "inactive": ${JSON.stringify(row.inactive)}`)
      continue
    }
    const inactiveIds = []
    const expanded = expandExternalRow(row, aggregateDir, errors, rel)
    if (!expanded) continue
    if (expanded.kind === 'row') {
      const id = namespaceId(row.id)
      if (seen.has(id)) errors.push(`${rel}: duplicate aggregate row id after namespacing: ${id} (${row.name})`)
      seen.add(id)
      lines.push('', `# external: ${row.name}`, '- insert:')
      lines.push(`    - id: ${id}`)
      lines.push(`      name: '${row.name}'`)
      if (row.inactive === true) inactiveIds.push(id)
    } else {
      lines.push('', `# external bundle: ${expanded.name}`)
      for (const patchRow of expanded.rows) {
        if (patchRow.kind === 'patch') {
          // An inactive external contributes NO patch rows: they retune other
          // entries (for example better-session's own "disable stock jsonl"
          // harness row), and re-patching those ids with `disabled: true`
          // would flip the TARGET off too — bare rows merge into the entry
          // they name, they are not self-inert. Skipping leaves the upstream
          // row exactly as other sources tuned it.
          if (row.inactive === true) continue
          if (patchedIds.has(patchRow.id)) {
            lines.push('', `# from external bundle ${expanded.name} (patch row ${patchRow.id}; overrides earlier source patch)`)
          } else {
            lines.push('', `# from external bundle ${expanded.name} (patch row ${patchRow.id})`)
          }
          patchedIds.add(patchRow.id)
          lines.push(`- id: ${patchRow.id}`)
          for (const extra of patchRow.extraLines ?? []) lines.push(extra)
          pushConfig(lines, patchRow.configLines ?? [], 2)
          continue
        }
        const id = namespaceId(patchRow.id)
        if (seen.has(id)) errors.push(`${rel}: duplicate aggregate row id after external bundle expansion: ${id} (${patchRow.name})`)
        seen.add(id)
        lines.push('', `# from external bundle ${expanded.name} (insert row ${id})`)
        lines.push('- insert:')
        lines.push(`    - id: ${id}`)
        lines.push(`      name: '${patchRow.name}'`)
        pushConfig(lines, patchRow.configLines ?? [], 6)
        if (row.inactive === true) inactiveIds.push(id)
      }
    }
    if (inactiveIds.length > 0) {
      lines.push('', '# inactive by default: the rows above ship disabled, so the stock persistence',
        '# backend keeps serving sessions until you opt in. Enable with profile-level',
        "# `disabled: false` overrides.")
      for (const id of inactiveIds) {
        lines.push(`- id: ${id}`, '  disabled: true')
      }
    }
  }
  return lines.join('\n') + '\n'
}

/** Resolve manifest entries to their package names (read from each child's package.json). */
function resolveEntries(pkgDir, entries, section, errors) {
  const resolved = []
  for (const entry of entries) {
    const depDir = resolvePath(pkgDir, entry)
    const pkgPath = join(depDir, 'package.json')
    if (!existsSync(pkgPath)) {
      errors.push(`${section} target has no package.json: ${join(pkgDir, 'aggregate.yml')} -> ${entry} (${pkgPath})`)
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (e) {
      errors.push(`cannot read ${pkgPath}: ${e.message}`)
      continue
    }
    const name = manifest.name
    if (!name) {
      errors.push(`no "name" field in ${pkgPath}`)
      continue
    }
    if (manifest.private === true) {
      errors.push(`${section} target is a private package: ${join(pkgDir, 'aggregate.yml')} -> ${entry} (${pkgPath}); private workspace packages are never published and cannot be a public aggregate's runtime dependency`)
      continue
    }
    resolved.push({ name, entry })
  }
  return resolved
}

/**
 * Rebuild the aggregate package.json so every manifest deps entry becomes a
 * "workspace:*" dependency; other fields are preserved. The loader resolves
 * patch rows from the profile root, and pnpm installs these children as normal
 * dependencies (hoisting them to the top level in the default layout), so the
 * only peer the aggregate keeps is the `@deepseek-ai/dsh` host peer: every
 * other entry is a leftover child-plugin declaration and is dropped.
 *
 * The exports map is generator-owned for the family subpath keys: every
 * shell-wrapped row's `./<sub>` key points at the shared shell re-export, and
 * its `./<sub>/icon` plus `./<sub>/locale/<lang>.json` keys expose the display
 * metadata DSH reads without evaluating plugin code. Stale keys of removed
 * families are pruned, and a base key already present with a different target
 * is an error (the row would silently mount something else than the shell).
 */
function renderPackageJson(pkgPath, resolvedDeps, shellSubpaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const next = {}
  for (const { name } of resolvedDeps) next[name] = 'workspace:*'
  for (const key of Object.keys(pkg.dependencies ?? {}).filter((k) => !(k in next)).sort()) {
    next[key] = pkg.dependencies[key]
  }
  if (Object.keys(next).length) pkg.dependencies = next
  else delete pkg.dependencies
  const hostPeer = pkg.peerDependencies?.['@deepseek-ai/dsh']
  if (hostPeer !== undefined) pkg.peerDependencies = { '@deepseek-ai/dsh': hostPeer }
  else delete pkg.peerDependencies
  if (shellSubpaths.length > 0) {
    const exports = { ...pkg.exports }
    const shellSubs = new Set(shellSubpaths)
    for (const key of Object.keys(exports)) {
      const sub = key.match(/^\.\/([^/]+)/)?.[1]
      if (exports[key] === SHELL_EXPORT_TARGET && !shellSubs.has(key.slice('./'.length))) {
        delete exports[key]
        continue
      }
      if (sub !== undefined && !shellSubs.has(sub) && (exports[key] === SHELL_ICON_TARGET || exports[key].startsWith(`./${SHELL_METADATA_DIR}/`))) {
        delete exports[key]
      }
    }
    for (const sub of shellSubpaths) {
      const key = `./${sub}`
      if (exports[key] !== undefined && exports[key] !== SHELL_EXPORT_TARGET) {
        throw new Error(`exports key "${key}" already exists with target "${exports[key]}"; the family subpath must resolve to the shell re-export ${SHELL_EXPORT_TARGET}`)
      }
      exports[key] = SHELL_EXPORT_TARGET
      exports[`${key}/icon`] = SHELL_ICON_TARGET
      for (const locale of SHELL_METADATA_LOCALES) {
        exports[`${key}/locale/${locale}.json`] = `./${SHELL_METADATA_DIR}/${sub}/locale/${locale}.json`
      }
    }
    pkg.exports = exports
    const files = Array.isArray(pkg.files) ? [...pkg.files] : []
    if (!files.includes(SHELL_METADATA_DIR)) files.push(SHELL_METADATA_DIR)
    pkg.files = files
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/**
 * Validate the hand-written shells files the family subpath display names
 * depend on: the shared re-export module, and the scanner marker manifest —
 * a string "name" and "type": "module" (Node stops format detection at the
 * nearest manifest, so lib/shells/shell.js would parse as CJS without it),
 * and no dsh declaration (the marker must never become a second
 * client-module source for a package that already owns one).
 */
function validateShellFiles(pkgDir, rel, errors) {
  if (!existsSync(join(pkgDir, 'src', 'shells', 'shell.ts'))) {
    errors.push(`${rel}: missing src/shells/shell.ts (the shared family shell re-export)`)
  }
  const markerPath = join(pkgDir, 'src', 'shells', 'package.json')
  if (!existsSync(markerPath)) {
    errors.push(`${rel}: missing src/shells/package.json (the scanner marker manifest)`)
    return
  }
  let marker
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch (e) {
    errors.push(`${rel}: cannot read src/shells/package.json: ${e.message}`)
    return
  }
  if (typeof marker.name !== 'string' || marker.name === '') {
    errors.push(`${rel}: src/shells/package.json must carry a non-empty string "name" (the scanner marker)`)
  }
  if (marker.type !== 'module') {
    errors.push(`${rel}: src/shells/package.json must declare "type": "module" (Node format detection stops at the nearest manifest)`)
  }
  if (marker.dsh !== undefined) {
    errors.push(`${rel}: src/shells/package.json must not declare a dsh field (the marker must never become a client-module source)`)
  }
  if (!existsSync(join(pkgDir, 'icon.svg'))) {
    errors.push(`${rel}: missing icon.svg (family subpath \`./<family>/icon\` exports point there)`)
  }
}

console.log(`[aggregate] scanning ${join(REPO_ROOT, 'packages')} for aggregate.yml manifests...`)
const aggregates = findAggregates()
if (aggregates.length === 0) {
  console.log('[aggregate] no aggregate.yml found; nothing to do.')
  process.exit(0)
}

const errors = []
const results = []
for (const { pkgDir, ymlPath } of aggregates) {
  const rel = relative(REPO_ROOT, pkgDir)
  const manifest = parseManifest(ymlPath, errors)
  const blocks = []
  const visited = new Set()
  for (const entry of manifest.patchFrom) {
    const target = resolvePath(pkgDir, entry)
    if (!existsSync(target)) {
      errors.push(`patchFrom target not found: ${ymlPath} -> ${entry} (${target})`)
      continue
    }
    collectRows(target, entry, [], visited, errors, blocks)
  }
  if (manifest.self) {
    // self: the aggregate package loads ITS OWN plugin (host + client half)
    // through one patch row, e.g. the compat shim living inside web-ui-all.
    // unshift keeps the self block FIRST in the rendered patch so its ordering
    // does not drift when the patchFrom entries change.
    if (!/^[a-z0-9-]+$/.test(manifest.self)) {
      errors.push(`invalid self entry '${manifest.self}' (must match ^[a-z0-9-]+$); skipping self block`)
    } else {
      let selfName
      try {
        selfName = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name
      } catch (e) {
        errors.push(`cannot read self package name: ${e.message}`)
      }
      if (selfName) blocks.unshift({ entry: 'self', via: [], rows: [{ kind: 'insert', id: manifest.self, name: selfName, configLines: [] }] })
    }
  }
  if (manifest.patchFrom.length === 0 && !manifest.self) {
    console.log(`[aggregate] WARN ${rel}: aggregate.yml has no patchFrom entries (patch would be empty)`)
  }
  const shellSubpaths = collectShellSubpaths(manifest.tombstones)
  if (shellSubpaths.length > 0) validateShellFiles(pkgDir, rel, errors)
  const shellNotes = resolveShellNotes(manifest.shellNotes, shellSubpaths, rel, errors)
  const patch = renderPatch(blocks, manifest.rows, manifest.patches ?? [], manifest.inactive ?? [], manifest.retire ?? [], manifest.familyIds, errors, rel, pkgDir)
  const resolvedDeps = resolveEntries(pkgDir, manifest.deps, 'deps', errors)
  const retiredPlugins = resolveRetiredPlugins(manifest.retiredPlugins, manifest.tombstones, resolvedDeps, rel, errors)
  const pkgJson = renderPackageJson(join(pkgDir, 'package.json'), resolvedDeps, shellSubpaths)
  let ownName
  try {
    ownName = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name
  } catch {
    ownName = undefined
  }
  results.push({
    rel,
    blocks,
    patch,
    resolvedDeps,
    pkgJson,
    // Only the shell aggregate generates the retirement registry: it is the
    // package whose shell module performs the no-op skip.
    retiredPluginsModule: ownName === AGGREGATE_SHELL_PACKAGE ? renderRetiredPlugins(retiredPlugins) : undefined,
    retiredPluginCount: retiredPlugins.length,
    shellMetadata: shellMetadataFiles(pkgDir, shellSubpaths, shellNotes),
    shellSubpaths,
  })
}

let failed = false
if (errors.length) {
  for (const e of errors) console.error(`[aggregate] ERROR ${e}`)
  failed = true
}

if (failed) {
  console.error(CHECK ? '[aggregate] check FAILED: generated content differs from disk' : '[aggregate] FAILED: see errors above; no files written')
  process.exit(1)
}

for (const r of results) {
  const patchPath = join(REPO_ROOT, r.rel, 'cordis.patch.yml')
  const pkgPath = join(REPO_ROOT, r.rel, 'package.json')
  const metadataFiles = r.shellMetadata.map(({ path, content }) => [relative(REPO_ROOT, path), path, content])
  const retiredFile = r.retiredPluginsModule === undefined
    ? []
    : [['retired-plugins.generated.ts', join(REPO_ROOT, r.rel, 'src', 'retired-plugins.generated.ts'), r.retiredPluginsModule]]
  if (CHECK) {
    const diffs = []
    if (!existsSync(patchPath) || readFileSync(patchPath, 'utf8') !== r.patch) diffs.push(relative(REPO_ROOT, patchPath))
    if (!existsSync(pkgPath) || readFileSync(pkgPath, 'utf8') !== r.pkgJson) diffs.push(relative(REPO_ROOT, pkgPath))
    for (const [, filePath, content] of [...metadataFiles, ...retiredFile]) {
      if (!existsSync(filePath) || readFileSync(filePath, 'utf8') !== content) diffs.push(relative(REPO_ROOT, filePath))
    }
    // Symmetry with write mode: pruneShellMetadata deletes shell-metadata
    // entries the manifest no longer owns, so check mode has to report them as
    // drift — otherwise a family that lost its row keeps its directory (and
    // its exports) forever and `--check` stays green.
    const strays = strayShellMetadata(resolvePath(REPO_ROOT, r.rel), r.shellSubpaths)
    if (diffs.length || strays.length) {
      for (const d of diffs) console.log(`[aggregate] check: ${d} differs from generated content`)
      for (const stray of strays) console.log(`[aggregate] check: ${relative(REPO_ROOT, stray)} is not owned by the manifest (run without --check to prune it)`)
      failed = true
    } else {
      const rows = r.blocks.reduce((n, b) => n + b.rows.length, 0)
      const retiredNote = r.retiredPluginsModule === undefined ? '' : `, ${r.retiredPluginCount} retired plugin(s)`
      console.log(`[aggregate] check OK: ${r.rel} (${rows} row(s), ${r.resolvedDeps.length} dep(s)${retiredNote})`)
    }
  } else {
    writeFileSync(patchPath, r.patch)
    const rows = r.blocks.reduce((n, b) => n + b.rows.length, 0)
    console.log(`[aggregate] wrote ${relative(REPO_ROOT, patchPath)} (${r.blocks.length} source block(s), ${rows} row(s))`)
    writeFileSync(pkgPath, r.pkgJson)
    console.log(`[aggregate] wrote ${relative(REPO_ROOT, pkgPath)} (${r.resolvedDeps.length} workspace dep(s))`)
    pruneShellMetadata(resolvePath(REPO_ROOT, r.rel), r.shellSubpaths)
    for (const [label, filePath, content] of [...metadataFiles, ...retiredFile]) {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
      console.log(`[aggregate] wrote ${relative(REPO_ROOT, filePath)} (${label})`)
    }
  }
}

if (failed) {
  console.error('[aggregate] check FAILED: generated content differs from disk')
  process.exit(1)
}
console.log('[aggregate] done')