/**
 * Install-spec validation tests: the market card hands the spec selected
 * from the remote manifest to the pluginManager service, so only npm
 * package names and plain https:// git URLs may pass.
 */

import { describe, expect, it } from 'vitest'
import { installSpec, isInstallSpecValid } from './install-source.ts'

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
