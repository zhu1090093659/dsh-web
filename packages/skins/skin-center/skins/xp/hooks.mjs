/**
 * Windows XP Luna (xp) skin hooks — the trusted escape hatch of the v2
 * skin contract (x-org.linxin666.skin-center/v1alpha1), reviewed and
 * released with this repository. Loading this module executes nothing;
 * apply() owns every DOM write and registers its retraction through
 * ctx.onCleanup.
 *
 * Port of the v1 plugin effects (packages/skins/xp/src/client/index.ts):
 *  - window chrome: the fixed title bar and status bar, plus the Start
 *    button injected into the sidebar footer strip. These are interactive
 *    (the Start button clicks through to the settings trigger and the
 *    taskbar strip keeps its hover styles), so they mount on document.body
 *    exactly as v1 did — the pointer-events:none decoration layers would
 *    kill the hover/click behavior.
 *  - Start-button reinstall: v1 watched document.body (childList, subtree)
 *    with a MutationObserver and re-ran the install until dispose, because
 *    the sidebar footer re-renders and the settings dialog portals into
 *    the sidebar column. The watch target and install conditions are kept
 *    verbatim.
 *  - favicon (inline four-color-flag SVG data URI) and the pinned document
 *    title (restored on dispose only when the skin's own title still
 *    stands).
 * The class names are the css-modules hashes the compiled patches.css
 * carries; the stylesheet scoping is loader-owned
 * (html[data-dsh-skin="xp"]).
 */

/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
const SKIN_TITLE = 'Windows XP · DeepSeek 在线'

/** Title bar caption buttons (decorative glyphs, aria-hidden). */
const TITLEBAR_GLYPHS = ['–', '□', '×']

/** Status bar cells; the key cells are the classic CAPS/NUM/SCRL indicators. */
const STATUS_CELLS = [
  { text: '就绪', key: false },
  { text: 'DeepSeek 在线', key: false },
  { text: '大写', key: true },
  { text: '数字', key: true },
  { text: '滚动', key: true },
]

/** The classic four-color Windows flag, inline so the skin carries no static assets. */
const FLAG_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">',
  '<rect x="0.5" y="0.5" width="15" height="15" fill="#f0f6fd"/>',
  '<rect x="1.5" y="1.5" width="6.5" height="6.5" fill="#e33e2b"/>',
  '<rect x="8" y="1.5" width="6.5" height="6.5" fill="#4baf4d"/>',
  '<rect x="1.5" y="8" width="6.5" height="6.5" fill="#2d6fd6"/>',
  '<rect x="8" y="8" width="6.5" height="6.5" fill="#f4b400"/>',
  '</svg>',
].join('')

/** Four-color-flag favicon, inline data URI. */
const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
  '<rect x="2" y="2" width="60" height="60" fill="#f0f6fd"/>',
  '<rect x="7" y="7" width="25" height="25" fill="#e33e2b"/>',
  '<rect x="32" y="7" width="25" height="25" fill="#4baf4d"/>',
  '<rect x="7" y="32" width="25" height="25" fill="#2d6fd6"/>',
  '<rect x="32" y="32" width="25" height="25" fill="#f4b400"/>',
  '</svg>',
].join('')

/** The sidebar footer strip the Start button lives in (ui-sidebar footArea). */
const SIDEBAR_FOOT_SELECTOR = "[data-pane='sidebar'] > div > :last-child"

/** Find the sidebar footer strip and the settings trigger button inside it. */
function findSidebarFoot() {
  const sidebar = document.querySelector(':is([data-pane="sidebar"], [data-slot="sidebar"], [data-dsh-surface="sidebar"], [class*="sidebarCol"])')
  if (!sidebar) return null

  // 1. Locate the settings trigger by semantic dialog popup, aria label, text or icon
  const buttons = Array.from(sidebar.querySelectorAll('button'))
  const settingsBtn = buttons.find(btn =>
    btn.getAttribute('aria-haspopup') === 'dialog' ||
    btn.getAttribute('aria-label')?.includes('设置') ||
    btn.getAttribute('aria-label')?.toLowerCase().includes('setting') ||
    btn.textContent?.includes('设置') ||
    btn.textContent?.toLowerCase().includes('settings') ||
    btn.querySelector('svg[class*="setting"], [class*="setting"]') !== null
  )

  if (settingsBtn && settingsBtn.parentElement) {
    return { foot: settingsBtn.parentElement, settingsBtn }
  }

  // 2. Fallback to structural last-child inside sidebar
  const fallback = sidebar.querySelector(':scope > div > :last-child') || document.querySelector(SIDEBAR_FOOT_SELECTOR)
  if (fallback) {
    const btn = fallback.querySelector('button')
    return { foot: fallback, settingsBtn: btn }
  }

  return null
}

