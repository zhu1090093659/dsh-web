/**
 * Tests for scripts/dsh-skin: the pure managed-section helpers and the
 * `use official` command against a throwaway HOME, so the real ~/.dsh is
 * never touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dshSkin from './dsh-skin'

const { SKINS, MANAGED_START, MANAGED_END, renderManaged, stripManaged, stripLegacySkinRows, currentActive } = dshSkin

// fileURLToPath, not URL.pathname: the latter keeps a leading slash on
// Windows (/D:/...), which node then mis-resolves as D:\D:\...
const SCRIPT = fileURLToPath(new URL('./dsh-skin', import.meta.url))

/** A throwaway DSH_HOME with a patch fixture; returns the patch path. */
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-skin-test-'))
  mkdirSync(join(home, '.dsh'), { recursive: true })
  return home
}

function patchPath(home) {
  return join(home, '.dsh', 'cordis.patch.yml')
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
  const rendered = renderManaged('qq98')
  assert.ok(rendered.includes('- insert:'))
  assert.ok(rendered.includes(`- id: ${SKINS.qq98.id}`))
  // The active skin itself must not be disabled.
  assert.ok(!rendered.includes(`- id: ${SKINS.qq98.id}\n  disabled: true`))
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

test('currentActive returns null when every skin is disabled', () => {
  assert.equal(currentActive(renderManaged(null)), null)
})

test('use official restores the stock look on a throwaway DSH_HOME', () => {
  const home = fakeHome()
  try {
    const patch = patchPath(home)
    const fixture = `# custom row survives\n- id: ui-subagent-tree\n  name: '@deepseek-ai/dsh-client-ui-subagent-tree'\n`
    writeFileSync(patch, fixture)
    execFileSync(process.execPath, [SCRIPT, 'use', 'official'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: join(home, 'code', 'dsh-web-ui') },
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
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: join(home, 'code', 'dsh-web-ui') },
      encoding: 'utf8',
    })
    assert.equal(current.trim(), 'none')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('use <name> still writes an insert row for a non-wired skin', () => {
  const home = fakeHome()
  try {
    // ensureSymlink requires the skin source dir under DSH_SKIN_REPO.
    const repo = join(home, 'code', 'dsh-web-ui')
    mkdirSync(join(repo, 'packages', 'skins', 'qq98'), { recursive: true })
    const patch = patchPath(home)
    writeFileSync(patch, '')
    execFileSync(process.execPath, [SCRIPT, 'use', 'qq98'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
    })
    const after = readFileSync(patch, 'utf8')
    assert.ok(after.includes('- insert:'))
    assert.ok(after.includes(`- id: ${SKINS.qq98.id}`))
    const current = execFileSync(process.execPath, [SCRIPT, 'current'], {
      env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_SKIN_REPO: repo },
      encoding: 'utf8',
    })
    assert.equal(current.trim(), 'qq98')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
