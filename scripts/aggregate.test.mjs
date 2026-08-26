/**
 * Aggregate patch invariants: every INSERT row id is web-ui-* namespaced and
 * unique within one aggregate, and no aggregate id collides with any
 * standalone package's own row id (the coexistence guarantee). The generated
 * files are the contract — scripts/aggregate.mjs --check enforces drift
 * separately.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPT_DIR, '..')

/** Parse the INSERT row ids of one cordis.patch.yml (rows are indented under
 *  an `- insert:` block; top-level `- id:` entries are excluded). */
function idsOf(relPath) {
  const lines = readFileSync(join(ROOT, relPath), 'utf8').split(/\r?\n/)
  return lines
    .filter((line) => /^ {4}- id: /.test(line))
    .map((line) => line.trim().replace(/^- id: /, ''))
}

const AGGREGATES = ['packages/dsh-web-all/cordis.patch.yml']

test('aggregate rows are web-ui-* namespaced and unique', () => {
  for (const rel of AGGREGATES) {
    const ids = idsOf(rel)
    assert.ok(ids.length > 0, `${rel} should carry rows`)
    assert.equal(new Set(ids).size, ids.length, `${rel} ids must be unique`)
    for (const id of ids) {
      assert.match(id, /^web-ui-[a-z0-9-]+$/, `${rel} id must be namespaced: ${id}`)
    }
  }
})

test('aggregate ids never collide with standalone package ids', () => {
  const aggregateIds = new Set(AGGREGATES.flatMap(idsOf))
  const standalonePatches = []
  for (const base of ['packages', 'packages/skins']) {
    for (const entry of readdirSync(join(ROOT, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const patch = join(base, entry.name, 'cordis.patch.yml')
      const abs = join(ROOT, patch)
      try {
        readFileSync(abs)
      } catch {
        continue
      }
      const normPatch = patch.replaceAll('\\', '/')
      if (normPatch === 'packages/dsh-web-all/cordis.patch.yml') continue
      standalonePatches.push(patch)
    }
  }
  assert.ok(standalonePatches.length > 10, 'expected to scan the standalone packages')
  for (const patch of standalonePatches) {
    for (const id of idsOf(patch)) {
      assert.ok(!aggregateIds.has(id), `aggregate id "${id}" collides with standalone row in ${patch}`)
    }
  }
})

test('no aggregate deps entry resolves to a private workspace package', () => {
  const aggregates = []
  for (const base of ['packages', 'packages/skins']) {
    for (const entry of readdirSync(join(ROOT, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const yml = join(base, entry.name, 'aggregate.yml')
      if (existsSync(join(ROOT, yml))) aggregates.push(yml)
    }
  }
  assert.ok(aggregates.length >= 1, 'expected at least one aggregate manifest')
  for (const yml of aggregates) {
    let section = null
    for (const raw of readFileSync(join(ROOT, yml), 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
      if (sectionMatch) {
        section = line.slice(0, -1)
        continue
      }
      if (section !== 'deps' || !line.startsWith('- ')) continue
      const entry = line.slice(2).trim().replace(/\s+#.*$/, '')
      const pkgPath = join(ROOT, dirname(yml), entry, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      assert.notEqual(pkg.private, true, 'aggregate deps entry is private: ' + yml + ' -> ' + entry)
    }
  }
})

test('web-ui-all mounts dsh-better-sidebar as an external row', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const lines = patch.split(/\r?\n/)
  const idx = lines.findIndex((line) => /^ {4}- id: web-ui-better-sidebar$/.test(line))
  assert.ok(idx >= 0, 'web-ui-better-sidebar row is missing from the aggregate patch')
  // The paired name line resolves the row from the profile root (npm package).
  assert.match(lines[idx + 1] ?? '', /^ {6}name: 'dsh-better-sidebar'$/)
})

test('web-ui-all embeds dsh-session-enhance as an external patch (replacing dsh-archive-manager)', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const lines = patch.split(/\r?\n/)
  // The superseded @mlgbnb/dsh-archive-manager row is gone.
  assert.equal(lines.some((line) => /^ {4}- id: web-ui-archive-manager$/.test(line)), false, 'web-ui-archive-manager row must be removed')
  // External patch header.
  const headerIdx = lines.findIndex((line) => line === '# external patch: dsh-session-enhance')
  assert.ok(headerIdx >= 0, 'dsh-session-enhance external patch block is missing')
  // Default service rows are disabled verbatim.
  const patchTail = lines.slice(headerIdx).join('\n')
  assert.match(patchTail, /- id: workspace\n  disabled: true/)
  assert.match(patchTail, /- id: session-projection-cache\n  disabled: true/)
  assert.match(patchTail, /- id: ui-workspace\n  disabled: true/)
  // The four replacement rows are namespaced web-ui-* and resolve the package subpaths.
  for (const row of [
    ['web-ui-workspace-dsh-session-enhance', 'dsh-session-enhance/workspace'],
    ['web-ui-session-projection-cache-dsh-session-enhance', 'dsh-session-enhance/projcache'],
    ['web-ui-message-edit-dsh-session-enhance', 'dsh-session-enhance/message-edit'],
    ['web-ui-ui-workspace-dsh-session-enhance', 'dsh-session-enhance'],
  ]) {
    const idx = lines.findIndex((line) => line === `    - id: ${row[0]}`)
    assert.ok(idx >= 0, `${row[0]} row is missing from the aggregate patch`)
    assert.match(lines[idx + 1] ?? '', new RegExp(`^ {6}name: '${row[1].replace(/'/g, "\\'")}'$`))
  }
  // The projcache row keeps its config block.
  const projIdx = lines.findIndex((line) => line === '    - id: web-ui-session-projection-cache-dsh-session-enhance')
  assert.match(lines[projIdx + 3] ?? '', /^ {8}writeEveryEvents: 200$/)
})