/** Compiled css-modules class names (see patches.css). */
const CLS = {
  xpTitlebar: 'Ce-zfq_xpTitlebar',
  xpTitlebarIcon: 'Ce-zfq_xpTitlebarIcon',
  xpTitlebarTitle: 'Ce-zfq_xpTitlebarTitle',
  xpTitlebarBtn: 'Ce-zfq_xpTitlebarBtn',
  xpTitlebarBtnClose: 'Ce-zfq_xpTitlebarBtnClose',
  xpStatusbar: 'Ce-zfq_xpStatusbar',
  xpStatusbarSpacer: 'Ce-zfq_xpStatusbarSpacer',
  xpStatusbarCell: 'Ce-zfq_xpStatusbarCell',
  xpStatusbarKey: 'Ce-zfq_xpStatusbarKey',
  xpStart: 'Ce-zfq_xpStart',
  xpStartIcon: 'Ce-zfq_xpStartIcon',
  xpTaskbar: 'Ce-zfq_xpTaskbar',
}

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const body = document.body
      const originalTitle = document.title

      const titlebar = document.createElement('div')
      titlebar.className = CLS.xpTitlebar
      titlebar.dataset.skinChrome = 'titlebar'
      const icon = document.createElement('span')
      icon.className = CLS.xpTitlebarIcon
      icon.innerHTML = FLAG_SVG
      const title = document.createElement('span')
      title.className = CLS.xpTitlebarTitle
      title.textContent = SKIN_TITLE
      titlebar.append(icon, title)
      for (const glyph of TITLEBAR_GLYPHS) {
        const btn = document.createElement('span')
        btn.className = glyph === '×' ? CLS.xpTitlebarBtnClose : CLS.xpTitlebarBtn
        btn.setAttribute('aria-hidden', 'true')
        btn.textContent = glyph
        titlebar.append(btn)
      }

      const statusbar = document.createElement('div')
      statusbar.className = CLS.xpStatusbar
      statusbar.dataset.skinChrome = 'statusbar'
      const spacer = document.createElement('span')
      spacer.className = CLS.xpStatusbarSpacer
      statusbar.append(spacer)
      for (const cell of STATUS_CELLS) {
        const el = document.createElement('span')
        el.className = cell.key ? CLS.xpStatusbarKey : CLS.xpStatusbarCell
        el.textContent = cell.text
        statusbar.append(el)
      }

      // The Start button opens the settings dialog by forwarding to the real
      // settings trigger in the sidebar footer strip. The footer may mount after
      // the skin settles (and re-render), and the settings dialog portals into
      // the sidebar column (making :last-child point at the portal), so install
      // is anchored on the trigger button and re-runs on DOM changes until
      // dispose.
      const mountStart = () => {
        const install = () => {
          const match = findSidebarFoot()
          if (!match || !match.foot) return
          const { foot, settingsBtn } = match
          if (!foot.querySelector('[class*="xpStart"]')) {
            const start = document.createElement('button')
            start.type = 'button'
            start.className = CLS.xpStart
            const startIcon = document.createElement('span')
            startIcon.className = CLS.xpStartIcon
            startIcon.innerHTML = FLAG_SVG
            start.append(startIcon, document.createTextNode('开始'))
            start.addEventListener('click', () => settingsBtn?.click())
            foot.insertBefore(start, foot.firstChild)
          }
          // Anchor the taskbar styling on the real footer strip: a :last-child
          // anchor would leak the white footer-button color into every dialog
          // control.
          foot.classList.add(CLS.xpTaskbar)
        }
        const observer = new MutationObserver(install)
        observer.observe(document.body, { childList: true, subtree: true })
        install()
        return () => {
          observer.disconnect()
          const starts = document.querySelectorAll('[class*="xpStart"]')
          for (const start of starts) {
            start.parentElement?.classList.remove(CLS.xpTaskbar)
            start.remove()
          }
          const taskbars = document.querySelectorAll(`.${CLS.xpTaskbar}`)
          for (const bar of taskbars) bar.classList.remove(CLS.xpTaskbar)
        }
      }

      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON_SVG)}`
      document.head.append(favicon)

      document.title = SKIN_TITLE
      body.append(titlebar, statusbar)
      const disposeStart = mountStart()

      ctx.onCleanup(() => {
        titlebar.remove()
        statusbar.remove()
        disposeStart()
        favicon.remove()
        // Only restore when the skin's own title still stands — a session title
        // projected by the shell must not be clobbered by skin teardown.
        if (document.title === SKIN_TITLE) document.title = originalTitle
      })
    },
  }
}
