/**
 * dsh-web compat shim, browser half (folded into the aggregate package).
 *
 * The current dsh web shell renders its grid columns without the legacy
 * `data-pane` / `data-dsh-frame` hooks (the columns carry css-module class
 * names such as `*_sidebarCol` / `*_centerCol` / `*_detailsCol`). The
 * dsh-web family plugins (task-board, ssh, several skins)
 * mount at the DOM level through those legacy selectors, so without them the
 * plugins stay silent even though they load.
 *
 * This shim stamps the expected attributes onto the real shell elements and
 * re-applies them on any DOM mutation (React re-renders that re-create the
 * columns), which restores every DOM-mounting plugin and the skins' column
 * selectors in one place. It only ever WRITES attributes; it never removes
 * nodes and never disturbs React's reconciliation.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Column shims: element selector → attribute to stamp. */
const COLUMN_SHIMS: ReadonlyArray<readonly [selector: string, attribute: string]> = [
  ['[class*="sidebarCol"]', 'data-pane="sidebar"'],
  ['[class*="centerCol"]', 'data-pane="conversation"'],
  ['[class*="detailsCol"]', 'data-pane="details"'],
]

/** Stable hooks consumed by the responsive compat layer (never text/hash selectors). */
export const RESPONSIVE_CSS = `
[data-dsh-frame] { min-height: 0; }
[data-dsh-frame] [data-dsh-responsive-part="composer"],
[data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"],
  [data-dsh-frame] [data-dsh-responsive-part="menu"] { touch-action: manipulation; }
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"] { min-width: 44px; min-height: 44px; }
  [data-dsh-frame] {
    height: 100dvh;
    min-height: 100dvh;
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 100%;
    padding-bottom: env(safe-area-inset-bottom);
  }
  [data-dsh-frame] [data-pane="sidebar"] {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 1100;
    width: min(88vw, 320px) !important;
    max-width: 100%;
    box-shadow: 0 12px 32px rgb(0 0 0 / 24%);
    transform: translateX(0);
    transition: transform 160ms ease;
  }
  [data-dsh-frame]:not([data-sidebar-collapsed])::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgb(0 0 0 / 24%);
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] {
    width: 52px !important;
    transform: none;
    pointer-events: none;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :not(:first-child),
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :first-child > :not([data-dsh-responsive-part="sidebar-toggle"]) {
    display: none !important;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"],
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child { background: transparent !important; }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] [data-dsh-responsive-part="sidebar-toggle"] {
    pointer-events: auto;
    display: inline-flex !important;
  }
  /* Center-view plugins own this marker; the aggregate shell owns its mobile offset. */
  [data-dsh-frame][data-sidebar-collapsed] [data-dsh-center-view-back] {
    margin-inline-start: 52px;
  }
  [data-dsh-frame] [data-pane="conversation"] {
    min-width: 0;
    width: 100%;
    min-height: 0;
  }
  [data-dsh-frame] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame]:not([data-details-collapsed]) [data-pane="details"] {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1000;
    width: 100%;
    background: var(--dsw-alias-bg-base);
  }
  [data-dsh-frame][data-details-collapsed] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="composer"] {
    max-width: 100%;
    padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
  }
  [data-dsh-frame] [data-slot="conversation.composer"],
  [data-dsh-frame] [data-composer-card],
  [data-dsh-frame] [data-input-scroll] {
    min-width: 0;
    max-width: 100%;
  }
  [data-dsh-frame] [data-composer-card] > :last-child {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] {
    min-width: 0;
    max-width: 45%;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] :is(button, span) {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-dsh-frame] textarea[data-phase] {
    min-width: 0;
    font-size: 16px;
  }
  [data-dsh-part="summon-button"] {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 40 !important;
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
    padding: 0 !important;
    border-radius: 50% !important;
    font-size: 0 !important;
  }
  [data-dsh-part="summon-button"]::before {
    content: "";
    display: block;
    width: 18px;
    height: 13px;
    margin: auto;
    border: 2px solid currentColor;
    border-radius: 55% 65% 45% 55%;
    transform: rotate(-8deg);
  }
  [data-dsh-frame] [data-dsh-responsive-part="code"] {
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  [data-dsh-frame] [data-dsh-responsive-part="menu"] {
    max-width: min(92vw, 360px);
  }
}
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="conversation-header"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(32px, auto) minmax(44px, auto);
    column-gap: 8px;
    padding: 8px 8px 0 60px !important;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-row"] {
    display: contents;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-cluster"] {
    box-sizing: border-box;
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    padding-inline-end: 44px;
    overflow: hidden;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    margin-top: 0;
    padding-left: 0;
    gap: 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] > [role="tab"] {
    min-height: 44px;
    flex: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] {
    grid-column: 2;
    grid-row: 2;
    z-index: 2;
    max-width: 42vw;
    min-height: 44px;
    margin-left: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] :is(button, [role="button"]) {
    min-width: 44px;
    min-height: 44px;
    flex: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-frame] [data-pane="sidebar"] { transition: none; }
  [data-dsh-boot-splash] { transition: none; }
}
[data-dsh-boot-splash] {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--dsw-alias-bg-base, #1e1e20);
  opacity: 1;
  pointer-events: none;
  transition: opacity 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
[data-dsh-boot-splash][data-ready] {
  opacity: 0;
}
`

