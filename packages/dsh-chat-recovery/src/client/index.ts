/**
 * Browser-half entry for the dsh-chat-recovery plugin.
 *
 * Mounts two conversation surfaces:
 * - a turn-tail entry (conversation.chat.turnTail) with the Edit affordance
 *   for the last completed user message and the manual Retry affordance for
 *   failed turns;
 * - a composer dock entry (conversation.input.dock) showing the retry
 *   supervisor's attempt count, wait state, cancel / retry-now controls and
 *   the final failure reason.
 *
 * Failure policy: nothing here throws at apply time - an external plugin
 * must never take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.* slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { claimChatRecoveryApply, releaseChatRecoveryApply } from './apply-guard.ts'
import { createRetryPorts, createSubmitEdit } from './wiring.ts'
import { RetrySupervisor } from '../core/retry-supervisor.ts'
import { TurnActionsView } from './TurnActionsView.tsx'
import { RetryDockView } from './RetryDock.tsx'
import { en, zh, type ChatRecoveryKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'chat-recovery'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** chat-recovery surface copy. */
    'chat-recovery': ChatRecoveryKey
  }
}

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * Register the chat-recovery surface and start the retry supervisor.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // A duplicated client injection (module factory executed twice in one page
  // lifetime) would otherwise mount a second set of rows.
  if (!claimChatRecoveryApply()) return
  ctx.effect(() => releaseChatRecoveryApply, 'chat-recovery: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-recovery: dictionaries')

  const sessions = ctx.sessions
  const workspaces = ctx.workspaces
  const supervisor = new RetrySupervisor(createRetryPorts(sessions, workspaces))
  const submitEdit = createSubmitEdit(sessions, workspaces)
  const manualRetry = (sessionId: Parameters<RetrySupervisor['manualRetry']>[0]): void => {
    supervisor.manualRetry(sessionId)
  }

  // Watch the current session and feed the supervisor on every change. The
  // supervisor only acts on the CURRENT session: a retry fork opens the child,
  // which becomes current and is then watched to settle the attempt.
  let watchedId: string | undefined
  let unsubscribeSession: (() => void) | undefined
  const rewire = (): void => {
    const current = sessions.list.getSnapshot().current
    if (current !== watchedId) {
      watchedId = current
      unsubscribeSession?.()
      unsubscribeSession = undefined
      if (current !== undefined) {
        const binding = sessions.binding(current)
        if (binding !== undefined) {
          unsubscribeSession = binding.session.subscribe(() => supervisor.review())
        }
      }
    }
    supervisor.review()
  }
  ctx.effect(() => sessions.list.subscribe(rewire), 'chat-recovery: watch sessions')
  rewire()
  ctx.effect(() => () => supervisor.dispose(), 'chat-recovery: dispose supervisor')

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // The chain owner share carries only turn/seq/openFile - a pure selector
    // cannot see the snapshot, so this entry matches every completed turn and
    // the component gates on the snapshot itself.
    select: (owner) => owner,
    locale: NS,
    inject: () => ({ supervisor, submitEdit, manualRetry }),
  }, TurnActionsView))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'chat-recovery',
    order: 500,
    locale: NS,
    inject: () => ({ supervisor, manualRetry }),
  }, RetryDockView))
}
