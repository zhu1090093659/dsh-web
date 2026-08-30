/**
 * Portrait-touch adaptation of the OFFICIAL desktop Web GUI (the dsh-LAN
 * approach): while a touch device is in portrait, inject a CSS + gesture
 * layer on top of the running SPA instead of maintaining a second UI. The
 * official layout already auto-collapses the sidebar below 1024px; this
 * layer adds touch-target sizing, 16px inputs (iOS focus zoom), safe-area
 * padding, a floating whale button as the collapsed-sidebar entry (with a
 * verified toggle fallback for cohorts whose layout face mounts inert),
 * swipe gestures, long-press session menus, a bottom-sheet composer picker
 * (model / effort / permission menus), desktop-surface suppression, and
 * composer/header compaction.
 * Landscape, desktop, and wide viewports stay untouched; a manual
 * sessionStorage opt-out (dsh-remote-force-desktop=1) disables the layer.
 *
 * Selector strategy: CSS Modules class names are hash-prefixed with the
 * semantic name as a stable suffix (`pI_x6G_centerCol`), so attribute
 * suffix selectors survive official rebuilds that only change the hash. The
 * semantic names were read off the 0.1.2-alpha.1 official client build and
 * are re-verified on every GUI QA round; rules borrowed from the dsh-LAN
 * reference (MIT, v47-v78) keep their version comments.
 * @module @linxin666/dsh-remote-web-ui/client/mobile-adapt
 */

/** The window global the plugin apply() wires the layout service into. */
export interface RemoteAdaptGlobal {
  evaluate: () => void
  /** Wired by the plugin apply once ctx.layout is live. */
  toggleSidebar: (() => void) | null
  /** Wired by the plugin apply once ctx.layout is live. */
  closeDetails: (() => void) | null
  /** Plugin master switch: false reverts the layer, true re-evaluates. */
  setEnabled(on: boolean): void
  /** Replays a pending closeDetails once the layout face is wired (the first apply ran before the wiring). */
  flushCloseDetails(): void
}

/** Storage key for the manual desktop opt-out. */
const FORCE_DESKTOP_KEY = 'dsh-remote-force-desktop'
/** Storage key for the dragged whale position. */
const WHALE_POS_KEY = 'dsh-remote-whale-pos'
/** Injected stylesheet identity. */
const ADAPT_CSS_ID = 'dsh-remote-web-ui/mobile-adapt.css'
/** Body class while the adaptation is active. */
const ACTIVE_CLASS = 'dsh-remote-portrait'
/** Body class while the collapsed rail is hidden behind the whale. */
const RAIL_HIDDEN_CLASS = 'dsh-remote-rail-hidden'
/** Whale button id. */
const WHALE_ID = 'dshRemoteWhale'
/** Compact picker: synthesized model button id. */
const MODEL_BTN_ID = 'dshRemoteModelPick'
/** Compact picker: synthesized effort button id. */
const EFFORT_BTN_ID = 'dshRemoteEffortPick'
/** Body class while the compact picker buttons are wired. */
const COMPACT_CLASS = 'dsh-remote-compact-picker'

/**
 * Whether the current viewport is a portrait touch device small enough to
 * need the adaptation.
 */
function isMobilePortrait(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  if (!window.matchMedia('(orientation: portrait)').matches) return false
  if (!window.matchMedia('(pointer: coarse)').matches) return false
  if (window.innerWidth >= 1100) return false
  if (window.sessionStorage.getItem(FORCE_DESKTOP_KEY) === '1') return false
  return true
}

/**
 * The injected rules. Grouped by surface; version comments trace rules back
 * to the dsh-LAN reference they were ported from.
 */