function ensureResponsiveStyle(): HTMLStyleElement {
  const existing = document.querySelector<HTMLStyleElement>('style[data-dsh-compat="responsive"]')
  if (existing !== null) return existing
  const style = document.createElement('style')
  style.dataset.dshCompat = 'responsive'
  style.textContent = RESPONSIVE_CSS
  document.head.appendChild(style)
  return style
}

function stampSemanticParts(frame: Element): boolean {
  let changed = false
  const mark = (element: Element, part: string): void => {
    if (element.getAttribute('data-dsh-responsive-part') === part) return
    element.setAttribute('data-dsh-responsive-part', part)
    changed = true
  }
  frame.querySelectorAll<HTMLElement>('[data-slot="conversation.composer"], [data-composer-card], [data-input-scroll], textarea[data-phase], [contenteditable="true"]').forEach(element => mark(element, 'composer'))
  frame.querySelectorAll<HTMLElement>('pre').forEach(element => mark(element, 'code'))
  frame.querySelectorAll<HTMLElement>('[role="menu"], [data-subagent-menu]').forEach(element => mark(element, 'menu'))
  frame.querySelectorAll<HTMLElement>('[role="treeitem"]:not([data-dsh-part])').forEach(element => mark(element, 'sidebar-entry'))
  const conversation = frame.querySelector<HTMLElement>('[data-pane="conversation"]')
  const headerSlot = conversation?.querySelector<HTMLElement>('[data-slot="conversation.session.header"]')
  const slottedHeader = headerSlot?.querySelector<HTMLElement>(':scope > header') ?? null
  const scrollport = conversation?.querySelector<HTMLElement>('[data-conversation-scroll]') ?? null
  const siblingHeader = scrollport?.previousElementSibling ?? null
  const conversationHeader = slottedHeader
    ?? (siblingHeader?.tagName === 'HEADER' && siblingHeader.parentElement === scrollport?.parentElement ? siblingHeader : null)
  if (conversationHeader !== null) {
    mark(conversationHeader, 'conversation-header')
    const titleRow = conversationHeader.firstElementChild
    if (titleRow !== null && titleRow.getAttribute('role') !== 'tablist') {
      mark(titleRow, 'session-title-row')
      const titleCluster = titleRow.firstElementChild
      const utilities = titleCluster?.nextElementSibling
      if (titleCluster !== null && titleCluster !== undefined) mark(titleCluster, 'session-title-cluster')
      if (utilities !== null && utilities !== undefined) mark(utilities, 'session-utilities')
    }
    const tablist = conversationHeader.querySelector<HTMLElement>(':scope > [role="tablist"]')
    if (tablist !== null) mark(tablist, 'session-tablist')
  }
  const sidebar = frame.querySelector<HTMLElement>('[data-pane="sidebar"]')
  const sidebarSlot = sidebar?.querySelector<HTMLElement>(':scope > [data-slot="sidebar"]')
  const logoRow = sidebarSlot?.firstElementChild?.firstElementChild
  const logoButtons = logoRow?.querySelectorAll<HTMLElement>(':scope > button, :scope > [role="button"]')
  const toggle = logoButtons?.item((logoButtons.length || 1) - 1)
  if (toggle !== null && toggle !== undefined) mark(toggle, 'sidebar-toggle')
  return changed
}

