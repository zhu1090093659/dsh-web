/**
 * Consistency gate for the shell's retirement registry (issue #1889).
 *
 * Two facts used to live in different places and drifted apart: which
 * shell-metadata family directories the aggregate ships, and which retired
 * package names the shell skips. The registry was a hand-written literal in
 * src/shell.ts, so the 2026-09-23 removal of dsh-doctor and
 * dsh-tool-describe-image left their package names out of it: a stale profile
 * row still naming either package fell through to `await import(spec)`, the
 * import failed (the package is gone from the workspace), and a normal
 * retirement was recorded as a degraded plugin on the health route. The
 * registry is now generated from aggregate.yml's retiredPlugins section, and
 * this suite pins both directions of the mapping plus the boot-safety the
 * tombstones exist for.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetDegradedForTest, listDegraded } from '../src/degraded.ts'
import { RETIRED_FAMILIES, RETIRED_PLUGINS as GENERATED_RETIRED_PLUGINS } from '../src/retired-plugins.generated.ts'
import { apply, _resetDegradedRouteForTest } from '../src/shell.ts'

const PACKAGE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const LOCALES = ['en', 'ru', 'zh']

interface FamilyRow {
  id: string
  name: string
  plugin?: string
}

interface PackageManifest {
  name: string
  dependencies?: Record<string, string>
  exports: Record<string, string>
}

/** The aggregate package manifest as committed. */
function manifest(): PackageManifest {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as PackageManifest
}

/** Parse the generated aggregate patch into its insert rows (id, name, config.plugin). */
function familyRows(): FamilyRow[] {
  const patch = readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
  const rows: FamilyRow[] = []
  const pattern = /- id: (web-ui-[^\n]+)\n\s+name: '([^']+)'(\n\s+config:\n\s+plugin: '([^']+)')?/g
  for (const match of patch.matchAll(pattern)) {
    rows.push({ id: match[1] ?? '', name: match[2] ?? '', plugin: match[4] })
  }
  return rows
}

/** Every insert row id in the patch, whether or not the shell wraps it. */
function insertRowIds(): string[] {
  return [...readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8').matchAll(/^ {4}- id: (\S+)$/gm)]
    .map((match) => match[1] ?? '')
}

/** The family subpaths the package exports (single-segment keys resolving to the shell). */
function familySubpaths(): Set<string> {
  const pkg = manifest()
  return new Set(
    Object.entries(pkg.exports)
      .filter(([key, target]) => target === './lib/shells/shell.js' && /^\.\/[^/]+$/.test(key))
      .map(([key]) => key.slice(2)),
  )
}

/**
 * The real plugin package each family row is carried by: the shell-wrapped
 * rows key on config.plugin, the direct-mounted rows (SHELL_EXEMPT children and
 * the npm external rows) carry the package name in `name` itself. Only family
 * subpaths count — the self row and the direct i18n row mount no family
 * subpath and ship no display metadata.
 */
function dependencyFamilies(): Map<string, string> {
  const families = new Map<string, string>()
  const subpaths = familySubpaths()
  for (const row of familyRows()) {
    const subpath = row.id.replace(/^web-ui-/, '')
    if (!subpaths.has(subpath)) continue
    families.set(subpath, row.plugin ?? row.name)
  }
  return families
}

/** Family directories the aggregate actually ships display metadata for. */
function shellMetadataFamilies(): string[] {
  return readdirSync(join(PACKAGE_DIR, 'shell-metadata'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function resetAll(): void {
  _resetDegradedRouteForTest()
  _resetDegradedForTest()
}

/** A minimal host: the shell only needs a webServer to hold its health routes. */
function fakeHost(): Context {
  const root = new Context()
  root.provide('webServer', {
    register() {
      return () => {}
    },
  } as never)
  return root
}

describe('shell-metadata families map onto dependencies or the retirement registry', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator sees every shell-metadata family carried by a dependency or registered as retired', () => {
    // Given the family directories committed under shell-metadata,
    const families = shellMetadataFamilies()
    // When each is resolved against the generated patch rows and the retirement registry,
    const dependencies = dependencyFamilies()
    const pkg = manifest()
    // Then every family is either a live row whose real plugin is a dependency,
    // or a retired family whose plugin the shell skips by name.
    for (const family of families) {
      const retiredPlugin = RETIRED_FAMILIES[family]
      if (retiredPlugin !== undefined) {
        expect(pkg.dependencies?.[retiredPlugin], family + ' is retired, so its plugin must not be a dependency').toBeUndefined()
        continue
      }
      // A family with no carrying row resolves to undefined and fails the
      // dependency lookup below by name, which is the message worth reporting.
      const plugin = dependencies.get(family)
      // Workspace children resolve as workspace:* and npm external rows keep
      // their explicit semver range; both are listed in dependencies.
      expect(Object.keys(pkg.dependencies ?? {}), 'shell-metadata family ' + family + ' is carried by ' + String(plugin) + ', which must be a dependency').toContain(plugin)
    }
    // And the disk holds nothing beyond those two sets: a leftover directory is
    // exactly the drift this gate exists to catch.
    const expected = [...new Set([...dependencies.keys(), ...Object.keys(RETIRED_FAMILIES)])].sort()
    expect(families).toEqual(expected)
    expect([...familySubpaths()].sort(), 'the family subpath exports must cover exactly the carried and retired families').toEqual(expected)
  })

  it('operator upgrading the aggregate finds a startup-safe tombstone for every retired family', () => {
    // Given the retired families the shell skips at mount time,
    const pkg = manifest()
    const retiredFamilies = Object.keys(RETIRED_FAMILIES).sort()
    expect(retiredFamilies.length).toBeGreaterThan(0)
    // When an older profile still mounts `@linxin666/dsh-web-all/<family>`,
    for (const family of retiredFamilies) {
      // Then the subpath export resolves to the shell re-export instead of
      // failing module resolution, and the display resources the host reads
      // beside it all point at files that exist.
      expect(pkg.exports['./' + family]).toBe('./lib/shells/shell.js')
      expect(existsSync(join(PACKAGE_DIR, 'lib/shells/shell.js'))).toBe(true)
      expect(pkg.exports['./' + family + '/icon']).toBe('./icon.svg')
      expect(existsSync(join(PACKAGE_DIR, 'icon.svg'))).toBe(true)
      for (const locale of LOCALES) {
        const target = './shell-metadata/' + family + '/locale/' + locale + '.json'
        expect(pkg.exports['./' + family + '/locale/' + locale + '.json']).toBe(target)
        expect(existsSync(join(PACKAGE_DIR, target)), family + ' ' + locale + ' metadata must exist').toBe(true)
      }
    }
  })
})

describe('a stale profile row for a retired plugin mounts as a silent no-op', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator upgrading from a profile that still names a retired plugin gets no degraded record', async () => {
    // Given a live host and the retired plugin package names a stale profile row
    // can still carry (the packages no longer resolve anywhere in the workspace)
    const root = fakeHost()
    expect(GENERATED_RETIRED_PLUGINS.length).toBeGreaterThan(0)
    // When the shell applies each such row
    for (const spec of GENERATED_RETIRED_PLUGINS) {
      await root.plugin(apply as never, { plugin: spec } as never)
      // Then nothing is imported or started, so the ledger stays empty: the
      // retired row is skipped BEFORE the import that used to fail.
      expect(listDegraded(), 'retired plugin ' + spec + ' must not be recorded as degraded').toEqual([])
    }
  })
})

