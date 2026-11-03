/**
 * Defence in depth for the rendered SVG.
 *
 * Mermaid's strict security level already escapes label content, but the SVG is
 * third-party output injected into the page, so it is parsed in a detached
 * document first and stripped of anything executable: script-ish elements,
 * `on*` handlers and `javascript:` URLs. Cleaned markup is returned; input that
 * still carries a dangerous token after cleaning throws, and the caller falls
 * back to the untouched code block.
 * @module @linxin666/dsh-client-ui-diagrams/client/sanitize
 */

/** Elements that must never reach the page from a diagram's markup. */
const DISALLOWED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed'])

/** An attribute name that is an event handler (`onclick`, `onload`, …). */
function isEventHandler(name: string): boolean {
  return /^on/i.test(name)
}

/** A href-like value that executes script when followed. */
function isScriptUrl(value: string): boolean {
  return /^\s*javascript:/i.test(value)
}

/**
 * Strip executable content from one rendered diagram.
 * @param svg - Markup returned by the mermaid runtime.
 * @returns The cleaned markup, safe to assign as `innerHTML`.
 * @throws When the markup cannot be parsed or still carries a dangerous token.
 */
export function sanitizeSvg(svg: string): string {
  const template = document.createElement('template')
  template.innerHTML = svg
  const root = template.content

  // Removals can expose nested offenders, so repeat until a pass finds none.
  for (let removed = true; removed;) {
    removed = false
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (DISALLOWED_ELEMENTS.has(element.tagName.toLowerCase())) {
        element.remove()
        removed = true
      }
    }
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (isEventHandler(attribute.name) || isScriptUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const cleaned = template.innerHTML
  const lowered = cleaned.toLowerCase()
  if (lowered.includes('<script') || lowered.includes('javascript:')) {
    throw new Error('diagrams: rendered SVG still carries executable content after sanitizing')
  }
  return cleaned
}
