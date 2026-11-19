/**
 * The per-run git worktree, and the two places its repository comes from.
 *
 * One mechanism covers both user modes: a bare cache on the host holds the
 * objects, each run gets its own worktree on branch `dsh-task/<runId>`, a ref
 * pins the commit that branch started from, and `collect` publishes whatever
 * the run added on top. A url source fetches the branches from a repository the
 * host can reach and pushes the run's branch back to it; a workspace source
 * receives the local repository as a bundle and brings the branch back the same
 * way, through `dshSsh` rather than through system `ssh`, so the run uses the
 * credentials and jump hosts the user already configured.
 *
 * Every step is derived from the run, so `prepare` is idempotent on `runId` and
 * `collect` can run in a later process — after the local host was offline — and
 * still find the worktree, the branch and the base commit it left behind.
 *
 * @module dsh-task-board-ssh/host/workspace/git
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shellEnsureDir } from '../../core/shell.ts'
import type { SshGitSource } from '../../core/target.ts'
import type { SshWorkspaceCollection, SshWorkspaceRun } from '../../core/workspace.ts'
import { SshWorkspaceError, boundedLine } from './errors.ts'
import { gitWorkspaceLayout, type GitWorkspaceLayout } from './layout.ts'
import { countUntrackedFiles, createWorkspaceBundle, fetchRunBranch } from './local-git.ts'
import {
  addWorktreeCommand,
  attachWorktreeCommand,
  branchProbeCommand,
  bundleResultCommand,
  countRunCommitsCommand,
  fetchBundleCommand,
  fetchUrlCommand,
  pinBaseCommand,
  prepareCacheCommand,
  preparedProbeCommand,
  pushBranchCommand,
  remoteStartRef,
} from './remote-git.ts'
import {
  downloadFromHost,
  execRemoteChecked,
  probeRemote,
  removeRemoteFile,
  uploadToHost,
} from './remote.ts'
import type { SshWorkspacePreparationNote, SshWorkspaceStrategyWithNote } from './types.ts'

/** A repository the host reaches by URL. */
type UrlSource = Extract<SshGitSource, { kind: 'url' }>

/** The local workspace repository, sent as a bundle. */
type WorkspaceSource = Extract<SshGitSource, { kind: 'workspace' }>

/** Prefix of every local scratch directory, so a leaked one is attributable. */
const SCRATCH_PREFIX = 'dsh-task-board-ssh-'

/**
 * The git mechanism's shared state machine.
 *
 * A subclass only answers where the cache's start commit comes from and where
 * `collect` publishes the branch; the cache, the worktree, the base ref and the
 * "did the run commit anything" question are the same for both sources.
 */
abstract class GitWorkspaceStrategyBase implements SshWorkspaceStrategyWithNote {
  readonly kind = 'git' as const

  /** What makes this repository source unique on one host. */
  private readonly sourceIdentity: string

  /**
   * @param sourceIdentity - cache key identity of the pinned source.
   */
  protected constructor(sourceIdentity: string) {
    this.sourceIdentity = sourceIdentity
  }

  /**
   * Make the run's worktree exist on its branch, or confirm it already does.
   * @param run - the run being prepared.
   * @returns the worktree path, plus the source's note when it has one.
   * @throws SshWorkspaceError when the host, the source or git refused.
   */
  async prepare(run: SshWorkspaceRun): Promise<SshWorkspacePreparationNote> {
    const layout = gitWorkspaceLayout(run, this.sourceIdentity)
    const note = await this.sourceNote(run)
    if (await probeRemote(run, preparedProbeCommand(layout))) return { cwd: layout.worktreeDir, ...note }
    await execRemoteChecked(run, prepareCacheCommand(layout), 'preparing the repository cache')
    if (await probeRemote(run, branchProbeCommand(layout))) {
      // The branch outlived its directory; re-attach it instead of resetting it,
      // because the commits it carries are the run's work.
      await execRemoteChecked(run, attachWorktreeCommand(layout), `re-attaching the worktree of ${layout.branch}`)
    } else {
      const start = await this.seed(run, layout)
      await execRemoteChecked(run, addWorktreeCommand(layout, start), `creating the worktree of ${layout.branch}`)
    }
    return { cwd: layout.worktreeDir, ...note }
  }

  /**
   * Bring the run's branch back, when the run committed anything.
   * @param run - the settled run.
   * @returns the branch that carries the result, or nothing when there is none.
   * @throws SshWorkspaceError when no workspace was prepared or publishing failed.
   */
  async collect(run: SshWorkspaceRun): Promise<SshWorkspaceCollection> {
    const layout = gitWorkspaceLayout(run, this.sourceIdentity)
    if (!(await probeRemote(run, branchProbeCommand(layout)))) {
      throw new SshWorkspaceError(`this run has no prepared git workspace on ${run.host}: ${layout.branch}`)
    }
    if ((await this.countRunCommits(run, layout)) === 0) return {}
    await this.publish(run, layout)
    return { branch: layout.branch }
  }

