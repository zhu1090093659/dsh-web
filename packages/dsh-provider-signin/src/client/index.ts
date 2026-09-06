/**
 * dsh-provider-signin browser half — seats the sign-in area into every
 * llm-pi-ai provider card on the Models settings page. The seat talks to the
 * host relay over same-origin /api/provider-signin/* routes; nothing renders
 * for providers whose flow offers no OAuth method.
 * @module @linxin666/dsh-provider-signin/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotMap/LocaleNamespaceMap merge points.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSigninApi, type SigninApi } from './api.ts'
import { ProviderAuthCard, type ProviderAuthFace, type ProviderAuthOwnerProps } from './ProviderAuthCard.tsx'
import { NS, dictionaries, type SigninKey } from './locales.ts'

/** Services required by the browser half. */
export const inject = ['slots', 'locale']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Provider sign-in card copy. */
    'provider-signin': SigninKey
  }

  interface SlotMap {
    /**
     * The Models page provider-card seat, declared here so this package can
     * register into it standalone. The authoritative declaration (owner
     * props, key domain) lives in the ui-settings-models slot contract; the
     * owner dispatches this slot with `entryKey = settingsNs`, so the key
     * this package registers under is the adapter family namespace.
     */
    'settings.models.provider-card': {
      kind: 'keyed'
      scope: 'root'
      owner: ProviderAuthOwnerProps
    }
  }
}

/** Apply the browser half; every step is guarded so a missing service degrades to no card. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, dictionaries)
    } catch {
      return () => {}
    }
  }, 'provider-signin: dictionaries')

  let api: SigninApi | undefined
  try {
    api = createSigninApi()
  } catch {
    api = undefined
  }

  ctx.slots.inject('settings.models.provider-card', () => {
    if (api === undefined) return () => {}
    try {
      const t = ctx.locale.bind(NS) as (key: SigninKey) => string
      const face: ProviderAuthFace = { api, t }
      const dispose = ctx.slots.register({
        name: 'settings.models.provider-card',
        // The adapter family namespace every llm-pi-ai row dispatches with.
        key: 'llm-pi-ai',
        locale: NS,
        inject: () => face,
      }, ProviderAuthCard)
      return dispose
    } catch {
      return () => {}
    }
  })
}
