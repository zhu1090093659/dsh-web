/**
 * The one place the diagram feature's external names live: the host route the
 * browser half loads the vendored runtime from, and the DOM hooks the official
 * markdown renderer exposes. Both halves and the tests read these constants, so
 * a host upgrade that renames a hook fails one contract test instead of
 * silently disabling the feature.
 *
 * The DOM hooks are NOT a published contract: the renderer has no code-block
 * extension seam (see the Agent Note), so they are read off its elements.
 * `md-code-block` is a literal class name in the renderer's JSX; the fence
 * language only appears as the banner's infostring text.
 * @module @linxin666/dsh-client-ui-diagrams/core/contract
 */

/** Host route serving the vendored mermaid runtime (same origin, no CDN). */
export const RUNTIME_ROUTE = '/api/dsh-diagrams/vendor/mermaid.js'

/** Class the official markdown renderer puts on every fenced code block. */
export const CODE_BLOCK_CLASS = 'md-code-block'

/** Class-name fragment of the banner element carrying the fence language. */
export const INFOSTRING_CLASS_FRAGMENT = '_infostring_'

/** Fence language this package renders. Everything else is left untouched. */
export const RENDERED_LANGUAGE = 'mermaid'

/** Class the rendered diagram container carries (styled by the theme). */
export const DIAGRAM_CLASS = 'dsh-diagrams-figure'

/** `pending` | `rendering` | `done` — the container's render life cycle. */
export const DATA_STATE = 'data-diagram-state'

/** The verbatim fence source, kept for theme re-renders. */
export const DATA_SOURCE = 'data-diagram-source'

/** Marks the code block this package already claimed (one render per block). */
export const DATA_CLAIMED = 'data-diagram-claimed'

/** Semantic-attribute values from the family contract (`data-dsh-plugin` / `data-dsh-part`). */
export const PLUGIN_NAME = 'diagrams'

/** Semantic part value for the rendered figure. */
export const PART_NAME = 'diagram'
