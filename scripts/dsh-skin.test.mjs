/**
 * Tests for scripts/dsh-skin: the pure managed-section helpers and the
 * `use official` command against a throwaway HOME, so the real ~/.dsh is
 * never touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dshSkin from './dsh-skin'

const { SKINS, MANAGED_START, MANAGED_END, renderManaged, normalizePatchForManagedAppend, stripManaged, stripEmptyPatchList, stripLegacySkinRows, currentActive } = dshSkin

// fileURLToPath, not URL.pathname: the latter keeps a leading slash on
// Windows (/D:/...), which node then mis-resolves as D:\D:\...
const SCRIPT = fileURLToPath(new URL('./dsh-skin', import.meta.url))

/** A throwaway DSH_HOME with a patch fixture; returns the patch path. */
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-skin-test-'))
  mkdirSync(join(home, '.dsh', 'profiles', 'web'), { recursive: true })
  return home
}

function patchPath(home) {
  return join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml')
}

function legacyPatchPath(home) {
  return join(home, '.dsh', 'cordis.patch.yml')
}

/** A throwaway skin source dir carrying the manifest the registry scans. */
function fakeSkinDir(repo, name) {
  const dir = join(repo, 'packages', 'skins', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skin.json'), JSON.stringify({
    id: name,
    package: '@linxin666/dsh-client-ui-skin-' + name,
    wiring: { id: 'ui-skin-' + name },
  }))
}

test('renderManaged(null) disables every skin and inserts nothing', () => {
  const rendered = renderManaged(null)
  assert.ok(rendered.startsWith(MANAGED_START))
  assert.ok(rendered.endsWith(MANAGED_END))
  for (const name of Object.keys(SKINS)) {
    assert.ok(rendered.includes(`- id: ${SKINS[name].id}\n  disabled: true`), `expected ${name} disabled`)
  }
  assert.ok(!rendered.includes('- insert:'), 'official must carry no insert row')
})

test('renderManaged(name) keeps one insert row for a non-wired skin', () => {
  const rendered = renderManaged('xp')
  assert.ok(rendered.includes('- insert:'))
  assert.ok(rendered.includes(`- id: ${SKINS.xp.id}`))
  // The active skin itself must not be disabled.
  assert.ok(!rendered.includes(`- id: ${SKINS.xp.id}\n  disabled: true`))
})

test('stripManaged removes only the managed section', () => {
  const patch = `# header\n- id: other\n\n${MANAGED_START}\n- id: ui-skin-xp\n  disabled: true\n${MANAGED_END}\n# footer\n`
  const stripped = stripManaged(patch)
  assert.ok(stripped.includes('# header'))
  assert.ok(stripped.includes('# footer'))
  assert.ok(!stripped.includes('ui-skin-xp'))
  assert.ok(!stripped.includes(MANAGED_START))
})

test('stripManaged throws on an unterminated managed section', () => {
  const patch = `${MANAGED_START}\n- id: ui-skin-xp\n  disabled: true\n`
  assert.throws(() => stripManaged(patch), /unterminated/)
})

test('normalizePatchForManagedAppend removes the default [] root and preserves comments and CRLF', () => {
  const patch = '# profile patch\r\n---\r\n[] # empty sequence\r\n'
  const normalized = normalizePatchForManagedAppend(patch)
  assert.equal(normalized, '# profile patch\r\n---\r\n')
})

test('normalizePatchForManagedAppend rejects non-sequence roots before writing', () => {
  assert.throws(() => normalizePatchForManagedAppend('{}\n'), /top-level block sequence/)
  assert.throws(() => normalizePatchForManagedAppend('[{ id: existing }]\n'), /top-level block sequence/)
  assert.throws(() => normalizePatchForManagedAppend('- id: existing\n[]\n'), /one top-level block sequence/)
  assert.throws(() => normalizePatchForManagedAppend('- id: existing\n---\n- id: second\n'), /one YAML document/)
  assert.throws(() => normalizePatchForManagedAppend('- id: existing\n--- # second document\n- id: second\n'), /one YAML document/)
})

test('renderManaged escapes single quotes in the active package name', () => {
  const original = SKINS.xp.pkg
  try {
    SKINS.xp.pkg = "@linxin666/dsh-client-ui-skin-na'me"
    assert.ok(renderManaged('xp').includes("name: '@linxin666/dsh-client-ui-skin-na''me'"))
  } finally {
    SKINS.xp.pkg = original
  }
})

test('currentActive returns null when every skin is disabled', () => {
  assert.equal(currentActive(renderManaged(null)), null)
})

test('stripEmptyPatchList drops a bare top-level [] but keeps nested lists', () => {
  const patch = `# template\n[]\n- id: other\n  config:\n    tags: []\n`
  const stripped = stripEmptyPatchList(patch)
  assert.ok(!stripped.includes('\n[]\n'), 'bare [] must be removed')
  assert.ok(!stripped.includes('[]\n-'), 'bare [] must be removed even at line start')
  assert.ok(stripped.includes('tags: []'), 'nested mapping value must survive')
  assert.ok(stripped.includes('- id: other'), 'other rows must survive')
})

