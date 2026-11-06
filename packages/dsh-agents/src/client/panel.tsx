/**
 * Native panel registration for the agents sub-plugin.
 *
 * The agents page is an official-style center-column panel, not a DOM
 * takeover: it contributes a row into the sidebar shell's own global panel
 * list (`sidebar.panellist`) and its page into the layout's keyed `main`
 * slot. The shell keeps owning the row box, the label, the active highlight,
 * the collapsed rail and the panel switch, exactly as it does for the Plugins
 * page and the task board.
 *
 * Both registrations go through `ctx.slots.inject`, which fires only once the
 * owning shell entry has declared the seat: load order between this plugin and
 * ui-layout / ui-sidebar does not matter, and a shell that cannot serve the
 * seats leaves the page simply absent instead of failing boot.
 *
 * @module @linxin666/dsh-agents/client
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The renderer package is what merges `slots` onto the cordis Context; the
// slots package itself only owns the registry types.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AgentsPage } from './AgentsPage.tsx'
import type { AgentsTransport } from './host-api.ts'
import { t } from './locales.ts'
import type { SessionFacesStore } from './session-faces.ts'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export const AGENTS_PANEL_ID = 'agents'

/**
 * Row order among the shell's global panel rows: Plugins is 0, Schedule 10 and
 * the task board 20, so 30 keeps the agents row in that group, after the
 * Plugins row and beside the task board.
 */
const PANEL_ORDER = 30

/**
 * The sidebar row glyph the shell asks for at its own size and active state.
 * The shell owns the button, label, tooltip and rail geometry; this component
 * draws only the glyph, like every other panel row. The glyph carries
 * `data-dsh-panel-entry` because it is the only DOM this plugin owns inside
 * that shell-owned row (L2 contract, skins).
 * @param props - the shell's icon share: square edge and selection state.
 * @returns the decorative agents glyph.
 */
export function AgentsPanelIcon({ size }: { size: number; active: boolean }): React.ReactElement {
  return (
    <svg
      data-dsh-panel-entry={AGENTS_PANEL_ID}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5.6" cy="5.2" r="2.1" />
      <path d="M1.9 13c0-1.9 1.6-3.2 3.7-3.2s3.7 1.3 3.7 3.2" />
      <circle cx="11.4" cy="6.3" r="1.7" />
      <path d="M10.2 10.5c1.9 0 3.3 1.2 3.3 2.9" />
    </svg>
  )
}

/** The injected face the main-slot page receives from its own registration. */
export interface AgentsPanelFace {
  transport: AgentsTransport
  /**
   * The per-instance capability store. The page SUBSCRIBES to it rather than
   * reading it once, so an opener or session catalog that appears after this
   * page mounted turns the session entry points on without a reload.
   */
  faces: SessionFacesStore
}

/**
 * The main-slot page. The layout mounts it only while the agents row is the
 * selected panel, so the conversation keeps the center column the rest of the
 * time.
 * @param props - this entry's injected face.
 * @returns the agents page.
 */
export function AgentsPanelPage({ transport, faces }: AgentsPanelFace): ReactNode {
  const snapshot = useSyncExternalStore(faces.subscribe, faces.getSnapshot, faces.getSnapshot)
  return <AgentsPage transport={transport} openSession={snapshot.openSession} teamSource={snapshot.teamSource} />
}

/**
 * Register the agents sidebar row and center-column page.
 * @param ctx - client root context (service: slots).
 * @param transport - the frozen-contract transport the page drives.
 * @param faces - the per-instance capability store the page subscribes to.
 * @returns disposer releasing both registrations.
 */
export function registerAgentsPanel(
  ctx: ClientContext,
  transport: AgentsTransport,
  faces: SessionFacesStore,
): () => void {
  const slots = ctx.slots as {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  const disposers: Array<() => void> = []

  disposers.push(slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: AGENTS_PANEL_ID,
    order: PANEL_ORDER,
    // The shell resolves this thunk on every locale change, so the row follows
    // the Language setting without a reload.
    label: () => t('entry.label'),
  }, AgentsPanelIcon)))

  disposers.push(slots.inject('main', () => slots.register({
    name: 'main',
    key: AGENTS_PANEL_ID,
    inject: (): AgentsPanelFace => ({ transport, faces }),
  }, AgentsPanelPage as never)))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
