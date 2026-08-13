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
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { GitBatchResult, GitChangeRow, GitFileState, GitStatusView, PanelError } from '../core/types.ts'
import { isPathInside, type WorkspaceGate } from './gate.ts'

/** One finished git invocation. */
export interface GitRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** The spawn seam the service runs git through (subprocess service in production). */
export interface GitRunner {
  run(argv: readonly string[], cwd: string): Promise<GitRunResult>
}

/** Collected-output cap for one git command. */
const OUTPUT_CAP_BYTES = 1 << 20

/** Production runner over `ctx.subprocess`: one managed child per command. */
export function subprocessRunner(ctx: Context): GitRunner {
  return {
    async run(argv, cwd) {
      const spec: SubprocessSpawnSpec = {
        argv: ['git', ...argv],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: OUTPUT_CAP_BYTES },
          stderr: { maxBytes: OUTPUT_CAP_BYTES },
        },
        graceMs: 10_000,
      }
      // A missing git binary (or a subprocess service that cannot spawn) must
      // degrade to a failed run, not throw through the route layer: the SCM
      // tab then shows the friendly "not a git repository" state instead of a
      // bare 400 with no body.
      let handle: SubprocessHandle
      try {
        handle = ctx.subprocess.spawn(spec)
      } catch {
        return { exitCode: 127, stdout: '', stderr: 'git: spawn failed (is git installed?)' }
      }
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      return { exitCode: outcome.exitCode, stdout, stderr }
    },
  }
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
 * Workspace-scoped git operations. Every method passes the gate, resolves the
 * repository root, and rejects non-repositories with a stable error.
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

  /** Resolve the gated canonical root and the repository top-level. */
  private async repo(root: string): Promise<{ ok: true; root: string; repo: string } | { ok: false; error: PanelError }> {
    const gated = await this.gate(root)
    if (!gated.ok) return { ok: false, error: gated.error }
    const result = await this.run(['rev-parse', '--show-toplevel'], gated.canonical)
    if (result.exitCode !== 0) return { ok: false, error: NO_REPO }
    const repo = result.stdout.trim()
    if (repo === '' || !isPathInside(repo, gated.canonical)) return { ok: false, error: NO_REPO }
    return { ok: true, root: gated.canonical, repo }
  }

  /** Run one git invocation and classify failures. */
  private async run(argv: readonly string[], cwd: string): Promise<GitRunResult> {
    return this.runner.run(argv, cwd)
  }

  /** The repo status view; null when the root is not a repository. */
  async status(root: string): Promise<GitStatusView | null | PanelError> {
    const repo = await this.repo(root)
    if (!repo.ok) return repo.error.code === 'git-unavailable' ? null : repo.error
    const [branchResult, statusResult] = await Promise.all([
      this.run(['rev-parse', '--abbrev-ref', 'HEAD'], repo.repo),
      this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repo.repo),
    ])
    const branch = branchResult.stdout.trim() === 'HEAD' ? '' : branchResult.stdout.trim()
    return parseStatusView(repo.root, branch, statusResult.stdout)
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
    for (const p of paths) {
      // Membership is checked on the ABSOLUTE path (pathsInside resolves);
      // the git commands below run with the repo-relative path (cwd = repo).
      const abs = join(repo.repo, p)
      if (!inside.includes(abs)) {
        failed.push(p)
        continue
      }
      // Untracked paths are not restored by git restore; delete them directly.
      const untrackedResult = await this.run(['ls-files', '--error-unmatch', '--', ':(literal)' + p], repo.repo)
      if (untrackedResult.exitCode !== 0) {
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
        continue
      }
      const result = await this.run(['restore', '--worktree', '--', ':(literal)' + p], repo.repo)
      if (result.exitCode === 0) applied.push(p)
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
