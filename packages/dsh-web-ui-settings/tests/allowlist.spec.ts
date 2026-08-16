/**
 * Allowlist parsing and composition: the settings.yaml web_settings_namespaces
 * key (list and map shapes), package-name aliasing, and the registered-set
 * intersection that keeps the bridge from surfacing anything unknown.
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
      '  dsh-live-stats: true',
      '  dsh-pet: {}',
    ].join('\n')
    expect(extractWebSettingsNamespaces(text)).toEqual(['dsh-live-stats', 'dsh-pet'])
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
    expect(resolveNamespaceEntry('dsh-desktop-launcher')).toBe('desktop-launcher')
  })

  it('passes bare family namespaces through', () => {
    expect(resolveNamespaceEntry('live-stats')).toBe('live-stats')
    expect(resolveNamespaceEntry('remote-web-ui')).toBe('remote-web-ui')
    expect(resolveNamespaceEntry('desktop-launcher')).toBe('desktop-launcher')
  })

  it('ignores packages without a settings namespace and unknown names', () => {
    expect(resolveNamespaceEntry('dsh-web-ui')).toBeUndefined()
    expect(resolveNamespaceEntry('dsh-client-ui-aionui-panel')).toBeUndefined()
    expect(resolveNamespaceEntry('dsh-client-ui-web-ui-settings')).toBeUndefined()
    expect(resolveNamespaceEntry('something-else')).toBeUndefined()
  })
})

describe('composeAllowlist', () => {
  const registered = [
    'dsh-ssh',
    'desktop-launcher',
    'task-board',
    'remote-web-ui',
    'live-stats',
    'pet',
    'skin-background',
    'web-search-deepseek',
  ]

  it('falls back to the family list when the user configured none', () => {
    expect(composeAllowlist([], registered)).toEqual([
      'desktop-launcher',
      'dsh-ssh',
      'live-stats',
      'pet',
      'remote-web-ui',
      'skin-background',
      'task-board',
    ])
  })

  it('honors user entries, deduplicates, and ignores unknown names', () => {
    expect(composeAllowlist(['dsh-client-ui-task-board', 'dsh-skins', 'dsh-ssh', 'nope'], registered))
      .toEqual(['dsh-ssh', 'skin-background', 'task-board'])
  })

  it('drops namespaces not registered in the settings seam', () => {
    expect(composeAllowlist(['dsh-ssh'], ['web-search-deepseek'])).toEqual([])
    expect(composeAllowlist([], [])).toEqual([])
  })
})
