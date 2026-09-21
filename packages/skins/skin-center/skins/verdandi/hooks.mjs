/**
 * Verdandi · White Vow (verdandi) skin hooks - the trusted escape hatch of the v2
 * skin contract (x-org.linxin666.skin-center/v1alpha1). Loading this module
 * executes nothing; apply() owns every DOM write and registers its retraction
 * through ctx.onCleanup.
 *
 * Port of the v1 plugin effects (src/client/index.ts + ornaments.ts + art.ts):
 *  - v1 interpolated 27 inline image constants into body CSS variables. The 19
 *    raster constants now ship byte-identical as files under assets/ and are
 *    referenced through ctx.assetBase; the 6 SVG ornaments stay inline data
 *    URIs here because they are byte-identical by construction and the v2
 *    pipeline inlines served CSS into a <style> tag without rewriting relative
 *    url() (a relative assets/... URL there would resolve against the document
 *    base and 404). The variables therefore stay on body inline styles.
 *  - the theme token layer v1 installed through theme.overrideTokens is now a
 *    declarative L1 block in skin.css (same five tokens, same light/dark
 *    values), so this module subscribes to no theme events.
 *  - the ornamental chrome: character stage, sidebar/composer/header/details
 *    decorations, transcript slip rows and the projected-state body attributes
 *    (workspace / modal-open / sidebar-size / phase / view) - all driven by the
 *    same MutationObserver + ResizeObserver + animation-frame checkpoint logic
 *    as v1.
 * The stylesheet scoping attribute v1 wrote (body[data-dsh-verdandi]) is
 * loader-owned in v2 (html[data-dsh-skin="verdandi"]). Everything else keeps
 * the v1 selectors and conditions; the CSS-module class names v1 baked in as
 * build hashes are stable vd-* names now (patches.css carries the same names).
 */

/** v1 ornaments.ts helper: the same percent-encoding the v1 bundle emitted. */
function svgDataUri(source) {
  return `data:image/svg+xml,${encodeURIComponent(source)}`
}

/** v1 art.ts SWORD_CREST, injected verbatim. */
const SWORD_CREST = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%25238e2438%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M32%208%20L40%2016%20L32%2024%20L24%2016%20Z%22%2F%3E%3Cpath%20d%3D%22M32%2024%20L32%2052%22%2F%3E%3Cpath%20d%3D%22M32%2034%20L18%2028%22%2F%3E%3Cpath%20d%3D%22M32%2034%20L46%2028%22%2F%3E%3Cpath%20d%3D%22M18%2028%20L14%2018%22%2F%3E%3Cpath%20d%3D%22M46%2028%20L50%2018%22%2F%3E%3Cpath%20d%3D%22M14%2018%20L20%2016%22%2F%3E%3Cpath%20d%3D%22M50%2018%20L44%2016%22%2F%3E%3Cpath%20d%3D%22M18%2044%20Q10%2038%2012%2028%22%2F%3E%3Cpath%20d%3D%22M46%2044%20Q54%2038%2052%2028%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E"

const HEADER_VEIL = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 76" preserveAspectRatio="none">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#fffdfb" stop-opacity=".99"/>
      <stop offset="1" stop-color="#f9f1eb" stop-opacity=".96"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-30%" width="140%" height="170%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#55202d" flood-opacity=".18"/>
    </filter>
    <pattern id="lace" width="42" height="14" patternUnits="userSpaceOnUse">
      <path d="M0 1h42M0 1c8 0 8 11 16 11S24 1 32 1s8 11 10 11" fill="none" stroke="#c7a86b" stroke-width="1" opacity=".62"/>
      <circle cx="16" cy="8" r="1.8" fill="#8e2438" opacity=".45"/>
    </pattern>
  </defs>
  <path d="M0 7c168 0 242 34 408 34 150 0 244-23 392-23s242 23 392 23c166 0 240-34 408-34v69H0z" fill="url(#veil)"/>
  <path d="M0 7c168 0 242 34 408 34 150 0 244-23 392-23s242 23 392 23c166 0 240-34 408-34" fill="none" stroke="#c7a86b" stroke-width="1.4" opacity=".82"/>
  <path d="M0 60h1600v16H0z" fill="url(#lace)" opacity=".9"/>
