/**
 * Shared facts between the host and browser halves of the shutdown plugin.
 * The path must stay in one place: the host registers it as an exact route,
 * the browser half POSTs to it.
 */

/** The loopback-only exact route the host registers for the shutdown request. */
export const SHUTDOWN_PATH = '/api/dsh-shutdown'
