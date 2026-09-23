/**
 * Settings document resolution: the DSH home fallback, the renamed import the
 * new settings surface leaves behind, the Host-reported document path (the
 * profile patch on 0.1.7, which is not a settings document), and the profile
 * entry reader the bridge maps namespaces through.
 *
 * test-standards-allow: path-resolution unit tests over temporary directories
 */
import { describe, expect, it } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import {
  importedSettingsYamlPath,
  isSettingsDocumentPath,
  readProfileEntries,
  readSettingsYamlDocument,
  settingsYamlCandidatePaths,
  settingsYamlFallbackPath,
} from '../src/index.ts'

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

describe('settings document candidates', () => {
  const env = {} as NodeJS.ProcessEnv
  const home = join(tmpdir(), 'settings-path-home')
  const imported = join(home, '.dsh', 'settings.yaml.imported')
  const legacy = join(home, '.dsh', 'settings.yaml')

  it('resolves the renamed import beside the document', () => {
    expect(importedSettingsYamlPath(env, home)).toBe(imported)
  })

  it('reads the renamed import first, then the legacy document', () => {
    expect(settingsYamlCandidatePaths(undefined, env, home)).toEqual([imported, legacy])
  })

  it('admits the Host-reported document only when it is a settings document', () => {
    // 0.1.7 reports the PROFILE PATCH through documentPath: it is not a
    // settings.yaml and must not be parsed as one.
    const patch = join(home, '.dsh', 'profiles', 'default', 'cordis.patch.yml')
    expect(isSettingsDocumentPath(patch)).toBe(false)
    expect(settingsYamlCandidatePaths(patch, env, home)).toEqual([imported, legacy])
    const hostYaml = join(home, 'elsewhere', 'settings.yaml')
    expect(isSettingsDocumentPath(hostYaml)).toBe(true)
    expect(settingsYamlCandidatePaths(hostYaml, env, home)).toEqual([imported, legacy, hostYaml])
  })

  it('reads the first readable candidate and answers empty when none is', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'settings-yaml-'))
    const importedPath = join(fresh, 'settings.yaml.imported')
    const legacyPath = join(fresh, 'settings.yaml')
    writeFileSync(legacyPath, 'web_settings_namespaces:\n  - task-board\n')
    expect(readSettingsYamlDocument([importedPath, legacyPath])).toContain('task-board')
    writeFileSync(importedPath, 'web_settings_namespaces:\n  - pet\n')
    expect(readSettingsYamlDocument([importedPath, legacyPath])).toContain('pet')
    expect(readSettingsYamlDocument([join(fresh, 'missing.yaml')])).toBe('')
  })
})

describe('readProfileEntries', () => {
  it('reads the config editor rows, tolerating a missing or refusing editor', () => {
    const entries = [{ options: { id: 'web-ui-task-board', name: '@linxin666/dsh-web-all/task-board' } }]
    expect(readProfileEntries({ get: name => name === 'configEditor' ? { entries: () => entries } : undefined }))
      .toEqual(entries)
    expect(readProfileEntries({ get: () => undefined })).toEqual([])
    expect(readProfileEntries({ get: () => ({}) })).toEqual([])
    expect(readProfileEntries({ get: () => ({ entries: () => ({ not: 'a list' }) }) })).toEqual([])
    expect(readProfileEntries({ get: () => ({ entries: () => { throw new Error('editor busy') } }) })).toEqual([])
  })
})