  /**
   * Put the repository in the cache and pin the commit the branch starts from.
   * @param run - the run being prepared.
   * @param layout - the run's paths.
   * @returns the ref or commit `git worktree add` branches from.
   */
  protected abstract seed(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<string>

  /**
   * Publish the run branch where this source keeps its results.
   * @param run - the settled run.
   * @param layout - the run's paths.
   */
  protected abstract publish(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<void>

  /**
   * Describe what the source did not send, for the card to explain.
   * @param run - the run being prepared.
   * @returns the note to merge into the preparation; nothing by default.
   */
  protected async sourceNote(_run: SshWorkspaceRun): Promise<{ untrackedFiles?: number }> {
    return {}
  }

  /**
   * Read how many commits the run branch carries past the commit it started from.
   * @param run - the run being collected.
   * @param layout - the run's paths.
   * @returns the commit count.
   * @throws SshWorkspaceError when the count could not be read as one.
   */
  private async countRunCommits(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<number> {
    const what = `reading the commits of ${layout.branch}`
    const result = await execRemoteChecked(run, countRunCommitsCommand(layout), what)
    const text = result.stdout.trim()
    if (!/^\d+$/.test(text)) {
      throw new SshWorkspaceError(`${what} returned no count: ${boundedLine(result.stdout) ?? 'empty output'}`)
    }
    return Number(text)
  }
}

/** A repository the host clones for itself; the run's branch is pushed back. */
export class GitUrlWorkspaceStrategy extends GitWorkspaceStrategyBase {
  /** The pinned url source. */
  private readonly source: UrlSource

  /**
   * @param source - repository URL the host can reach, and its optional base.
   */
  constructor(source: UrlSource) {
    super(`url:${source.url}`)
    this.source = source
  }

  protected async seed(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<string> {
    const startRef = remoteStartRef(this.source)
    await execRemoteChecked(run, fetchUrlCommand(layout, this.source.url), `fetching ${this.source.url}`)
    await execRemoteChecked(run, pinBaseCommand(layout, startRef), `pinning the base of ${layout.branch}`)
    return startRef
  }

  protected async publish(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<void> {
    const what = `pushing ${layout.branch} to ${this.source.url}`
    await execRemoteChecked(run, pushBranchCommand(layout, this.source.url), what)
  }
}

/** The local workspace repository, sent as a bundle and fetched back as one. */
export class GitWorkspaceSourceStrategy extends GitWorkspaceStrategyBase {
  /** The pinned workspace source. */
  private readonly source: WorkspaceSource

  /**
   * @param source - workspace whose local repository the run starts from.
   */
  constructor(source: WorkspaceSource) {
    super(`workspace:${source.workspaceId}`)
    this.source = source
  }

  protected async sourceNote(run: SshWorkspaceRun): Promise<{ untrackedFiles: number }> {
    return { untrackedFiles: await countUntrackedFiles(this.requireRepository(run), run.signal) }
  }

  protected async seed(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<string> {
    const repository = this.requireRepository(run)
    const scratch = await mkdtemp(join(tmpdir(), `${SCRATCH_PREFIX}${layout.runId}-`))
    try {
      const bundlePath = join(scratch, 'workspace.bundle')
      const snapshot = await createWorkspaceBundle({ repository, bundlePath, signal: run.signal })
      const remoteBundle = `${layout.bundlesDir}/${layout.runId}.bundle`
      await execRemoteChecked(run, shellEnsureDir(layout.bundlesDir), 'creating the bundle directory')
      await uploadToHost(run, bundlePath, remoteBundle)
      try {
        await execRemoteChecked(run, fetchBundleCommand(layout, remoteBundle), 'sending the workspace bundle')
        await execRemoteChecked(run, pinBaseCommand(layout, snapshot.base), `pinning the base of ${layout.branch}`)
      } finally {
        await removeRemoteFile(run, remoteBundle)
      }
      return snapshot.base
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  protected async publish(run: SshWorkspaceRun, layout: GitWorkspaceLayout): Promise<void> {
    const repository = this.requireRepository(run)
    const remoteBundle = `${layout.bundlesDir}/${layout.runId}-result.bundle`
    const scratch = await mkdtemp(join(tmpdir(), `${SCRATCH_PREFIX}${layout.runId}-`))
    try {
      const bundlePath = join(scratch, 'result.bundle')
      await execRemoteChecked(run, bundleResultCommand(layout, remoteBundle), `bundling ${layout.branch}`)
      try {
        await downloadFromHost(run, remoteBundle, bundlePath)
        await fetchRunBranch({ repository, bundlePath, branchRef: layout.branchRef, signal: run.signal })
      } finally {
        await removeRemoteFile(run, remoteBundle)
      }
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  /**
   * Read the local repository the run starts from.
   * @param run - the run being served.
   * @returns the absolute local repository root.
   * @throws SshWorkspaceError when the run carries no resolved repository.
   */
  private requireRepository(run: SshWorkspaceRun): string {
    const repository = run.localRepository
    if (repository === undefined || repository === '') {
      throw new SshWorkspaceError(
        `the workspace repository of ${this.source.workspaceId} was not resolved for this run`,
      )
    }
    return repository
  }
}
