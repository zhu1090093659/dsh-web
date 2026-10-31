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
  for (const base of ['packages']) {
    if (!existsSync(join(ROOT, base))) continue
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
  for (const base of ['packages']) {
    if (!existsSync(join(ROOT, base))) continue
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
  // ^0.1.5-rc.1, which does not cover this branch's 0.2.1-rc.3 cohort, so the
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

test('web-ui-all leaves the removed describe-image/desktop-launcher/doctor/dsh-perf/model-capabilities families on no surface at all', () => {
  // 2026-09-23 product decision: dsh-doctor and dsh-tool-describe-image were
  // removed from the family. They later lost their shells too: no tombstone
  // subpath, no retirement-registry entry, no shell-metadata display resources
  // and no exports key (subpath, icon, locale) is kept for them. The accepted
  // cost is a stale profile row naming one of these specifiers failing at
  // import time instead of soft-failing through the shell, so any of these
  // surfaces coming back has to be a re-adoption decision, not an accident.
  const yml = 'packages/dsh-web-all/aggregate.yml'
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  const tombstones = scalarEntriesOf(yml, 'tombstones')
  const retired = flowEntriesOf(yml, 'retiredPlugins')
  const notes = shellNotesOf(yml)
  for (const family of ['describe-image', 'desktop-launcher', 'doctor', 'dsh-perf', 'model-capabilities']) {
    assert.doesNotMatch(patch, new RegExp('web-ui-' + family), 'removed plugin must not reappear as a patch row: ' + family)
    assert.ok(!tombstones.includes(family), 'removed family must not keep a tombstone subpath: ' + family)
    assert.ok(!retired.some((entry) => entry.family === family), 'removed family must not be registered as retired: ' + family)
    assert.ok(!notes.has(family), 'removed family must not keep shell display metadata: ' + family)
    const keys = ['./' + family, './' + family + '/icon', ...SHELL_METADATA_LOCALES.map((locale) => './' + family + '/locale/' + locale + '.json')]
    for (const key of keys) assert.ok(!(key in pkg.exports), 'removed family must not keep an exports key: ' + key)
  }
  assert.ok(!('@linxin666/dsh-doctor' in pkg.dependencies), 'dsh-doctor must not be a workspace dependency')
  assert.ok(!('@linxin666/dsh-tool-describe-image' in pkg.dependencies), 'dsh-tool-describe-image must not be a workspace dependency')
})

const SHELL_METADATA_LOCALES = ['en', 'ru', 'zh']

/** Family subpaths the aggregate exports (single-segment keys resolving to the shell). */
function familySubpaths() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  return Object.entries(pkg.exports)
    .filter(([key, target]) => target === './lib/shells/shell.js' && key.startsWith('./') && !key.slice(2).includes('/'))
    .map(([key]) => key.slice(2))
    .sort()
}

/** One locale metadata file of one family subpath, parsed. */
function shellMetadataOf(sub, locale) {
  return JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/shell-metadata', sub, 'locale', locale + '.json'), 'utf8'))
}

/** shellNotes entries of an aggregate manifest, keyed by family subpath. */
function shellNotesOf(relPath) {
  const notes = new Map()
  let section = null
  for (const raw of readFileSync(join(ROOT, relPath), 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section !== 'shellNotes' || !line.startsWith('- ')) continue
    const entry = JSON.parse(line.slice(2).trim().replace(/\s+#.*$/, ''))
    notes.set(entry.id, entry)
  }
  return notes
}

test('web-ui-all shell metadata covers exactly the exported family subpaths', () => {
  const shellSubs = familySubpaths()
  const metadataRoot = join(ROOT, 'packages/dsh-web-all/shell-metadata')
  const dirs = readdirSync(metadataRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(dirs, shellSubs, 'stale or missing shell metadata directories')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  const notes = shellNotesOf('packages/dsh-web-all/aggregate.yml')
  for (const sub of shellSubs) {
    assert.equal(pkg.exports['./' + sub + '/icon'], './icon.svg', sub + ' must export the family icon')
    const title = notes.get(sub)?.title
    assert.ok(title, sub + ' shellNotes entry must carry a title object')
    assert.notEqual(title.zh, title.en, sub + ' zh and en titles must not be the same text')
    for (const locale of SHELL_METADATA_LOCALES) {
      const exportKey = './' + sub + '/locale/' + locale + '.json'
      const target = './shell-metadata/' + sub + '/locale/' + locale + '.json'
      assert.equal(pkg.exports[exportKey], target, sub + ' must export its ' + locale + ' metadata')
      // The row label is the family's own localized title from shellNotes; ru
      // has no title of its own and reuses en. `web-all/<family>` is the
      // specifier shape, never display copy.
      const rendered = shellMetadataOf(sub, locale).meta?.title
      assert.equal(rendered, locale === 'ru' ? title.en : title[locale], sub + ' ' + locale + ' title must come from shellNotes')
      assert.doesNotMatch(String(rendered), /^web-all\//, sub + ' ' + locale + ' title must not be the web-all/<family> placeholder')
    }
  }
})

test('web-ui-all family rows carry a one-line purpose description from aggregate.yml', () => {
  // The official plugin inventory renders meta.description as the gray line
  // under a row title. aggregate.yml's shellNotes section is its only source,
  // and a family subpath without a note fails "node scripts/aggregate.mjs".
  const shellSubs = familySubpaths()
  const notes = shellNotesOf('packages/dsh-web-all/aggregate.yml')
  assert.deepEqual([...notes.keys()].sort(), shellSubs, 'shellNotes must cover exactly the exported family subpaths')
  for (const sub of shellSubs) {
    const note = notes.get(sub)
    for (const locale of SHELL_METADATA_LOCALES) {
      const description = shellMetadataOf(sub, locale).meta?.description
      assert.equal(typeof description, 'string', sub + ' ' + locale + ' metadata must carry a description')
      assert.ok(description.trim() !== '', sub + ' ' + locale + ' description must not be blank')
      assert.equal(description, note[locale], sub + ' ' + locale + ' description must come from shellNotes')
    }
    // The Chinese line is capped so it stays on one line under the title.
    const han = [...note.zh].filter(char => /\p{Script=Han}/u.test(char)).length
    assert.ok(han > 0 && han <= 20, sub + ' zh note must be 1-20 Han characters, got ' + han)
    assert.notEqual(note.zh, note.en, sub + ' zh and en notes must be different text')
  }
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

test('family rows mount the real plugin package, never a shell subpath with a config block', () => {
  // Issue #1901: a family row names its plugin package directly. That is what
  // makes the loader serve the package's own browser half, so the row needs no
  // shell wrapper and no `config.plugin` indirection — and the Host settings
  // surface keeps editing that package's own Config schema, exactly as a
  // standalone install of the same package does.
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const lines = patch.split(/\r?\n/)
  let checked = 0
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].match(/^ {4}- id: (web-ui-[a-z0-9-]+)$/)
    if (!id) continue
    const name = (lines[i + 1] ?? '').match(/^ {6}name: '([^']+)'$/)
    assert.ok(name, 'row ' + id[1] + ' must carry a name')
    assert.doesNotMatch(name[1], /^@linxin666\/dsh-web-all\//u, 'row ' + id[1] + ' still mounts a shell subpath')
    for (let j = i + 2; j < lines.length && /^ {6}\S/.test(lines[j]); j++) {
      assert.doesNotMatch(lines[j], /^ {6}config:$/u, 'row ' + id[1] + ' still carries a shell config block')
    }
    checked += 1
  }
  assert.ok(checked > 10, 'expected the generated patch to carry the family rows, found ' + checked)
})

test('web-ui-all declares no retire target the current cohort no longer mounts', () => {
  // The official bundles alpha.2 ships mount no row this aggregate supersedes:
  // the official archived-sessions page (`ui-settings-unarchive-sessions`) is
  // gone from dsh-web-app, so a retire override for it changed nothing while
  // making the loader warn `patch: entry ... not found` on every profile boot.
  // `dsh-session-archive` seats its own `dsh-session-archive` section id at
  // order 25 (2026-10-27 coexistence decision), so no archive seat is taken
  // over and no foreign row needs retiring. Declaring a target again requires
  // proving the foreign row exists in the SAME cohort with
  // `dsh --profile <name> --dump-config`, then updating this test.
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
  assert.deepEqual(retire, [], 'retire targets must be verified against the installed cohort before being declared')
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /^- id: ui-settings-unarchive-sessions$/m, 'the aggregate must not patch a foreign row no bundle mounts')
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

test('familyIds overrides keep the aggregate row id off the child id derivation', () => {
  // A child's OWN row id lives in the loader's global id space, so a child
  // may have to change it to stop colliding with a row an official bundle
  // already claims (#1794). The derived namespacing would drag the aggregate
  // row id and its family subpath export along with it, moving two published
  // identifiers; familyIds decouples them. Each entry must name a row this
  // aggregate really mounts, stay inside the web-ui-* id space, and still
  // differ from the child's own id (that difference IS the coexistence
  // guarantee for a standalone install sitting beside the aggregate).
  const yml = readFileSync(join(ROOT, 'packages/dsh-web-all/aggregate.yml'), 'utf8')
  let section = null
  const overrides = new Map()
  for (const raw of yml.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/u)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section === 'familyIds') {
      const mapping = line.match(/^([A-Za-z0-9_.-]+):\s*(\S+)$/u)
      assert.ok(mapping, 'familyIds entry must be "<child row id>: <aggregate row id>": ' + line)
      overrides.set(mapping[1], mapping[2])
    }
  }
  assert.ok(overrides.size > 0, 'the dsh-plugin-manager child pins its family row id')
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  const aggregateIds = new Set(idsOf('packages/dsh-web-all/cordis.patch.yml'))
  for (const [childId, familyId] of overrides) {
    assert.match(familyId, /^web-ui-[a-z0-9-]+$/, 'an override must stay in the aggregate id space: ' + familyId)
    assert.ok(aggregateIds.has(familyId), 'an override must name a row this aggregate mounts: ' + familyId)
    assert.notEqual(familyId, childId, 'an override that equals the child id would re-create the duplicate row it exists to avoid')
    assert.match(patch, new RegExp('^ {4}- id: ' + familyId + '$', 'mu'), 'the aggregate patch must mount the overridden id: ' + familyId)
  }
})

test('a host-only child row keeps its platform guard in the aggregate patch', () => {
  // dsh-win-bash is a host-only family package whose own patch row carries
  // `disabled: !!js process.platform !== 'win32'`: the vendored payload is a
  // Windows x64 build and the tool never falls back to a bash found on PATH, so
  // the row must cost nothing on POSIX. The generator used to preserve scalar
  // row options for PATCH rows only, which silently dropped this guard and
  // mounted a Windows-only row on every host. The child's row options are
  // carried verbatim, after name/config so every row parser in the repository
  // still finds them adjacent.
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  assert.match(
    patch,
    /- id: web-ui-win-bash\n {6}name: '@linxin666\/dsh-win-bash'\n {6}disabled: !!js process\.platform !== 'win32'\n/u,
    'the win-bash family row must carry the child platform guard verbatim',
  )
  const child = readFileSync(join(ROOT, 'packages/dsh-win-bash/cordis.patch.yml'), 'utf8')
  assert.match(child, /disabled: !!js process\.platform !== 'win32'/u, 'the child keeps its own guard')
})

test('a child bare patch row keeps its scalar overrides and spells no empty name', () => {
  // packages/dsh-plugin-manager retires the official `ui-settings-plugins`
  // settings entry from a top-level bare row (`- id: …` + `disabled: true`, no
  // `name:`) — the shape parsePatchBlocks documents for patching a row this
  // repository does not own. Patch rows used to render through the insert path
  // only half-way: `row.extraLines` was never written (so `disabled: true`
  // vanished and the override did nothing) and the absent name became
  // `name: ''`, an empty specifier inside the loader entry.
  const child = readFileSync(join(ROOT, 'packages/dsh-plugin-manager/cordis.patch.yml'), 'utf8')
  assert.match(
    child,
    /^- id: ui-settings-plugins\n {2}disabled: true$/mu,
    'the child declares the bare patch row this case is about',
  )

  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  assert.match(
    patch,
    /^- id: ui-settings-plugins\n {2}disabled: true$/mu,
    'the aggregate carries the bare patch row verbatim, override included',
  )
  assert.doesNotMatch(patch, /^- id: ui-settings-plugins\n {2}name:/mu, 'a bare patch row names no package')
  assert.doesNotMatch(patch, /^ {2}name: ''$/mu, 'no row in the aggregate may carry an empty package name')
})

test('the win-bash family row and subpath use the short family name', () => {
  // The child id names its package (\`dsh-win-bash\`, pinned by that package's
  // AGENTS.md), so deriving the aggregate id would produce
  // \`web-ui-dsh-win-bash\` and the subpath \`dsh-win-bash\`. Family subpaths are
  // the short names (ssh / usage / liangshen), so familyIds pins the pair at
  // \`web-ui-win-bash\` / \`win-bash\` from the first release.
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  assert.match(patch, /^ {4}- id: web-ui-win-bash$/mu, 'the family row id is the short web-ui-win-bash')
  assert.doesNotMatch(patch, /web-ui-dsh-win-bash/u, 'the derived package-prefixed id must not appear')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  assert.equal(pkg.exports['./win-bash'], './lib/shells/shell.js', 'the short family subpath must resolve to the shell')
  assert.equal(pkg.dependencies['@linxin666/dsh-win-bash'], 'workspace:*', 'the aggregate pulls the child as a workspace dep')
})

test('the plugin-manager family row id and subpath survive its standalone row rename', () => {
  // Published identifiers: the aggregate row id `web-ui-plugin-manager`, the
  // family subpath `@linxin666/dsh-web-all/plugin-manager` and the matching
  // `./plugin-manager` export. The standalone child row id changed to avoid
  // the official `ui-plugin-manager` row (#1794); these must not move with it,
  // or every existing profile carrying an override for the family row would
  // boot with a patch-not-found warning and a row that silently re-enables.
  const patch = readFileSync(join(ROOT, 'packages/dsh-web-all/cordis.patch.yml'), 'utf8')
  assert.match(
    patch,
    /- id: web-ui-plugin-manager\n {6}name: '@linxin666\/dsh-client-ui-plugin-manager'\n/u,
    'the plugin-manager family row must keep its id and mount the real plugin package',
  )
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  assert.equal(pkg.exports['./plugin-manager'], './lib/shells/shell.js', 'the family subpath export must stay resolvable')
  const childPatch = readFileSync(join(ROOT, 'packages/dsh-plugin-manager/cordis.patch.yml'), 'utf8')
  assert.match(childPatch, /- id: ui-plugin-manager-update-check/u, 'the standalone row keeps its own id')
})

/** Entries of one aggregate manifest section, parsed as single-line JSON flow mappings. */
function flowEntriesOf(ymlPath, wantedSection) {
  const entries = []
  let section = null
  for (const raw of readFileSync(join(ROOT, ymlPath), 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section !== wantedSection || !line.startsWith('- ')) continue
    entries.push(JSON.parse(line.slice(2).trim().replace(/\s+#.*$/, '')))
  }
  return entries
}

/** Plain scalar list entries of one aggregate manifest section. */
function scalarEntriesOf(ymlPath, wantedSection) {
  const entries = []
  let section = null
  for (const raw of readFileSync(join(ROOT, ymlPath), 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sectionMatch = line.match(/^[A-Za-z0-9_-]+:\s*$/)
    if (sectionMatch) {
      section = line.slice(0, -1)
      continue
    }
    if (section === wantedSection && line.startsWith('- ')) entries.push(line.slice(2).trim())
  }
  return entries
}

test('web-ui-all registers each retired plugin as a tombstone, not a dependency, and matches the generated registry pair for pair', () => {
  // shell 会跳过生成登记表里每个包的 import，所以这条用例同时钉住三件事：退役家族
  // 的子路径要留在 tombstones 里（旧 profile 仍按子路径 import 这个家族），退役包
  // 名不能同时是依赖（已挂载的包不能被空操作分支吞掉），生成模块要与 manifest 逐
  // 条一致。remote-web-ui 迁出为独立仓库后由聚合包静默退役，是这张登记表的第一次
  // 真实登记，因此断言钉的是「登记了哪些」，而不是「必须为空」。
  const yml = 'packages/dsh-web-all/aggregate.yml'
  const retired = flowEntriesOf(yml, 'retiredPlugins')
  // 段标题本身也要留着：登记机制在，未来的退役继续往这一段加条目。
  assert.match(readFileSync(join(ROOT, yml), 'utf8'), /^retiredPlugins:$/m, 'aggregate.yml must keep the retiredPlugins section header')
  const tombstones = new Set(scalarEntriesOf(yml, 'tombstones'))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/dsh-web-all/package.json'), 'utf8'))
  const families = new Set()
  const plugins = new Set()
  for (const entry of retired) {
    assert.match(entry.family, /^[a-z0-9-]+$/, 'retired family is a subpath: ' + entry.family)
    assert.ok(tombstones.has(entry.family), 'retired family must keep its tombstone subpath export: ' + entry.family)
    assert.ok(!(entry.plugin in pkg.dependencies), 'a retired plugin must not also be a dependency: ' + entry.plugin)
    assert.ok(!families.has(entry.family), 'duplicate retired family: ' + entry.family)
    assert.ok(!plugins.has(entry.plugin), 'duplicate retired plugin: ' + entry.plugin)
    families.add(entry.family)
    plugins.add(entry.plugin)
  }
  const generated = readFileSync(join(ROOT, 'packages/dsh-web-all/src/retired-plugins.generated.ts'), 'utf8')
  for (const entry of retired) {
    assert.ok(generated.includes("'" + entry.family + "': '" + entry.plugin + "'"), 'generated registry is missing ' + entry.family + ' -> ' + entry.plugin)
  }
  // 生成模块从 manifest 派生，所以两个方向都要对得上：manifest 的每条都要出现在
  // RETIRED_FAMILIES 里，RETIRED_FAMILIES 的每条也要回到 manifest。只比条数会放过
  // 同条数的错配，这里比的是成对的 family -> plugin。
  const generatedPairs = [...generated.matchAll(/^  '([^']+)': '([^']+)',$/gm)]
    .map((match) => match[1] + ' -> ' + match[2])
    .sort()
  const declaredPairs = retired.map((entry) => entry.family + ' -> ' + entry.plugin).sort()
  assert.deepEqual(generatedPairs, declaredPairs, 'the generated RETIRED_FAMILIES must carry exactly the manifest entries, pair for pair')
  // RETIRED_PLUGINS 是 RETIRED_FAMILIES 的派生值，派生关系本身也是被钉住的事实。
  assert.match(generated, /Object\.values\(RETIRED_FAMILIES\)\.sort\(\)/u, 'RETIRED_PLUGINS must stay derived from RETIRED_FAMILIES')
})
