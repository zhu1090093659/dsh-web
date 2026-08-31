/**
 * Sidebar entry injection — package-specific wiring over the shared core.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into
 * (`sidebar.workspaces` / `sidebar.settings` are single-occupant and already
 * taken), so the entry row is injected between the shell's New Session button
 * and the workspace browser. The DOM injection / self-healing / idempotency
 * logic lives exactly once in shared/client/sidebar-entry-core.ts (synced
 * copy); this wrapper supplies the task-board icon, copy, CSS module, and the
 * board toggle. The row is plain DOM (no React tree); the board view it
 * toggles is a separate React root mounted in the center column
 * (see board-mount.ts).
 */
import type { BoardController } from '../core/controller.ts'
import { t } from './locales.ts'
import css from './board.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-taskboard-entry]'

/** Inline icon normalized to the shell's 18px navigation glyph size. */
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>'

/** Locale-change subscription the shared core asks for (ctx.locale.subscribe shape). */
export interface LocaleRefreshSource { subscribe(listener: () => void): () => void }

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the board controller the entry toggles.
 * @param locale - locale-change source; when given, re-applies the label on
 *   a Language switch (the plain-DOM row otherwise keeps the mount-time copy).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: BoardController, locale?: LocaleRefreshSource): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-taskboard-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'task-board',
    icon: ICON,
    css,
    label: () => t('entry.label'),
    refresh: locale === undefined ? undefined : { subscribe: (listener) => locale.subscribe(listener) },
    onToggle: () => { controller.toggleBoard() },
    position: 'before',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]'],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().boardOpen,
    },
  })
}
