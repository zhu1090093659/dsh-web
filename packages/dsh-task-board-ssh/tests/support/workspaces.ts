/**
 * The placement strategies a spec mounts instead of the real ones.
 *
 * The engine only ever holds the frozen `SshWorkspaceStrategy` from
 * `src/core/workspace.ts`, so a spec can answer with a strategy of its own: one
 * that hands back a real local directory (so a locally executed run really
 * `cd`s into it), reports whatever note the case needs, and records what it was
 * asked to do — including the run it received, which is how a case proves the
 * repository a deployment resolved reached the strategy.
 */
import type { SshWorkspaceStrategyResolver } from '../../src/host/workspace-seam.ts'
import type { SshWorkspaceRun } from '../../src/core/workspace.ts'

/** What the fake strategies were asked to do. */
export interface WorkspaceRecorder {
  /** Run ids whose working directory was prepared, in order. */
  prepared: string[]
  /** Run ids whose result was collected, in order. */
  collected: string[]
  /** Run ids whose workspace was cleaned up, in order. */
  cleaned: string[]
  /** Every run handed to `prepare`, in order. */
  runs: SshWorkspaceRun[]
}

/** The resolver a spec mounts, plus its record. */
export interface FakeWorkspaces {
  resolver: SshWorkspaceStrategyResolver
  recorder: WorkspaceRecorder
}

/** How the fake strategies behave. */
export interface FakeWorkspaceOptions {
  /** Absolute local directory every run works in. */
  cwd: string
  /** Branch `collect` reports, when a run should bring one back. */
  branch?: string
  /** Failure the next `prepare` throws, to prove a run fails before any agent starts. */
  prepareError?: Error
  /** Failure `collect` throws, to prove a failed branch push/fetch settles the run as failed. */
  collectError?: Error
  /** Hook awaited inside `prepare`, for deterministic race testing. */
  onPrepare?: (run: SshWorkspaceRun) => Promise<void>
  /** Hook awaited inside `collect`, for deterministic race testing. */
  onCollect?: (run: SshWorkspaceRun) => Promise<void>
  /** Untracked local files the run did not receive, as a real strategy reports them. */
  untrackedFiles?: number
}

/** The frozen strategy, with the untracked-file note a real one may add. */
interface FakeStrategy {
  readonly kind: 'in-place'
  prepare(run: SshWorkspaceRun): Promise<{ cwd: string; untrackedFiles?: number }>
  collect(run: SshWorkspaceRun): Promise<{ branch?: string }>
  cleanup(run: SshWorkspaceRun): Promise<void>
}

/**
 * Build the fake resolver.
 * @param options - the working directory, the note and the failure to inject.
 * @returns the resolver and its record.
 */
export function fakeWorkspaces(options: FakeWorkspaceOptions): FakeWorkspaces {
  const recorder: WorkspaceRecorder = { prepared: [], collected: [], cleaned: [], runs: [] }
  const strategy: FakeStrategy = {
    kind: 'in-place',
    async prepare(run) {
      recorder.prepared.push(run.runId)
      recorder.runs.push(run)
      if (options.onPrepare !== undefined) await options.onPrepare(run)
      if (options.prepareError !== undefined) throw options.prepareError
      return options.untrackedFiles === undefined
        ? { cwd: options.cwd }
        : { cwd: options.cwd, untrackedFiles: options.untrackedFiles }
    },
    async collect(run) {
      recorder.collected.push(run.runId)
      if (options.onCollect !== undefined) await options.onCollect(run)
      if (options.collectError !== undefined) throw options.collectError
      return options.branch === undefined ? {} : { branch: options.branch }
    },
    async cleanup(run) {
      recorder.cleaned.push(run.runId)
    },
  }
  return { resolver: () => strategy, recorder }
}
