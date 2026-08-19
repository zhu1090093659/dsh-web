import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  discoverStandaloneRuntime,
  launchStandaloneRuntime,
  standaloneChildEnvironment,
  standaloneLaunchArguments,
} from './launcher.ts'

const roots: string[] = []
const token = 't'.repeat(43)

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-launcher-'))
  roots.push(root)
  return root
}

async function file(path: string, content = 'fixture'): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return path
}

async function pluginModule(root: string): Promise<string> {
  await file(join(root, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-pet' }))
  const entry = await file(join(root, 'src', 'index.ts'), 'export {}')
  return pathToFileURL(entry).href
}

async function standalonePackage(root: string, version = '1.2.3'): Promise<void> {
  const packageRoot = join(root, 'node_modules', '@linxin666', 'dsh-pet-standalone')
  await file(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@linxin666/dsh-pet-standalone',
    version,
    main: './out/main/index.js',
    exports: { '.': './out/main/index.js' },
  }))
  await file(join(packageRoot, 'out', 'main', 'index.js'))
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  child.unref = vi.fn(() => child)
  return child
}

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('Standalone runtime discovery', () => {
  it('gives an explicit executable priority without importing Electron', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    await standalonePackage(root)
    const executable = await file(join(root, 'custom', 'dsh-pet-standalone.exe'))

    expect(discoverStandaloneRuntime({
      moduleUrl,
      environment: { DSH_PET_STANDALONE_EXECUTABLE: executable },
    })).toEqual({
      executablePath: executable,
      appRoot: dirname(executable),
      entryPath: executable,
      source: 'explicit',
      launchMode: 'direct',
    })
  })

  it('prefers an installed standalone package over the development app', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    await standalonePackage(root, '2.0.0')
    await file(join(root, 'desktop', 'package.json'), JSON.stringify({ main: './out/main/index.js' }))
    await file(join(root, 'desktop', 'out', 'main', 'index.js'))
    const runtimeExecutable = await file(join(root, 'runtime', 'electron.exe'))

    expect(discoverStandaloneRuntime({
      moduleUrl,
      runtimeExecutable,
      environment: {},
    })).toMatchObject({
      executablePath: runtimeExecutable,
      appRoot: join(root, 'node_modules', '@linxin666', 'dsh-pet-standalone'),
      entryPath: join(root, 'node_modules', '@linxin666', 'dsh-pet-standalone', 'out', 'main', 'index.js'),
      version: '2.0.0',
      source: 'package',
      launchMode: 'electron-app',
    })
  })

  it('falls back to a built development app and otherwise reports unavailable', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    await file(join(root, 'desktop', 'package.json'), JSON.stringify({
      name: '@linxin666/dsh-pet-standalone',
      version: '0.0.0-development',
      main: './out/main/index.js',
    }))
    await file(join(root, 'desktop', 'out', 'main', 'index.js'))
    const runtimeExecutable = await file(join(root, 'runtime', 'electron.exe'))

    expect(discoverStandaloneRuntime({ moduleUrl, runtimeExecutable, environment: {} })).toMatchObject({
      executablePath: runtimeExecutable,
      appRoot: join(root, 'desktop'),
      source: 'development',
      launchMode: 'electron-app',
    })
    expect(discoverStandaloneRuntime({ moduleUrl, environment: {} })).toBeUndefined()
  })
})

