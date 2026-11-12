/**
 * The shell registry driving the vendored bash for real.
 *
 * This is the package's central behavioural claim — ONE process per session
 * whose state survives across calls — so it is exercised against the shipped
 * payload rather than a fake shell. The seams are real too: a minimal
 * SubprocessRuntime implementation over node's child_process stands in for the
 * host's provider, so the offset-based collected readers and the managed-range
 * teardown are the same calls the host makes.
 *
 * Skipped off Windows x64, where the payload cannot start.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessRuntime,
} from '@deepseek-ai/dsh-subprocess'
import { ShellRegistry } from '../src/shell.ts'
import { binDir, bashPath } from '../src/runtime.ts'

const RUNNABLE = process.platform === 'win32' && process.arch === 'x64'

/** One collected stream with the reader semantics the seam documents. */
class Collected {
  private text = ''
  private spilled: string | undefined

  /** Append bytes and report the reader the handle exposes. */
  reader(): { readFrom(offset: number): { text: string, nextOffset: number, lossy: boolean } } {
    return {
      readFrom: (offset: number) => ({ text: this.text.slice(offset), nextOffset: this.text.length, lossy: false }),
    }
  }

  /** Record a chunk. */
  push(chunk: string): void {
    this.text += chunk
  }

  /** Spill path, when the provider created one (never here). */
  spillPath(): string | undefined {
    return this.spilled
  }
}

/** The minimal provider the registry needs: spawn, collected readers, terminate. */
function provider(): SubprocessRuntime {
  let live: ChildProcess | undefined
  return {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env } as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      live = child
      const out = new Collected()
      const err = new Collected()
      child.stdout?.on('data', (chunk: Buffer) => { out.push(chunk.toString()) })
      child.stderr?.on('data', (chunk: Buffer) => { err.push(chunk.toString()) })
      const done = new Promise<SubprocessOutcome>(resolve => {
        child.on('close', code => { resolve({ exitCode: code, signal: null }) })
      })
      return {
        stdin: child.stdin ?? undefined,
        stdout: child.stdout ?? undefined,
        stderr: child.stderr ?? undefined,
        control: undefined,
        collected: {
          stdout: { readFrom: (offset: number) => {
            const read = out.reader().readFrom(offset)
            return { ...read, ...(out.spillPath() === undefined ? {} : { spillPath: out.spillPath() }) }
          } },
          stderr: { readFrom: (offset: number) => err.reader().readFrom(offset) },
        },
        done,
        terminate: () => { child.kill() },
        waitForExit: async () => {
          await done
          return true
        },
      } as unknown as SubprocessHandle
    },
    resolveExecutable: async () => bashPath(),
    terminalEnvironment: async () => ({ platform: 'windows' as const }),
    spawnTerminal: () => { throw new Error('win_bash never allocates a terminal') },
    get live(): ChildProcess | undefined { return live },
  } as unknown as SubprocessRuntime
}

/**
 * The private temp directories this process's shells currently own, by the name
 * each shell gives its own.
 *
 * The test reads the file system rather than the shell's own $TMP: MSYS rewrites
 * that variable into its POSIX form, while what the user's disk sees is the
 * Windows path named here.
 * @returns absolute paths of live directories created for this process.
 */
function ownTempDirs(): string[] {
  const stem = 'dsh-win-bash-' + process.pid.toString() + '-'
  return readdirSync(tmpdir())
    .filter(name => name.startsWith(stem))
    .map(name => join(tmpdir(), name))
}

const BUDGET = { stdoutBytes: 64 * 1024, stderrBytes: 16 * 1024, timeoutMs: 30_000 }

