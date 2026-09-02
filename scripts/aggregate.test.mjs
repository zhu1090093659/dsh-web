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

test('web-ui-all does not mount the dsh-client-runtime-dependent @mlgbnb/dsh-archive-manager', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  // @mlgbnb/dsh-archive-manager imports the removed @deepseek-ai/dsh-client-runtime
  // face, so on the alpha.2 cohort the host loader cannot resolve its entry and
  // the whole boot fails. Its latest upstream build is still 1.0.7, so it stays
  // excluded; re-add the row and this assertion together with package.json deps
  // when upstream ships an alpha.2-compatible build.
  assert.doesNotMatch(patch, /^ {4}- id: web-ui-archive-manager$/m, '@mlgbnb/dsh-archive-manager must not be mounted on the alpha.2 cohort')
})

test('web-ui-all leaves the deprecated @morlay/better-session integration out', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const lines = patch.split(/\r?\n/)
  // The deprecated integration was removed from the aggregate; these rows must
  // never come back without an explicit re-adoption decision (see the
  // simplification note removing better-session).
  assert.doesNotMatch(patch, /@morlay\//, 'the deprecated better-session integration must not reappear in the aggregate patch')
  assert.doesNotMatch(patch, /^- id: web-ui-(session-branch|session-rdb|conversation-message-actions)$/m, 'better-session sub-plugin rows must not mount')
  // The bundle's own harness patch rows must NOT appear at all: they retune
  // other entries, and emitting them behind another same-id row would merge
  // into that target instead of staying inert.
  assert.equal(lines.filter((line) => line === '- id: session-persistence-jsonl').length, 1, 'exactly the dsh-perf tuning row may touch session-persistence-jsonl')
})
