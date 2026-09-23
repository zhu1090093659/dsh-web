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

/** `git worktree add -b <branch> <path> <baseRef>` — a linked worktree on a NEW branch. */
export const worktreeAddArgv = (path: string, branch: string, baseRef: string): string[] => [
  'worktree', 'add', '-b', branch, path, baseRef,
]

/** `git worktree remove [--force] <path>` — remove a linked worktree. */
export const worktreeRemoveArgv = (path: string, force: boolean): string[] =>
  force ? ['worktree', 'remove', '--force', path] : ['worktree', 'remove', path]

/** `git branch -D <name>` — force-delete a branch (only for opted-in wt/ cleanup after removal). */
export const branchDeleteForceArgv = (name: string): string[] => ['branch', '-D', name]

/** `git rev-parse --verify --quiet <rev>` — generic revision probe (base refs such as origin/HEAD). */
export const verifyRevArgv = (rev: string): string[] => ['rev-parse', '--verify', '--quiet', rev]

/** Branch prefix every plugin-created worktree checks out (never the base branch itself). */
export const WORKTREE_BRANCH_PREFIX = 'wt/'

/**
 * Sanitize a user/agent-supplied worktree name into a safe directory and
 * branch component: lowercase, alnum plus ._-, no leading/trailing dash/dot,
 * capped at 64 chars. Returns null when nothing usable remains.
 * @param raw - the proposed worktree name.
 */
export function sanitizeWorktreeName(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 64)
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null
  return cleaned
}

/** `git rev-parse --verify --quiet refs/heads/<branch>` — branch existence probe. */
export const verifyRefArgv = (branch: string): string[] => ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]

/** `git check-ref-format --branch <name>` — the authoritative branch-name gate. */
export const checkRefFormatArgv = (name: string): string[] => ['check-ref-format', '--branch', name]

/** `git switch --no-guess -- <branch>` — workspace-level branch switch (ZCode semantics). */
export const switchArgv = (branch: string): string[] => ['switch', '--no-guess', '--', branch]

/** `git switch --no-guess -c <name>` — create from current HEAD and switch. */
export const createBranchArgv = (name: string): string[] => ['switch', '--no-guess', '-c', name]

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
 * git rev-parse --git-path <marker> - resolve ONE operation marker to its
 * on-disk path. Kept as the per-marker probe for the service's fallback
 * when the single combined spawn fails (a hung or non-zero combined call
 * must not silently hide an in-progress operation).
 */
export const gitPathArgv = (marker: string): string[] => ['rev-parse', '--git-path', marker]

/**
 * git rev-parse --git-path <marker>... - resolve every operation-marker path
 * in ONE spawn (one --git-path option per marker; the option form is
 * repeatable, unlike positional paths). On Windows, where each git.exe cold
 * start costs about 0.7s, this replaces the previous 7 sequential marker
 * probes with a single process.
 */
export const operationMarkersArgv = (): string[] => [
  'rev-parse',
  ...OPERATION_MARKERS.flatMap((marker) => ['--git-path', marker]),
]

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
const gitPathEncoder = new TextEncoder()
const gitPathDecoder = new TextDecoder()

/** The C-style escapes git uses besides the octal byte runs. */
const GIT_SIMPLE_ESCAPES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 }

/**
 * Decode one git-quoted path. Under the default `core.quotePath`, git escapes
 * every non-ASCII byte as octal — 'ä' arrives as \303\244 — so octal runs are
 * collected as bytes and decoded together as UTF-8. Decoding escape by escape
 * would pair the digits into mojibake instead of the original character (#1491).
 * @param input - a path with or without the surrounding quotes.
 * @returns the decoded path.
 */
function decodeGitQuoted(input: string): string {
  if (!input.includes('\\')) return input
  const bytes: number[] = []
  const pattern = /\\(?:([0-7]{3})|([\s\S]))/g
  let index = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    bytes.push(...gitPathEncoder.encode(input.slice(index, match.index)))
    const octal = match[1]
    if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8) & 0xff)
    } else {
      const escaped = match[2]!
      const control = GIT_SIMPLE_ESCAPES[escaped]
      if (control === undefined) bytes.push(...gitPathEncoder.encode(escaped))
      else bytes.push(control)
    }
    index = match.index + match[0].length
  }
  bytes.push(...gitPathEncoder.encode(input.slice(index)))
  return gitPathDecoder.decode(new Uint8Array(bytes))
}

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
      ? decodeGitQuoted(trimmed)
      : decodeGitQuoted(quoted[1] ?? '')
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
