/**
 * Chrome discovery and port selection: the two things that decide whether a
 * launch can even begin, plus the cleanup rule that must never follow a link
 * out of the profile directory.
 */

import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHROME_INSTALL_CANDIDATES,
  CHROME_PATH_ENV,
  ChromeProcess,
  chromeLaunchArgs,
  chromePathCandidates,
  pickFreePort,
  probeBrowserAlive,
  removeTempProfile,
  resolveChromePath,
  settleBrowserDispose,
} from '../../src/core/chrome.ts'

describe('chrome path candidates', () => {
  it('operator sets CHROME_PATH and the override leads the candidate list', () => {
    // Given the CHROME_PATH variable naming one binary
    // When discovery builds its candidate list
    // Then the override is the first candidate
    const candidates = chromePathCandidates({ [CHROME_PATH_ENV]: 'D:\\tools\\chrome.exe' })
    expect(candidates[0]).toBe('D:\\tools\\chrome.exe')
  })

  it('operator sets a blank CHROME_PATH and discovery falls back to the install locations', () => {
    // Given CHROME_PATH set to whitespace
    // When discovery builds its candidate list
    // Then the first candidate is the first install location and no empty string is listed
    const candidates = chromePathCandidates({ [CHROME_PATH_ENV]: '   ' })
    expect(candidates[0]).toBe(CHROME_INSTALL_CANDIDATES[0])
    expect(candidates).not.toContain('')
  })

  it('operator runs without an override and the Windows install locations are probed', () => {
    // Given an environment without CHROME_PATH
    // When discovery builds its candidate list
    // Then the Program Files install location is among the candidates
    const candidates = chromePathCandidates({})
    expect(candidates).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })
})

describe('resolveChromePath', () => {
  it('operator has Chrome in a default location and discovery returns that exact path', () => {
    // Given a probe that reports only the second install location as a file
    // When the path is resolved
    // Then that exact path is returned
    const target = CHROME_INSTALL_CANDIDATES[1]
    const found = resolveChromePath({ env: {}, isFile: path => path === target })
    expect(found).toBe(target)
  })

  it('operator has both an override and an installed binary and the override wins', () => {
    // Given both the override and the first install location exist
    // When the path is resolved
    // Then the returned path is the override
    const override = 'D:\\tools\\chrome.exe'
    const found = resolveChromePath({
      env: { [CHROME_PATH_ENV]: override },
      isFile: path => path === override || path === CHROME_INSTALL_CANDIDATES[0],
    })
    expect(found).toBe(override)
  })

  it('operator has no Chrome installed and discovery reports no path', () => {
    // Given a probe that finds nothing on disk
    // When the path is resolved
    // Then the result is undefined
    expect(resolveChromePath({ env: {}, isFile: () => false })).toBeUndefined()
  })

  it('operator launches without Chrome installed and the failure names the probed paths', async () => {
    // Given no Chrome binary and no override on the machine
    // When a launch is attempted
    // Then it rejects with a message naming CHROME_PATH and the probed Program Files paths
    await expect(ChromeProcess.launch({ discovery: { env: {}, isFile: () => false } }))
      .rejects.toThrow(/No Chrome binary found.*CHROME_PATH.*Program Files/)
  })
})

describe('pickFreePort', () => {
  it('operator asks for a free port and the returned one binds immediately', async () => {
    // Given no server bound to an ephemeral port
    // When a free port is picked and then bound
    // Then the port is in range and the bind succeeds
    const port = await pickFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65_536)
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => resolve())
    })
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  })

  it('operator asks for two ports in a row and never receives the same number twice', async () => {
    // Given a port already handed out
    // When a second free port is picked
    // Then it differs from the first and is still in range
    const first = await pickFreePort()
    const second = await pickFreePort()
    expect(second).toBeGreaterThan(0)
    expect(first).not.toBe(second)
  })
})

