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

/** Inline terminal glyph sized to the shell's current sidebar navigation icons. */
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.75"/><path d="M4.25 5.25l2.75 2.75-2.75 2.75"/><path d="M8.5 10.75h3.25"/></svg>'

/** Locale-change subscription the shared core asks for (ctx.locale.subscribe shape). */
export interface LocaleRefreshSource { subscribe(listener: () => void): () => void }

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the panel controller the entry toggles.
 * @param locale - locale-change source; when given, re-applies the label on
 *   a Language switch (the plain-DOM row otherwise keeps the mount-time copy).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: PanelController, locale?: LocaleRefreshSource): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-ssh-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'ssh',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    refresh: locale === undefined ? undefined : { subscribe: (listener) => locale.subscribe(listener) },
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]'],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
