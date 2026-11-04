/**
 * Background execution for win_bash: one command in its OWN pinned bash
 * process, registered with the host's job registry (`ctx.jobs`) so the model
 * can collect it with `job_output` and stop it with `job_kill`.
 *
 * WHY A SEPARATE PROCESS AND NOT A SHELL '&'. The session's persistent shell
 * lives inside the subprocess provider's managed process range, and disposing
 * that range terminates every process still running in it. A job started with
 * a trailing '&' is therefore bound to the shell that started it: the next
 * call's timeout, its abort, or the agent's disposal kills the background work
 * with the shell, and nothing says so. A background job must own its own
 * process, which is what this module starts.
 *
 * SHAPE, NOT IMPORT. Like ./gate.ts, this module consumes the job registry
 * STRUCTURALLY: a leaf plugin takes no dependency on @deepseek-ai/dsh-jobs to
 * call one method on an optional service, and the same decision keeps this
 * package out of the job registry's implementation. The members below are
 * mirrored from the published declaration of @deepseek-ai/dsh-jobs@0.2.2-alpha.3:
 *
 *   lib/types/index.d.ts
 *     abstract class JobRegistry {
 *       abstract start(spec: JobSpec): JobId
 *     }
 *   lib/types/types.d.ts
 *     interface JobSpec {
 *       kind: JobKind
 *       label: string
 *       owner?: SessionId
 *       outputLimitBytes?: number
 *       output?: readonly JobOutputSource[]   // { channel?, read(fromByte): JobSourceRead }
 *       run(job: JobHandle): JobHooks
 *     }
 *     interface JobHooks { cancel(reason?: string): void; done: Promise<JobOutcome> }
 *     interface JobOutcome { status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }
 *
 * The registry pumps the pull sources it is given into one bounded per-job
 * output ring at its own cadence, so this module never buffers a stream
 * itself: it hands over the process's own offset-based collected readers and
 * lets the ring's retention be the only bound.
 * @module @linxin666/dsh-win-bash/background
 */

import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_SPILL_BYTES, GRACE_MS, SHELL_STDERR_CAPTURE_BYTES, removeShellTempDir } from './shell.ts'

/**
 * Producer kind of every job this plugin starts. It namespaces the ids the
 * registry issues (`win-bash-1`), so a background command from this tool is
 * never confused with the host's own `bash` job in `job_list`.
 */
export const BACKGROUND_JOB_KIND = 'win-bash'

/** One incremental read from a job pull source, as this module produces it. */
export interface JobSourceReadLike {
  /** Text captured since the requested offset. */
  readonly text: string
  /** Whole-stream offset to resume from on the next read. */
  readonly nextOffset: number
  /** True when the requested offset slid out of the source's retained window. */
  readonly lossy: boolean
  /** Host path of a file holding the complete stream, when one is kept. */
  readonly spillPath?: string
}

/** One pull source the registry pumps into a job's output ring. */
export interface JobOutputSourceLike {
  /** Stream label attached to every chunk this source yields. */
  readonly channel?: 'stdout' | 'stderr'
  /** Read everything captured since `fromByte` without consuming it. */
  read(fromByte: number): JobSourceReadLike
}

/** The terminal outcome a producer reports to the registry. */
export interface JobOutcomeLike {
  /** How the job ended. */
  readonly status: 'completed' | 'killed' | 'failed'
  /** Terminal reason rendered into the model's status line. */
  readonly detail?: string
}

/** The producer face the registry hands to the starter. */
export interface JobHandleLike {
  /** The registry-issued id (`<kind>-N`). */
  readonly id: string
  /** Append one chunk to the output ring. */
  append(text: string, options?: { readonly channel?: 'stdout' | 'stderr' | 'log', readonly gapBefore?: true }): void
}

/** The controls the runtime observes producer work through. */
export interface JobHooksLike {
  /** Request termination; synchronous, idempotent, and eventually settles `done`. */
  cancel(reason?: string): void
  /** Resolves after the producer released its resources. */
  readonly done: Promise<JobOutcomeLike>
}

/** One production declaration, as much of it as this plugin uses. */
export interface JobSpecLike {
  /** Producer kind, also the id prefix. */
  kind: string
  /** One-line model-facing label. */
  label: string
  /** Owning session; access to the job is fenced by it. */
  owner?: string
  /** Pull sources the registry pumps into the ring. */
  output?: readonly JobOutputSourceLike[]
  /** Starts the work and synchronously returns its hooks. */
  run(job: JobHandleLike): JobHooksLike
}

/** The one registry method this module consumes. */
export interface JobRegistryLike {
  /** Preflight, then atomically register the work. */
  start(spec: JobSpecLike): string
}

/**
 * One command to run in its own pinned bash process.
 *
 * Both halves of the process contract are supplied by the caller: `argv` is
 * the same pinned payload argv the session's persistent shell uses (this tool
 * never consults PATH, and it refuses restricted sessions outright rather than
 * confining them — see ./tool.ts), and `env` is the same environment.
 */
