/**
 * Host-side skin-switch tests for the in-process port of `dsh-skin use/current`
 * (src/skin-switch.ts). These run against a throwaway HOME so the real
 * ~/.dsh is never touched: they assert the managed patch-section rewrite, the
 * profile node_modules symlink, the active-skin reading, and the
 * skin.json-derived registry — mirroring scripts/dsh-skin.test.mjs.
 * @module @linxin666/dsh-client-ui-skin-center/tests/skin-switch
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync, existsSync, symlinkSync, lstatSync, realpathSync, chmodSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
  normalizePatchForManagedAppend,
  stripManaged,
  stripEmptyPatchList,
  stripLegacySkinRows,
  currentActive,
  loadRegistry,
  wiredNames,
  useSkin,
  currentSkin,
  reconcileSkinPatches,
  resolvePaths,
  resolveHarnessHome,
  resolveInstallLayout,
  resolveProfile,
  activeSkinIsBundleWired,
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
  mkdirSync(join(home, '.dsh', 'profiles', 'web'), { recursive: true })
  // Mirror the CLI test: the profile symlink target is the real repo skin dir.
  mkdirSync(join(home, 'code', 'dsh-web-ui', 'packages', 'skins'), { recursive: true })
  return home
}

function patchPath(h: string): string {
  return join(h, '.dsh', 'profiles', 'web', 'cordis.patch.yml')
}

function legacyPatchPath(h: string): string {
  return join(h, '.dsh', 'cordis.patch.yml')
}

/** Run `fn` with the given process.env values, restoring every touched key. */
function withEnv(changes: Record<string, string | undefined>, fn: () => void): void {
  const before = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(changes)) {
    before.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
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
    expect(registry.miku).toEqual(expect.objectContaining({
      pkg: '@linxin666/dsh-client-ui-skin-miku',
      id: 'ui-skin-miku',
    }))
    expect(registry.trading).toEqual(expect.objectContaining({ id: 'ui-skin-trading' }))
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

describe('skin.json validation (malicious registry input)', () => {
  it('loadRegistry skips packages with traversal names, quoted/newline names, and invalid wiring ids', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-malicious-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      const traversal = join(scoped, 'dsh-client-ui-skin-evil-traversal')
      const quoted = join(scoped, 'dsh-client-ui-skin-evil-quoted')
      const badWiring = join(scoped, 'dsh-client-ui-skin-evil-wiring')
      const good = join(scoped, 'dsh-client-ui-skin-good')
      mkdirSync(traversal, { recursive: true })
      mkdirSync(quoted, { recursive: true })
      mkdirSync(badWiring, { recursive: true })
      mkdirSync(good, { recursive: true })
      writeFileSync(join(traversal, 'skin.json'), JSON.stringify({
        id: 'evil-traversal',
        package: '../../../.config',
        wiring: { id: 'ui-skin-evil-traversal' },
      }))
      writeFileSync(join(quoted, 'skin.json'), JSON.stringify({
        id: 'evil-quoted',
        package: "'@linxin666/evil'\n- id: ui-skin-hacked",
        wiring: { id: 'ui-skin-evil-quoted' },
      }))
      writeFileSync(join(badWiring, 'skin.json'), JSON.stringify({
        id: 'evil-wiring',
        package: '@linxin666/dsh-client-ui-skin-evil-wiring',
        wiring: { id: 'ui-skin-../evil' },
      }))
      writeFileSync(join(good, 'skin.json'), JSON.stringify({
        id: 'good',
        package: '@linxin666/dsh-client-ui-skin-good',
        wiring: { id: 'ui-skin-good' },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['good'])
      expect(registry.good).toEqual(expect.objectContaining({
        pkg: '@linxin666/dsh-client-ui-skin-good',
        id: 'ui-skin-good',
      }))
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })
})

describe('renderManaged YAML safety', () => {
  it('escapes single quotes in the active package name so the insert row stays one YAML scalar', () => {
    const registry: Record<string, SkinSwitchEntry> = {
      evil: {
        pkg: "@linxin666/dsh-client-ui-skin-na'me",
        id: 'ui-skin-evil',
        dir: '/tmp/evil-skin',
        bundleWired: false,
      },
      other: {
        pkg: '@linxin666/dsh-client-ui-skin-other',
        id: 'ui-skin-other',
        dir: '/tmp/other-skin',
        bundleWired: false,
      },
    }
    const rendered = renderManaged('evil', registry)
    const nameLine = rendered.split('\n').find(line => line.trimStart().startsWith('name: '))
    expect(nameLine).toBe("      name: '@linxin666/dsh-client-ui-skin-na''me'")
    // The unescaped quote must never appear as a bare scalar delimiter.
    expect(rendered).not.toContain("name: '@linxin666/dsh-client-ui-skin-na'me'")
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
    const rendered = renderManaged('xp', registry)
    expect(rendered).toContain('- insert:')
    expect(rendered).toContain(`- id: ${registry.xp.id}`)
    expect(rendered).not.toContain(`- id: ${registry.xp.id}\n  disabled: true`)
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

  it('stripEmptyPatchList drops a bare top-level [] but keeps nested lists', () => {
    const patch = `# template\n[]\n- id: other\n  config:\n    tags: []\n`
    const stripped = stripEmptyPatchList(patch)
    expect(stripped).not.toContain('\n[]\n')
    expect(stripped).toContain('tags: []')
    expect(stripped).toContain('- id: other')
  })

  it('normalizes the DSH default [] root while preserving comments, document start, and CRLF', () => {
    const patch = '# profile patch\r\n---\r\n[] # empty sequence\r\n'
    expect(normalizePatchForManagedAppend(patch)).toBe('# profile patch\r\n---\r\n')
  })

  it('rejects flow-style and non-sequence roots before a managed append', () => {
    expect(() => normalizePatchForManagedAppend('{}\n')).toThrow(/top-level block sequence/)
    expect(() => normalizePatchForManagedAppend('[{ id: existing }]\n')).toThrow(/top-level block sequence/)
    expect(() => normalizePatchForManagedAppend('- id: existing\n[]\n')).toThrow(/one top-level block sequence/)
    expect(() => normalizePatchForManagedAppend('- id: existing\n---\n- id: second\n')).toThrow(/one YAML document/)
    expect(() => normalizePatchForManagedAppend('- id: existing\n--- # second document\n- id: second\n')).toThrow(/one YAML document/)
  })

  it('currentActive returns null when every skin is disabled (stock look)', () => {
    const registry = miniRegistry()
    expect(currentActive(renderManaged(null, registry), registry)).toBeNull()
  })

  it('currentActive returns the active skin from an insert row', () => {
    const registry = miniRegistry()
    expect(currentActive(renderManaged('xp', registry), registry)).toBe('xp')
  })
})

describe('harness home resolution (issue #120: DSH_HOME)', () => {
  it('uses a trimmed non-empty $DSH_HOME directly as the harness home', () => {
    const harness = mkdtempSync(join(tmpdir(), 'skin-dsh-home-'))
    try {
      withEnv({ DSH_HOME: `  ${harness}  ` }, () => {
        expect(resolveHarnessHome(undefined, process.env)).toBe(harness)
        const paths = resolvePaths()
        expect(paths.patchPath).toBe(join(harness, 'profiles', 'web', 'cordis.patch.yml'))
        expect(paths.legacyPatchPath).toBe(join(harness, 'cordis.patch.yml'))
        expect(paths.profileModulesDir).toBe(join(harness, 'profiles', 'web', 'node_modules'))
      })
    } finally {
      rmSync(harness, { recursive: true, force: true })
    }
  })

  it('falls back to homedir()/.dsh when $DSH_HOME is absent or blank', () => {
    const expected = join(homedir(), '.dsh')
    withEnv({ DSH_HOME: undefined }, () => {
      expect(resolveHarnessHome()).toBe(expected)
      expect(resolvePaths().patchPath).toBe(join(expected, 'profiles', 'web', 'cordis.patch.yml'))
    })
    withEnv({ DSH_HOME: '   ' }, () => {
      expect(resolveHarnessHome()).toBe(expected)
    })
  })

  it('an injected home option wins over $DSH_HOME and keeps the .dsh suffix', () => {
    const h = fakeHome()
    const harness = mkdtempSync(join(tmpdir(), 'skin-dsh-home-env-'))
    try {
      withEnv({ DSH_HOME: harness }, () => {
        const paths = resolvePaths(h, 'web')
        expect(paths.patchPath).toBe(join(h, '.dsh', 'profiles', 'web', 'cordis.patch.yml'))
        expect(paths.profileModulesDir).toBe(join(h, '.dsh', 'profiles', 'web', 'node_modules'))
      })
    } finally {
      rmSync(harness, { recursive: true, force: true })
    }
  })

  it('useSkin/currentSkin write and read the $DSH_HOME patch when no home is injected', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'skin-switch-use-dsh-home-'))
    try {
      withEnv({ DSH_HOME: dshHome }, () => {
        // patchPath guard before useSkin: a resolvePaths regression must fail
        // here instead of letting useSkin write into the real ~/.dsh.
        const paths = resolvePaths()
        expect(paths.patchPath).toBe(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'))
        expect(paths.patchPath).not.toBe(join(homedir(), '.dsh', 'cordis.patch.yml'))
        useSkin('official', {})
        expect(existsSync(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'))).toBe(true)
        expect(currentSkin(undefined, {})).toBe('none')
      })
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
})

describe('running profile resolution (issue #155: non-default profile)', () => {
  it('resolveProfile follows opts > DSH_SKIN_PROFILE > DSH_PROFILE > cwd > web', () => {
    const profiles = mkdtempSync(join(tmpdir(), 'skin-profiles-'))
    try {
      const wui = join(profiles, 'wui')
      mkdirSync(wui, { recursive: true })
      const env = { ...process.env, DSH_SKIN_PROFILE: 'wui', DSH_PROFILE: 'legacy' }
      expect(resolveProfile('explicit', env, join(wui, 'child'), profiles)).toBe('explicit')
      expect(resolveProfile('  ', env, join(wui, 'child'), profiles)).toBe('wui')
      expect(resolveProfile(undefined, { ...env, DSH_SKIN_PROFILE: '  ' }, join(wui, 'child'), profiles)).toBe('legacy')
      expect(resolveProfile(undefined, { ...env, DSH_SKIN_PROFILE: ' ', DSH_PROFILE: ' ' }, join(wui, 'child'), profiles)).toBe('web')
    } finally {
      rmSync(profiles, { recursive: true, force: true })
    }
  })

  it('resolveProfile infers the name only from a cwd directly under profiles root', () => {
    const profiles = mkdtempSync(join(tmpdir(), 'skin-profiles-cwd-'))
    try {
      const wui = join(profiles, 'wui')
      const nested = join(wui, 'nested')
      mkdirSync(nested, { recursive: true })
      expect(resolveProfile(undefined, {}, wui, profiles)).toBe('wui')
      expect(resolveProfile(undefined, {}, nested, profiles)).toBe('web')
      expect(resolveProfile(undefined, {}, join(profiles, 'missing'), profiles)).toBe('web')
    } finally {
      rmSync(profiles, { recursive: true, force: true })
    }
  })

  it('useSkin and currentSkin target the $DSH_PROFILE profile', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(fakeDir, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: fakeDir },
    }
    withEnv({ DSH_SKIN_PROFILE: undefined, DSH_PROFILE: 'wui', DSH_HOME: undefined }, () => {
      writeFileSync(patchPath(h), '')
      const message = useSkin('xp', { home: h, registry: fakeRegistry })
      expect(message).toContain('skin switched to "xp"')
      // DSH_PROFILE (not the legacy hard-coded 'web') is the target profile.
      const paths = resolvePaths(h)
      expect(paths.profileModulesDir).toBe(join(h, '.dsh', 'profiles', 'wui', 'node_modules'))
      expect(readlinkSync(join(paths.profileModulesDir, xp.pkg))).toBe(fakeDir)
      expect(currentSkin(undefined, { home: h, registry: fakeRegistry })).toBe('xp')
    })
  })

  it('useSkin and currentSkin infer the running profile from a cwd under profiles/<name>', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(fakeDir, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: fakeDir },
    }
    const profileDir = join(h, '.dsh', 'profiles', 'wui')
    mkdirSync(profileDir, { recursive: true })
    const cwdBefore = process.cwd()
    process.chdir(profileDir)
    try {
      withEnv({ DSH_SKIN_PROFILE: undefined, DSH_PROFILE: undefined, DSH_HOME: undefined }, () => {
        const paths = resolvePaths(h)
        expect(paths.profileModulesDir).toBe(join(profileDir, 'node_modules'))
        writeFileSync(patchPath(h), '')
        useSkin('xp', { home: h, registry: fakeRegistry })
        expect(readlinkSync(join(paths.profileModulesDir, xp.pkg))).toBe(fakeDir)
        expect(currentSkin(undefined, { home: h, registry: fakeRegistry })).toBe('xp')
      })
    } finally {
      process.chdir(cwdBefore)
    }
  })
})

describe('install-layout resolution (issue #254: running profile with no env/cwd hint)', () => {
  it('resolveInstallLayout finds harness home and profile from a plain node_modules chain', () => {
    const h = fakeHome()
    const pkgDir = join(h, '.dsh', 'profiles', 'web-ui', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')
    mkdirSync(pkgDir, { recursive: true })
    const layout = resolveInstallLayout(pathToFileURL(join(pkgDir, 'index.js')).href)
    expect(layout).toEqual({ harnessHome: join(h, '.dsh'), profile: 'web-ui' })
  })

  it('resolveInstallLayout sees through the pnpm virtual-store chain', () => {
    const h = fakeHome()
    const pkgDir = join(h, '.dsh', 'profiles', 'web-ui', 'node_modules', '.pnpm', '@linxin666+dsh-client-ui-skin-center@0.1.16', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')
    mkdirSync(pkgDir, { recursive: true })
    const layout = resolveInstallLayout(pathToFileURL(join(pkgDir, 'index.js')).href)
    expect(layout).toEqual({ harnessHome: join(h, '.dsh'), profile: 'web-ui' })
  })

  it('resolveInstallLayout returns null outside a profiles tree (monorepo dev checkout)', () => {
    const h = fakeHome()
    const pkgDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'skin-center')
    mkdirSync(pkgDir, { recursive: true })
    expect(resolveInstallLayout(pathToFileURL(join(pkgDir, 'index.js')).href)).toBeNull()
  })

  it('resolvePaths falls back to the install profile when env and cwd give nothing', () => {
    const h = fakeHome()
    const pkgDir = join(h, '.dsh', 'profiles', 'web-ui', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')
    mkdirSync(pkgDir, { recursive: true })
    withEnv({ DSH_HOME: undefined, DSH_PROFILE: undefined, DSH_SKIN_PROFILE: undefined }, () => {
      const paths = resolvePaths(undefined, undefined, pathToFileURL(join(pkgDir, 'index.js')).href)
      expect(paths.patchPath).toBe(join(h, '.dsh', 'profiles', 'web-ui', 'cordis.patch.yml'))
      expect(paths.profileModulesDir).toBe(join(h, '.dsh', 'profiles', 'web-ui', 'node_modules'))
      expect(paths.profileManifestPath).toBe(join(h, '.dsh', 'profiles', 'web-ui', 'package.json'))
    })
  })

  it('an explicit profile env var still beats the install profile', () => {
    const h = fakeHome()
    const pkgDir = join(h, '.dsh', 'profiles', 'web-ui', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')
    mkdirSync(pkgDir, { recursive: true })
    withEnv({ DSH_HOME: undefined, DSH_PROFILE: 'wui', DSH_SKIN_PROFILE: undefined }, () => {
      const paths = resolvePaths(undefined, undefined, pathToFileURL(join(pkgDir, 'index.js')).href)
      expect(paths.profileModulesDir).toBe(join(h, '.dsh', 'profiles', 'wui', 'node_modules'))
    })
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

  it('useSkin on the stock template [] rewrites it to a valid patch (no bare [] next to block entries)', () => {
    const h = fakeHome()
    const patch = patchPath(h)
    // The stock profile template: comments + an empty patch list. The managed
    // block must replace it, not append after it (issue: boot YAML failure
    // "end of the stream or a document separator is expected").
    writeFileSync(patch, `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n[]\n`)
    useSkin('official', { home: h })
    const after = readFileSync(patch, 'utf8')
    expect(after).toContain(MANAGED_START)
    expect(/^[ \t]*\[\s*\][ \t]*$/m.test(after)).toBe(false)
    // A second switch rewrites the managed block again without regressing.
    useSkin('official', { home: h })
    const again = readFileSync(patch, 'utf8')
    expect(/^[ \t]*\[\s*\][ \t]*$/m.test(again)).toBe(false)
    expect(again).toContain(MANAGED_START)
  })

  it('use official converts the DSH default [] template into one block-sequence root (issue #406)', () => {
    const h = fakeHome()
    const patch = patchPath(h)
    writeFileSync(patch, '# Your patch layer for this dsh profile\n[]\n')

    useSkin('official', { home: h })

    const after = readFileSync(patch, 'utf8')
    expect(after).toContain('# Your patch layer for this dsh profile')
    expect(after.split(/\r?\n/).some(line => line.trim() === '[]')).toBe(false)
    expect(after).toContain(MANAGED_START)
    expect(after.trimEnd().endsWith(MANAGED_END)).toBe(true)
  })

  it('useSkin preserves the permission bits of an existing patch file (0600 stays 0600)', () => {
    const h = fakeHome()
    const patch = patchPath(h)
    writeFileSync(patch, '# custom row survives\n')
    chmodSync(patch, 0o600)
    useSkin('official', { home: h })
    expect(statSync(patch).mode & 0o777).toBe(0o600)
    expect(readFileSync(patch, 'utf8')).toContain('# custom row survives')
  })

  it('moves a harness-wide managed skin into the active profile (issue #290)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    writeFileSync(legacyPatchPath(h), `${renderManaged('xp', registry)}\n`)

    useSkin('official', { home: h, registry })

    // The legacy file held only the managed block: removed, never emptied —
    // the boot parser rejects an empty patch file.
    expect(existsSync(legacyPatchPath(h))).toBe(false)
    expect(readFileSync(patchPath(h), 'utf8')).toContain(MANAGED_START)
    expect(currentSkin(undefined, { home: h, registry })).toBe('none')
  })

  it('use <name> writes an insert row and the profile symlink for a non-wired skin', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // A complete skin package at the fake repo path so the resolvability gate passes.
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(fakeDir, xp)
    // Point the registry's dir at the fake skin dir so the symlink is resolvable.
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: fakeDir },
    }
    writeFileSync(patchPath(h), '')
    // patchPath guard before useSkin: the throwaway home owns the write
    // target, never the real ~/.dsh.
    const paths = resolvePaths(h)
    expect(paths.patchPath).toBe(patchPath(h))
    expect(paths.patchPath).not.toBe(join(homedir(), '.dsh', 'cordis.patch.yml'))
    const message = useSkin('xp', { home: h, registry: fakeRegistry })
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).toContain('- insert:')
    expect(after).toContain(`- id: ${fakeRegistry.xp.id}`)
    expect(currentSkin(after, { home: h, registry: fakeRegistry })).toBe('xp')
    expect(message).toContain('skin switched to "xp"')
    // The profile symlink now points at the fake skin dir.
    const link = join(resolvePaths(h).profileModulesDir, xp.pkg)
    expect(existsSync(link) || readlinkSync(link)).toBeTruthy()
    if (existsSync(link)) expect(readlinkSync(link)).toBe(fakeRegistry.xp.dir)
  })

  it('useSkin on an unknown skin rejects like the CLI', () => {
    const h = fakeHome()
    expect(() => useSkin('nope', { home: h })).toThrow(/unknown skin "nope"/)
  })

  it('useSkin leaves an already-installed REAL package dir untouched (npm layout, issue #21/#33)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // The npm-install layout: the skin package is physically present as a
    // directory under the profile's node_modules — no symlink exists. The
    // directory must carry this skin's identity to count as installed.
    const installed = join(resolvePaths(h).profileModulesDir, xp.pkg)
    // A real installed package must be a complete resolvable skin (package.json
    // + host entry + skin.json) so both the identity check and the resolvability
    // gate accept it.
    makeSkinPackage(installed, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: installed },
    }
    expect(() => useSkin('xp', { home: h, registry: fakeRegistry })).not.toThrow()
    // The real directory survives untouched (not replaced by a symlink).
    expect(existsSync(installed)).toBe(true)
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).toContain('- insert:')
    expect(after).toContain('- id: ' + fakeRegistry.xp.id)
  })

  it('useSkin refuses an unrelated directory at the profile link path', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // A stray directory that is NOT this skin's package: the old code
    // refused non-symlinks, and the npm-layout relaxation must not silently
    // accept just any directory.
    const target = join(resolvePaths(h).profileModulesDir, xp.pkg)
    mkdirSync(target, { recursive: true })
    expect(() => useSkin('xp', { home: h })).toThrow(/does not look like/)
  })

  it('honest apply: useSkin rejects a skin dir with no package.json / host entry (issue #42)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // Mirror the broken npm aggregate layout that shipped skin dirs with only
    // skin.json + lib/client.js (no package.json, no host entry): ensureSymlink
    // happily points the profile at it, but the boot cannot resolve the package
    // (MODULE_NOT_FOUND .../package.json). useSkin must throw so /apply reports
    // ok:false instead of claiming success.
    const carrierDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    mkdirSync(join(carrierDir, 'lib'), { recursive: true })
    writeFileSync(join(carrierDir, 'lib', 'client.js'), 'window.__ModuleLoader__\n')
    writeFileSync(join(carrierDir, 'skin.json'), JSON.stringify({ id: 'xp', package: xp.pkg, wiring: { id: xp.id } }))
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: carrierDir },
    }
    writeFileSync(patchPath(h), '')
    expect(() => useSkin('xp', { home: h, registry: fakeRegistry })).toThrow(/缺少 package\.json/)
    // The patch must not have been written / no insert row left behind.
    const patch = readFileSync(patchPath(h), 'utf8')
    expect(patch).not.toContain('- insert:')
  })

  it('falls back to a directory junction when symlinkSync fails with EPERM on win32 (issue #24)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(fakeDir, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: fakeDir },
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
      useSkin('xp', { home: h, registry: fakeRegistry })
      // First call raised EPERM; the retry must be a junction link.
      expect(mock).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 'junction')
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
      mock.mockReset()
    }
  })
})

