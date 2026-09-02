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

describe('family subpath display names', () => {
  const patch = readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    name: string
    exports: Record<string, string>
  }
  const rows = parsePatchRows(patch)
  const familyRows = rows.filter(row => row.plugin !== undefined)

  it('every family row mounts its own subpath and keeps the config.plugin contract', () => {
    expect(familyRows.length).toBeGreaterThan(0)
    for (const row of familyRows) {
      expect(row.name).toBe(`${manifest.name}/${row.id.slice('web-ui-'.length)}`)
    }
    // The self row keeps the bare package name (it owns the client face).
    expect(rows.find(row => row.id === 'web-ui-compat')?.name).toBe(manifest.name)
    // The exempted i18n row stays direct.
    const i18n = rows.find(row => row.id === 'web-ui-i18n')
    expect(i18n?.name).toBe('@linxin666/dsh-i18n')
    expect(i18n?.plugin).toBeUndefined()
    // Spot-check the forwarded real plugin of two rows.
    expect(rows.find(row => row.id === 'web-ui-usage')).toMatchObject({
      name: `${manifest.name}/usage`,
      plugin: '@linxin666/dsh-usage',
    })
  })

  it('every family subpath is an exports key resolving to the shared shell re-export', () => {
    for (const row of familyRows) {
      expect(manifest.exports[`.${row.name.slice(manifest.name.length)}`]).toBe('./lib/shells/shell.js')
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
    expect((root.manifest.dsh as Record<string, unknown>).client).toBeDefined()
  })
})
