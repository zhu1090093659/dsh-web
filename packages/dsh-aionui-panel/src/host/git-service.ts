/**
 * Host git service for the SCM tab: working-tree status (porcelain v1, -z),
 * stage/unstage/discard batches, all scoped to the gated project root and
 * executed through the managed subprocess seam. Parsing is pure and exported
 * for tests; the service only wraps the runner. Discard never touches the
 * staged side (the index is only ever rewritten by stage/unstage), matching
 * the "discard = worktree side" contract.
 * @module dsh-aionui-panel/host/git-service
 */

import { join, relative } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { subprocessRunner as sharedSubprocessRunner, type GitRunResult, type GitRunner } from './git-runner.ts'
import type { GitBatchResult, GitChangeRow, GitFileState, GitStatusView, PanelError } from '../core/types.ts'
import { isPathInside, type WorkspaceGate } from './gate.ts'

/** One finished git invocation (shared runner plumbing). */
export type { GitRunResult, GitRunner } from './git-runner.ts'

/** TTL for a positive repo-top-level verdict. */
const REPO_CACHE_TTL_MS = 60_000
/** TTL for a negative (null) repo-top-level verdict. */
const NO_REPO_CACHE_TTL_MS = 30_000

/** Production runner over `ctx.subprocess`: shared plumbing, degrade mode for the SCM tab. */
export function subprocessRunner(ctx: Context): GitRunner {
  return sharedSubprocessRunner(ctx, { failureMode: 'degrade', errorTag: 'dsh-aionui-panel' })
}

/** Map one porcelain letter to the row state (unknown letters stay unknown). */
export function porcelainState(letter: string): GitFileState {
  switch (letter) {
    case 'A': return 'created'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'created'
    case 'U': return 'conflicted'
    case '?': return 'untracked'
    default: return 'unknown'
  }
}

/**
 * Parse `git status --porcelain=v1 -z` output into staged/unstaged/untracked
 * rows. With -z every entry is NUL-terminated; rename entries carry two paths
 * (old and new). Pure — exported for tests.
 * @param output - raw porcelain v1 -z output.
 * @returns the three change groups.
 */
export function parsePorcelain(output: string): {
  staged: GitChangeRow[]
  unstaged: GitChangeRow[]
  untracked: GitChangeRow[]
} {
  const staged: GitChangeRow[] = []
  const unstaged: GitChangeRow[] = []
  const untracked: GitChangeRow[] = []
  if (output === '') return { staged, unstaged, untracked }
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (field === '') continue
    const x = field[0] ?? ' '
    const y = field[1] ?? ' '
    const path = field.slice(3)
    if (x === '?' && y === '?') {
      untracked.push({ path, state: 'untracked', staged: false })
      continue
    }
    if (x === 'R' || x === 'C') {
      // -z rename entries: XY old\0new — the path field holds the old path.
      const oldPath = path
      const newPath = fields[i + 1] ?? oldPath
      i += 1
      staged.push({ path: newPath, oldPath, state: porcelainState(x), staged: true })
      if (y !== ' ') {
        unstaged.push({ path: newPath, oldPath, state: porcelainState(y), staged: false })
      }
      continue
    }
    if (x !== ' ') {
      staged.push({ path, state: porcelainState(x), staged: true })
    }
    if (y !== ' ') {
      unstaged.push({ path, state: porcelainState(y), staged: false })
    }
  }
  return { staged, unstaged, untracked }
}

/** Parse the porcelain row set into the status view shape. */
export function parseStatusView(root: string, branch: string, output: string): GitStatusView {
  const { staged, unstaged, untracked } = parsePorcelain(output)
  return { root, branch, staged, unstaged, untracked }
}

/** The not-a-repository verdict for status reads. */
const NO_REPO: PanelError = { code: 'git-unavailable', message: 'not a git repository' }

/**
 * Workspace-scoped git operations. Gated methods pass the gate, resolve the
 * repository root, and reject non-repositories with a stable error; the
 * `Canonical` variants trust an already-gated canonical root (the SSE poll)
 * and skip the gate.
 * @param runner - the spawn seam.
 * @param gate - workspace-membership gate.
 * @param fsDelete - delete seam for untracked discard (host: FsService.delete).
 */
export class GitService {
  constructor(
    private readonly runner: GitRunner,
    private readonly gate: WorkspaceGate,
    private readonly fsDelete: (root: string, rel: string) => Promise<{ ok: true } | PanelError>,
  ) {}

  /** Cached git-binary probe; an aborted attempt is cleared so it can retry. */
  private availablePromise: Promise<boolean> | undefined

