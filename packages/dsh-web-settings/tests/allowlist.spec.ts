/**
 * Allowlist parsing and composition: the settings.yaml web_settings_namespaces
 * key (list and map shapes), package-name aliasing, and the registered-set
 * intersection that keeps the bridge from surfacing anything unknown.
 *
 * test-standards-allow: allowlist parsing unit tests over synthetic YAML fixtures
 */

import { describe, expect, it } from 'vitest'
import { composeAllowlist, extractWebSettingsNamespaces, resolveNamespaceEntry } from '../src/allowlist.ts'

describe('extractWebSettingsNamespaces', () => {
  it('reads a block list', () => {
    const text = [
      'web_settings_namespaces:',
      '  - dsh-ssh',
      '  - dsh-client-ui-task-board',
      '  - "dsh-skins"',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['dsh-ssh', 'dsh-client-ui-task-board', 'dsh-skins'])
  })

  it('reads a block map', () => {
    const text = [
      'web_settings_namespaces:',
      '  dsh-liangshen: true',
      '  dsh-pet: {}',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['dsh-liangshen', 'dsh-pet'])
  })

  it('reads an inline flow list', () => {
    expect(extractWebSettingsNamespaces('web_settings_namespaces: [dsh-ssh, "dsh-skins"]')).toEqual(['dsh-ssh', 'dsh-skins'])
  })

  it('skips comment lines and stops at the next top-level key', () => {
    const text = [
      'web_settings_namespaces:',
      '  - dsh-ssh',
      '  # a comment',
      'llm:',
      '  provider: x',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['dsh-ssh'])
  })

  it('reads a block list when the key line carries a trailing comment', () => {
    const text = [
      'web_settings_namespaces:  # expose only task-board',
      '  - task-board',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['task-board'])
  })

  it('reads an unindented block list (YAML allows column-0 sequence items)', () => {
    const text = [
      'web_settings_namespaces:',
      '- dsh-ssh',
      '- dsh-pet',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['dsh-ssh', 'dsh-pet'])
  })

  it('returns the empty list when the key is absent or the file is empty', () => {
    expect(extractWebSettingsNamespaces('llm:\n  provider: x\n')).toEqual([])
    expect(extractWebSettingsNamespaces('')).toEqual([])
  })
})

