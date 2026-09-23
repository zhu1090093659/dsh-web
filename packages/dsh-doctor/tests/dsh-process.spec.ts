import { spawn as nodeSpawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { dshSpawnSpec, spawnDsh, windowsCmdShimArgs } from '../src/agent/dsh-process.ts'

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(() => ({}) as never) }
})

describe('Doctor DSH process spawning', () => {
  it('keeps POSIX executables shell-free', () => {
    expect(dshSpawnSpec('/usr/local/bin/dsh', ['web'], 'linux')).toEqual({ command: '/usr/local/bin/dsh', args: ['web'] })
  })

  it('executes a Windows cmd shim through cmd.exe without general shell mode', () => {
    const spec = dshSpawnSpec('C:\\Users\\me\\AppData\\Roaming\\npm\\dsh.cmd', ['plugin', '--profile', 'web', 'add', '@linxin666/dsh-web-all@0.3.3'], 'win32')
    expect(spec.command).toBe('cmd.exe')
    expect(spec.windowsVerbatimArguments).toBe(true)
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(spec.args[3]).toContain('dsh.cmd')
    expect(spec.args[3]).toContain('@linxin666/dsh-web-all@0.3.3')
  })

  it('spawns the Windows shim through cmd.exe with verbatim arguments', () => {
    vi.mocked(nodeSpawn).mockClear()
    const options = { env: {}, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] }
    spawnDsh('C:\\npm\\dsh.cmd', ['--profile', 'web'], options, 'win32')
    expect(nodeSpawn).toHaveBeenCalledWith('cmd.exe', ['/d', '/s', '/c', expect.stringContaining('dsh.cmd')], { ...options, windowsVerbatimArguments: true })
  })

  it('rejects shell metacharacters before building a cmd command line', () => {
    expect(() => windowsCmdShimArgs('C:\\npm\\dsh.cmd', ['plugin', 'add', 'bad&name'])).toThrow('unsafe Windows command argument')
  })

  it('executes a bare dsh command on Windows through cmd.exe (#1431)', () => {
    const spec = dshSpawnSpec('dsh', ['--version'], 'win32')
    expect(spec.command).toBe('cmd.exe')
    expect(spec.windowsVerbatimArguments).toBe(true)
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(spec.args[3]).toContain('"dsh"')
    expect(spec.args[3]).toContain('"--version"')
  })
})
