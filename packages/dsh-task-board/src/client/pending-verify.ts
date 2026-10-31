/**
 * Bounded verification of the one board state the mirror knows is transient.
 *
 * A pushed frame is how the panel normally learns that the Host moved, and the
 * browser cannot verify that frames still arrive: an SSE connection that stops
 * delivering without closing leaves `EventSource` open and silent, so no error
 * fires and no frame comes. While the mirror still shows an execution the Host
 * has not settled, that silence looks exactly like a run still in progress —
 * the row a reader is looking at keeps saying "running" long after the Host
 * wrote the session id and settled it.
 *
 * So the mirror verifies exactly that state and nothing else: one state read per
 * {@link PENDING_VERIFICATION_MS} while at least one execution is still open,
 * disarmed by the snapshot itself as soon as the last one settles. A board with
 * nothing in flight reads nothing (the package rule: an idle board does not
 * poll), and a hidden page defers its reads until it is looked at again.
 *
 * @module dsh-task-board/client/pending-verify
 */

/**
 * Verification cadence while an execution is open. It matches the interval the
 * transport already uses to recover from a stream error, so a missed frame and
 * a broken stream converge within the same bound.
 */
export const PENDING_VERIFICATION_MS = 15_000

/** What the loop needs from the mirror and from the Host transport. */
export interface PendingVerificationFace {
  /** Whether the mirror still shows an execution the Host has not settled. */
  pending(): boolean
  /** Re-read the authoritative Host snapshot. */
  refresh(): void
  /** Follow mirror changes; the loop is armed and disarmed by them. */
  subscribe(listener: () => void): () => void
  /** Whether a read is useful right now; defaults to the page being visible. */
  visible?(): boolean
  /** Timer arming; defaults to the page's own interval. */
  schedule?(run: () => void): unknown
  /** Timer release, paired with {@link PendingVerificationFace.schedule}. */
  cancel?(handle: unknown): void
}

/**
 * Watch the mirror and re-read the Host snapshot while it shows work in flight.
 * @param face - the mirror, the read, and the seams the loop runs on.
 * @param intervalMs - verification cadence in milliseconds.
 * @returns the disposer that releases the timer and the subscription.
 */
export function startPendingVerification(
  face: PendingVerificationFace,
  intervalMs: number = PENDING_VERIFICATION_MS,
): () => void {
  const schedule = face.schedule ?? ((run: () => void): unknown => globalThis.setInterval(run, intervalMs))
  const cancel = face.cancel ?? ((handle: unknown): void => {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
  })
  const visible = face.visible ?? pageVisible
  let handle: unknown
  const stop = (): void => {
    if (handle === undefined) return
    const current = handle
    handle = undefined
    cancel(current)
  }
  const tick = (): void => {
    if (!face.pending()) {
      stop()
      return
    }
    if (!visible()) return
    face.refresh()
  }
  const arm = (): void => {
    if (handle !== undefined || !face.pending()) return
    handle = schedule(tick)
  }
  const unsubscribe = face.subscribe(arm)
  arm()
  return () => {
    unsubscribe()
    stop()
  }
}

/** Whether the page is being looked at; a composition without a document counts as visible. */
function pageVisible(): boolean {
  const state = (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState
  return state === undefined || state === 'visible'
}