const ADAPT_CSS: readonly string[] = [
  'html,body{height:100%}',
  // The app frame fills the dynamic viewport (browser chrome collapse).
  '[class$="_frame"]{width:100%;height:100dvh}',
  // Collapsed rail: bigger touch targets.
  '[class$="_railFish"] button,[class$="_panelIcon"],[class$="_newSession"]{min-width:44px;min-height:44px}',
  // Message list padding on narrow screens.
  '[class$="_scroll"]{padding:8px 10px}',
  // 16px inputs prevent iOS focus zoom; keep the send button touchy.
  '[class$="_input"],textarea,input{font-size:16px}',
  '[class$="_composer"]{padding-bottom:calc(4px + env(safe-area-inset-bottom))}',
  // v50: slightly smaller type on portrait phones.
  '[class$="_scrollBody"] [class$="_root"]{font-size:14.5px}',
  '[class$="_scrollBody"] [class$="_bubble"]{font-size:14.5px}',
  '[class$="_titleRow"] *{font-size:13px}',
  '[class$="_sidebarCol"] [class$="_root"],[class$="_sidebarCol"] [class$="_newSession"],[class$="_sidebarCol"] [class$="_trigger"],[class$="_sidebarCol"] [class$="_title"]{font-size:13px}',
  '[class$="_sidebarCol"] [class$="_meta"],[class$="_sidebarCol"] [class$="_time"]{font-size:11.5px}',
  // v50: collapsed rail hidden; the whale button is the entry. The frame's
  // grid is inline-styled (56px rail track when collapsed); pin the first
  // track to 0 so content uses the full width. On portrait phones the
  // details track is always 0 (computeColumns drops it when there is no
  // room), so the three-track override is safe here.
  '[class$="_frame"][data-sidebar-collapsed]{grid-template-columns:0 minmax(0,1fr) 0 !important}',
  // Keep the chat header title clear of the floating whale.
  `body.${RAIL_HIDDEN_CLASS} [class$="_titleRow"]{padding-left:52px}`,
  // The whale button itself.
  `#${WHALE_ID}{position:fixed;top:calc(4px + env(safe-area-inset-top));left:calc(8px + env(safe-area-inset-left));z-index:2147482999;width:34px;height:34px;min-width:34px;padding:0;border-radius:10px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.25)}`,
  `#${WHALE_ID} svg{width:20px;height:15px;display:block}`,
  `#${WHALE_ID}:active{opacity:.72}`,
  `#${WHALE_ID}{touch-action:none}`,
  // v51/v52: smaller collapse toggle in the expanded sidebar (the toggle
  // carries two classes, so match by containment); v47's panelIcon touch
  // rule forces a 44px min on the icon itself — zero it out so the 13px
  // glyph fits the 18px button.
  '[class$="_sidebarCol"] [class$="_logoRow"] [class*="_iconButton"]{width:18px;height:18px}',
  '[class$="_sidebarCol"] [class$="_logoRow"] [class*="_iconButton"] svg{width:13px;height:13px;min-width:0;min-height:0}',
  // v77: workspace rows' right-side actions (menu + new session) are
  // hover-only on desktop; always show them on mobile touch.
  '[class$="_sidebarCol"] [class$="_projectRow"] [class$="_rowActions"]{display:inline-flex}',
  // v78: mobile long-press on a row must not start native drag.
  '[class$="_sidebarCol"] [class$="_sessionRow"],[class$="_sidebarCol"] [class$="_projectRow"]{-webkit-user-drag:none;user-select:none}',
  // Hide the header Session-log download button (no space on phones).
  '[class$="_headerUtilities"]{display:none}',
  // v52 composer: the two lines (permission / model) stay stacked with zero
  // row gap; the command, context-meter and send/stop buttons float at the
  // left/right edges vertically centered over both lines.
  '[class$="_composerSeat"] [class$="_card"]{margin-bottom:1px}',
  '[class$="_composerSeat"] [class$="_row"]{flex-wrap:wrap;row-gap:0;padding:2px 8px 1px;position:relative}',
  '[class$="_composerSeat"] [class$="_add"]{position:absolute;left:8px;top:50%;transform:translateY(-50%)}',
  '[class$="_composerSeat"] [class$="_modes"]{min-width:0;padding-left:38px}',
  // Model line left-aligned with the permission line (same command-button
  // clearance), rows stay tightly stacked.
  '[class$="_composerSeat"] [class$="_trailing"]{flex-basis:100%;position:relative;min-height:32px;justify-content:flex-start;padding-left:38px;padding-right:78px}',
  '[class$="_composerSeat"] [class$="_trailing"] *{font-size:12px}',
  // v54: smaller permission/model buttons (font + height). v79: the
  // permission trigger collapses to its shield icon on phones — the label
  // text is the first thing a narrow row drops (the icon color carries the
  // state), matching the dsh-LAN compact composer.
  '[class$="_composerSeat"] [class$="_modes"] [class$="_trigger"]{height:24px;min-height:24px;font-size:12px}',
  '[class$="_composerSeat"] [class$="_trailing"] [class$="_trigger"]{height:24px;min-height:24px;font-size:11px}',
  // Context meter + send/stop float at the right edge, vertically centered
  // over both lines (the meter's root contains the track).
  '[class$="_composerSeat"] [class$="_trailing"] > [class$="_root"]:has([class$="_track"]){position:absolute;right:52px;top:50%;transform:translateY(-50%)}',
  '[class$="_composerSeat"] [class$="_primary"]{position:absolute;right:8px;top:50%;transform:translateY(-50%)}',
  // v79: the model picker menu anchors right:0 to its narrow trigger, so on
  // a phone both the picker menu and the model list fly past the left
  // viewport edge (model names unreadably cut). Turn the picker into a
  // bottom sheet: the composer seat carries an identity transform, which
  // would still become the containing block for fixed children, so free it
  // first; then pin every seat menu to the viewport bottom with real touch
  // targets. Covers the picker, the model list, and the other composer
  // popovers (permission presets, attachments) alike.
  '[class$="_composerSeat"]{transform:none !important}',
  '[class$="_composerSeat"] [class$="_menu"]{position:fixed !important;left:8px !important;right:8px !important;top:auto !important;bottom:calc(8px + env(safe-area-inset-bottom)) !important;width:auto !important;max-width:none !important;max-height:70dvh !important;overflow-y:auto !important;z-index:2147482000}',
  '[class$="_composerSeat"] [class$="_menu"] [class$="_cell"]{height:44px;min-height:44px;font-size:13px}',
  // v79 (compact picker): when the row is too narrow for the desktop text
  // triggers, the phone falls back to icon entries — the context ring stays
  // official, and two synthesized buttons open the picker sheet straight on
  // the model list and the effort list (drill-through, so one tap lands on
  // the same list the user's mock shows). The original text trigger hides
  // only while the wired buttons exist (body class): a failed wiring
  // degrades back to the usable text trigger instead of no picker.
  `body.${COMPACT_CLASS} [class$="_composerSeat"] [class$="_trailing"] [class$="_trigger"]:has([class$="_triggerEffort"]){display:none}`,
  // The icon buttons sit inline in the tools row (parallel to the
  // permission trigger), so the trailing line collapses to zero and the
  // context ring + send re-anchor to the row itself. The ring shifts a
  // few px right: at its desktop offset its hit box kisses the effort
  // button.
  `body.${COMPACT_CLASS} [class$="_composerSeat"] [class$="_trailing"]{flex-basis:auto;position:static;min-height:0;padding:0;width:0}`,
  `body.${COMPACT_CLASS} [class$="_composerSeat"] [class$="_trailing"] > [class$="_root"]:has([class$="_track"]){right:44px}`,
  `#${MODEL_BTN_ID},#${EFFORT_BTN_ID}{width:26px;height:32px;min-width:26px;padding:0;border-radius:9px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;margin-left:4px}`,


  `#${MODEL_BTN_ID} svg,#${EFFORT_BTN_ID} svg{width:16px;height:16px;display:block}`,
  `#${MODEL_BTN_ID}:active,#${EFFORT_BTN_ID}:active{opacity:.7}`,
  // Bottom stats line (N rounds / M steps) two sizes below the tabs; v55
  // wraps freely but clamps at two lines (the official rule is nowrap +
  // single-line ellipsis); v60 drops the official 32px right padding.
  '[class$="_composerSeat"] [data-slot="conversation.composer.dock"] [class$="_root"]{font-size:10px;white-space:normal;word-break:break-word;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:left;line-height:13px;letter-spacing:-0.2px;padding-left:0;padding-right:0}',
  // (user bubbles keep the v50 14.5px via the _bubble rule.)
  '[class$="_scrollBody"] [class$="_root"]{font-size:13px}',
  // v58/v65 port note: the dsh-LAN `_body` gap:6px compaction is deliberately
  // NOT ported. The official message row is a shrinkable flex column whose
  // bottom-anchored body then measures shorter than its text (13px root font
  // on a fixed 24px line box), and the extra gap pushed the first text line
  // above the row box — every assistant message clipped its top half on the
  // phone (verified on the real GUI; the removal restores natural heights).
  // v58/v65: on touch, taps leave :hover/:focus stuck, so official Tooltip
  // bubbles stay visible on mobile. The bubble class hash sits AFTER the
  // name, so match by containment, still scoped by role=tooltip so user
  // message bubbles (no tooltip role) stay visible.
  '[class*="_bubble"][role="tooltip"]{display:none}',
  // v65: PlanReviewPanel shares the _frame/_card suffixes and overflows a
  // narrow phone; pin it to the viewport with border-box and cap its height
  // so the card sits fully on screen.
  '[class$="_composerSeat"] [class$="_frame"]{box-sizing:border-box;width:100%;max-width:100%;padding-left:12px;padding-right:12px;height:auto;max-height:calc(100dvh - 96px);align-items:flex-start;overflow-y:auto}',
  '[class$="_composerSeat"] [class$="_frame"] [class$="_card"]{max-width:none;width:100%}',
  // v67: header actions (agent-preset mode label + background-task badge)
  // are re-seated from the title row into the tabs row; hidden in the
  // original spot so React re-renders do not flicker them back.
  '[class$="_header"] [class$="_titleCluster"] [class$="_headerActions"]{display:none}',
  // The official header keeps a 78px right padding on phones; stretch the
  // tabs row so the seated actions sit flush against the right edge
  // (verified 360/390/480 on the reference).
  '[class$="_header"] [class$="_tabs"]{margin-right:-58px}',
  // v70: match the tab text size with the seated mode label (12px); NB
  // [class$="_tab"] misses the active tab (its class ends in "_tabActive")
  // — containment so BOTH tabs match.
  '[class$="_header"] [class$="_tabs"] [class*="_tab"]{font-size:12px;white-space:nowrap}',
  // Text-bottom alignment is dynamic (alignActionsText below); flex seat.
  '[class$="_header"] [class$="_tabs"] [class$="_headerActions"]{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none}',
  // Mobile scope: hide the plugin surfaces that do not fit a phone — the
  // right-hand details column and every desktop-oriented tool surface. The
  // list keys on the L2 semantic roots (data-dsh-plugin, ownership stays
  // with the declaring plugin), so official class churn cannot resurrect
  // them. These are render suppressions: the client bundles still load.
  // The pet is part of the hidden set by design: the mobile remote mirror
  // carries the desktop-less phone surface, and a floating pet would only
  // cover the small viewport. The suppression is the requirement, not a bug.
  `body.${ACTIVE_CLASS} [class$=\"_detailsCol\"]{display:none !important}`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"ssh\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"skill-explorer\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"task-board\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"git-graph\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"pet\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"perf\"],`,
  `body.${ACTIVE_CLASS} [data-dsh-plugin=\"usage\"]{display:none !important}`,
  // The official workbench (Files / source control) mounts into a
  // full-viewport portal layer with no data-dsh-plugin root, so the plugin
  // list above cannot key on it; its open state persists across page loads,
  // and on a phone it covers the entire conversation with no visible close
  // control — the remote-opens-to-an-empty-screen report. Hide the
  // workbench panel only: the same portal layer also hosts the settings
  // modal, which must stay reachable (verified in the GUI QA round).
  `body.${ACTIVE_CLASS} [class$=\"_overlayLayer\"] [class$=\"_workbench\"]{display:none !important}`,
  // v68: settings modal on mobile — the official panel is a fixed 800px
  // two-column layout (nav + content); switch to a column layout: the
  // section nav becomes a horizontal scrollable row on top.
  '[class$="_overlay"] [class$="_panel"]{flex-direction:column;max-height:calc(100dvh - 32px)}',
  '[class$="_overlay"] [class$="_panel"] [class$="_nav"]{flex-direction:row;gap:4px;width:100%;padding:12px 12px 0;overflow-x:auto;overflow-y:hidden}',
  '[class$="_overlay"] [class$="_panel"] [class$="_navTitle"]{display:none}',
  '[class$="_overlay"] [class$="_panel"] [class$="_navList"]{flex-direction:row;gap:4px}',
  '[class$="_overlay"] [class$="_panel"] [class$="_navCell"]{height:34px;padding:0 12px;gap:6px;flex:none;border-radius:10px}',
  '[class$="_overlay"] [class$="_panel"] [class$="_navLabel"]{font-size:13px}',
  '[class$="_overlay"] [class$="_panel"] [class$="_content"]{flex:1;min-height:0}',
]

