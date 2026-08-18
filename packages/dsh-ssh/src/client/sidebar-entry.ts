/**
 * Sidebar entry injection — package-specific wiring over the shared core.
 *
 * The DOM injection / self-healing / idempotency logic lives exactly once in
 * shared/client/sidebar-entry-core.ts (synced copy); this wrapper supplies the
 * ssh icon, copy, CSS module, and the panel toggle. The row is plain DOM (no
 * React tree) so it can never disturb the shell's reconciliation; the panel
 * view it toggles is a separate React root mounted in the center column
 * (see mount.tsx).
 */
import type { PanelController } from './panel/controller.ts'
import { tt } from './panel/helpers.ts'
import css from './panel/panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-ssh-entry]'

/** Inline icon (matches the shell's 16px nav-icon look): a terminal prompt glyph. */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.5 5.5l2.5 2.5-2.5 2.5"/><path d="M8.5 10.5h3"/></svg>'

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the panel controller the entry toggles.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: PanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-ssh-entry',
    rowSelector: ENTRY_SELECTOR,
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]'],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
