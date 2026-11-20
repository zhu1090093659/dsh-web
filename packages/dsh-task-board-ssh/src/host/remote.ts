/**
 * Every remote operation one run performs, over the `dshSsh` face.
 *
 * The remote side is one POSIX `sh` script the provider installs once per host
 * (`src/core/launcher.ts` builds every command and reads every answer); this
 * module is the only place that composes those commands with the `dshSsh`
 * `exec` forwarder, so no other file in the host half talks to a host directly.
 *
 * Three guarantees live here and nowhere else:
 *
 * - The state directory is resolved once per host from the host's own `$HOME`
 *   and cached, so no command depends on the remote shell expanding a tilde.
 * - `start` is de-duplicated in flight: the pool may replay a command when it
 *   reconnects, and a replayed start must join the start already running instead
 *   of spawning a second agent (the script is idempotent on the run id as well,
 *   which covers a replay that arrives after this process forgot the first one).
 * - A failed remote command is one diagnosable error carrying the host's own
 *   stderr, bounded, instead of a silent `success: false` a caller can ignore.
 *
 * @module dsh-task-board-ssh/host/remote
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DshSshService } from '../core/contract.ts'
import type { SshAgentCommand } from '../core/adapters/types.ts'
import {
  agentScript,
  buildLauncherCommand,
  buildLauncherInstallCommand,
  buildRunFileCommands,
  parseLauncherStatus,
  runDirectory,
  runFilePath,
  stateDirForHome,
  type LauncherStatus,
} from '../core/launcher.ts'
import { shellEnsureDir, shellRemoveDir, shellWriteFile } from '../core/shell.ts'

/** Ceiling for one remote command, in milliseconds. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000

/**
 * Prompts whose shell-quoted command exceeds this threshold are uploaded via
 * SFTP instead of inlined into `sh -c`, staying well below Linux's 128 KiB
 * `MAX_ARG_STRLEN` limit (E2BIG).
 */
const INLINE_PROMPT_COMMAND_LIMIT_BYTES = 32 * 1024

/** Longest remote error text this module carries into a message, in characters. */
const ERROR_TEXT_MAX = 400

/** What one remote call addresses. */
export interface SshRemoteRef {
  /** `dshSsh` host alias. */
  alias: string
  /** Absolute remote state directory the provider owns on that host. */
  stateDir: string
  /** Run the call addresses. */
  runId: string
}

/** The files one run's start writes before the launcher runs it. */
export interface SshRemoteRunFiles {
  /** Prompt text the agent reads. */
  prompt: string
  /** Quoted command line the launcher executes. */
  command: SshAgentCommand
  /** Absolute remote directory the run works in. */
  cwd: string
  /** Opaque spec the provider keeps for its own reconciliation. */
  spec: unknown
}

/** A remote command that could not be completed, in the host's own words. */
export class SshRemoteError extends Error {
  /** Host the command addressed. */
  readonly alias: string
  /** What the command was for. */
  readonly what: string

  constructor(alias: string, what: string, message: string) {
    super(`remote ${what} on ${alias} failed: ${message}`)
    this.name = 'SshRemoteError'
    this.alias = alias
    this.what = what
  }
}

/** One page of a run's log, as the read verb returned it. */
export interface SshTailPage {
  /** Bytes the remote log held from the requested offset to its end, as text. */
  text: string
  /** Byte offset the next read starts at. */
  bytes: number
}

/** Options of {@link SshRemote}. */
export interface SshRemoteOptions {
  /** Ceiling for one remote command, in milliseconds. */
  timeoutMs?: number
}

/** Bound a remote message before it reaches a card, a log line or a summary. */
function bounded(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= ERROR_TEXT_MAX ? trimmed : trimmed.slice(0, ERROR_TEXT_MAX) + '...'
}

export class SshRemote {
  private readonly ssh: DshSshService
  private readonly timeoutMs: number
  private readonly stateDirs = new Map<string, string>()
  private readonly starting = new Map<string, Promise<LauncherStatus>>()
  private readonly installing = new Map<string, Promise<void>>()