  /**
   * Cached repo-top-level resolution per canonical workspace, with a TTL so
   * running `git init` (positive self-heal) or deleting `.git` (negative
   * self-heal) is discovered by a later probe. Positive verdicts live 60s,
   * negative (null) verdicts 30s; exitCode 127 is never cached because it
   * means spawn/run failed rather than "not a repository".
   */
  private readonly repoCache = new Map<string, { value: Promise<string | null>; expiresAt: number }>()

  /** One complete direct status request per requested workspace root. */
  private readonly statusRequests = new Map<string, Promise<GitStatusView | null | PanelError>>()

  /** One underlying status scan per canonical workspace, even after a caller times out. */
  private readonly statusRuns = new Map<string, Promise<GitStatusView>>()

  /**
   * Probe the git binary once (git --version) and cache the verdict for the
   * service lifetime. A machine without git then degrades every operation to
   * the stable "not a git repository" state after a single failed spawn,
   * instead of re-spawning ENOENT on every poll tick. The cache stays false
   * even if git is installed later; the host restart picks it up.
   */
  gitAvailable(signal?: AbortSignal): Promise<boolean> {
    if (this.availablePromise === undefined) {
      let cached: Promise<boolean>
      cached = this.runner
        .run(['--version'], '/', signal)
        .then((result) => result.exitCode === 0)
        .catch((error: unknown) => {
          if (signal?.aborted) {
            if (this.availablePromise === cached) this.availablePromise = undefined
            signal.throwIfAborted()
            throw error
          }
          return false
        })
      this.availablePromise = cached
    }
    return this.availablePromise
  }

