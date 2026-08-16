/**
 * Wire vocabulary shared by the host data services and the browser client:
 * the request/response shapes of the /aionui-panel/* routes and the stable
 * error codes the client maps onto copy. Pure types — no runtime code.
 *
 * The design follows AionUi's right-panel system (Apache-2.0, re-implemented
 * from measured behavior, not copied code): the explorer column is a lazy
 * directory tree, the preview column opens files as tabs, and the SCM tab
 * reads the repository's real working-tree state.
 * @module dsh-aionui-panel/core/types
 */

/** Envelope every /aionui-panel JSON response carries. */
export type PanelEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: PanelError }

/** Stable rejection codes (host-authored; the client prefers its own copy by code). */
export type PanelErrorCode =
  | 'workspace-unknown'
  | 'path-outside-root'
  | 'not-found'
  | 'is-directory'
  | 'read-failed'
  | 'write-conflict'
  | 'write-failed'
  | 'search-failed'
  | 'git-unavailable'
  | 'git-failed'
  | 'internal'

/** One rejection with a human-readable host message. */
export interface PanelError {
  code: PanelErrorCode
  message: string
}

/** One filesystem entry in a directory listing (path is relative to the root). */
export interface FsEntry {
  /** Display name (basename). */
  name: string
  /** Path relative to the project root, '/' separated; '' is the root itself. */
  path: string
  isDir: boolean
  /** Size in bytes (0 for directories). */
  size: number
  /** Last-modified epoch millis (0 for directories). */
  mtime: number
}

/** The listing of one directory. */
export interface DirListing {
  /** Canonical root path the listing is relative to. */
  root: string
  /** Sorted entries (directories first, then files, both case-insensitive alpha). */
  entries: FsEntry[]
}

/** The result of reading one file for preview. */
export interface FileRead {
  /** Text content (decoded utf-8), or a data URL for image kinds. */
  content: string
  /** True when the text was truncated at the preview ceiling. */
  truncated: boolean
  /** Total size in bytes. */
  size: number
  /** Last-modified epoch millis (the write-conflict base). */
  mtime: number
  /** Image dimensions when the file is an image (host decodes via probe). */
  image?: { width: number; height: number }
}

/** One filename-search hit. */
export interface SearchHit {
  /** Path relative to the root. */
  path: string
  /** Display name (basename). */
  name: string
  isDir: boolean
}

/** The filename-search result. */
export interface SearchView {
  /** The query the hits were ranked for. */
  query: string
  hits: SearchHit[]
  /** True when the hit cap cut the result stream. */
  truncated: boolean
}

/** One matching line inside a content-search hit. */
export interface ContentSearchMatch {
  /** 1-based line number in the file. */
  line: number
  /** The matched line (host-trimmed to a snippet ceiling). */
  text: string
}

/** One content-search hit: a file whose text contains the query. */
export interface ContentSearchHit {
  /** Path relative to the root. */
  path: string
  /** Display name (basename). */
  name: string
  /** Matching lines (capped per file by the host). */
  matches: ContentSearchMatch[]
}

/** The content-search result (files grouped with their matching lines). */
export interface ContentSearchView {
  /** The query the hits were ranked for. */
  query: string
  hits: ContentSearchHit[]
  /** True when a scan or hit cap cut the result stream. */
  truncated: boolean
}

/** Working-tree state of one change row. */
export type GitFileState = 'created' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | 'untracked' | 'unknown'

/** One change row in a git status. */
export interface GitChangeRow {
  /** Path relative to the repo root. */
  path: string
  /** Original path for renames (old -> new). */
  oldPath?: string
  state: GitFileState
  /** True when the change sits in the index (staged). */
  staged: boolean
}

/** The git status view of one repo root. */
export interface GitStatusView {
  /** Repo root (git rev-parse --show-toplevel). */
  root: string
  /** Current branch name; '' when detached. */
  branch: string
  /** Staged changes (index vs HEAD). */
  staged: GitChangeRow[]
  /** Unstaged changes (worktree vs index). */
  unstaged: GitChangeRow[]
  /** Untracked files (worktree, not in index). */
  untracked: GitChangeRow[]
}

/** The result of a stage/unstage/discard batch. */
export interface GitBatchResult {
  /** Rows the operation actually changed (post-op status snapshot for these paths). */
  applied: string[]
  /** Paths the host refused to touch. */
  failed: string[]
}

/** One preview tab identity as persisted. */
export interface PreviewTabMeta {
  /** Stable tab id (root + path + type). */
  id: string
  /** Display title (basename). */
  title: string
  /** Project root the file belongs to. */
  root: string
  /** File path relative to the root. */
  path: string
  contentType: PreviewContentType
  /** Whether the tab carries unsaved edits. */
  dirty?: boolean
  /** Last write timestamp the tab's content was based on (conflict base). */
  mtime?: number
  /** When the tab was last touched (LRU ordering within a scope). */
  savedAt: number
}

/** Preview content kinds the panel can render. */
export type PreviewContentType =
  | 'markdown'
  | 'html'
  | 'code'
  | 'diff'
  | 'csv'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'image'
  | 'text'
  | 'url'
  | 'unsupported'