  constructor(ssh: DshSshService, options: SshRemoteOptions = {}) {
    this.ssh = ssh
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  }

  /** Forget every cached path of one host, or of all hosts when none is named. */
  forget(alias?: string): void {
    if (alias === undefined) {
      this.stateDirs.clear()
      this.installing.clear()
    } else {
      this.stateDirs.delete(alias)
      for (const key of this.installing.keys()) {
        if (key.startsWith(alias + '/')) this.installing.delete(key)
      }
    }
  }

  /**
   * Resolve (and cache) the absolute state directory of one host.
   * @param alias - host alias.
   * @returns the directory the provider installs the launcher and its runs under.
   */
  async stateDir(alias: string): Promise<string> {
    const cached = this.stateDirs.get(alias)
    if (cached !== undefined) return cached
    const result = await this.ssh.exec(alias, 'printf %s "$HOME"', { timeoutMs: this.timeoutMs })
    const home = result.success ? result.stdout.trim() : ''
    if (home === '' || !home.startsWith('/')) {
      throw new SshRemoteError(alias, 'home lookup', result.error ?? (result.stderr.trim() || 'the host reported no home directory'))
    }
    const stateDir = stateDirForHome(home)
    this.stateDirs.set(alias, stateDir)
    return stateDir
  }

  /**
   * Install (or refresh) the launcher script on one host, deduplicating
   * concurrent installs on the same host and state directory.
   * @param ref - host and state directory.
   */
  async installLauncher(ref: { alias: string; stateDir: string }): Promise<void> {
    const key = ref.alias + '/' + ref.stateDir
    const inflight = this.installing.get(key)
    if (inflight !== undefined) return await inflight
    const task = (async (): Promise<void> => {
      try {
        await this.run(ref.alias, buildLauncherInstallCommand(ref.stateDir), 'launcher install')
      } finally {
        this.installing.delete(key)
      }
    })()
    this.installing.set(key, task)
    return await task
  }

