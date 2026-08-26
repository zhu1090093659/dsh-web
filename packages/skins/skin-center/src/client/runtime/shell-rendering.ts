/**
 * Shared shell rendering corrections for every visual mode owned by the skin
 * center (issue #954). The official shell exposes stable slot / composer
 * anchors, while the workspace-list fade itself is still a CSS-module class.
 * Keep that fallback scoped below sidebar.workspaces so an unrelated animation
 * or overlay whose class contains "fade" is never affected.
 *
 * The stylesheet is inert for the stock look: a catalog skin, custom theme or
 * wallpaper must be active. It is installed once per runtime and removed with
 * that runtime, so disabling the plugin restores the shell unchanged.
 * @module @linxin666/dsh-client-ui-skin-center/runtime/shell-rendering
 */

/** Marker owned by the shared shell-rendering stylesheet. */
export const SHELL_RENDERING_STYLE_ATTR = 'data-dsh-shell-rendering'

/** Fallback composer seat height for scrollport bottom clearance (px). */
export const DEFAULT_COMPOSER_CLEARANCE_PX = 100

const ACTIVE_VISUAL_SELECTOR = [
  'html[data-dsh-skin]',
  'html[data-dsh-custom-theme]:not([data-dsh-skin])',
  'html[data-dsh-wallpaper-active]',
].join(', ')

const COMPOSER_SEAT_SELECTORS = [
  '[data-slot="conversation.composer"]',
  '[data-composer-seat]',
  '[data-dsh-surface="composer"]',
]

/** Build the inert-by-default public rendering corrections. */
export function shellRenderingCss(): string {
  const scopes = ACTIVE_VISUAL_SELECTOR.split(', ')
  const scoped = (selector: string): string => scopes.map(scope => `${scope} ${selector}`).join(',\n')
  return `
    /* Viewport and root lock: prevent outer page scrollbar and viewport
       displacement during element focus/scrollIntoView. */
    ${ACTIVE_VISUAL_SELECTOR},
    ${scoped('body')} {
      height: 100% !important;
      width: 100% !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    ${scoped('[id="root"]')} {
      box-sizing: border-box !important;
      height: 100% !important;
      width: calc(100% - var(--dsh-sidebar-width, 0px)) !important;
      max-height: 100% !important;
      overflow: hidden !important;
    }
    ${scoped('[data-slot="sidebar.workspaces"] [class*="_fade"]')} {
      background: none !important;
      background-image: none !important;
    }
    ${scoped('[data-composer-card] textarea[data-phase]::placeholder')},
    ${scoped('textarea[data-dsh-part="composer-input"]::placeholder')} {
      color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-caption)) !important;
      -webkit-text-fill-color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-caption)) !important;
      opacity: 1 !important;
    }
    ${scoped('[data-phase="active"] [data-slot="conversation.input.dock"] > *')},
    ${scoped('[data-phase="active"] [data-slot="conversation.composer.dock"] > *')} {
      /* One skin-driven accessory surface for task and statistics docks. Skins
         automatically follow their existing semantic theme tokens and may
         override the --dsh-composer-accessory-* variables for a stronger
         signature without coupling this adapter to a specific catalog skin. */
      background: var(--dsh-composer-accessory-bg, var(--dsw-specific-tip, var(--dsw-alias-bg-layer-1))) !important;
      color: var(--dsh-composer-accessory-color, var(--dsw-alias-label-tertiary)) !important;
      border: var(--dsh-composer-accessory-border, none) !important;
      border-radius: var(--dsh-composer-accessory-radius, 12px) !important;
      box-shadow: var(--dsh-composer-accessory-shadow, var(--dsw-shadow-lv1, 0 2px 10px rgba(7, 20, 38, 0.18)));
      backdrop-filter: blur(var(--dsh-composer-accessory-blur, var(--dsh-input-card-blur, 10px))) !important;
      -webkit-backdrop-filter: blur(var(--dsh-composer-accessory-blur, var(--dsh-input-card-blur, 10px))) !important;
    }
    ${scoped('[data-phase="active"] [data-slot="conversation.composer.dock"] > *')} {
      margin-top: var(--dsh-composer-accessory-gap, 4px);
      margin-bottom: var(--dsh-composer-accessory-gap, 4px);
      padding-top: 2px;
      padding-bottom: 2px;
    }
    ${scoped('[data-slot="conversation.input.dock"] > [data-goal-bar="true"][data-goal-bar="true"][data-goal-bar="true"]')} {
      /* The host goal dock spans the full composer seat and contains its own
         centered compact bar. Do not paint the outer dock as an accessory: that
         creates a viewport-wide veil behind the active-goal chip. The repeated
         stable marker deliberately raises specificity above catalog-skin dock
         selectors that load after this shared adapter. */
      background: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    ${scoped('[data-conversation-scroll]')},
    ${scoped('[data-dsh-part="scrollport"]')} {
      /* The composer is the scrollport's final in-flow child. Reserving physical
         padding after it lifts the active dock by one composer height and also
         shifts the hero above center. */
      padding-bottom: 0 !important;
    }
    /* #978 / #1133: Line-level scroll-margin retains scrollIntoView() clearance
       above the sticky composer without placing a scrollport-level scroll-padding
       that breaks browser caret-reveal geometry (which caused micro-scrolling on
       every keystroke while reading history). */
    ${scoped('[data-conversation-scroll] [data-chat-anchor-key]')},
    ${scoped('[data-conversation-scroll] [data-chat-flow-kind]')},
    ${scoped('[data-conversation-scroll] [data-dsh-part="message-row"]')},
    ${scoped('[data-conversation-scroll] [data-turn-tail]')},
    ${scoped('[data-conversation-scroll] [class*="_userRow"]')},
    ${scoped('[data-conversation-scroll] [class*="_compactionRow"]')},
    ${scoped('[data-conversation-scroll] [class*="_contextRow"]')},
    ${scoped('[data-conversation-scroll] [class*="_turnErrorRow"]')} {
      scroll-margin-bottom: var(--dsh-composer-height, ${DEFAULT_COMPOSER_CLEARANCE_PX}px) !important;
    }
    /* #1117: The upstream recommended badge pairs two background-fill tokens
       as bg + text — in dark mode, skins like Blue Fantasy collapse them to
       near-identical dark navy values (contrast ~1:1). Override the text
       color to a readable foreground and tweak the background for contrast. */
    body[data-ds-dark-theme] ${scoped('[data-question-key] [class*="_badge"]')},
    body[data-ds-dark-theme] ${scoped('[data-question-scroll] [class*="_badge"]')} {
      color: var(--dsw-alias-label-primary, #ffffff) !important;
      background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, var(--dsw-alias-button-info-fill, #4a5fa8) 50%, transparent)) !important;
    }
  `
}