export interface BackgroundCommand {
  /** The host's managed subprocess seam. */
  readonly subprocess: SubprocessRuntime
  /** The job registry publishing this command's lifecycle. */
  readonly jobs: JobRegistryLike
  /** The owning session id, so the job is collectable by that session alone. */
  readonly owner?: string
  /** The command, exactly as the model wrote it (after any workdir prefix). */
  readonly script: string
  /** The executable and its arguments: the pinned payload bash. */
  readonly argv: readonly string[]
  /** Working directory for the process. */
  readonly cwd: string
  /** Environment entries for the process. */
  readonly env: NodeJS.ProcessEnv
  /**
   * The private temp directory this job owns, when the caller created one (it is
   * the TMP/TEMP/TMPDIR in {@link env}). Reclaimed when the job settles, on every
   * path: the process's own exit, a kill through the hooks, and a starter that
   * never spawned.
   */
  readonly temp?: string
  /** Label shown for this job. */
  readonly label: string
  /** In-memory capture ceiling for stdout, in bytes. */
  readonly stdoutBytes: number
  /** In-memory capture ceiling for stderr, in bytes. */
  readonly stderrBytes: number
}

/** The message of a thrown value, whatever it is. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Map a settled process onto the job-outcome vocabulary.
 *
 * A nonzero command exit is reported, not failed: the model reads the exit
 * code in the job's detail line exactly as it reads one from a foreground
 * call. `killed` is reserved for a process this tool terminated, which is the
 * one case where the work did not reach its own end.
 * @param outcome - the process exit facts.
 * @param failedBeforeStart - the starter's failure, when nothing ran.
 * @param terminated - whether this tool terminated the process.
 * @returns the outcome for the registry.
 */
export function processOutcome(
  outcome: { exitCode: number | null, signal: NodeJS.Signals | null } | undefined,
  failedBeforeStart: string | undefined,
  terminated: boolean,
): JobOutcomeLike {
  if (failedBeforeStart !== undefined) return { status: 'failed', detail: failedBeforeStart }
  if (terminated) {
    return {
      status: 'killed',
      detail: outcome?.signal != null ? 'signal: ' + outcome.signal : 'terminated before exit',
    }
  }
  return { status: 'completed', detail: 'exit code: ' + (outcome?.exitCode ?? 0).toString() }
}

/**
 * Register one command as a background job and return the registry's id.
 *
 * The process is spawned INSIDE the starter, after the registry's own
 * admission: a refused registration (the owner's job limit, no attached
 * controller) therefore leaves no process behind, and this function's caller
 * has nothing to clean up on that path.
 * @param command - the process, its wiring, and the registry to register with.
 * @returns the job id the model collects it by.
 */
export function startBackgroundJob(command: BackgroundCommand): string {
  let process: SubprocessHandle | undefined
  let failedBeforeStart: string | undefined
  let terminated = false

  const source = (channel: 'stdout' | 'stderr'): JobOutputSourceLike => ({
    channel,
    read: (fromByte) => {
      const reader = process?.collected[channel]
      // A read before the spawn yields nothing rather than an error: the
      // registry pumps on its own cadence and may reach a source before the
      // starter has published the process handle.
      if (reader === undefined) return { text: '', nextOffset: fromByte, lossy: false }
      return reader.readFrom(fromByte)
    },
  })

  return command.jobs.start({
    kind: BACKGROUND_JOB_KIND,
    label: command.label,
    ...(command.owner === undefined ? {} : { owner: command.owner }),
    output: [source('stdout'), source('stderr')],
    run: () => {
      try {
        process = command.subprocess.spawn({
          argv: [...command.argv],
          cwd: command.cwd,
          // The batch shape: the command is written to the child's stdin and
          // the descriptor is closed, so this 'bash -s' reads the script and
          // runs it. No frame protocol is involved — a background job has one
          // command and one end, and the process's own exit is that end.
          stdio: {
            stdin: { data: command.script },
            stdout: { maxBytes: command.stdoutBytes, spill: { maxBytes: DEFAULT_SPILL_BYTES } },
            stderr: { maxBytes: command.stderrBytes, spill: { maxBytes: DEFAULT_SPILL_BYTES } },
          },
          graceMs: GRACE_MS,
          env: command.env,
        })
      } catch (error) {
        failedBeforeStart = messageOf(error)
      }
      const spawned = process
      const settled: Promise<JobOutcomeLike> = spawned === undefined
        ? Promise.resolve(processOutcome(undefined, failedBeforeStart, false))
        : spawned.done.then(
            async (outcome) => {
              // The managed range, not just the spawned command, is what the
              // job owns: a command that leaves a child behind must not report
              // settled while that child still runs. A provider that can no
              // longer observe its range must not turn a real exit into a
              // failure, so the wait is contained.
              try {
                await spawned.waitForExit()
              } catch {
                // Nothing left to observe; the exit facts are already known.
              }
              return processOutcome(outcome, undefined, terminated)
            },
            (error: unknown) => {
              failedBeforeStart = messageOf(error)
              return processOutcome(undefined, failedBeforeStart, false)
            },
          )
      // The job owned its private temp directory for exactly as long as it ran.
      // This runs on all three endings - own exit, kill through the hooks, and a
      // starter that never spawned - because each of them leaves the directory
      // with nothing left to use it. A reclaim that fails is contained: the
      // directory is named for this process's pid, so the next start's orphan
      // sweep collects it.
      const done: Promise<JobOutcomeLike> = settled.then(async (outcome) => {
        if (command.temp !== undefined) await removeShellTempDir(command.temp)
        return outcome
      })
      return {
        cancel: () => {
          if (terminated) return
          terminated = true
          process?.terminate()
        },
        done,
      }
    },
  })
}

/** Capture ceilings for one job's streams; exported so the tool and tests agree. */
export const BACKGROUND_STDOUT_BYTES = 4 * 1024 * 1024

/** In-memory stderr ceiling for one background job. */
export const BACKGROUND_STDERR_BYTES = SHELL_STDERR_CAPTURE_BYTES
