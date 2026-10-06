import { describe, expect, it, vi } from 'vitest'
import { detectOfficialChannels, dshSpawnCommand, findDshBinary, unsafeSpecReason, windowsCmdShimArgs, withPrependedPath } from '../src/host/gateway.ts'
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
  it('finds the packaged desktop runtime CLI with no PATH and no .bin shim (issue #1588)', () => {
    const hostEntry = 'C:\\Users\\u\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\host\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
    const binJs = 'C:\\Users\\u\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\host\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
    // The staged runtime strips every node_modules/.bin directory, so the
    // package's own lib/bin.js is the only launchable form there.
    expect(findDshBinary(
      { PATH: 'C:\\Windows\\System32;C:\\Windows' },
      'win32',
      exists([binJs]),
      hostEntry,
    )).toBe(binJs)
  })

  it('operator gets the packaged Desktop CLI found in its own resource tree when the host is inside app.asar (issue #1819)', () => {
    // Given the packaged Desktop layout: the host entry lives inside
    // resources/app.asar/dsh, the private host package ships no lib/bin.js,
    // every .bin directory is stripped, and PATH carries only the runtime's
    // node — while the CLI launcher sits in the sibling runtime/cli/bin tree
    const resources = 'C:\\Users\\u\\AppData\\Local\\Programs\\DeepSeek Harness\\resources'
    const hostEntry = `${resources}\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js`
    const cli = `${resources}\\runtime\\cli\\bin\\dsh.cmd`

    // When the CLI is resolved from those launcher facts
    const found = findDshBinary(
      { PATH: `${resources}\\runtime\\bin;C:\\Windows\\System32` },
      'win32',
      exists([cli]),
      hostEntry,
      resources,
    )

    // Then the bundled launcher is reported, so version probes and writes work
    expect(found).toBe(cli)
  })

  it('operator gets the packaged Desktop CLI from the host entry alone, with no Electron resource fact', () => {
    // Given the same tree on a host that reports no resourcesPath, including
    // macOS's capitalized Resources directory
    const resources = '/Applications/DeepSeek Harness.app/Contents/Resources'
    const hostEntry = `${resources}/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js`
    const cli = `${resources}/runtime/cli/bin/dsh`

    // When the entry script is the only launcher fact
    const found = findDshBinary({ PATH: '/usr/bin' }, 'darwin', exists([cli]), hostEntry, undefined)

    // Then the resource root is still derived from the entry's own ancestors
    expect(found).toBe(cli)
  })

  it('operator keeps a PATH dsh ahead of the packaged Desktop CLI', () => {
    // Given a user-installed dsh on PATH beside a packaged Desktop install
    const resources = 'C:\\Program Files\\DeepSeek Harness\\resources'
    const hostEntry = `${resources}\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js`
    const pathBinary = 'C:\\tools\\dsh.cmd'
    const desktopCli = `${resources}\\runtime\\cli\\bin\\dsh.cmd`

    // When the CLI is resolved
    const found = findDshBinary(
      { PATH: 'C:\\tools' },
      'win32',
      exists([pathBinary, desktopCli]),
      hostEntry,
      resources,
    )

    // Then the user's own installation still wins, as it always has
    expect(found).toBe(pathBinary)
  })

  it('operator gets no CLI invented from an unrelated resources directory', () => {
    // Given a host whose entry happens to sit under a directory named
    // resources but which carries no bundled runtime
    const hostEntry = '/srv/app/resources/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'

    // When the CLI is resolved
    const found = findDshBinary({ PATH: '/usr/bin' }, 'linux', exists([]), hostEntry, undefined)

    // Then nothing is reported, so the caller keeps its fail-closed verdict
    expect(found).toBeNull()
  })

  it('prefers a .bin shim over the sibling package bin.js when both exist', () => {
    const shim = 'D:\\APP\\DSH\\node_modules\\.bin\\dsh.cmd'
    const hostEntry = 'D:\\APP\\DSH\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
    expect(findDshBinary({ PATH: 'C:\\Windows' }, 'win32', exists([shim, hostEntry]), hostEntry)).toBe(shim)
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

  it('runs a resolved bin.js through the host interpreter on Windows', () => {
    const binary = 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\host\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
    const resolved = dshSpawnCommand(binary, 'win32', () => false)
    expect(resolved.argsPrefix).toEqual([binary])
    expect(resolved.command).toBe(process.execPath)
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

describe('dshSpawnCommand POSIX interpreter resolution', () => {
  /** A head probe answering one shebang line. */
  const shebang = (line: string) => () => `${line}\nimport { x } from 'y'\n`
  const noNodeBeside = () => false

  it('operator: runs an env-node shebang CLI through the node beside it', () => {
    // Given the homebrew/npm-global layout whose dsh shim is a Node script
    // When the spawn command is resolved off Windows
    const resolved = dshSpawnCommand('/opt/homebrew/bin/dsh', 'darwin', () => true, noNodeBeside, shebang('#!/usr/bin/env node'))

    // Then the sibling node runs the script, and the shebang is never consulted
    expect(resolved).toEqual({ command: '/opt/homebrew/bin/node', argsPrefix: ['/opt/homebrew/bin/dsh'] })
  })

  it('operator: falls back to the host interpreter when no node sits beside the CLI', () => {
    // Given a .bin shim whose directory ships no node
    // When the spawn command is resolved
    const resolved = dshSpawnCommand('/opt/pkg/node_modules/.bin/dsh', 'darwin', noNodeBeside, noNodeBeside, shebang('#!/usr/bin/env node'))

    // Then the host's own interpreter runs the script (Electron covers its own case)
    expect(resolved.command).toBe(process.execPath)
    expect(resolved.argsPrefix).toEqual(['/opt/pkg/node_modules/.bin/dsh'])
  })

  it('operator: runs a .js bin path through the host interpreter without probing the file', () => {
    // Given a packaged lib/bin.js path (the desktop runtime strips .bin shims)
    const readHead = vi.fn(() => undefined)

    // When the spawn command is resolved
    const resolved = dshSpawnCommand('/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js', 'darwin', noNodeBeside, noNodeBeside, readHead)

    // Then the extension alone selects the interpreter, with no read of the file
    expect(resolved).toEqual({ command: process.execPath, argsPrefix: ['/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'] })
    expect(readHead).not.toHaveBeenCalled()
  })

  it('operator: spawns a native executable and a shell wrapper directly', () => {
    // Given a native binary and a sh wrapper, neither carrying a node shebang
    // When each spawn command is resolved
    // Then neither is routed through an interpreter
    expect(dshSpawnCommand('/usr/bin/dsh-native', 'darwin', () => true, noNodeBeside, () => '\u007fELF\u0002'))
      .toEqual({ command: '/usr/bin/dsh-native', argsPrefix: [] })
    expect(dshSpawnCommand('/usr/local/bin/dsh', 'darwin', () => true, noNodeBeside, shebang('#!/bin/sh')))
      .toEqual({ command: '/usr/local/bin/dsh', argsPrefix: [] })
  })

  it('operator: falls back to a direct spawn when the head cannot be read', () => {
    // Given a path whose head probe fails (a directory, a permission error, an unreadable entry)
    // When the spawn command is resolved
    // Then the path is spawned as-is rather than guessed at
    expect(dshSpawnCommand('/opt/weird/dsh', 'darwin', () => true, noNodeBeside, () => undefined))
      .toEqual({ command: '/opt/weird/dsh', argsPrefix: [] })
  })
})

describe('withPrependedPath', () => {
  it('operator: sees the CLI directory prepended to a POSIX PATH', () => {
    // Given a POSIX environment whose PATH already carries the shell defaults
    // When the CLI directory is prepended
    const env = withPrependedPath({ PATH: '/usr/bin:/bin', HOME: '/h' }, '/opt/homebrew/bin', 'darwin')

    // Then the CLI directory leads the PATH and unrelated variables survive
    expect(env).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: '/h' })
  })

  it('operator: sees Windows case variants collapse into one PATH key', () => {
    // Given a Windows environment that spells the variable "Path" while the
    // spawner writes "PATH" (a duplicate key would drop one of them)
    // When the CLI directory is prepended
    const env = withPrependedPath({ Path: 'C:\\Windows', HOME: 'H' }, 'C:\\tools', 'win32')

    // Then one canonical PATH carries both, and the stray "Path" key is gone
    expect(env).toEqual({ HOME: 'H', PATH: 'C:\\tools;C:\\Windows' })
  })

  it('operator: gets PATH written when the environment carries none', () => {
    // Given an environment with no PATH at all
    // When the CLI directory is prepended
    const env = withPrependedPath({}, '/opt/bin', 'linux')

    // Then PATH is created holding the CLI directory
    expect(env).toEqual({ PATH: '/opt/bin' })
  })
})