</svg>`)

const SIDEBAR_FRAME = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 1080" preserveAspectRatio="none">
  <rect x="8" y="8" width="264" height="1064" rx="13" fill="none" stroke="#e6d5a9" stroke-width="1.2" opacity=".82"/>
  <rect x="12" y="12" width="256" height="1056" rx="10" fill="none" stroke="#5b1424" stroke-width="1" opacity=".7"/>
  <g fill="none" stroke="#e6d5a9" stroke-width="1.6" stroke-linecap="round" opacity=".9">
    <path d="M8 66c26-2 32-18 36-42 9 18 22 26 42 28M272 66c-26-2-32-18-36-42-9 18-22 26-42 28"/>
    <path d="M8 1014c26 2 32 18 36 42 9-18 22-26 42-28M272 1014c-26 2-32 18-36 42-9-18-22-26-42-28"/>
  </g>
  <g fill="#fffdfb" stroke="#c7a86b" opacity=".28">
    <path d="M43 23c5 8 5 15 0 22-5-7-5-14 0-22Z"/><path d="M237 23c-5 8-5 15 0 22 5-7 5-14 0-22Z"/>
    <path d="M43 1057c5-8 5-15 0-22-5 7-5 14 0 22Z"/><path d="M237 1057c-5-8-5-15 0-22 5 7 5 14 0 22Z"/>
  </g>
</svg>`)

const INVITATION_LACE = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 72" preserveAspectRatio="none">
  <path d="M8 8h344v56H8z" rx="14" fill="none" stroke="#c7a86b" stroke-width="1.3"/>
  <path d="M18 14h324v44H18z" fill="none" stroke="#8e2438" stroke-width=".8" opacity=".34"/>
  <g fill="none" stroke="#c7a86b" stroke-width="1.2" stroke-linecap="round">
    <path d="M9 28c13 0 20-7 22-19 4 11 11 18 23 20M351 28c-13 0-20-7-22-19-4 11-11 18-23 20"/>
    <path d="M9 44c13 0 20 7 22 19 4-11 11-18 23-20M351 44c-13 0-20 7-22 19-4-11-11-18-23-20"/>
  </g>
</svg>`)

const VOW_SEAL = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 72">
  <defs><filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#4e0f1d" flood-opacity=".2"/></filter></defs>
  <g filter="url(#s)">
    <path d="M9 25c17-7 31-5 47 5 16-10 30-12 47-5v34c-18-6-32-3-47 7-15-10-29-13-47-7z" fill="#fffdfb" stroke="#c7a86b" stroke-width="2"/>
    <path d="M56 30v36M17 33c13-3 24-1 33 5M95 33c-13-3-24-1-33 5" fill="none" stroke="#d9c69a" stroke-width="1.3"/>
  </g>
</svg>`)

