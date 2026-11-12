import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

/** The content sources are fetched into .market-inputs (market-inputs.lock.json). */
const INPUTS = join(ROOT, '.market-inputs')
const hasInputs = existsSync(join(INPUTS, 'skins'))
  && existsSync(join(INPUTS, 'pet'))
  && existsSync(join(INPUTS, 'community'))
  && existsSync(join(INPUTS, 'presets'))
const SKIP_REASON = 'market inputs not fetched; run node scripts/market-fetch-inputs.mjs'

/** Resolve a package the aggregate depends on, the way market-build does. */
function resolveFamilyPackage(specifier) {
  return dirname(require.resolve(specifier + '/package.json', {
    paths: [join(ROOT, 'packages', 'dsh-web-all'), ROOT],
  }))
}
const SKIN_CENTER_DIR = resolveFamilyPackage('@linxin666/dsh-client-ui-skin-center')

/**
 * Assemble a true clean-checkout fixture: tracking-tree inputs only, no
 * market/shell/dist (the vendored shell build is git-ignored and CI does not
 * rebuild it). market-build --check in such a tree must succeed after the
 * dist was committed by the same sources, and must still reject tampering.
 */
function copyCommittedTree(dir) {
  const pairs = [
    [join(ROOT, 'scripts', 'market-build'), join(dir, 'scripts', 'market-build')],
    [join(ROOT, 'scripts', 'lib', 'market-zip.cjs'), join(dir, 'scripts', 'lib', 'market-zip.cjs')],
    // The pin guard imports this to compare the cache against the gitlinks,
    // plus the shared tar capability helper its tarball fallback uses.
    [join(ROOT, 'scripts', 'market-fetch-inputs.mjs'), join(dir, 'scripts', 'market-fetch-inputs.mjs')],
    [join(ROOT, 'scripts', 'tar-args.cjs'), join(dir, 'scripts', 'tar-args.cjs')],
    [join(ROOT, 'market', 'src'), join(dir, 'market', 'src')],
    [join(ROOT, 'market', 'editor-picks.json'), join(dir, 'market', 'editor-picks.json')],
    [join(ROOT, 'market', 'dist'), join(dir, 'market', 'dist')],
    // The skin, pet, community-index and preset content is fetched from its
    // own repositories; the fixture mirrors the layout market-build reads at
    // runtime.
    [join(INPUTS, 'skins'), join(dir, '.market-inputs', 'skins')],
    [join(INPUTS, 'pet'), join(dir, '.market-inputs', 'pet')],
    // The community index is read as a single JSON file (community.json), so the
    // gate never walks this directory — and a package manager cache left in it by
    // a local install costs tens of thousands of files to copy for nothing. The
    // skin, pet and preset directories are walked by the gate (listFiles), so
    // nothing is filtered there.
    [join(INPUTS, 'community'), join(dir, '.market-inputs', 'community'), { filter: (src) => basename(src) !== 'node_modules' }],
    [join(INPUTS, 'presets'), join(dir, '.market-inputs', 'presets')],
    // Published packages the aggregate depends on. market-build resolves them
    // through the dependency tree; the fixture has no node_modules, so the
    // in-repo fallback paths are populated instead and the package's own
    // dependency tree is linked beside them.
    [join(SKIN_CENTER_DIR, 'lib'), join(dir, 'packages', 'skins', 'skin-center', 'lib')],
    [join(SKIN_CENTER_DIR, 'package.json'), join(dir, 'packages', 'skins', 'skin-center', 'package.json')],
    // The installer source carries MAX_FILES_PER_ASSET; market-build reads the
    // cap from it to reject catalog assets the installer could not install.
    [join(ROOT, 'packages', 'dsh-market', 'src', 'core', 'installer.ts'), join(dir, 'packages', 'dsh-market', 'src', 'core', 'installer.ts')],
  ]
  for (const [from, to, options] of pairs) {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true, ...options })
  }
  // Resolve the skin-center lib imports exactly as a pnpm checkout would.
  // A workspace link keeps its dependencies inside the package; a registry
  // install keeps its dependencies beside it in the pnpm store.
  symlinkSync(
    existsSync(join(SKIN_CENTER_DIR, 'node_modules'))
      ? join(SKIN_CENTER_DIR, 'node_modules')
      : dirname(dirname(SKIN_CENTER_DIR)),
    join(dir, 'packages', 'skins', 'skin-center', 'node_modules'),
  )
}

