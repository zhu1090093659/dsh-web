/**
 * Browser-half entry for the dsh-beyond-workscope plugin — runs inside the
 * dsh web GUI.
 *
 * Mounts the grant confirmation card + grant manager as a floating panel on
 * `document.body` (plain DOM + one React root, like the sibling plugins'
 * DOM-level extension pattern). Failure policy: mounting problems are logged,
 * never thrown — the web shell fails the whole boot when a plugin apply
 * throws, and an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { mountPanel } from './mount.tsx'
import { en, zh, type BeyondKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'beyond-workscope'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** beyond-workscope card copy. */
    'beyond-workscope': BeyondKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { GrantCard } from './GrantCard.tsx'
export type { BeyondKey } from './locales.ts'

/**
 * Mount the beyond-workscope card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-beyond-workscope: dictionaries')
  } catch (error) {
    console.warn('[dsh-beyond-workscope] locale registration failed:', error)
  }

  let disposer: (() => void) | undefined
  try {
    disposer = mountPanel()
  } catch (error) {
    // DOM failures degrade the card, never the GUI.
    console.warn('[dsh-beyond-workscope] mount failed:', error)
  }
  ctx.effect(() => () => {
    disposer?.()
  }, 'dsh-beyond-workscope: card mount')
}
