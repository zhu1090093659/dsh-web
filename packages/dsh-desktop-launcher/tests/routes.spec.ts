/**
 * Route-layer tests: the loopback fence over a real HTTP server, and the
 * per-platform file/command behavior of createDesktopShortcut with an
 * injected temp home and a fake command runner.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDesktopShortcut, makeRoutes, type CommandRunner } from '../src/routes.ts'
import { LAUNCHER_API } from '../src/protocol.ts'

/** One recorded invocation of the fake runner. */
interface Call {
  file: string
  args: string[]
}

/**
 * Recording runner: captures invocations and returns success unless the
 * failWith file matches.
 */
function recordingRunner(calls: Call[], failWith?: { file: string; code: number; stderr: string }): CommandRunner {
  return async (file, args) => {
    calls.push({ file, args })
    if (failWith !== undefined && file === failWith.file) return { code: failWith.code, stderr: failWith.stderr }
    return { code: 0, stderr: '' }
  }
}

const spec = () => ({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })

describe('createDesktopShortcut', () => {
  it('writes the PowerShell launcher and runs the .lnk installer on win32', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-win-'))
    try {
      const calls: Call[] = []
      const iconFile = join(dir, 'dsh.ico')
      writeFileSync(iconFile, 'fake-ico', 'utf8')
      const result = await createDesktopShortcut({ resolveSpec: spec, homeDir: dir, dshHomeDir: dir, platform: 'win32', run: recordingRunner(calls), iconSource: iconFile })
      expect(result.ok).toBe(true)
      expect(result.path).toBe(join(dir, 'Desktop', 'DeepSeek-Harness.lnk'))
      expect(existsSync(join(dir, 'desktop-launcher', 'launcher.ps1'))).toBe(true)
      expect(existsSync(join(dir, 'desktop-launcher', 'install-shortcut.ps1'))).toBe(true)
      // the bundled dsh icon is copied next to the launcher and wired into the .lnk
      expect(existsSync(join(dir, 'desktop-launcher', 'dsh.ico'))).toBe(true)
      expect(calls[0]?.file).toBe('where')
      const installer = calls.find(call => call.file === 'powershell')
      expect(installer?.args).toContain('-File')
      const installerScript = existsSync(join(dir, 'desktop-launcher', 'install-shortcut.ps1'))
        ? readFileSync(join(dir, 'desktop-launcher', 'install-shortcut.ps1'), 'utf8') : ''
      expect(installerScript).toContain("$shortcut.IconLocation = '" + join(dir, 'desktop-launcher', 'dsh.ico') + "'")
      const launcherBytes = readFileSync(join(dir, 'desktop-launcher', 'launcher.ps1'))
      const installerBytes = readFileSync(join(dir, 'desktop-launcher', 'install-shortcut.ps1'))
      expect([...launcherBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      expect([...installerBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes launcher assets under DSH_HOME while the icon stays on the OS desktop', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-home-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-dshhome-'))
    try {
      const calls: Call[] = []
      const result = await createDesktopShortcut({ resolveSpec: spec, homeDir: home, dshHomeDir: dshHome, platform: 'win32', run: recordingRunner(calls) })
      expect(result.ok).toBe(true)
      // The double-click icon still lands on the OS desktop...
      expect(result.path).toBe(join(home, 'Desktop', 'DeepSeek-Harness.lnk'))
      // ...while launcher scripts and copied icons live under DSH_HOME.
      expect(existsSync(join(dshHome, 'desktop-launcher', 'launcher.ps1'))).toBe(true)
      expect(existsSync(join(dshHome, 'desktop-launcher', 'install-shortcut.ps1'))).toBe(true)
      expect(existsSync(join(home, '.dsh', 'desktop-launcher', 'launcher.ps1'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(dshHome, { recursive: true, force: true })
    }
  })

  it('writes an executable .command on macOS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-mac-'))
    try {
      const calls: Call[] = []
      const result = await createDesktopShortcut({ resolveSpec: spec, homeDir: dir, dshHomeDir: dir, platform: 'darwin', run: recordingRunner(calls) })
      const commandPath = join(dir, 'Desktop', 'DeepSeek-Harness.command')
      expect(result.path).toBe(commandPath)
      // chmod is a no-op on win32 (tests run there too); CI runs the real check.
      if (process.platform !== 'win32') expect(statSync(commandPath).mode & 0o111).not.toBe(0)
      expect(calls.some(call => call.file === 'sh')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a .desktop entry and best-effort trust marker on linux', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-linux-'))
    try {
      const calls: Call[] = []
      const result = await createDesktopShortcut({ resolveSpec: spec, homeDir: dir, dshHomeDir: dir, platform: 'linux', run: recordingRunner(calls) })
      const desktopPath = join(dir, 'Desktop', 'deepseek-harness.desktop')
      expect(result.path).toBe(desktopPath)
      expect(existsSync(desktopPath)).toBe(true)
      const trust = calls.find(call => call.file === 'gio')
      expect(trust?.args).toEqual(['set', desktopPath, 'metadata::trusted', 'true'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts an absolute dshCommand without a PATH probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-abs-'))
    try {
      const fakeDsh = join(dir, 'dsh.cmd')
      writeFileSync(fakeDsh, '@echo off\r\n', 'utf8')
      const calls: Call[] = []
      const result = await createDesktopShortcut({
        resolveSpec: () => ({ dshCommand: fakeDsh, url: 'http://127.0.0.1:3080' }),
        homeDir: dir,
        dshHomeDir: dir,
        platform: 'win32',
        run: recordingRunner(calls),
      })
      expect(result.warning).toBeUndefined()
      expect(calls.some(call => call.file === 'where')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns when dsh is missing from PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-warn-'))
    try {
      const calls: Call[] = []
      const run = async (file: string, args: string[]) => {
        calls.push({ file, args })
        if (file === 'sh') return { code: 1, stderr: 'not found' }
        return { code: 0, stderr: '' }
      }
      const result = await createDesktopShortcut({ resolveSpec: spec, homeDir: dir, dshHomeDir: dir, platform: 'linux', run })
      expect(result.warning).toContain('not found on PATH')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unsupported platforms', async () => {
    await expect(createDesktopShortcut({ resolveSpec: spec, homeDir: tmpdir(), dshHomeDir: tmpdir(), platform: 'freebsd', run: recordingRunner([]) }))
      .rejects.toThrow('unsupported platform')
  })

  it('fails when the PowerShell installer exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-fail-'))
    try {
      const run = async (file: string) => file === 'powershell' ? { code: 1, stderr: 'com failed' } : { code: 0, stderr: '' }
      await expect(createDesktopShortcut({ resolveSpec: spec, homeDir: dir, dshHomeDir: dir, platform: 'win32', run }))
        .rejects.toThrow('shortcut creation failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('route fence', () => {
  let server: ReturnType<typeof createServer>
  let port: number
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-route-'))

  beforeAll(async () => {
    const { routes } = makeRoutes({ resolveSpec: spec, homeDir: dir, platform: 'linux', run: recordingRunner([]) })
    server = createServer((req, res) => {
      const rawPath = new URL(req.url ?? '/', 'http://x').pathname
      const route = routes.find(r => r.kind === 'exact' && r.path === rawPath)
      if (route === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      void route.handler(req, res)
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects cross-site requests with 403', async () => {
    const response = await fetch(`http://127.0.0.1:${port}${LAUNCHER_API.create}`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(response.status).toBe(403)
  })

  it('creates the icon through the route', async () => {
    const response = await fetch(`http://127.0.0.1:${port}${LAUNCHER_API.create}`, { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json() as { result: { ok: boolean; path: string } }
    expect(body.result.ok).toBe(true)
    expect(body.result.path).toBe(join(dir, 'Desktop', 'deepseek-harness.desktop'))
  })

  it('rejects wrong methods with 405', async () => {
    const response = await fetch(`http://127.0.0.1:${port}${LAUNCHER_API.create}`)
    expect(response.status).toBe(405)
  })
})