describe.skipIf(!RUNNABLE)('the persistent shell over the real payload', () => {
  it('user running two commands gets the first command\'s directory and variables in the second', async () => {
    // Given one session's shell with a command that changes both its
    // directory and an exported variable,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const first = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'export WIN_BASH_MARK=kept; cd /usr/bin; pwd -W', BUDGET)
    // When the next call in the same session reads them back,
    const second = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'echo "mark=$WIN_BASH_MARK"; pwd -W', BUDGET)
    // Then both survived, which proves the two calls shared one process.
    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(second.stdout).toContain('mark=kept')
    expect(second.stdout.toLowerCase()).toContain(binDir().replace(/\\/g, '/').toLowerCase())
    await shells.disposeAll('test teardown')
  })

  it('user running many commands gets each command\'s own exit code', async () => {
    // Given one shell running a command that succeeds, one that just fails,
    // and one that succeeds again,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const ok = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo one', BUDGET)
    const bad = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'false', BUDGET)
    const again = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo two', BUDGET)
    // When their statuses are compared,
    // Then each call reported its own and a failing command did not poison the
    // shell for the next one.
    expect([ok.exitCode, bad.exitCode, again.exitCode]).toEqual([0, 1, 0])
    expect(ok.stdout.trim()).toBe('one')
    expect(again.stdout.trim()).toBe('two')
    await shells.disposeAll('test teardown')
  })

  it('user running a command that ends the shell gets that command\'s status and a fresh shell next time', async () => {
    // Given a command that ends the persistent shell with an explicit status,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const exiting = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'echo before-exit; exit 42', BUDGET)
    // When the next call runs,
    const fresh = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo fresh', BUDGET)
    // Then the exiting command reported its own status and said the shell was
    // gone, and the next call transparently started a new one.
    expect(exiting.exitCode).toBe(42)
    expect(exiting.stdout).toContain('before-exit')
    expect(exiting.stderr).toContain('starts a fresh shell')
    expect(fresh.exitCode).toBe(0)
    expect(fresh.stdout.trim()).toBe('fresh')
    await shells.disposeAll('test teardown')
  })

  it('user submitting a command with an unterminated quote keeps its shell usable', async () => {
    // Given a shell and a command whose quoting never closes,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const broken = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo "oops', BUDGET)
    // When the next command runs on the same shell,
    const recovered = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo recovered', BUDGET)
    // Then the syntax error was reported by the FIRST call and the shell moved
    // on, which is the whole reason the frame is a sourced heredoc.
    expect(broken.exitCode).not.toBe(0)
    expect(broken.stderr).toContain('unexpected EOF')
    expect(recovered.exitCode).toBe(0)
    expect(recovered.stdout.trim()).toBe('recovered')
    await shells.disposeAll('test teardown')
  })

  it('user reading stderr gets it separately from stdout', async () => {
    // Given a command that writes to both streams,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const result = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'echo to-stdout; echo to-stderr 1>&2', BUDGET)
    // When the result is read,
    // Then the streams were kept apart.
    expect(result.stdout).toContain('to-stdout')
    expect(result.stdout).not.toContain('to-stderr')
    expect(result.stderr).toContain('to-stderr')
    await shells.disposeAll('test teardown')
  })

  it('user running a command that prints past the visible budget gets the tail and a truncation flag', async () => {
    // Given a command printing well past this call's visible stdout budget,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const tight = { ...BUDGET, stdoutBytes: 4096 }
    const result = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'i=0; while [ $i -lt 4000 ]; do echo "line-$i"; i=$((i+1)); done', tight)
    // When the result is read,
    // Then the call settled with the command's exit status, the retained
    // output is the TAIL (a bounded reader keeps the end), and the cut is
    // reported instead of hidden.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('line-3999')
    expect(result.stdout).not.toContain('line-0\n')
    expect(result.stdoutTruncated).toBe(true)
    await shells.disposeAll('test teardown')
  })

  it('user running a command whose output overflows the watch window still gets its exit status', async () => {
    // Given a command printing far past the frame watch window (the parser
    // loses the head of that stream), followed by a normal command,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const flood = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'i=0; while [ $i -lt 200000 ]; do echo "flood-$i"; i=$((i+1)); done', { ...BUDGET, timeoutMs: 120_000 })
    const after = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo after-flood', BUDGET)
    // When the two calls settle,
    // Then the flooding call still reported a real status rather than hanging,
    // and the next call parsed its own frame correctly - which only works if
    // the end marker is honoured after the begin marker slid away.
    expect(flood.exitCode).toBe(0)
    expect(flood.stdout).toContain('flood-199999')
    expect(after.exitCode).toBe(0)
    expect(after.stdout.trim()).toBe('after-flood')
    await shells.disposeAll('test teardown')
  })

  it('user running a command that prints within the budget gets no truncation flag', async () => {
    // Given a command whose output fits the visible budget,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const result = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'echo short-output', BUDGET)
    // When the result is read,
    // Then the output is complete and nothing claims it was cut.
    expect(result.stdout.trim()).toBe('short-output')
    expect(result.stdoutTruncated).toBe(false)
    expect(result.stderrTruncated).toBe(false)
    await shells.disposeAll('test teardown')
  })

  it('operator disposing a session gets the shell process reclaimed', async () => {
    // Given a session's shell that has run a command,
    const providerInstance = provider()
    const shells = new ShellRegistry(providerInstance)
    const owner = {}
    await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo alive', BUDGET)
    // When that agent is disposed,
    await shells.dispose(owner, 'the test disposed the session')
    // Then the registry holds nothing and the process range is gone.
    expect(shells.size).toBe(0)
    expect(shells.has(owner)).toBe(false)
  })

  it('user ending the shell with exit gets its private temp directory removed', async () => {
    // Given a shell that owns a private temp directory and has written to it,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const before = ownTempDirs()
    await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'echo "$TMP"; echo alive', BUDGET)
    const added = ownTempDirs().filter(dir => !before.includes(dir))
    expect(added).toHaveLength(1)
    // When a command ends the shell the way a user's 'exit' does, without any
    // disposal path running,
    const exiting = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(), 'exit 0', BUDGET)
    // Then the shell is gone AND the directory it owned is gone with it, so a
    // session that exits and restarts many times leaves nothing behind.
    expect(exiting.exitCode).toBe(0)
    expect(existsSync(added[0] ?? '')).toBe(false)
  })

  it('operator disposing a session gets its shell\'s private temp directory removed', async () => {
    // Given a session's shell holding what a command wrote under its TMP,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const before = ownTempDirs()
    await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      'echo payload > "$TMP/left-behind.bin"', BUDGET)
    const added = ownTempDirs().filter(dir => !before.includes(dir))
    expect(added).toHaveLength(1)
    // When that session is disposed, as an ended or archived session is,
    await shells.dispose(owner, 'the test disposed the session')
    // Then the shell's private directory and the payload in it are reclaimed
    // with the process.
    expect(existsSync(added[0] ?? '')).toBe(false)
  })

  it('user running a command in a per-call workdir gets it resolved before the command', async () => {
    // Given a workdir argument pointing at the payload's own etc directory,
    const shells = new ShellRegistry(provider())
    const owner = {}
    const target = join(binDir(), '..', '..', 'etc')
    const result = await shells.run(owner, { bash: bashPath(), bin: binDir() }, process.cwd(),
      "cd '" + target.replace(/\\/g, '/') + "' && pwd -W && ls fstab'", BUDGET)
    // When the command runs,
    // Then it resolved inside the payload, so a Windows path with backslashes
    // reached bash intact.
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('/etc')
    expect(result.stdout).toContain('fstab')
    await shells.disposeAll('test teardown')
  })
})
