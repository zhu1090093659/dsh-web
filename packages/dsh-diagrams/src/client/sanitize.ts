/**
 * Defence in depth for the rendered SVG.
 *
 * Mermaid's strict security level already escapes label content, but the SVG is
 * third-party output injected into the page, so it is parsed in a detached
 * document first and stripped of anything executable: script-ish elements,
 * `on*` handlers and URL attributes with an executable scheme. Cleaned markup is
 * returned; input that still carries a dangerous token after cleaning throws, and
 * the caller falls back to the untouched code block.
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

/**
 * URL schemes that can carry or turn into executable content.
 *
 * `javascript:` and `vbscript:` run script when the link is followed; `data:` can
 * navigate to attacker-authored markup (`data:text/html,...`), and the mermaid
 * runtime's own `@braintree/sanitize-url` already blocks all three, so nothing it
 * renders depends on a `data:` target.
 */
const EXECUTABLE_SCHEMES = new Set(['javascript:', 'vbscript:', 'data:'])

/**
 * A URL attribute value whose scheme is executable once the browser parses it.
 *
 * The value is parsed instead of prefix-matched: a browser removes ASCII tab, line
 * feed and carriage return characters anywhere in a URL and leading C0 controls and
 * spaces before it reads the scheme, so `java<TAB>script:` and ` javascript:` both
 * execute while a `^\s*javascript:` test sees neither. Parsing also sees the
 * entity-decoded form, because the attribute is already decoded by the time the
 * template parses the markup. A value without a colon carries no scheme, so it skips
 * the parse; the base only makes a relative value absolute and is never fetched.
 */
function isExecutableUrl(value: string): boolean {
  if (!value.includes(':')) {
    return false
  }
  try {
    return EXECUTABLE_SCHEMES.has(new URL(value, 'https://diagram.invalid/').protocol)
  } catch {
    return false
  }
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
      if (isEventHandler(attribute.name) || isExecutableUrl(attribute.value)) {
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