describe('home patch lifecycle vs installed skin bundles (issue #108/#148)', () => {
  it('activeSkinIsBundleWired: registry flag, real bundle dir, and carrier symlink', () => {
    const h = fakeHome()
    const modules = join(h, 'modules')
    const entry: SkinSwitchEntry = {
      pkg: '@linxin666/dsh-client-ui-skin-xp',
      id: 'ui-skin-xp',
      dir: join(h, 'unused'),
      bundleWired: false,
    }
    // Registry flag alone is enough.
    expect(activeSkinIsBundleWired({ ...entry, bundleWired: true }, modules)).toBe(true)
    // Missing target is not bundle-wired.
    expect(activeSkinIsBundleWired(entry, modules)).toBe(false)
    // A REAL installed dir whose own cordis.patch.yml inserts the id is.
    const installed = join(modules, entry.pkg)
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'cordis.patch.yml'), `- insert:\n    - id: ${entry.id}\n      name: '${entry.pkg}'\n`)
    expect(activeSkinIsBundleWired(entry, modules)).toBe(true)
    rmSync(installed, { recursive: true, force: true })
    // A carrier-style symlink target is NOT an installed bundle even when the
    // linked dir happens to carry the same patch text.
    const carrier = join(h, 'dsh-skins', 'skins', 'xp')
    mkdirSync(carrier, { recursive: true })
    writeFileSync(join(carrier, 'cordis.patch.yml'), `- insert:\n    - id: ${entry.id}\n      name: '${entry.pkg}'\n`)
    symlinkSync(carrier, join(modules, entry.pkg), process.platform === 'win32' ? 'junction' : 'dir')
    expect(activeSkinIsBundleWired(entry, modules)).toBe(false)
  })

  it('activeSkinIsBundleWired: a symlink to an independent installed package is probed via realpath', () => {
    const h = fakeHome()
    const modules = join(h, 'modules')
    const entry: SkinSwitchEntry = {
      pkg: '@linxin666/dsh-client-ui-skin-xp',
      id: 'ui-skin-xp',
      dir: join(h, 'unused'),
      bundleWired: false,
    }
    // An independently installed per-skin bundle, NOT under dsh-skins/skins.
    const standalone = join(h, 'installed', entry.pkg)
    mkdirSync(standalone, { recursive: true })
    writeFileSync(join(standalone, 'cordis.patch.yml'), `- insert:\n    - id: ${entry.id}\n      name: '${entry.pkg}'\n`)
    mkdirSync(join(modules, '@linxin666'), { recursive: true })
    symlinkSync(standalone, join(modules, entry.pkg), process.platform === 'win32' ? 'junction' : 'dir')
    expect(activeSkinIsBundleWired(entry, modules)).toBe(true)
  })

  it('activeSkinIsBundleWired: profile manifest bundles win even when the target is a symlink', () => {
    const h = fakeHome()
    const modules = join(h, 'modules')
    const entry: SkinSwitchEntry = {
      pkg: '@linxin666/dsh-client-ui-skin-xp',
      id: 'ui-skin-xp',
      dir: join(h, 'unused'),
      bundleWired: false,
    }
    // A carrier-style symlink (which the structural probe must reject), but
    // the profile manifest authoritatively lists the package as bundle-wired.
    const carrier = join(h, 'dsh-skins', 'skins', 'xp')
    mkdirSync(carrier, { recursive: true })
    mkdirSync(join(modules, '@linxin666'), { recursive: true })
    symlinkSync(carrier, join(modules, entry.pkg), process.platform === 'win32' ? 'junction' : 'dir')
    const manifest = join(h, 'package.json')
    writeFileSync(manifest, JSON.stringify({ dsh: { profile: { bundles: [entry.pkg] } } }))
    expect(activeSkinIsBundleWired(entry, modules, manifest)).toBe(true)
  })

  it('activeSkinIsBundleWired: a skin-center symlink is not bundle-wired when the profile manifest exists', () => {
    const h = fakeHome()
    const modules = join(h, 'modules')
    const entry: SkinSwitchEntry = {
      pkg: '@linxin666/dsh-client-ui-skin-whale-song',
      id: 'ui-skin-whale-song',
      dir: join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'whale-song'),
      bundleWired: false,
    }
    // The skin-center's own ensureSymlink link (the layout every apply
    // creates): the package dir carries its bundle patch, but the profile
    // manifest does not list the package anywhere — the loader never
    // reconciles such a link, so it must keep its home insert row.
    makeSkinPackage(entry.dir, entry)
    writeFileSync(join(entry.dir, 'cordis.patch.yml'), `- insert:\n    - id: ${entry.id}\n      name: '${entry.pkg}'\n`)
    mkdirSync(join(modules, '@linxin666'), { recursive: true })
    symlinkSync(entry.dir, join(modules, entry.pkg), process.platform === 'win32' ? 'junction' : 'dir')
    const manifest = join(h, 'package.json')
    writeFileSync(manifest, JSON.stringify({ dsh: { profile: { bundles: [] } }, dependencies: {} }))
    expect(activeSkinIsBundleWired(entry, modules, manifest)).toBe(false)
  })

  it('activeSkinIsBundleWired: a package listed in profile dependencies is bundle-wired', () => {
    const h = fakeHome()
    const modules = join(h, 'modules')
    const entry: SkinSwitchEntry = {
      pkg: '@linxin666/dsh-client-ui-skin-blue-fantasy',
      id: 'ui-skin-blue-fantasy',
      dir: join(h, 'unused'),
      bundleWired: false,
    }
    // The npm / dsh plugin add layout: the profile manifest dependencies
    // reconcile the package's own bundle patch, so no home insert row.
    const manifest = join(h, 'package.json')
    writeFileSync(manifest, JSON.stringify({ dependencies: { [entry.pkg]: '0.1.12' } }))
    expect(activeSkinIsBundleWired(entry, modules, manifest)).toBe(true)
  })

  it('useSkin writes no duplicate insert row for an installed per-skin bundle', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // The npm-installed bundle layout: a REAL package dir under the profile
    // whose own bundle patch already inserts ui-skin-xp.
    const target = join(resolvePaths(h, 'web').profileModulesDir, xp.pkg)
    makeSkinPackage(target, xp)
    writeFileSync(join(target, 'cordis.patch.yml'), `# bundle patch\n- insert:\n    - id: ${xp.id}\n      name: '${xp.pkg}'\n`)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: target },
    }
    writeFileSync(patchPath(h), '')
    useSkin('xp', { home: h, registry: fakeRegistry })
    const after = readFileSync(patchPath(h), 'utf8')
    // Home layer keeps mutual-exclusion rows only; the bundle provides the insert.
    expect(after).not.toContain('- insert:')
    expect(after).not.toContain(xp.id)
    expect(after).toContain(`- id: ${registry.trading.id}\n  disabled: true`)
    // currentSkin must still report the bundle-wired active skin.
    expect(currentSkin(after, { home: h, registry: fakeRegistry })).toBe('xp')
  })

  it('useSkin keeps the insert row for the bundled-carrier symlink layout', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // The aggregate layout: entry.dir is a skin asset inside dsh-skins/skins
    // and the profile target is only a symlink into that carrier.
    const carrierSkin = join(h, 'code', 'dsh-web-ui', 'packages', 'dsh-skins', 'skins', 'xp')
    makeSkinPackage(carrierSkin, xp)
    writeFileSync(join(carrierSkin, 'cordis.patch.yml'), `# carrier asset, not an active bundle\n- insert:\n    - id: ${xp.id}\n      name: '${xp.pkg}'\n`)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: carrierSkin },
    }
    writeFileSync(patchPath(h), '')
    useSkin('xp', { home: h, registry: fakeRegistry })
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).toContain('- insert:')
    expect(after).toContain(`      name: '${xp.pkg}'`)
    // The profile target realpath resolves inside the dsh-skins/skins carrier.
    const link = join(resolvePaths(h, 'web').profileModulesDir, xp.pkg)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(realpathSync(link)).toBe(realpathSync(carrierSkin))
    expect(carrierSkin).toContain(join('dsh-skins', 'skins'))
  })
})

