import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  StandaloneRuntimeManager,
  normalizeStandaloneRuntimeMirror,
  standaloneRuntimeArchiveUrl,
  type StandaloneRuntimeDownloadRequest,
} from './runtime-manager.ts'
import { STANDALONE_ELECTRON_VERSION } from './runtime-manifest.ts'

const roots: string[] = []
const nativeExtractorFixture = [
  'UEsDBBQAAAAIAKZcEl2oYVZPCQAAAAcAAAAHAAAAdmVyc2lvbjMx1jPRM+ACAFBLAwQUAAAACACmXBJd7kDl',
  'BQkAAAAHAAAADAAAAGVsZWN0cm9uLmV4ZUvLrCgpLUoFAFBLAQIUABQAAAAIAKZcEl2oYVZPCQAAAAcAAAAH',
  'AAAAAAAAAAAAAAAAAAAAAAB2ZXJzaW9uUEsBAhQAFAAAAAgAplwSXe5A5QUJAAAABwAAAAwAAAAAAAAAAAAA',
  'AAAALgAAAGVsZWN0cm9uLmV4ZVBLBQYAAAAAAgACAG8AAABhAAAAAAA=',
].join('')

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-runtime-'))
  roots.push(root)
  return root
}

async function fakeWindowsRuntime(destination: string): Promise<void> {
  await writeFile(join(destination, 'version'), `${STANDALONE_ELECTRON_VERSION}\n`, 'utf8')
  await writeFile(join(destination, 'electron.exe'), 'fixture', 'utf8')
}

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('StandaloneRuntimeManager', () => {
  it('installs from npmmirror while retaining the pinned official checksum', async () => {
    const root = await temporaryRoot()
    let request: StandaloneRuntimeDownloadRequest | undefined
    const downloadArtifact = vi.fn(async (next: StandaloneRuntimeDownloadRequest) => {
      request = next
      next.onProgress({ transferred: 60, total: 100, percent: 0.6 })
      return join(root, 'fixture.zip')
    })
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact,
      extractArchive: async (_archive, destination) => { await fakeWindowsRuntime(destination) },
    })

    expect(manager.state()).toMatchObject({ phase: 'not-installed', installed: false })
    manager.startInstall({ source: 'npmmirror' })
    await manager.settled()

    expect(downloadArtifact).toHaveBeenCalledOnce()
    expect(request).toMatchObject({
      version: STANDALONE_ELECTRON_VERSION,
      platform: 'win32',
      arch: 'x64',
      filename: `electron-v${STANDALONE_ELECTRON_VERSION}-win32-x64.zip`,
      mirrorUrl: `https://npmmirror.com/mirrors/electron/v${STANDALONE_ELECTRON_VERSION}/electron-v${STANDALONE_ELECTRON_VERSION}-win32-x64.zip`,
    })
    expect(request?.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(manager.state()).toMatchObject({
      phase: 'ready',
      installed: true,
      managed: true,
      source: 'npmmirror',
    })
    expect(manager.executablePath()).toMatch(/electron\.exe$/)
    expect(existsSync(manager.executablePath()!)).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toMatchObject({ source: 'npmmirror' })
  })

  it('extracts a real ZIP with the native extractor and removes an interrupted partial', async () => {
    const root = await temporaryRoot()
    const archive = join(root, 'runtime-fixture.zip')
    const orphan = join(
      root,
      'runtime',
      `v${STANDALONE_ELECTRON_VERSION}`,
      'win32-x64.partial-interrupted',
    )
    await writeFile(archive, Buffer.from(nativeExtractorFixture, 'base64'))
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, 'electron.exe'), 'incomplete', 'utf8')
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: async () => archive,
    })

    manager.startInstall({ source: 'official' })
    await manager.settled()

    expect(manager.state()).toMatchObject({ phase: 'ready', installed: true, managed: true })
    expect(await readFile(manager.executablePath()!, 'utf8')).toBe('fixture')
    expect(existsSync(orphan)).toBe(false)
  })

  it('cancels an in-flight download, closes its lock and returns to not-installed', async () => {
    const root = await temporaryRoot()
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        }, { once: true })
      }),
      extractArchive: async () => undefined,
    })

    manager.startInstall({ source: 'official' })
    manager.cancelInstall()
    await manager.settled()

    expect(manager.state()).toMatchObject({ phase: 'not-installed', installed: false })
    expect(existsSync(join(root, 'install.lock'))).toBe(false)
  })

  it('waits for cancellation cleanup when the plugin disposes during installation', async () => {
    const root = await temporaryRoot()
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        }, { once: true })
      }),
    })

    manager.startInstall({ source: 'official' })
    await manager.dispose()

    expect(manager.state()).toMatchObject({ phase: 'not-installed', installed: false })
    expect(existsSync(join(root, 'install.lock'))).toBe(false)
  })

  it('never holds a FileHandle across download and never removes a replacement lock', async () => {
    const root = await temporaryRoot()
    let finishDownload: ((archive: string) => void) | undefined
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: () => new Promise(resolve => { finishDownload = resolve }),
      extractArchive: async (_archive, destination) => { await fakeWindowsRuntime(destination) },
    })

    manager.startInstall({ source: 'official' })
    await vi.waitFor(() => { expect(finishDownload).toBeTypeOf('function') })
    const lockFile = join(root, 'install.lock')
    const owned = JSON.parse(await readFile(lockFile, 'utf8')) as { token?: string }
    expect(owned.token).toMatch(/^[0-9a-f-]{36}$/)

    // Windows can only remove this while the writer's descriptor is closed.
    await rm(lockFile, { force: true })
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: 'replacement' }), 'utf8')
    finishDownload!(join(root, 'fixture.zip'))
    await manager.settled()

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: 'replacement' })
  })

  it('recovers a stale interrupted lock but preserves a live process lock', async () => {
    const staleRoot = await temporaryRoot()
    await writeFile(join(staleRoot, 'install.lock'), JSON.stringify({ pid: 2_147_483_647 }), 'utf8')
    const staleManager = new StandaloneRuntimeManager({
      root: staleRoot,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: async () => join(staleRoot, 'fixture.zip'),
      extractArchive: async (_archive, destination) => { await fakeWindowsRuntime(destination) },
    })
    staleManager.startInstall({ source: 'official' })
    await staleManager.settled()
    expect(staleManager.state()).toMatchObject({ phase: 'ready' })

    const liveRoot = await temporaryRoot()
    await writeFile(join(liveRoot, 'install.lock'), JSON.stringify({ pid: process.pid }), 'utf8')
    const liveManager = new StandaloneRuntimeManager({ root: liveRoot, platform: 'win32', arch: 'x64' })
    liveManager.startInstall({ source: 'official' })
    await liveManager.settled()
    expect(liveManager.state()).toMatchObject({ phase: 'failed', error: 'runtime-install-busy' })
    expect(existsSync(join(liveRoot, 'install.lock'))).toBe(true)
  })

  it('never exposes an invalid extracted executable and keeps error details log-safe', async () => {
    const root = await temporaryRoot()
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      downloadArtifact: async () => join(root, 'private-user-path.zip'),
      extractArchive: async (_archive, destination) => {
        await writeFile(join(destination, 'version'), `${STANDALONE_ELECTRON_VERSION}\n`, 'utf8')
      },
    })
    manager.startInstall({ source: 'official' })
    await manager.settled()

    expect(manager.state()).toMatchObject({
      phase: 'failed',
      installed: false,
      error: 'runtime-install-failed',
    })
    expect(JSON.stringify(manager.state())).not.toContain('private-user-path')
    expect(manager.executablePath()).toBeUndefined()
  })

  it('uses a development executable without copying or downloading it', async () => {
    const root = await temporaryRoot()
    const fallbackExecutable = join(root, 'workspace-electron.exe')
    await writeFile(fallbackExecutable, 'fixture', 'utf8')
    const downloadArtifact = vi.fn()
    const manager = new StandaloneRuntimeManager({
      root,
      platform: 'win32',
      arch: 'x64',
      fallbackExecutable,
      downloadArtifact,
    })

    expect(manager.state()).toMatchObject({ phase: 'ready', installed: true, managed: false })
    manager.startInstall({ source: 'npmmirror' })
    await manager.settled()
    expect(manager.executablePath()).toBe(fallbackExecutable)
    expect(downloadArtifact).not.toHaveBeenCalled()
  })

  it('marks unsupported targets without starting a download', async () => {
    const root = await temporaryRoot()
    const downloadArtifact = vi.fn()
    const manager = new StandaloneRuntimeManager({ root, platform: 'freebsd', arch: 'x64', downloadArtifact })

    manager.startInstall({ source: 'official' })

    expect(manager.state()).toMatchObject({ phase: 'unsupported', installed: false })
    expect(downloadArtifact).not.toHaveBeenCalled()
  })
})

