/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */

import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { callUnary } from './rpc.ts'

/** One session.list page. */
export interface SessionPage {
  items: SessionSummary[]
  /** Continuation cursor; undefined once the tail is reached. */
  nextCursor?: string
  hasMore: boolean
}

/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
  sessionId: string
  /** The composition the new session runs (echoed so the caller can label it). */
  agentPreset?: string
}

/** The child session published by session.fork. */
export interface ForkedSession {
  sessionId: string
}

/** One history page (already bounded to whole messages by the host). */
export interface HistoryPage {
  events: import('@deepseek-ai/dsh-host-apiproxy/api/sessions').HistoryEntry[]
  hasMore: boolean
  /**
   * Projection baseline riding the tail page (permissions select etc.);
   * absent when the deployment mounts no projection registry.
   */
  projections?: SessionProjectionsBlock
}

/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
  /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
  mobileEnterToSend: boolean
}

/** The workspace roster (session ids come back per workspace). */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const { items } = await callUnary<{ items: WorkspaceView[] }>('workspace.list', {})
  return items
}

/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export async function fetchMobilePreferences(): Promise<MobilePreferences> {
  return await callUnary<MobilePreferences>('mobile.preferences', {})
}

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string): Promise<SessionPage> {
  return await callUnary<SessionPage>('session.list', cursor === undefined ? {} : { cursor })
}

/**
 * Create a blank session (entity birth precedes the first message). Name a
 * workspace to attach it there, or a cwd; omitting both uses the host cwd.
 */
export async function createSession(
  options: { workspaceId?: string; cwd?: string } = {},
): Promise<CreatedSession> {
  return await callUnary<CreatedSession>('session.create', options)
}

/** Fork a completed-turn prefix; the source session remains unchanged. */
export async function forkSession(sessionId: string, atSeq?: number): Promise<ForkedSession> {
  return await callUnary<ForkedSession>('session.fork', {
    sessionId,
    ...(atSeq !== undefined ? { atSeq } : {}),
  })
}

/** One history window; omit beforeSeq for the tail page, pass a signal to abort. */
export async function history(
  sessionId: string,
  beforeSeq?: number,
  maxMessages = 30,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  return await callUnary<HistoryPage>('session.history', {
    sessionId,
    maxMessages,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  }, signal)
}

/** Send one text prompt (queued: the agent picks it up in order). */
export async function prompt(sessionId: string, text: string): Promise<void> {
  await callUnary<{ accepted: true }>('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  })
}

/** Send one slash command line (e.g. `/permission workspace-write`). */
export async function sendCommand(sessionId: string, line: string): Promise<unknown> {
  return await callUnary<unknown>('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: line }],
  })
}

/** Fresh advisory model directory for one session (current + groups + failures). */
export async function models(sessionId: string): Promise<SessionModels> {
  return await callUnary<SessionModels>('session.models', { sessionId })
}

/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export async function selectModel(
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
  return await callUnary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
}