const COMPOSER_LACE = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 36" preserveAspectRatio="none">
  <path d="M0 2h1200" stroke="#c7a86b" stroke-width="1.5"/>
  <path d="M0 5c20 0 20 20 40 20S60 5 80 5s20 20 40 20S140 5 160 5s20 20 40 20S220 5 240 5s20 20 40 20S300 5 320 5s20 20 40 20S380 5 400 5s20 20 40 20S460 5 480 5s20 20 40 20S540 5 560 5s20 20 40 20S620 5 640 5s20 20 40 20S700 5 720 5s20 20 40 20S780 5 800 5s20 20 40 20S860 5 880 5s20 20 40 20S940 5 960 5s20 20 40 20S1020 5 1040 5s20 20 40 20S1100 5 1120 5s20 20 40 20S1180 5 1200 5" fill="none" stroke="#8e2438" stroke-width="1" opacity=".45"/>
  <g fill="#c7a86b" opacity=".72">
    <circle cx="40" cy="18" r="2"/><circle cx="120" cy="18" r="2"/><circle cx="200" cy="18" r="2"/><circle cx="280" cy="18" r="2"/><circle cx="360" cy="18" r="2"/><circle cx="440" cy="18" r="2"/><circle cx="520" cy="18" r="2"/><circle cx="600" cy="18" r="2"/><circle cx="680" cy="18" r="2"/><circle cx="760" cy="18" r="2"/><circle cx="840" cy="18" r="2"/><circle cx="920" cy="18" r="2"/><circle cx="1000" cy="18" r="2"/><circle cx="1080" cy="18" r="2"/><circle cx="1160" cy="18" r="2"/>
  </g>
