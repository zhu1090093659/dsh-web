import { describe, expect, it } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsYamlFallbackPath } from '../src/index.ts'

describe('settingsYamlFallbackPath', () => {
  const env = {} as NodeJS.ProcessEnv
  const home = join(tmpdir(), 'settings-path-home')

  it('honors an absolute DSH_HOME', () => {
    const dshHome = join(tmpdir(), 'settings-path-dshhome')
    expect(settingsYamlFallbackPath({ DSH_HOME: dshHome }, home)).toBe(join(dshHome, 'settings.yaml'))
  })

  it('expands a leading tilde in DSH_HOME', () => {
    expect(settingsYamlFallbackPath({ DSH_HOME: '~/dsh-data' }, home)).toBe(join(home, 'dsh-data', 'settings.yaml'))
  })

  it('falls back to <home>/.dsh when DSH_HOME is unset or blank', () => {
    expect(settingsYamlFallbackPath(env, home)).toBe(join(home, '.dsh', 'settings.yaml'))
    expect(settingsYamlFallbackPath({ DSH_HOME: '  ' }, home)).toBe(join(home, '.dsh', 'settings.yaml'))
  })

  it('defaults to the live home directory', () => {
    expect(settingsYamlFallbackPath(env)).toBe(join(homedir(), '.dsh', 'settings.yaml'))
  })
})
