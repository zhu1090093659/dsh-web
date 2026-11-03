/**
 * Defence in depth for the rendered SVG.
 *
 * Mermaid's strict security level already escapes label content, but the SVG is
 * third-party output injected into the page, so it is parsed in a detached
 * document first and stripped of anything executable: script-ish elements,
 * `on*` handlers and `javascript:` URLs. Cleaned markup is returned; input that
 * still carries a dangerous token after cleaning throws, and the caller falls
 * back to the untouched code block.
 *
 * One walk does both removals: dropping a disallowed element drops everything
 * beneath it, so a second pass would only re-examine nodes that are already
 * detached. The suspicious-token check runs as a case-insensitive pattern over
 * the markup rather than over a lowercased copy of it, because a large diagram
 * is hundreds of kilobytes of markup and that copy is pure garbage.
 * @module @linxin666/dsh-client-ui-diagrams/client/sanitize
 */

/** Elements that must never reach the page from a diagram's markup. */
const DISALLOWED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed'])

/** A token that may not survive sanitizing: a script open tag or a javascript: URL. */
const SUSPICIOUS_CONTENT = /<script|javascript:/i

/** An attribute name that is an event handler (`onclick`, `onload`, ...). */
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

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (DISALLOWED_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (isEventHandler(attribute.name) || isScriptUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const cleaned = template.innerHTML
  if (SUSPICIOUS_CONTENT.test(cleaned)) {
    throw new Error('diagrams: rendered SVG still carries executable content after sanitizing')
  }
  return cleaned
}
