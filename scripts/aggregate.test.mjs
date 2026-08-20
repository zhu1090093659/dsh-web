/**
 * Aggregate patch invariants: every INSERT row id is web-ui-* namespaced and
 * unique within one aggregate, and no aggregate id collides with any
 * standalone package's own row id (the coexistence guarantee). The generated
 * files are the contract — scripts/aggregate.mjs --check enforces drift
 * separately.
 */
import { readdirSync, readFileSync } from 'node:fs'
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

const AGGREGATES = ['packages/dsh-web-ui-all/cordis.patch.yml', 'packages/dsh-skins/cordis.patch.yml']

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
      if (normPatch === 'packages/dsh-web-ui-all/cordis.patch.yml' || normPatch === 'packages/dsh-skins/cordis.patch.yml') continue
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

test('web-ui-all mounts dsh-better-sidebar as an external row', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-ui-all/cordis.patch.yml'), 'utf8')
  const lines = patch.split(/\r?\n/)
  const idx = lines.findIndex((line) => /^ {4}- id: web-ui-better-sidebar$/.test(line))
  assert.ok(idx >= 0, 'web-ui-better-sidebar row is missing from the aggregate patch')
  // The paired name line resolves the row from the profile root (npm package).
  assert.match(lines[idx + 1] ?? '', /^ {6}name: 'dsh-better-sidebar'$/)
})