describe('legacy row cleanup and duplicate insert self-heal (issue #267)', () => {
  it('stripLegacySkinRows removes legacy insert rows regardless of comment line, indent or scope', () => {
    const patch = [
      '# header',
      '- insert:',
      '    # legacy comment (historical writer style)',
      '    - id: ui-skin-miku',
      "      name: '@deepseek-ai/dsh-client-ui-skin-miku'",
      '- insert:',
      '  - id: ui-skin-trading',
      "    name: '@linxin666/dsh-client-ui-skin-trading'",
      '- id: ui-skin-xp',
      '  disabled: true',
      '- insert:',
      '    - id: memory-mem0',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '# footer',
    ].join('\n')
    const stripped = stripLegacySkinRows(patch)
    // Both legacy insert rows are gone (comment line, indentation and npm
    // scope must not protect them — any leftover row plus the managed
    // section's own row would double-insert one loader id and fail the boot).
    expect(stripped).not.toContain('ui-skin-miku')
    expect(stripped).not.toContain('ui-skin-trading')
    expect(stripped).not.toContain('legacy comment')
    // Id-target rows are mutual-exclusion wiring, not inserts — they survive.
    expect(stripped).toContain('- id: ui-skin-xp\n  disabled: true')
    // Non-skin insert blocks survive untouched; emptied skin blocks collapse.
    expect(stripped).toContain('memory-mem0')
    expect(stripped.match(/- insert:/g)).toHaveLength(1)
    expect(stripped).toContain('# header')
    expect(stripped).toContain('# footer')
  })

  it('useSkin drops its own insert row when a same-id insert row already exists elsewhere', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    const fakeDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(fakeDir, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = {
      ...registry,
      xp: { ...xp, dir: fakeDir },
    }
    // A pre-existing insert row for ui-skin-xp whose name line does not
    // match the legacy cleanup's package pattern — the last-resort guard must
    // still refuse to write a second insert row for the same loader id.
    writeFileSync(patchPath(h), [
      '# custom rows',
      '- insert:',
      '    - id: ui-skin-xp',
      '      name: xp',
      '',
    ].join('\n'))
    const message = useSkin('xp', { home: h, registry: fakeRegistry })
    const after = readFileSync(patchPath(h), 'utf8')
    // Exactly one insert row for the id (the pre-existing one); the managed
    // section only carries mutual-exclusion rows.
    expect(after.match(/- id: ui-skin-xp/g)).toHaveLength(1)
    expect(after).toContain('- id: ui-skin-xp\n      name: xp')
    expect(after).not.toContain('- id: ui-skin-xp\n      name: \'@linxin666/dsh-client-ui-skin-xp\'')
    expect(after).toContain(`- id: ${registry.trading.id}\n  disabled: true`)
    expect(message).toContain('已跳过本层 insert')
    expect(currentSkin(after, { home: h, registry: fakeRegistry })).toBe('xp')
  })
})

