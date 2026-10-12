/**
 * Issue #1857: a spawn that fails must degrade the plugin feature, never the dsh host
 * process.
 *
 * Two facts are pinned here. First, the Windows command processor is resolved from
 * the environment instead of from PATH, so a host whose PATH carries no
 * `%SystemRoot%\system32` (a packaged Desktop launch, a service, a stripped
 * environment) still finds the cmd.exe that is present on disk. Second, every child
 * this package spawns is settled on a spawn failure: a ChildProcess without an
 * `error` listener raises an uncaught exception, which kills the host, and a caller
 * that waits only for `close` waits forever when the failure never produces one.
 *
 * The failures below come from spawning names that cannot exist, so they are
 * deterministic and independent of the host PATH.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  awaitCliExit,
  CliGateway,
  detectOfficialChannels,
  guardSpawnFailure,
  SPAWN_FAILURE_EXIT_CODE,
  spawnDsh,
  windowsCmdPath,
} from '../src/host/gateway.ts'
import { createOutputCapture } from '../src/host/console-output.ts'
import type { ProfileFacts } from '../src/host/profile.ts'
import { startRelaunchHelper } from '../src/host/restart.ts'

/** A CLI name no PATH can resolve, so spawning it always fails with ENOENT. */
const MISSING_BINARY = 'dsh-missing-cli-1857'

/** Uncaught exceptions seen during the current test; a spawn failure must add none. */
const uncaught: string[] = []
const recordUncaught = (error: unknown): void => {
  uncaught.push(error instanceof Error ? error.message : String(error))
}

beforeEach(() => {
  uncaught.length = 0
  process.on('uncaughtException', recordUncaught)
})

afterEach(() => {
  process.off('uncaughtException', recordUncaught)
})

describe('windowsCmdPath', () => {
  it('operator gets the ComSpec path when the host exports one (issue #1857)', () => {
    // Given a Windows environment that exports ComSpec, as every Windows host does
    const env = { ComSpec: 'D:\\Tools\\cmd.exe', SystemRoot: 'C:\\Windows' }

    // When the command processor is resolved for a .cmd shim spawn
    const resolved = windowsCmdPath(env)

    // Then it is that exact path, never a PATH lookup of the bare name
    expect(resolved).toBe('D:\\Tools\\cmd.exe')
  })

  it('operator gets the ComSpec path whatever spelling the environment uses', () => {
    // Given a launcher that wrote the variable in lower case
    const env = { comspec: 'D:\\Tools\\cmd.exe' }

    // When it is resolved, Then the value still wins over the system root
    expect(windowsCmdPath(env)).toBe('D:\\Tools\\cmd.exe')
  })

  it('operator gets a SystemRoot-derived cmd.exe when ComSpec is blank', () => {
    // Given a PATH-starved host whose ComSpec was cleared but whose system root survived
    const env = { ComSpec: '   ', SystemRoot: 'C:\\Windows' }

    // When the command processor is resolved
    const resolved = windowsCmdPath(env)

    // Then it is the real binary under that root, not a name for PATH to find
    expect(resolved).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('operator gets a windir-derived cmd.exe when SystemRoot is missing', () => {
    // Given an environment that spells the system root only as windir

    // When the command processor is resolved
    const resolved = windowsCmdPath({ windir: 'D:\\Windows' })

    // Then the command processor resolves under that root
    expect(resolved).toBe('D:\\Windows\\System32\\cmd.exe')
  })

  it('operator gets the conventional Windows cmd.exe when the environment names no root', () => {
    // Given an environment stripped of every Windows path variable
    // When the command processor is resolved, Then the conventional location is used
    expect(windowsCmdPath({ PATH: 'D:\\Tools' })).toBe('C:\\Windows\\System32\\cmd.exe')
  })
})

describe('spawn failure settlement', () => {
  it('operator sees a failed exit and a readable reason when the CLI cannot be spawned (issue #1857)', async () => {
    // Given a CLI name that resolves to nothing on this host
    const output = createOutputCapture(4096)

    // When the gateway spawns it and waits for the run to end
    const child = spawnDsh(MISSING_BINARY, ['--version'], {})
    const code = await awaitCliExit(child, output)

    // Then the run settles as a failure carrying the spawn error
    expect(code).toBe(SPAWN_FAILURE_EXIT_CODE)
    expect(output.read()).toContain('ENOENT')
  })

  it('operator keeps the dsh host alive when the CLI cannot be spawned', async () => {
    // Given the same impossible CLI name, spawned through the gateway
    const output = createOutputCapture(4096)

    // When the run settles
    await awaitCliExit(spawnDsh(MISSING_BINARY, ['--version'], {}), output)

    // Then the spawn failure never reached the host as an uncaught exception
    expect(uncaught).toEqual([])
  })

  it('operator waiting only for close is settled instead of hanging forever', async () => {
    // Given a guarded child for a name that cannot be spawned, and the pre-fix
    // caller shape: one listener, on close
    const child = guardSpawnFailure(spawnDsh(MISSING_BINARY, ['--version'], {}))

    // When that caller waits
    const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })

    // Then it is settled with the guard's own failure exit rather than never
    // resolving, and the spawn error never reached the host uncaught
    expect(code).toBe(SPAWN_FAILURE_EXIT_CODE)
    expect(uncaught).toEqual([])
  })

  it('operator still gets a channel verdict when the probe CLI cannot be spawned', async () => {
    // Given a boot-dump probe whose CLI does not exist, run through the real spawn

    // When the official installer channels are detected
    const official = await detectOfficialChannels(MISSING_BINARY, 'web', {}, spawnDsh)

    // Then the probe degrades to 'no official channels' instead of throwing
    expect(official).toBe(false)
    expect(uncaught).toEqual([])
  })
})

