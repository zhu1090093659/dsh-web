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

test('web-ui-all leaves the unbundled dsh-better-sidebar out of the patch', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  // Alpha-branch decision (2026-09-17): the plugin's 0.19.1 peers declare
  // ^0.1.5-rc.1, which does not cover this branch's 0.1.7-alpha.1 cohort, so the
  // aggregate neither mounts nor depends on it. Re-add the row in aggregate.yml
  // together with this assertion when the branch bundles it again.
  assert.doesNotMatch(patch, /^ {4}- id: web-ui-better-sidebar$/m, 'dsh-better-sidebar must not be a bundled row on the alpha branch')
  assert.doesNotMatch(patch, /^ {6}name: 'dsh-better-sidebar'$/m)
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

test('web-ui-all ships the opt-in family rows disabled by default', () => {
  // The manifest's inactive list renders trailing bare "disabled: true"
  // overrides; users opt in per row in the plugin manager (a user-layer
  // "disabled: false" override wins over the bundle default).
  const yml = readFileSync(join(ROOT, 'packages/dsh-web-all/aggregate.yml'), 'utf8')
  let section = null
  const inactive = []
  for (const raw of yml.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section === 'inactive' && line.startsWith('- ')) inactive.push(line.slice(2).trim())
  }
  assert.ok(inactive.length > 0, 'aggregate.yml should declare inactive opt-in rows')
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  for (const id of inactive) {
    assert.match(patch, new RegExp('^- id: ' + id + '\\n  disabled: true$', 'm'), 'inactive row missing its disabled override: ' + id)
  }
})

test('web-ui-all retires the official archived-sessions page it supersedes', () => {
  // Native-first decision (2026-09-15): dsh-session-archive takes over the
  // official `archived-sessions` settings section (same id and order), so the
  // aggregate disables the row dsh-web-app inserts. Without the retirement,
  // Settings would show two near-identical archive entries.
  const yml = readFileSync(join(ROOT, 'packages/dsh-web-all/aggregate.yml'), 'utf8')
  let section = null
  const retire = []
  for (const raw of yml.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section === 'retire' && line.startsWith('- ')) retire.push(line.slice(2).trim())
  }
  assert.ok(retire.includes('ui-settings-unarchive-sessions'), 'aggregate.yml should retire the official archived-sessions row')
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  for (const id of retire) {
    // A retired row belongs to another bundle's layer, so its id is written
    // verbatim and must never be namespaced like this aggregate's own rows.
    assert.doesNotMatch(patch, new RegExp('^- id: web-ui-' + id + '$', 'm'), 'retired foreign row must not be namespaced: ' + id)
    assert.match(patch, new RegExp('^- id: ' + id + '\n  disabled: true$', 'm'), 'retired foreign row missing its disabled override: ' + id)
  }
})

test('web-ui-all leaves the deprecated @morlay/better-session integration out', () => {
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  // The deprecated integration was removed from the aggregate; these rows must
  // never come back without an explicit re-adoption decision (see the
  // simplification note removing better-session).
  assert.doesNotMatch(patch, /@morlay\//, 'the deprecated better-session integration must not reappear in the aggregate patch')
  assert.doesNotMatch(patch, /^- id: web-ui-(session-branch|session-rdb|conversation-message-actions)$/m, 'better-session sub-plugin rows must not mount')
  assert.doesNotMatch(patch, /@linxin666\/dsh-perf/, 'the removed dsh-perf plugin must not reappear in the aggregate patch')
})
