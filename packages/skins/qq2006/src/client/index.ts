import type { Context } from '@deepseek-ai/cordis'
import css from './qq2006.module.css'

const SKIN_TITLE = 'QQ2006 · DeepSeek Online'
const cls = (name: keyof typeof css): string => css[name] ?? ''

const PENGUIN_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">',
  '<ellipse cx="24" cy="27" rx="15" ry="18" fill="#20252b"/>',
  '<ellipse cx="24" cy="31" rx="9.5" ry="12.5" fill="#f7f7f7"/>',
  '<ellipse cx="24" cy="13" rx="11.5" ry="10" fill="#20252b"/>',
  '<ellipse cx="24" cy="14.5" rx="7.5" ry="5.8" fill="#f7f7f7"/>',
  '<circle cx="20" cy="12.5" r="2" fill="#fff"/><circle cx="20" cy="12.5" r="1" fill="#101010"/>',
  '<circle cx="28" cy="12.5" r="2" fill="#fff"/><circle cx="28" cy="12.5" r="1" fill="#101010"/>',
  '<polygon points="24,15 21.5,17.3 24,18.7 26.5,17.3" fill="#ff9a16"/>',
  '<rect x="13" y="20" width="22" height="5" rx="2" fill="#e93222"/>',
  '<path d="M14 24 q-3 5 -1 9 q2 -1 3 -7z" fill="#e93222"/>',
  '<ellipse cx="19" cy="45" rx="5" ry="2.5" fill="#ff9a16"/>',
  '<ellipse cx="29" cy="45" rx="5" ry="2.5" fill="#ff9a16"/>',
  '</svg>',
].join('')

/** Mount the self-contained classic chrome and retract every write on dispose. */
export function apply(ctx: Context): void {
  const body = document.body
  const originalTitle = document.title
  body.dataset.dshQq2006 = ''

  const titlebar = document.createElement('div')
  titlebar.className = cls('qqTitlebar')
  titlebar.dataset.skinChrome = 'titlebar'

  const icon = document.createElement('span')
  icon.className = cls('qqIcon')
  icon.innerHTML = PENGUIN_SVG

  const title = document.createElement('span')
  title.className = cls('qqTitle')
  title.textContent = SKIN_TITLE
  titlebar.append(icon, title)

  for (const glyph of ['_', '□', '×']) {
    const control = document.createElement('span')
    control.className = cls('qqWindowButton')
    control.setAttribute('aria-hidden', 'true')
    control.textContent = glyph
    titlebar.append(control)
  }

  const statusbar = document.createElement('div')
  statusbar.className = cls('qqStatusbar')
  statusbar.dataset.skinChrome = 'statusbar'
  const online = document.createElement('span')
  online.className = cls('qqOnline')
  online.textContent = 'Online'
  const ready = document.createElement('span')
  ready.textContent = 'QQ2006 · Ready'
  statusbar.append(online, ready)

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(PENGUIN_SVG)}`

  document.title = SKIN_TITLE
  document.head.append(favicon)
  body.append(titlebar, statusbar)

  ctx.effect(() => () => {
    delete body.dataset.dshQq2006
    titlebar.remove()
    statusbar.remove()
    favicon.remove()
    if (document.title === SKIN_TITLE) document.title = originalTitle
  }, 'ui-skin-qq2006: classic chrome')
}
