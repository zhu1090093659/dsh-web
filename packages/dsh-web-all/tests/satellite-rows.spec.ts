/**
 * Independent-repository satellite rows.
 *
 * The skin center, pet, community-index and preset-center plugins live in
 * their own GitHub repositories and are consumed as published npm packages:
 * the aggregate mounts them through `rows:` (external rows) instead of
 * `patchFrom`/`deps`.
 * External rows mount the real package name directly and are never wrapped by
 * the fault-isolation shell, so this lane pins the invariants that make the
 * arrangement safe:
 *
 * 1. row ids stay byte-identical to the patchFrom era (`web-ui-<family>`), so
 *    existing profiles keep resolving;
 * 2. each satellite is resolvable from the aggregate and exports
 *    `./package.json` — the subpath `scripts/aggregate.mjs` resolves external
 *    rows through (without it the generator hard-fails);
 * 3. the retired `remote-web-ui` family leaves no row behind (the package keeps
 *    its own standalone install), and the family's remaining remote face
 *    (`remote-bridge`) still mounts ahead of the external satellite rows;
 * 4. the subpath exports the rows used to mount stay in the package exports as
 *    compat tombstones, so a profile that recorded
 *    `@linxin666/dsh-web-all/pet` still imports instead of throwing
 *    ERR_PACKAGE_PATH_NOT_EXPORTED;
 * 5. the declared ranges exclude every satellite build older than the 0.1.7-rc.1
 *    migration, because a profile upgrade keeps whatever version its lockfile
 *    already resolved.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** Package name, aggregate row id and compat subpath of every extracted satellite. */
const SATELLITES = [
  {
    pkg: '@linxin666/dsh-client-ui-community-plugins',
    id: 'web-ui-community-plugins',
    subpath: './community-plugins',
  },
  { pkg: '@linxin666/dsh-pet', id: 'web-ui-pet', subpath: './pet' },
  {
    pkg: '@linxin666/dsh-client-ui-preset-center',
    id: 'web-ui-preset-center',
    subpath: './preset-center',
  },
  {
    pkg: '@linxin666/dsh-client-ui-skin-center',
    id: 'web-ui-skin-center',
    subpath: './skin-center',
  },
] as const

interface InsertRow {
  id: string
  name: string
  plugin?: string
}

/** Parse the generated patch's 4-space insert rows (id, name, optional config.plugin). */
function insertRows(): InsertRow[] {
  const lines = readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8').split(/\r?\n/)
  const rows: InsertRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i]?.match(/^ {4}- id: (\S+)$/)
    if (!id) continue
    const name = lines[i + 1]?.match(/^ {6}name: '([^']+)'$/)
    if (!name) continue
    const row: InsertRow = { id: id[1] ?? '', name: name[1] ?? '' }
    const plugin = lines[i + 3]?.match(/^ {8}plugin: '([^']+)'$/)
    if (lines[i + 2] === '      config:' && plugin) row.plugin = plugin[1]
    rows.push(row)
  }
  return rows
}

const packageJson = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  exports: Record<string, string>
  dependencies: Record<string, string>
}

