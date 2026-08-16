/** Violet Evergarden skin with embedded wallpaper and translucent panes. */
import type { Context } from '@deepseek-ai/cordis'
import { VIOLET_BACKGROUND } from './scene-art.ts'
import { mountVioletScene } from './scene.ts'
import './violet.module.css'

const TITLE = 'Violet Evergarden · DeepSeek'
const ATTR = 'dshViolet'
const PROPERTIES = ['background-image', 'background-position', 'background-size', 'background-attachment', 'background-repeat'] as const
const SCRIM_LIGHT = 'linear-gradient(rgba(31, 32, 34, 0.02), rgba(31, 32, 34, 0.1)), '
const SCRIM_DARK = 'linear-gradient(rgba(21, 22, 24, 0.1), rgba(21, 22, 24, 0.28)), '

export function apply(ctx: Context): void {
  const body = document.body
  const originalTitle = document.title
  const previous = new Map<string, string>()
  for (const property of PROPERTIES) previous.set(property, body.style.getPropertyValue(property))
  body.dataset[ATTR] = ''
  const setBackdrop = (): void => {
    const scrim = body.dataset.dsDarkTheme !== undefined ? SCRIM_DARK : SCRIM_LIGHT
    body.style.setProperty('background-image', `${scrim}url(${VIOLET_BACKGROUND})`)
    body.style.setProperty('background-position', 'center, center')
    body.style.setProperty('background-size', 'cover, cover')
    body.style.setProperty('background-attachment', 'fixed, fixed')
    body.style.setProperty('background-repeat', 'no-repeat, no-repeat')
  }
  setBackdrop()
  const removeScene = mountVioletScene(body)
  const observer = new MutationObserver(setBackdrop)
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  document.title = TITLE
  ctx.effect(() => () => {
    observer.disconnect()
    removeScene()
    delete body.dataset[ATTR]
    for (const [property, value] of previous) body.style.setProperty(property, value)
    if (document.title === TITLE) document.title = originalTitle
  }, 'ui-skin-violet-evergarden: wallpaper backdrop')
}
