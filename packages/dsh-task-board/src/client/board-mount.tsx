/**
 * Board view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the board takes over the center column at
 * the DOM level: a container is appended inside the center column
 * (`[class*="centerCol"]`, the dsh 0.1.0-rc.6 AppFrame layout; previously
 * `[data-pane="conversation"]` on older shells — the mount selector keeps both)
 * as an extra trailing child
 * React never manages, and a stylesheet
 * rule hides the conversation content while the board is active. Toggling is
 * a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { BoardController } from '../core/controller.ts'
import { TaskBoard } from './board/TaskBoard.tsx'
import type { LocaleRefreshSource } from './sidebar-entry.ts'
import css from './board.module.css'

/** The injected board container (kept in the DOM, hidden when inactive). */
export const BOARD_VIEW_SELECTOR = '[data-dsh-taskboard-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-taskboard-active'
/** The sibling panel's activation attribute (ssh), removed when this panel opens. */
const OTHER_ACTIVE_ATTR = 'data-dsh-ssh-active'
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'taskboard'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the board React tree into the center column and bind its visibility
 * to the controller's boardOpen state.
 * @param controller - the board controller driving the view.
 * @param locale - locale-change source; when given, re-renders a mounted board
 *   on a Language switch.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountBoard(controller: BoardController, locale?: LocaleRefreshSource): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let unsubscribeLocale: (() => void) | undefined
  try {
    unsubscribeLocale = locale?.subscribe(() => {
      if (root !== undefined) root.render(<TaskBoard controller={controller} />)
    })
  } catch { /* locale service absent: the board follows its next natural re-render */ }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshTaskboardView = ''
    container.dataset.dshPlugin = 'task-board'
    container.className = css.boardView
    column.appendChild(container)
    root = createRoot(container)
    root.render(<TaskBoard controller={controller} />)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().boardOpen) {
      // Single-occupant center column: opening this panel must evict the
      // sibling panel (ssh), both its html attribute and its controller
      // state, otherwise the two panels' visibility rules fight and the
      // second click appears dead.
      document.documentElement.removeAttribute(OTHER_ACTIVE_ATTR)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail === 'ssh' && controller.getSnapshot().boardOpen) {
      controller.closeBoard()
    }
  }
  // Jump out on sidebar context clicks: clicking a session/workspace row
  // (including the already-current one, which produces no session-change
  // event) hands the center column back to the conversation. Capture phase,
  // so the panel closes before the shell processes the click.
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().boardOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.closeBoard()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    unsubscribeLocale?.()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
