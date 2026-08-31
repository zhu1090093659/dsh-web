/**
 * Install-spec validation tests: the market card hands the spec selected
 * from the remote manifest to the pluginManager service, so only npm
 * package names and plain https:// git URLs may pass.
 */

import { describe, expect, it } from 'vitest'
import { entryInstalled, installSpec, isInstallSpecValid } from './install-source.ts'
import type { InstalledPluginItem } from './plugin-manager-bridge.ts'

describe('installSpec', () => {
  it('prefers npm over repo, then falls back to the id', () => {
    expect(installSpec({ id: 'entry' })).toBe('entry')
    expect(installSpec({ id: 'entry', repo: 'https://github.com/u/r' })).toBe('https://github.com/u/r')
    expect(installSpec({ id: 'entry', npm: 'pkg', repo: 'https://github.com/u/r' })).toBe('pkg')
  })
})

describe('isInstallSpecValid', () => {
  it('accepts npm package names (scoped and plain)', () => {
    expect(isInstallSpecValid('dsh-tui')).toBe(true)
    expect(isInstallSpecValid('@deepseek-harness-tui/dsh-tui')).toBe(true)
    expect(isInstallSpecValid('dsh_client-ui.skill-explorer')).toBe(true)
    expect(isInstallSpecValid('dsh-tui@1.2.3')).toBe(true)
    expect(isInstallSpecValid('dsh-tui@next')).toBe(true)
    expect(isInstallSpecValid('@scope/pkg@1.2.3-rc.1')).toBe(true)
  })

  it('rejects malformed npm specs', () => {
    for (const spec of [
      'Dsh-TUI',
      '-dsh-tui',
      '.dsh-tui',
      '_dsh-tui',
      'dsh/tui',
      '@scope',
      '@scope/',
      '@scope/pkg/sub',
      'dsh-tui@',
      'dsh-tui@^1.0.0',
      'dsh-tui@https://evil.example',
      'dsh-tui foo',
      'dsh-tui\n',
      'http://github.com/u/r',
      'github.com/u/r',
      './local-repo',
      '/tmp/local-repo',
      'C:\\local-repo',
    ]) {
      expect(isInstallSpecValid(spec), spec).toBe(false)
    }
  })

  it('accepts plain https:// git URLs', () => {
    for (const spec of [
      'https://github.com/omdsh-dev/dsh-data-agent',
      'https://github.com/wingsky-1/dsh-plugin-hub/tree/main/packages/dsh-gzip',
      'https://github.com/u/r.git#main',
      'https://example.com/repo',
    ]) {
      expect(isInstallSpecValid(spec), spec).toBe(true)
    }
  })

  it('rejects non-https git forms and malformed URLs', () => {
    for (const spec of [
      'ssh://git@github.com/u/r.git',
      'git@github.com:u/r.git',
      'git+https://github.com/u/r',
      'git://github.com/u/r',
      'file:///tmp/repo',
      'HTTPS://github.com/u/r',
      'https://',
      'https:///path',
      'https://github.com/u r',
      'https://github.com/u/r\n',
      'https://github.com/u/r\x00',
    ]) {
      expect(isInstallSpecValid(spec), spec).toBe(false)
    }
  })
})

describe('entryInstalled', () => {
  const rowAnnotation: InstalledPluginItem = {
    id: '@omdsh-dev/dsh-annotation',
    name: '@omdsh-dev/dsh-annotation',
    version: '1.0.0',
    source: { kind: 'npm', spec: '^1.0.0' },
    installedAt: '2026-08-30T00:00:00Z',
    enabled: true,
  }

  const rowAutoMemory: InstalledPluginItem = {
    id: '@a9i5k4/dsh-auto-memory',
    name: '@a9i5k4/dsh-auto-memory',
    version: '2.1.0',
    source: { kind: 'npm', spec: '^2.0.0' },
    installedAt: '2026-08-30T00:00:00Z',
    enabled: true,
  }

  const rowGitAgent: InstalledPluginItem = {
    id: 'dsh-data-agent',
    name: 'dsh-data-agent',
    version: '0.1.0',
    source: { kind: 'git', spec: 'https://github.com/omdsh-dev/dsh-data-agent.git' },
    installedAt: '2026-08-30T00:00:00Z',
    enabled: true,
  }

  const installedList = [rowAnnotation, rowAutoMemory, rowGitAgent]

  it('matches exact id', () => {
    expect(entryInstalled({ id: '@omdsh-dev/dsh-annotation' }, installedList)).toBe(rowAnnotation)
  })

  it('matches scoped npm package when entry has unscoped id', () => {
    // e.g. entry is { id: 'dsh-annotation' }, installed row is '@omdsh-dev/dsh-annotation'
    expect(entryInstalled({ id: 'dsh-annotation', repo: 'https://github.com/omdsh-dev/dsh-annotation' }, installedList)).toBe(rowAnnotation)
  })

  it('matches declared entry.npm against scoped installed row', () => {
    // e.g. entry has id 'dsh-auto-memory' and npm '@a9i5k4/dsh-auto-memory'
    expect(entryInstalled({
      id: 'dsh-auto-memory',
      npm: '@a9i5k4/dsh-auto-memory',
      repo: 'https://github.com/Aik358/dsh-auto-memory',
    }, installedList)).toBe(rowAutoMemory)
  })

  it('matches git repository spec against entry.repo', () => {
    expect(entryInstalled({
      id: 'dsh-data-agent',
      repo: 'https://github.com/omdsh-dev/dsh-data-agent',
    }, installedList)).toBe(rowGitAgent)
  })

  it('returns null for uninstalled plugins', () => {
    expect(entryInstalled({ id: 'dsh-uninstalled-plugin', repo: 'https://github.com/foo/bar' }, installedList)).toBeNull()
    expect(entryInstalled({ id: 'dsh-other', npm: '@other/pkg' }, installedList)).toBeNull()
  })
})
