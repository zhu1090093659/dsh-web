/**
 * Family subpath display-name contract. The generated patch rows mount the
 * aggregate's per-family subpath exports (`@linxin666/dsh-web-all/<family>`)
 * so the official plugin inventory renders one distinct "web-all/<family>"
 * title per row instead of a wall of identical "web-all" cards, while the
 * row config keeps naming the real plugin package (`config.plugin`, the
 * fault-isolation contract). Two structural invariants make the display
 * names safe, and both are regression-gated here against the BUILT artifact:
 *
 * 1. Every subpath export resolves to the shared shell re-export
 *    (lib/shells/shell.js), which re-exports the main face's apply — one
 *    degraded ledger instance for the main face and every family row.
 * 2. The scanner marker manifest (lib/shells/package.json) sits beside the
 *    re-export and stops the client module scanner's nearest-package walk
 *    before it reaches the package root: the marker carries no dsh.client,
 *    so the family rows never become a second client-module source for a
 *    package that already owns one (a hard "multiple active Loader sources"
 *    reconcile error), and "type": "module" keeps Node from parsing the
 *    re-export as CJS (format detection also stops at the nearest manifest).
 * 3. DSH 0.2.1 reads display metadata from exported resources instead of a
 *    subpath package.json: each family subpath therefore also exports its icon
 *    and locale metadata files, whose meta.description is the one-line purpose
 *    text the inventory renders under the row title.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface PatchRow { id: string; name: string; plugin?: string }

/** Parse the generated patch's 4-space insert rows (id + name + optional config.plugin). */
function parsePatchRows(text: string): PatchRow[] {
  const rows: PatchRow[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].match(/^    - id: (\S+)$/)
    if (!id) continue
    const name = lines[i + 1]?.match(/^      name: '([^']+)'$/)
    if (!name) continue
    const row: PatchRow = { id: id[1], name: name[1] }
    if (lines[i + 2] === '      config:') {
      const plugin = lines[i + 3]?.match(/^        plugin: '([^']+)'$/)
      if (plugin) row.plugin = plugin[1]
    }
    rows.push(row)
  }
  return rows
}