describe('chromeLaunchArgs', () => {
  it('operator launches headless and the args carry a private profile and pinned window size', () => {
    // Given a headless launch with a private profile and a 1280x800 viewport
    // When the launch args are built
    // Then they carry headless=new, the debug port, the profile dir, the window size and end with about:blank
    const args = chromeLaunchArgs({
      port: 9222,
      userDataDir: 'C:\\temp\\profile',
      headless: true,
      viewport: { width: 1280, height: 800 },
    })
    expect(args).toContain('--headless=new')
    expect(args).toContain('--remote-debugging-port=9222')
    expect(args).toContain('--user-data-dir=C:\\temp\\profile')
    expect(args).toContain('--window-size=1280,800')
    expect(args.at(-1)).toBe('about:blank')
  })

  it('operator asks for headful with extra switches and headless is omitted while the extras come last', () => {
    // Given a headful launch with one extra switch
    // When the launch args are built
    // Then no headless switch appears and the extra switch is last
    const args = chromeLaunchArgs({
      port: 9223,
      userDataDir: 'C:\\temp\\profile',
      headless: false,
      viewport: { width: 800, height: 600 },
      extraArgs: ['--lang=en-US'],
    })
    expect(args.some(arg => arg.startsWith('--headless'))).toBe(false)
    expect(args.at(-1)).toBe('--lang=en-US')
  })
})

