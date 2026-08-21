import { describe, expect, it } from 'vitest'
import { detectOfficialChannels, dshSpawnCommand, findDshBinary, unsafeSpecReason, windowsCmdShimArgs } from '../src/host/gateway.ts'
import { sourceKindOf } from '../src/host/state.ts'

describe('findDshBinary', () => {
  const exists = (present: string[]) => (path: string) => present.includes(path)

  it('finds a dsh on a POSIX PATH', () => {
    expect(findDshBinary({ PATH: '/usr/bin' }, 'darwin', exists(['/usr/bin/dsh']))).toBe('/usr/bin/dsh')
  })

  it('finds a dsh.cmd on Windows', () => {
    expect(findDshBinary({ PATH: 'C:\\tools' }, 'win32', exists(['C:\\tools\\dsh.cmd']))).toBe('C:\\tools\\dsh.cmd')
  })

  it('falls back to a local wrapper installation outside PATH on Windows', () => {
    const binary = 'D:\\APP\\DSH\\node_modules\\.bin\\dsh.cmd'
    expect(findDshBinary(
      { PATH: 'C:\\Windows\\System32' },
      'win32',
      exists([binary]),
      'D:\\APP\\DSH\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    )).toBe(binary)
  })

  it('keeps PATH precedence over the host installation fallback', () => {
    const pathBinary = 'C:\\tools\\dsh.cmd'
    const localBinary = 'D:\\APP\\DSH\\node_modules\\.bin\\dsh.cmd'
    expect(findDshBinary(
      { PATH: 'C:\\tools' },
      'win32',
      exists([pathBinary, localBinary]),
      'D:\\APP\\DSH\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    )).toBe(pathBinary)
  })

  it('finds the nearest POSIX project shim from the host entry', () => {
    expect(findDshBinary(
      { PATH: '/nothing' },
      'linux',
      exists(['/opt/dsh/node_modules/.bin/dsh']),
      '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
    )).toBe('/opt/dsh/node_modules/.bin/dsh')
  })

  it('falls back to the darwin homebrew location', () => {
    expect(findDshBinary({ PATH: '/nothing' }, 'darwin', exists(['/opt/homebrew/bin/dsh']))).toBe('/opt/homebrew/bin/dsh')
  })

  it('returns null when nothing matches', () => {
    expect(findDshBinary({ PATH: '/definitely/absent' }, 'linux', exists([]))).toBeNull()
  })
})

describe('sourceKindOf', () => {
  it('classifies registry specs as npm and git/link specs as git', () => {
    expect(sourceKindOf('@scope/pkg')).toBe('npm')
    expect(sourceKindOf('pkg@1.0.0')).toBe('npm')
    expect(sourceKindOf('link:/x/packages/y')).toBe('git')
    expect(sourceKindOf('git+https://github.com/a/b')).toBe('git')
    expect(sourceKindOf('github:a/b')).toBe('git')
    expect(sourceKindOf('https://github.com/a/b')).toBe('git')
  })
})

describe('dshSpawnCommand', () => {
  it('keeps the binary as-is off Windows', () => {
    expect(dshSpawnCommand('/usr/local/bin/dsh', 'darwin')).toEqual({ command: '/usr/local/bin/dsh', argsPrefix: [] })
  })

  it('resolves the wrapper into node + bin.js on Windows, preferring a local node', () => {
    const binary = 'C:\\Program Files\\nodejs\\dsh.cmd'
    expect(dshSpawnCommand(binary, 'win32', () => true, () => true)).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: ['C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'],
    })
  })

  it('falls back to the .cmd shim when no npm bin.js exists', () => {
    const { command, argsPrefix } = dshSpawnCommand('C:\\Program Files\\nodejs\\dsh.cmd', 'win32', () => false)
    expect(argsPrefix).toEqual([])
    expect(command).toBe('C:\\Program Files\\nodejs\\dsh.cmd')
  })

  it('resolves the npx layout when the package sits one level above the shim (issue #683)', () => {
    const binary = 'C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\.bin\\dsh.cmd'
    const { argsPrefix } = dshSpawnCommand(binary, 'win32', () => false, (path) => path.includes('_npx') && !path.includes('\\.bin'))
    expect(argsPrefix).toEqual([
      'C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    ])
  })

  it('prefers the npm-global layout when both bin scripts exist', () => {
    const binary = 'C:\\tools\\nodejs\\dsh.cmd'
    const { argsPrefix } = dshSpawnCommand(binary, 'win32', () => false, () => true)
    expect(argsPrefix[0]).toBe('C:\\tools\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')
  })
})

describe('desktop .cmd execution', () => {
  it('keeps a spaced shim path and every argument inside the cmd /s envelope', () => {
    expect(windowsCmdShimArgs('C:\\Users\\u\\AppData\\Roaming\\DSH Desktop\\host-commands\\desktop\\bin\\dsh.cmd', [
      '--profile', 'desktop', 'plugin', 'add', '@scope/pkg@1.2.3',
    ])).toEqual([
      '/d', '/s', '/c',
      '""C:\\Users\\u\\AppData\\Roaming\\DSH Desktop\\host-commands\\desktop\\bin\\dsh.cmd" "--profile" "desktop" "plugin" "add" "@scope/pkg@1.2.3""',
    ])
  })

  it('rejects cmd expansion characters before constructing a shell line', () => {
    expect(() => windowsCmdShimArgs('C:\\dsh.cmd', ['pkg%PATH%'])).toThrow(/unsafe/)
    expect(unsafeSpecReason('pkg%PATH%')).toBeDefined()
  })
})

describe('detectOfficialChannels', () => {
  const fakeSpawn = (output: string, code = 0) => () => ({
    stdout: { on: (event: string, handler: (chunk: Buffer) => void) => { if (event === 'data') handler(Buffer.from(output)) } },
    stderr: { on: () => {} },
    on: (event: string, handler: (chunk?: number | null) => void) => { if (event === 'close') setTimeout(() => handler(code), 0) },
  })

  it('reports official channels when the dump carries the installer entry id', async () => {
    const probe = fakeSpawn('entries:\n  - id: plugin-installer\n    name: installer\n  - id: plugin-control\n    name: control')
    await expect(detectOfficialChannels('/usr/bin/dsh', 'web', {}, probe as never)).resolves.toBe(true)
  })

  it('ignores the installer mark in prose or config values (no false positive)', async () => {
    const probe = fakeSpawn('composed entries include plugin-installer routes\n  - id: dsh-base\n    note: plugin-installer mention')
    await expect(detectOfficialChannels('/usr/bin/dsh', 'web', {}, probe as never)).resolves.toBe(false)
  })

  it('reports no official channels on the npm web dump', async () => {
    const probe = fakeSpawn('composed entries: dsh-base, dsh-web-app')
    await expect(detectOfficialChannels('/usr/bin/dsh', 'web', {}, probe as never)).resolves.toBe(false)
  })

  it('treats a failed dump as no official channels', async () => {
    const probe = fakeSpawn('boot failed', 1)
    await expect(detectOfficialChannels('/usr/bin/dsh', 'web', {}, probe as never)).resolves.toBe(false)
  })
})
