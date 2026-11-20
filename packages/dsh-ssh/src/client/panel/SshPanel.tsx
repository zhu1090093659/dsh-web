/**
 * The SSH operations panel shell: a header with a close control, a six-tab
 * bar, and the active tab's content.
 *
 * The active tab and the terminal tabs live in the controller, not in
 * component state: the layout mounts this page only while the panel is
 * selected, so local state would reset the tab on every panel switch and lose
 * the ids the terminal tab needs to reattach its host-side sessions. Inactive
 * tabs unmount, so each tab fetches its own data on activation.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { SshApi } from '../api.ts'
import type { PanelController, SshTab } from './controller.ts'
import { tt, type TerminalFontSource } from './helpers.ts'
import { ClusterTab } from './ClusterTab.tsx'
import { HostsTab } from './HostsTab.tsx'
import { KeysTab } from './KeysTab.tsx'
import { TerminalTab } from './TerminalTab.tsx'
import { TransferTab } from './TransferTab.tsx'
import { TunnelsTab } from './TunnelsTab.tsx'
import css from './panel.module.css'

/** Panel shell props. */
export interface SshPanelProps {
  /** The panel state owner (open/close/toggle, active tab, terminal session). */
  controller: PanelController
  /** The SSH API client every tab operates through. */
  api: SshApi
  /** Live terminal-font setting source handed to the terminal tab (issue #577). */
  terminalFont?: TerminalFontSource
}

/** The tab bar definition (labels resolved at render time). */
const TABS: ReadonlyArray<{ id: SshTab; label: () => string }> = [
  { id: 'hosts', label: () => tt('tab.hosts') },
  { id: 'keys', label: () => tt('tab.keys') },
  { id: 'terminal', label: () => tt('tab.terminal') },
  { id: 'transfer', label: () => tt('tab.transfer') },
  { id: 'tunnels', label: () => tt('tab.tunnels') },
  { id: 'cluster', label: () => tt('tab.cluster') },
]

/** The tabbed SSH panel. */
export function SshPanel({ controller, api, terminalFont }: SshPanelProps) {
  const { panelOpen, activeTab } = useSyncExternalStore(
    useCallback(listener => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getSnapshot(), [controller]),
  )

  return (
    <div className={css.panel} data-dsh-plugin="ssh">
      <div className={css.panelHeader}>
        {/* Shared hook: dsh-web-all offsets center-view back controls beside the collapsed mobile sidebar. */}
        <button
          type="button"
          className={`${css.ghostButton} ${css.backButton}`}
          aria-label={tt('panel.backToConversation')}
          data-dsh-center-view-back=""
          onClick={() => { controller.close() }}
        >
          <span aria-hidden="true">‹</span>
          <span>{tt('panel.backToConversation')}</span>
        </button>
        <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
      </div>
      <div className={css.tabBar} role="tablist" data-dsh-part="tab-bar">
        {TABS.map(tab => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} data-active={activeTab === tab.id ? '' : undefined} data-dsh-part="tab" className={css.tab} onClick={() => { controller.setActiveTab(tab.id) }}>
            {tab.label()}
          </button>
        ))}
      </div>
      <div className={css.panelContent}>
        {activeTab === 'hosts' && <HostsTab api={api} onConnect={alias => { controller.requestConnect(alias) }} />}
        {activeTab === 'keys' && <KeysTab api={api} />}
        {activeTab === 'terminal' && (
          <TerminalTab api={api} controller={controller} terminalFont={terminalFont} />
        )}
        {activeTab === 'transfer' && <TransferTab api={api} />}
        {activeTab === 'tunnels' && <TunnelsTab api={api} active={panelOpen} />}
        {activeTab === 'cluster' && <ClusterTab api={api} />}
      </div>
    </div>
  )
}
