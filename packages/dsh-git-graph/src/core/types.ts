/**
 * Wire vocabulary shared by the host git service and the browser client:
 * request/response shapes of the /git/* routes and the stable error codes
 * the client maps onto bilingual copy. Pure types — no runtime code.
 * @module dsh-git-graph/core/types
 */

/** One workspace-level repository snapshot (the branch chip's data). */
export interface RepoStatus {
  /** Canonical repository root (git rev-parse --show-toplevel). */
  root: string
  /** Current branch name; empty when HEAD is detached. */
  branch: string
  /** Short head commit id (first 7 hex chars). */
  head: string
  /** Tracked modifications/deletions/additions in the worktree (porcelain count). */
  dirtyFiles: number
  /** Untracked file count in the worktree. */
  untrackedFiles: number
  /** Unresolved merge-conflict entry count. */
  conflicts: number
  /** Whether a merge/rebase/cherry-pick/revert/bisect is in progress. */
  operationInProgress: boolean
}

/** One local branch row (git for-each-ref refs/heads). */
export interface BranchRow {
  name: string
  current: boolean
}

/** The branch-list view (git for-each-ref refs/heads + worktree dirtiness). */
export interface BranchesView {
  root: string
  /** Current branch name; empty when detached. */
  branch: string
  branches: BranchRow[]
  dirtyFiles: number
  untrackedFiles: number
  conflicts: number
  operationInProgress: boolean
}

/** Stable switch/create rejection codes (ZCode-style guard vocabulary). */
export type GitErrorCode =
  | 'conflicts-present'
  | 'operation-in-progress'
  | 'branch-in-other-worktree'
  | 'tracked-changes-would-be-overwritten'
  | 'untracked-changes-would-be-overwritten'
  | 'target-branch-not-found'
  | 'invalid-branch-name'
  | 'branch-already-exists'
  | 'workspace-unknown'
  | 'internal'

/** One rejection with the copy key payload the client needs. */
export interface GitError {
  code: GitErrorCode
  /** Human-readable message (host-authored English; the client prefers its own copy by code). */
  message: string
  /** Files blocking the operation (the overwrite guards), first few only. */
  paths?: string[]
  /** Additional blocked-file count beyond `paths`. */
  moreFiles?: number
}

/** Outcome of one switch/create attempt. */
export type SwitchResult =
  | { ok: true; branch: string }
  | { ok: false; error: GitError }

/** One graph row (git log --topo-order with parents and decorations). */
export interface GraphCommit {
  oid: string
  parents: string[]
  subject: string
  author: string
  /** Unix epoch seconds (git %at). */
  authorTime: number
  /** Decoration ref names (branches/tags/HEAD), stripped of prefixes. */
  refs: string[]
}

/** The Git graph view. */
export interface GraphView {
  root: string
  branch: string
  commits: GraphCommit[]
  hasMore: boolean
}

/** Parse output of `git for-each-ref refs/heads --format=...`. */
export function parseBranches(stdout: string): BranchRow[] {
  const rows: BranchRow[] = []
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const [name, head, oid] = line.split('\u0000')
    if (name === undefined || head === undefined || oid === undefined) continue
    rows.push({ name, current: head === '*' })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

/** Parse `git worktree list --porcelain` into the branch refs checked out (porcelain prints `branch refs/heads/<name>`). */
export function parseWorktreeBranches(stdout: string): string[] {
  const branches: string[] = []
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('branch refs/heads/')) continue
    const name = line.slice('branch refs/heads/'.length).trim()
    if (name !== '' && !branches.includes(name)) branches.push(name)
  }
  return branches
}

/** Parse the porcelain status into counts. */
export function parsePorcelain(stdout: string): { dirtyFiles: number; untrackedFiles: number; conflicts: number } {
  let dirtyFiles = 0
  let untrackedFiles = 0
  let conflicts = 0
  // git's porcelain-v1 unmerged codes: DD, AU, UD, UA, DU, AA, UU.
  const unmerged = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const xy = line.slice(0, 2)
    if (unmerged.has(xy)) conflicts += 1
    else if (xy.startsWith('??')) untrackedFiles += 1
    else dirtyFiles += 1
  }
  return { dirtyFiles, untrackedFiles, conflicts }
}

/**
 * Parse the graph format rows (`%H %P %an %at %D %s` split by \x1e). `git
 * log` (tformat) appends a newline after the record separator, so every
 * record except the first carries a leading `\n` — strip it or the oid gets
 * corrupted and a trailing `\n` would parse as a phantom commit.
 */
export function parseGraph(stdout: string): GraphCommit[] {
  const commits: GraphCommit[] = []
  for (const raw of stdout.split('\u001e')) {
    const entry = raw.replace(/^\n/, '')
    if (entry === '') continue
    const [oid, parentsRaw, author, authorTimeRaw, decoration, subject] = entry.split('\u0000')
    if (oid === undefined || oid === '') continue
    commits.push({
      oid,
      parents: parentsRaw === undefined || parentsRaw === '' ? [] : parentsRaw.split(' '),
      subject: subject ?? '',
      author: author ?? '',
      authorTime: Number(authorTimeRaw ?? '0'),
      refs: parseDecoration(decoration ?? ''),
    })
  }
  return commits
}

/** Decoration → ref names: split entries, drop the `HEAD -> ` handoff prefix, drop a bare detached-`HEAD` entry, drop `tag: `. */
export function parseDecoration(decoration: string): string[] {
  if (decoration === '') return []
  return decoration.split(', ').map(part => {
    if (part === 'HEAD') return ''
    let name = part.replace(/^HEAD -> /, '').replace(/^tag: /, '')
    return name.trim()
  }).filter(name => name !== '')
}