  /**
   * Resolve the repo top-level for one canonical root. Verdicts are cached
   * with a TTL: a positive repo path for 60s, a negative null for 30s. After
   * expiry the next call re-runs `rev-parse --show-toplevel`, so a repo
   * created or removed while the host is running is picked up later. An
   * exitCode 127 means the spawn/run itself failed; it returns null but is
   * deliberately not cached so the next call retries. Any other failure is
   * cached as a negative verdict for its TTL.
   */
  private repoOf(root: string, signal?: AbortSignal): Promise<string | null> {
    const now = Date.now()
    const cached = this.repoCache.get(root)
    if (cached !== undefined && cached.expiresAt > now) return cached.value
    // Infinity while the probe is in flight: concurrent callers share the
    // same promise, and the real TTL is stamped once the verdict settles.
    const entry: { value: Promise<string | null>; expiresAt: number } = {
      value: Promise.resolve(null),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    entry.value = this.run(['rev-parse', '--show-toplevel'], root, signal)
      .then((result) => {
        if (result.exitCode === 127) {
          // Spawn/run failure is not a repo verdict: leave nothing cached.
          if (this.repoCache.get(root) === entry) this.repoCache.delete(root)
          return null
        }
        if (result.exitCode !== 0) {
          entry.expiresAt = now + NO_REPO_CACHE_TTL_MS
          return null
        }
        const repo = result.stdout.trim()
        const found = repo !== '' && isPathInside(repo, root) ? repo : null
        entry.expiresAt = now + (found === null ? NO_REPO_CACHE_TTL_MS : REPO_CACHE_TTL_MS)
        return found
      })
      .catch((error: unknown) => {
        if (signal?.aborted) {
          if (this.repoCache.get(root) === entry) this.repoCache.delete(root)
          signal.throwIfAborted()
          throw error
        }
        entry.expiresAt = now + NO_REPO_CACHE_TTL_MS
        return null
      })
    this.repoCache.set(root, entry)
    return entry.value
  }

  /**
   * Whether an already-gated canonical root is a git repository. Skips the
   * workspace gate so the SSE poll does not double-gate every 2s tick; the
   * underlying repoOf cache keeps rev-parse probes at TTL cadence.
   */
  isRepositoryCanonical(canonicalRoot: string, signal?: AbortSignal): Promise<boolean> {
    return this.repoOf(canonicalRoot, signal).then((repo) => repo !== null)
  }

  /**
   * Whether a workspace root is a git repository. Gates the root first (POST
   * route entry point); the SSE poll should use `isRepositoryCanonical`.
   */
  async isRepository(root: string): Promise<boolean> {
    const gated = await this.gate(root)
    if (!gated.ok) return false
    return await this.isRepositoryCanonical(gated.canonical)
  }

  /** Resolve the gated canonical root and the repository top-level. */
  private async repo(root: string, signal?: AbortSignal): Promise<{ ok: true; root: string; repo: string } | { ok: false; error: PanelError }> {
    const gated = await this.gate(root)
    if (!gated.ok) return { ok: false, error: gated.error }
    const repo = await this.repoOf(gated.canonical, signal)
    if (repo === null) return { ok: false, error: NO_REPO }
    return { ok: true, root: gated.canonical, repo }
  }

  /** Run one git invocation and classify failures. */
  private async run(argv: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRunResult> {
    return this.runner.run(argv, cwd, signal)
  }

  /** The repo status view; null when the root is not a repository. */
  status(root: string, signal?: AbortSignal): Promise<GitStatusView | null | PanelError> {
    const existing = this.statusRequests.get(root)
    if (existing !== undefined) return existing
    const request = this.statusFromRoot(root, signal)
    this.statusRequests.set(root, request)
    const clear = (): void => {
      if (this.statusRequests.get(root) === request) this.statusRequests.delete(root)
    }
    void request.then(clear, clear)
    return request
  }

  private async statusFromRoot(root: string, signal?: AbortSignal): Promise<GitStatusView | null | PanelError> {
    // A missing git binary answers before any spawn: the probe runs once per
    // service lifetime, so a git-less machine never re-spawns ENOENT here.
    if (!(await this.gitAvailable(signal))) return null
    const repo = await this.repo(root, signal)
    if (!repo.ok) return repo.error.code === 'git-unavailable' ? null : repo.error
    return this.statusAt(repo.root, repo.repo, signal)
  }

  /**
   * The repo status view for an already-gated canonical root; null when it is
   * not a repository. Skips the workspace gate (SSE subscribers were gated at
   * connect) and reuses the same repoOf cache + status parsing as `status`.
   */
  async statusCanonical(canonicalRoot: string, signal?: AbortSignal): Promise<GitStatusView | null> {
    const repo = await this.repoOf(canonicalRoot, signal)
    if (repo === null) return null
    return this.statusAt(canonicalRoot, repo, signal)
  }

  /** Run one shared branch + porcelain scan for a canonical workspace. */
  private statusAt(root: string, repo: string, signal?: AbortSignal): Promise<GitStatusView> {
    const existing = this.statusRuns.get(root)
    if (existing !== undefined) return existing

    const run = (async () => {
      const [branchResult, statusResult] = await Promise.all([
        this.run(['rev-parse', '--abbrev-ref', 'HEAD'], repo, signal),
        this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repo, signal),
      ])
      const branch = branchResult.stdout.trim() === 'HEAD' ? '' : branchResult.stdout.trim()
      return parseStatusView(root, branch, statusResult.stdout)
    })()
    this.statusRuns.set(root, run)
    const clear = (): void => {
      if (this.statusRuns.get(root) === run) this.statusRuns.delete(root)
    }
    void run.then(clear, clear)
    return run
  }

  /** The repo root for the watch layer (null when not a repository). */
  async repoRoot(root: string): Promise<string | null> {
    const repo = await this.repo(root)
    return repo.ok ? repo.repo : null
  }

  /**
   * The unified diff of one path ('' when there is no diff to show). Staged
   * paths diff the index against HEAD (`--cached`); unstaged paths diff the
   * worktree against the index. Untracked paths have no index/HEAD entry, so
   * they diff against /dev/null (the canonical new-file shape); its exit code
   * is 1 — differences exist — which is a success here, not a failure.
   */
  async diff(root: string, path: string, staged: boolean): Promise<{ content: string } | PanelError> {
    const repo = await this.repo(root)
    if (!repo.ok) return repo.error
    const abs = join(repo.repo, path)
    if (!isPathInside(repo.repo, abs)) return { code: 'path-outside-root', message: 'path outside the repository' }
    const rel = relative(repo.repo, abs)
    const tracked = await this.run(['ls-files', '--error-unmatch', '--', rel], repo.repo)
    const result = tracked.exitCode !== 0
      ? await this.run(['diff', '--no-index', '--', '/dev/null', rel], repo.repo)
      : staged
        ? await this.run(['diff', '--cached', '--', rel], repo.repo)
        : await this.run(['diff', '--', rel], repo.repo)
    // --no-index reports exit 1 when differences exist; a plain diff exits 0.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { code: 'git-failed', message: 'git diff failed' }
    }
    return { content: result.stdout }
  }

  /** Verify paths stay inside the repo root (defense in depth). */
  private pathsInside(repo: string, paths: string[]): string[] {
    const abs = paths.map((p) => join(repo, p))
    return abs.filter((p) => isPathInside(repo, p)).map((p) => p)
  }

