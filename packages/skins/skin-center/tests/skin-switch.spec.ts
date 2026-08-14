/**
 * Host-side skin-switch tests for the in-process port of `dsh-skin use/current`
 * (src/skin-switch.ts). These run against a throwaway HOME so the real
 * ~/.dsh is never touched: they assert the managed patch-section rewrite, the
 * profile node_modules symlink, the active-skin reading, and the
 * skin.json-derived registry — mirroring scripts/dsh-skin.test.mjs.
 * @module @linxin666/dsh-client-ui-skin-center/tests/skin-switch
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync, existsSync, symlinkSync, lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Spy on symlinkSync only (everything else stays real) so the win32 junction
// fallback branch of ensureSymlink can be exercised on non-Windows machines.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symlinkSync: vi.fn(actual.symlinkSync) }
})
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
  resolveSkinsDir,
  findScopedAnchor,
  listSkinDirCandidates,
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

/** Write a complete, resolvable skin package under `dir` so useSkin's
 * honest resolvability gate (checkResolvable) sees a real package.json whose
 * name matches the skin package plus a loadable host entry, and ensureSymlink's
 * identity check sees a matching skin.json. Without these, useSkin would
 * correctly reject the target as unloadable (the MODULE_NOT_FOUND of issue #42).
 * @param dir - the skin package directory (created if missing).
 * @param entry - the skin switch entry describing pkg/id.
 */
function makeSkinPackage(dir: string, entry: Pick<SkinSwitchEntry, 'pkg' | 'id'>): void {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: entry.pkg,
    version: '0.1.6',
    type: 'module',
    main: 'lib/index.js',
  }, null, 2))
  writeFileSync(join(dir, 'lib', 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(dir, 'skin.json'), JSON.stringify({
    id: entry.id.replace(/^ui-skin-/, ''),
    package: entry.pkg,
    wiring: { id: entry.id },
  }))
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
    // No skin is bundle-wired in the npm aggregate layout — xp ships like the
    // others and must carry its own insert row when applied.
    expect(registry.xp.bundleWired).toBe(false)
    expect(wiredNames(registry).has('xp')).toBe(false)
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
    // The npm aggregate ships no bundle-wired skin, so synthesize one to
    // exercise the wired branch (92acdc9 dropped xp's stale flag).
    const registry = { ...miniRegistry(), xp: { ...miniRegistry().xp, bundleWired: true } }
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
    // A complete skin package at the fake repo path so the resolvability gate passes.
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98')
    makeSkinPackage(fakeDir, qq98)
    // Point the registry's dir at the fake skin dir so the symlink is resolvable.
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      qq98: { ...qq98, dir: fakeDir },
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

  it('useSkin leaves an already-installed REAL package dir untouched (npm layout, issue #21/#33)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    // The npm-install layout: the skin package is physically present as a
    // directory under the profile's node_modules — no symlink exists. The
    // directory must carry this skin's identity to count as installed.
    const installed = join(resolvePaths(h).profileModulesDir, qq98.pkg)
    // A real installed package must be a complete resolvable skin (package.json
    // + host entry + skin.json) so both the identity check and the resolvability
    // gate accept it.
    makeSkinPackage(installed, qq98)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      qq98: { ...qq98, dir: installed },
    }
    expect(() => useSkin('qq98', { home: h, registry: fakeRegistry })).not.toThrow()
    // The real directory survives untouched (not replaced by a symlink).
    expect(existsSync(installed)).toBe(true)
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).toContain('- insert:')
    expect(after).toContain('- id: ' + fakeRegistry.qq98.id)
  })

  it('useSkin refuses an unrelated directory at the profile link path', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    // A stray directory that is NOT this skin's package: the old code
    // refused non-symlinks, and the npm-layout relaxation must not silently
    // accept just any directory.
    const target = join(resolvePaths(h).profileModulesDir, qq98.pkg)
    mkdirSync(target, { recursive: true })
    expect(() => useSkin('qq98', { home: h })).toThrow(/does not look like/)
  })

  it('honest apply: useSkin rejects a skin dir with no package.json / host entry (issue #42)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    // Mirror the broken npm aggregate layout that shipped skin dirs with only
    // skin.json + lib/client.js (no package.json, no host entry): ensureSymlink
    // happily points the profile at it, but the boot cannot resolve the package
    // (MODULE_NOT_FOUND .../package.json). useSkin must throw so /apply reports
    // ok:false instead of claiming success.
    const carrierDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98')
    mkdirSync(join(carrierDir, 'lib'), { recursive: true })
    writeFileSync(join(carrierDir, 'lib', 'client.js'), 'window.__ModuleLoader__\n')
    writeFileSync(join(carrierDir, 'skin.json'), JSON.stringify({ id: 'qq98', package: qq98.pkg, wiring: { id: qq98.id } }))
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      qq98: { ...qq98, dir: carrierDir },
    }
    writeFileSync(patchPath(h), '')
    expect(() => useSkin('qq98', { home: h, registry: fakeRegistry })).toThrow(/缺少 package\.json/)
    // The patch must not have been written / no insert row left behind.
    const patch = readFileSync(patchPath(h), 'utf8')
    expect(patch).not.toContain('- insert:')
  })

  it('falls back to a directory junction when symlinkSync fails with EPERM on win32 (issue #24)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98')
    makeSkinPackage(fakeDir, qq98)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      qq98: { ...qq98, dir: fakeDir },
    }
    const mock = vi.mocked(symlinkSync)
    mock.mockImplementationOnce(() => {
      const error = new Error('operation not permitted') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      useSkin('qq98', { home: h, registry: fakeRegistry })
      // First call raised EPERM; the retry must be a junction link.
      expect(mock).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 'junction')
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
      mock.mockReset()
    }
  })
})