/** One rendered graph lane column. */
export type LaneGlyph = 'node' | 'pass' | 'merge' | 'gap'

/** A row's lane map: one glyph per lane column, left to right. */
export interface GraphRowLanes {
  /** Column glyphs; the node sits at `nodeColumn`. */
  columns: LaneGlyph[]
  nodeColumn: number
  /** Whether this commit is a merge (≥2 parents). */
  merge: boolean
}

/**
 * Minimal lane assignment over topo-ordered rows: each lane waits for one
 * commit; the first parent continues the node's lane, further parents start
 * (or join) lanes to the right. Correct for linear, branched, and merged
 * histories; the columns alone carry the topology (the renderer draws them
 * as monospace lane text).
 * @param rows - topo-ordered rows with parents (later rows = ancestors).
 * @returns per-row lane maps.
 */
export function computeLanes(rows: readonly GraphCommit[]): GraphRowLanes[] {
  const later = new Set<string>()
  for (const row of rows) {
    for (const parent of row.parents) later.add(parent)
  }
  const lanes: (string | null)[] = []
  const result: GraphRowLanes[] = []
  for (const row of rows) {
    let nodeColumn = lanes.findIndex(pending => pending === row.oid)
    if (nodeColumn === -1) {
      lanes.push(row.oid)
      nodeColumn = lanes.length - 1
    }
    const columns: LaneGlyph[] = []
    for (let i = 0; i < lanes.length; i += 1) {
      const pending = lanes[i]
      if (pending === null) columns.push('gap')
      else if (i === nodeColumn) columns.push(row.parents.length > 1 ? 'merge' : 'node')
      // A second lane waiting for this commit is a merge join: its line ends
      // into the node (rendered as a gap in this row).
      else if (pending === row.oid) columns.push('gap')
      else if (typeof pending === 'string' && later.has(pending)) columns.push('pass')
      else columns.push('gap')
    }
    const parents = row.parents.filter(parent => later.has(parent))
    const [first, ...rest] = parents
    // Join lanes are consumed by this row; the node lane continues with the
    // first parent.
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === row.oid && i !== nodeColumn) lanes[i] = null
    }
    lanes[nodeColumn] = first ?? null
    for (const parent of rest) {
      if (!lanes.includes(parent)) lanes.push(parent)
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    result.push({ columns, nodeColumn, merge: row.parents.length > 1 })
  }
  return result
}

/**
 * Runtime narrowing for the wire types served to the browser. Zod is not a
 * dependency of this package, so each guard is a hand-written structural
 * check over the same shape the host service produces. The routes boundary
 * runs these before sending a view so a malformed service output can never
 * leak to the client as a typed envelope value.
 * @module dsh-git-graph/core/types
 */

/** Narrow an unknown value onto {@link RepoStatus}. */
export function isRepoStatus(value: unknown): value is RepoStatus {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.root === 'string'
    && typeof record.branch === 'string'
    && typeof record.head === 'string'
    && typeof record.dirtyFiles === 'number'
    && typeof record.untrackedFiles === 'number'
    && typeof record.conflicts === 'number'
    && typeof record.operationInProgress === 'boolean'
}

/** Narrow an unknown value onto {@link BranchRow}. */
export function isBranchRow(value: unknown): value is BranchRow {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' && typeof record.current === 'boolean'
}

/** Narrow an unknown value onto {@link BranchesView}. */
export function isBranchesView(value: unknown): value is BranchesView {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.root === 'string'
    && typeof record.branch === 'string'
    && Array.isArray(record.branches) && record.branches.every(isBranchRow)
    && typeof record.dirtyFiles === 'number'
    && typeof record.untrackedFiles === 'number'
    && typeof record.conflicts === 'number'
    && typeof record.operationInProgress === 'boolean'
}

/** Narrow an unknown value onto {@link GraphCommit}. */
export function isGraphCommit(value: unknown): value is GraphCommit {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.oid === 'string'
    && Array.isArray(record.parents) && record.parents.every(parent => typeof parent === 'string')
    && typeof record.subject === 'string'
    && typeof record.author === 'string'
    && typeof record.authorTime === 'number'
    && Array.isArray(record.refs) && record.refs.every(ref => typeof ref === 'string')
}

/** Narrow an unknown value onto {@link GraphView}. */
export function isGraphView(value: unknown): value is GraphView {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.root === 'string'
    && typeof record.branch === 'string'
    && Array.isArray(record.commits) && record.commits.every(isGraphCommit)
    && typeof record.hasMore === 'boolean'
}

/** The set of stable {@link GitErrorCode} members the client maps onto copy. */
const GIT_ERROR_CODES = new Set<GitErrorCode>([
  'conflicts-present',
  'operation-in-progress',
  'branch-in-other-worktree',
  'tracked-changes-would-be-overwritten',
  'untracked-changes-would-be-overwritten',
  'target-branch-not-found',
  'invalid-branch-name',
  'branch-already-exists',
  'workspace-unknown',
  'internal',
])

/** Narrow an unknown value onto {@link GitErrorCode}. */
export function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === 'string' && GIT_ERROR_CODES.has(value as GitErrorCode)
}

/** Narrow an unknown value onto {@link GitError}. */
export function isGitError(value: unknown): value is GitError {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (!isGitErrorCode(record.code)) return false
  if (typeof record.message !== 'string') return false
  if (record.paths !== undefined
    && (!Array.isArray(record.paths) || !record.paths.every(path => typeof path === 'string'))) {
    return false
  }
  if (record.moreFiles !== undefined && typeof record.moreFiles !== 'number') return false
  return true
}