  /** Stage paths (git add). Batch result reflects the post-op status. */
  async stage(root: string, paths: string[]): Promise<GitBatchResult | PanelError> {
    return this.batch(root, paths, async (repo, inside) => {
      const result = await this.run(['add', '--', ...inside], repo)
      return result.exitCode === 0
    })
  }

  /** Unstage paths (git restore --staged). */
  async unstage(root: string, paths: string[]): Promise<GitBatchResult | PanelError> {
    return this.batch(root, paths, async (repo, inside) => {
      const result = await this.run(['restore', '--staged', '--', ...inside], repo)
      return result.exitCode === 0
    })
  }

  /**
   * Discard paths (worktree side only). Tracked paths are restored from the
   * index; untracked paths are deleted through the fs seam. The batch reports
   * applied/failed per path.
   */
  async discard(root: string, paths: string[]): Promise<GitBatchResult | PanelError> {
    const repo = await this.repo(root)
    if (!repo.ok) return repo.error
    const inside = this.pathsInside(repo.repo, paths)
    const applied: string[] = []
    const failed: string[] = []
    // Membership is checked on the ABSOLUTE path (pathsInside resolves); the
    // git commands below run with the repo-relative path (cwd = repo).
    const eligible: string[] = []
    for (const p of paths) {
      if (inside.includes(join(repo.repo, p))) eligible.push(p)
      else failed.push(p)
    }
    // One ls-files classifies every eligible path (its output IS the tracked
    // set) instead of one --error-unmatch spawn per path.
    const trackedSet = new Set<string>()
    if (eligible.length > 0) {
      const listed = await this.run(['ls-files', '-z', '--', ...eligible.map(p => ':(literal)' + p)], repo.repo)
      for (const entry of listed.stdout.split('\0')) if (entry !== '') trackedSet.add(entry)
    }
    const tracked = eligible.filter(p => trackedSet.has(p))
    const untracked = eligible.filter(p => !trackedSet.has(p))
    // Tracked paths restore in one spawn; a batch failure falls back to
    // per-path restores so the applied/failed split stays exact.
    if (tracked.length > 0) {
      const restored = await this.run(['restore', '--worktree', '--', ...tracked.map(p => ':(literal)' + p)], repo.repo)
      if (restored.exitCode === 0) {
        applied.push(...tracked)
      } else {
        for (const p of tracked) {
          const single = await this.run(['restore', '--worktree', '--', ':(literal)' + p], repo.repo)
          if (single.exitCode === 0) applied.push(p)
          else failed.push(p)
        }
      }
    }
    for (const p of untracked) {
      // Untracked paths are not restored by git restore; delete them directly.
      // A symlink entry pointing outside the repo must not be deleted — the
      // fs delete would follow the link away. Realpath-check before deleting.
      try {
        const real = await realpath(join(repo.repo, p))
        if (!isPathInside(repo.repo, real)) {
          failed.push(p)
          continue
        }
      } catch {
        // The path does not exist on disk (ENOENT): nothing to escape.
      }
      // The fs seam addresses the project ROOT (which may be a subdir of
      // the repo); derive the root-relative path from the absolute one.
      const rel = relative(repo.root, join(repo.repo, p))
      // Untracked files that lie outside the session root cannot be deleted
      // through the fs seam; refuse rather than delete a look-alike path.
      if (rel === '..' || rel.startsWith('../')) {
        failed.push(p)
        continue
      }
      const deleted = await this.fsDelete(repo.root, rel)
      if ('ok' in deleted && deleted.ok) applied.push(p)
      else failed.push(p)
    }
    return { applied, failed }
  }

  /** Shared batch plumbing: gate, repo resolve, path filter, run the op. */
  private async batch(
    root: string,
    paths: string[],
    op: (repo: string, inside: string[]) => Promise<boolean>,
  ): Promise<GitBatchResult | PanelError> {
    const repo = await this.repo(root)
    if (!repo.ok) return repo.error
    const inside = this.pathsInside(repo.repo, paths)
    const ok = inside.length > 0 ? await op(repo.repo, inside) : true
    if (!ok) return { code: 'git-failed', message: 'git operation failed' }
    // Report the REQUESTED (repo-relative) spellings, not the resolved absolutes.
    const applied = ok ? paths.filter((p) => inside.includes(join(repo.repo, p))) : []
    const failed = paths.filter((p) => !inside.includes(join(repo.repo, p)))
    return { applied, failed }
  }
}
