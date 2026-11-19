/**
 * Where one git run lives on the remote host, derived from the run alone.
 *
 * Nothing in here is persisted: every path and ref is recomputed from the run's
 * `stateDir` and `runId`, which is what lets `collect` run in a later process
 * than `prepare` and still find the same worktree, branch and base commit. A
 * bare cache is shared by every run of one source on one host, so a second run
 * of the same repository transfers only the commits it does not already have.
 *
 * @module dsh-task-board-ssh/host/workspace/layout
 */
import { createHash } from 'node:crypto'
import { isRunId } from '../../core/launcher.ts'
import type { SshWorkspaceRun } from '../../core/workspace.ts'
import { SshWorkspaceError } from './errors.ts'

/** Branch prefix every git run commits on: `dsh-task/<runId>`. */
export const RUN_BRANCH_PREFIX = 'dsh-task/'

/** Ref namespace recording the commit a run's branch started from. */
const BASE_REF_PREFIX = 'refs/dsh-base/'

/** Length of a cache directory's digest, in hex characters. */
const CACHE_KEY_LENGTH = 16

/** A run id shape git refuses in a ref, on top of the launcher's grammar. */
const REF_UNSAFE_RUN_ID = /\.\.|\.lock$|^\.|\.$/

/** Paths and refs one git run uses. */
export interface GitWorkspaceLayout {
  /** Absolute remote state directory the provider owns on the host. */
  stateDir: string
  /** Run identifier every derived name carries. */
  runId: string
  /** Directory holding one bare cache per repository source. */
  reposDir: string
  /** Bare cache of this run's repository. */
  cacheDir: string
  /** Directory holding one worktree per run. */
  workspacesDir: string
  /** Worktree the agent works in. */
  worktreeDir: string
  /** Directory bundles travel through. */
  bundlesDir: string
  /** Branch name the run commits on. */
  branch: string
  /** Full ref of {@link branch}. */
  branchRef: string
  /** Ref pinning the commit the branch started from. */
  baseRef: string
}

/**
 * Short digest of one repository's identity, used as its cache directory name.
 *
 * A digest rather than the URL itself: a clone URL may carry credentials, and
 * a path or a workspace id may carry characters a directory name should not.
 * @param identity - what makes the source unique on this host.
 * @returns sixteen lower-case hex characters.
 */
export function cacheKey(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, CACHE_KEY_LENGTH)
}

/**
 * Refuse a run id that cannot be a git ref component.
 *
 * The launcher's grammar already bounds the characters; git additionally
 * refuses `..`, a leading or trailing dot and a `.lock` suffix, and a run id
 * that reached `git worktree add` with one of those would fail far from here.
 * @param runId - candidate run identifier.
 * @returns the run id, unchanged.
 * @throws SshWorkspaceError when git could not name a branch after it.
 */
export function assertRefSafeRunId(runId: string): string {
  if (!isRunId(runId)) throw new SshWorkspaceError(`invalid run id: ${runId}`)
  if (REF_UNSAFE_RUN_ID.test(runId)) {
    throw new SshWorkspaceError(`the run id cannot name a git branch: ${runId}`)
  }
  return runId
}

/**
 * Require one absolute remote directory, without its trailing slashes.
 * @param path - candidate directory.
 * @param what - which directory it is, for the diagnostic.
 * @returns the path with trailing slashes removed.
 * @throws SshWorkspaceError when the path is relative or is the filesystem root.
 */
export function assertRemoteDirectory(path: string, what: string): string {
  if (!path.startsWith('/')) throw new SshWorkspaceError(`${what} must be an absolute remote path: ${path}`)
  const trimmed = path.replace(/\/+$/, '')
  if (trimmed === '') throw new SshWorkspaceError(`${what} cannot be the filesystem root`)
  return trimmed
}

/**
 * Derive every path and ref one git run uses.
 * @param run - the run being prepared or collected.
 * @param sourceIdentity - what makes the repository source unique on this host.
 * @returns the run's layout.
 * @throws SshWorkspaceError when the run carries a path or id git cannot use.
 */
export function gitWorkspaceLayout(run: SshWorkspaceRun, sourceIdentity: string): GitWorkspaceLayout {
  const stateDir = assertRemoteDirectory(run.stateDir, 'the remote state directory')
  const runId = assertRefSafeRunId(run.runId)
  const branch = `${RUN_BRANCH_PREFIX}${runId}`
  const reposDir = `${stateDir}/repos`
  const workspacesDir = `${stateDir}/workspaces`
  return {
    stateDir,
    runId,
    reposDir,
    cacheDir: `${reposDir}/${cacheKey(sourceIdentity)}`,
    workspacesDir,
    worktreeDir: `${workspacesDir}/${runId}`,
    bundlesDir: `${stateDir}/bundles`,
    branch,
    branchRef: `refs/heads/${branch}`,
    baseRef: `${BASE_REF_PREFIX}${runId}`,
  }
}
