/**
 * Codex-board client plugin: mounts a Codex-style floating task board at the
 * top-right of the GUI and drives it from the current session's todos
 * projection.
 *
 * The board is host-global (no session-scoped slot): it mounts straight onto
 * document.body via a single React root for the page lifetime (the pet
 * precedent), and follows the sessions list `current` selection. The todos
 * projection is the whole list written by the `todo_write` tool — the host
 * folds `todo/write` events into `session/projection` frames, and the client
 * session binding exposes them through `projections.faceOf('todos')`.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TodoItem } from '../core/derive.ts'
import { CodexBoard, type CodexBoardProps } from './CodexBoard.tsx'
import { NS, en, zh, type CodexBoardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Codex-board surface copy. */
    'codex-board': CodexBoardKey
  }
}

/** Required services. */
export const inject = ['slots', 'sessions', 'locale']

/** The board container selector (for tests and the settings surface). */
export const BOARD_ROOT_SELECTOR = '[data-dsh-codexboard-root]'

/** The live todos face: a session projection key ('todos'), read through the
 *  session binding's projections store. */
type TodosFace = { getSnapshot(): readonly TodoItem[] | null; subscribe(fn: () => void): () => void }

/**
 * Client plugin body: register dictionaries and mount the floating board,
 * following the current session's todos projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-board: dictionaries')

  // The board mounts once for the page lifetime, straight onto document.body.
  // A duplicated client injection (module factory executed twice in one page
  // lifetime) would otherwise mount a second board; guard against it.
  if (document.querySelector(BOARD_ROOT_SELECTOR) !== null) return

  const container = document.createElement('div')
  container.dataset.dshCodexboardRoot = ''
  document.body.appendChild(container)

  let root: Root | undefined
  let disposed = false

  const sessions = ctx.sessions

  const render = (): void => {
    if (disposed) return
    const snapshot = sessions.list.getSnapshot()
    const current = snapshot.current as SessionId | undefined
    let todos: readonly TodoItem[] | null = null
    if (current !== undefined) {
      const binding = sessions.binding(current)
      const face = binding?.session.projections.faceOf('todos') as TodosFace | undefined
      todos = face?.getSnapshot() ?? null
    }
    const props: CodexBoardProps = {
      sessionId: current,
      todos,
      t: ctx.locale.bind(NS),
    }
    if (root === undefined) root = createRoot(container)
    root.render(createElement(CodexBoard, props))
  }

  // The sessions list store is the coarse current-selection feed; the todos
  // projection face is per-session. Subscribe to both — the list changes on
  // session switches, the face on todo/write frames.
  const disposers: Array<() => void> = []
  disposers.push(sessions.list.subscribe(render))

  let currentFace: TodosFace | undefined
  let unsubscribeFace: (() => void) | undefined
  const syncFace = (): void => {
    const snapshot = sessions.list.getSnapshot()
    const current = snapshot.current as SessionId | undefined
    const face = current === undefined
      ? undefined
      : (sessions.binding(current)?.session.projections.faceOf('todos') as TodosFace | undefined)
    if (face === currentFace) return
    unsubscribeFace?.()
    unsubscribeFace = undefined
    currentFace = face
    if (face !== undefined) unsubscribeFace = face.subscribe(render)
    render()
  }
  disposers.push(sessions.list.subscribe(syncFace))
  syncFace()

  ctx.effect(() => {
    return () => {
      disposed = true
      for (const dispose of disposers.splice(0)) dispose()
      unsubscribeFace?.()
      unsubscribeFace = undefined
      root?.unmount()
      root = undefined
      container.remove()
    }
  }, 'codex-board: floating board')
}