describe('satellite rows mount published npm packages', () => {
  it('operator keeps every satellite row id byte-identical to the patchFrom era', () => {
    // Given the aggregate manifest mounts the satellites through npm rows,
    const rows = insertRows()
    // When the operator installs the bundle into a profile,
    const installed = SATELLITES.map(s => rows.find(r => r.id === s.id)?.id)
    // Then every row keeps the id a profile recorded before the split.
    expect(installed).toEqual(SATELLITES.map(s => s.id))
  })

  it('operator mounts the real package name directly instead of a family subpath', () => {
    // Given the satellites are published packages rather than in-repo children,
    const rows = insertRows()
    // When the operator reads one generated row,
    const mounted = SATELLITES.map(s => rows.find(r => r.id === s.id))
    // Then the row names the package itself and carries no shell wrapper.
    for (const [index, row] of mounted.entries()) {
      const satellite = SATELLITES[index]
      expect(row?.name, `row ${satellite?.id} must name the package`).toBe(satellite?.pkg)
      expect(row?.plugin, `row ${satellite?.id} must not be shell-wrapped`).toBeUndefined()
      expect(row?.name.startsWith('@linxin666/dsh-web-all/')).toBe(false)
    }
  })

  it('operator declares an explicit semver range rather than a workspace link', () => {
    // Given the satellites now come from the registry,
    const declared = SATELLITES.map(s => [s.pkg, packageJson.dependencies[s.pkg]] as const)
    // When the operator inspects the aggregate dependencies,
    const ranges = declared.map(([, range]) => range)
    // Then each satellite is pinned by a resolvable semver range.
    expect(ranges.filter(range => typeof range === 'string')).toHaveLength(SATELLITES.length)
    for (const range of ranges) {
      expect(range).not.toBe('workspace:*')
      expect(range).toMatch(/^\^?\d+\.\d+\.\d+/)
    }
  })

  it('operator cannot admit a satellite build older than the host migration', () => {
    // Given the satellites version on their own line and a profile upgrade
    // keeps the version its lockfile already resolved,
    const floors = SATELLITES.map(s => packageJson.dependencies[s.pkg])
    // When the operator inspects the declared ranges,
    // Then none of them admits 0.3.24: that build still injects the retired
    // settingsScope service, so a satisfied range would silently keep a client
    // half that waits for it forever.
    for (const range of floors) {
      const floor = String(range).replace(/^[^\d]*/, '').split('.').map(Number)
      const atOrAboveMigration = floor[0] > 0
        || floor[1] > 3
        || (floor[1] === 3 && floor[2] >= 25)
      expect(atOrAboveMigration).toBe(true)
    }
  })

  it('operator can resolve each satellite package.json as the generator does', () => {
    // Given aggregate.mjs resolves an external row through the package manifest,
    const manifests = SATELLITES.map(s => {
      const path = require.resolve(`${s.pkg}/package.json`, { paths: [PACKAGE_DIR] })
      return JSON.parse(readFileSync(path, 'utf8')) as {
        name: string
        exports?: Record<string, string>
      }
    })
    // When the operator resolves every satellite,
    const resolved = manifests.map(manifest => [manifest.name, manifest.exports?.['./package.json']])
    // Then each one names itself and exports the manifest subpath the row needs.
    expect(resolved).toEqual(SATELLITES.map(s => [s.pkg, './package.json']))
  })

  it('operator keeps the subpath exports alive as compat tombstones for old profiles', () => {
    // Given profiles written before the split recorded the aggregate subpath,
    const live = SATELLITES.map(s => [s.subpath, packageJson.exports[s.subpath]] as const)
    // When the operator inspects the generated exports map,
    const resolved = live.map(([subpath, target]) => [subpath, target])
    // Then every historical subpath still resolves to the shared shell re-export.
    expect(resolved).toEqual(SATELLITES.map(s => [s.subpath, './lib/shells/shell.js']))
  })

  it('operator mounts no remote-web-ui row and keeps the remaining remote face before pet', () => {
    // Given the remote-web-ui family retired from this bundle (its package stays
    // installable on its own, but the aggregate no longer mounts it),
    const rows = insertRows()
    // When the operator reads the mount order from the generated patch,
    const order = rows.map(row => row.id)
    // Then no row seat is left for it, and the family's remaining remote face
    // still installs ahead of the external satellite rows.
    expect(order).not.toContain('web-ui-remote-web-ui')
    expect(order).toContain('web-ui-remote-bridge')
    expect(order.indexOf('web-ui-remote-bridge')).toBeLessThan(order.indexOf('web-ui-pet'))
  })

  it('operator mounts each satellite from its own loader entry, never from the aggregate bundle', () => {
    // Given the satellites ship their own loader client entry,
    // When the operator inspects the aggregate's browser bundle,
    const bundle = readFileSync(join(PACKAGE_DIR, 'lib/client.js'), 'utf8')
    // Then no satellite client module is inlined into it: the bundle is the
    // compat layer alone, so a page that never enabled a satellite never
    // downloads its UI (issue #1901).
    const inlined = SATELLITES.filter(s => bundle.includes(s.pkg)).map(s => s.pkg)
    expect(inlined).toEqual([])
  })
})
