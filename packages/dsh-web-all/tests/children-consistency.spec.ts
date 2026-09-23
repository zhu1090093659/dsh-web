/**
 * Consistency gate between the aggregate patch rows and the client-children
 * mount list: the row-state ledger keys on each family row's config.plugin
 * (the real plugin package), and the browser gate matches that against the
 * generated children names. A future family row whose config.plugin drifts
 * from the client-child name would silently break the gate, so both
 * directions are asserted here against the generated files.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)

interface FamilyRow {
  id: string
  name: string
  plugin?: string
}

/** Parse the generated aggregate patch into family rows (id, name, config.plugin). */
function familyRows(): FamilyRow[] {
  const patch = readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
  const rows: FamilyRow[] = []
  const pattern = /- id: (web-ui-[^\n]+)\n\s+name: '([^']+)'(\n\s+config:\n\s+plugin: '([^']+)')?/g
  for (const match of patch.matchAll(pattern)) {
    rows.push({ id: match[1] ?? '', name: match[2] ?? '', plugin: match[4] })
  }
  return rows
}

interface ChildSpecifier {
  name: string
  specifier: string
  source: string
}

function clientChildren(): ChildSpecifier[] {
  const text = readFileSync(join(PACKAGE_DIR, 'src/client/children.specifiers.json'), 'utf8')
  return JSON.parse(text) as ChildSpecifier[]
}

describe('family row / client child consistency', () => {
  it('every client child is carried by exactly one family row config.plugin', () => {
    const rows = familyRows()
    const byPlugin = new Map<string, string[]>()
    for (const row of rows) {
      if (row.plugin === undefined) continue
      const ids = byPlugin.get(row.plugin) ?? []
      ids.push(row.id)
      byPlugin.set(row.plugin, ids)
    }
    for (const child of clientChildren()) {
      expect(byPlugin.get(child.name), `client child ${child.name} needs exactly one family row`).toHaveLength(1)
    }
  })

  it('every family row whose real plugin ships a client face is a mounted child', () => {
    const childNames = new Set(clientChildren().map((child) => child.name))
    for (const row of familyRows()) {
      if (row.plugin === undefined) continue
      let manifest: { dsh?: { client?: unknown }; exports?: Record<string, unknown> }
      try {
        manifest = JSON.parse(readFileSync(require.resolve(row.plugin + '/package.json', { paths: [PACKAGE_DIR] }), 'utf8'))
      } catch {
        // External or unresolvable rows (retired, external bundles) are not
        // client-children candidates.
        continue
      }
      const hasClientFace = manifest.dsh?.client !== undefined && manifest.exports?.['./client'] !== undefined
      if (!hasClientFace) continue
      expect(childNames.has(row.plugin), `family row ${row.id} (${row.plugin}) ships a client face but is not in children.specifiers.json — rerun node scripts/aggregate.mjs`).toBe(true)
    }
  })

  it('every shell row name matches the web-all/<family> subpath convention', () => {
    for (const row of familyRows()) {
      if (row.plugin === undefined) continue
      const subpath = row.id.replace(/^web-ui-/, '')
      expect(row.name, `row ${row.id}`).toBe('@linxin666/dsh-web-all/' + subpath)
    }
  })

  it('the shells marker manifest ships beside the built shell module', () => {
    expect(existsSync(join(PACKAGE_DIR, 'src/shells/package.json'))).toBe(true)
  })
})
