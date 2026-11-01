/**
 * One persistent bash process per calling agent, driven over piped stdio.
 *
 * Why pipes and not the host's terminal seam: this tool needs a persistent
 * SHELL, not a terminal emulator. What must survive across calls is the shell
 * process state (its current directory, exported variables, functions and
 * aliases) plus exact stdout/stderr bytes and an exact exit code — all of
 * which the subprocess seam's collected streams give directly. A PTY would add
 * echoing and escape sequences this tool would then have to strip again, and
 * would not change the state model.
 *
 * Recovery policy: a shell that exits, wedges or fails its handshake is torn
 * down and the CURRENT call fails with a specific message; the NEXT call
 * starts a fresh shell. State loss is reported rather than hidden, because a
 * silent fresh shell would run the model's next command in the wrong directory
 * with no signal that the previous call's cd/export vanished.
 * @module @linxin666/dsh-win-bash/shell
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, type Dirent } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { buildFrame, markerFor, parseFrame, type FrameMarker, type FrameOutcome } from './protocol.ts'

/** Command stdout budget, in bytes, for one call. */
export const DEFAULT_MAX_STDOUT_BYTES = 128 * 1024

/** Command stderr budget, in bytes, for one call. */
export const DEFAULT_MAX_STDERR_BYTES = 32 * 1024

/** Spill-file byte cap per stream, so a runaway command cannot fill the disk. */
export const DEFAULT_SPILL_BYTES = 8 * 1024 * 1024

/** Grace period handed to the subprocess seam for range teardown. */
export const GRACE_MS = 5000

/** Ceiling on the bytes buffered while looking for a frame's end marker. */
export const FRAME_WATCH_BYTES = 4 * 1024 * 1024

/** In-memory capture ceiling for one shell's stderr, in bytes. */
export const SHELL_STDERR_CAPTURE_BYTES = 256 * 1024

/** Poll cadence while waiting for a frame to complete. */
const POLL_INTERVAL_MS = 15

/** How long a freshly spawned shell gets to answer its startup handshake. */
const HANDSHAKE_TIMEOUT_MS = 15_000

/** Exit status reported for a call the tool itself gave up on. */
export const TIMEOUT_EXIT_CODE = 124

/** Environment variable names carrying the per-shell private temp directory. */
export const TEMP_ENV_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const

/**
 * Name prefix of every private per-shell temp directory. The rest of the name
 * is the owning process id plus a random suffix, which is what lets a later
 * start tell an orphan from a directory a live shell is still using.
 */
export const SHELL_TEMP_PREFIX = 'dsh-win-bash-'

/** Retries granted to one reclaim, for handles a child releases late. */
const TEMP_REMOVE_RETRIES = 3

/** Backoff between those retries, in milliseconds. */
const TEMP_REMOVE_RETRY_DELAY_MS = 100

/**
 * The argv of one pinned shell: the payload's own bash by absolute path, no rc
 * file and no profile, reading its commands from stdin. This tool never
 * consults PATH, and every shell it starts — the session's persistent one and
 * every background job — is built from this one function so the two can never
 * drift into different shells.
 * @param runtime - the verified payload paths.
 * @returns the argv to spawn.
 */
export function shellArgv(runtime: { bash: string }): string[] {
  return [runtime.bash, '--norc', '--noprofile', '-s']
}

/**
 * The environment contract every pinned shell starts with.
 * @param runtime - the verified payload paths.
 * @param temp - the private temp directory that shell owns.
 * @param base - the ambient environment the PATH is appended to.
 * @returns the entries this tool sets explicitly.
 */
export function shellEnvironment(
  runtime: { bin: string },
  temp: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    // The vendored usr/bin goes FIRST on PATH: the payload's own userland
    // is what commands resolve to, and no host Git for Windows, WSL or
    // per-user shim later in the inherited PATH can shadow it.
    PATH: runtime.bin + (process.platform === 'win32' ? ';' : ':') + (base.PATH ?? ''),
    // The payload resolves /tmp from its own etc/fstab usertemp entry,
    // which follows these three names. Pinning them keeps bash's whole
    // mkstemp family inside one private directory per shell instead of
    // the machine's shared temp root.
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    // The MSYS2 personality the payload was built from, which
    // profile.d/msystem reads.
    MSYSTEM: 'MSYS',
    // No terminal is attached, so coreutils would otherwise colour output
    // and pad it into columns based on an inherited TERM guess.
    TERM: 'dumb',
  }
}

