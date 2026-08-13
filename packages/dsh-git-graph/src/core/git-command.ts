/**
 * Git command vocabulary: argv builders, stderr classification, and the
 * pure branch-name validation mirror. The host service runs these through
 * the subprocess seam; tests exercise this layer with a plain runner.
 * @module dsh-git-graph/core/git-command
 */

import type { GitError, GitErrorCode } from './types.ts'

/** `git rev-parse --show-toplevel` — canonical repository root. */
export const topLevelArgv = (): string[] => ['rev-parse', '--show-toplevel']

/** `git rev-parse --abbrev-ref HEAD` — current branch ('HEAD' when detached). */
export const headBranchArgv = (): string[] => ['rev-parse', '--abbrev-ref', 'HEAD']

/** `git rev-parse --short HEAD` — short head id. */
export const headShortArgv = (): string[] => ['rev-parse', '--short', 'HEAD']

/** `git for-each-ref refs/heads --format=%(refname:short)%00%(HEAD)%00%(objectname)` — local branches. */
export const forEachRefArgv = (): string[] => [
  'for-each-ref', 'refs/heads',
  '--format=%(refname:short)%00%(HEAD)%00%(objectname)',
]

/** `git status --porcelain` — worktree dirtiness and conflicts. */
export const statusPorcelainArgv = (): string[] => ['status', '--porcelain']

/** `git diff --name-only --diff-filter=U` — unmerged (conflict) files. */
export const unmergedArgv = (): string[] => ['diff', '--name-only', '--diff-filter=U']

/** `git worktree list --porcelain` — all worktrees and their checked-out branches. */
export const worktreeListArgv = (): string[] => ['worktree', 'list', '--porcelain']

/** `git rev-parse --verify --quiet refs/heads/<branch>` — branch existence probe. */
export const verifyRefArgv = (branch: string): string[] => ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]

/** `git check-ref-format --branch <name>` — the authoritative branch-name gate. */
export const checkRefFormatArgv = (name: string): string[] => ['check-ref-format', '--branch', name]

/** `git switch --no-guess -- <branch>` — workspace-level branch switch (ZCode semantics). */
export const switchArgv = (branch: string): string[] => ['switch', '--no-guess', '--', branch]

/** `git switch --no-guess -c <name>` — create from current HEAD and switch. */
export const createBranchArgv = (name: string): string[] => ['switch', '--no-guess', '-c', name]

/** `git rev-parse --git-path <marker>` — resolve one in-progress-operation marker path. */
export const gitPathArgv = (marker: string): string[] => ['rev-parse', '--git-path', marker]

/** Graph log: `git log --branches --tags --remotes --topo-order --parents --format=... --max-count <n>`. */
export const graphLogArgv = (limit: number): string[] => [
  'log', '--branches', '--tags', '--remotes', '--topo-order', '--parents',
  '--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e',
  '--max-count', String(limit),
]

/** Git markers whose presence means an operation is in progress. */
export const OPERATION_MARKERS = [
  'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG',
  'rebase-merge', 'rebase-apply', 'sequencer',
] as const

/**
 * Locale pins for git invocations. The switch-failure classifier matches
 * English stderr phrases, so every spawn forces the C locale regardless of
 * the ambient locale — a Chinese-locale git would otherwise emit localized
 * messages ("工作区中下列未跟踪的文件...") that no pattern matches and
 * every failure would classify as `internal`.
 */
export const GIT_LOCALE_ENV: Readonly<Record<string, string>> = { LC_ALL: 'C', LANG: 'C' }

/** stderr pattern → overwrite guard code, with the blocked-file extraction. */
interface OverwritePattern {
  code: Extract<GitErrorCode, 'tracked-changes-would-be-overwritten' | 'untracked-changes-would-be-overwritten'>
  header: RegExp
  /** A line that ends the file list. */
  end?: RegExp
}

