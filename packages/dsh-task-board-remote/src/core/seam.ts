/**
 * The two cordis seats this plugin resolves, and the shapes they meet on.
 *
 * Neither face is imported from the package that publishes it: this plugin takes
 * no dependency on the bridge or on the task board, so a deployment that mounts
 * either at a different version — or not at all — still loads, and this package
 * never has to recompile against their internals. Every member is checked before
 * it is called, and a seat that answers none of them reads as absent.
 * @module dsh-task-board-remote/core/seam
 */

/** Cordis service the bridge publishes its extension seam under. */
export const REMOTE_BRIDGE_SERVICE = 'remoteBridge'

/** Cordis service the task board host publishes its capability face under. */
export const BOARD_SERVICE = 'taskBoard'

/** The narrow context seat both faces are resolved through; a cordis context is one. */
export interface ServiceSeat {
  get(name: string): unknown
}

/** One board snapshot, exactly as the host builds it: `revision` plus opaque fields. */
export interface BoardSnapshotFace {
  readonly revision: number
  readonly [key: string]: unknown
}

/**
 * The task board host's capability face.
 *
 * Narrow on purpose: the host service carries much more (the ledger, the runner,
 * the power inhibitor), and this plugin needs the four members a remote client
 * is served from — nothing here can read or write the ledger any other way.
 */
export interface BoardFace {
  /** The whole ledger as the host builds it; forwarded verbatim. */
  snapshot(): BoardSnapshotFace
  /** Apply one action through the host's own gates; the host refuses by throwing. */
  apply(requestId: string, action: Readonly<Record<string, unknown>>, initiator?: string): unknown
  /** Subscribe to the host's change notifications; returns the unsubscriber. */
  subscribe(listener: () => void): () => void
  /** The host model catalog the board's model and reasoning-level choices come from. */
  modelCatalogOptions(): Promise<unknown>
}

/** What one board method answers: the payload, or a refusal in this plugin's codes. */
export type BoardMethodResult =
  | { readonly ok: true; readonly r?: unknown }
  | { readonly ok: false; readonly code: string; readonly msg: string }

/** One row of a set the bridge can diff: keyed by `id`, compared by its body. */
export interface DeltaRowFace {
  readonly id: string
}

/** One answer of a bridge delta window, as this plugin consumes it (§15). */
export type DeltaAnswerFace<T> =
  | { readonly mode: 'reset'; readonly token: string; readonly rows: readonly T[] }
  | { readonly mode: 'delta'; readonly token: string; readonly changed: readonly T[]; readonly removed: readonly string[] }

/**
 * The bridge's per-connection delta window, structurally.
 *
 * The rule set behind it — base, token, cap, "smaller than a reset" — is the
 * bridge's and lives there once; this plugin only hands it the board's own rows
 * and wraps the answer in the board's wire shape.
 */
export interface DeltaWindowFace<T> {
  answer(rows: readonly T[], since: string | undefined): DeltaAnswerFace<T>
}

/** Where a connection's delta windows are read from. */
export interface DeltaSeatFace {
  window<T extends DeltaRowFace>(key: string, limits: { readonly maxRows: number }): DeltaWindowFace<T>
  /**
   * Forget one window and the set it retained.
   *
   * Optional because it is newer than `window`: a bridge that answers the first
   * one but not this one still serves the board, it just cannot be told to drop
   * a base early.
   */
  drop?(key: string): void
}

/** Who is calling one board method. */
export interface BoardCall {
  /** Stable id of the calling connection: the scope of `board.apply`'s idempotency. */
  readonly connectionId: string
  /**
   * @param capability - a capability the calling connection may have declared.
   * @returns whether it did. Absent on a bridge that predates the seat, which is
   * read as "declared nothing" and answers today's body.
   */
  readonly declares?: (capability: string) => boolean
  /** This connection's delta windows. Absent on a bridge that predates §15. */
  readonly deltas?: DeltaSeatFace
}

/** One board method. */
export type BoardMethodHandler = (
  payload: Readonly<Record<string, unknown>>,
  call: BoardCall,
) => BoardMethodResult | Promise<BoardMethodResult>

/** The bridge seam, exactly as it is published on {@link REMOTE_BRIDGE_SERVICE}. */
export interface RemoteBridgeSeat {
  registerMethods(table: {
    readonly capability?: string
    readonly methods: Readonly<Record<string, BoardMethodHandler>>
  }): () => void
  broadcast(topic: string, payload: unknown, capability?: string): number
}

/** Resolve one service without letting a throwing lookup decide the outcome. */
function serviceOf(seat: ServiceSeat, name: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = seat.get(name)
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * @param seat - the context to resolve the board through.
 * @returns the host face, or undefined when the board is not mounted or does not
 * answer all four members this plugin serves clients from.
 */
export function boardFaceOf(seat: ServiceSeat): BoardFace | undefined {
  const face = serviceOf(seat, BOARD_SERVICE)
  if (face === undefined) return undefined
  if (typeof face.snapshot !== 'function'
    || typeof face.apply !== 'function'
    || typeof face.subscribe !== 'function'
    || typeof face.modelCatalogOptions !== 'function') return undefined
  return face as unknown as BoardFace
}

/**
 * @param seat - the context to resolve the bridge through.
 * @returns the bridge seat, or undefined when the bridge is not mounted or does
 * not answer both members the seam is used through.
 */
export function remoteBridgeSeatOf(seat: ServiceSeat): RemoteBridgeSeat | undefined {
  const face = serviceOf(seat, REMOTE_BRIDGE_SERVICE)
  if (face === undefined) return undefined
  if (typeof face.registerMethods !== 'function' || typeof face.broadcast !== 'function') return undefined
  return face as unknown as RemoteBridgeSeat
}

/**
 * Read the host's current revision through a full snapshot.
 *
 * The board publishes no revision-only read, so this costs the one clone the
 * snapshot path makes. It runs at most once per coalesced change wave, and never
 * for a client that declared no capability, because nothing was subscribed.
 * @param face - the host face.
 * @returns the revision, or undefined when the host cannot be read right now.
 */
export function revisionOf(face: BoardFace): number | undefined {
  try {
    const snapshot = face.snapshot()
    return typeof snapshot?.revision === 'number' ? snapshot.revision : undefined
  } catch {
    return undefined
  }
}
