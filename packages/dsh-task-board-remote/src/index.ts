/**
 * `@linxin666/dsh-task-board-remote` — the host task board on the remote surface.
 *
 * The row adds no surface of its own: it binds the task board host's capability
 * face to the bridge's generic extension seam, so a paired phone drives the same
 * ledger the browser does, through the same host gates.
 *
 * - `board.snapshot` forwards the host snapshot verbatim, and `board.options` the
 *   host model catalog plus the board's live meta; neither is interpreted here.
 * - `board.apply` forwards one action to the host's own `apply`, keyed by the
 *   client's `requestId` per connection. A refusal is the host's: it crosses as
 *   `board-refused` with the host's own text.
 * - `board.changed` is published to the paired clients that declared `board.v1`,
 *   one frame per wave of host notifications and carrying the revision alone.
 *
 * Nothing is required to be mounted: the plugin declares no injected service,
 * resolves both seats structurally, and activates only what it can reach — a
 * host without the bridge, or without the board, keeps starting normally and
 * loses exactly this surface. That is why there is no `inject` export here.
 * @module @linxin666/dsh-task-board-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { BoardChangeFeed } from './core/changes.ts'
import { createBoardMethods } from './core/methods.ts'
import { BOARD_SERVICE, boardFaceOf, remoteBridgeSeatOf, revisionOf, REMOTE_BRIDGE_SERVICE } from './core/seam.ts'
import { CAP_BOARD, TOPIC_BOARD_CHANGED } from './protocol.ts'

/** Loader row identity of this plugin. */
export const name = 'dsh-task-board-remote'

/**
 * Mount the board surface.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  const log = (message: string): void => { console.log(`[task-board-remote] ${message}`) }
  // Read per call rather than captured: the board may be mounted after this row,
  // replaced, or never mounted at all, and each call has to see the face that
  // stands now. A missing board is `board-unavailable`, not a failed mount.
  const board = () => boardFaceOf(ctx)
  const methods = createBoardMethods({ board })

  // The method table lives as long as the bridge serves its seam. Cordis runs
  // this once `remoteBridge` is available — whether that is already true when
  // this row activates or becomes true later — and disposes the scope, which
  // withdraws the methods, when the seam is withdrawn or replaced.
  ctx.inject([REMOTE_BRIDGE_SERVICE], (scope: Context) => {
    scope.effect(() => {
      const seat = remoteBridgeSeatOf(scope)
      if (seat === undefined) return () => {}
      const dispose = seat.registerMethods({ capability: CAP_BOARD, methods })
      log('board.v1 is served on the remote bridge')
      return dispose
    }, 'task-board-remote: board.v1 methods')
  })

  // Changes are published only while both ends are live: a subscription with no
  // bridge to publish through would be work nobody reads.
  ctx.inject([REMOTE_BRIDGE_SERVICE, BOARD_SERVICE], (scope: Context) => {
    scope.effect(() => {
      const seat = remoteBridgeSeatOf(scope)
      const face = boardFaceOf(scope)
      if (seat === undefined || face === undefined) return () => {}
      const feed = new BoardChangeFeed({
        revision: () => revisionOf(face),
        publish: (revision) => { seat.broadcast(TOPIC_BOARD_CHANGED, { revision }, CAP_BOARD) },
      })
      const unsubscribe = face.subscribe(() => { feed.queue() })
      return () => {
        unsubscribe()
        feed.dispose()
      }
    }, 'task-board-remote: board.changed feed')
  })
}