describe('removeTempProfile', () => {
  it('operator disposes a launch and the nested profile directory is gone', async () => {
    // Given a profile directory holding a nested cache and a Local State file
    // When the profile is removed
    // Then the directory no longer exists
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bv-clean-'))
    await mkdir(join(dir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(dir, 'Default', 'Cache', 'data.bin'), 'x', 'utf8')
    await writeFile(join(dir, 'Local State'), '{}', 'utf8')

    await removeTempProfile(dir)

    await expect(stat(dir)).rejects.toThrow()
  })

  it('operator disposes a profile that holds a junction and the linked tree survives', async () => {
    // Given a profile directory holding a junction to a tree outside it
    // When the profile is removed
    // Then the linked tree still holds its file and the profile root is gone
    const outside = await mkdtemp(join(tmpdir(), 'dsh-bv-outside-'))
    await writeFile(join(outside, 'keep.txt'), 'keep', 'utf8')
    const inside = await mkdtemp(join(tmpdir(), 'dsh-bv-inside-'))
    await symlink(outside, join(inside, 'linked'), 'junction')

    await removeTempProfile(inside)

    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    await expect(stat(inside)).rejects.toThrow()
    await removeTempProfile(outside)
  })

  it('operator disposes a path outside the OS temp directory and nothing is touched', async () => {
    // Given a path that resolves outside the OS temp directory
    // When the profile is removed
    // Then the marker file outside survives untouched
    // The guard compares the raw path against the temp root, so the escape
    // directory has to be somewhere the runner can really write: one level up
    // from the temp root is "/" on Linux, where mkdir is denied to a normal
    // user. The home directory stays outside the temp root on every platform.
    const root = resolve(tmpdir())
    const outside = await mkdtemp(join(homedir(), '.dsh-bv-guard-'))
    expect(outside.startsWith(root)).toBe(false)
    await writeFile(join(outside, 'marker.txt'), 'keep', 'utf8')

    await removeTempProfile(outside)

    expect(await readFile(join(outside, 'marker.txt'), 'utf8')).toBe('keep')
    // Named deletes only, never a recursive removal: the marker file and the
    // now empty directory this test created.
    const { unlink, rmdir } = await import('node:fs/promises')
    await unlink(join(outside, 'marker.txt'))
    await rmdir(outside)
  })

  it('operator launches a binary that exits early and the temporary profile does not leak (#2051)', async () => {
    // Given a binary that immediately exits before opening DevTools
    const { readdir } = await import('node:fs/promises')
    const dirTag = `dsh-browser-view-`
    const existing = new Set((await readdir(tmpdir())).filter(name => name.startsWith(dirTag)))

    // When ChromeProcess.launch rejects on early process exit
    await expect(ChromeProcess.launch({ chromePath: process.execPath })).rejects.toThrow(/Chrome exited before its DevTools endpoint came up/)

    // Then removeTempProfile cleaned up the created temporary profile directory
    const remaining = (await readdir(tmpdir())).filter(name => name.startsWith(dirTag) && !existing.has(name))
    expect(remaining).toEqual([])
  })
})
describe('dispose decides on evidence', () => {
  it('operator disposes a browser whose launcher exited while DevTools still answers and the profile survives', async () => {
    // Given a launch whose spawned process is gone but whose browser still answers
    // When the disposal runs
    // Then it reports the browser as running and never touches the profile directory
    const removals: string[] = []
    const result = await settleBrowserDispose({
      terminate: async () => undefined,
      probeAlive: async () => true,
      removeProfile: async () => { removals.push('profile') },
    })
    expect(result).toEqual({ stopped: false, profileRemoved: false })
    expect(removals).toEqual([])
  })

  it('operator disposes a browser that is confirmed gone and the profile is removed', async () => {
    // Given a launch that no longer answers on its port and whose process is gone
    // When the disposal runs
    // Then it reports a complete cleanup and the profile directory is removed once
    const removals: string[] = []
    const result = await settleBrowserDispose({
      terminate: async () => undefined,
      probeAlive: async () => false,
      removeProfile: async () => { removals.push('profile') },
    })
    expect(result).toEqual({ stopped: true, profileRemoved: true })
    expect(removals).toEqual(['profile'])
  })

  it('operator probes a browser whose launched pid died while DevTools answers and it counts as running', async () => {
    // Given a launcher pid that is gone and a DevTools endpoint that still answers
    // When the liveness probe runs
    // Then the browser counts as running, because the endpoint is the browser itself
    const alive = await probeBrowserAlive({ pid: 4242, port: 9222 }, {
      isAlive: () => false,
      fetchEndpoint: async () => true,
    })
    expect(alive).toBe(true)
  })

  it('operator probes a browser whose process and port are both gone and it counts as stopped', async () => {
    // Given a pid that is gone and an endpoint that does not answer
    // When the liveness probe runs
    // Then the browser counts as stopped
    const alive = await probeBrowserAlive({ pid: 4242, port: 9222 }, {
      isAlive: () => false,
      fetchEndpoint: async () => false,
    })
    expect(alive).toBe(false)
  })

  it('operator probes a browser whose process still answers and the port is never queried', async () => {
    // Given a live pid and an endpoint that would say no
    // When the liveness probe runs
    // Then the pid alone settles it and no network probe is spent
    let queried = false
    const alive = await probeBrowserAlive({ pid: 7, port: 1 }, {
      isAlive: () => true,
      fetchEndpoint: async () => {
        queried = true
        return false
      },
    })
    expect(alive).toBe(true)
    expect(queried).toBe(false)
  })

  it('operator probes a browser whose endpoint query throws and it counts as stopped', async () => {
    // Given a pid that is gone and an endpoint query that fails outright
    // When the liveness probe runs
    // Then the failure is bounded and the browser counts as stopped
    const alive = await probeBrowserAlive({ pid: 4242, port: 9222 }, {
      isAlive: () => false,
      fetchEndpoint: async () => {
        throw new Error('probe transport failed')
      },
    })
    expect(alive).toBe(false)
  })

  it('operator disposes a browser whose spawned handle never ran and the profile is still cleaned', async () => {
    // Given a launch whose process already exited before disposal started
    // When the disposal runs
    // Then the terminal step still runs first and the profile is removed
    const steps: string[] = []
    const result = await settleBrowserDispose({
      terminate: async () => { steps.push('terminate') },
      probeAlive: async () => {
        steps.push('probe')
        return false
      },
      removeProfile: async () => { steps.push('remove') },
    })
    expect(steps).toEqual(['terminate', 'probe', 'remove'])
    expect(result.profileRemoved).toBe(true)
  })
})
