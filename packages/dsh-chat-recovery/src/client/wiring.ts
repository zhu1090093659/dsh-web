/**
 * Runtime wiring: fills the framework-free supervisor ports and the edit
 * submission path with the real client services (ctx.sessions / ctx.workspaces).
 */
import type {
  ISessions,
  IWorkspaces,
  SessionId,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { RetryPorts } from '../core/retry-supervisor.ts'

/**
 * Connect (or create) a blank session in the workspace the source session
 * belongs to. Used as the first-turn fallback when forking cannot cut history
 * before the message (no earlier turn/end exists).
 * @param workspaces - the workspaces service.
 * @param cwd - the source session's workspace directory.
 */
export async function connectBlank(workspaces: IWorkspaces, cwd: string | undefined): Promise<SessionId> {
  if (cwd === undefined || cwd === '') {
    throw new Error('source session has no workspace directory')
  }
  const items = workspaces.list.getSnapshot().items
  let workspaceId: WorkspaceId | undefined = items.find((item) => item.path === cwd)?.workspaceId
  if (workspaceId === undefined) {
    const view = await workspaces.create({ path: cwd })
    workspaceId = view.workspaceId
  }
  return workspaces.connectWorkspace(workspaceId)
}

/**
 * Fill the supervisor ports from the live services.
 * @param sessions - the sessions service.
 * @param workspaces - the workspaces service.
 */
export function createRetryPorts(sessions: ISessions, workspaces: IWorkspaces): RetryPorts {
  return {
    currentId: () => sessions.list.getSnapshot().current,
    snapshot: (id) => sessions.binding(id)?.session.getSnapshot(),
    cwdOf: (id) => sessions.list.getSnapshot().byId[id]?.cwd,
    fork: (opts) => sessions.fork(opts),
    connectBlank: (cwd) => connectBlank(workspaces, cwd),
    open: (id) => {
      sessions.open(id)
    },
    prompt: async (id, text) => {
      const binding = sessions.binding(id)
      if (binding === undefined) {
        return { ok: false, code: 'session-unavailable', message: 'target session is not available' }
      }
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (result.ok) return { ok: true }
      return { ok: false, code: result.error.code, message: result.error.message }
    },
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => {
        clearTimeout(timer)
      }
    },
  }
}

/** Edit submission input (all durable facts; the text is the edited draft). */
export interface SubmitEditInput {
  sessionId: SessionId
  /** Fork anchor: null falls back to a fresh blank session in the workspace. */
  forkAtSeq: number | null
  editedText: string
}

/**
 * Edit submission: fork a child from the history prefix before the edited
 * message (or connect a blank sibling for first-turn edits), open it, and
 * send the edited text. The original session is never touched: a fork or
 * resubmit failure leaves it exactly as it was.
 * @param sessions - the sessions service.
 * @param workspaces - the workspaces service.
 */
export function createSubmitEdit(sessions: ISessions, workspaces: IWorkspaces) {
  return async (input: SubmitEditInput): Promise<void> => {
    const cwd = sessions.list.getSnapshot().byId[input.sessionId]?.cwd
    const targetId = input.forkAtSeq === null
      ? await connectBlank(workspaces, cwd)
      : await sessions.fork({ sessionId: input.sessionId, atSeq: input.forkAtSeq, increaseTitle: true })
    sessions.open(targetId)
    const binding = sessions.binding(targetId)
    if (binding === undefined) throw new Error('edited branch is not available')
    const result = await binding.session.prompt([{ type: 'text', text: input.editedText }], 'queue')
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  }
}
