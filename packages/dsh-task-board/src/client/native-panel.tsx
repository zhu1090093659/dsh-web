/**
 * Native panel registration for the task board.
 *
 * The board is an official-style center-column panel, not a DOM takeover: it
 * contributes a row into the sidebar shell's own global panel list
 * (`sidebar.panellist`) and its page into the layout's keyed `main` slot. The
 * shell then owns the row box, the label, the active highlight, the collapsed
 * rail, the panel switch and the window-chrome interplay exactly as it does for
 * the shipped Plugins and Schedule pages, so the board renders through the same
 * container the desktop application's Plugins page uses.
 *
 * Both registrations go through `ctx.slots.inject`, which fires only once the
 * owning shell entry has declared the seat: load order between this plugin and
 * ui-layout / ui-sidebar therefore does not matter, and neither does a shell
 * that cannot serve the seats (the callback simply never runs).
 *
 * @module @linxin666/dsh-client-ui-task-board/client
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { TASK_BOARD_PANEL_ID, type BoardController } from '../core/controller.ts'
import { TaskBoard } from './board/TaskBoard.tsx'
import { seatsFromRenderSlot, TaskBoardSeatsProvider, type SlotRenderBinding } from './seats.tsx'
import { t } from './locales.ts'
import css from './board.module.css'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export { TASK_BOARD_PANEL_ID }

/** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
const PANEL_ORDER = 20

/**
 * The sidebar row glyph the shell asks for at its own size and active state.
 * The shell owns the button, label, tooltip and rail geometry; this component
 * draws only the glyph, like every other panel row.
 *
 * The glyph carries `data-dsh-panel-entry` because it is the only DOM the
 * panel's own code owns inside that shell-owned row: the L2 contract (skins)
 * resolves which row belongs to which plugin through it, since the shell
 * stamps no per-entry hook of its own (see contracts/semantic-attrs-v1.md).
 * @param props - the shell's icon share: square edge and selection state.
 * @returns the decorative board glyph.
 */
export function TaskBoardPanelIcon({ size }: { size: number; active: boolean }): React.ReactElement {
  return (
    <svg
      data-dsh-panel-entry={TASK_BOARD_PANEL_ID}
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
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M6.5 6.5v7" />
    </svg>
  )
}

/**
 * The main-slot page. The layout mounts it only while the board is the selected
 * panel, so the conversation keeps the center column untouched the rest of the
 * time; the wrapper carries the pinned `data-dsh-taskboard-view` semantic
 * anchor (L2 contract, skins) and the container query context the board's
 * responsive rules read.
 * @param props - the framework main-slot share plus this entry's injected face.
 * @returns the board page.
 */
export function TaskBoardPanel({ controller, renderSlot }: {
  controller: BoardController
  /** Child-slot renderer the registration declares (detail, card decoration, new-card section). */
  renderSlot?: SlotRenderBinding
}): ReactNode {
  const seats = useMemo(() => seatsFromRenderSlot(renderSlot), [renderSlot])
  return (
    <div className={css.panel} data-dsh-taskboard-view="" data-dsh-plugin="task-board">
      <TaskBoardSeatsProvider value={seats}>
        <TaskBoard controller={controller} />
      </TaskBoardSeatsProvider>
    </div>
  )
}

/** The injected face both registrations receive. */
interface PanelFace {
  controller: BoardController
}

/**
 * Register the board's sidebar row and center-column page.
 *
 * Both seats are declared by shell plugins this package does not depend on at
 * runtime, so each registration is wrapped in `ctx.slots.inject`: the callback
 * runs only after the owning entry declares the seat, and a shell that never
 * declares it leaves the board simply absent instead of failing boot.
 * @param ctx - client root context (services: slots).
 * @param controller - the board controller the page and the row drive.
 * @returns disposer releasing both registrations.
 */
export function registerTaskBoardPanel(ctx: ClientContext, controller: BoardController): () => void {
  const slots = ctx.slots as {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  const disposers: Array<() => void> = []

  disposers.push(slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: TASK_BOARD_PANEL_ID,
    order: PANEL_ORDER,
    // The shell resolves this through resolveSlotLabel on every locale change,
    // so the module-level translate reads the active language at call time.
    label: () => t('entry.label'),
  }, TaskBoardPanelIcon)))

  disposers.push(slots.inject('main', () => slots.register({
    name: 'main',
    key: TASK_BOARD_PANEL_ID,
    // The board declares the provider child seats here; a provider registers
    // into them and this entry renders them through the injected renderSlot.
    children: {
      'task-board.detail.section': { kind: 'list', scope: 'root' },
      'task-board.card.decoration': { kind: 'list', scope: 'root' },
      'task-board.compose.section': { kind: 'list', scope: 'root' },
    },
    inject: (): PanelFace => ({ controller }),
  }, TaskBoardPanel as never)))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
