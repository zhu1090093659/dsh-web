/**
 * Host-side skin-switch tests for the in-process port of `dsh-skin use/current`
 * (src/skin-switch.ts). These run against a throwaway HOME so the real
 * ~/.dsh is never touched: they assert the managed patch-section rewrite, the
 * profile node_modules symlink, the active-skin reading, and the
 * skin.json-derived registry — mirroring scripts/dsh-skin.test.mjs.
 * @module @linxin666/dsh-client-ui-skin-center/tests/skin-switch
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  MANAGED_START,
  MANAGED_END,
  renderManaged,
  stripManaged,
  currentActive,
  loadRegistry,
  wiredNames,
  useSkin,
  currentSkin,
  resolvePaths,
  type SkinSwitchEntry,
} from '../src/skin-switch.ts'

/** A throwaway HOME with an empty .dsh dir; removed after all tests. */
let home: string
afterAll(() => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
})

function fakeHome(): string {
  home = mkdtempSync(join(tmpdir(), 'skin-switch-test-'))
  mkdirSync(join(home, '.dsh'), { recursive: true })
  // Mirror the CLI test: the profile symlink target is the real repo skin dir.
  mkdirSync(join(home, 'code', 'dsh-web-ui', 'packages', 'skins'), { recursive: true })
  return home
}

function patchPath(h: string): string {
  return join(h, '.dsh', 'cordis.patch.yml')
}

/** A minimal registry for pure-function tests (deterministic, no disk reads). */
function miniRegistry(exclude = [] as string[]): Record<string, SkinSwitchEntry> {
  const base = loadRegistry()
  for (const name of exclude) delete base[name]
  return base
}

describe('skin registry derivation (from skin.json wiring)', () => {
  it('loadRegistry() maps every installed skin to its wiring metadata', () => {
    const registry = loadRegistry()
    expect(registry.qq98).toEqual(expect.objectContaining({
      pkg: '@linxin666/dsh-client-ui-skin-qq98',
      id: 'ui-skin-qq98',
    }))
    expect(registry.ths).toEqual(expect.objectContaining({ id: 'ui-skin-ths' }))
    expect(registry['blue-fantasy']).toEqual(expect.objectContaining({
      pkg: '@linxin666/dsh-client-ui-skin-blue-fantasy',
      id: 'ui-skin-blue-fantasy',
    }))
    // xp is bundle-wired (carries no insert row) — the repo's skin.json truth.
    expect(registry.xp.bundleWired).toBe(true)
    expect(wiredNames(registry).has('xp')).toBe(true)
  })
})

describe('pure patch helpers', () => {
  it('renderManaged(null) disables every skin and inserts nothing', () => {
    const registry = miniRegistry()
    const rendered = renderManaged(null, registry)
    expect(rendered.startsWith(MANAGED_START)).toBe(true)
    expect(rendered.endsWith(MANAGED_END)).toBe(true)
    for (const name of Object.keys(registry)) {
      expect(rendered).toContain(`- id: ${registry[name].id}\n  disabled: true`)
    }
    expect(rendered).not.toContain('- insert:')
  })

  it('renderManaged(name) keeps one insert row for a non-wired skin', () => {
    const registry = miniRegistry()
    const rendered = renderManaged('qq98', registry)
    expect(rendered).toContain('- insert:')
    expect(rendered).toContain(`- id: ${registry.qq98.id}`)
    expect(rendered).not.toContain(`- id: ${registry.qq98.id}\n  disabled: true`)
  })

  it('renderManaged(wired skin) needs no insert row', () => {
    const registry = miniRegistry()
    const rendered = renderManaged('xp', registry)
    expect(rendered).not.toContain('- insert:')
  })

  it('stripManaged removes only the managed section', () => {
    const patch = `# header\n- id: other\n\n${MANAGED_START}\n- id: ui-skin-xp\n  disabled: true\n${MANAGED_END}\n# footer\n`
    const stripped = stripManaged(patch)
    expect(stripped).toContain('# header')
    expect(stripped).toContain('# footer')
    expect(stripped).not.toContain('ui-skin-xp')
    expect(stripped).not.toContain(MANAGED_START)
  })

  it('stripManaged throws on an unterminated managed section', () => {
    const registry = miniRegistry()
    const patch = `${MANAGED_START}\n- id: ui-skin-xp\n  disabled: true\n`
    expect(() => stripManaged(patch)).toThrow(/unterminated/)
  })

  it('currentActive returns null when every skin is disabled (stock look)', () => {
    const registry = miniRegistry()
    expect(currentActive(renderManaged(null, registry), registry)).toBeNull()
  })

  it('currentActive returns the active skin from an insert row', () => {
    const registry = miniRegistry()
    expect(currentActive(renderManaged('qq98', registry), registry)).toBe('qq98')
  })
})

describe('useSkin / currentSkin against a throwaway HOME', () => {
  it('use official restores the stock look, preserving custom rows', () => {
    const h = fakeHome()
    const patch = patchPath(h)
    const fixture = `# custom row survives\n- id: ui-subagent-tree\n  name: '@deepseek-ai/dsh-client-ui-subagent-tree'\n`
    writeFileSync(patch, fixture)
    useSkin('official', { home: h })
    const after = readFileSync(patch, 'utf8')
    expect(after).toContain('# custom row survives')
    expect(after).toContain(MANAGED_START)
    const registry = loadRegistry()
    for (const name of Object.keys(registry)) {
      expect(after).toContain(`- id: ${registry[name].id}\n  disabled: true`)
    }
    expect(after).not.toContain('- insert:')
    expect(currentSkin(undefined, { home: h })).toBe('none')
  })

  it('use <name> writes an insert row and the profile symlink for a non-wired skin', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    // The symlink target must exist (the CLI test creates it under the fake home).
    mkdirSync(join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98'), { recursive: true })
    // Point the registry's dir at the fake skin dir so the symlink is resolvable.
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      qq98: { ...qq98, dir: join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98') },
    }
    writeFileSync(patchPath(h), '')
    const message = useSkin('qq98', { home: h, registry: fakeRegistry })
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).toContain('- insert:')
    expect(after).toContain(`- id: ${fakeRegistry.qq98.id}`)
    expect(currentSkin(after, { home: h, registry: fakeRegistry })).toBe('qq98')
    expect(message).toContain('skin switched to "qq98"')
    // The profile symlink now points at the fake skin dir.
    const link = join(resolvePaths(h).profileModulesDir, qq98.pkg)
    expect(existsSync(link) || readlinkSync(link)).toBeTruthy()
    if (existsSync(link)) expect(readlinkSync(link)).toBe(fakeRegistry.qq98.dir)
  })

  it('useSkin on an unknown skin rejects like the CLI', () => {
    const h = fakeHome()
    expect(() => useSkin('nope', { home: h })).toThrow(/unknown skin "nope"/)
  })
})