/**
 * The expensive step is materializing the committed tree byte for byte, and the
 * cost sits in the fetched content cache rather than in the dist: measured on
 * the development machine, `.market-inputs/{pet,community,presets}` is 35421
 * files (6.3-7.9s), `market/dist` is 4678 files / 519MB (1.3s), and
 * `market-build --check` itself is about 2s. One tree therefore serves every
 * case, and each case declares the paths it touches so the tree is put back
 * before the next case runs.
 */
/** How many times the cases below do something that costs a full traversal. */
const materializations = { shared: 0, distOnly: 0 }

function newFixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-clean-'))
  materializations.shared += 1
  copyCommittedTree(dir)
  return dir
}

let sharedDir = null
let sharedStamp = null

/**
 * A path's identity: its kind, its byte size, or the symlink target. Sizes keep
 * the snapshot a single stat walk — hashing 41k fixture files would cost more
 * than the sharing saves.
 */
function stampOf(abs) {
  const stat = lstatSync(abs)
  if (stat.isSymbolicLink()) return 'symlink:' + readlinkSync(abs)
  if (stat.isDirectory()) return 'dir'
  return 'file:' + stat.size
}

/**
 * Every path under a tree, keyed relative to it: its identity stamp plus its
 * timestamp. Symlinks are leaves. Timestamps are recorded per path rather than
 * compared to one clock reading, because the copy that builds the fixture stamps
 * its last files with a sub-millisecond-precision mtime that a millisecond
 * `Date.now()` would read as newer.
 */
function stampTree(root) {
  const out = new Map()
  const walk = (abs, base) => {
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name)
      const rel = base ? base + '/' + name : name
      const stat = lstatSync(p)
      const isLink = stat.isSymbolicLink()
      out.set(rel, { stamp: stampOf(p), mtimeMs: stat.mtimeMs })
      if (!isLink && stat.isDirectory()) walk(p, rel)
    }
  }
  walk(root, '')
  return out
}

/**
 * Assert the shared tree still holds the state it was built in, one stat walk
 * per case (~0.2s). `scratch` names the paths the case declared and already had
 * restored; anything else that appeared, disappeared, changed size or kind, or
 * was written since the build fails here, so a case can neither leak state into
 * the next one nor write somewhere it did not declare.
 */
function assertSharedTreeIntact(scratch) {
  const declared = new Set(scratch)
  const seen = new Set()
  const drifted = []
  const walk = (abs, base) => {
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name)
      const rel = base ? base + '/' + name : name
      const stat = lstatSync(p)
      const isLink = stat.isSymbolicLink()
      seen.add(rel)
      const was = sharedStamp.get(rel)
      if (!declared.has(rel)) {
        if (was === undefined) drifted.push(rel + ' (unexpected)')
        else if (stampOf(p) !== was.stamp) drifted.push(rel + ' (content)')
        // A directory timestamp moves whenever a declared path inside it is
        // restored (the full-build case moves market/dist aside and back), so
        // only file writes are compared; a file added or removed is caught by
        // the path-set assertions above.
        else if (!isLink && !stat.isDirectory() && Math.abs(stat.mtimeMs - was.mtimeMs) > 1) drifted.push(rel + ' (written)')
      }
      if (!isLink && stat.isDirectory()) walk(p, rel)
    }
  }
  walk(sharedDir, '')
  assert.deepEqual([...seen].filter((rel) => !sharedStamp.has(rel)), [], 'a case left new paths in the shared fixture')
  assert.deepEqual([...sharedStamp.keys()].filter((rel) => !seen.has(rel)), [], 'a case removed paths from the shared fixture')
  assert.deepEqual(drifted, [], 'a case modified the shared fixture outside its declared scratch paths')
}

function snapshotPath(abs) {
  if (!existsSync(abs)) return null
  const stat = lstatSync(abs)
  if (stat.isDirectory()) return { dir: true }
  return { dir: false, bytes: readFileSync(abs), mtimeMs: stat.mtimeMs }
}

function restorePath(abs, snap) {
  if (snap === null) {
    rmSync(abs, { recursive: true, force: true })
    return
  }
  if (snap.dir) return
  writeFileSync(abs, snap.bytes)
  // Put the timestamp back too: the next case's guard compares against the
  // build-time stamp, and a restored file must look untouched, not rewritten.
  utimesSync(abs, snap.mtimeMs / 1000, snap.mtimeMs / 1000)
}

/**
 * Borrow the shared fixture for one case. `scratch` lists every path relative to
 * the fixture root the case may create, modify or delete; those bytes are
 * snapshotted first and put back in a cleanup hook, which runs even when the
 * case fails, and the tree is then verified against its build stamp. A case
 * therefore cannot hand its state to the next one — the isolation the per-case
 * private copy used to provide — and a case that writes somewhere it did not
 * declare fails here by name instead of silently corrupting a later case.
 */