function installMobileSidebarDismiss(frame: HTMLElement): () => void {
  let raf = 0
  const onClick = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 768px)').matches) return
    const sidebar = frame.querySelector<HTMLElement>('[data-pane="sidebar"]')
  const toggle = frame.querySelector<HTMLElement>('[data-dsh-responsive-part="sidebar-toggle"]')
    if (!frame.hasAttribute('data-sidebar-collapsed') && sidebar !== null && !sidebar.contains(target)) {
      event.preventDefault()
      event.stopPropagation()
      toggle?.click()
      return
    }
    if (target.closest('[data-dsh-responsive-part="sidebar-toggle"]') !== null) return
    if (target.closest('[data-dsh-part="sidebar-entry"], [role="treeitem"]') === null) return
    if (raf !== 0) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      if (!frame.hasAttribute('data-sidebar-collapsed')) {
        toggle?.click()
      }
    })
  }
  frame.addEventListener('click', onClick, true)
  return () => {
    frame.removeEventListener('click', onClick, true)
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}

/** One pass over the current DOM. Returns false once every stamp is already in place. */
function applyShims(): boolean {
  let changed = false
  for (const [selector, attribute] of COLUMN_SHIMS) {
    const el = document.querySelector(selector)
    const eq = attribute.indexOf('=')
    const name = attribute.slice(0, eq)
    const value = attribute.slice(eq + 1).replace(/^"|"$/g, '')
    if (el !== null && el.getAttribute(name) !== value) {
      el.setAttribute(name, value)
      changed = true
    }
  }
  // The frame is the grid item that parents the sidebar column.
  const frame = document.querySelector('[class*="sidebarCol"]')?.parentElement ?? null
  if (frame !== null && frame.getAttribute('data-dsh-frame') !== '') {
    frame.setAttribute('data-dsh-frame', '')
    changed = true
  }
  if (frame !== null) changed = stampSemanticParts(frame) || changed
  return changed
}

/**
 * Coalesce mutation bursts into one pass per frame. React renders burst
 * dozens of subtree mutations per commit; stamping on every single mutation
 * callback turned each render into many querySelector sweeps. A scheduled
 * rAF plus a done flag folds the whole burst into a single pass, and the
 * idempotence check stops the work entirely once every attribute is set.
 */
function schedulePass(): void {
  if (shimScheduled) return
  shimScheduled = true
  requestAnimationFrame(() => {
    shimScheduled = false
    applyShims()
    shimAfterPass?.()
  })
}

/** True while a coalesced pass is pending. */
let shimScheduled = false
let shimAfterPass: (() => void) | undefined

function installBootShield(): { dismiss: () => void; remove: () => void } {
  if (typeof document === 'undefined') return { dismiss: () => {}, remove: () => {} }
  let splash = document.querySelector<HTMLElement>('div[data-dsh-boot-splash]')
  if (splash === null) {
    splash = document.createElement('div')
    splash.setAttribute('data-dsh-boot-splash', '')
    document.body.appendChild(splash)
  }
  let dismissed = false
  let fadeTimer = 0
  const dismiss = (): void => {
    if (dismissed) return
    dismissed = true
    splash?.setAttribute('data-ready', '')
    fadeTimer = window.setTimeout(() => {
      splash?.remove()
    }, 180)
  }
  const timeout = window.setTimeout(dismiss, 1000)
  return {
    dismiss,
    remove: () => {
      window.clearTimeout(timeout)
      window.clearTimeout(fadeTimer)
      splash?.remove()
    },
  }
}

/** Required services: none — the shim must run before any DOM mount waits. */
export const inject = [] as const

/**
 * Register the shim for the page lifetime.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const responsiveStyle = ensureResponsiveStyle()
    const bootShield = installBootShield()
    applyShims()
    let removeMobileDismiss = (): void => {}
    let dismissFrame: HTMLElement | null = null
    const ensureMobileDismiss = (): void => {
      const frame = document.querySelector<HTMLElement>('[data-dsh-frame]')
      if (frame !== null) {
        bootShield.dismiss()
      }
      if (frame === null || frame === dismissFrame) return
      removeMobileDismiss()
      removeMobileDismiss = installMobileSidebarDismiss(frame)
      dismissFrame = frame
    }
    ensureMobileDismiss()
    shimAfterPass = ensureMobileDismiss
    // The shell renders after boot settlement and React can re-create the
    // columns on re-render; re-stamp on any DOM mutation. The callback only
    // schedules a coalesced pass — mutations never run the sweep inline, and
    // the pass short-circuits once every attribute is in place. Writes only
    // the same attribute values, so this never fights React.
    const observer = new MutationObserver(() => {
      schedulePass()
      ensureMobileDismiss()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      bootShield.remove()
      responsiveStyle.remove()
      removeMobileDismiss()
      shimAfterPass = undefined
      shimScheduled = false
    }
  })
}
