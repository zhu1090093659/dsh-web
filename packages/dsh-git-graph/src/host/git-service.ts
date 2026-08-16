/**
 * Host git service: workspace-scoped git operations through a runner seam
 * (production: the subprocess service; tests: a plain child_process runner).
 * Guards mirror ZCode's branchSwitcher semantics — unresolved conflicts,
 * in-progress operations, and branches checked out in another worktree are
 * rejected with stable codes before any mutation.
 * @module dsh-git-graph/host/git-service
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { subprocessRunner as sharedSubprocessRunner, type GitRunResult, type GitRunner } from './git-runner.ts'
import {
  checkRefFormatArgv, classifySwitchFailure, createBranchArgv, forEachRefArgv,
  gitPathArgv, graphLogArgv, headBranchArgv, headShortArgv, operationMarkersArgv,
  OPERATION_MARKERS, statusPorcelainArgv, switchArgv, topLevelArgv, unmergedArgv,
  validateBranchName, verifyRefArgv, worktreeListArgv,
} from '../core/git-command.ts'
import {
  parseBranches, parseGraph, parsePorcelain, parseWorktreeBranches,
  type BranchesView, type GitError, type GraphView, type RepoStatus, type SwitchResult,
} from '../core/types.ts'

/** One finished git invocation (shared runner plumbing). */
export type { GitRunResult, GitRunner } from './git-runner.ts'

/**
 * Build the argv for one git invocation, with the win32 binary variant.
 * Windows ships git as git.exe (git for Windows); a .cmd/.bat shim in PATH
 * would otherwise be the resolution target and Node's spawn cannot launch
 * a .cmd file directly (the dsh-subprocess seam applies no shell). Naming
 * git.exe bypasses any shim and always hits the native executable. cmd.exe
 * routing is deliberately NOT used: several git args carry %-format specs
 * (for-each-ref/log --format) that cmd would expand and corrupt.
 * @param platform - the process platform (process.platform in production; a test seam).
 * @param argv - the git subcommand args.
 * @returns the full spawn argv, starting with the platform git binary.
 */
export function gitSpawnArgv(platform: NodeJS.Platform, argv: readonly string[]): readonly string[] {
  return platform === 'win32' ? ['git.exe', ...argv] : ['git', ...argv]
}

/** The workspace-membership verdict type. */
export type WorkspaceVerdict = { ok: true; canonical: string } | { ok: false; error: GitError }

/**
 * Workspace-membership gate: canonicalize the requested path and require it
 * to equal a registered workspace path (the host's realpath canon). This is
 * the security boundary of the /git routes — the browser may only run git on
 * workspace roots.
 */
export type WorkspaceGate = (path: string) => Promise<WorkspaceVerdict>

/**
 * Production runner over `ctx.subprocess`: shared plumbing with the win32
 * git.exe argv variant.
 * @param ctx - context carrying the subprocess service.
 * @returns the runner.
 */
export function subprocessRunner(ctx: Context): GitRunner {
  return sharedSubprocessRunner(ctx, { spawnArgv: (argv) => gitSpawnArgv(process.platform, argv) })
}

/** HEAD is the symbolic value `git rev-parse --abbrev-ref HEAD` prints when detached. */
const DETACHED = 'HEAD'

/** Rejection for a path outside the workspace registry. */
const WORKSPACE_UNKNOWN: GitError = {
  code: 'workspace-unknown',
  message: 'path is not a registered workspace',
}

/**
 * Workspace-scoped git operations. Every public method first passes the
 * workspace gate, then resolves the repository root from the requested path
 * and rejects non-repositories with `null` (or a rejection for mutations).
 */
export class GitService {
  /**
   * @param runner - the spawn seam.
   * @param gate - workspace-membership gate (host: canonical path ∈ registered workspace paths).
   */
  constructor(
    private readonly runner: GitRunner,
    private readonly gate: WorkspaceGate,
  ) {}