describe('resolveNamespaceEntry', () => {
  it('maps package names onto their settings namespaces', () => {
    expect(resolveNamespaceEntry('dsh-client-ui-task-board')).toBe('task-board')
    expect(resolveNamespaceEntry('dsh-skins')).toBe('skin-background')
    expect(resolveNamespaceEntry('dsh-ssh')).toBe('dsh-ssh')
  })

  it('passes bare family namespaces through', () => {
    expect(resolveNamespaceEntry('pet')).toBe('pet')
    expect(resolveNamespaceEntry('remote-web-ui')).toBe('remote-web-ui')
    expect(resolveNamespaceEntry('community-plugins')).toBe('community-plugins')
  })

  it('maps the market and skin custom-theme / wallpaper namespaces (#1176, #1370)', () => {
    expect(resolveNamespaceEntry('dsh-market')).toBe('dsh-market')
    expect(resolveNamespaceEntry('dshmarket')).toBe('dsh-market')
    expect(resolveNamespaceEntry('dsh-client-ui-market')).toBe('dsh-market')
    expect(resolveNamespaceEntry('dsh-web-ui-market')).toBe('dsh-market')
    expect(resolveNamespaceEntry('market')).toBe('dsh-market')
    expect(resolveNamespaceEntry('skin-custom-theme')).toBe('skin-custom-theme')
    expect(resolveNamespaceEntry('skin-wallpaper')).toBe('skin-wallpaper')
    expect(resolveNamespaceEntry('usage')).toBe('usage')
    expect(resolveNamespaceEntry('liangshen')).toBe('liangshen')
    expect(resolveNamespaceEntry('session-archive')).toBe('session-archive')
  })

  it('ignores packages without a settings namespace and unknown names', () => {
    expect(resolveNamespaceEntry('dsh-web')).toBeUndefined()
    expect(resolveNamespaceEntry('dsh-client-ui-web-ui-settings')).toBeUndefined()
    expect(resolveNamespaceEntry('something-else')).toBeUndefined()
  })

  it('resolves a full npm name through its bare package segment', () => {
    // The profile row is the only place a package name survives on 0.1.7, and
    // it spells the package scoped (`@linxin666/dsh-client-ui-x`) or as the
    // aggregate's subplugin (`@linxin666/dsh-web-all/x`).
    expect(resolveNamespaceEntry('@linxin666/dsh-client-ui-task-board')).toBe('task-board')
    expect(resolveNamespaceEntry('@linxin666/dsh-web-all/task-board')).toBe('task-board')
    expect(resolveNamespaceEntry('@linxin666/dsh-ssh')).toBe('dsh-ssh')
    expect(resolveNamespaceEntry('@linxin666/dsh-web-all/pet')).toBe('pet')
    expect(resolveNamespaceEntry('@linxin666/dsh-client-ui-skin-center')).toBe('skin-background')
  })

  it('operator resolves each extracted satellite from both spellings after the split', () => {
    // Given the skin center, pet and community index moved to their own
    // repositories and their aggregate rows now name the real package,
    const satellites = [
      { subpath: '@linxin666/dsh-web-all/pet', pkg: '@linxin666/dsh-pet', ns: 'pet' },
      {
        subpath: '@linxin666/dsh-web-all/skin-center',
        pkg: '@linxin666/dsh-client-ui-skin-center',
        ns: 'skin-background',
      },
      {
        subpath: '@linxin666/dsh-web-all/community-plugins',
        pkg: '@linxin666/dsh-client-ui-community-plugins',
        ns: 'community-plugins',
      },
    ] as const
    // When the operator keeps a profile written before the split (old subpath
    // row name) or installs fresh (new package name),
    const resolved = satellites.map(satellite => [
      resolveNamespaceEntry(satellite.subpath),
      resolveNamespaceEntry(satellite.pkg),
    ])
    // Then both spellings land on the same settings namespace and the form
    // keeps being offered.
    expect(resolved).toEqual(satellites.map(satellite => [satellite.ns, satellite.ns]))
  })

  it('still ignores a scoped name that owns no settings namespace', () => {
    expect(resolveNamespaceEntry('@linxin666/dsh-web-all')).toBeUndefined()
    expect(resolveNamespaceEntry('@linxin666/dsh-client-ui-web-ui-settings')).toBeUndefined()
    expect(resolveNamespaceEntry('@linxin666/dsh-web-all/does-not-exist')).toBeUndefined()
    expect(resolveNamespaceEntry('@linxin666')).toBeUndefined()
  })
})

describe('composeAllowlist', () => {
  const registered = [
    'dsh-ssh',
    'task-board',
    'remote-web-ui',
    'pet',
    'skin-background',
    'skin-custom-theme',
    'skin-wallpaper',
    'community-plugins',
    'dsh-web-ui-market',
    'web-search-deepseek',
  ]

  it('falls back to the family list when the user configured none', () => {
    // The retired remote-web-ui family is out of the fallback list even though
    // its namespace is still registered (standalone installs keep it): the
    // bundle no longer mounts it, so nothing should surface its form by default.
    expect(composeAllowlist([], registered)).toEqual([
      'community-plugins',
      'dsh-ssh',
      'dsh-web-ui-market',
      'pet',
      'skin-background',
      'skin-custom-theme',
      'skin-wallpaper',
      'task-board',
    ])
  })

  it('honors user entries, deduplicates, and ignores unknown names', () => {
    expect(composeAllowlist(['dsh-client-ui-task-board', 'dsh-skins', 'dsh-ssh', 'dsh-market', 'nope'], registered))
      .toEqual(['dsh-ssh', 'dsh-web-ui-market', 'skin-background', 'task-board'])
  })

  it('resolves official dshmarket registered as dsh-market (#1370)', () => {
    const officialRegistered = ['dsh-market', 'task-board']
    expect(composeAllowlist([], officialRegistered)).toEqual(['dsh-market', 'task-board'])
    expect(composeAllowlist(['dsh-market'], officialRegistered)).toEqual(['dsh-market'])
    expect(composeAllowlist(['dshmarket'], officialRegistered)).toEqual(['dsh-market'])
    expect(composeAllowlist(['dsh-web-ui-market'], officialRegistered)).toEqual(['dsh-market'])
  })

  it('drops namespaces not registered in the settings seam', () => {
    expect(composeAllowlist(['dsh-ssh'], ['web-search-deepseek'])).toEqual([])
    expect(composeAllowlist([], [])).toEqual([])
  })
})
