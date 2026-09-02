/**
 * Center-column panel takeover lifecycle.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so a family panel takes over the center
 * column at the DOM level: a container is appended inside the center column
 * (`[class*="centerCol"]`, the 0.1.0-rc.6+ AppFrame layout; previously
 * `[data-pane="conversation"]` on older shells — the mount selector keeps
 * both, ssh #243 / task-board #107) as an extra trailing child React never
 * manages, and a stylesheet rule hides the conversation content while the
 * panel is active. Toggling is a data attribute on <html> — no React
 * involvement, so the conversation subtree underneath stays mounted and
 * stateful.
 *
 * Consuming plugins keep a thin wrapper that supplies the panel tree,
 * container attribute names, and stylesheet class; those names are pinned by
 * each package's CSS, skins, and the semantic-attributes contract. The
 * sidebar row toggling the panel shares its core the same way
 * (shared/client/sidebar-entry-core.ts, synced copy).
 */
import { createRoot, type Root } from 'react-dom/client'

/** Options for mountCenterPanel; dsh-ssh mount.tsx and dsh-task-board board-mount.tsx are the canonical consumers. */
export interface CenterPanelMountOptions {
  /** Render the panel React tree into a root (initial mount, remount, locale refresh). */
  render: (root: Root) => void
  /** dataset key of the injected container's view attribute, e.g. `dshSshView` for `data-dsh-ssh-view`. */
  viewDatasetKey: string
  /** value of the container's L2 `data-dsh-plugin` semantic attribute. */
  pluginName: string
  /** stylesheet class applied to the injected container. */
  viewClassName: string
  /** <html> attribute set while this panel is active. */
  activeAttribute: string
  /** the sibling panel's active attribute, removed from <html> when this panel opens. */
  siblingActiveAttribute: string
  /** detail value this panel broadcasts on the cross-plugin activation event. */
  panelName: string
  /** sibling detail value whose activation closes this panel. */
  siblingPanelName: string
  /** open flag of the owning controller. */
  isOpen: () => boolean
  /** close the panel, handing the center column back to the conversation. */
  close: () => void
  /** subscribe to the owning controller's open-state changes; returns an unsubscriber. */
  subscribe: (listener: () => void) => () => void
  /** locale-change source; when given, re-renders an open panel on a Language switch. */
  locale?: { subscribe(listener: () => void): () => void }
}

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
// Sidebar rows whose clicks hand the center column back to the conversation
// (including the already-current row, which produces no session-change
// event). Capture phase, so the panel closes before the shell processes the
// click.
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount a family panel into the center column and bind its visibility to the
 * owning controller's open state.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountCenterPanel(options: CenterPanelMountOptions): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let unsubscribeLocale: (() => void) | undefined
  try {
    unsubscribeLocale = options.locale?.subscribe(() => {
      if (root !== undefined) options.render(root)
    })
  } catch { /* locale service absent: the panel follows its next natural re-render */ }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      // The conversation pane was replaced; drop the stale tree and remount.
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset[options.viewDatasetKey] = ''
    container.dataset.dshPlugin = options.pluginName
    container.className = options.viewClassName
    column.appendChild(container)
    root = createRoot(container)
    options.render(root)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (options.isOpen()) {
      // Single-occupant center column: opening this panel must evict the
      // sibling panel, both its html attribute and its controller state,
      // otherwise the two panels' visibility rules fight and the second
      // click appears dead.
      document.documentElement.removeAttribute(options.siblingActiveAttribute)
      document.documentElement.setAttribute(options.activeAttribute, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: options.panelName }))
    } else {
      document.documentElement.removeAttribute(options.activeAttribute)
    }
  }
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail === options.siblingPanelName && options.isOpen()) {
      options.close()
    }
  }
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!options.isOpen()) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) options.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = options.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    unsubscribeLocale?.()
    document.documentElement.removeAttribute(options.activeAttribute)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