const OVERWRITE_PATTERNS: OverwritePattern[] = [
  {
    code: 'tracked-changes-would-be-overwritten',
    header: /Your local changes to the following files would be overwritten by checkout/,
  },
  {
    code: 'untracked-changes-would-be-overwritten',
    header: /The following untracked working tree files would be overwritten by checkout/,
  },
  {
    code: 'tracked-changes-would-be-overwritten',
    header: /Your local changes to the following files would be overwritten by merge/,
  },
]

/**
 * Extract the blocked-file list following an overwrite header: git indents
 * paths with a tab (quoted when they contain spaces); the trailing hint
 * lines ("Please commit your changes...") end the list.
 * @param stderr - the full git stderr.
 * @param header - the matched header regex.
 * @returns up to two file paths plus the count of remaining files.
 */
export function extractBlockedPaths(
  stderr: string,
  header: RegExp,
): { paths: string[]; moreFiles: number } {
  const start = stderr.indexOf('\n', stderr.search(header))
  if (start === -1) return { paths: [], moreFiles: 0 }
  const paths: string[] = []
  for (const line of stderr.slice(start + 1).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || !line.startsWith('\t')) break
    const quoted = /^"(.+)"$/.exec(trimmed)
    const path = quoted === null
      ? trimmed.replace(/\\(.)/g, '$1')
      : (quoted[1] ?? '').replace(/\\(.)/g, '$1')
    paths.push(path)
  }
  return { paths: paths.slice(0, 2), moreFiles: Math.max(0, paths.length - 2) }
}

/**
 * Classify a failed switch's stderr onto the stable error vocabulary.
 * @param stderr - git stderr from the failed switch/create.
 * @returns the classified error; `internal` when nothing matches.
 */
export function classifySwitchFailure(stderr: string): GitError {
  const head = stderr.trim().split('\n')[0] ?? stderr
  for (const pattern of OVERWRITE_PATTERNS) {
    if (pattern.header.test(stderr)) {
      const { paths, moreFiles } = extractBlockedPaths(stderr, pattern.header)
      return { code: pattern.code, message: head, paths, moreFiles }
    }
  }
  if (/did not match any file\(s\) known to git|invalid reference|not a valid branch/.test(stderr)) {
    return { code: 'target-branch-not-found', message: head }
  }
  if (/already used by worktree|is already checked out at/.test(stderr)) {
    return { code: 'branch-in-other-worktree', message: head }
  }
  if (/local changes to the following files would be overwritten/.test(stderr)) {
    return { code: 'tracked-changes-would-be-overwritten', message: head }
  }
  return { code: 'internal', message: head || 'git switch failed' }
}

/**
 * Pure mirror of `git check-ref-format --branch` short-name rules, for
 * instant client-side feedback; the host's check-ref-format call stays the
 * authoritative gate. Returns the reason when the name is invalid.
 * @param name - proposed branch name (short form, no refs/ prefix).
 * @returns null when valid, else a short reason.
 */
export function validateBranchName(name: string): string | null {
  if (name === '') return 'empty'
  if (name === '@') return 'at-sign'
  if (name.startsWith('-')) return 'leading-dash'
  if (name.endsWith('.')) return 'trailing-dot'
  if (name.endsWith('.lock')) return 'lock-suffix'
  if (name.includes('..')) return 'double-dot'
  if (name.includes('@{')) return 'at-brace'
  if (name.includes('//')) return 'double-slash'
  if (name.includes(' ')) return 'space'
  if (name.includes('~') || name.includes('^') || name.includes(':')) return 'forbidden-char'
  if (name.includes('?') || name.includes('*') || name.includes('[') || name.includes('\\')) return 'forbidden-char'
  for (const ch of name) {
    const code = ch.codePointAt(0)
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return 'control-char'
  }
  for (const component of name.split('/')) {
    if (component === '') return 'empty-component'
    if (component.startsWith('.')) return 'dot-component'
    if (component.endsWith('.lock')) return 'lock-suffix'
  }
  if (name.length > 1000) return 'too-long'
  return null
}
