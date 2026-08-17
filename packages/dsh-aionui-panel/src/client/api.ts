/**
 * Browser client for the host /aionui-panel/* routes: typed JSON envelope
 * calls plus the SSE change subscription. Same-origin relative fetch (the
 * page and the routes share the webserver).
 * @module dsh-aionui-panel/client/api
 */

import { subscribeSharedEvents } from './sse-leader.ts'
import type {
  DirListing, FileRead, GitBatchResult, GitStatusView, PanelEnvelope, PanelError, SearchView,
} from '../core/types.ts'

/** Transport failure (fetch threw or the response was not JSON). */
const TRANSPORT_ERROR: PanelError = { code: 'internal', message: 'panel route unavailable' }

/** POST one JSON payload and decode the envelope; never throws. */
async function post<T>(path: string, payload: Record<string, unknown>): Promise<PanelEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, error: TRANSPORT_ERROR }
  }
  try {
    const envelope = await response.json() as unknown
    if (typeof envelope !== 'object' || envelope === null) return { ok: false, error: TRANSPORT_ERROR }
    const record = envelope as Record<string, unknown>
    if (record.ok === true) return { ok: true, value: record.value as T }
    return { ok: false, error: (record.error as PanelError | undefined) ?? TRANSPORT_ERROR }
  } catch {
    return { ok: false, error: TRANSPORT_ERROR }
  }
}

/** Typed panel operations over the wire. */
export class PanelApi {
  /** List one directory of the project root (rel path; '' = root). */
  list(root: string, path: string): Promise<PanelEnvelope<DirListing>> {
    return post('/aionui-panel/list', { root, path })
  }

  /** Read one file (text or image data URL). */
  read(root: string, path: string, asImage: boolean): Promise<PanelEnvelope<FileRead>> {
    return post('/aionui-panel/read', { root, path, asImage })
  }

  /** Write text content back with an optional mtime conflict base. */
  write(root: string, path: string, content: string, baseMtime?: number): Promise<PanelEnvelope<{ mtime: number }>> {
    return post('/aionui-panel/write', { root, path, content, baseMtime })
  }

  /** Filename search under the root. */
  search(root: string, query: string): Promise<PanelEnvelope<SearchView>> {
    return post('/aionui-panel/search', { root, query })
  }

  /** Delete a path (untracked discard). */
  delete(root: string, path: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/delete', { root, path })
  }

  /** Reveal a path in the OS file manager (selecting the entry). */
  reveal(root: string, path: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/reveal', { root, path })
  }

  /** Open a path with the OS default app. */
  openWithDefault(root: string, path: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/open-with-default', { root, path })
  }

  /** Rename a path (newName is a bare name, no separators). */
  rename(root: string, path: string, newName: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/rename', { root, path, newName })
  }

  /** Create a directory at a relative path (parent must exist). */
  mkdir(root: string, path: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/mkdir', { root, path })
  }

  /** Create an empty file at a relative path (refuses to overwrite). */
  newFile(root: string, path: string): Promise<PanelEnvelope<{ ok: true }>> {
    return post('/aionui-panel/new-file', { root, path })
  }

  /** Status views for every repository associated with the workspace root. */
  gitStatus(root: string): Promise<PanelEnvelope<GitStatusView[]>> {
    return post('/aionui-panel/git-status', { root })
  }

  /** The unified diff text of one path (staged = index vs HEAD). */
  gitDiff(root: string, repository: string, path: string, staged: boolean): Promise<PanelEnvelope<{ content: string }>> {
    return post('/aionui-panel/git-diff', { root, repository, path, staged })
  }

  /** Stage paths. */
  gitStage(root: string, repository: string, paths: string[]): Promise<PanelEnvelope<GitBatchResult>> {
    return post('/aionui-panel/git-stage', { root, repository, paths })
  }

  /** Unstage paths. */
  gitUnstage(root: string, repository: string, paths: string[]): Promise<PanelEnvelope<GitBatchResult>> {
    return post('/aionui-panel/git-unstage', { root, repository, paths })
  }

  /** Discard paths (worktree side; untracked paths are deleted). */
  gitDiscard(root: string, repository: string, paths: string[]): Promise<PanelEnvelope<GitBatchResult>> {
    return post('/aionui-panel/git-discard', { root, repository, paths })
  }
}

/** One SSE change event pushed by the host. */
export type PanelChangeEvent =
  | { kind: 'fs' }
  | { kind: 'git'; repositories: GitStatusView[] }
  | { kind: 'gitUnavailable' }

/**
 * Subscribe to host-pushed changes for one project root (fs watch events and
 * git status polls). Reconnects are handled by the EventSource; the caller
 * re-subscribes when the root changes.
 * @param root - project root to watch.
 * @param onChange - fired on every pushed change.
 * @returns the disposer closing the stream.
 */
export function subscribePanelEvents(root: string, onChange: (event: PanelChangeEvent) => void): () => void {
  // The stream is shared browser-wide through the cross-tab leader relay
  // (issue #383): two tabs of the same project must not pin two SSE
  // connections against the per-origin HTTP pool.
  return subscribeSharedEvents(`/aionui-panel/events?root=${encodeURIComponent(root)}`, 'change', (data) => {
    try {
      const event = JSON.parse(data) as PanelChangeEvent
      onChange(event)
    } catch {
      // malformed push; ignore
    }
  })
}
