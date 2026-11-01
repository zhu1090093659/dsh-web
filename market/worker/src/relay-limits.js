/**
 * Every limit the relay enforces, stated once.
 *
 * The two relay halves used to declare their numbers separately: the Worker's
 * door and proxy (`relay.js`) held the registry's rate limits, and the Durable
 * Object (`relay-bridge.js`) held the bridge door's budgets, the per-stream
 * flow-control window and the two timeouts it races. Splitting them is how a
 * window and its retention drift apart without any test noticing, so the
 * numbers live here and both halves import them. Values are frozen by
 * `scripts/market-relay-limits.test.mjs`: changing one is an edit to this file
 * and to that spec together, never a quiet retune on the way past.
 */

/**
 * The claim and the registration share both buckets: a healthy client refreshes
 * its lease once per tunnel start, not on a heartbeat, so the budget is sized
 * for a five-minute cadence plus the churn a quick-tunnel restart or a port
 * settle adds (three per id). The per-IP bucket is counted on the /24 the caller
 * sits on rather than the exact address -- a rotating IPv6 /128 or a CGNAT
 * address would otherwise mint a fresh row per request and never reach its own
 * limit -- and it is deliberately generous, because the account budget gate
 * (relay-control.js) is what protects the Cloudflare API while this limit
 * protects D1 from one caller's write volume.
 */
export const REGISTER_WINDOW_MS = 5 * 60 * 1000
export const REGISTER_MAX_PER_IP = 60
export const REGISTER_MAX_PER_ID = 3
/**
 * How long one rate-limit row outlives its window. A window that has turned
 * over is no longer read by anything (both endpoints key their buckets by the
 * window they are in), so three windows of history is what keeps the table
 * bounded instead of accumulating every identity that ever called.
 */
export const RATE_LIMIT_RETENTION_MS = 3 * REGISTER_WINDOW_MS
/** Rows not seen for this long are dropped by the cron GC. */
export const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** How long a downstream request waits for the connector's response head. */
export const HEAD_TIMEOUT_MS = 60_000
/** How long a downstream WebSocket waits for the connector to accept it. */
export const WS_OPEN_TIMEOUT_MS = 15_000
/**
 * The bridge door's own rate limit, counted over `REGISTER_WINDOW_MS`. It is
 * deliberately not the registry's per-id budget: this door admits a connection,
 * which a connector re-establishes after a network drop inside its own backoff,
 * while the claim budget is sized for the much slower tunnel-start cadence.
 * Sharing one pair of numbers would make a tightened claim budget silently
 * refuse reconnects.
 */
export const BRIDGE_MAX_PER_ID = 6
export const BRIDGE_MAX_PER_IP = 30
/**
 * The frozen per-stream flow-control window, shared verbatim with the connector:
 * a stream pauses once this many bytes are queued for the phone, and resumes
 * once the phone has read its way back down to LOW.
 */
export const BRIDGE_STREAM_HIGH = 1024 * 1024
export const BRIDGE_STREAM_LOW = 256 * 1024
/**
 * A paused stream that makes no drain progress for this long is harvested: the
 * window is not going to reopen, so waiting longer only holds a phone request
 * and its bytes open for nothing.
 */
export const BRIDGE_STREAM_STALL_MS = 60_000
/**
 * What a paused stream may still queue beyond HIGH.
 *
 * A connector that knows pause stops within one frame of it arriving, so the
 * frames already in flight must still land: dropping those would corrupt a body
 * that is merely slow. A connector too old to know pause never stops, so its
 * overflow past this cap is dropped and counted (see pushPayload) instead of
 * growing this object without bound.
 */
export const BRIDGE_STREAM_PAUSED_CAP = BRIDGE_STREAM_HIGH + BRIDGE_STREAM_LOW
/** The phone socket's two frozen codes, both meaning "reconnect at once": the
 * connector was replaced, and the stream was harvested as stalled. */
export const BRIDGE_CLOSE_REPLACED = 4001
export const BRIDGE_CLOSE_STALLED = 4002