  /** The repository snapshot the branch chip renders; null when not a repository. */
  async status(path: string): Promise<RepoStatus | null> {
    const gated = await this.gate(path)
    if (!gated.ok) return null
    const root = await this.repoRoot(gated.canonical)
    if (root === null) return null
    const [branchResult, headResult, porcelain] = await Promise.all([
      this.runner.run(headBranchArgv(), root),
      this.runner.run(headShortArgv(), root),
      this.runner.run(statusPorcelainArgv(), root),
    ])
    const branch = branchResult.stdout.trim()
    const counts = parsePorcelain(porcelain.stdout)
    return {
      root,
      branch: branch === DETACHED ? '' : branch,
      head: headResult.stdout.trim(),
      dirtyFiles: counts.dirtyFiles,
      untrackedFiles: counts.untrackedFiles,
      conflicts: counts.conflicts,
      operationInProgress: await this.operationInProgress(root),
    }
  }

  /** Local branch list with the current branch marked (git for-each-ref refs/heads). */
  async branches(path: string): Promise<BranchesView | null> {
    const gated = await this.gate(path)
    if (!gated.ok) return null
    const root = await this.repoRoot(gated.canonical)
    if (root === null) return null
    const [refs, branchResult, porcelain] = await Promise.all([
      this.runner.run(forEachRefArgv(), root),
      this.runner.run(headBranchArgv(), root),
      this.runner.run(statusPorcelainArgv(), root),
    ])
    const current = branchResult.stdout.trim()
    const counts = parsePorcelain(porcelain.stdout)
    return {
      root,
      branch: current === DETACHED ? '' : current,
      branches: parseBranches(refs.stdout),
      dirtyFiles: counts.dirtyFiles,
      untrackedFiles: counts.untrackedFiles,
      conflicts: counts.conflicts,
      operationInProgress: await this.operationInProgress(root),
    }
  }

  /**
   * Switch the workspace's checked-out branch: real `git switch --no-guess`
   * on disk, affecting every session in the workspace (never a per-session
   * override). Guards run before the mutation; switch failures classify onto
   * the stable error codes.
   * @param path - workspace root.
   * @param branch - existing local branch name.
   */
  async switchBranch(path: string, branch: string): Promise<SwitchResult> {
    const gated = await this.gate(path)
    if (!gated.ok) return { ok: false, error: WORKSPACE_UNKNOWN }
    const root = await this.repoRoot(gated.canonical)
    if (root === null) return { ok: false, error: { code: 'internal', message: 'not a git repository' } }
    const formatted = await this.runner.run(checkRefFormatArgv(branch), root)
    if (formatted.exitCode !== 0) {
      return { ok: false, error: { code: 'invalid-branch-name', message: formatted.stderr.trim() || 'invalid branch name' } }
    }
    const verified = await this.runner.run(verifyRefArgv(branch), root)
    if (verified.exitCode !== 0) {
      return { ok: false, error: { code: 'target-branch-not-found', message: `branch "${branch}" does not exist locally` } }
    }
    const currentResult = await this.runner.run(headBranchArgv(), root)
    const current = currentResult.stdout.trim()
    if (current === branch) return { ok: true, branch }
    const blocked = await this.guardBlock(root, branch)
    if (blocked !== null) return { ok: false, error: blocked }
    const switched = await this.runner.run(switchArgv(branch), root)
    if (switched.exitCode === 0) return { ok: true, branch }
    return { ok: false, error: classifySwitchFailure(switched.stderr) }
  }

  /**
   * Create a branch from the current HEAD and switch to it
   * (`git switch --no-guess -c <name>`). The authoritative name gate is
   * `git check-ref-format --branch`; duplicates are rejected up front.
   * @param path - workspace root.
   * @param name - proposed branch name.
   */
  async createBranch(path: string, name: string): Promise<SwitchResult> {
    const mirrorReason = validateBranchName(name)
    if (mirrorReason !== null) {
      return { ok: false, error: { code: 'invalid-branch-name', message: `invalid branch name: ${mirrorReason}` } }
    }
    const gated = await this.gate(path)
    if (!gated.ok) return { ok: false, error: WORKSPACE_UNKNOWN }
    const root = await this.repoRoot(gated.canonical)
    if (root === null) return { ok: false, error: { code: 'internal', message: 'not a git repository' } }
    const formatted = await this.runner.run(checkRefFormatArgv(name), root)
    if (formatted.exitCode !== 0) {
      return { ok: false, error: { code: 'invalid-branch-name', message: formatted.stderr.trim() || 'invalid branch name' } }
    }
    const refs = await this.runner.run(forEachRefArgv(), root)
    if (parseBranches(refs.stdout).some(row => row.name === name)) {
      return { ok: false, error: { code: 'branch-already-exists', message: `branch "${name}" already exists` } }
    }
    const blocked = await this.guardBlock(root, undefined)
    if (blocked !== null) return { ok: false, error: blocked }
    const created = await this.runner.run(createBranchArgv(name), root)
    if (created.exitCode === 0) return { ok: true, branch: name }
    return { ok: false, error: classifySwitchFailure(created.stderr) }
  }

