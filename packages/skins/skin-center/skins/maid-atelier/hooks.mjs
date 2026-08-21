/**
 * Abyssal Maid Atelier (maid-atelier) skin hooks — the trusted escape
 * hatch of the v2 skin contract (x-org.linxin666.skin-center/v1alpha1),
 * reviewed and released with this repository. Loading this module
 * executes nothing; apply() owns every DOM write and registers its
 * retraction through ctx.onCleanup.
 *
 * Port of the v1 plugin effects
 * (packages/skins/maid-atelier/src/client/index.ts):
 *  - the JS-built stylesheet inputs: v1 interpolated 16 inline image
 *    constants into body CSS variables, the theme-swapped palace
 *    backdrop and a CSSOM width sheet. All 16 images now ship as files
 *    under assets/ and are referenced through ctx.assetBase. They stay
 *    on body inline styles / a hooks-owned <style> element instead of
 *    patches.css because the v2 pipeline inlines served CSS into a
 *    <style> tag without rewriting relative url() — a relative
 *    assets/... URL there would resolve against the document base and
 *    404. The dynamic sidebar-width rules must stay CSSOM rules
 *    regardless (per-frame writes that no attribute mutation observer
 *    sees, per the v1 note below).
 *  - the ornamental chrome: character stage, top/bottom trims, sidebar
 *    corners + mascot, workspace-tree decoration, titlebar brand, the
 *    settings backdrop frame and the projected-state body attributes —
 *    all driven by the same MutationObserver checkpoint logic as v1.
 *  - system chrome color (meta[name=theme-color]), the rail-search focus
 *    recovery, the low-power fallback (no accelerated WebGL), the
 *    viewport-resize settle flag, the favicon and the pinned title.
 * The stylesheet scoping attribute v1 wrote (body[data-dsh-maid-atelier])
 * is loader-owned in v2 (html[data-dsh-skin="maid-atelier"]); the
 * CSSOM frame rules below are re-anchored on that scope via
 * ctx.scopeAttr. Everything else keeps the v1 selectors and conditions.
 */

const SKIN_TITLE = '深海女仆工坊 · DeepSeek Harness'
const SKIN_OWNER = 'maid-atelier'
const SKIN_SYSTEM_CHROME_COLOR = '#0b193f'
const VIEWPORT_RESIZE_SETTLE_MS = 120
const SIDEBAR_COLUMN_SELECTOR = ":is([data-pane='sidebar'], [class*='sidebarCol'])"
const SETTINGS_DIALOG_SELECTOR = "[data-slot='sidebar.settings'] [role='dialog'][aria-modal='true']"
const SETTINGS_MASK_SELECTOR = "[role='presentation'] > [class*='mask']"
const ACTIVE_CONVERSATION_SELECTOR = "[data-phase='active']"
const ACTIVE_CHAT_SELECTOR = `${ACTIVE_CONVERSATION_SELECTOR} [data-chat-flow]`
const WORKSPACE_SELECTOR = "header [role='tablist']"
const BETTER_SIDEBAR_SELECTOR = '[data-dsh-better-sidebar]'
const CORDIS_PANEL_SELECTOR = '[data-cordis-panel]'
const TERMINAL_SELECTOR = `${BETTER_SIDEBAR_SELECTOR} .xterm`

const bodyAttributeLeases = new WeakMap()

function createBodyAttributeLease(body, attribute, value = '') {
  const owner = Symbol(attribute)
  let active = false

  return {
    acquire() {
      if (active) return
      let attributes = bodyAttributeLeases.get(body)
      if (attributes === undefined) {
        attributes = new Map()
        bodyAttributeLeases.set(body, attributes)
      }
      let state = attributes.get(attribute)
      if (state === undefined) {
        state = {
          originalValue: body.getAttribute(attribute),
          owners: new Set(),
          value,
        }
        attributes.set(attribute, state)
      }
      state.owners.add(owner)
      active = true
      body.setAttribute(attribute, state.value)
    },
    release() {
      if (!active) return
      active = false
      const attributes = bodyAttributeLeases.get(body)
      const state = attributes?.get(attribute)
      if (state === undefined || !state.owners.delete(owner)) return
      if (state.owners.size > 0) {
        body.setAttribute(attribute, state.value)
        return
      }
      attributes?.delete(attribute)
      if (attributes?.size === 0) bodyAttributeLeases.delete(body)
      if (body.getAttribute(attribute) !== state.value) return
      if (state.originalValue === null) body.removeAttribute(attribute)
      else body.setAttribute(attribute, state.originalValue)
    },
  }
}

const PROJECTED_STATE_ATTRIBUTES = {
  activeChat: 'data-maid-chat-active',
  activeConversation: 'data-maid-conversation-active',
  betterSidebarOpen: 'data-maid-better-sidebar-open',
  cordisPanelOpen: 'data-maid-cordis-panel-open',
  settingsOpen: 'data-maid-settings-open',
  workspace: 'data-maid-workspace',
}

const PROJECTED_STATE_SELECTOR = [
  ACTIVE_CONVERSATION_SELECTOR,
  '[data-chat-flow]',
  WORKSPACE_SELECTOR,
  BETTER_SIDEBAR_SELECTOR,
  CORDIS_PANEL_SELECTOR,
  "[data-slot='sidebar.settings']",
].join(', ')

const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
  '--maid-sidebar-width',
  '--maid-top-trim-art',
  '--maid-bottom-trim-art',
  '--maid-bottom-crest-art',
  '--maid-bow-art',
  '--maid-new-session-art',
  '--maid-sidebar-swag-art',
  '--maid-sidebar-corner-art',
  '--maid-composer-frame-art',
  '--maid-settings-frame-art',
  '--maid-workspace-crest-art',
  '--maid-workspace-ribbon-art',
]

function hasAcceleratedWebGL() {
  if (typeof WebGLRenderingContext === 'undefined') return false
  const canvas = document.createElement('canvas')
  const options = { failIfMajorPerformanceCaveat: true }
  for (const kind of ['webgl2', 'webgl']) {
    try {
      const context = canvas.getContext(kind, options)
      if (context === null) continue
      context.getExtension('WEBGL_lose_context')?.loseContext()
      return true
    } catch {
      // A blocked or software-only context should use the CPU-safe CSS path.
    }
  }
  return false
}

