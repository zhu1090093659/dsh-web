/**
 * Tests for scripts/dsh-skin (v2): validate / install / use / list / current
 * against throwaway DSH_HOME / DSH_SKINS_HOME, so the real ~/.dsh is never
 * touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./dsh-skin', import.meta.url))

function fixtureSkin(root, id, extra = {}) {
  const dir = join(root, id)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'skin.json'), JSON.stringify({
    skinManifestVersion: 2,
    id,
    name: id,
    nameEn: id,
    version: '1.0.0',
    author: 'tester',
    contributes: { stylesheet: 'skin.css' },
    ...extra,
  }))
  writeFileSync(join(dir, 'skin.css'), ':root { --dsw-alias-bg-base: #112233; }\n')
  return dir
}

function run(args, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-skin-cli-'))
  const fullEnv = { ...process.env, DSH_HOME: join(home, '.dsh'), ...env }
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { env: fullEnv, encoding: 'utf8' })
    return { code: 0, out, home }
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? ''), home }
  }
}

test('validate passes a well-formed skin', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skin-fixture-'))
  const dir = fixtureSkin(root, 'demo')
  const r = run(['validate', dir])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /result: PASS/)
  rmSync(root, { recursive: true, force: true })
})

test('validate fails closed on a whitelist violation', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skin-fixture-'))
  const dir = fixtureSkin(root, 'evil')
  writeFileSync(join(dir, 'skin.css'), '.a { background: url(https://evil.example/x.png); }\n')
  const r = run(['validate', dir])
  assert.equal(r.code, 1)
  assert.match(r.out, /remote URL/)
  rmSync(root, { recursive: true, force: true })
})

test('install copies a valid skin into the user skins dir; uninstall removes it', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skin-fixture-'))
  const dir = fixtureSkin(root, 'demo')
  const install = run(['install', dir])
  assert.equal(install.code, 0, install.out)
  const installed = join(install.home, '.dsh', 'skins', 'demo')
  assert.ok(existsSync(join(installed, 'skin.json')))
  // Second install refuses without --force.
  const again = run(['install', dir], { DSH_HOME: join(install.home, '.dsh') })
  assert.equal(again.code, 1)
  assert.match(again.out, /already exists/)
  const forced = run(['install', dir, '--force'], { DSH_HOME: join(install.home, '.dsh') })
  assert.equal(forced.code, 0, forced.out)
  const uninstall = run(['uninstall', 'demo'], { DSH_HOME: join(install.home, '.dsh') })
  assert.equal(uninstall.code, 0, uninstall.out)
  assert.ok(!existsSync(installed))
  rmSync(root, { recursive: true, force: true })
})

test('install refuses hooks-bearing skins without --allow-hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skin-fixture-'))
  const dir = fixtureSkin(root, 'hooked', {
    facets: { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
  })
  writeFileSync(join(dir, 'hooks.mjs'), 'export default () => ({ apply() {} })\n')
  const r = run(['install', dir])
  assert.equal(r.code, 1)
  assert.match(r.out, /--allow-hooks/)
  const allowed = run(['install', dir, '--allow-hooks'], { DSH_HOME: join(r.home, '.dsh') })
  assert.equal(allowed.code, 0, allowed.out)
  rmSync(root, { recursive: true, force: true })
})

test('use writes the selection; current reads it; official clears it', () => {
  const use = run(['use', 'harbor'])
  assert.equal(use.code, 0, use.out)
  const env = { DSH_HOME: join(use.home, '.dsh') }
  const current = run(['current'], env)
  assert.equal(current.out.trim(), 'harbor')
  const off = run(['use', 'official'], env)
  assert.equal(off.code, 0, off.out)
  const after = run(['current'], env)
  assert.equal(after.out.trim(), 'none')
})

test('use rejects an unknown skin', () => {
  const r = run(['use', 'no-such-skin'])
  assert.equal(r.code, 1)
  assert.match(r.out, /unknown skin/)
})

test('list shows builtin skins and diagnostics', () => {
  const r = run(['list'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /harbor \[builtin\]/)
  assert.match(r.out, /active:/)
})
test('validate warns (not fails) on a partial primary-action token set', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skin-fixture-'))
  const dir = fixtureSkin(root, 'halftone')
  writeFileSync(join(dir, 'skin.css'), [
    ':root {',
    '  --dsw-alias-button-primary-fill: #2fbf8f;',
    '  --dsw-alias-button-primary-hover: #45cba0;',
    '}',
  ].join('\n'))
  const r = run(['validate', dir])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /warning: primary action contract: "label-primary-foreground" is not defined/)
  assert.match(r.out, /warning: primary action contrast/)
  rmSync(root, { recursive: true, force: true })
})