/** First package.json walking up from a file — the scanner's nearestPackage walk. */
function nearestPackage(startFile: string): { dir: string; manifest: Record<string, unknown> } {
  let dir = dirname(startFile)
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      return { dir, manifest: JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown> }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no package.json above ${startFile}`)
    dir = parent
  }
}

describe('family rows and their subpath tombstones', () => {
  const patch = readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    name: string
    exports: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
  }
  const rows = parsePatchRows(patch)
  const familyRows = rows.filter(row => row.id !== 'web-ui-compat')

  it('every family row mounts the real package name and carries no shell config', () => {
    // Issue #1901: a row names its plugin package directly, which is what
    // makes the loader serve that package's own browser half. The shell
    // wrapper (subpath name + config.plugin) is gone from every family row.
    expect(familyRows.length).toBeGreaterThan(10)
    for (const row of familyRows) {
      expect(row.name.startsWith(`${manifest.name}/`), `row ${row.id} still mounts a shell subpath`).toBe(false)
      expect(row.plugin, `row ${row.id} still carries config.plugin`).toBeUndefined()
    }
    // The self row keeps the bare package name (it owns the client face).
    expect(rows.find(row => row.id === 'web-ui-compat')?.name).toBe(manifest.name)
    // Spot-check two rows against their real packages.
    expect(rows.find(row => row.id === 'web-ui-usage')?.name).toBe('@linxin666/dsh-usage')
    expect(rows.find(row => row.id === 'web-ui-task-board')?.name).toBe('@linxin666/dsh-client-ui-task-board')
  })

  it('every former family subpath stays exported so a pre-#1901 profile still boots', () => {
    // A profile written before this change records
    // `@linxin666/dsh-web-all/<family>` as the row NAME; dropping the export
    // would turn that boot into ERR_PACKAGE_PATH_NOT_EXPORTED.
    const formerSubpaths = [
      'settings', 'plugin-manager', 'market', 'task-board', 'task-board-github',
      'git-graph', 'remote-web-ui', 'update', 'ssh', 'liangshen',
      'skill-explorer', 'usage', 'session-archive', 'win-bash',
    ]
    for (const sub of formerSubpaths) {
      expect(manifest.exports[`./${sub}`], `missing compat export ./${sub}`).toBe('./lib/shells/shell.js')
    }
  })

  it('operator finds a retired family both tombstoned and registered, with no row and no dependency', () => {
    // Given the aggregate retired remote-web-ui while keeping its package
    // installable on its own,
    const yml = readFileSync(join(PACKAGE_DIR, 'aggregate.yml'), 'utf8')
    const tombstoneSection = (yml.split(/^tombstones:$/m)[1] ?? '').split(/^retiredPlugins:$/m)[0] ?? ''
    const registered = (yml.split(/^retiredPlugins:$/m)[1] ?? '')
      .split(/\r?\n/)
      .filter(line => line.trim().startsWith('- '))
      .map(line => JSON.parse(line.trim().slice(2)) as { family: string; plugin: string })
    // When each registered retirement is read against the generated manifest,
    // Then it is a tombstone subpath whose export still resolves, and neither a
    // mounted row nor a dependency survives for it.
    expect(registered.length).toBeGreaterThan(0)
    for (const entry of registered) {
      expect(tombstoneSection.split(/\r?\n/).map(line => line.trim())).toContain(`- ${entry.family}`)
      expect(manifest.exports[`./${entry.family}`]).toBe('./lib/shells/shell.js')
      expect(rows.some(row => row.id === `web-ui-${entry.family}`), `${entry.family} must keep no mounted row`).toBe(false)
      expect(manifest.dependencies?.[entry.plugin], `${entry.plugin} must not stay a dependency`).toBeUndefined()
    }
  })

  it('operator sees every family subpath export the metadata resources the host reads', () => {
    // Given the aggregate package manifest and its shell subpath exports
    expect(manifest.files).toContain('shell-metadata')
    // When inspecting every family shell subpath
    const shellSubs = Object.entries(manifest.exports)
      .filter(([key, target]) => target === './lib/shells/shell.js' && key.slice(2).split('/').length === 1)
      .map(([key]) => key.slice(2))
    expect(shellSubs.length).toBeGreaterThan(0)
    // Then each subpath exports its icon and locale metadata, and every locale
    // carries the row title plus the one-line purpose text under it
    for (const sub of shellSubs) {
      expect(manifest.exports[`./${sub}/icon`]).toBe('./icon.svg')
      const descriptions: Record<string, string> = {}
      const titles: Record<string, string> = {}
      for (const locale of ['en', 'ru', 'zh']) {
        const target = `./shell-metadata/${sub}/locale/${locale}.json`
        expect(manifest.exports[`./${sub}/locale/${locale}.json`]).toBe(target)
        const metadata = JSON.parse(readFileSync(join(PACKAGE_DIR, 'shell-metadata', sub, 'locale', `${locale}.json`), 'utf8')) as { meta?: { title?: string; description?: string } }
        // The row label is the family's own localized title, never the
        // `web-all/<family>` specifier shape.
        const title = metadata.meta?.title ?? ''
        expect(title, `${sub} ${locale} title must be a real label`).not.toBe('')
        expect(title, `${sub} ${locale} title must not be the web-all/<family> placeholder`).not.toMatch(/^web-all\//)
        titles[locale] = title
        const description = metadata.meta?.description ?? ''
        // Real copy, not a placeholder: present, already trimmed, and never a
        // restatement of the row title it sits under.
        expect(description).not.toBe('')
        expect(description).toBe(description.trim())
        expect(description).not.toBe(metadata.meta?.title)
        descriptions[locale] = description
      }
      // The Chinese note must stay on one line under the title
      const han = [...descriptions.zh].filter(char => /\p{Script=Han}/u.test(char)).length
      expect(han).toBeGreaterThan(0)
      expect(han).toBeLessThanOrEqual(20)
      expect(descriptions.zh).not.toBe(descriptions.en)
      // The label is translated rather than the English string again; ru has no
      // title of its own and reuses en.
      expect(titles.zh).not.toBe(titles.en)
      expect(titles.ru).toBe(titles.en)
    }
  })

  it('removed family subpaths are gone from the exports map, so a stale profile row fails at import time', () => {
    // The accepted cost of removing a family outright: no compatibility shell
    // and no display resources are kept, so a profile row still naming one of
    // these specifiers fails at import instead of soft-failing through the
    // shell. Any of these keys coming back has to be a re-adoption decision.
    for (const family of ['desktop-launcher', 'dsh-perf', 'describe-image', 'doctor', 'model-capabilities']) {
      expect(manifest.exports['./' + family], family + ' must not keep a subpath export').toBeUndefined()
      expect(manifest.exports['./' + family + '/icon'], family + ' must not keep an icon export').toBeUndefined()
      for (const locale of ['en', 'ru', 'zh']) {
        expect(manifest.exports['./' + family + '/locale/' + locale + '.json'], family + ' ' + locale + ' must not keep a locale export').toBeUndefined()
      }
      expect(existsSync(join(PACKAGE_DIR, 'shell-metadata', family)), family + ' must not keep a shell-metadata directory').toBe(false)
    }
  })

  it('the built shells face re-exports the main face apply (one degraded ledger)', async () => {
    const shells = (await import(join(PACKAGE_DIR, 'lib/shells/shell.js'))) as { apply: unknown }
    const main = (await import(join(PACKAGE_DIR, 'lib/shell.js'))) as { apply: unknown }
    expect(shells.apply).toBe(main.apply)
  })

  it('the scanner marker stops the nearest-package walk beside the re-export', () => {
    expect(existsSync(join(PACKAGE_DIR, 'lib/shells/shell.js'))).toBe(true)
    // Marker manifest: built copy matches the source of truth.
    const markerSource = JSON.parse(readFileSync(join(PACKAGE_DIR, 'src/shells/package.json'), 'utf8')) as Record<string, unknown>
    const marker = nearestPackage(join(PACKAGE_DIR, 'lib/shells/shell.js'))
    expect(marker.manifest).toEqual(markerSource)
    expect(typeof marker.manifest.name).toBe('string')
    expect(marker.manifest.type).toBe('module')
    expect(marker.manifest.dsh).toBeUndefined()
    // The main face walk still reaches the package root and its client face.
    const root = nearestPackage(join(PACKAGE_DIR, 'lib/index.js'))
    expect(root.manifest.name).toBe(manifest.name)
    // The walk must return the manifest as it is declared on disk, client face
    // included — not merely "some object with a dsh key".
    const declared = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { dsh?: unknown }
    expect(root.manifest.dsh).toEqual(declared.dsh)
  })
})