/**
 * market-build --check materializes its comparison tree here and removes it on
 * every path that reaches the comparison, but a rejection raised after that emit
 * (verifyTryonManifest on an undeclared tryon file) leaves it behind. It used to
 * disappear with the per-case copy, so the shared tree clears it after each case.
 */
const CHECK_ARTIFACT = '.market-check-tmp'

function borrowFixture(t, scratch) {
  const held = [CHECK_ARTIFACT, ...scratch].map((rel) => [rel, snapshotPath(join(sharedDir, rel))])
  const declared = [CHECK_ARTIFACT, ...scratch]
  t.after(() => {
    for (const [rel, snap] of held) restorePath(join(sharedDir, rel), snap)
    assertSharedTreeIntact(declared)
  })
  return sharedDir
}

/**
 * Borrow the shared fixture for the one case that runs a full build: that build
 * rewrites every file under market/dist, so the dist is moved aside first and a
 * copy of it is handed to the case, keeping the remaining 36k-file input cache
 * shared. The move keeps the original dist inodes untouched, so the cleanup
 * hook restores the exact tree the other cases read.
 */
function borrowWritableDist(t, body) {
  const dist = join(sharedDir, 'market', 'dist')
  const hold = join(sharedDir, '.dist-hold')
  renameSync(dist, hold)
  cpSync(hold, dist, { recursive: true })
  materializations.distOnly += 1
  t.after(() => {
    rmSync(dist, { recursive: true, force: true })
    renameSync(hold, dist)
    assertSharedTreeIntact()
  })
  return body(dist)
}

function runCheck(dir) {
  return spawnSync(process.execPath, ['scripts/market-build', '--check'], { cwd: dir, encoding: 'utf8' })
}

before(() => {
  if (!hasInputs) return
  sharedDir = newFixtureDir()
  sharedStamp = stampTree(sharedDir)
})

after(() => {
  if (sharedDir === null) return
  rmSync(sharedDir, { recursive: true, force: true })
  sharedDir = null
})

const SKINS_SUBMODULE = 'satellites/dsh-skins'
const GITMODULES_NAME = '.gitmodules'

/**
 * Give a fixture the two things git cannot carry in the lockfile: the submodule
 * declaration and the gitlink pin itself. One input is enough to exercise the
 * pin guard; the content directories the build reads are already in place.
 */
function pinSkins(dir, pinSha) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, 'git ' + args.join(' ') + ' failed: ' + result.stderr)
  }
  git('-c', 'init.defaultBranch=main', 'init', '-q')
  writeFileSync(join(dir, GITMODULES_NAME),
    '[submodule "' + SKINS_SUBMODULE + '"]\n\tpath = ' + SKINS_SUBMODULE + '\n\turl = https://github.com/zhu1090093659/dsh-skins.git\n')
  writeFileSync(join(dir, 'market-inputs.lock.json'), JSON.stringify({
    version: 2,
    inputs: { skins: { submodule: SKINS_SUBMODULE, path: 'skins', target: 'skins' } },
  }))
  mkdirSync(join(dir, SKINS_SUBMODULE), { recursive: true })
  git('update-index', '--add', '--cacheinfo', '160000,' + pinSha + ',' + SKINS_SUBMODULE)
}

/** Every path the pin guard's fixture branch adds to the shared tree. */
const PIN_SCRATCH = [GITMODULES_NAME, 'market-inputs.lock.json', join('.market-inputs', 'skins.sha'), 'satellites', '.git']

/** sha256 of every file under a tree, keyed by path relative to it. */
function treeDigest(root) {
  const out = {}
  const walk = (abs, base) => {
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name)
      const rel = base ? base + '/' + name : name
      if (statSync(p).isDirectory()) walk(p, rel)
      else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  walk(root, '')
  return out
}

test('clean checkout (no shell dist) passes market-build --check', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, [])
  const result = runCheck(dir)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /dist up to date/)
})

/**
 * Without the vendored shell build, a full build must not damage the committed
 * try-on tree: emit() preserves tryon/ across the dist rewrite and emitTryon()
 * returns early. The early-return message says "left as-is" precisely because
 * the tree survives — an earlier wording ("not emitted") read as if the build
 * had deleted it (2026-10-02).
 */