describe('Standalone launcher', () => {
  it('keeps origin and token out of arguments and registers/removes one stable parent source', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    const executable = await file(join(root, 'dsh-pet-standalone.exe'))
    const calls: Array<{ command: string, args: string[], options: SpawnOptions, child: ChildProcess }> = []
    const spawnProcess = vi.fn((command: string, args: string[], options: SpawnOptions) => {
      const child = fakeChild()
      calls.push({ command, args, options, child })
      return child
    })

    const handle = launchStandaloneRuntime({
      moduleUrl,
      origin: 'http://127.0.0.1:3080',
      nativeToken: token,
      parentPid: 4200,
      sourceId: 'web:default',
      environment: {
        DSH_PET_STANDALONE_EXECUTABLE: executable,
        DSH_PET_NATIVE_TOKEN: 'stale',
        DSH_PET_ORIGIN: 'http://127.0.0.1:9999',
      },
      spawnProcess,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe(executable)
    expect(calls[0]?.args).toEqual([
      '--dsh-parent-pid=4200',
      '--dsh-source-id=web:default',
      '--dsh-parent-action=add',
    ])
    expect(calls[0]?.args.join(' ')).not.toContain(token)
    expect(calls[0]?.args.join(' ')).not.toContain('127.0.0.1')
    expect(calls[0]?.options.env).toMatchObject({
      DSH_PET_PARENT_PID: '4200',
      DSH_PET_SOURCE_ID: 'web:default',
      DSH_PET_PARENT_ACTION: 'add',
      DSH_PET_ORIGIN: 'http://127.0.0.1:3080',
      DSH_PET_NATIVE_TOKEN: token,
    })
    calls[0]?.child.emit('spawn')
    await expect(handle.ready).resolves.toBeUndefined()

    handle.dispose()
    handle.dispose()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.args).toContain('--dsh-parent-action=remove')
    expect(calls[1]?.options.env).toMatchObject({ DSH_PET_PARENT_ACTION: 'remove' })
  })

  it('reports a real asynchronous ChildProcess spawn error through ready and onError', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    const executable = await file(join(root, 'dsh-pet-standalone.exe'))
    const child = fakeChild()
    const onError = vi.fn()
    const spawnProcess = vi.fn(() => child)

    const handle = launchStandaloneRuntime({
      moduleUrl,
      origin: 'http://127.0.0.1:3080',
      nativeToken: token,
      parentPid: 4200,
      sourceId: 'web:async-error',
      environment: { DSH_PET_STANDALONE_EXECUTABLE: executable },
      spawnProcess,
      onError,
    })
    expect(onError).not.toHaveBeenCalled()

    setTimeout(() => {
      child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    }, 0)

    await expect(handle.ready).rejects.toThrow('standalone-launch-failed')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('launch-failed')
    handle.dispose()
  })

  it('reports the spawned pid and exit without interpreting a normal proxy exit as failure', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    const executable = await file(join(root, 'dsh-pet-standalone.exe'))
    const child = fakeChild()
    Object.defineProperty(child, 'pid', { value: 6_100 })
    const handle = launchStandaloneRuntime({
      moduleUrl,
      origin: 'http://127.0.0.1:3080',
      nativeToken: token,
      parentPid: 4_200,
      sourceId: 'web:exit-fact',
      environment: { DSH_PET_STANDALONE_EXECUTABLE: executable },
      spawnProcess: () => child,
    })

    child.emit('spawn')
    await expect(handle.ready).resolves.toBeUndefined()
    expect(handle.pid).toBe(6_100)
    child.emit('exit', 0, null)
    await expect(handle.exited).resolves.toEqual({ code: 0, signal: null })
    handle.dispose()
  })

  it('prefixes appRoot only for an Electron app target', () => {
    const target = {
      executablePath: 'electron.exe',
      appRoot: 'standalone-app',
      entryPath: 'standalone-app/out/main/index.js',
      source: 'package' as const,
      launchMode: 'electron-app' as const,
    }
    expect(standaloneLaunchArguments(target, 42, 'host:42', 'add')).toEqual([
      'standalone-app',
      '--dsh-parent-pid=42',
      '--dsh-source-id=host:42',
      '--dsh-parent-action=add',
    ])
  })

  it('rejects non-loopback origins, malformed credentials and unavailable runtimes', async () => {
    const root = await temporaryRoot()
    const moduleUrl = await pluginModule(root)
    const spawnProcess = vi.fn()

    expect(() => launchStandaloneRuntime({
      moduleUrl,
      origin: 'https://example.test',
      nativeToken: token,
      environment: {},
      spawnProcess,
    })).toThrow('standalone-origin-invalid')
    expect(() => launchStandaloneRuntime({
      moduleUrl,
      origin: 'http://127.0.0.1:3080',
      nativeToken: 'short',
      environment: {},
      spawnProcess,
    })).toThrow('standalone-native-token-invalid')
    expect(() => launchStandaloneRuntime({
      moduleUrl,
      origin: 'http://127.0.0.1:3080',
      nativeToken: token,
      environment: {},
      spawnProcess,
    })).toThrow('standalone-runtime-unavailable')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('replaces stale connection variables in the child environment', () => {
    expect(standaloneChildEnvironment(
      7,
      'host:7',
      'http://localhost:3080',
      token,
      'add',
      {
        KEEP_ME: 'yes',
        DSH_PET_PARENT_PID: '1',
        DSH_PET_SOURCE_ID: 'stale',
        DSH_PET_ORIGIN: 'stale',
        DSH_PET_NATIVE_TOKEN: 'stale',
        DSH_PET_PARENT_ACTION: 'remove',
      },
    )).toEqual({
      KEEP_ME: 'yes',
      DSH_PET_PARENT_PID: '7',
      DSH_PET_SOURCE_ID: 'host:7',
      DSH_PET_ORIGIN: 'http://localhost:3080',
      DSH_PET_NATIVE_TOKEN: token,
      DSH_PET_PARENT_ACTION: 'add',
    })
  })
})
