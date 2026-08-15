/**
 * `auto` theme resolution: mermaid has no CSS variable bridge, so sample the
 * body background luminance (every skin repaints the body, so this tracks
 * the active skin) and fall back to the OS preference when the background is
 * not a plain rgb color.
 * @module @linxin666/dsh-client-ui-mermaid/client/auto-theme
 */

import type { MermaidBuiltInTheme } from '../core/themes.ts'

/**
 * Resolve the mermaid built-in theme for the current interface brightness.
 * @param doc - the browser document.
 * @returns `dark` for dark interfaces, `default` otherwise.
 */
export function resolveAutoTheme(doc: Document): MermaidBuiltInTheme {
  const bg = doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? ''
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
  if (match !== null) {
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])] as const
    // Perceived luminance (Rec. 601); mermaid's dark themes sit well below .5.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance < 0.5 ? 'dark' : 'default'
  }
  return doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'default'
}
