/**
 * Browser client for the host /git/* routes: typed JSON envelope calls plus
 * the SSE change subscription. Same-origin relative fetch (the page and the
 * routes share the webserver).
 * @module dsh-git-graph/client/api
 */

import { subscribeSharedEvents } from './sse-leader.ts'
import type {
  BranchesView, GitError, GraphView, RepoStatus,
} from '../core/types.ts'

/** One /git envelope response. */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitError }

/** Transport failure (fetch threw or the response was not JSON). */
const TRANSPORT_ERROR: GitError = { code: 'internal', message: 'git route unavailable' }

/** POST one JSON payload and decode the envelope; never throws. */
async function post<T>(path: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
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
    return { ok: false, error: (record.error as GitError | undefined) ?? TRANSPORT_ERROR }
  } catch {
    return { ok: false, error: TRANSPORT_ERROR }
  }
}

/** Typed git operations over the wire. */
export class GitApi {
  /** The repository snapshot (null: not a git repository / not a workspace). */
  status(path: string): Promise<ApiResult<RepoStatus | null>> {
    return post('/git/status', { path })
  }

  /** Local branch list with the current branch marked. */
  branches(path: string): Promise<ApiResult<BranchesView | null>> {
    return post('/git/branches', { path })
  }

  /** Workspace-level `git switch --no-guess <branch>` (host guards first). */
  switchBranch(path: string, branch: string): Promise<ApiResult<{ branch: string }>> {
    return post('/git/switch', { path, branch })
  }

  /** `git switch --no-guess -c <name>` from the current HEAD. */
  createBranch(path: string, name: string): Promise<ApiResult<{ branch: string }>> {
    return post('/git/create-branch', { path, name })
  }

  /** Topo-ordered commit graph across branches/tags/remotes. */
  graph(path: string, limit?: number): Promise<ApiResult<GraphView | null>> {
    return post('/git/graph', limit === undefined ? { path } : { path, limit })
  }
}

/**
 * Subscribe to host-pushed branch-state changes for one workspace path (the
 * host polls the workspace while a subscriber is connected). Reconnects are
 * handled by the EventSource; the caller re-subscribes when the path changes.
 * @param path - workspace root to watch.
 * @param onChange - fired on every pushed change.
 * @returns the disposer closing the stream.
 */
export function subscribeChanges(path: string, onChange: () => void): () => void {
  // The stream is shared browser-wide through the cross-tab leader relay
  // (issue #383): two tabs of the same workspace must not pin two SSE
  // connections against the per-origin HTTP pool.
  return subscribeSharedEvents(`/git/events?path=${encodeURIComponent(path)}`, 'change', () => { onChange() })
}
