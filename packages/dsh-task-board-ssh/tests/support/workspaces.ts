/**
 * The placement strategies a spec mounts instead of the real ones.
 *
 * The engine only ever holds the frozen `SshWorkspaceStrategy` from
 * `src/core/workspace.ts`, so a spec can answer with a strategy of its own: one
 * that hands back a real local directory (so a locally executed run really
 * `cd`s into it) and records what was prepared and collected.
 */
import type { SshWorkspaceStrategyResolver } from '../../src/host/workspace-seam.ts'
import type { SshWorkspaceStrategy } from '../../src/core/workspace.ts'

/** What the fake strategies were asked to do. */
export interface WorkspaceRecorder {
  /** Run ids whose working directory was prepared, in order. */
  prepared: string[]
  /** Run ids whose result was collected, in order. */
  collected: string[]
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
}

/**
 * Build the fake resolver.
 * @param options - the working directory and the failure to inject.
 * @returns the resolver and its record.
 */
export function fakeWorkspaces(options: FakeWorkspaceOptions): FakeWorkspaces {
  const recorder: WorkspaceRecorder = { prepared: [], collected: [] }
  const strategy: SshWorkspaceStrategy = {
    kind: 'in-place',
    async prepare(run) {
      recorder.prepared.push(run.runId)
      if (options.prepareError !== undefined) throw options.prepareError
      return { cwd: options.cwd }
    },
    async collect(run) {
      recorder.collected.push(run.runId)
      return options.branch === undefined ? {} : { branch: options.branch }
    },
  }
  return { resolver: () => strategy, recorder }
}
