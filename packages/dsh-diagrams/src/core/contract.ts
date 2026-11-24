/**
 * The one place the diagram feature's external names live: the host route the
 * browser half loads the vendored runtime from, the official chat fence slot
 * seam, and the DOM fallback hooks the official markdown renderer exposes.
 * Both halves and the tests read these constants, so a host upgrade that
 * renames a hook fails one contract test instead of silently disabling the
 * feature.
 *
 * In the chat transcript, official `ui-chat` (DSH 0.2.3-alpha.2+) dispatches
 * fenced code blocks through the session-scoped `conversation.chat.markdown.fence`
 * hoc slot keyed by lowercased language name (`mermaid`). Surfaces that still
 * render Markdown without passing `renderCode` (such as the document preview
 * pane) fall back to the DOM observer using the hooks below.
 *
 * `md-code-block` is a literal class name in the renderer's JSX. The banner has
 * two known shapes across legacy `_<local>_<hash>` and 0.2.3-alpha.2
 * `<hash>_<local>` CSS Module class patterns: an `_infostring` element carrying
 * the raw fence infostring, and a `_language` span, which shows the language
 * only when the highlighter knows it - an unsupported language (mermaid among
 * them) renders a localized placeholder such as `代码块` or `Code block`
 * instead.
 * @module @linxin666/dsh-client-ui-diagrams/core/contract
 */

/** Host route serving the vendored mermaid runtime (same origin, no CDN). */
export const RUNTIME_ROUTE = '/api/dsh-diagrams/vendor/mermaid.js'

/** Official chat markdown fence hoc slot name (DSH 0.2.3-alpha.2+). */
export const FENCE_SLOT_NAME = 'conversation.chat.markdown.fence'

/** Stable slot occupant id for the mermaid fence layer. */
export const FENCE_LAYER_ID = '@linxin666/dsh-client-ui-diagrams/fence/mermaid'

/** Selector matching blocks already owned by the official chat fence slot. */
export const FENCE_SLOT_SELECTOR = `[data-slot="${FENCE_SLOT_NAME}"]`

/** Class the official markdown renderer puts on every fenced code block. */
export const CODE_BLOCK_CLASS = 'md-code-block'

/** Class-name fragment of the banner element carrying the fence infostring. */
export const INFOSTRING_CLASS_FRAGMENT = '_infostring'

/** Class-name fragment of the banner span carrying the language label. */
export const LANGUAGE_CLASS_FRAGMENT = '_language'

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
