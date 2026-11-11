/**
 * The board surface this plugin adds to protocol v1: one capability, three
 * methods, one topic and the refusal codes it raises.
 *
 * These names belong to this plugin, not to the bridge. The bridge dispatches
 * and fans out what it is handed and holds no board vocabulary
 * (`packages/dsh-remote-bridge/src/core/extension.ts`); the payloads are the
 * task board host's own shapes, forwarded verbatim, so a card that gains a
 * field needs no change in this file.
 * @module dsh-task-board-remote/protocol
 */

/** Capability a client declares in `hello`'s `cap` array to be offered the board surface. */
export const CAP_BOARD = 'board.v1'

/** The whole ledger, forwarded verbatim. */
export const METHOD_BOARD_SNAPSHOT = 'board.snapshot'
/** The host model catalog, plus the board's live meta. */
export const METHOD_BOARD_OPTIONS = 'board.options'
/** One board action, applied by the host under an idempotency key. */
export const METHOD_BOARD_APPLY = 'board.apply'

/** The one topic the board surface publishes. */
export const TOPIC_BOARD_CHANGED = 'board.changed'

/**
 * The bridge's own capability (`delta.v1`, protocol v1 §15), spelled here
 * rather than imported: this plugin takes no dependency on the bridge, and the
 * contract between them is the string a client puts in `hello`'s `cap` array.
 *
 * When the calling connection declared it, `board.snapshot` answers the whole
 * board or the increment since a token; when it did not, the answer is the whole
 * board plus the two ignorable keys, exactly as before §15.
 */
export const CAP_DELTA = 'delta.v1'

/**
 * Largest board one connection's delta window retains. Past this the bridge's
 * window retains nothing and answers a reset, so one phone can never pin an
 * unbounded copy of the ledger.
 */
export const BOARD_DELTA_MAX_ROWS = 2000

/** The window name this plugin's one set is keyed under within a connection. */
export const BOARD_DELTA_KEY = 'board.snapshot'

/** The board cannot be read right now: absent, failed, or too large to carry. */
export const CODE_BOARD_UNAVAILABLE = 'board-unavailable'
/** The host refused the action; `msg` is the host's own text. */
export const CODE_BOARD_REFUSED = 'board-refused'
/** The request envelope is malformed; nothing reached the host. */
export const CODE_INVALID_ARGS = 'invalid-args'

/**
 * Protocol v1's frame cap, in UTF-8 bytes of the serialized response
 * (`docs/protocol-v1.md` §1). A response that needs more cannot cross the
 * bridge, so the snapshot it carries is refused as unavailable instead of being
 * written and dropped (§12.3, §12.6).
 */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/**
 * Bytes of that cap reserved for the response envelope
 * (`{"t":"res","id":NNN,"ok":true,"r":}`) and the keys around the body. Far
 * larger than the envelope needs, and small enough to be free.
 */
export const FRAME_ENVELOPE_BYTES = 128

/**
 * How many applied requestIds this process replays from memory.
 *
 * The key is scoped to one connection and a client must mint a new one for every
 * action (§12.3), so this only bounds a client that never reconnects: once a key
 * is evicted, replaying it would apply the action again. The cap keeps one
 * long-lived phone from growing the table without bound.
 */
export const REPLAY_LIMIT = 128
