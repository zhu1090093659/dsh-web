/**
 * dsh-round-jump browser half — right-edge hover popup listing every user
 * round in the current conversation, with one-click jump and a load-all
 * history action.
 *
 * Data comes from the official conversation snapshot: the framework's
 * `useSession` selector (injected into session-scoped slot components) reads
 * `ConversationSnapshot.chat`. User rounds are the Chat nodes whose `kind`
 * is `'user'`, walked in `chat.order` sequence. Each node's stable `key` is
 * the same value the shipped ChatNodeSeat stamps onto `data-chat-anchor-key`,
 * so a jump is
 * `document.querySelector('[data-chat-anchor-key="…"]').scrollIntoView()`.
 * Older history loads through the framework `ctx.conversation.loadOlder()`
 * (one 50-message page per call); the load-all action loops it until
 * `hasMore` clears.
 *
 * The entry registers into the session-scoped `conversation.composer.dock`
 * list slot; the surface then portals the floating popup onto document.body
 * — the hot zone and popup are viewport-global, not composer-bound.
 * @module @linxin666/dsh-round-jump/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { RoundJumpSurface, type RoundJumpInjected } from './RoundJumpSurface.tsx'

export { RoundJumpSurface, roundsOf } from './RoundJumpSurface.tsx'
export type { RoundEntry, RoundJumpInjected, RoundJumpProps } from './RoundJumpSurface.tsx'

/**
 * Register the round-jump dock entry. The apply body binds the scoped
 * `loadOlder` verb from the official conversation service; the framework
 * injects the `useSession` snapshot hook through the slot runtime.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'round-jump',
    order: 500,
    inject: (): RoundJumpInjected => ({
      loadOlder: () => ctx.conversation.loadOlder(),
    }),
  }, RoundJumpSurface))
}
