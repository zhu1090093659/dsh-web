/**
 * The frozen workspace-strategy interface.
 *
 * One interface covers the three user-visible placement modes the proposal
 * settled: an existing remote directory (`in-place`) and a per-run git
 * worktree whose repository is either a URL the host can reach or the local
 * workspace repository sent as a bundle (`git`). The host engine drives it;
 * this module is the seam only, so the two strategies and the engine can be
 * written against one shape.
 *
 * A strategy never decides policy: it receives the run, prepares a directory,
 * and collects the result. Failures are thrown and recorded by the caller,
 * because a workspace that cannot be prepared must fail the run before any
 * agent starts.
 *
 * @module dsh-task-board-ssh/core/workspace
 */
import type { DshSshService } from './contract.ts'
import type { SshGitSource, SshWorkspaceKind } from './target.ts'

/** Everything a strategy needs about one run. */
export interface SshWorkspaceRun {
  /** Run identifier; also the branch suffix of a git worktree. */
  runId: string
  /** `dshSsh` host alias the run addresses. */
  host: string
  /** Absolute remote state directory the provider owns on that host. */
  stateDir: string
  /** The host face every remote operation goes through. */
  ssh: DshSshService
  /** Repository source, present for the git mode. */
  source?: SshGitSource
  /** Local repository root, present when `source` is the workspace repository. */
  localRepository?: string
  /**
   * Earlier run id whose git worktree/branch this follow-up/rework run reuses
   * so prior commits stay in place and cwd-scoped sessions (e.g. Claude Code)
   * can resume cleanly.
   */
  reuseWorktreeRunId?: string
  /** Aborts a transfer or a remote command. */
  signal?: AbortSignal
}

/** What preparing a run produced. */
export interface SshWorkspacePreparation {
  /** Absolute remote directory the agent CLI runs in. */
  cwd: string
}

/** What collecting a run produced. */
export interface SshWorkspaceCollection {
  /** Branch carrying the run's commits, when the strategy brings work back as one. */
  branch?: string
}

/** One placement mechanism. */
export interface SshWorkspaceStrategy {
  /** Which mechanism this is; matches `SshWorkspaceTarget.kind`. */
  readonly kind: SshWorkspaceKind
  /**
   * Make the run's working directory exist and return it.
   * @param run - the run being prepared.
   * @returns the absolute remote directory the agent runs in.
   */
  prepare(run: SshWorkspaceRun): Promise<SshWorkspacePreparation>
  /**
   * Bring back whatever the run produced.
   * @param run - the settled run.
   * @returns the branch that carries the result, when there is one.
   */
  collect(run: SshWorkspaceRun): Promise<SshWorkspaceCollection>
  /**
   * Optional cleanup invoked when a card is deleted (removes worktrees/refs).
   * @param run - run whose workspace resources should be reclaimed.
   */
  cleanup?(run: SshWorkspaceRun): Promise<void>
}
