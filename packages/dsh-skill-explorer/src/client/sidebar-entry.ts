/**
 * Sidebar entry injection — package-specific wiring over the shared core.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into,
 * so — following the task-board / dsh-ssh precedent of DOM-level extension —
 * the entry row is injected between the shell's New Session button and the
 * workspace browser. The DOM injection / self-healing / idempotency logic
 * lives exactly once in shared/client/sidebar-entry-core.ts (synced copy);
 * this wrapper supplies the skill-explorer icon, copy, CSS module, and the
 * overlay toggle. The row is plain DOM (no React tree); clicking it toggles
 * the skill center overlay (see SkillPanel.tsx).
 */
import { tt } from './panel-helpers.ts'
import css from './skill-panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-skill-explorer-entry]'

/** Inline book icon normalized to the shell's 18px navigation glyph size. */
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.2C6.6 2 4.5 2 3 2v10.5c1.5 0 3.6 0 5 1.3 1.4-1.3 3.5-1.3 5-1.3V2c-1.5 0-3.6 0-5 1.2z"/><path d="M8 3.2v10.6"/></svg>'

/** Locale-change subscription the shared core asks for (ctx.locale.subscribe shape). */
export interface LocaleRefreshSource { subscribe(listener: () => void): () => void }

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param onClick - opens the skill center overlay.
 * @param locale - locale-change source; when given, re-applies the label on
 *   a Language switch (the plain-DOM row otherwise keeps the mount-time copy).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(onClick: () => void, locale?: LocaleRefreshSource): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-skill-explorer-entry',
    rowSelector: ENTRY_SELECTOR,
    // L2 plugin id (issue #506): makes the row carry data-dsh-plugin +
    // data-dsh-part="sidebar-entry" like the task-board / ssh entries.
    plugin: 'skill-explorer',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    refresh: locale === undefined ? undefined : { subscribe: (listener) => locale.subscribe(listener) },
    onToggle: onClick,
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-skill-explorer-entry]'],
  })
}
