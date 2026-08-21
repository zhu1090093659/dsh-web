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
