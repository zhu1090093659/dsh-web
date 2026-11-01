/**
 * The private temp directory contract: every shell owns one for exactly as long
 * as it runs, and a host that died before it could reclaim one gets it back on
 * the next start.
 *
 * The directories are real ones under a per-test root: what is certified here is
 * the file-system outcome a user's disk sees, not that some helper was called.
 * Every case cleans up the root it made through the same helper the plugin uses.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeShellTempDir, shellTempDir, sweepOrphanShellTempDirs } from '../src/shell.ts'

/** A fresh, empty temp root for one case. */
function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-win-bash-temp-spec-'))
}

/**
 * Create a directory named the way a shell's own temp directory is named.
 * @param root - the temp root to create it under.
 * @param pid - the owning process id the name claims.
 * @param suffix - the random suffix, eight lowercase hex characters.
 * @returns the absolute directory.
 */
function claimedDir(root: string, pid: number, suffix: string): string {
  const dir = join(root, 'dsh-win-bash-' + pid.toString() + '-' + suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Start one node process that stays alive until it is killed.
 * @returns the child, once it has actually been spawned.
 */
async function liveChild(): Promise<{ pid: number, kill: () => void, exited: Promise<void> }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  return {
    pid: child.pid ?? 0,
    kill: () => { child.kill() },
    exited: new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) }),
  }
}

describe("a shell's private temp directory", () => {
  it('user starting a shell gets a private directory named for the owning process', () => {
    // Given an empty temp root standing in for the machine's,
    const root = tempRoot()
    // When two shells are started,
    const first = shellTempDir(root)
    const second = shellTempDir(root)
    // Then each owns its own existing directory, named for this process so a
    // later start can tell whose it was.
    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(basename(first)).toMatch(new RegExp('^dsh-win-bash-' + process.pid.toString() + '-[0-9a-f]{8}$'))
    return removeShellTempDir(root)
  })

  it('user ending a shell gets its private directory and everything a command left in it deleted', async () => {
    // Given a shell's directory holding what a command wrote under TMP, nested
    // one level deep as a package manager's cache would be,
    const root = tempRoot()
    const temp = shellTempDir(root)
    mkdirSync(join(temp, 'pip-cache'))
    writeFileSync(join(temp, 'pip-cache', 'wheels.bin'), Buffer.alloc(4096))
    writeFileSync(join(temp, 'scratch.txt'), 'work')
    // When the shell ends,
    await removeShellTempDir(temp)
    // Then the directory is gone, not just emptied, and the shared temp root it
    // was created under is not.
    expect(existsSync(temp)).toBe(false)
    expect(existsSync(root)).toBe(true)
    await removeShellTempDir(root)
  })

  it('operator ending a shell whose directory is already gone gets no error', async () => {
    // Given a shell whose temp directory was already deleted, by an earlier
    // teardown or by the user,
    const temp = join(tempRoot(), 'dsh-win-bash-' + process.pid.toString() + '-00000000')
    // When teardown reclaims it again,
    // Then the second attempt is a no-op rather than a failure, so a teardown
    // path can call it unconditionally.
    await expect(removeShellTempDir(temp)).resolves.toBeUndefined()
    expect(existsSync(temp)).toBe(false)
  })
})

describe('the orphan sweep at plugin start', () => {
  it('operator restarting after a crash gets the directories of shells that no longer exist reclaimed', async () => {
    // Given a temp root holding one directory from a shell whose process is
    // gone, one from a shell whose process is still running, and one this very
    // process created,
    const root = tempRoot()
    const gone = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true })
    const deadPid = gone.pid ?? 0
    await new Promise<void>((resolve) => { gone.once('exit', () => { resolve() }) })
    const dead = claimedDir(root, deadPid, 'deadbeef')
    writeFileSync(join(dead, 'left-behind.bin'), Buffer.alloc(1024))
    const alive = await liveChild()
    const live = claimedDir(root, alive.pid, 'feedface')
    const own = claimedDir(root, process.pid, 'cafebabe')
    // When the plugin starts and sweeps the temp root,
    const sweep = await sweepOrphanShellTempDirs({ root })
    // Then the dead shell's directory and its contents are gone, while the live
    // shell's and this process's own are untouched.
    expect(existsSync(dead)).toBe(false)
    expect(sweep.removed).toEqual([basename(dead)])
    expect(existsSync(live)).toBe(true)
    expect(existsSync(own)).toBe(true)
    expect(sweep.kept.sort()).toEqual([basename(live), basename(own)].sort())
    expect(sweep.failed).toEqual([])
    alive.kill()
    await alive.exited
    await removeShellTempDir(root)
  })

  it('operator sweeping a temp root with unrelated entries gets them left alone', async () => {
    // Given a temp root holding a directory and a file this plugin did not name,
    const root = tempRoot()
    const foreignDir = join(root, 'dsh-workspace-changes-abc123')
    mkdirSync(foreignDir, { recursive: true })
    const foreignFile = join(root, 'dsh-win-bash-1234-deadbeef')
    writeFileSync(foreignFile, 'not a directory')
    const unrelated = join(root, 'pip-build-42')
    mkdirSync(unrelated, { recursive: true })
    // When the sweep runs,
    const sweep = await sweepOrphanShellTempDirs({ root, isAlive: () => false })
    // Then nothing was claimed or deleted: only a directory carrying this
    // plugin's full name shape, with a process that is gone, is garbage.
    expect(sweep.removed).toEqual([])
    expect(sweep.kept).toEqual([])
    expect(sweep.failed).toEqual([])
    expect(existsSync(foreignDir)).toBe(true)
    expect(existsSync(foreignFile)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
    await removeShellTempDir(root)
  })

  it('operator sweeping past a directory that cannot be deleted gets the rest reclaimed', async () => {
    // Given two directories from shells that are gone, one of which refuses to
    // be deleted - the long-path or locked-file case this sweep exists to
    // survive,
    const root = tempRoot()
    const stuck = claimedDir(root, 4101, 'aaaaaaaa')
    const removable = claimedDir(root, 4102, 'bbbbbbbb')
    const attempts: string[] = []
    // When the sweep runs,
    const sweep = await sweepOrphanShellTempDirs({
      root,
      isAlive: () => false,
      remove: async (dir) => {
        attempts.push(basename(dir))
        if (basename(dir) === basename(stuck)) throw new Error('EBUSY: resource busy or locked')
        await removeShellTempDir(dir)
      },
    })
    // Then the failure is reported for that one directory instead of aborting
    // the round, and the other one is still reclaimed.
    expect(attempts).toHaveLength(2)
    expect(sweep.failed).toEqual([basename(stuck)])
    expect(sweep.removed).toEqual([basename(removable)])
    expect(existsSync(stuck)).toBe(true)
    expect(existsSync(removable)).toBe(false)
    await removeShellTempDir(root)
  })

  it('operator sweeping a temp root that cannot be read gets an empty report', async () => {
    // Given a temp root that does not exist,
    const root = join(tempRoot(), 'gone')
    // When the sweep runs,
    const sweep = await sweepOrphanShellTempDirs({ root })
    // Then it reports nothing rather than throwing, because a start must not fail
    // over a directory it cannot list.
    expect(sweep).toEqual({ removed: [], kept: [], failed: [] })
  })
})
