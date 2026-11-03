/**
 * Shell theme signal for diagram rendering.
 *
 * The shell marks a dark palette with `data-ds-dark-theme` on `<body>`; mermaid
 * renders colors into the SVG itself, so a theme flip must re-render the
 * diagrams rather than recolor them with CSS.
 * @module @linxin666/dsh-client-ui-diagrams/client/theme
 */

/** Mermaid theme name for the shell palette. */
export function mermaidTheme(isDark: boolean): 'default' | 'dark' {
  return isDark ? 'dark' : 'default'
}

/** Whether the shell currently carries the dark-palette marker. */
export function shellIsDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

/**
 * Watch the dark-palette marker.
 * @param onChange - Called with the new state on every flip.
 * @returns The disposer.
 */
export function watchTheme(onChange: (isDark: boolean) => void): () => void {
  const observer = new MutationObserver(() => { onChange(shellIsDark()) })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => { observer.disconnect() }
}