  /** Topo-ordered commit graph across branches/tags/remotes (read-only). */
  async graph(path: string, limit = 200): Promise<GraphView | null> {
    const gated = await this.gate(path)
    if (!gated.ok) return null
    const root = await this.repoRoot(gated.canonical)
    if (root === null) return null
    const [logResult, branchResult] = await Promise.all([
      this.runner.run(graphLogArgv(limit + 1), root),
      this.runner.run(headBranchArgv(), root),
    ])
    const commits = parseGraph(logResult.stdout)
    const hasMore = commits.length > limit
    const branch = branchResult.stdout.trim()
    return {
      root,
      branch: branch === DETACHED ? '' : branch,
      commits: hasMore ? commits.slice(0, limit) : commits,
      hasMore,
    }
  }

  /** Repository root of a canonical path, or null when not inside a git repository. */
  private async repoRoot(path: string): Promise<string | null> {
    const result = await this.runner.run(topLevelArgv(), path)
    if (result.exitCode !== 0) return null
    const root = result.stdout.trim()
    return root === '' ? null : root
  }

  /** Whether any git operation marker is present in the repository. */
  private async operationInProgress(root: string): Promise<boolean> {
    // Preferred path: one spawn for all seven markers (Windows: 7 git.exe
    // cold starts -> 1). --git-path prints a repo-relative path for in-repo
    // markers (and an absolute one for worktree/linked stores); resolve
    // covers both.
    const resolved = await this.runner.run(operationMarkersArgv(), root)
    if (resolved.exitCode === 0) {
      const markerPaths = resolved.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
      return markerPaths.some((markerPath) => existsSync(resolve(root, markerPath)))
    }
    // Non-zero combined exit: fall back to the per-marker sequential probe
    // (same as the pre-merge implementation) so a single failed rev-parse
    // cannot silently hide an in-progress operation. Every marker is probed
    // and the verdict is true when any path exists; all-missing returns false.
    let inProgress = false
    for (const marker of OPERATION_MARKERS) {
      const single = await this.runner.run(gitPathArgv(marker), root)
      const markerPath = single.stdout.trim()
      if (markerPath !== '' && existsSync(resolve(root, markerPath))) inProgress = true
    }
    return inProgress
  }

  /**
   * The pre-switch guards (ZCode branchSwitcher semantics): unresolved
   * conflicts, in-progress operations, and a target already checked out in
   * another worktree.
   * @param root - repository root.
   * @param target - target branch; undefined for create (worktree check skipped).
   * @returns the rejection, or null when the switch may proceed.
   */
  private async guardBlock(root: string, target: string | undefined): Promise<GitError | null> {
    const [conflicts, inProgress, worktrees] = await Promise.all([
      this.runner.run(unmergedArgv(), root),
      this.operationInProgress(root),
      target === undefined ? Promise.resolve(null) : this.runner.run(worktreeListArgv(), root),
    ])
    const conflictCount = conflicts.stdout.split('\n').filter(line => line !== '').length
    if (conflictCount > 0) {
      return { code: 'conflicts-present', message: `repository has ${conflictCount} unresolved conflict(s)` }
    }
    if (inProgress) {
      return { code: 'operation-in-progress', message: 'a git operation is in progress' }
    }
    if (target !== undefined && worktrees !== null && parseWorktreeBranches(worktrees.stdout).includes(target)) {
      return { code: 'branch-in-other-worktree', message: `branch "${target}" is checked out in another worktree` }
    }
    return null
  }
}