/**
 * Create one shell process's private temp directory.
 * @param base - the temp root to create it under; the machine's own by default.
 * @returns the absolute directory, created if absent.
 */
export function shellTempDir(base: string = tmpdir()): string {
  const temp = join(base, SHELL_TEMP_PREFIX + process.pid.toString() + '-' + randomUUID().slice(0, 8))
  mkdirSync(temp, { recursive: true })
  return temp
}

/**
 * Delete one private temp directory, reporting failure to the caller.
 *
 * The retries are the Windows half of this: a child that just exited has not
 * necessarily released its own handles yet, and rm reports that as EBUSY/EPERM.
 * A few short retries turn that into a reclaim instead of a leftover.
 * @param temp - the directory to delete; a missing one is not an error.
 */
async function deleteShellTempDir(temp: string): Promise<void> {
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: TEMP_REMOVE_RETRIES,
    retryDelay: TEMP_REMOVE_RETRY_DELAY_MS,
  })
}

/**
 * Delete one private temp directory, never letting the attempt throw.
 *
 * Teardown must not fail because a directory could not be reclaimed: the shell
 * is already gone, and whatever is left is named for this process's own pid, so
 * the next start's {@link sweepOrphanShellTempDirs} collects it once that pid is
 * gone.
 * @param temp - the directory that shell owned.
 */
export async function removeShellTempDir(temp: string): Promise<void> {
  try {
    await deleteShellTempDir(temp)
  } catch {
    // Deliberately swallowed; see the doc comment above.
  }
}

/** What one orphan sweep found and did, for logging and for tests. */
export interface ShellTempSweep {
  /** Directories this sweep deleted. */
  readonly removed: string[]
  /** Directories whose owning process is still alive. */
  readonly kept: string[]
  /** Directories that could not be deleted; the next start tries again. */
  readonly failed: string[]
}

/** The seams one orphan sweep runs against. */
export interface ShellTempSweepOptions {
  /** The temp root to scan; the machine's own by default. */
  readonly root?: string
  /** Whether the process that owned a directory still exists. */
  readonly isAlive?: (pid: number) => boolean
  /** How one directory is deleted; a rejection marks it failed. */
  readonly remove?: (dir: string) => Promise<void>
}

/**
 * Whether a process id still exists.
 *
 * Signal 0 performs the existence check without delivering anything. EPERM is
 * the one answer that means "alive": the pid is there, it just belongs to a
 * process this one may not signal.
 * @param pid - the process id taken from a directory name.
 * @returns whether that process is still running.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The owning pid of a shell temp directory, when the name is one.
 * @param name - a directory name inside the temp root.
 * @returns the pid, or undefined for every other name.
 */