describe('Standalone runtime mirror policy', () => {
  it('accepts HTTPS and loopback development mirror bases', () => {
    expect(normalizeStandaloneRuntimeMirror({
      source: 'custom',
      customMirror: 'https://mirror.example/electron',
    })).toEqual({ source: 'custom', customMirror: 'https://mirror.example/electron/' })
    expect(normalizeStandaloneRuntimeMirror({
      source: 'custom',
      customMirror: 'http://127.0.0.1:8080/electron',
    })).toEqual({ source: 'custom', customMirror: 'http://127.0.0.1:8080/electron/' })
  })

  it('rejects insecure remote mirrors and URLs carrying credentials', () => {
    expect(() => normalizeStandaloneRuntimeMirror({
      source: 'custom',
      customMirror: 'http://mirror.example/electron',
    })).toThrow('runtime-mirror-insecure')
    expect(() => normalizeStandaloneRuntimeMirror({
      source: 'custom',
      customMirror: 'https://user:secret@mirror.example/',
    })).toThrow('runtime-mirror-invalid')
  })

  it('builds the official versioned artifact URL', () => {
    expect(standaloneRuntimeArchiveUrl(
      { source: 'official' },
      `electron-v${STANDALONE_ELECTRON_VERSION}-linux-x64.zip`,
    )).toBe(
      `https://github.com/electron/electron/releases/download/v${STANDALONE_ELECTRON_VERSION}/electron-v${STANDALONE_ELECTRON_VERSION}-linux-x64.zip`,
    )
  })
})

describe('published runtime dependency policy', () => {
  it('keeps Electron itself out of published runtime dependencies', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.electron).toBeUndefined()
    expect(packageJson.optionalDependencies?.electron).toBeUndefined()
    expect(packageJson.peerDependencies?.electron).toBeUndefined()
    expect(packageJson.devDependencies?.electron).toBe(STANDALONE_ELECTRON_VERSION)
    expect(packageJson.dependencies?.['@electron-internal/extract-zip']).toBe('1.0.5')
    expect(packageJson.dependencies?.['@electron/get']).toBe('5.1.0')
  })
})