</svg>`)


const WORKSPACE_ATTR = 'data-verdandi-workspace'
const MODAL_ATTR = 'data-verdandi-modal-open'
const SIDEBAR_SIZE_ATTR = 'data-verdandi-sidebar-size'
const CONVERSATION_PHASE_ATTR = 'data-verdandi-phase'
const CONVERSATION_VIEW_ATTR = 'data-verdandi-view'
const DETAILS_EMPTY_ATTR = 'data-verdandi-details-empty'
const SLIP_ATTR = 'data-verdandi-slip'
const STAGE_SELECTOR = '[data-verdandi-stage]'
const DECORATION_SELECTOR = '[data-verdandi-decoration]'
const LEGACY_SELECTOR = '[data-verdandi-sidebar-card], [data-verdandi-wedding], [data-verdandi-chrome]'
const SLIP_MARKER_SELECTOR = '[data-system-prompt-body]'
const SIDEBAR_PANE = "[data-pane='sidebar']"
const CONVERSATION_PANE = "[data-pane='conversation']"
const DETAILS_PANE = "[data-pane='details']"
const HEADER_SELECTOR = "[data-slot='conversation.session.header'] > header"
const COMPOSER_SELECTOR = "[data-composer-seat], [data-slot='conversation.input.dock'], [data-slot='conversation.composer']"
const STAGE_CLASS = 'vd-characterStage'
const FIGURE_CLASS = 'vd-characterFigure'
const FIGURE_LEFT_CLASS = 'vd-figureLeft'
const FIGURE_RIGHT_CLASS = 'vd-figureRight'

const OWNED_HOOKS = [
  'data-verdandi-header',
  'data-verdandi-new-session',
  'data-verdandi-nav-entry',
  'data-verdandi-sidebar-action',
  DETAILS_EMPTY_ATTR,
]

const layoutProperties = [
  '--vd-character-floor',
  '--vd-conversation-header-height',
]

/**
 * body CSS variable -> shipped asset under assets/. The property set and the
 * order are the v1 ASSET_PROPERTIES map verbatim; only the value source moved
 * from an inline data URI to a ctx.assetBase file URL.
 */
const ASSET_PROPERTIES = {
  '--vd-art-sidebar-bridal': 'verdandi-bridal-cg-portrait-v1.webp',
  '--vd-art-workspace-light': 'verdandi-library-day-v1.webp',
  '--vd-art-workspace-dark': 'verdandi-library-night-v1.webp',
  '--vd-art-sword-crest': null,
  '--vd-art-header-veil': null,
  '--vd-art-sidebar-frame': null,
  '--vd-art-invitation-lace': null,
  '--vd-art-vow-seal': null,
  '--vd-art-composer-lace': null,
  '--vd-art-character-left': 'verdandi-barbecue-seated-v1.webp',
  '--vd-art-character-right': 'verdandi-white-knight-v1.webp',
  '--vd-art-official-sacred-tree': 'verdandi-sacred-tree-white-v1.webp',
  '--vd-art-vow-avatar-frame': 'verdandi-vow-avatar-frame-v1.webp',
  '--vd-art-wedding-avatar': 'verdandi-wedding-avatar-v1.webp',
  '--vd-art-vow-rings': 'verdandi-vow-rings-v1.webp',
  '--vd-art-ring-tag': 'verdandi-ring-tag-v1.webp',
  '--vd-art-vow-namecard': 'verdandi-vow-namecard-v1.webp',
  '--vd-art-hero-chibi-left': 'verdandi-chibi-left-v1.webp',
  '--vd-art-hero-chibi-right': 'verdandi-chibi-right-v1.webp',
  '--vd-art-childhood-record': 'verdandi-childhood-record-v1.webp',
  '--vd-art-sequence-sword': 'verdandi-sequence-sword-v1.webp',
  '--vd-art-q-avatar': 'verdandi-q-avatar-v1.webp',
  '--vd-art-bridal-floral-corner': 'verdandi-bridal-floral-corner-v1.webp',
  '--vd-art-bridal-veil-corner': 'verdandi-bridal-veil-corner-v1.webp',
  '--vd-art-vow-folder': 'verdandi-vow-folder-v1.webp',
  '--vd-art-details-light': 'verdandi-details-art-light-v1.jpg',
  '--vd-art-details-dark': 'verdandi-details-art-dark-v1.jpg',
}

/** Inline SVG constants, keyed by the property they feed. */
const SVG_PROPERTIES = {
  '--vd-art-sword-crest': SWORD_CREST,
  '--vd-art-header-veil': HEADER_VEIL,
  '--vd-art-sidebar-frame': SIDEBAR_FRAME,
  '--vd-art-invitation-lace': INVITATION_LACE,
  '--vd-art-vow-seal': VOW_SEAL,
  '--vd-art-composer-lace': COMPOSER_LACE,
}

function firstElement(selector) {
  return document.querySelector(selector)
}

function isRendered(element) {
  if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function removeLegacyNodes() {
  for (const node of document.querySelectorAll(LEGACY_SELECTOR)) node.remove()
}

function ensureDecoration(parent, part) {
  if (!parent) return null
  let decoration = parent.querySelector(`:scope > [data-verdandi-decoration='${part}']`)
  if (decoration) return decoration

  decoration = document.createElement('div')
  decoration.dataset.verdandiDecoration = part
  decoration.setAttribute('aria-hidden', 'true')
  parent.append(decoration)
  return decoration
}

function ensureWeddingDecorations(sidebar, conversation, details) {
  const sidebarRoot = sidebar?.querySelector("[data-slot='sidebar']") ?? sidebar
  ensureDecoration(sidebarRoot, 'sidebar-portrait')
  ensureDecoration(sidebarRoot, 'sidebar-sacred-tree')
  ensureDecoration(sidebarRoot, 'sidebar-rail-avatar')
  ensureDecoration(sidebarRoot, 'sidebar-veil-corners-top')
  ensureDecoration(sidebarRoot, 'sidebar-veil-corners-bottom')
  ensureDecoration(conversation, 'workspace-lace')
  const header = conversation?.querySelector(HEADER_SELECTOR) ?? null
  ensureDecoration(header, 'header-veil')
  ensureDecoration(header, 'header-namecard')
  ensureDecoration(header, 'header-bridal-corners')
  ensureDecoration(header, 'header-veil-corners')
  ensureDecoration(header, 'header-vow-crest')

  const composer = conversation?.querySelector('[data-composer-card]') ?? null
  ensureDecoration(composer, 'composer-seal')
  ensureDecoration(composer, 'composer-bridal-corners')
  ensureDecoration(composer, 'composer-veil-inner')
  ensureDecoration(composer, 'hero-chibi-left')
  ensureDecoration(composer, 'hero-chibi-right')
  ensureDecoration(details, 'details-record')

  for (const markdown of conversation?.querySelectorAll(
    "[data-chat-flow-kind='assistant-step'] [data-slot='conversation.chat.node'] [class*='_markdown_']",
  ) ?? []) {
    ensureDecoration(markdown, 'assistant-avatar')
  }
}

function ensureCharacterStage(conversation) {
  let stage = conversation.querySelector(`:scope > ${STAGE_SELECTOR}`)
  if (
    stage
    && stage.querySelector("[data-verdandi-figure='left']")
    && stage.querySelector("[data-verdandi-figure='right']")
  ) {
    return stage
  }

  stage?.remove()

  for (const stale of document.querySelectorAll(STAGE_SELECTOR)) stale.remove()

  stage = document.createElement('div')
  stage.dataset.verdandiStage = ''
  stage.className = STAGE_CLASS
  stage.setAttribute('aria-hidden', 'true')

  const leftFigure = document.createElement('div')
  leftFigure.dataset.verdandiFigure = 'left'
  leftFigure.className = `${FIGURE_CLASS} ${FIGURE_LEFT_CLASS}`

  const rightFigure = document.createElement('div')
  rightFigure.dataset.verdandiFigure = 'right'
  rightFigure.className = `${FIGURE_CLASS} ${FIGURE_RIGHT_CLASS}`

  stage.append(leftFigure, rightFigure)
  conversation.prepend(stage)
  return stage
}

function clearOwnedHooks() {
  for (const attribute of OWNED_HOOKS) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      element.removeAttribute(attribute)
    }
  }
}

/**
 * Resolve the row element that should carry a slip for `marker`. The host wraps
 * every chat node in a stable seat, and the seat is the innermost element
 * guaranteed to contain the marker, so the slip never spans more than one row.
 */
function slipRowFor(marker) {
  const seat = marker.closest("[data-slot='conversation.chat.node']")
  if (seat) {
    const root = seat.firstElementChild
    if (root instanceof HTMLElement && root.contains(marker)) return root
    return seat
  }
  return marker.closest('[data-chat-flow-key]')
}

function decorateLegibilityRows(conversation) {
  const rows = new Set()
  for (const marker of conversation?.querySelectorAll(SLIP_MARKER_SELECTOR) ?? []) {
    const row = slipRowFor(marker)
    if (row) rows.add(row)
  }

  for (const tagged of conversation?.querySelectorAll(`[${SLIP_ATTR}]`) ?? []) {
    if (!rows.has(tagged)) tagged.removeAttribute(SLIP_ATTR)
  }
  for (const row of rows) {
    if (row.getAttribute(SLIP_ATTR) !== 'context') row.setAttribute(SLIP_ATTR, 'context')
  }
}

function decorateStableRegions() {
  clearOwnedHooks()

  const header = firstElement(HEADER_SELECTOR)
  header?.setAttribute('data-verdandi-header', '')

  const details = firstElement(DETAILS_PANE)
  const detailsText = (details?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (/点击消息流中的工具行查看详情|select.+tool.+row.+details/i.test(detailsText)) {
    details?.setAttribute(DETAILS_EMPTY_ATTR, '')
  }

  const sidebar = firstElement(SIDEBAR_PANE)
  if (!sidebar) return

  for (const button of sidebar.querySelectorAll('button')) {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.trim()
    const text = (button.textContent ?? '').trim()

    if (/^(新会话|New session)$/i.test(text)) button.dataset.verdandiNewSession = ''
    if (/^(任务看板|Task board|SSH|技能中心|Skill center)$/i.test(text)) button.dataset.verdandiNavEntry = ''
    if (/搜索会话|Search sessions|视图选项|View options|添加工作区|Add workspace/i.test(label)) {
      button.dataset.verdandiSidebarAction = ''
    }
  }
}

function setSidebarSize(body, sidebar) {
  const width = sidebar?.getBoundingClientRect().width || sidebar?.offsetWidth || 0
  if (width > 0 && width < 96) body.setAttribute(SIDEBAR_SIZE_ATTR, 'rail')
  else if (width > 0 && width < 260) body.setAttribute(SIDEBAR_SIZE_ATTR, 'narrow')
  else body.setAttribute(SIDEBAR_SIZE_ATTR, 'wide')
}

function measureConversation(conversation) {
  const conversationRect = conversation.getBoundingClientRect()
  const header = conversation.querySelector(HEADER_SELECTOR)
  const composer = conversation.querySelector(COMPOSER_SELECTOR)

  const headerRect = header?.getBoundingClientRect()
  const composerRect = composer?.getBoundingClientRect()
  const headerHeight = headerRect && headerRect.height > 0
    ? Math.max(0, headerRect.bottom - conversationRect.top)
    : 76
  const floor = composerRect && composerRect.height > 0
    ? Math.max(18, conversationRect.bottom - composerRect.top + 8)
    : 154

  conversation.style.setProperty('--vd-conversation-header-height', `${Math.round(headerHeight)}px`)
  conversation.style.setProperty('--vd-character-floor', `${Math.round(floor)}px`)
}

function setStageWidth(stage, conversation) {
  const width = conversation.getBoundingClientRect().width || conversation.offsetWidth || 0
  stage.dataset.verdandiWidth = width >= 1360 ? 'wide' : width >= 840 ? 'medium' : 'compact'
  // The host's alternate work surfaces apply an important aria-hidden rule to
  // decorative children. This is our own node, so an owned inline declaration
  // is the narrowest reliable way to keep it visible on usable widths.
  stage.style.setProperty('display', width >= 840 ? 'block' : 'none', 'important')
}

function setConversationView(conversation) {
  const selectedTab = conversation.querySelector(
    "[data-slot='conversation.session.header'] [role='tab'][aria-selected='true']",
  )
  const label = (selectedTab?.textContent ?? '').trim()
  const view = /^(轨迹|Trace)$/i.test(label) ? 'trace' : 'chat'
  conversation.setAttribute(CONVERSATION_VIEW_ATTR, view)
  return view
}

function restoreAttribute(element, name, previous) {
  if (previous === null) element.removeAttribute(name)
  else element.setAttribute(name, previous)
}

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const body = document.body
      const asset = (name) => `${ctx.assetBase}/assets/${name}`
      const previousAttributes = new Map([
        [WORKSPACE_ATTR, body.getAttribute(WORKSPACE_ATTR)],
        [MODAL_ATTR, body.getAttribute(MODAL_ATTR)],
        [SIDEBAR_SIZE_ATTR, body.getAttribute(SIDEBAR_SIZE_ATTR)],
      ])
      const previousAssetProperties = new Map()
      // v1 never had to restore this exactly (it was a plugin); the in-repo
      // lifecycle test compares the body attribute map, so an empty style
      // attribute created by the skin must not survive cleanup.
      const hadStyleAttribute = body.hasAttribute('style')

      for (const [property, file] of Object.entries(ASSET_PROPERTIES)) {
        previousAssetProperties.set(property, {
          value: body.style.getPropertyValue(property),
          priority: body.style.getPropertyPriority(property),
        })
        const source = file === null ? SVG_PROPERTIES[property] : asset(file)
        body.style.setProperty(property, `url(${JSON.stringify(source)})`)
      }
      removeLegacyNodes()

      let resizeObserver = null
      let observed = new Set()
      let animationFrame = 0
      const requestFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(() => callback(Date.now()), 0)
      const cancelFrame = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : window.clearTimeout.bind(window)

      const syncResizeTargets = (targets) => {
        if (!resizeObserver) return
        const next = new Set(targets.filter((target) => Boolean(target)))
        next.add(body)
        for (const element of observed) if (!next.has(element)) resizeObserver.unobserve(element)
        for (const element of next) if (!observed.has(element)) resizeObserver.observe(element)
        observed = next
      }

      const sync = () => {
        animationFrame = 0
        removeLegacyNodes()
        decorateStableRegions()

        const sidebar = firstElement(SIDEBAR_PANE)
        const conversation = firstElement(CONVERSATION_PANE)
        const details = firstElement(DETAILS_PANE)
        const workspaceVisible = isRendered(conversation)

        body.toggleAttribute(WORKSPACE_ATTR, workspaceVisible)
        body.toggleAttribute(MODAL_ATTR, Boolean(document.querySelector("[role='dialog'][aria-modal='true']")))
        setSidebarSize(body, sidebar)
        ensureWeddingDecorations(sidebar, workspaceVisible ? conversation : null, details)
        decorateLegibilityRows(workspaceVisible ? conversation : null)

        if (workspaceVisible) {
          const stage = ensureCharacterStage(conversation)
          const phase = conversation.querySelector('[data-phase]')?.getAttribute('data-phase') ?? 'active'
          setConversationView(conversation)
          stage.dataset.verdandiPhase = phase
          conversation.setAttribute(CONVERSATION_PHASE_ATTR, phase)
          measureConversation(conversation)
          setStageWidth(stage, conversation)
        } else {
          for (const stage of document.querySelectorAll(STAGE_SELECTOR)) stage.remove()
          for (const pane of document.querySelectorAll(CONVERSATION_PANE)) {
            pane.removeAttribute(CONVERSATION_PHASE_ATTR)
            pane.removeAttribute(CONVERSATION_VIEW_ATTR)
          }
        }

        syncResizeTargets([
          sidebar,
          conversation,
          details,
          conversation?.querySelector(HEADER_SELECTOR) ?? null,
          conversation?.querySelector("[data-composer-seat], [data-slot='conversation.input.dock']") ?? null,
        ])
      }

      const scheduleSync = () => {
        if (animationFrame) return
        animationFrame = requestFrame(sync)
      }

      resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleSync)
      const mutationObserver = new MutationObserver(scheduleSync)
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-expanded', 'aria-selected', 'data-phase', 'hidden'],
      })
      window.addEventListener('resize', scheduleSync)
      window.visualViewport?.addEventListener('resize', scheduleSync)
      sync()

      ctx.onCleanup(() => {
        mutationObserver.disconnect()
        resizeObserver?.disconnect()
        if (animationFrame) cancelFrame(animationFrame)
        window.removeEventListener('resize', scheduleSync)
        window.visualViewport?.removeEventListener('resize', scheduleSync)

        clearOwnedHooks()
        for (const decoration of document.querySelectorAll(DECORATION_SELECTOR)) decoration.remove()
        for (const slip of document.querySelectorAll(`[${SLIP_ATTR}]`)) slip.removeAttribute(SLIP_ATTR)
        for (const stage of document.querySelectorAll(STAGE_SELECTOR)) stage.remove()
        for (const conversation of document.querySelectorAll(CONVERSATION_PANE)) {
          for (const property of layoutProperties) conversation.style.removeProperty(property)
          conversation.removeAttribute(CONVERSATION_PHASE_ATTR)
          conversation.removeAttribute(CONVERSATION_VIEW_ATTR)
        }

        for (const [property, previous] of previousAssetProperties) {
          if (previous.value) body.style.setProperty(property, previous.value, previous.priority)
          else body.style.removeProperty(property)
        }
        // The skin created the inline style attribute if v1 never had one;
        // leaving `style=""` behind would break exact DOM restoration (the
        // in-repo lifecycle test compares the body attribute map).
        if (!hadStyleAttribute && body.style.length === 0) body.removeAttribute('style')
        for (const [attribute, previous] of previousAttributes) restoreAttribute(body, attribute, previous)
      })
    },
  }
}