describe('npm-install layout registry scan (issue #21/#33/#34)', () => {
  it('loadRegistry scans a scoped dir of dsh-client-ui-skin-* packages, skipping non-skin dirs', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'skin-npm-layout-'))
    try {
      const scoped = join(fakeRoot, '@linxin666')
      mkdirSync(join(scoped, 'dsh-client-ui-skin-xp'), { recursive: true })
      mkdirSync(join(scoped, 'dsh-client-ui-skin-trading'), { recursive: true })
      // Non-skin packages in the same scoped dir must be skipped.
      mkdirSync(join(scoped, 'dsh-ssh'), { recursive: true })
      mkdirSync(join(scoped, 'dsh-task-board'), { recursive: true })
      writeFileSync(join(scoped, 'dsh-client-ui-skin-xp', 'skin.json'), JSON.stringify({
        id: 'xp',
        package: '@linxin666/dsh-client-ui-skin-xp',
        wiring: { id: 'ui-skin-xp' },
      }))
      writeFileSync(join(scoped, 'dsh-client-ui-skin-trading', 'skin.json'), JSON.stringify({
        id: 'trading',
        package: '@linxin666/dsh-client-ui-skin-trading',
        wiring: { id: 'ui-skin-trading', bundleWired: true },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['trading', 'xp'])
      expect(registry.xp).toEqual(expect.objectContaining({
        pkg: '@linxin666/dsh-client-ui-skin-xp',
        id: 'ui-skin-xp',
        dir: join(scoped, 'dsh-client-ui-skin-xp'),
      }))
      expect(registry.trading.bundleWired).toBe(true)
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
      mkdirSync(join(scoped, 'dsh-client-ui-skin-xp'), { recursive: true })
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
      writeFileSync(join(scoped, 'dsh-client-ui-skin-xp', 'skin.json'), JSON.stringify({
        id: 'xp',
        package: '@linxin666/dsh-client-ui-skin-xp',
        wiring: { id: 'ui-skin-xp' },
      }))
      const registry = loadRegistry(scoped)
      expect(Object.keys(registry).sort()).toEqual(['miku', 'trading', 'xp'])
      // Bundled skins resolve to their carrier paths.
      expect(registry.miku.dir).toBe(join(carrier, 'miku'))
      expect(registry.trading.dir).toBe(join(carrier, 'trading'))
      // Legacy per-skin packages still resolve.
      expect(registry.xp.dir).toBe(join(scoped, 'dsh-client-ui-skin-xp'))
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
      mkdirSync(join(scoped, 'dsh-client-ui-skin-xp'), { recursive: true })
      writeFileSync(join(scoped, 'dsh-client-ui-skin-xp', 'skin.json'), JSON.stringify({
        id: 'xp',
        package: '@linxin666/dsh-client-ui-skin-xp',
        wiring: { id: 'ui-skin-xp' },
      }))
      const candidates = listSkinDirCandidates(scoped)
      // The alias link must never appear as a skin-dir candidate.
      expect(candidates).not.toContain(alias)
      // The real direct package is still found.
      expect(candidates).toContain(join(scoped, 'dsh-client-ui-skin-xp'))
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
    const xp = registry.xp
    const realDir = join(h, 'code', 'dsh-web-ui', 'packages', 'skins', 'xp')
    makeSkinPackage(realDir, xp)
    const target = join(resolvePaths(h).profileModulesDir, xp.pkg)
    // First switch: a normal link target -> realDir.
    const goodRegistry: Record<string, SkinSwitchEntry> = { ...registry, xp: { ...xp, dir: realDir } }
    writeFileSync(patchPath(h), '')
    useSkin('xp', { home: h, registry: goodRegistry })
    expect(readlinkSync(target)).toBe(realDir)
    // Poison the registry exactly like the issue: entry.dir resolves to the
    // profile link path itself (the loadRegistry realpath bug). ensureSymlink
    // must refuse to re-link target -> itself (ELOOP) and leave state intact.
    const poisonedRegistry: Record<string, SkinSwitchEntry> = { ...registry, xp: { ...xp, dir: target } }
    writeFileSync(patchPath(h), '')
    expect(() => useSkin('xp', { home: h, registry: poisonedRegistry })).not.toThrow()
    // The existing link still points at the real dir, never at itself.
    expect(readlinkSync(target)).toBe(realDir)
    // And it still resolves (no ELOOP on realpath).
    expect(realpathSync(target)).toBe(realpathSync(realDir))
  })
})