test('use official on the stock template [] does not leave invalid YAML', () => {
  const home = fakeHome()
  try {
    const repo = join(home, 'code', 'dsh-web-ui')
    for (const name of Object.keys(SKINS)) fakeSkinDir(repo, name)
    const patch = patchPath(home)
    // The stock profile template: comments + an empty patch list. The managed
    // block must replace it, not append after it (issue: boot YAML failure).
    writeFileSync(patch, `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n[]\n`)
    execFileSync(process.execPath, [SCRIPT, 'use', 'official'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })
    const after = readFileSync(patch, 'utf8')
    assert.ok(after.includes(MANAGED_START))
    assert.ok(!/^[ \t]*\[\s*\][ \t]*$/m.test(after), 'no bare [] may survive next to block entries')
    for (const name of Object.keys(SKINS)) {
      assert.ok(after.includes(`- id: ${SKINS[name].id}\n  disabled: true`))
    }
    // A second switch keeps the file valid (managed block rewrite path).
    execFileSync(process.execPath, [SCRIPT, 'use', 'official'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })
    const again = readFileSync(patch, 'utf8')
    assert.ok(!/^[ \t]*\[\s*\][ \t]*$/m.test(again), 're-apply must stay free of bare []')
    assert.ok(again.includes(MANAGED_START))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('use official restores the stock look on a throwaway DSH_HOME', () => {
  const home = fakeHome()
  try {
    const patch = patchPath(home)
    const fixture = `# custom row survives\n- id: ui-subagent-tree\n  name: '@deepseek-ai/dsh-client-ui-subagent-tree'\n`
    writeFileSync(patch, fixture)
    // The registry is scanned from DSH_SKIN_REPO at load: mirror every known
    // skin into the throwaway repo so the subprocess sees the same set.
    const repo = join(home, 'code', 'dsh-web-ui')
    for (const name of Object.keys(SKINS)) fakeSkinDir(repo, name)
    execFileSync(process.execPath, [SCRIPT, 'use', 'official'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })
    const after = readFileSync(patch, 'utf8')
    assert.ok(after.includes('# custom row survives'), 'non-managed rows must be preserved')
    assert.ok(after.includes(MANAGED_START))
    for (const name of Object.keys(SKINS)) {
      assert.ok(after.includes(`- id: ${SKINS[name].id}\n  disabled: true`))
    }
    assert.ok(!after.includes('- insert:'), 'official must not insert any skin row')

    // The CLI's own reading agrees: current prints none.
    const current = execFileSync(process.execPath, [SCRIPT, 'current'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
      encoding: 'utf8',
    })
    assert.equal(current.trim(), 'none')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('use official converts the DSH default [] template into one block-sequence root', () => {
  const home = fakeHome()
  try {
    const repo = join(home, 'code', 'dsh-web-ui')
    for (const name of Object.keys(SKINS)) fakeSkinDir(repo, name)
    const patch = patchPath(home)
    writeFileSync(patch, '# Your patch layer for this dsh profile\r\n[]\r\n')
    chmodSync(patch, 0o600)

    execFileSync(process.execPath, [SCRIPT, 'use', 'official'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })

    const after = readFileSync(patch, 'utf8')
    assert.ok(after.startsWith('# Your patch layer for this dsh profile\r\n'))
    assert.ok(!after.split(/\r?\n/).some(line => line.trim() === '[]'))
    assert.ok(after.includes(MANAGED_START))
    assert.equal(statSync(patch).mode & 0o777, 0o600)
    assert.ok(!readdirSync(join(home, '.dsh', 'profiles', 'web')).some(name => name.startsWith('cordis.patch.yml.tmp-')))
    assert.ok(after.trimEnd().endsWith(MANAGED_END))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('use <name> still writes an insert row for a non-wired skin', () => {
  const home = fakeHome()
  try {
    // ensureSymlink requires the skin source dir under DSH_SKIN_REPO.
    const repo = join(home, 'code', 'dsh-web-ui')
    fakeSkinDir(repo, 'xp')
    const patch = patchPath(home)
    writeFileSync(patch, '')
    execFileSync(process.execPath, [SCRIPT, 'use', 'xp'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })
    const after = readFileSync(patch, 'utf8')
    assert.ok(after.includes('- insert:'))
    assert.ok(after.includes(`- id: ${SKINS.xp.id}`))
    const current = execFileSync(process.execPath, [SCRIPT, 'current'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
      encoding: 'utf8',
    })
    assert.equal(current.trim(), 'xp')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('use migrates the global managed skin row into the web profile', () => {
  const home = fakeHome()
  try {
    const repo = join(home, 'code', 'dsh-web-ui')
    fakeSkinDir(repo, 'xp')
    writeFileSync(legacyPatchPath(home), `${renderManaged('xp')}\n`)

    execFileSync(process.execPath, [SCRIPT, 'use', 'xp'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })

    assert.ok(!readFileSync(legacyPatchPath(home), 'utf8').includes(MANAGED_START))
    const scoped = readFileSync(patchPath(home), 'utf8')
    assert.ok(scoped.includes(MANAGED_START))
    assert.ok(scoped.includes(`- id: ${SKINS.xp.id}`))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
