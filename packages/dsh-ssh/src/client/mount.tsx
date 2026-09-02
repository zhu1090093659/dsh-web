/**
 * Panel view mounting (dsh-ssh wrapper).
 *
 * The single-occupant takeover lifecycle — container injection into the
 * center column, sibling eviction, remount resilience, sidebar click-out —
 * lives exactly once in shared/client/panel-mount-core.ts (synced copy); this
 * wrapper supplies the SSH panel tree, view dataset key, CSS module, and the
 * html attribute names. Those names are pinned by panel.module.css, skins,
 * and the semantic attributes contract.
 */
import type { SshApi } from './api.ts'
import type { PanelController } from './panel/controller.ts'
import type { TerminalFontSource } from './panel/helpers.ts'
import { SshPanel } from './panel/SshPanel.tsx'
import { mountCenterPanel } from './panel-mount-core.ts'
import type { LocaleRefreshSource } from './sidebar-entry.ts'
import css from './panel/panel.module.css'

/** The injected panel container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-dsh-ssh-view]'

/**
 * Mount the panel React tree into the center column and bind its visibility
 * to the controller's panelOpen state.
 * @param controller - the panel controller driving the view.
 * @param api - the SSH API client the tabs operate through.
 * @param terminalFont - live terminal-font setting source (issue #577).
 * @param locale - locale-change source; when given, re-renders an open panel
 *   on a Language switch.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountPanel(controller: PanelController, api: SshApi, terminalFont?: TerminalFontSource, locale?: LocaleRefreshSource): () => void {
  return mountCenterPanel({
    render: root => root.render(<SshPanel controller={controller} api={api} terminalFont={terminalFont} />),
    viewDatasetKey: 'dshSshView',
    pluginName: 'ssh',
    viewClassName: css.view,
    activeAttribute: 'data-dsh-ssh-active',
    siblingActiveAttribute: 'data-dsh-taskboard-active',
    panelName: 'ssh',
    siblingPanelName: 'taskboard',
    isOpen: () => controller.getSnapshot().panelOpen,
    close: () => controller.close(),
    subscribe: listener => controller.subscribe(listener),
    locale,
  })
}
