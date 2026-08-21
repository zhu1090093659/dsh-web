/**
 * Semantic attribute values for the session-id plugin (contract:
 * skins/skin-center/contracts/semantic-attrs-v1.md). Root containers carry
 * `data-dsh-plugin`; parts carry bare `data-dsh-part` values owned by the
 * plugin attribute.
 */

/** Plugin short name stamped on the root container and the footer trigger. */
export const SESSION_ID_PLUGIN_ATTR = 'session-id'

/** The sidebar footer seat trigger. */
export const SESSION_ID_PART_ENTRY = 'entry'

/** The modal panel root. */
export const SESSION_ID_PART_PANEL = 'panel'

/** One session list row. */
export const SESSION_ID_PART_ROW = 'row'

/** The per-row copy button. */
export const SESSION_ID_PART_COPY = 'copy'

/** The panel search input. */
export const SESSION_ID_PART_SEARCH = 'search'