/** Cube glyph for the compact model button (a plain box outline). */
const CUBE_ICON = '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'
/** Level glyph for the compact effort button (three rising bars). */
const LEVELS_ICON = '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>'

/** The DeepSeek fish glyph (the official brand mark path). */
const FISH_PATH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018Z'

/**
 * Install the adaptation layer. Runs once per page (idempotent); the
 * evaluate loop re-applies on orientation/resize and reverts off-portrait.
 */
export function startMobileAdapt(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if ((window as unknown as { __dshRemoteAdaptInstalled?: boolean }).__dshRemoteAdaptInstalled === true) return
  ;(window as unknown as { __dshRemoteAdaptInstalled?: boolean }).__dshRemoteAdaptInstalled = true

  const w = window as unknown as { __dshRemoteAdapt?: RemoteAdaptGlobal } & Record<string, unknown>
  let active = false
  let savedViewportContent: string | null = null
  let whaleEl: HTMLButtonElement | null = null
  let whaleObserver: MutationObserver | null = null
  let whaleTimer: number | null = null
  let whaleSuppressClick = false
  let whaleShown = false
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null
  let swipeTouch: { x: number; y: number; id: number } | null = null
  let lastComposerTap = 0
  // Plugin master switch: the module-scope layer installs before any config
  // is readable, so the plugin apply() flips this through setEnabled() once
  // the settings snapshot settles (disabled plugin = no injected surface).
  let adaptEnabled = true

  /**
   * Idempotently (re-)install the adaptation stylesheet. The rules live in
   * one <style> tag keyed by data-plugin-css; the sync tick re-runs this so
   * a tag lost to any external DOM cleanup is restored within one tick
   * instead of silently dropping the suppressions (portrait pet hiding,
   * rail compaction) while the body class stays.
   */
  function ensureAdaptStyle(): void {
    if (document.querySelector(`style[data-plugin-css="${ADAPT_CSS_ID}"]`) !== null) return
    const tag = document.createElement('style')
    tag.dataset.plugin = 'remote-web-ui'
    tag.dataset.pluginCss = ADAPT_CSS_ID
    tag.textContent = ADAPT_CSS.join('')
    document.head.appendChild(tag)
  }

  function apply(): void {
    if (active) return
    active = true
    document.body.classList.add(ACTIVE_CLASS)
    // A details panel opened before the viewport rotated into portrait (or
    // restored across reloads) would sit behind the display:none above;
    // closing it through the official face unmounts the surface entirely.
    // The layout face throws by design when the root entry has not mounted
    // yet (boot-order), which is a tolerated no-op here — the plugin apply
    // replays it through flushCloseDetails once the wiring is live.
    try {
      w.__dshRemoteAdapt?.closeDetails?.()
    } catch {}
    ensureAdaptStyle()
    // viewport-fit=cover enables env(safe-area-inset-*); restore on revert.
    const meta = document.querySelector('meta[name=viewport]')
    if (meta instanceof HTMLMetaElement && meta.getAttribute('content') !== null && !(meta.getAttribute('content') ?? '').includes('viewport-fit')) {
      savedViewportContent = meta.getAttribute('content')
      meta.setAttribute('content', `${savedViewportContent}, viewport-fit=cover`)
    }
    ensureWhale()
    syncWhale()
    // React builds nodes with attributes before inserting them, so
    // attribute observers miss the initial collapsed state — a light
    // interval is the reliable sync.
    setWhaleTimer(true)
    seatHeaderActions()
  }

  function revert(): void {
    if (!active) return
    active = false
    unseatHeaderActions()
    removeCompactPicker()
    document.body.classList.remove(ACTIVE_CLASS)
    document.body.classList.remove(RAIL_HIDDEN_CLASS)
    const tag = document.querySelector(`style[data-plugin-css="${ADAPT_CSS_ID}"]`)
    tag?.remove()
    const meta = document.querySelector('meta[name=viewport]')
    if (meta instanceof HTMLMetaElement && savedViewportContent !== null) {
      meta.setAttribute('content', savedViewportContent)
      savedViewportContent = null
    }
    if (whaleEl !== null) whaleEl.style.display = 'none'
    setWhaleTimer(false)
  }

  /** Start/stop the 600ms sync tick; a no-op when already in the asked state. */
  function setWhaleTimer(on: boolean): void {
    if (on && whaleTimer === null && active) {
      whaleTimer = window.setInterval(syncWhale, 600)
    } else if (!on && whaleTimer !== null) {
      window.clearInterval(whaleTimer)
      whaleTimer = null
    }
  }

  /**
   * Compact picker (v79): a phone row cannot fit the desktop text triggers,
   * so the model/effort entries become two icon buttons in the trailing
   * row. Both forward to the official picker trigger (its menu renders as
   * the bottom sheet) and then drill straight into the asked cell — model
   * list or effort list — so one tap lands on the list, matching the
   * cube-model / brain-effort mapping. The official context ring next to
   * the send button keeps its own semantics untouched.
   */
  function removeCompactPicker(): void {
    document.body.classList.remove(COMPACT_CLASS)
    document.getElementById(MODEL_BTN_ID)?.remove()
    document.getElementById(EFFORT_BTN_ID)?.remove()
  }

  function drillIntoPicker(cellPattern: RegExp): void {
    const trigger = document.querySelector('[class$="_composerSeat"] [class$="_trailing"] [class$="_trigger"]:has([class$="_triggerEffort"])') as HTMLElement | null
    if (trigger === null) return
    trigger.click()
    // The sheet mount takes a beat (observed ~0.2-0.6s on a cold phone
    // mirror); poll until the asked cell exists instead of a fixed delay.
    let tries = 0
    const tapCell = (): void => {
      tries += 1
      const cell = Array.from(document.querySelectorAll('[class$="_composerSeat"] [class$="_menu"] [class$="_cell"]'))
        .find((c) => cellPattern.test(c.textContent ?? ''))
      if (cell !== undefined) {
        ;(cell as HTMLElement).click()
        return
      }
      if (tries < 8) window.setTimeout(tapCell, 150)
    }
    window.setTimeout(tapCell, 150)
  }

  function makeCompactButton(id: string, title: string, icon: string, cellPattern: RegExp): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.id = id
    btn.type = 'button'
    btn.dataset.dshPlugin = 'remote-web-ui'
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`
    btn.addEventListener('click', () => { drillIntoPicker(cellPattern) })
    return btn
  }

  function syncCompactPicker(): void {
    if (!active) return
    const tools = document.querySelector('[class$="_composerSeat"] [class$="_tools"]')
    const trigger = tools?.parentElement?.querySelector('[class$="_triggerEffort"]')?.parentElement
    if (tools === null || trigger === null) {
      removeCompactPicker()
      return
    }
    const zh = (navigator.language ?? '').toLowerCase().startsWith('zh')
    if (document.getElementById(MODEL_BTN_ID) === null) {
      tools.appendChild(makeCompactButton(MODEL_BTN_ID, zh ? '选择模型' : 'Pick model', CUBE_ICON, /模型|Model/))
    }
    if (document.getElementById(EFFORT_BTN_ID) === null) {
      tools.appendChild(makeCompactButton(EFFORT_BTN_ID, zh ? '选择推理等级' : 'Pick reasoning effort', LEVELS_ICON, /推理等级|Reasoning|Effort/i))
    }
    document.body.classList.add(COMPACT_CLASS)
  }
  /**
   * Toggle the sidebar through the wired layout face, then verify the flip:
   * the official LayoutController can be mounted yet inert (its bound store
   * actions race the root entry on this cohort — observed on the running
   * local build, where the face call silently did nothing and the whale
   * was dead). When the frame state did not change shortly after the call,
   * drive the official rail/logo toggle instead: that button owns its own
   * store actions and flips the same state on every cohort we support.
   */
  function toggleSidebarVerified(): void {
    const frame = document.querySelector('[class$="_frame"]')
    const collapsedBefore = frame instanceof HTMLElement ? frame.hasAttribute('data-sidebar-collapsed') : null
    w.__dshRemoteAdapt?.toggleSidebar?.()
    if (collapsedBefore === null) return
    window.setTimeout(() => {
      if (!active) return
      const frameNow = document.querySelector('[class$="_frame"]')
      if (!(frameNow instanceof HTMLElement)) return
      if (frameNow.hasAttribute('data-sidebar-collapsed') !== collapsedBefore) return
      ;(document.querySelector('[class$="_railFish"] button, [class$="_logoRow"] [class*="_iconButton"]') as HTMLElement | null)?.click()
    }, 150)
  }
  function ensureWhale(): void {
    if (whaleEl !== null || !document.body) return
    const whale = document.createElement('button')
    whale.id = WHALE_ID
    whale.type = 'button'
    whale.dataset.dshPlugin = 'remote-web-ui'
    // Outside the slots i18n system (module-scope overlay), so the label
    // picks the browser language directly.
    const whaleLabel = (navigator.language ?? '').toLowerCase().startsWith('zh') ? '打开侧边栏' : 'Open sidebar'
    whale.title = whaleLabel
    whale.setAttribute('aria-label', whaleLabel)
    whale.innerHTML = `<svg viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="${FISH_PATH}" fill="currentColor"/></svg>`
    whale.addEventListener('click', () => {
      if (whaleSuppressClick) {
        whaleSuppressClick = false
        return
      }
      toggleSidebarVerified()
    })
    // v51: the whale floats — pointer-drag repositions it (persisted).
    whale.addEventListener('pointerdown', (e) => {
      if (whaleEl === null) return
      if (e.button !== 0 && e.pointerType === 'mouse') return
      // v61: opening the sidebar must not leave a focused composer input
      // behind — on phones a still-focused input makes the first tap re-pop
      // the keyboard (iOS) or keeps it open. Blur at pointerdown (before the
      // tap completes; click is too late for iOS) and block pending
      // programmatic refocus.
      if (active) {
        const ta = document.querySelector('[class$="_composerSeat"] textarea, [class$="_composerSeat"] input')
        if (ta !== null && document.activeElement === ta) {
          (ta as HTMLElement).blur()
          lastComposerTap = 0
        }
      }
      drag = { x: e.clientX, y: e.clientY, left: whale.offsetLeft, top: whale.offsetTop, moved: false }
      try { whale.setPointerCapture(e.pointerId) } catch {}
      e.preventDefault()
      e.stopPropagation()
    })
    whale.addEventListener('pointermove', (e) => {
      if (whaleEl === null || drag === null) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.moved = drag.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3
      whaleEl.style.left = `${Math.min(Math.max(4, drag.left + dx), window.innerWidth - 38)}px`
      whaleEl.style.top = `${Math.min(Math.max(4, drag.top + dy), window.innerHeight - 38)}px`
      e.preventDefault()
      e.stopPropagation()
    })
    const endWhaleDrag = (): void => {
      if (whaleEl === null || drag === null) return
      const moved = drag.moved
      drag = null
      whaleSuppressClick = moved
      try {
        window.localStorage.setItem(WHALE_POS_KEY, JSON.stringify({ x: whaleEl.offsetLeft, y: whaleEl.offsetTop }))
      } catch {}
    }
    whale.addEventListener('pointerup', endWhaleDrag)
    whale.addEventListener('pointercancel', endWhaleDrag)
    whaleEl = whale
    document.body.appendChild(whale)
  }

  /** Restore a dragged position when the whale becomes visible again. */
  function applyWhalePos(): void {
    if (whaleEl === null) return
    let pos: { x?: unknown; y?: unknown } | null = null
    try {
      pos = JSON.parse(window.localStorage.getItem(WHALE_POS_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null
    } catch {}
    if (pos !== null && typeof pos.x === 'number' && typeof pos.y === 'number') {
      // Clamp to the current viewport: a position saved on a larger screen
      // (resize, split-screen, rotation) must not park the whale — the only
      // portrait sidebar entry — out of reach.
      const x = Math.min(Math.max(4, pos.x), window.innerWidth - 38)
      const y = Math.min(Math.max(4, pos.y), window.innerHeight - 38)
      whaleEl.style.left = `${x}px`
      whaleEl.style.top = `${y}px`
    }
  }

  // v78: on touch, official session/project rows are draggable for
  // reordering; a long-press would start native drag instead of our action
  // menu. Force them non-draggable while the adapt is active (React may
  // re-create rows, so re-apply on the sync tick).
  function disableRowDrag(): void {
    if (!active) return
    const rows = document.querySelectorAll('[class$="_sidebarCol"] [class$="_sessionRow"], [class$="_sidebarCol"] [class$="_projectRow"]')
    for (const row of rows) {
      if (row.getAttribute('draggable') !== 'false') row.setAttribute('draggable', 'false')
    }
  }

  function syncWhale(): void {
    // Keep the stylesheet present while the layer is active (the tick runs
    // every 600ms; see ensureAdaptStyle for why the tag can need a re-assert).
    if (active) ensureAdaptStyle()
    if (whaleEl === null) return
    if (!active) {
      whaleEl.style.display = 'none'
      return
    }
    const collapsed = document.querySelector('[class$="_frame"][data-sidebar-collapsed]') !== null
    const overlayUp = document.querySelector('[class$="_overlay"]') !== null
    const show = collapsed && !overlayUp
    // Restore on every hidden-to-shown transition — including the very
    // first show on a fresh page load, where the inline display is still
    // '' and a CSS-read guard would never fire.
    if (show && !whaleShown) applyWhalePos()
    whaleEl.style.display = show ? '' : 'none'
    whaleShown = show
    document.body.classList.toggle(RAIL_HIDDEN_CLASS, collapsed)
    disableRowDrag()
    seatHeaderActions()
    alignActionsText()
    syncCompactPicker()
  }

  // v67: on mobile the header actions (agent-preset mode label + background
  // task badge) move from the title row into the tabs row. React re-creates
  // the node in its original spot on re-render, so the interval re-seats it;
  // stale seated copies are removed first.
  function seatHeaderActions(): void {
    if (!active) return
    const tabs = document.querySelector('[class$="_header"] [class$="_tabs"]')
    const fresh = document.querySelector('[class$="_titleCluster"] [class$="_headerActions"]')
    const seated = tabs !== null ? tabs.querySelector(':scope > [class$="_headerActions"]') : null
    // fresh === null means the node is either not rendered yet or already
    // seated — the seated copy IS the moved node, so never remove it.
    if (fresh !== null && tabs !== null) {
      seated?.remove()
      tabs.appendChild(fresh)
    }
  }

  // Align the mode/badge text bottom edge with the tab text. The tabs row
  // height is not stable (a background task badge grows it), so a static
  // transform would be wrong half the time — measure the real text boxes
  // each tick and compensate (converges; the previous transform is
  // subtracted from the measurement).
  function alignActionsText(): void {
    if (!active) return
    const tabs = document.querySelector('[class$="_header"] [class$="_tabs"]')
    if (tabs === null) return
    const actions = tabs.querySelector(':scope > [class$="_headerActions"]')
    const tabBtn = tabs.querySelector(':scope > [class*="_tab"]')
    if (actions === null || tabBtn === null) return
    const textBottom = (el: Element | null): number | null => {
      if (el === null) return null
      const text = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent !== null && n.textContent.trim() !== '')
      if (text === undefined) return null
      try {
        const range = document.createRange()
        range.selectNode(text)
        return range.getBoundingClientRect().bottom
      } catch {
        return null
      }
    }
    const tabBottom = textBottom(tabBtn)
    if (tabBottom === null) return
    const curMatch = /translateY\((-?[\d.]+)px\)/.exec((actions as HTMLElement).style.transform ?? '')
    const cur = curMatch !== null ? parseFloat(curMatch[1] ?? '0') : 0
    let maxBottom: number | null = null
    for (const sel of ['[class$="_label"]', '[class$="_count"]']) {
      const b = textBottom(actions.querySelector(sel))
      if (b !== null && (maxBottom === null || b - cur > maxBottom)) maxBottom = b - cur
    }
    if (maxBottom === null) return
    const delta = Math.round((tabBottom - maxBottom) * 10) / 10
    if (Math.abs(delta) < 0.5) {
      if ((actions as HTMLElement).style.transform !== '') (actions as HTMLElement).style.transform = ''
      return
    }
    ;(actions as HTMLElement).style.transform = `translateY(${delta}px)`
  }

  function unseatHeaderActions(): void {
    const tabs = document.querySelector('[class$="_header"] [class$="_tabs"]')
    const seated = tabs !== null ? tabs.querySelector(':scope > [class$="_headerActions"]') : null
    const wrap = document.querySelector('[class$="_titleCluster"] > div')
    if (seated !== null) {
      if (wrap !== null) wrap.appendChild(seated)
      else seated.remove()
    }
  }

  function ensureWhaleObserver(): void {
    if (whaleObserver !== null || typeof MutationObserver === 'undefined' || !document.body) return
    whaleObserver = new MutationObserver(() => { syncWhale() })
    whaleObserver.observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-collapsed'], subtree: true })
  }

  function evaluate(): void {
    if (!adaptEnabled) {
      revert()
      return
    }
    if (isMobilePortrait()) {
      apply()
      ensureWhaleObserver()
    } else {
      revert()
    }
  }
  evaluate()
  window.addEventListener('orientationchange', evaluate)
  window.addEventListener('resize', evaluate)
  // The 600ms tick is a page-lifetime wake source; pause it while the page
  // is hidden (backgrounded phone tab) and resume on return.
  document.addEventListener('visibilitychange', () => { setWhaleTimer(document.visibilityState !== 'hidden') })

  // v51: Enter only inserts a newline on mobile (send goes through the send
  // button). Captured at document level so the official Enter-to-send
  // handler never sees the event.
  function onKeydownCapture(e: KeyboardEvent): void {
    if (!active) return
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    if (t.closest('[class$="_input"]') === null) return
    // keyCode 229 is the classic IME-confirm signal (Safari fires
    // compositionend before the Enter keydown) — never treat it as a
    // plain newline.
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    e.stopPropagation()
    try { document.execCommand('insertText', false, '\n') } catch {}
  }
  document.addEventListener('keydown', onKeydownCapture, true)

  function collapseSidebar(): void {
    toggleSidebarVerified()
  }

  // Auto-collapse the expanded sidebar on mobile: after clicking a session
  // row, or when tapping anywhere outside the sidebar (overlays/dialogs and
  // the whale excluded).
  function onClickCapture(e: MouseEvent): void {
    if (!active) return
    const frame = document.querySelector('[class$="_frame"]')
    if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return
    const t = e.target
    if (!(t instanceof Element)) return
    if (t.closest('[class$="_sidebarCol"]') !== null) {
      // v68: opening settings also folds the sidebar so the modal closes
      // back into a clean conversation view. Clicks on the session
      // row-actions ellipsis (or its opened menu anchor) must NOT collapse
      // the sidebar — they open the action menu. v76: clicking the top-level
      // New Session also folds. v77: clicking a workspace row's new-session
      // button also folds.
      const topNewSessionClicked = t.closest('[class$="_newSession"], [class$="_brand"]') !== null
      let projectNewSessionClicked = false
      const projectActions = t.closest('[class$="_projectRow"] [class$="_rowActions"]')
      if (projectActions !== null) {
        const btn = t.closest('button')
        const btns = projectActions.querySelectorAll('button')
        projectNewSessionClicked = btn !== null && btns.length > 0 && btn === btns[btns.length - 1]
      }
      let shouldCollapse = false
      if (t.closest('[class$="_sessionRow"]') !== null) {
        shouldCollapse = t.closest('[class$="_rowActions"]') === null
      } else if (t.closest('[class$="_settingsArea"]') !== null || topNewSessionClicked || projectNewSessionClicked) {
        shouldCollapse = true
      }
      if (shouldCollapse) collapseSidebar()
      return
    }
    if (t.closest('[class$="_overlay"], [class$="_dialog"], [class$="_menu"], [class*="_portal"], [id="dshRemoteWhale"], [id="dshLanGate"]') !== null) return
    collapseSidebar()
  }
  document.addEventListener('click', onClickCapture, true)

  // v65/v66: swipe gestures. Swiping LEFT while the sidebar is expanded
  // collapses it; swiping RIGHT in the conversation view opens it. Vertical
  // swipes (list scrolling), swipes starting on inputs, on the whale, or
  // inside horizontally scrollable containers are ignored.
  function insideHScrollable(el: Element): boolean {
    let n: Element | null = el
    while (n !== null && n !== document.body) {
      const cs = getComputedStyle(n)
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 4) return true
      n = n.parentElement
    }
    return false
  }
  document.addEventListener('touchstart', (e) => {
    if (!active) return
    const t = e.target
    if (t instanceof Element && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.closest(`#${WHALE_ID}`) !== null || insideHScrollable(t) || t.closest('table, [class$="_table"], [class$="_tablePane"]') !== null)) {
      swipeTouch = null
      return
    }
    const ct = e.changedTouches[0]
    if (ct === undefined) return
    swipeTouch = { x: ct.clientX, y: ct.clientY, id: ct.identifier }
  }, { capture: true, passive: true })
  document.addEventListener('touchend', (e) => {
    if (swipeTouch === null) return
    const ct = e.changedTouches[0]
    if (ct === undefined || ct.identifier !== swipeTouch.id) return
    const dx = ct.clientX - swipeTouch.x
    const dy = ct.clientY - swipeTouch.y
    swipeTouch = null
    if (!active) return
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const frame = document.querySelector('[class$="_frame"]')
    if (frame === null) return
    if (document.querySelector('[class$="_overlay"], [class$="_dialog"], [class$="_menu"], [class*="_portal"]') !== null) return
    const collapsed = frame.hasAttribute('data-sidebar-collapsed')
    if (dx < 0 && !collapsed) collapseSidebar()
    else if (dx > 0 && collapsed) toggleSidebarVerified()
  }, { capture: true, passive: true })
  document.addEventListener('touchcancel', () => {
    swipeTouch = null
  }, true)

  // Long-press a session row opens the same action menu as the desktop's
  // right-side ellipsis button (rename / fork / archive). On touch the
  // row-actions button is hover-only, so a long press reveals + clicks it.
  const LONG_PRESS_MS = 500
  const LONG_PRESS_MOVE = 10
  let longPress: { row: Element; x: number; y: number; timer: number | null; triggered: boolean } | null = null
  let suppressSessionClickUntil = 0
  let suppressSessionClickRow: Element | null = null
  let longPressMenuGuardUntil = 0

  function clearLongPress(): void {
    if (longPress !== null) {
      if (longPress.timer !== null) window.clearTimeout(longPress.timer)
      longPress = null
    }
  }

  function openSessionMenu(row: Element): void {
    const actions = row.querySelector('[class$="_rowActions"]')
    const btn = actions?.querySelector('button')
    if (actions === null || btn === null) return
    // The official row hides actions until hover/menuOpen; force the anchor
    // visible just long enough for .click() to be accepted.
    longPressMenuGuardUntil = Date.now() + 1200
    ;(actions as HTMLElement).style.display = 'inline-flex'
    try {
      (btn as HTMLElement).click()
    } finally {
      window.setTimeout(() => { (actions as HTMLElement).style.display = '' }, 50)
    }
  }
  document.addEventListener('touchstart', (e) => {
    if (!active) return
    const t = e.target
    if (!(t instanceof Element)) {
      clearLongPress()
      return
    }
    const row = t.closest('[class$="_sessionRow"]')
    if (row === null || t.closest('[class$="_rowActions"]') !== null) {
      clearLongPress()
      return
    }
    const ct = e.changedTouches[0]
    if (ct === undefined) return
    clearLongPress()
    const lp = { row, x: ct.clientX, y: ct.clientY, timer: null as number | null, triggered: false }
    lp.timer = window.setTimeout(() => {
      if (longPress !== lp) return
      lp.triggered = true
      openSessionMenu(lp.row)
      try { navigator.vibrate?.(10) } catch {}
    }, LONG_PRESS_MS)
    longPress = lp
  }, { capture: true, passive: true })
  document.addEventListener('touchmove', (e) => {
    if (!active || longPress === null) return
    const ct = e.changedTouches[0]
    if (ct === undefined) return
    if (Math.abs(ct.clientX - longPress.x) > LONG_PRESS_MOVE || Math.abs(ct.clientY - longPress.y) > LONG_PRESS_MOVE) {
      clearLongPress()
    }
  }, { capture: true, passive: true })
  document.addEventListener('touchend', (e) => {
    if (!active || longPress === null) return
    const ct = e.changedTouches[0]
    if (ct === undefined) return
    const lp = longPress
    clearLongPress()
    if (lp.triggered) {
      // Stop the finger-lift from also opening the session; the menu is
      // already open and the sidebar should stay put.
      e.preventDefault()
      suppressSessionClickUntil = Date.now() + 800
      suppressSessionClickRow = lp.row
    }
  }, { capture: true, passive: false })
  document.addEventListener('touchcancel', () => {
    clearLongPress()
  }, true)
  // A long press ends with a synthetic click; swallow that one click so it
  // neither opens the conversation nor collapses the sidebar.
  window.addEventListener('click', (e) => {
    if (!active || Date.now() > suppressSessionClickUntil) return
    const t = e.target
    if (t instanceof Element && suppressSessionClickRow !== null && (t === suppressSessionClickRow || suppressSessionClickRow.contains(t))) {
      e.stopPropagation()
      e.preventDefault()
      suppressSessionClickUntil = 0
      suppressSessionClickRow = null
    }
  }, true)
  // Some Android browsers fire a native context menu after a long press.
  document.addEventListener('contextmenu', (e) => {
    if (!active) return
    const t = e.target
    if (!(t instanceof Element)) return
    if (t.closest('[class$="_sessionRow"]') !== null && ((longPress !== null && longPress.triggered) || Date.now() <= suppressSessionClickUntil)) {
      e.preventDefault()
    }
  }, true)
  // Keep the long-press menu open across the finger-lift: the official
  // Menu closes on pointerleave of its root, which fires on touch end.
  document.addEventListener('pointerleave', (e) => {
    if (!active || Date.now() > longPressMenuGuardUntil) return
    const t = e.target
    if (t instanceof Element && (t.closest('[class$="_rowActions"]') !== null || t.closest('[class$="_sessionRow"]') !== null || t.closest('[class$="_projectRow"]') !== null)) {
      e.stopPropagation()
    }
  }, true)

  // Intercept programmatic .focus() on the composer input: the official
  // conversation component focuses it on mount and on session changes;
  // user taps focus it through the browser's own pipeline. Only allow
  // composer focus that follows a real tap on the input itself.
  const lanOrigFocus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions): void {
    if (active && (this.tagName === 'TEXTAREA' || this.tagName === 'INPUT') && this.closest('[class$="_composerSeat"]') !== null && Date.now() - lastComposerTap >= 800) {
      return
    }
    lanOrigFocus.call(this, options)
  }
  let lastComposerTapRegistered = false
  if (!lastComposerTapRegistered) {
    lastComposerTapRegistered = true
    document.addEventListener('pointerdown', (e) => {
      if (!active) return
      const t = e.target
      if (t instanceof Element && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && t.closest('[class$="_composerSeat"]') !== null) lastComposerTap = Date.now()
    }, true)
  }

  // The plugin apply() wires toggleSidebar/closeDetails to ctx.layout once
  // it is live, and flips the master switch when the settings snapshot
  // settles.
  w.__dshRemoteAdapt = {
    evaluate,
    toggleSidebar: null,
    closeDetails: null,
    setEnabled(on: boolean): void {
      adaptEnabled = on
      if (on) evaluate()
      else revert()
    },
    flushCloseDetails(): void {
      // The first apply() ran before any wiring existed, so its
      // closeDetails call was a no-op; replay it once the layout face is
      // live so a restored details panel cannot sit hidden-uncloseable.
      if (active) w.__dshRemoteAdapt?.closeDetails?.()
    },
  }
}