describe('the retirement registry only names plugins that really left the family', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator never loses a mounted plugin to the retired no-op branch', () => {
    // Given the aggregate's live dependencies and its retirement registry
    const pkg = manifest()
    const dependencies = Object.keys(pkg.dependencies ?? {})
    expect(dependencies.length).toBeGreaterThan(0)
    // When the registry is compared with the dependencies and the generated rows
    const overlap = GENERATED_RETIRED_PLUGINS.filter((plugin) => dependencies.includes(plugin))
    const mounted = familyRows().filter((row) => GENERATED_RETIRED_PLUGINS.includes(row.plugin ?? row.name))
    // Then it is disjoint from both: a package that is still mounted must never
    // be silently skipped as retired...
    expect(overlap).toEqual([])
    // ...and a retired plugin is never named by a generated row, so the no-op
    // branch only ever serves the stale rows this registry exists for.
    expect(mounted.map((row) => row.id)).toEqual([])
  })

  it('operator sees the retired families removed from the patch instead of tombstoned in place', () => {
    // Given the retired families and the generated aggregate rows
    const rowIds = insertRowIds()
    expect(rowIds.length).toBeGreaterThan(0)
    // When each retired family is looked up as a row id
    const liveRows = Object.keys(RETIRED_FAMILIES).filter((family) => rowIds.includes('web-ui-' + family))
    // Then none of them is mounted: the subpath export is a tombstone, not a row.
    expect(liveRows).toEqual([])
  })

  it('operator finds the issue-named removals registered instead of hand-listed', () => {
    // Given issue #1889: the 2026-09-23 removal of the doctor and image
    // description plugins never reached the shell's hand-written list
    // When the generated registry is read
    const retired = [...GENERATED_RETIRED_PLUGINS]
    // Then both package names are in it, and the two families are keyed to them
    expect(retired).toContain('@linxin666/dsh-tool-describe-image')
    expect(retired).toContain('@linxin666/dsh-doctor')
    expect(RETIRED_FAMILIES['describe-image']).toBe('@linxin666/dsh-tool-describe-image')
    expect(RETIRED_FAMILIES['doctor']).toBe('@linxin666/dsh-doctor')
    expect(retired).toEqual([...retired].sort())
    expect(new Set(retired).size).toBe(retired.length)
    expect(retired).toEqual(Object.values(RETIRED_FAMILIES).sort())
  })
})