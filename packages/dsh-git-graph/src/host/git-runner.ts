/**
 * Host git subprocess plumbing: the run result shape, the runner seam, the
 * collected-output cap, and the production runner over the subprocess service.
 * dsh-git-graph is its only consumer and therefore its owner: this file stopped
 * being a synced copy when the single-consumer shared modules were consolidated,
 * so edit it here rather than looking for a source under shared/.
 *
 * The context shape is declared structurally so this module stays
 * self-contained (no cordis dependency): any context whose `subprocess`
 * satisfies SubprocessServiceLike works, which the plugin contexts do.
 * @module dsh-git-graph/host/git-runner
 */

/** One finished git invocation. */
export interface GitRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** The spawn seam the service runs git through (subprocess service in production). */
export interface GitRunner {
  run(argv: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRunResult>
}

/** Collected-output cap for one git command. */
export const OUTPUT_CAP_BYTES = 1 << 20

/**
 * The locale every git child runs under. The write verbs classify a failed
 * command by reading git's own message prose (the overwrite guard in
 * `core/git-command.ts`), and git localizes that prose to the host locale:
 * on a zh_CN host a real untracked-overwrite refusal arrives as Chinese text,
 * matches no pattern and is reported as `internal`, so the user loses the
 * specific guard message on exactly the machines that need it. Pinning the
 * child to C keeps those messages the strings the patterns were written
 * against, on every host. It is a deliberate exception to the service's
 * ambient environment, not a general locale policy for the plugin.
 */
export const GIT_CHILD_ENV: Record<string, string> = { LC_ALL: 'C', LANG: 'C' }

/** The subprocess service surface this runner consumes (structural). */
export interface SubprocessServiceLike {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: 'ignore'
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal?: AbortSignal
    /** Explicit environment merged onto the provider's scrubbed parent base. */
    env?: Record<string, string> | undefined
  }): {
    done: Promise<{ exitCode: number | null }>
    collected: {
      stdout?: { readFrom(offset: number): { text: string } }
      stderr?: { readFrom(offset: number): { text: string } }
    }
  }
}

/** Per-package knobs for the shared production runner. */
export interface GitRunnerOptions {
  /** Build the full spawn argv from the git args (default ['git', ...argv]). */
  spawnArgv?: (argv: readonly string[]) => readonly string[]
  /** degrade turns spawn/run failures into exitCode 127 results instead of throwing. */
  failureMode?: 'throw' | 'degrade'
  /** console.error tag for degrade mode. */
  errorTag?: string
}

/**
 * Production runner over the subprocess service: one managed child per
 * command, bounded collect on both streams. A caller-owned AbortSignal reaches
 * the subprocess tree and remains authoritative even in degrade mode. Degrade
 * mode keeps the SCM tab showing the friendly "not a git repository" state
 * instead of a bare 400 when git is missing or the subprocess service fails.
 * @param ctx - context carrying the subprocess service.
 * @param options - per-package behavior knobs.
 * @returns the runner.
 */
export function subprocessRunner(ctx: { subprocess: SubprocessServiceLike }, options: GitRunnerOptions = {}): GitRunner {
  const spawnArgv = options.spawnArgv ?? ((argv) => ['git', ...argv])
  const degrade = options.failureMode === 'degrade'
  const errorTag = options.errorTag ?? 'git'
  const failure = (prefix: string, error: unknown): GitRunResult => ({
    exitCode: 127,
    stdout: '',
    stderr: prefix + (error instanceof Error ? error.message : String(error)),
  })
  return {
    async run(argv, cwd, signal) {
      signal?.throwIfAborted()
      const spec = {
        argv: spawnArgv(argv),
        cwd,
        stdio: {
          stdin: 'ignore' as const,
          stdout: { maxBytes: OUTPUT_CAP_BYTES },
          stderr: { maxBytes: OUTPUT_CAP_BYTES },
        },
        graceMs: 10_000,
        signal,
        env: GIT_CHILD_ENV,
      }
      if (degrade) {
        let handle
        try {
          handle = ctx.subprocess.spawn(spec)
        } catch (error) {
          signal?.throwIfAborted()
          console.error('[' + errorTag + '] git spawn failed:', error)
          return failure('git: spawn failed: ', error)
        }
        try {
          const outcome = await handle.done
          signal?.throwIfAborted()
          const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
          const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
          return { exitCode: outcome.exitCode, stdout, stderr }
        } catch (error) {
          signal?.throwIfAborted()
          console.error('[' + errorTag + '] git run failed:', error)
          return failure('git: run failed: ', error)
        }
      }
      const handle = ctx.subprocess.spawn(spec)
      const outcome = await handle.done
      signal?.throwIfAborted()
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      return { exitCode: outcome.exitCode, stdout, stderr }
    },
  }
}