  /**
   * Write every file one run needs before `start`.
   *
   * Large prompts are uploaded through SFTP instead of inlined into a single
   * shell command line so multi-megabyte prompts never trip Linux `E2BIG`.
   * @param ref - host, state directory and run.
   * @param files - prompt, command line, working directory and spec.
   */
  async writeRunFiles(ref: SshRemoteRef, files: SshRemoteRunFiles): Promise<void> {
    const commands = buildRunFileCommands({
      stateDir: ref.stateDir,
      runId: ref.runId,
      prompt: files.prompt,
      command: files.command,
      cwd: files.cwd,
      spec: files.spec,
    })
    const combined = commands.join(' && ')
    if (new TextEncoder().encode(combined).length <= INLINE_PROMPT_COMMAND_LIMIT_BYTES) {
      await this.run(ref.alias, combined, 'run file write')
      return
    }
    const directory = runDirectory(ref.stateDir, ref.runId)
    const metadataCommands = [
      shellEnsureDir(directory),
      shellWriteFile(runFilePath(ref.stateDir, ref.runId, 'cmd.sh'), agentScript(files.command)),
      shellWriteFile(runFilePath(ref.stateDir, ref.runId, 'cwd'), files.cwd),
      shellWriteFile(runFilePath(ref.stateDir, ref.runId, 'spec.json'), JSON.stringify(files.spec)),
    ]
    await this.run(ref.alias, metadataCommands.join(' && '), 'run file write')
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-task-board-ssh-prompt-'))
    try {
      const localPrompt = join(scratch, 'prompt.txt')
      await writeFile(localPrompt, files.prompt, 'utf8')
      await this.ssh.upload(ref.alias, localPrompt, runFilePath(ref.stateDir, ref.runId, 'prompt.txt'))
    } catch (error) {
      throw new SshRemoteError(ref.alias, 'prompt upload', error instanceof Error ? error.message : String(error))
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  /**
   * Ask the launcher to start one run, joining a start already in flight.
   * @param ref - host, state directory and run.
   * @returns the state line the launcher printed.
   */
  async start(ref: SshRemoteRef): Promise<LauncherStatus> {
    const key = ref.alias + '/' + ref.runId
    const inflight = this.starting.get(key)
    if (inflight !== undefined) return await inflight
    const started = (async (): Promise<LauncherStatus> => {
      try {
        const result = await this.run(ref.alias, buildLauncherCommand({
          stateDir: ref.stateDir,
          verb: 'start',
          runId: ref.runId,
        }), 'start')
        return parseLauncherStatus(result.stdout)
      } finally {
        this.starting.delete(key)
      }
    })()
    this.starting.set(key, started)
    return await started
  }

  /**
   * Read one run's state.
   * @param ref - host, state directory and run.
   * @returns the state line the launcher printed.
   */
  async status(ref: SshRemoteRef): Promise<LauncherStatus> {
    const result = await this.run(ref.alias, buildLauncherCommand({
      stateDir: ref.stateDir,
      verb: 'status',
      runId: ref.runId,
    }), 'status')
    return parseLauncherStatus(result.stdout)
  }

  /**
   * Read a run's log from a byte offset, optionally capped to `limit` bytes.
   * @param ref - host, state directory and run.
   * @param offset - first byte to return.
   * @param limit - optional maximum byte count to return (prevents hitting dsh-ssh's 2 MiB output cap).
   * @returns the text and the offset the next read starts at.
   */
  async tail(ref: SshRemoteRef, offset: number, limit?: number): Promise<SshTailPage> {
    const result = await this.run(ref.alias, buildLauncherCommand({
      stateDir: ref.stateDir,
      verb: 'tail',
      runId: ref.runId,
      offset,
      ...(limit === undefined ? {} : { limit }),
    }), 'tail')
    const text = result.stdout
    return { text, bytes: offset + new TextEncoder().encode(text).length }
  }

  /**
   * Read the bounded tail of a run's `stderr.log`, for diagnosing failures when
   * `stdout.log` carries no structured agent event.
   * @param ref - host, state directory and run.
   * @param limit - maximum bytes from the end of `stderr.log`.
   * @returns trimmed stderr text, or empty string when unavailable.
   */
  async stderr(ref: SshRemoteRef, limit = 4096): Promise<string> {
    try {
      const result = await this.run(ref.alias, buildLauncherCommand({
        stateDir: ref.stateDir,
        verb: 'stderr',
        runId: ref.runId,
        limit,
      }), 'stderr')
      return result.stdout.trim()
    } catch {
      return ''
    }
  }

  /**
   * Ask the launcher to cancel one run.
   * @param ref - host, state directory and run.
   * @returns the state line the launcher printed.
   */
  async cancel(ref: SshRemoteRef): Promise<LauncherStatus> {
    const result = await this.run(ref.alias, buildLauncherCommand({
      stateDir: ref.stateDir,
      verb: 'cancel',
      runId: ref.runId,
    }), 'cancel', 15_000)
    return parseLauncherStatus(result.stdout)
  }

  /**
   * Remove one run directory from the host, tolerating its absence.
   * @param ref - host, state directory and run.
   */
  async removeRun(ref: SshRemoteRef): Promise<void> {
    await this.run(ref.alias, shellRemoveDir(runDirectory(ref.stateDir, ref.runId)), 'run directory removal')
  }

  /** Run one command and refuse a failed one in the host's own words. */
  private async run(alias: string, command: string, what: string, timeoutMs = this.timeoutMs): Promise<{ stdout: string }> {
    const result = await this.ssh.exec(alias, command, { timeoutMs })
    if (result.success) return { stdout: result.stdout }
    const detail = result.error ?? result.stderr.trim()
    const reason = detail !== ''
      ? bounded(detail)
      : result.timedOut
        ? `it did not finish within ${String(timeoutMs)} ms`
        : `the command exited with code ${String(result.exitCode ?? 'none')}`
    throw new SshRemoteError(alias, what, reason)
  }
}