function shellTempOwner(name: string): number | undefined {
  const match = new RegExp('^' + SHELL_TEMP_PREFIX + '(\\d+)-[0-9a-f]{8}$').exec(name)
  if (match === null) return undefined
  const pid = Number.parseInt(match[1] ?? '', 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/**
 * List one temp root, reporting an unreadable root as empty.
 *
 * There is nothing to reclaim when the root cannot be read, and the next start
 * retries with the same rules; failing the mount over it would be worse.
 * @param root - the temp root to list.
 * @returns its entries, or none.
 */
function tempRootEntries(root: string): Dirent[] {
  try {
    return readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Reclaim the private temp directories of shells that no longer exist.
 *
 * A crash or a hard kill ends this process before it can delete what its live
 * shells owned, and those directories are not small: whatever a command wrote
 * under TMP/TEMP/TMPDIR is still in them. Every name carries the pid that owned
 * it, so the ones whose pid is gone are garbage by construction, and the ones
 * whose pid still runs may belong to a live shell in this very process or to
 * another instance sharing the temp root - those are kept.
 *
 * One directory that cannot be deleted is reported and skipped; it must not
 * stop the round, because the usual cause (a long path, a locked file) is local
 * to that directory.
 * @param options - the seams; production passes none.
 * @returns what was removed, kept and failed.
 */
export async function sweepOrphanShellTempDirs(options: ShellTempSweepOptions = {}): Promise<ShellTempSweep> {
  const root = options.root ?? tmpdir()
  const isAlive = options.isAlive ?? processAlive
  const remove = options.remove ?? deleteShellTempDir
  const removed: string[] = []
  const kept: string[] = []
  const failed: string[] = []
  for (const entry of tempRootEntries(root)) {
    if (!entry.isDirectory()) continue
    const pid = shellTempOwner(entry.name)
    if (pid === undefined) continue
    // This process's own pid is alive by definition, and a directory of its own
    // may be in use by a shell nothing has disposed yet.
    if (pid === process.pid || isAlive(pid)) {
      kept.push(entry.name)
      continue
    }
    try {
      await remove(join(root, entry.name))
      removed.push(entry.name)
    } catch {
      failed.push(entry.name)
    }
  }
  return { removed, kept, failed }
}

/** One command's complete result, as the tool consumes it. */
export interface ShellResult {
  /** The command's stdout, bounded to the visible budget. */
  readonly stdout: string
  /** The command's stderr, bounded to the visible budget. */
  readonly stderr: string
  /** The command's exit status. */
  readonly exitCode: number
  /** True when visible stdout hit its byte budget. */
  readonly stdoutTruncated: boolean
  /** True when visible stderr hit its byte budget. */
  readonly stderrTruncated: boolean
  /** True when the retained stdout lost its head (marker or budget). */
  readonly stdoutLostHead: boolean
  /** True when the retained stderr lost its head. */
  readonly stderrLostHead: boolean
  /** The complete stdout, when it was truncated and the provider spilled it. */
  readonly stdoutSpillPath?: string
  /** The complete stderr, when it was truncated and the provider spilled it. */
  readonly stderrSpillPath?: string
  /** True when stdout overflowed the frame window, so the middle was dropped. */
  readonly frameOverflow: boolean
}

/**
 * The fallback every failure here points at.
 *
 * win_bash is the PREFERRED shell on Windows, not the only one: whenever it
 * cannot serve a call the native shell tool takes over, and a failure that did
 * not say so would leave the model retrying a shell that is not coming back
 * instead of switching to the one that works.
 */
export const NATIVE_FALLBACK_HINT = ' Use the host pwsh tool instead: it is the native shell for this platform'
  + ' and remains available whenever win_bash cannot serve a call.'

/** Failure raised when the shell cannot serve a call. */
export class ShellUnavailableError extends Error {
  /** Stable machine-readable reason. */
  readonly code: string

  /**
   * @param code - stable reason code.
   * @param message - explanation safe to show the model.
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ShellUnavailableError'
    this.code = code
  }
}

/** One live shell process and the facts the framing needs. */
interface LiveShell {
  /** The spawned process handle. */
  readonly handle: SubprocessHandle
  /**
   * The private temp directory this shell owns (its TMP/TEMP/TMPDIR). Recorded
   * on the shell rather than recomputed at teardown, because teardown is the
   * only moment this process knows the directory became garbage.
   */
  readonly temp: string
  /** Set once the handle's outcome settles, so a dead shell is never reused. */
  exited: boolean
  /**
   * The process's own exit facts once it settled. A command that runs 'exit N'
   * ends the SHELL, and the shell's status IS that command's status, so the
   * tool can still report a real exit code instead of an error.
   */
  exitCode: number | null
  /**
   * Whole-stream byte offsets every earlier call on this process consumed,
   * ONE PER STREAM. Collected readers are whole-stream and non-consuming, so
   * each call must resume from here or it would re-parse the previous calls'
   * frames. The two counters are independent: stdout and stderr are separate
   * byte streams with unrelated lengths, and using one shared counter would
   * start the shorter stream past its own data.
   */
  cursor: ShellCursor
}

/** Per-stream resume offsets for one live shell. */
interface ShellCursor {
  /** Bytes of stdout already consumed by earlier calls. */
  stdout: number
  /** Bytes of stderr already consumed by earlier calls. */
  stderr: number
}

/** Budgets and deadline for one {@link ShellRegistry.run} call. */
export interface RunBudget {
  /** Visible stdout byte budget. */
  readonly stdoutBytes: number
  /** Visible stderr byte budget. */
  readonly stderrBytes: number
  /** Whole-call deadline in milliseconds. */
  readonly timeoutMs: number
  /** Caller cancellation. */
  readonly signal?: AbortSignal | undefined
}

/** One bounded accumulator fed by an offset-based collected reader. */
class StreamTail {
  private buffer = ''
  /** Whole-stream offset already consumed from the provider's reader. */
  private offset = 0
  private overflowed = false
  private spilled = false
  private spill: string | undefined

  /**
   * @param label - which collected reader this accumulator drains.
   * @param from - whole-stream offset already consumed by earlier calls on
   *   the same process. Collected readers are whole-stream and non-consuming,
   *   so without this a call would re-read every previous frame.
   */
  constructor(private readonly label: 'stdout' | 'stderr', from = 0) {
    this.offset = from
  }

  /** Everything retained so far. */
  text(): string {
    return this.buffer
  }

  /** Whether the retained window dropped bytes (a lossy read or a trim). */
  lost(): boolean {
    return this.overflowed
  }

  /** Whether anything visible was cut, which is what a spill file is for. */
  wasCut(): boolean {
    return this.spilled
  }

  /** Spill file holding the complete stream, once the provider made one. */
  spillPath(): string | undefined {
    return this.spill
  }

  /**
   * Cut the visible text down to its last budget bytes, recording that the
   * stream was cut so the caller can point at the spill file for the rest.
   * @param budget - the visible byte budget.
   * @returns the visible text and whether it was cut.
   */
  visible(budget: number): { text: string, truncated: boolean } {
    const result = tailBytes(this.buffer, budget)
    if (result.truncated) this.spilled = true
    return result
  }

  /** Record that this stream's visible text was cut somewhere upstream. */
  markCut(): void {
    this.spilled = true
  }

  /** Whole-stream byte offset already consumed. */
  consumed(): number {
    return this.offset
  }

  /**
   * Drain new bytes from one handle's collected readers.
   * @param handle - the live shell's handle.
   * @param watchBytes - how many bytes may be buffered before the head drops.
   */
  drain(handle: SubprocessHandle, watchBytes: number): void {
    const reader = this.label === 'stdout' ? handle.collected.stdout : handle.collected.stderr
    if (reader === undefined) return
    const read = reader.readFrom(this.offset)
    this.offset = read.nextOffset
    if (read.lossy) this.overflowed = true
    if (read.spillPath !== undefined) this.spill = read.spillPath
    if (read.text === '') return
    this.buffer += read.text
    while (byteLength(this.buffer) > watchBytes) {
      this.overflowed = true
      this.buffer = this.buffer.slice(Math.ceil(this.buffer.length / 4))
    }
  }
}

/** UTF-8 byte length of a string. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Keep the LAST budget bytes of a string, reporting whether it dropped any.
 * @param text - the full text.
 * @param budget - the visible byte budget.
 * @returns the visible text and whether it was cut.
 */
export function tailBytes(text: string, budget: number): { text: string, truncated: boolean } {
  if (byteLength(text) <= budget) return { text, truncated: false }
  // Cut from the front on a byte basis. A multi-byte character split by the
  // cut would decode to U+FFFD, which is dropped so the result stays clean
  // text rather than carrying a replacement character nobody wrote.
  const bytes = Buffer.from(text, 'utf8')
  const tail = bytes.subarray(bytes.length - budget).toString('utf8')
  return { text: tail.startsWith('\uFFFD') ? tail.slice(1) : tail, truncated: true }
}

/**
 * The persistent shells of one plugin instance, keyed by calling agent.
 *
 * The keys are the live agent objects and the map is plain, so an agent's
 * shell is dropped by that agent's own disposal hook rather than by a weak
 * reference that decides for itself when to act.
 */
export class ShellRegistry {
  private readonly shells = new Map<object, LiveShell>()

  /**
   * @param subprocess - the host's managed subprocess seam.
   * @param now - clock, injected so tests run without real waiting.
   */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Live shell count, for teardown assertions. */
  get size(): number {
    return this.shells.size
  }

  /** Whether the given owner currently holds a live shell. */
  has(owner: object): boolean {
    const shell = this.shells.get(owner)
    return shell !== undefined && !shell.exited
  }

  /**
   * Run one command in the owner's persistent shell, starting it on first use.
   * @param owner - the calling agent (the shell lifetime key).
   * @param runtime - absolute shell and payload paths.
   * @param cwd - the session workspace a newly started shell begins in.
   * @param command - the command to run.
   * @param budget - output budgets and the call deadline.
   * @returns the command's complete result.
   */
  async run(
    owner: object,
    runtime: { bash: string, bin: string },
    cwd: string,
    command: string,
    budget: RunBudget,
  ): Promise<ShellResult> {
    const shell = await this.ensure(owner, runtime, cwd, budget.signal)
    const marker = markerFor(randomUUID())
    const stdout = new StreamTail('stdout', shell.cursor.stdout)
    const stderr = new StreamTail('stderr', shell.cursor.stderr)
    shell.handle.stdin?.write(buildFrame(command, marker))
    const deadline = this.now() + budget.timeoutMs
    let sawBegin = false
    // Resume offsets advance on EVERY return path, so the next call on this
    // process starts after this frame instead of re-parsing it.
    const resume = (): void => {
      shell.cursor.stdout = stdout.consumed()
      shell.cursor.stderr = stderr.consumed()
    }

    for (;;) {
      if (budget.signal?.aborted === true) {
        resume()
        await this.dispose(owner, 'the tool call was aborted')
        throw new ShellUnavailableError(
          'aborted',
          'The win_bash call was aborted and its persistent shell was stopped. The next call starts a fresh shell, '
          + 'so shell state changed before this call was aborted is gone.',
        )
      }
      const frame = readFrame(shell, stdout, stderr, marker, sawBegin)
      // Latch the begin marker: a command whose output exceeds the watch window
      // loses its head, and the end marker must still be recognized then.
      sawBegin ||= frame.text.includes(marker.begin)
      if (frame.outcome !== undefined) {
        const result = complete(frame.outcome, stdout, stderr, budget)
        resume()
        return result
      }
      if (shell.exited) {
        // A drained-but-unframed exit means the command ended the SHELL (an
        // explicit 'exit N', or a runtime failure). When the process reported
        // its own status, that status IS this command's status, so the call
        // answers with a real exit code plus a note that the shell is gone and
        // the next call starts fresh. Without a status there is nothing honest
        // to report but the teardown itself.
        resume()
        this.shells.delete(owner)
        // The process ended on its own, so dispose never runs for it: its
        // private temp directory is reclaimed here or nowhere.
        await removeShellTempDir(shell.temp)
        const partial = tailBytes(recoverPartial(frame.text, marker), budget.stdoutBytes)
        if (shell.exitCode === null) {
          throw new ShellUnavailableError(
            'shell-exited',
            'The persistent bash shell exited without reporting a status, so this command did not complete. '
            + 'The next win_bash call starts a fresh shell in the session workspace with a new current directory and environment.',
          )
        }
        const visibleErr = stderr.visible(budget.stderrBytes)
        const note = '[the command ended the persistent bash process; the next win_bash call starts a fresh shell]'
        return {
          stdout: partial.text,
          stderr: visibleErr.text === '' ? note : visibleErr.text + '\n' + note,
          exitCode: shell.exitCode,
          stdoutTruncated: partial.truncated,
          stderrTruncated: visibleErr.truncated,
          stdoutLostHead: stdout.lost() || partial.truncated,
          stderrLostHead: stderr.lost() || visibleErr.truncated,
          frameOverflow: stdout.lost(),
          ...(stdout.wasCut() && stdout.spillPath() !== undefined ? { stdoutSpillPath: stdout.spillPath() } : {}),
          ...(stderr.wasCut() && stderr.spillPath() !== undefined ? { stderrSpillPath: stderr.spillPath() } : {}),
        }
      }
      if (this.now() > deadline) {
        await this.dispose(owner, 'the command exceeded its time budget')
        const visibleErr = stderr.visible(budget.stderrBytes)
        const note = '[timed out after ' + budget.timeoutMs.toString()
          + 'ms; the persistent shell was stopped, so the next win_bash call starts a fresh shell]'
        const partial = tailBytes(recoverPartial(frame.text, marker), budget.stdoutBytes)
        if (partial.truncated) stdout.markCut()
        resume()
        return {
          stdout: partial.text,
          stderr: visibleErr.text === '' ? note : visibleErr.text + '\n' + note,
          exitCode: TIMEOUT_EXIT_CODE,
          stdoutTruncated: partial.truncated,
          stderrTruncated: visibleErr.truncated,
          stdoutLostHead: stdout.lost() || partial.truncated,
          stderrLostHead: stderr.lost() || visibleErr.truncated,
          frameOverflow: stdout.lost(),
          ...(stdout.wasCut() && stdout.spillPath() !== undefined ? { stdoutSpillPath: stdout.spillPath() } : {}),
          ...(stderr.wasCut() && stderr.spillPath() !== undefined ? { stderrSpillPath: stderr.spillPath() } : {}),
        }
      }
      await new Promise<void>(resolve => { setTimeout(resolve, POLL_INTERVAL_MS) })
    }
  }

  /**
   * Get the owner's live shell, starting one when absent.
   * @param owner - calling agent identity.
   * @param runtime - absolute shell and payload paths.
   * @param cwd - the session workspace a new shell starts in.
   * @param signal - cancellation while the shell starts.
   * @returns the live shell record.
   */
  private async ensure(
    owner: object,
    runtime: { bash: string, bin: string },
    cwd: string,
    signal?: AbortSignal,
  ): Promise<LiveShell> {
    const existing = this.shells.get(owner)
    if (existing !== undefined && !existing.exited) return existing
    if (existing !== undefined) this.shells.delete(owner)
    const temp = shellTempDir()
    const handle = this.subprocess.spawn({
      argv: shellArgv(runtime),
      cwd,
      stdio: {
        stdin: 'pipe',
        stdout: { maxBytes: FRAME_WATCH_BYTES, spill: { maxBytes: DEFAULT_SPILL_BYTES } },
        stderr: { maxBytes: SHELL_STDERR_CAPTURE_BYTES, spill: { maxBytes: DEFAULT_SPILL_BYTES } },
      },
      graceMs: GRACE_MS,
      env: shellEnvironment(runtime, temp),
    })
    const shell: LiveShell = { handle, temp, exited: false, cursor: { stdout: 0, stderr: 0 }, exitCode: null }
    const markExited = (outcome: { exitCode: number | null }): void => {
      shell.exitCode = outcome.exitCode
      shell.exited = true
    }
    void handle.done.then(markExited, () => { shell.exited = true })
    this.shells.set(owner, shell)
    await this.handshake(shell, signal)
    return shell
  }

  /**
   * Confirm a fresh shell answers before the first real command runs, so a
   * payload that cannot start surfaces as one clear failure instead of as a
   * mysterious empty result on the model's command.
   */
  private async handshake(shell: LiveShell, signal?: AbortSignal): Promise<void> {
    const marker = markerFor(randomUUID())
    const stdout = new StreamTail('stdout', shell.cursor.stdout)
    shell.handle.stdin?.write(buildFrame('printf %s "$BASH_VERSION"', marker))
    const deadline = this.now() + HANDSHAKE_TIMEOUT_MS
    for (;;) {
      if (shell.exited) {
        throw new ShellUnavailableError(
          'shell-exited',
          'The vendored bash exited during startup, so win_bash cannot run commands in this session.' + NATIVE_FALLBACK_HINT,
        )
      }
      if (signal?.aborted === true) {
        throw new ShellUnavailableError('aborted', 'The win_bash call was aborted while the persistent shell was starting.')
      }
      stdout.drain(shell.handle, 256 * 1024)
      const outcome = parseFrame(stdout.text(), marker, true)
      if (outcome !== undefined) {
        if (outcome.exitCode !== 0 || !/^\d+(\.\d+)?/.test(outcome.stdout)) {
          throw new ShellUnavailableError(
            'handshake-failed',
            'The vendored bash did not report a version (exit ' + outcome.exitCode.toString() + ').' + NATIVE_FALLBACK_HINT,
          )
        }
        // The handshake's own bytes are consumed here too: the first real
        // command must resume past the version frame, not re-parse it.
        shell.cursor.stdout = stdout.consumed()
        return
      }
      if (this.now() > deadline) {
        throw new ShellUnavailableError(
          'handshake-timeout',
          'The vendored bash did not answer its startup handshake in time.' + NATIVE_FALLBACK_HINT,
        )
      }
      await new Promise<void>(resolve => { setTimeout(resolve, POLL_INTERVAL_MS) })
    }
  }

  /**
   * Stop one owner's shell and forget it. Termination goes through the seam's
   * managed-process range, so a background job the command left behind is torn
   * down with the shell rather than surviving the plugin.
   * @param owner - calling agent identity.
   * @param reason - recorded by the provider for diagnostics.
   */
  async dispose(owner: object, reason: string): Promise<void> {
    const shell = this.shells.get(owner)
    if (shell === undefined) return
    this.shells.delete(owner)
    await terminate(shell, reason)
  }

  /** Stop every shell this registry owns; used on plugin unload. */
  async disposeAll(reason: string): Promise<void> {
    const shells = [...this.shells.values()]
    this.shells.clear()
    await Promise.allSettled(shells.map(shell => terminate(shell, reason)))
  }
}

/** One frame read attempt: the parsed outcome and the raw stdout it came from. */
interface FrameRead {
  /** The parsed frame, once both markers and the status digits arrived. */
  readonly outcome: FrameOutcome | undefined
  /** Raw accumulated stdout, used to recover a partial result on timeout. */
  readonly text: string
}

/**
 * Drain both streams once and try to parse the call's frame.
 *
 * Draining and parsing are one step on purpose: a caller that drained without
 * parsing left the accumulator holding a frame it never consumed, and the next
 * call then re-read that stale text as its own result.
 * @param shell - the live shell.
 * @param stdout - the stdout accumulator.
 * @param stderr - the stderr accumulator.
 * @param marker - the call's markers.
 * @param sawBegin - whether the begin marker was already observed.
 * @returns the parsed outcome (once complete) and the raw stdout.
 */
function readFrame(
  shell: LiveShell,
  stdout: StreamTail,
  stderr: StreamTail,
  marker: FrameMarker,
  sawBegin: boolean,
): FrameRead {
  stdout.drain(shell.handle, FRAME_WATCH_BYTES)
  stderr.drain(shell.handle, FRAME_WATCH_BYTES)
  const text = stdout.text()
  return {
    outcome: text.includes(marker.end) ? parseFrame(text, marker, sawBegin) : undefined,
    text,
  }
}

/**
 * Assemble the tool-visible result from a completed frame.
 *
 * The stdout comes from the PARSED FRAME, not from the raw accumulator: the
 * accumulator still holds the markers and every earlier byte of the stream,
 * so reading it directly would hand the model the framing as its output.
 */
function complete(outcome: FrameOutcome, stdout: StreamTail, stderr: StreamTail, budget: RunBudget): ShellResult {
  const visibleOut = tailBytes(outcome.stdout, budget.stdoutBytes)
  if (visibleOut.truncated) stdout.markCut()
  const visibleErr = stderr.visible(budget.stderrBytes)
  const outDropped = outcome.lostPrefix || stdout.lost() || visibleOut.truncated
  return {
    stdout: visibleOut.text,
    stderr: visibleErr.text,
    exitCode: outcome.exitCode,
    stdoutTruncated: outDropped,
    stderrTruncated: visibleErr.truncated,
    stdoutLostHead: outDropped,
    stderrLostHead: stderr.lost() || visibleErr.truncated,
    frameOverflow: stdout.lost(),
    ...(stdout.wasCut() && stdout.spillPath() !== undefined ? { stdoutSpillPath: stdout.spillPath() } : {}),
    ...(stderr.wasCut() && stderr.spillPath() !== undefined ? { stderrSpillPath: stderr.spillPath() } : {}),
  }
}

/** Whatever stdout is recoverable after a timeout, with the begin marker cut. */
function recoverPartial(text: string, marker: FrameMarker): string {
  const begin = text.lastIndexOf(marker.begin)
  return begin < 0 ? text : text.slice(begin + marker.begin.length).replace(/^\n/, '')
}

/**
 * Signal one shell's managed range and reclaim what it owned, never letting
 * teardown throw.
 *
 * The directory is deleted after the range is gone rather than before: it is
 * the shell's TMP/TEMP/TMPDIR, so deleting it under a live process would turn
 * every command still writing there into a failure.
 */
async function terminate(shell: LiveShell, reason: string): Promise<void> {
  void reason
  try {
    shell.handle.terminate()
    await shell.handle.waitForExit()
  } catch {
    // A provider that can no longer observe its range must not block teardown:
    // the process was signalled and the registry entry is already gone.
  }
  await removeShellTempDir(shell.temp)
}