/** An empty temp profile: the gateway reads it before it spawns anything. */
function makeProfile(): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-spawn-failure-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }),
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# layer\n[]\n')
  return {
    facts: {
      profileName: 'web',
      profileDir,
      patchPath: join(profileDir, 'cordis.patch.yml'),
      packageJsonPath: join(profileDir, 'package.json'),
    },
    dir,
  }
}

describe('CliGateway install without a spawnable CLI', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('operator reads why the install failed instead of losing the host', async () => {
    // Given a profile whose CLI resolves to a name nothing can spawn
    const { facts, dir } = makeProfile()
    tempDirs.push(dir)
    const gateway = new CliGateway(facts, {} as NodeJS.ProcessEnv, {
      spawnImpl: spawnDsh,
      findBinary: () => MISSING_BINARY,
    })

    // When an install is requested
    const { jobId } = gateway.install('dsh-nonexistent-package-zzz9')

    // Then the job settles as an error naming the spawn failure
    const job = await vi.waitFor(() => {
      const current = gateway.status(jobId)
      if (current === undefined || current.phase === 'running') throw new Error('job is still running')
      return current
    })
    expect(job.phase).toBe('error')
    expect(job.error).toContain('ENOENT')
    expect(uncaught).toEqual([])
  })
})

describe('relaunch helper', () => {
  it('operator sees why the relaunch helper could not start, and the host stays up', async () => {
    // Given a restart command whose interpreter path does not exist
    const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-restart-1857-'))
    const logPath = join(dir, 'plugin-manager-restart.log')

    // When the detached helper is started
    const started = startRelaunchHelper(
      { execPath: join(dir, 'missing-host-interpreter'), argv: [], cwd: dir, env: process.env },
      logPath,
    )

    // Then no helper was created, the journal records the reason, and the host survived
    await vi.waitFor(() => {
      expect(readFileSync(logPath, 'utf8')).toContain('helper spawn error')
    })
    expect(started).toBe(false)
    expect(uncaught).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})