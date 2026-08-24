import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopSelectedProfile, resolveProfile } from '../src/host/profile.ts'

describe('resolveProfile', () => {
  const env = { DSH_HOME: '/tmp/dsh-home' } as NodeJS.ProcessEnv

  it('prefers an explicit --profile flag', () => {
    const facts = resolveProfile(['node', 'bin.js', '--profile', 'web'], env)
    expect(facts.profileName).toBe('web')
    expect(facts.profileDir).toBe(join('/tmp/dsh-home', 'profiles', 'web'))
    expect(facts.patchPath).toBe(join('/tmp/dsh-home', 'profiles', 'web', 'cordis.patch.yml'))
    expect(facts.desktop).toBe(false)
  })

  it('falls back to DSH_PROFILE when the flag is absent', () => {
    const facts = resolveProfile(['node', 'bin.js'], { ...env, DSH_PROFILE: 'headless' })
    expect(facts.profileName).toBe('headless')
  })

  it('treats the web subcommand as the web profile', () => {
    const facts = resolveProfile(['node', 'bin.js', 'web'], env)
    expect(facts.profileName).toBe('web')
  })

  it('throws when nothing names a profile', () => {
    expect(() => resolveProfile(['node', 'bin.js'], env)).toThrow(/cannot determine the boot profile/)
  })

  it('resolves the packaged desktop profile from its persisted selection', () => {
    const appData = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
    try {
      const stateDir = join(appData, 'DSH Desktop', 'profile-selection')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ active: 'desktop' }), 'utf8')
      const facts = resolveProfile(['DSH Desktop.exe'], { ...env, APPDATA: appData })
      expect(facts.profileName).toBe('desktop')
      expect(facts.desktop).toBe(true)
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('prefers the desktop shim environment value and ignores malformed state', () => {
    expect(desktopSelectedProfile({ DSH_DESKTOP_DEFAULT_PROFILE: ' desktop ' })).toBe('desktop')
  })

  it('keeps desktop detection when DSH_PROFILE is the packaged app workaround', () => {
    const facts = resolveProfile(['DSH Desktop.exe'], {
      ...env,
      DSH_PROFILE: 'desktop',
      DSH_DESKTOP_DEFAULT_PROFILE: 'desktop',
    })
    expect(facts).toMatchObject({ profileName: 'desktop', desktop: true })
  })

  it('rejects profile names with path separators or traversal', () => {
    for (const bad of ['../../etc', 'a/b', 'a\\b', '..']) {
      expect(() => resolveProfile(['node', 'bin.js', '--profile', bad], env), bad).toThrow(/invalid profile name/)
    }
  })
})

describe('readProfileManifest and stripBom', () => {
  it('strips leading UTF-8 BOM from package.json and cordis.patch.yml', async () => {
    const { readPatchText, readProfileManifest, stripBom, stripProfileBundles } = await import('../src/host/profile.ts')
    expect(stripBom('\uFEFF{"hello":"world"}')).toBe('{"hello":"world"}')
    expect(stripBom('{"hello":"world"}')).toBe('{"hello":"world"}')

    const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-bom-'))
    try {
      const pkgPath = join(dir, 'package.json')
      const patchPath = join(dir, 'cordis.patch.yml')
      writeFileSync(pkgPath, '\uFEFF' + JSON.stringify({
        dsh: { profile: { bundles: ['@linxin666/dsh-web-all'] } },
        dependencies: { 'dsh-context': '^0.25.3' },
      }), 'utf8')
      writeFileSync(patchPath, '\uFEFF- id: test\n  name: test\n', 'utf8')

      const manifest = await readProfileManifest(pkgPath)
      expect(manifest.bundles).toEqual(['@linxin666/dsh-web-all'])
      expect(manifest.dependencies).toEqual({ 'dsh-context': '^0.25.3' })

      const patchText = await readPatchText(patchPath)
      expect(patchText.startsWith('\uFEFF')).toBe(false)
      expect(patchText).toContain('id: test')

      await stripProfileBundles(pkgPath, ['@linxin666/dsh-web-all'])
      const after = await readProfileManifest(pkgPath)
      expect(after.bundles).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

