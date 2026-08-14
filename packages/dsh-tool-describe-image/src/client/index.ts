/**
 * Browser half of the describe-image plugin: the composer image attach
 * button. It mounts in the official `conversation.input.dock` band and is
 * session-routed through the conversation input facade: picking an image
 * uploads it to the host /describe-image/attach route and splices the
 * returned `[image attachment …]` note into the active draft — the way a
 * text-only model gets an image to analyze without the shell's vision
 * pipeline. The settings card itself is rendered by the web GUI's built-in
 * plugin config page from the host-side `describe-image` section.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 * @module @linxin666/dsh-tool-describe-image/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AttachImageButton, type AttachImageInjected } from './AttachImageButton.tsx'
import { insertNoteIntoDraft } from './attach.ts'
import { dictionaries, setLanguage, type DescribeImageClientKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The describe-image attach button copy. */
    'describe-image': DescribeImageClientKey
  }
}

/** Locale namespace of the browser half. */
export const NS = 'describe-image' as const

/** Required services: slots for the dock seat, sessions for session routing, conversation for the input facade. */
export const inject = ['slots', 'conversation', 'sessions']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-tool-describe-image: dictionaries')
  ctx.effect(() => {
    // Mirror the shell language into the module-level dictionary switch.
    const sync = (): void => {
      const lang = document.documentElement.lang
      setLanguage(lang === 'zh' || lang.startsWith('zh-') ? 'zh' : 'en')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, 'dsh-tool-describe-image: language mirror')

  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const sessions = scope.sessions
    const conversation = scope.conversation
    scope.slots.inject('conversation.input.dock', () =>
      scope.slots.register({
        name: 'conversation.input.dock',
        id: 'describe-image-attach',
        order: 95,
        locale: NS,
        inject: (sessionId: SessionId | undefined): AttachImageInjected => ({
          insertNote: (note: string): boolean => {
            if (sessionId === undefined) return false
            const actx = sessions.scope(sessionId)
            if (actx === undefined) return false
            const input = conversation.input
            if (input === undefined) return false
            const shell = input.for(actx)
            const draft = shell.state.getSnapshot().draft
            shell.setDraft(insertNoteIntoDraft(draft, note))
            return true
          },
          notify: (level: 'info' | 'error', text: string): void => {
            if (sessionId === undefined) return
            const actx = sessions.scope(sessionId)
            if (actx === undefined) return
            const input = conversation.input
            if (input === undefined) return
            input.for(actx).notify(level, text)
          },
        }),
      }, AttachImageButton))
  })
}