describe('reconcileSkinPatches (boot-time self-heal, issue #495)', () => {
  it('drops an insert row whose skin package is no longer resolvable from the profile', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    // The patch names xp as active, but no package sits under the profile —
    // exactly the post-upgrade state where pnpm pruned the orphan package.
    writeFileSync(patchPath(h), `${renderManaged('xp', registry)}\n`)

    const result = reconcileSkinPatches({ home: h, registry })

    expect(result.changed).toBe(true)
    expect(result.activeAfter).toBeNull()
    expect(result.notes.some(note => note.includes('xp'))).toBe(true)
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).not.toContain('- insert:')
    expect(after).toContain(`- id: ${registry.xp.id}\n  disabled: true`)
    expect(currentSkin(after, { home: h, registry })).toBe('none')
  })

  it('keeps a resolvable active skin and rewrites nothing (idempotent)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const xp = registry.xp
    // npm layout: the skin package physically sits under the profile modules.
    const installed = join(resolvePaths(h).profileModulesDir, xp.pkg)
    makeSkinPackage(installed, xp)
    const fakeRegistry: Record<string, SkinSwitchEntry> = { ...registry, xp: { ...xp, dir: installed } }
    writeFileSync(patchPath(h), `${renderManaged('xp', fakeRegistry)}\n`)

    const result = reconcileSkinPatches({ home: h, registry: fakeRegistry })

    expect(result.changed).toBe(false)
    expect(result.activeAfter).toBe('xp')
    expect(result.notes).toEqual([])
    expect(readFileSync(patchPath(h), 'utf8')).toBe(`${renderManaged('xp', fakeRegistry)}\n`)
  })

  it('migrates a legacy harness-wide managed block and drops its unresolvable insert (the uninstall scenario)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    // Pre-#290 state: the managed section lives at harness-home scope with
    // whale-song active — what a skin switch on an old release leaves behind
    // after the package stops being resolvable.
    writeFileSync(legacyPatchPath(h), `${renderManaged('whale-song', registry)}\n`)
    writeFileSync(patchPath(h), '# profile patch\n[]\n')

    const result = reconcileSkinPatches({ home: h, registry })

    expect(result.changed).toBe(true)
    expect(result.activeAfter).toBeNull()
    // The legacy file held only the managed block: it must be removed, not
    // emptied — the boot parser rejects an empty patch file.
    expect(existsSync(legacyPatchPath(h))).toBe(false)
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).not.toContain('- insert:')
    expect(after).toContain(MANAGED_START)
    expect(currentSkin(after, { home: h, registry })).toBe('none')
  })

  it('drops an active skin the registry no longer knows', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    const ghost = { pkg: '@linxin666/dsh-client-ui-skin-ghost', id: 'ui-skin-ghost', dir: '/tmp/ghost', bundleWired: false }
    const ghostRegistry: Record<string, SkinSwitchEntry> = { ...registry, ghost }
    writeFileSync(patchPath(h), `${renderManaged('ghost', ghostRegistry)}\n`)

    const result = reconcileSkinPatches({ home: h, registry })

    expect(result.changed).toBe(true)
    expect(result.activeAfter).toBeNull()
    const after = readFileSync(patchPath(h), 'utf8')
    expect(after).not.toContain('ghost')
    expect(after).not.toContain('- insert:')
  })

  it('leaves a patch without a managed section untouched', () => {
    const h = fakeHome()
    writeFileSync(patchPath(h), '# user rows\n- id: custom\n  config: 1\n')

    const result = reconcileSkinPatches({ home: h })

    expect(result.changed).toBe(false)
    expect(result.activeAfter).toBeNull()
    expect(result.notes).toEqual([])
    expect(readFileSync(patchPath(h), 'utf8')).toBe('# user rows\n- id: custom\n  config: 1\n')
  })

  it('a second run on a reconciled patch is a no-op (converges after one write)', () => {
    const h = fakeHome()
    const registry = loadRegistry()
    writeFileSync(patchPath(h), `${renderManaged('xp', registry)}\n`)
    const first = reconcileSkinPatches({ home: h, registry })
    expect(first.changed).toBe(true)
    const second = reconcileSkinPatches({ home: h, registry })
    expect(second.changed).toBe(false)
    expect(second.activeAfter).toBeNull()
  })

  it('writes the template empty-flow form when the registry is empty (comment-only patch would not parse)', () => {
    const h = fakeHome()
    // A stale managed section survives a full uninstall; the registry no
    // longer knows any skin (every skin package is gone).
    writeFileSync(patchPath(h), `${MANAGED_START}\n- insert:\n    - id: ui-skin-whale-song\n      name: '@linxin666/dsh-client-ui-skin-whale-song'\n${MANAGED_END}\n`)

    const result = reconcileSkinPatches({ home: h, registry: {} })

    expect(result.changed).toBe(true)
    expect(readFileSync(patchPath(h), 'utf8').trim()).toBe('[]')
    expect(result.notes.some(note => note.includes('no skins'))).toBe(true)
  })
})