function createSidebarCorners() {
  const corners = document.createElement('div')
  corners.dataset.skinChrome = 'sidebar-corners'
  corners.dataset.skinOwner = SKIN_OWNER
  corners.setAttribute('aria-hidden', 'true')
  for (const position of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
    const corner = document.createElement('span')
    corner.dataset.skinCorner = position
    corners.append(corner)
  }
  return corners
}

/**
 * Place a text label at the center of the frameless title bar (Web-app
 * overlay / desktop shell).
 */
function decorateTitlebarBrand(ownedNodes) {
  const titlebar = document.querySelector("[class*='titlebar']")
  if (!titlebar) return
  if (titlebar.querySelector("[data-skin-chrome='titlebar-brand']")) return
  const brand = document.createElement('span')
  brand.dataset.skinChrome = 'titlebar-brand'
  brand.dataset.skinOwner = SKIN_OWNER
  brand.setAttribute('aria-hidden', 'true')
  brand.innerHTML = "<svg viewBox=\"26 4.2 155.6 17.6\" fill=\"none\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M68.416 18.2447H67.0501V16.1272H68.416C69.2619 16.1272 70.1166 15.9163 70.6671 15.3304C71.2181 14.7444 71.426 13.8455 71.426 12.9471C71.426 12.0487 71.2268 11.1498 70.6671 10.5643C70.1083 9.97831 69.2619 9.76744 68.416 9.76744C67.5701 9.76744 66.7154 9.97831 66.1639 10.5643C65.6129 11.1503 65.4049 12.0487 65.4049 12.9471V21.6435H63.009V7.6582H65.4049V8.54883H65.8442C65.8918 8.49393 65.9394 8.44728 65.9875 8.40064C66.5871 7.85353 67.5049 7.6582 68.4072 7.6582C69.8212 7.6582 71.2341 8.00998 72.1607 8.98662C73.0868 9.96325 73.4143 11.4632 73.4143 12.9558C73.4143 14.4485 73.0785 15.9406 72.1607 16.925C71.2424 17.9094 69.8212 18.2457 68.416 18.2457V18.2447Z\" fill=\"currentColor\"/> <path d=\"M31.9551 8.03497H33.3204V10.1525H31.9551C31.1087 10.1525 30.2545 10.3633 29.7035 10.9493C29.1525 11.5353 28.945 12.4342 28.945 13.3326C28.945 14.231 29.1447 15.1294 29.7035 15.7154C30.2623 16.3014 31.1087 16.5122 31.9551 16.5122C32.8015 16.5122 33.6562 16.3014 34.2072 15.7154C34.7582 15.1294 34.9657 14.231 34.9657 13.3326V4.62842H37.3611V18.6219H34.9657V17.7313H34.5264C34.4783 17.7857 34.4307 17.8329 34.3826 17.8795C33.7835 18.4261 32.8652 18.6219 31.9629 18.6219C30.5494 18.6219 29.136 18.2707 28.2099 17.294C27.2838 16.3174 26.9563 14.817 26.9563 13.3248C26.9563 11.8327 27.2916 10.34 28.2099 9.35561C29.136 8.37898 30.5494 8.03497 31.9551 8.03497Z\" fill=\"currentColor\"/> <path d=\"M49.3786 13.1431V13.9948H42.9984V12.2996H47.2305C47.1348 11.6825 46.9113 11.1043 46.5119 10.682C45.9371 10.0727 45.0503 9.85409 44.1723 9.85409C43.2943 9.85409 42.4076 10.0727 41.8328 10.682C41.258 11.2913 41.05 12.2213 41.05 13.1435C41.05 14.0658 41.2575 15.003 41.8328 15.6046C42.4076 16.2061 43.2939 16.433 44.1723 16.433C45.0508 16.433 45.9371 16.2143 46.5119 15.6046C46.5916 15.5186 46.6635 15.4248 46.7354 15.331H49.0992C48.8918 16.0657 48.5643 16.7299 48.0691 17.2454C47.111 18.2531 45.6339 18.6205 44.1723 18.6205C42.7108 18.6205 41.2337 18.2609 40.2755 17.2454C39.3174 16.2299 38.9661 14.6828 38.9661 13.1435C38.9661 11.6043 39.3096 10.0494 40.2755 9.04168C41.242 8.03396 42.7108 7.66663 44.1723 7.66663C45.6339 7.66663 47.111 8.02618 48.0691 9.04168C49.0351 10.0572 49.3786 11.6043 49.3786 13.1435V13.1431Z\" fill=\"currentColor\"/> <path d=\"M61.4045 13.1431V13.9948H55.0243V12.2996H59.2564C59.1602 11.6825 58.9372 11.1043 58.5378 10.682C57.963 10.0727 57.0762 9.85409 56.1982 9.85409C55.3202 9.85409 54.4335 10.0727 53.8587 10.682C53.2839 11.2913 53.0759 12.2213 53.0759 13.1435C53.0759 14.0658 53.2834 15.003 53.8587 15.6046C54.4335 16.2061 55.3202 16.433 56.1982 16.433C57.0762 16.433 57.963 16.2143 58.5378 15.6046C58.6179 15.5186 58.6894 15.4248 58.7608 15.331H61.1251C60.9171 16.0657 60.5897 16.7299 60.0945 17.2454C59.1364 18.2531 57.6593 18.6205 56.1982 18.6205C54.7372 18.6205 53.2596 18.2609 52.3014 17.2454C51.3432 16.2299 50.9919 14.6828 50.9919 13.1435C50.9919 11.6043 51.3355 10.0494 52.3014 9.04168C53.2678 8.03396 54.7367 7.66663 56.1982 7.66663C57.6598 7.66663 59.1364 8.02618 60.0945 9.04168C61.061 10.0572 61.4045 11.6043 61.4045 13.1435V13.1431Z\" fill=\"currentColor\"/> <path d=\"M80.242 18.6214C81.7035 18.6214 83.1801 18.4105 84.1383 17.809C85.0965 17.2075 85.4482 16.2931 85.4482 15.3869C85.4482 14.4807 85.1042 13.5585 84.1383 12.9647C83.1801 12.371 81.703 12.1518 80.242 12.1518C79.6186 12.1518 79.0438 12.0658 78.6366 11.8394C78.2294 11.6047 78.0778 11.2534 78.0778 10.9017C78.0778 10.5499 78.2216 10.1908 78.6366 9.9639C79.0438 9.72921 79.6749 9.65147 80.2973 9.65147C80.9198 9.65147 81.5509 9.73747 81.9591 9.9639C82.3663 10.1986 82.5179 10.5499 82.5179 10.9017H84.9531C84.9531 9.99499 84.6421 9.07327 83.7719 8.47951C82.9017 7.88576 81.5679 7.66663 80.2424 7.66663C78.9169 7.66663 77.5837 7.8775 76.713 8.47951C75.8427 9.08104 75.5308 9.99499 75.5308 10.9017C75.5308 11.8083 75.8423 12.73 76.713 13.3238C77.5832 13.9176 78.9165 14.1367 80.2424 14.1367C80.929 14.1367 81.688 14.2227 82.1428 14.4491C82.5985 14.676 82.7579 15.0351 82.7579 15.3869C82.7579 15.7387 82.5985 16.0977 82.1428 16.3246C81.688 16.5511 80.9931 16.6371 80.3066 16.6371C79.62 16.6371 78.9169 16.5511 78.4694 16.3246C78.0224 16.0982 77.8543 15.7387 77.8543 15.3869H75.0435C75.0435 16.2935 75.3865 17.2153 76.3534 17.809C77.3194 18.4028 78.7809 18.6214 80.2424 18.6214H80.242Z\" fill=\"currentColor\"/> <path d=\"M97.4733 13.1431V13.9948H91.0932V12.2996H95.3252C95.23 11.6825 95.006 11.1043 94.6071 10.682C94.0313 10.0727 93.1456 9.85409 92.2666 9.85409C91.3876 9.85409 90.5018 10.0727 89.927 10.682C89.3522 11.2913 89.1452 12.2213 89.1452 13.1435C89.1452 14.0658 89.3522 15.003 89.927 15.6046C90.5018 16.2061 91.3886 16.433 92.2666 16.433C93.1446 16.433 94.0313 16.2143 94.6071 15.6046C94.6863 15.5186 94.7587 15.4248 94.8301 15.331H97.1935C96.9855 16.0657 96.6585 16.7299 96.1639 17.2454C95.2057 18.2531 93.7281 18.6205 92.2666 18.6205C90.805 18.6205 89.3284 18.2609 88.3703 17.2454C87.4121 16.2299 87.0613 14.6828 87.0613 13.1435C87.0613 11.6043 87.4043 10.0494 88.3703 9.04168C89.3367 8.03396 90.806 7.66663 92.2666 7.66663C93.7272 7.66663 95.2057 8.02618 96.1639 9.04168C97.1298 10.0572 97.4729 11.6043 97.4729 13.1435L97.4733 13.1431Z\" fill=\"currentColor\"/> <path d=\"M109.499 13.1431V13.9948H103.119V12.2996H107.351C107.256 11.6825 107.032 11.1043 106.632 10.682C106.057 10.0727 105.172 9.85409 104.293 9.85409C103.414 9.85409 102.528 10.0727 101.953 10.682C101.378 11.2913 101.17 12.2213 101.17 13.1435C101.17 14.0658 101.378 15.003 101.953 15.6046C102.528 16.2061 103.415 16.433 104.293 16.433C105.171 16.433 106.057 16.2143 106.632 15.6046C106.712 15.5186 106.784 15.4248 106.856 15.331H109.22C109.012 16.0657 108.685 16.7299 108.19 17.2454C107.231 18.2531 105.754 18.6205 104.293 18.6205C102.831 18.6205 101.355 18.2609 100.396 17.2454C99.4382 16.2299 99.0864 14.6828 99.0864 13.1435C99.0864 11.6043 99.4295 10.0494 100.396 9.04168C101.362 8.03396 102.832 7.66663 104.293 7.66663C105.754 7.66663 107.231 8.02618 108.19 9.04168C109.156 10.0572 109.499 11.6043 109.499 13.1435V13.1431Z\" fill=\"currentColor\"/> <path d=\"M113.5 4.62817H111.104V18.6217H113.5V4.62817Z\" fill=\"currentColor\"/> <path d=\"M117.589 12.8154L121.517 18.6208H118.554L114.625 12.8154L118.554 8.15088H121.517L117.589 12.8154Z\" fill=\"currentColor\"/> <rect x=\"129.348\" y=\"5.5\" width=\"52\" height=\"14\" rx=\"2\" fill=\"currentColor\"/> <g clipPath=\"url(#maid-titlebar-brand-clip)\"> <path d=\"M132.848 8.93205H134.08V16.137H132.848V8.93205ZM136.5 8.93205H137.732V16.137H136.5V8.93205ZM133.365 13.024V11.99H137.193V13.024H133.365Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M140.397 14.432L140.672 13.453H143.202L143.532 14.432H140.397ZM140.287 16.137H139.055L141.277 8.93205H142.201L142.146 9.74605L140.947 13.915H140.969L140.287 16.137ZM145.039 16.137H143.741L143.07 13.948L143.081 13.937L141.871 9.74605L141.926 8.93205H142.817L145.039 16.137Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M146.846 8.93205H149.068C149.852 8.93205 150.443 9.11538 150.839 9.48205C151.235 9.84138 151.433 10.3327 151.433 10.956C151.433 11.22 151.396 11.4657 151.323 11.693C151.249 11.9204 151.125 12.1257 150.949 12.309C150.773 12.4924 150.531 12.65 150.223 12.782C149.922 12.9067 149.541 13.0057 149.079 13.079V13.321H146.846V12.639L148.023 12.485C148.631 12.4044 149.09 12.298 149.398 12.166C149.706 12.034 149.915 11.8764 150.025 11.693C150.135 11.5024 150.19 11.2934 150.19 11.066C150.19 10.6994 150.083 10.417 149.871 10.219C149.658 10.021 149.324 9.92205 148.87 9.92205H146.846V8.93205ZM146.395 8.93205H147.627V16.137H146.395V8.93205ZM151.917 16.093V16.137H150.366L149.024 14.322C148.87 14.1094 148.73 13.9407 148.606 13.816C148.481 13.684 148.345 13.5887 148.199 13.53C148.052 13.464 147.872 13.42 147.66 13.398C147.447 13.3687 147.176 13.3504 146.846 13.343V13.145H149.079C149.233 13.211 149.368 13.2844 149.486 13.365C149.61 13.4457 149.735 13.5447 149.86 13.662C149.992 13.7794 150.138 13.937 150.3 14.135L151.917 16.093Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M153.58 9.57005L153.591 8.93205H154.46L157.584 15.51V16.137H156.704L153.58 9.57005ZM158.024 16.137H156.968L156.88 8.93205H158.024V16.137ZM154.24 16.137H153.096V8.93205H154.152L154.24 16.137Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M159.963 8.93205H161.206V16.137H159.963V8.93205ZM160.095 9.96605V8.93205H164.858V9.96605H160.095ZM160.095 16.137V15.103H164.902V16.137H160.095ZM160.095 13.013V11.99H164.374V13.013H160.095Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M169.052 15.257C169.543 15.257 169.895 15.1654 170.108 14.982C170.328 14.7987 170.438 14.5457 170.438 14.223C170.438 14.047 170.405 13.8967 170.339 13.772C170.273 13.6474 170.152 13.5337 169.976 13.431C169.807 13.321 169.558 13.2147 169.228 13.112L168.491 12.881C167.846 12.6757 167.38 12.4044 167.094 12.067C166.808 11.7297 166.665 11.3007 166.665 10.78C166.665 10.428 166.76 10.1017 166.951 9.80105C167.142 9.50038 167.428 9.25838 167.809 9.07505C168.19 8.89172 168.663 8.80005 169.228 8.80005C169.631 8.80005 169.998 8.82938 170.328 8.88805C170.665 8.93938 171.039 9.01638 171.45 9.11905L171.274 10.175C170.834 10.0504 170.442 9.96238 170.097 9.91105C169.76 9.85238 169.463 9.82305 169.206 9.82305C168.737 9.82305 168.403 9.90738 168.205 10.076C168.007 10.2374 167.908 10.439 167.908 10.681C167.908 10.857 167.941 11.0147 168.007 11.154C168.073 11.286 168.19 11.407 168.359 11.517C168.535 11.627 168.784 11.7334 169.107 11.836L169.866 12.078C170.526 12.276 170.995 12.5327 171.274 12.848C171.553 13.156 171.692 13.585 171.692 14.135C171.692 14.5604 171.589 14.9344 171.384 15.257C171.179 15.5797 170.878 15.8327 170.482 16.016C170.093 16.1994 169.609 16.291 169.03 16.291C168.627 16.291 168.212 16.247 167.787 16.159C167.362 16.071 166.9 15.9427 166.401 15.774L166.665 14.718C167.156 14.894 167.6 15.0297 167.996 15.125C168.399 15.213 168.751 15.257 169.052 15.257Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> <path d=\"M175.809 15.257C176.3 15.257 176.652 15.1654 176.865 14.982C177.085 14.7987 177.195 14.5457 177.195 14.223C177.195 14.047 177.162 13.8967 177.096 13.772C177.03 13.6474 176.909 13.5337 176.733 13.431C176.564 13.321 176.315 13.2147 175.985 13.112L175.248 12.881C174.603 12.6757 174.137 12.4044 173.851 12.067C173.565 11.7297 173.422 11.3007 173.422 10.78C173.422 10.428 173.517 10.1017 173.708 9.80105C173.899 9.50038 174.185 9.25838 174.566 9.07505C174.947 8.89172 175.42 8.80005 175.985 8.80005C176.388 8.80005 176.755 8.82938 177.085 8.88805C177.422 8.93938 177.796 9.01638 178.207 9.11905L178.031 10.175C177.591 10.0504 177.199 9.96238 176.854 9.91105C176.517 9.85238 176.22 9.82305 175.963 9.82305C175.494 9.82305 175.16 9.90738 174.962 10.076C174.764 10.2374 174.665 10.439 174.665 10.681C174.665 10.857 174.698 11.0147 174.764 11.154C174.83 11.286 174.947 11.407 175.116 11.517C175.292 11.627 175.541 11.7334 175.864 11.836L176.623 12.078C177.283 12.276 177.752 12.5327 178.031 12.848C178.31 13.156 178.449 13.585 178.449 14.135C178.449 14.5604 178.346 14.9344 178.141 15.257C177.936 15.5797 177.635 15.8327 177.239 16.016C176.85 16.1994 176.366 16.291 175.787 16.291C175.384 16.291 174.969 16.247 174.544 16.159C174.119 16.071 173.657 15.9427 173.158 15.774L173.422 14.718C173.913 14.894 174.357 15.0297 174.753 15.125C175.156 15.213 175.508 15.257 175.809 15.257Z\" fill=\"var(--dsw-alias-label-primary-inverted)\"/> </g> <defs> <clipPath id=\"maid-titlebar-brand-clip\"> <rect width=\"46\" height=\"14\" fill=\"white\" transform=\"translate(132.348 5.5)\"/> </clipPath> </defs></svg>"
  ownedNodes.add(brand)
  titlebar.prepend(brand)
}

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const asset = (name) => `${ctx.assetBase}/assets/${name}`
      const body = document.body
      const originalTitle = document.title
      const viewportResizeLease = createBodyAttributeLease(body, 'data-maid-viewport-resizing')
      const lowPowerLease = createBodyAttributeLease(body, 'data-maid-low-power')
      // Whether body carried an inline style attribute before apply; the
      // cleanup drops an emptied attribute so teardown is byte-clean.
      const hadStyleAttribute = body.hasAttribute('style')
      const previous = new Map()
      for (const property of BACKDROP_PROPERTIES) {
        previous.set(property, body.style.getPropertyValue(property))
      }
      const previousProjectedStates = new Map()
      for (const attribute of Object.values(PROJECTED_STATE_ATTRIBUTES)) {
        previousProjectedStates.set(attribute, body.getAttribute(attribute))
      }

      const ownedNodes = new Set()
      const decoratedElements = new Set()
      let themeColorMeta = null
      let previousThemeColor
      let themeColorObserver
      let observedSidebar
      let resizeObserver
      let composerPhase
      let composerMotionTimer
      let viewportResizeTimer
      let handleViewportResize
      let railSearchFocusFrame
      let recoverRailSearchFocus
      let settingsBackdropFrame
      let observer
      let titlebarOverlay
      let syncTitlebarHeight

      // Registered first (as the v1 effect was) so a mid-apply failure
      // still retracts every write made so far.
      ctx.onCleanup(() => {
        delete body.dataset.maidComposerMotion
        delete body.dataset.maidSidebarCompact
        delete body.dataset.maidSidebarSize
        for (const [attribute, value] of previousProjectedStates) {
          if (value === null) body.removeAttribute(attribute)
          else body.setAttribute(attribute, value)
        }
        if (composerMotionTimer !== undefined) clearTimeout(composerMotionTimer)
        if (viewportResizeTimer !== undefined) clearTimeout(viewportResizeTimer)
        if (handleViewportResize !== undefined) window.removeEventListener('resize', handleViewportResize)
        viewportResizeLease.release()
        lowPowerLease.release()
        if (railSearchFocusFrame !== undefined) cancelAnimationFrame(railSearchFocusFrame)
        if (recoverRailSearchFocus !== undefined) {
          document.removeEventListener('click', recoverRailSearchFocus)
        }
        observer?.disconnect()
        themeColorObserver?.disconnect()
        if (titlebarOverlay !== undefined && syncTitlebarHeight !== undefined) {
          titlebarOverlay.removeEventListener('geometrychange', syncTitlebarHeight)
        }
        resizeObserver?.disconnect()
        for (const [property, value] of previous) {
          body.style.setProperty(property, value)
        }
        if (!hadStyleAttribute && body.style.length === 0) body.removeAttribute('style')
        ownedNodes.forEach((element) => element.remove())
        decoratedElements.forEach((element) => {
          delete element.dataset.maidSidebarFooter
          delete element.dataset.maidWorkspaceGroup
          delete element.dataset.maidWorkspaceRow
          delete element.dataset.maidWorkspaceActive
          delete element.dataset.maidSessionRow
          delete element.dataset.maidSessionFlat
          delete element.dataset.maidSessionFirst
          delete element.dataset.maidSessionLast
        })
        if (themeColorMeta?.isConnected && themeColorMeta.content === SKIN_SYSTEM_CHROME_COLOR) {
          themeColorMeta.content = previousThemeColor ?? ''
        }
        if (document.title === SKIN_TITLE) document.title = originalTitle
      })

      handleViewportResize = () => {
        viewportResizeLease.acquire()
        if (viewportResizeTimer !== undefined) clearTimeout(viewportResizeTimer)
        viewportResizeTimer = setTimeout(() => {
          viewportResizeLease.release()
          viewportResizeTimer = undefined
        }, VIEWPORT_RESIZE_SETTLE_MS)
      }
      window.addEventListener('resize', handleViewportResize)
      if (!hasAcceleratedWebGL()) lowPowerLease.acquire()

      const syncSystemChrome = () => {
        const meta = document.head.querySelector('meta[name="theme-color"]')
        if (meta === null) return
        if (meta !== themeColorMeta) {
          themeColorMeta = meta
          previousThemeColor = meta.content
        }
        if (meta.content !== SKIN_SYSTEM_CHROME_COLOR) meta.content = SKIN_SYSTEM_CHROME_COLOR
      }
      themeColorObserver = new MutationObserver(syncSystemChrome)
      themeColorObserver.observe(document.head, {
        attributes: true,
        attributeFilter: ['content'],
        childList: true,
        subtree: true,
      })
      syncSystemChrome()

      // The ornamental raster assets the compiled patches.css references
      // through these variables (v1 interpolated data URLs; v2 serves
      // files from assets/, so the URLs are absolute under assetBase —
      // relative URLs would break inside the inlined <style> pipeline).
      body.style.setProperty('--maid-top-trim-art', `url(${asset('maid-top-trim-tile-v1.webp')})`)
      body.style.setProperty('--maid-bottom-trim-art', `url(${asset('maid-bottom-trim-tile-v1.webp')})`)
      body.style.setProperty('--maid-bottom-crest-art', `url(${asset('maid-bottom-crest-v1.webp')})`)
      body.style.setProperty('--maid-bow-art', `url(${asset('maid-bow-v1.webp')})`)
      body.style.setProperty('--maid-new-session-art', `url(${asset('maid-new-session-v1.webp')})`)
      body.style.setProperty('--maid-sidebar-swag-art', `url(${asset('maid-sidebar-swag-v1.webp')})`)
      body.style.setProperty('--maid-sidebar-corner-art', `url(${asset('maid-sidebar-corner-v1.webp')})`)
      body.style.setProperty('--maid-composer-frame-art', `url(${asset('maid-composer-frame-v4.webp')})`)
      body.style.setProperty('--maid-settings-frame-art', `url(${asset('maid-settings-frame-v1.webp')})`)
      body.style.setProperty('--maid-workspace-crest-art', `url(${asset('maid-workspace-shield-v2.webp')})`)
      body.style.setProperty('--maid-workspace-ribbon-art', `url(${asset('maid-workspace-ribbon-v2.webp')})`)

      const syncBackdrop = () => {
        const source = ctx.theme.get() === 'dark'
          ? asset('maid-atelier-palace-night-v4.webp')
          : asset('maid-atelier-palace-day-v4.webp')
        body.style.setProperty('background-image', `url(${source})`)
      }
      syncBackdrop()
      body.style.setProperty('background-position', 'center top')
      body.style.setProperty('background-size', 'cover')
      body.style.setProperty('background-attachment', 'scroll')
      body.style.setProperty('background-repeat', 'no-repeat')

      // 宽度联动写入独立的 <style> 规则而非 body style：CSSOM 修改不产生
      // attribute mutation，Chrome autofill 的 MutationObserver 不会逐帧触发，
      // 因此可以每帧跟随侧边栏宽度（幕布瞬移跟手）而无需防抖节流。
      const widthSheet = document.createElement('style')
      widthSheet.dataset.skinChrome = 'sidebar-width-rule'
      widthSheet.dataset.skinOwner = SKIN_OWNER
      ownedNodes.add(widthSheet)
      document.head.append(widthSheet)
      const scope = `html[data-dsh-skin="${ctx.scopeAttr}"]`
      widthSheet.sheet.insertRule(`${scope} body { --maid-sidebar-width: 280px; --maid-sidebar-swag-height: 72.1px; --maid-sidebar-mascot-width: 229.6px; --maid-titlebar-height: 0px; }`)
      // The official frame rules reference env(titlebar-area-height), but the
      // CSS-modules pipeline rewrites the env() identifier there too, so the
      // title-bar row silently falls back to an auto row: expanding the sidebar
      // is fine, but collapsing it lets the content row's max-content grow and
      // stretches the title-bar row to hundreds of pixels. Re-assert the rows
      // here through CSSOM, where env() survives verbatim (fallback 40px keeps
      // the headless/plain-tab mock sane), and pin the drag handles to the same
      // boundary. The v1 body[data-dsh-maid-atelier] anchor is the loader-owned
      // html[data-dsh-skin] scope in v2.
      // insertRule defaults to index 0, which would push the body rule aside and
      // orphan the widthRule reference; append explicitly so cssRules[0] stays
      // the body variable rule.
      const appendRule = (rule) => {
        widthSheet.sheet.insertRule(rule, widthSheet.sheet.cssRules.length)
      }
      appendRule(`${scope} [class*="frame"][data-wco] { grid-template-rows: env(titlebar-area-height, 40px) 1fr; }`)
      appendRule(`${scope} [class*="frame"][data-desktop] { grid-template-rows: 32px 1fr; }`)
      appendRule(`${scope} [class*="frame"] [class*="handle"] { top: var(--maid-titlebar-height, 0px); }`)

      const widthRule = widthSheet.sheet.cssRules[0]
      // The curtain is position:fixed, so it needs the viewport-space top of
      // the frame's title-bar row. Measuring the sidebar column (the row below
      // it) is authoritative: whatever the title-bar height is — WCO env(), the
      // desktop 32px row, or a scaled window — the curtain lands exactly on the
      // rendered boundary, never a pixel off.
      syncTitlebarHeight = () => {
        const columns = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
        if (columns !== null) {
          const top = columns.getBoundingClientRect().top
          if (top > 0) {
            widthRule.style.setProperty('--maid-titlebar-height', `${top}px`)
            return
          }
        }
        // Desktop shell: fixed 32px row (columns not laid out yet).
        if (document.querySelector("[class*='frame'][data-desktop]") !== null) {
          widthRule.style.setProperty('--maid-titlebar-height', '32px')
          return
        }
        widthRule.style.setProperty('--maid-titlebar-height', '0px')
      }
      titlebarOverlay = navigator.windowControlsOverlay
      titlebarOverlay?.addEventListener('geometrychange', syncTitlebarHeight)
      syncTitlebarHeight()

      const applySidebarWidth = (width) => {
        if (width <= 0) return
        const roundPx = (value) => `${Math.round(value * 100) / 100}px`
        widthRule.style.setProperty('--maid-sidebar-width', roundPx(width))
        widthRule.style.setProperty('--maid-sidebar-swag-height', roundPx(Math.min(94, Math.max(54, width * 0.2575))))
        widthRule.style.setProperty('--maid-sidebar-mascot-width', roundPx(Math.min(320, width * 0.82)))
        body.dataset.maidSidebarSize = width <= 120 ? 'rail' : width <= 220 ? 'narrow' : 'wide'
        if (width <= 104) body.dataset.maidSidebarCompact = ''
        else delete body.dataset.maidSidebarCompact
      }

      const clearSidebarWidth = () => {
        widthRule.style.setProperty('--maid-sidebar-width', '0px')
        widthRule.style.setProperty('--maid-sidebar-swag-height', '54px')
        widthRule.style.setProperty('--maid-sidebar-mascot-width', '0px')
        body.dataset.maidSidebarSize = 'rail'
        body.dataset.maidSidebarCompact = ''
      }

      const syncProjectedState = () => {
        const set = (attribute, active) => {
          body.toggleAttribute(attribute, active)
        }
        set(
          PROJECTED_STATE_ATTRIBUTES.activeChat,
          document.querySelector(ACTIVE_CHAT_SELECTOR) !== null,
        )
        set(
          PROJECTED_STATE_ATTRIBUTES.activeConversation,
          document.querySelector(ACTIVE_CONVERSATION_SELECTOR) !== null,
        )
        set(
          PROJECTED_STATE_ATTRIBUTES.workspace,
          document.querySelector(WORKSPACE_SELECTOR) !== null,
        )
        set(
          PROJECTED_STATE_ATTRIBUTES.betterSidebarOpen,
          document.querySelector(BETTER_SIDEBAR_SELECTOR) !== null
            && !body.hasAttribute('data-dsh-sidebar-collapsed'),
        )
        set(
          PROJECTED_STATE_ATTRIBUTES.cordisPanelOpen,
          document.querySelector(CORDIS_PANEL_SELECTOR) !== null,
        )
        set(
          PROJECTED_STATE_ATTRIBUTES.settingsOpen,
          document.querySelector(SETTINGS_DIALOG_SELECTOR) !== null,
        )
      }

      const ensureSidebarObserved = () => {
        const sidebar = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
        if (!resizeObserver || sidebar === observedSidebar) return
        if (!sidebar) {
          if (observedSidebar) resizeObserver.unobserve(observedSidebar)
          observedSidebar = undefined
          return
        }
        if (observedSidebar) resizeObserver.unobserve(observedSidebar)
        observedSidebar = sidebar
        resizeObserver.observe(sidebar)
      }

      /* rc.6 can mount its wide search and its outside-click listener during the
         rail button's own click. That same event then reaches document with the
         detached rail button as its target and immediately collapses the field.
         Re-enter the component through its wide search root after the slide has
         mounted; newer workspace builds already keep the wide field open, so the
         rail-only origin check makes this compatibility path inert there. */
      recoverRailSearchFocus = (event) => {
        const target = event.target instanceof Element
          ? event.target.closest("button[class*='searchButton']")
          : null
        const railSearch = target?.closest("[class*='search']")
        if (target === null || railSearch == null
          || railSearch.querySelector("input[class*='searchInput']") !== null) return

        if (railSearchFocusFrame !== undefined) cancelAnimationFrame(railSearchFocusFrame)
        const startedAt = performance.now()
        const recover = () => {
          railSearchFocusFrame = undefined
          const input = document.querySelector(
            `${SIDEBAR_COLUMN_SELECTOR} input[class*='searchInput']`,
          )
          const searchRoot = input?.closest("[class*='search']")
          if (input !== null && input !== undefined && searchRoot !== null && searchRoot !== undefined) {
            searchRoot.click()
            input.focus({ preventScroll: true })
            return
          }
          if (performance.now() - startedAt < 500) {
            railSearchFocusFrame = requestAnimationFrame(recover)
          }
        }
        railSearchFocusFrame = requestAnimationFrame(recover)
      }
      document.addEventListener('click', recoverRailSearchFocus)

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries.at(-1)
          if (!entry) return
          applySidebarWidth(entry.contentRect.width)
        })
      }

      const syncComposerMotion = () => {
        const phaseRoot = document.querySelector("[data-phase='hero'], [data-phase='active']")
        const next = phaseRoot?.dataset.phase
        if (next !== 'hero' && next !== 'active') return

        if (composerPhase !== undefined && composerPhase !== next) {
          body.dataset.maidComposerMotion = next === 'active' ? 'dock' : 'rise'
          if (composerMotionTimer !== undefined) clearTimeout(composerMotionTimer)
          composerMotionTimer = setTimeout(() => {
            delete body.dataset.maidComposerMotion
            composerMotionTimer = undefined
          }, 560)
        }
        composerPhase = next
      }

      /* The settings mask is mounted inside a promoted sidebar descendant. Chrome
         can omit sibling composited layers from that backdrop sample, so seat a
         copy of the existing frame immediately before the mask while it is open. */
      const syncSettingsBackdropFrame = () => {
        const dialog = document.querySelector(SETTINGS_DIALOG_SELECTOR)
        const mask = dialog === null
          ? null
          : document.querySelector(SETTINGS_MASK_SELECTOR)
        const overlay = mask?.parentElement
        if (overlay === undefined || overlay === null) {
          settingsBackdropFrame?.remove()
          return
        }

        if (settingsBackdropFrame === undefined) {
          settingsBackdropFrame = createSidebarCorners()
          settingsBackdropFrame.dataset.maidSettingsBackdropFrame = ''
          ownedNodes.add(settingsBackdropFrame)
        }
        if (settingsBackdropFrame.parentElement !== overlay) {
          overlay.insertBefore(settingsBackdropFrame, mask)
        }
      }

      const createCharacterStage = () => {
        const stage = document.createElement('div')
        stage.dataset.skinChrome = 'character-stage'
        stage.dataset.skinOwner = SKIN_OWNER
        stage.setAttribute('aria-hidden', 'true')

        const left = document.createElement('img')
        left.dataset.maidCharacter = 'left'
        left.alt = ''
        left.src = asset('maid-atelier-maid-left-v5.webp')

        const right = document.createElement('img')
        right.dataset.maidCharacter = 'right'
        right.alt = ''
        right.src = asset('maid-atelier-maid-right-v6.webp')

        stage.append(left, right)
        return stage
      }

      const decorateSidebar = (owned, decorated) => {
        const sidebar = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
        const sidebarRoot = sidebar?.querySelector(':scope > div')
        if (!sidebar || !sidebarRoot) return

        sidebar.querySelectorAll('[data-maid-sidebar-footer]').forEach((element) => {
          delete element.dataset.maidSidebarFooter
        })
        const settingsSlot = sidebar.querySelector("[data-slot='sidebar.settings']")
        if (settingsSlot) {
          let footer = settingsSlot.parentElement
          while (footer && footer !== sidebar) {
            if (footer.querySelector("[data-slot='sidebar.footer.action']")) {
              footer.dataset.maidSidebarFooter = ''
              decorated.add(footer)
              break
            }
            footer = footer.parentElement
          }
        }

        if (!sidebarRoot.querySelector("[data-skin-chrome='sidebar-corners']")) {
          const corners = createSidebarCorners()
          owned.add(corners)
          sidebarRoot.prepend(corners)
        }

        if (!sidebarRoot.querySelector("[data-skin-chrome='sidebar-mascot']")) {
          const mascot = document.createElement('img')
          mascot.dataset.skinChrome = 'sidebar-mascot'
          mascot.dataset.skinOwner = SKIN_OWNER
          mascot.setAttribute('aria-hidden', 'true')
          mascot.alt = ''
          mascot.src = asset('maid-chibi-v1.webp')
          owned.add(mascot)
          sidebarRoot.prepend(mascot)
        }
      }

      const decorateWorkspaceTree = (decorated) => {
        const sidebar = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
        if (!sidebar) return

        sidebar.querySelectorAll(
          '[data-maid-workspace-group], [data-maid-workspace-row], [data-maid-workspace-active], [data-maid-session-row], [data-maid-session-flat], [data-maid-session-first], [data-maid-session-last]',
        ).forEach((element) => {
          delete element.dataset.maidWorkspaceGroup
          delete element.dataset.maidWorkspaceRow
          delete element.dataset.maidWorkspaceActive
          delete element.dataset.maidSessionRow
          delete element.dataset.maidSessionFlat
          delete element.dataset.maidSessionFirst
          delete element.dataset.maidSessionLast
        })

        sidebar.querySelectorAll("[role='tree']").forEach((tree) => {
          const rows = [...tree.querySelectorAll("[role='treeitem']")]
          if (tree.matches("[class*='flatList']") && !rows.some((row) => row.hasAttribute('aria-expanded'))) {
            rows.filter((row) => row.hasAttribute('aria-selected')).forEach((sessionRow) => {
              sessionRow.dataset.maidSessionRow = ''
              sessionRow.dataset.maidSessionFlat = ''
              decorated.add(sessionRow)
            })
            return
          }

          let workspaceRow
          let sessionRows = []
          const decorateGroup = () => {
            if (!workspaceRow) return

            workspaceRow.dataset.maidWorkspaceRow = ''
            decorated.add(workspaceRow)
            if (workspaceRow.parentElement) {
              workspaceRow.parentElement.dataset.maidWorkspaceGroup = ''
              decorated.add(workspaceRow.parentElement)
            }
            sessionRows.forEach((sessionRow) => {
              sessionRow.dataset.maidSessionRow = ''
              decorated.add(sessionRow)
            })
            if (sessionRows[0]) sessionRows[0].dataset.maidSessionFirst = ''
            if (sessionRows.at(-1)) sessionRows.at(-1).dataset.maidSessionLast = ''

            const containsCurrent = workspaceRow.getAttribute('aria-expanded') === 'true'
              && sessionRows.some((sessionRow) => sessionRow.getAttribute('aria-selected') === 'true')
            if (containsCurrent) workspaceRow.dataset.maidWorkspaceActive = ''
          }

          rows.forEach((row) => {
            if (row.hasAttribute('aria-expanded')) {
              decorateGroup()
              workspaceRow = row
              sessionRows = []
            } else if (workspaceRow && row.hasAttribute('aria-selected')) {
              sessionRows.push(row)
            }
          })
          decorateGroup()
        })
      }

      decorateTitlebarBrand(ownedNodes)
      decorateSidebar(ownedNodes, decoratedElements)
      decorateWorkspaceTree(decoratedElements)
      ensureSidebarObserved()
      const initialSidebar = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
      if (initialSidebar) applySidebarWidth(initialSidebar.getBoundingClientRect().width)
      syncComposerMotion()
      syncSettingsBackdropFrame()
      syncProjectedState()

      const characterStage = createCharacterStage()
      ownedNodes.add(characterStage)
      body.prepend(characterStage)

      const syncSidebarDecorations = () => {
        syncTitlebarHeight?.()
        decorateTitlebarBrand(ownedNodes)
        decorateSidebar(ownedNodes, decoratedElements)
        decorateWorkspaceTree(decoratedElements)
        ensureSidebarObserved()
        const sidebar = document.querySelector(SIDEBAR_COLUMN_SELECTOR)
        if (sidebar === null) clearSidebarWidth()
        else if (resizeObserver === undefined) applySidebarWidth(sidebar.getBoundingClientRect().width)
      }

      const isSkinChrome = (node) => (
        node instanceof Element && node.getAttribute('data-skin-owner') === SKIN_OWNER
      )

      const nodeTouches = (node, selector) => (
        node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null)
      )
      const sidebarChromeSelector = `${SIDEBAR_COLUMN_SELECTOR}, [class*='titlebar']`
      const composerSelector = "[data-phase='hero'], [data-phase='active']"

      // ResizeObserver writes the animated width through CSSOM, so it never enters
      // this observer. Keep structural decoration in the MutationObserver checkpoint
      // before paint: delaying every change made the wide/rail hand-off visibly late.
      // Skin-owned insertions are ignored so decorating a React-owned node cannot
      // schedule a redundant whole-sidebar pass.
      observer = new MutationObserver((records) => {
        let sidebarStructureChanged = false
        let workspaceStateChanged = false
        let backdropChanged = false
        let composerChanged = false
        let settingsStateChanged = false
        let projectedStateChanged = false
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : undefined
          if (target?.closest(TERMINAL_SELECTOR) !== null) continue

          if (record.type === 'attributes') {
            if (record.attributeName === 'aria-expanded'
              && target !== undefined
              && target.closest("[data-slot='sidebar.settings']") !== null) {
              settingsStateChanged = true
              projectedStateChanged = true
            } else if ((record.attributeName === 'aria-expanded' || record.attributeName === 'aria-selected')
              && target !== undefined && target.closest(SIDEBAR_COLUMN_SELECTOR) !== null) {
              workspaceStateChanged = true
            } else if (record.attributeName === 'data-ds-dark-theme' && record.target === body) {
              backdropChanged = true
            } else if (record.attributeName === 'data-phase') {
              composerChanged = true
            }
            if (record.attributeName === 'data-phase'
              || record.attributeName === 'data-chat-flow'
              || record.attributeName === 'data-dsh-better-sidebar'
              || record.attributeName === 'data-dsh-sidebar-collapsed'
              || record.attributeName === 'data-cordis-panel'
              || record.attributeName === 'data-slot'
              || record.attributeName === 'role') {
              projectedStateChanged = true
            }
            continue
          }
          const appNodes = [...record.addedNodes, ...record.removedNodes]
            .filter((node) => node instanceof Element && !isSkinChrome(node))
          if (appNodes.length > 0 && (appNodes.some((node) => nodeTouches(node, sidebarChromeSelector))
            || (target !== undefined && target.closest(SIDEBAR_COLUMN_SELECTOR) !== null))) {
            sidebarStructureChanged = true
          }
          if (appNodes.length > 0 && (appNodes.some((node) => nodeTouches(node, composerSelector))
            || (target !== undefined && target.closest(composerSelector) !== null))) {
            composerChanged = true
          }
          if (appNodes.some((node) => nodeTouches(node, SETTINGS_MASK_SELECTOR))) {
            settingsStateChanged = true
          }
          if (appNodes.length > 0 && (appNodes.some((node) => nodeTouches(node, PROJECTED_STATE_SELECTOR))
            || target?.matches("header, [data-slot='sidebar.settings']") === true)) {
            projectedStateChanged = true
          }
        }
        if (projectedStateChanged) syncProjectedState()
        if (sidebarStructureChanged) syncSidebarDecorations()
        else if (workspaceStateChanged) decorateWorkspaceTree(decoratedElements)
        if (backdropChanged) syncBackdrop()
        if (composerChanged) {
          syncComposerMotion()
        }
        if (settingsStateChanged) syncSettingsBackdropFrame()
      })
      observer.observe(body, {
        attributes: true,
        attributeFilter: [
          'aria-expanded',
          'aria-selected',
          'data-chat-flow',
          'data-cordis-panel',
          'data-ds-dark-theme',
          'data-dsh-better-sidebar',
          'data-dsh-sidebar-collapsed',
          'data-phase',
          'data-slot',
          'role',
        ],
        childList: true,
        subtree: true,
      })

      const topTrim = document.createElement('div')
      topTrim.dataset.skinChrome = 'top-trim'
      topTrim.dataset.skinOwner = SKIN_OWNER
      topTrim.setAttribute('aria-hidden', 'true')
      const landingTrimLayer = document.createElement('div')
      landingTrimLayer.dataset.skinTrimLayer = 'landing'
      const workspaceTrimLayer = document.createElement('div')
      workspaceTrimLayer.dataset.skinTrimLayer = 'workspace'
      topTrim.append(landingTrimLayer, workspaceTrimLayer)
      ownedNodes.add(topTrim)
      body.append(topTrim)

      const bottomTrim = document.createElement('div')
      bottomTrim.dataset.skinChrome = 'bottom-trim'
      bottomTrim.dataset.skinOwner = SKIN_OWNER
      bottomTrim.setAttribute('aria-hidden', 'true')
      ownedNodes.add(bottomTrim)
      body.append(bottomTrim)

      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      // v1 declared type="image/png" while the icon was always WebP; the
      // type attribute is simply omitted here (the official favicon
      // convention) so it cannot disagree with the asset again.
      favicon.href = asset('maid-atelier-icon.webp')
      favicon.dataset.skinChrome = 'favicon'
      favicon.dataset.skinOwner = SKIN_OWNER
      ownedNodes.add(favicon)
      document.head.append(favicon)

      document.title = SKIN_TITLE
    },
  }
}