describe('npm-install layout registry scan (issue #21/#33/#34)', () => {
  it('loadRegistry scans a scoped dir of dsh-client-ui-skin-* packages, skipping non-skin dirs', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-npm-layout-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      mkdirSync(join(scoped, 'dsh-client-ui-skin-qq98'), { recursive: true })
      mkdirSync(join(scoped, 'dsh-client-ui-skin-ths'), { recursive: true })
      // Non-skin packages in the same scoped dir must be skipped.
      mkdirSync(join(scoped, 'dsh-ssh'), { recursive: true })
      mkdirSync(join(scoped, 'dsh-task-board'), { recursive: true })
      writeFileSync(join(scoped, 'dsh-client-ui-skin-qq98', 'skin.json'), JSON.stringify({
        id: 'qq98',
        package: '@linxin666/dsh-client-ui-skin-qq98',
        wiring: { id: 'ui-skin-qq98' },
      }))
      writeFileSync(join(scoped, 'dsh-client-ui-skin-ths', 'skin.json'), JSON.stringify({
        id: 'ths',
        package: '@linxin666/dsh-client-ui-skin-ths',
        wiring: { id: 'ui-skin-ths', bundleWired: true },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['qq98', 'ths'])
      expect(registry.qq98).toEqual(expect.objectContaining({
        pkg: '@linxin666/dsh-client-ui-skin-qq98',
        id: 'ui-skin-qq98',
        dir: join(scoped, 'dsh-client-ui-skin-qq98'),
      }))
      expect(registry.ths.bundleWired).toBe(true)
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('loadRegistry returns an empty registry for an unreadable root', () => {
    expect(loadRegistry(join(tmpdir(), 'no-such-skins-dir-xyz'))).toEqual({})
  })

  it('resolveSkinsDir honors DSH_SKINS_DIR', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-env-dir-'))
    try {
      const before = process.env.DSH_SKINS_DIR
      process.env.DSH_SKINS_DIR = fakeRoot
      try {
        expect(resolveSkinsDir()).toBe(fakeRoot)
      } finally {
        if (before === undefined) delete process.env.DSH_SKINS_DIR
        else process.env.DSH_SKINS_DIR = before
      }
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })
})

describe('bundled-skins carrier (dsh-skins/skins/<id>, npm layout)', () => {
  it('loadRegistry collects skins bundled inside the dsh-skins aggregate', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-carrier-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      // The aggregate carrier with bundled skin assets.
      const carrier = join(scoped, 'dsh-skins', 'skins')
      mkdirSync(join(carrier, 'miku', 'lib'), { recursive: true })
      mkdirSync(join(carrier, 'trading', 'lib'), { recursive: true })
      // A legacy per-skin package coexisting (already published installs).
      mkdirSync(join(scoped, 'dsh-client-ui-skin-qq98'), { recursive: true })
      // A non-skin package in the same scoped dir.
      mkdirSync(join(scoped, 'dsh-ssh'), { recursive: true })
      writeFileSync(join(carrier, 'miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      writeFileSync(join(carrier, 'trading', 'skin.json'), JSON.stringify({
        id: 'trading',
        package: '@linxin666/dsh-client-ui-skin-trading',
        wiring: { id: 'ui-skin-trading' },
      }))
      writeFileSync(join(scoped, 'dsh-client-ui-skin-qq98', 'skin.json'), JSON.stringify({
        id: 'qq98',
        package: '@linxin666/dsh-client-ui-skin-qq98',
        wiring: { id: 'ui-skin-qq98' },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['miku', 'qq98', 'trading'])
      // Bundled skins resolve to their carrier paths.
      expect(registry.miku.dir).toBe(join(carrier, 'miku'))
      expect(registry.trading.dir).toBe(join(carrier, 'trading'))
      // Legacy per-skin packages still resolve.
      expect(registry.qq98.dir).toBe(join(scoped, 'dsh-client-ui-skin-qq98'))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('deterministically prefers the direct package when carrier and legacy package share an id', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-carrier-conflict-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      const carrier = join(scoped, 'dsh-skins', 'skins')
      mkdirSync(join(carrier, 'miku', 'lib'), { recursive: true })
      mkdirSync(join(scoped, 'dsh-client-ui-skin-miku'), { recursive: true })
      writeFileSync(join(carrier, 'miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      writeFileSync(join(scoped, 'dsh-client-ui-skin-miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['miku'])
      // The direct package wins over the carrier, deterministically.
      expect(registry.miku.dir).toBe(join(scoped, 'dsh-client-ui-skin-miku'))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })
})

describe('pnpm virtual-store layout (realpathed .pnpm packages)', () => {
  it('findScopedAnchor walks up to the node_modules root owning @linxin666', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-pnpm-'))
    try {
      // pnpm hoisted layout: node_modules/@linxin666/* are symlinks into
      // .pnpm/<pkg>@<ver>/node_modules/, so the skin-center package realpath
      // sits deep under .pnpm and cannot see its siblings via ../../
      const nm = join(fakeRoot, 'node_modules')
      const storePkg = join(nm, '.pnpm', '@linxin666+dsh-client-ui-skin-center@0.1.3', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')
      const carrier = join(nm, '@linxin666', 'dsh-skins', 'skins')
      mkdirSync(join(storePkg, 'lib'), { recursive: true })
      mkdirSync(join(carrier, 'miku', 'lib'), { recursive: true })
      writeFileSync(join(carrier, 'miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      // The anchor is the @linxin666/ scoped dir holding the carrier.
      expect(findScopedAnchor(join(storePkg, 'lib'))).toBe(join(nm, '@linxin666'))
      // And the registry resolves bundled skins through that scoped dir.
      const registry = loadRegistry(join(nm, '@linxin666'))
      expect(Object.keys(registry).sort()).toEqual(['miku'])
      expect(registry.miku.dir).toBe(join(carrier, 'miku'))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('resolveSkinsDir() end-to-end: probes the real candidate chain from a pnpm store path', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-pnpm-e2e-'))
    try {
      // pnpm virtual store: the skin-center package realpath sits deep under
      // .pnpm/<pkg>@<ver>/node_modules/@linxin666/, its ../../ sibling dir
      // holds only itself, and the real skins live in the hoisted scoped dir.
      const nm = join(fakeRoot, 'node_modules')
      const storeScoped = join(nm, '.pnpm', '@linxin666+dsh-client-ui-skin-center@0.1.3', 'node_modules', '@linxin666')
      const storePkg = join(storeScoped, 'dsh-client-ui-skin-center')
      const scoped = join(nm, '@linxin666')
      const carrier = join(scoped, 'dsh-skins', 'skins')
      mkdirSync(join(storePkg, 'lib'), { recursive: true })
      mkdirSync(join(carrier, 'miku', 'lib'), { recursive: true })
      writeFileSync(join(carrier, 'miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      // The module location the resolver must anchor from (inside the store).
      const fromUrl = pathToFileURL(join(storePkg, 'lib', 'index.js')).href
      const resolved = resolveSkinsDir(fromUrl)
      // Must land on the hoisted scoped dir, not the store-local one.
      expect(resolved).toBe(scoped)
      expect(Object.keys(loadRegistry(resolved)).sort()).toEqual(['miku'])
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })
})
describe('self-referential symlink defense (issue #43: ELOOP on second skin switch)', () => {
  it('listSkinDirCandidates skips symlink entries in Pass 1', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-symlink-skip-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      const real = join(scoped, 'dsh-skins', 'skins')
      mkdirSync(join(real, 'miku', 'lib'), { recursive: true })
      writeFileSync(join(real, 'miku', 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      // A legacy per-skin alias symlink pointing at the real skin dir (the
      // profile link ensureSymlink manages). It must NOT be a candidate.
      const alias = join(scoped, 'dsh-client-ui-skin-miku')
      symlinkSync(join(real, 'miku'), alias, process.platform === 'win32' ? 'junction' : 'dir')
      // A real legacy package (kept).
      mkdirSync(join(scoped, 'dsh-client-ui-skin-qq98'), { recursive: true })
      writeFileSync(join(scoped, 'dsh-client-ui-skin-qq98', 'skin.json'), JSON.stringify({
        id: 'qq98',
        package: '@linxin666/dsh-client-ui-skin-qq98',
        wiring: { id: 'ui-skin-qq98' },
      }))
      const candidates = listSkinDirCandidates(scoped)
      // The alias link must never appear as a skin-dir candidate.
      expect(candidates).not.toContain(alias)
      // The real direct package is still found.
      expect(candidates).toContain(join(scoped, 'dsh-client-ui-skin-qq98'))
      // The real skin dir reachable via the carrier is still found.
      expect(candidates).toContain(join(real, 'miku'))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('loadRegistry realpath-dedupes a symlink-aliased carrier entry, preferring the real dir', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-realpath-dedupe-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      const direct = join(scoped, 'dsh-client-ui-skin-miku')
      mkdirSync(join(direct, 'lib'), { recursive: true })
      writeFileSync(join(direct, 'skin.json'), JSON.stringify({
        id: 'miku',
        package: '@linxin666/dsh-client-ui-skin-miku',
        wiring: { id: 'ui-skin-miku' },
      }))
      // The carrier entry is a symlink back to the SAME real dir (the shape
      // that would otherwise record a link path as entry.dir).
      const carrier = join(scoped, 'dsh-skins', 'skins')
      mkdirSync(carrier, { recursive: true })
      symlinkSync(direct, join(carrier, 'miku'), process.platform === 'win32' ? 'junction' : 'dir')
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['miku'])
      // entry.dir must be a real directory, never the symlink alias.
      expect(registry.miku.dir).toBe(direct)
      expect(lstatSync(registry.miku.dir).isSymbolicLink()).toBe(false)
      expect(realpathSync(registry.miku.dir)).toBe(realpathSync(direct))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('useSkin refuses to build a self-referential link after a poisoned registry (second switch, no ELOOP)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const qq98 = registry.qq98
    const realDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'qq98')
    makeSkinPackage(realDir, qq98)
    const target = join(resolvePaths(h).profileModulesDir, qq98.pkg)
    // First switch: a normal link target -> realDir.
    const goodRegistry: Record<string, SkinSwitchEntry> = { ...registry, qq98: { ...qq98, dir: realDir } }
    writeFileSync(patchPath(h), '')
    useSkin('qq98', { home: h, registry: goodRegistry })
    expect(readlinkSync(target)).toBe(realDir)
    // Poison the registry exactly like the issue: entry.dir resolves to the
    // profile link path itself (the loadRegistry realpath bug). ensureSymlink
    // must refuse to re-link target -> itself (ELOOP) and leave state intact.
    const poisonedRegistry: Record<string, SkinSwitchEntry> = { ...registry, qq98: { ...qq98, dir: target } }
    writeFileSync(patchPath(h), '')
    expect(() => useSkin('qq98', { home: h, registry: poisonedRegistry })).not.toThrow()
    // The existing link still points at the real dir, never at itself.
    expect(readlinkSync(target)).toBe(realDir)
    // And it still resolves (no ELOOP on realpath).
    expect(realpathSync(target)).toBe(realpathSync(realDir))
  })
})

