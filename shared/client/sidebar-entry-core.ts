/**
 * Shared sidebar entry injection core.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into,
 * so the entry row is injected between the shell's New Session button and the
 * workspace browser. The injection self-heals: a MutationObserver watches the
 * sidebar root and re-inserts the row whenever a React re-render displaces it
 * (re-insertion happens in the same frame, before paint, so no flicker).
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the view it toggles is a separate root owned by the caller.
 *
 * Packages receive this file as a generated copy via scripts/sync-shared.mjs;
 * edit the shared source and re-run the sync instead of editing a copy.
 */

/** Per-package configuration for one sidebar entry row. */
export interface SidebarEntryOptions {
  /** Full attribute name identifying the injected row (idempotency key), e.g. 'data-dsh-ssh-entry'. */
  rowAttribute: string
  /** CSS selector matching the injected row, e.g. '[data-dsh-ssh-entry]'. */
  rowSelector: string
  /**
   * L2 semantic-attribute plugin id (issue #506, enum table:
   * skins/skin-center/contracts/semantic-attrs-v1.md). When set, the row also
   * outputs data-dsh-plugin="<id>" and data-dsh-part="sidebar-entry"; unset
   * leaves the row without semantic attributes.
   */
  plugin?: string
  /** Inline icon markup (matches the shell's 16px nav-icon look). */
  icon: string
  /** CSS module class names for the row and its two spans (entry / entryIcon / entryLabel). */
  css: Record<string, string>
  /** Localized row label (aria-label + visible text). */
  label(): string
  /** Optional localized tooltip (title attribute). */
  tooltip?(): string
  /**
   * Optional locale-change subscription: re-applies label / aria-label /
   * tooltip whenever the active locale changes. Plain-DOM rows would
   * otherwise keep the label captured at mount; pass the SDK locale runtime
   * subscription (ctx.locale.subscribe) so the row follows the language
   * switch without a reload.
   */
  refresh?: { subscribe(listener: () => void): () => void }
  /** Click action (open/toggle the owning panel). */
  onToggle(): void
  /** Family-block position: 'before' inserts ahead of sibling plugin rows, 'after' behind them. */
  position: 'before' | 'after'
  /**
   * Selectors of the sibling plugin entry rows this package orders against
   * (its own row included — the placement guard excludes a row that is
   * already inside the root). Each package passes the same list it used
   * before the consolidation so the rendered order stays stable.
   */
  familySelectors: readonly string[]
  /** Optional active-state bridge; highlights the row while the panel is open. */
  active?: {
    subscribe(listener: () => void): () => void
    isOpen(): boolean
  }
}

/** Find the sidebar shell root element, or undefined while not yet mounted. */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  // Current shells wrap the sidebar UI: column > wrapper > root(logoRow owner).
  // Prefer the element that owns the logo row — the real sidebar UI root —
  // and fall back to the column's first child for legacy shells.
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** Build the entry row (a detached button; insert once the shell is up). */
function createEntry(options: SidebarEntryOptions): { entry: HTMLButtonElement; applyLabel: () => void } {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(options.rowAttribute, '')
  if (options.plugin !== undefined) {
    entry.setAttribute('data-dsh-plugin', options.plugin)
    entry.setAttribute('data-dsh-part', 'sidebar-entry')
  }
  entry.className = options.css['entry'] ?? ''
  const labelSpan = document.createElement('span')
  labelSpan.className = options.css['entryLabel'] ?? ''
  const iconSpan = document.createElement('span')
  iconSpan.className = options.css['entryIcon'] ?? ''
  iconSpan.innerHTML = options.icon
  entry.append(iconSpan, labelSpan)
  const applyLabel = (): void => {
    entry.setAttribute('aria-label', options.label())
    if (options.tooltip !== undefined) entry.setAttribute('title', options.tooltip())
    labelSpan.textContent = options.label()
  }
  applyLabel()
  entry.addEventListener('click', options.onToggle)
  return { entry, applyLabel }
}

/** Re-insert the entry after the New Session row (before the browser region). */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement, options: SidebarEntryOptions): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    // Position relative to the family block (entries injected by sibling
    // plugins), never relative to transient logoRow geometry: every family
    // plugin that self-heals during a re-render then lands in the same
    // relative order, so the entries cannot swap positions regardless of
    // observer callback order or of shell wrapper changes. There is no
    // append-to-end fallback: appending at the end would randomly reorder
    // the block after a shell re-render.
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches(options.familySelectors.join(', ')),
    )
    const anchor = options.position === 'before'
      ? (family.length > 0 ? family[0] : base.nextElementSibling)
      : (family.length > 0 ? family[family.length - 1]!.nextElementSibling : base.nextElementSibling)
    root.insertBefore(entry, anchor)
  }
  return true
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param options - the row's attribute/icon/copy/action/ordering configuration.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(options: SidebarEntryOptions): () => void {
  // DOM-level idempotency: whatever path mounted an entry row before this
  // call (a duplicated apply, an HMR re-injection, a stale module still
  // alive), never mount a second one. The existing row keeps working; a full
  // page reload is the ultimate reset.
  if (typeof document !== 'undefined' && document.querySelector(options.rowSelector) !== null) {
    return () => {}
  }
  const { entry, applyLabel } = createEntry(options)
  let root: HTMLElement | undefined
  let placed = false
  let unsubscribeRefresh: (() => void) | undefined
  if (options.refresh !== undefined) {
    try {
      unsubscribeRefresh = options.refresh.subscribe(applyLabel)
    } catch {
      // A throwing subscription must not break the mount; the label stays at
      // its initial value and the next reload resolves it again.
    }
  }

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      // The shell rebuilt the sidebar pane (whole-tree teardown); the root
      // observer is gone with the old tree, so detach it and re-query from
      // scratch. The new pane is later noticed by the body-level watcher.
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      // Cheap short-circuit: entry still lives in a mountable subtree.
      if (document.body.contains(entry)) return
      // Entry was torn down together with the old tree; reset and re-place.
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry, options)
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true })
    }
  }

  // Body-level watcher retained as the "whole rebuild" fallback: when the shell
  // tears down the whole sidebar pane, the root observer is gone with it and
  // only this body observation can notice the new pane mounting. It is no
  // longer disconnected after placement; the placed-and-still-mounted case
  // short-circuits through the cheap document.body.contains(entry) check, so
  // unrelated app mutations (e.g. chat streaming) cost one contains check
  // instead of churning the full re-query.
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  // Self-heal: if a React re-render displaces the row, re-insert it in the
  // same frame (microtask before paint -> no visible flicker).
  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry, options)
    }
  })

  // Reflect the panel's open state on the row (active highlight). Note: assigning
  // undefined to dataset.active materializes data-active="undefined" and keeps the
  // row permanently highlighted — delete the attribute instead.
  const unsubscribeActive = options.active === undefined ? undefined : (() => {
    const syncActive = (): void => {
      if (options.active!.isOpen()) entry.dataset.active = 'true'
      else delete entry.dataset.active
    }
    const unsubscribe = options.active.subscribe(syncActive)
    syncActive()
    return unsubscribe
  })()

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeRefresh?.()
    unsubscribeActive?.()
    entry.remove()
  }
}