/** Install the shared corrections and return their idempotent teardown. */
export function installShellRenderingAdapter(doc: Document): () => void {
  if (doc.head === null) return () => {}
  const existing = doc.head.querySelector<HTMLStyleElement>(`style[${SHELL_RENDERING_STYLE_ATTR}]`)
  if (existing !== null) return () => {}

  const style = doc.createElement('style')
  style.setAttribute(SHELL_RENDERING_STYLE_ATTR, '')
  style.textContent = shellRenderingCss()
  doc.head.appendChild(style)

  const win = doc.defaultView
  try { win?.scrollTo?.(0, 0) } catch {}
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let observedComposer: Element | null = null

  const syncHeight = (): void => {
    if (doc.body === null) return
    const composer = doc.body.querySelector(COMPOSER_SEAT_SELECTORS.join(', '))
    if (composer !== null) {
      if (observedComposer !== composer) {
        if (observedComposer !== null && resizeObserver !== null) {
          resizeObserver.unobserve(observedComposer)
        }
        observedComposer = composer
        if (resizeObserver !== null) {
          resizeObserver.observe(composer)
        }
      }
      const rect = composer.getBoundingClientRect()
      if (rect.height > 0) {
        doc.documentElement?.style.setProperty('--dsh-composer-height', `${Math.ceil(rect.height)}px`)
      }
    }
  }

  if (win !== null && typeof win.ResizeObserver === 'function') {
    resizeObserver = new win.ResizeObserver(() => syncHeight())
  }

  if (win !== null && typeof win.MutationObserver === 'function' && doc.body !== null) {
    mutationObserver = new win.MutationObserver(() => syncHeight())
    mutationObserver.observe(doc.body, { childList: true, subtree: true })
  }

  syncHeight()

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (resizeObserver !== null) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (mutationObserver !== null) {
      mutationObserver.disconnect()
      mutationObserver = null
    }
    observedComposer = null
    doc.documentElement?.style.removeProperty('--dsh-composer-height')
    style.remove()
  }
}
