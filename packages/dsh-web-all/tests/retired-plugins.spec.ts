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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('operator upgrading the aggregate finds a startup-safe tombstone for every family subpath it still exports', () => {
    // Given the family subpaths the package still publishes (a compatibility
    // shell for every family whose row moved to a real package name, plus the
    // retired family a stale profile row may still name),
    const pkg = manifest()
    const families = [...familySubpaths()].sort()
    expect(families.length).toBeGreaterThan(0)
    // When an older profile still mounts `@linxin666/dsh-web-all/<family>`,
    for (const family of families) {
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

describe('the retirement skip is driven by the registry, never by a blanket catch', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator upgrading from a profile that names an uninstalled package gets a degraded import record', async () => {
    // Given a live host and a registry that only names the families the
    // aggregate actually retired:
    const root = fakeHost()
    expect(GENERATED_RETIRED_PLUGINS).not.toContain('@linxin666/dsh-not-installed')
    // When the shell applies a row naming a package the workspace does not have
    await root.plugin(apply as never, { plugin: '@linxin666/dsh-not-installed' } as never)
    // Then the import IS attempted and its failure recorded: the no-op branch
    // answers to the registry, so an unregistered specifier cannot ride it.
    expect(listDegraded().map((record) => record.stage)).toEqual(['import'])
    expect(listDegraded().map((record) => record.plugin)).toEqual(['@linxin666/dsh-not-installed'])
  })

  it('operator upgrading from a profile that names a registered retired plugin gets a silent skip before any import', async () => {
    // Given a retirement registry that names one plugin. The live registry names
    // a package the workspace still carries, whose import would succeed, so the
    // skip-before-import property is only observable against a registry entry
    // for a package that is not installed: that entry is injected for this test
    // alone and the shell is re-imported against it.
    expect(GENERATED_RETIRED_PLUGINS).not.toContain('@linxin666/dsh-not-installed')
    vi.resetModules()
    vi.doMock('../src/retired-plugins.generated.ts', () => ({ // test-standards-allow: the retirement registry is generator-owned and only names installed packages, so the shell's skip branch has exactly one production seam — the generated module; a manifest fixture would invent a retired family together with its tombstone subpath and display metadata, which distorts the tree more than mocking the seam does.
      RETIRED_FAMILIES: { 'fake-family': '@linxin666/dsh-not-installed' },
      RETIRED_PLUGINS: ['@linxin666/dsh-not-installed'],
    }))
    try {
      const shell = await import('../src/shell.ts')
      const degraded = await import('../src/degraded.ts')
      shell._resetDegradedRouteForTest()
      degraded._resetDegradedForTest()
      const spec = '@linxin666/dsh-not-installed'
      // The shell's own registrations (its row plus the health-route inject
      // fiber) are the mount baseline: a row with no plugin key mounts nothing.
      const control = fakeHost()
      await control.plugin(shell.apply as never, {} as never)
      const baseline = control.registry.size
      // When the shell applies a row naming that registered specifier,
      const root = fakeHost()
      await root.plugin(shell.apply as never, { plugin: spec } as never)
      // Then the row mounts nothing and records nothing: the skip happens
      // before the import, so the package this profile names is never resolved
      // and its absent workspace entry can never surface as a degraded row.
      expect(root.registry.size, 'a skipped row must mount nothing beyond the shell itself').toBe(baseline)
      expect(degraded.listDegraded()).toEqual([])
    } finally {
      vi.doUnmock('../src/retired-plugins.generated.ts')
      vi.resetModules()
      resetAll()
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

  it('operator finds the registry naming every family the aggregate retired, with its real package', () => {
    // Given the aggregate retired remote-web-ui while its package stays in the
    // workspace for standalone installs,
    // When the manifest section and the generated module are both read,
    const yml = readFileSync(join(PACKAGE_DIR, 'aggregate.yml'), 'utf8')
    const generated = readFileSync(join(PACKAGE_DIR, 'src', 'retired-plugins.generated.ts'), 'utf8')
    const declared = (yml.split(/^retiredPlugins:$/m)[1] ?? '')
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith('- '))
      .map((line) => JSON.parse(line.trim().slice(2)) as { family: string; plugin: string })
    // Then the section declares at least that family with its real package name
    // and the generated module says the same thing in both shapes: pinning the
    // mapping on both sides is what a bare non-empty loop cannot do.
    expect(yml).toMatch(/^retiredPlugins:$/m)
    expect(declared.length).toBeGreaterThan(0)
    for (const entry of declared) {
      expect(RETIRED_FAMILIES[entry.family], entry.family + ' must stay registered as retired').toBe(entry.plugin)
      expect(GENERATED_RETIRED_PLUGINS).toContain(entry.plugin)
    }
    expect(Object.keys(RETIRED_FAMILIES)).toHaveLength(declared.length)
    expect([...generated.matchAll(/^ {2}'[^']+': '[^']+',$/gm)]).toHaveLength(declared.length)
    expect(generated).toContain('export const RETIRED_FAMILIES: Readonly<Record<string, string>> = {')
  })
})