test('full build without the shell dist preserves the committed tryon tree and ZIP downloads', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  borrowWritableDist(t, (dist) => {
    const dir = sharedDir
    const before = treeDigest(join(dist, 'tryon'))
    assert.ok(Object.keys(before).length > 0, 'fixture must carry a committed tryon tree')
    const skinsDir = join(dist, 'assets', 'skins')
    const downloads = () => Object.fromEntries(readdirSync(skinsDir)
      .filter(name => name.endsWith('.zip'))
      .map(name => [name, createHash('sha256').update(readFileSync(join(skinsDir, name))).digest('hex')]))
    const beforeDownloads = downloads()
    assert.ok(Object.keys(beforeDownloads).length > 0, 'fixture must carry committed ZIP downloads')
    const result = spawnSync(process.execPath, ['scripts/market-build'], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    // The notice is a console.warn, so it lands on stderr.
    assert.match(result.stderr, /tryon\/ left as-is/)
    assert.deepEqual(treeDigest(join(dist, 'tryon')), before)
    assert.deepEqual(downloads(), beforeDownloads)
    // No preserve directory may be left behind by the rewrite.
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.startsWith('.tryon-preserve-')),
      [],
    )
  })
})

test('check refuses tampered tryon-assets output', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, [join('market', 'dist', 'tryon-assets', 'skins', 'blue-fantasy', 'skin.css')])
  appendFileSync(join(dir, 'market', 'dist', 'tryon-assets', 'skins', 'blue-fantasy', 'skin.css'), '\ntampered{}')
  const result = runCheck(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /tryon-assets\/skins\/blue-fantasy\/skin\.css/)
})

test('check rejects an editor pick that names a missing catalog asset', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, [join('market', 'editor-picks.json')])
  writeFileSync(join(dir, 'market', 'editor-picks.json'),
    JSON.stringify({ items: [{ kind: 'skin', id: 'no-such-skin' }] }))
  const result = runCheck(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /editor picks #0: skin:no-such-skin is not in the skin catalog/)
})

test('check rejects an editor pick outside the skin / pet / plugin kinds', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, [join('market', 'editor-picks.json')])
  writeFileSync(join(dir, 'market', 'editor-picks.json'),
    JSON.stringify({ items: [{ kind: 'preset', id: 'demo' }] }))
  const result = runCheck(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /editor picks #0: kind must be one of skin \/ pet \/ plugin/)
})

test('check refuses to compare dist against a cache that is off the pin', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, PIN_SCRATCH)
  const pinned = 'a'.repeat(40)
  const stale = 'b'.repeat(40)
  pinSkins(dir, pinned)
  writeFileSync(join(dir, '.market-inputs', 'skins.sha'), stale + '\n')

  // Given a cache holding a different commit than the gitlink, When the gate
  // checks dist, Then it fails on the pin rather than reporting dist as stale
  // and naming files to commit: rebuilding from that cache would bake unpinned
  // content into the committed dist.
  const result = runCheck(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /skins: stale/)
  assert.match(result.stderr, /market-fetch-inputs/)
  assert.doesNotMatch(result.stderr, /dist stale/)
})

test('check proceeds to the dist comparison when the cache is on the pin', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, PIN_SCRATCH)
  const pinned = 'c'.repeat(40)
  pinSkins(dir, pinned)
  writeFileSync(join(dir, '.market-inputs', 'skins.sha'), pinned + '\n')

  // Given the cache matches the gitlink, When the gate checks dist, Then the
  // pin guard stays out of the way and the comparison itself decides.
  const result = runCheck(dir)
  assert.doesNotMatch(result.stderr, /not at the pinned commits/)
})

test('check rejects undeclared files inside the committed tryon dir', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = borrowFixture(t, [join('market', 'dist', 'tryon', 'rogue.js')])
  writeFileSync(join(dir, 'market', 'dist', 'tryon', 'rogue.js'), 'rogue')
  const result = runCheck(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /extra: rogue\.js/)
})

/**
 * The guard for the sharing above: the 36k-file input cache is materialized
 * once for the whole file, and the only other traversal is the one dist copy
 * the full-build case needs. A timing budget would be machine-sensitive, so the
 * assertion counts the materializations instead — re-introducing a per-case
 * fixture, or a second full copy anywhere, fails here.
 */
test('the expensive committed tree is materialized once for the whole file', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  assert.equal(materializations.shared, 1)
  assert.equal(materializations.distOnly, 1)
  // The fetched community directory is read through its index file alone, so a
  // package manager cache left there by a local install is not materialized;
  // the index the gate does read must still be present.
  assert.equal(existsSync(join(sharedDir, '.market-inputs', 'community', 'node_modules')), false)
  assert.ok(existsSync(join(sharedDir, '.market-inputs', 'community', 'community.json')))
})
