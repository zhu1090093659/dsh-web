import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProfile } from '../src/host/profile.ts'

describe('resolveProfile', () => {
  const env = { DSH_HOME: '/tmp/dsh-home' } as NodeJS.ProcessEnv

  it('prefers an explicit --profile flag', () => {
    const facts = resolveProfile(['node', 'bin.js', '--profile', 'web'], env)
    expect(facts.profileName).toBe('web')
    expect(facts.profileDir).toBe(join('/tmp/dsh-home', 'profiles', 'web'))
    expect(facts.patchPath).toBe(join('/tmp/dsh-home', 'profiles', 'web', 'cordis.patch.yml'))
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

  it('rejects profile names with path separators or traversal', () => {
    for (const bad of ['../../etc', 'a/b', 'a\\b', '..']) {
      expect(() => resolveProfile(['node', 'bin.js', '--profile', bad], env), bad).toThrow(/invalid profile name/)
    }
  })
})
