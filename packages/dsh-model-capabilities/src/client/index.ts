/**
 * Browser-half entry for the dsh-model-capabilities plugin — runs inside the dsh web GUI.
 *
 * Seats two Models-page extension areas for the `llm-pi-ai` adapter family:
 * the `settings.models.provider-card` capability editor (reasoning efforts +
 * provider disable/enable) on every custom-provider card,
 * and the `settings.models.footer` archive listing where disabled providers
 * come back. Both read and write the official `llm-pi-ai` settings entry plus
 * this plugin's own entry (its Config, resolved from the describe answer
 * because the settings wire addresses profile entry ids) over the standard
 * remote settings wire.
 * @module @linxin666/dsh-client-ui-model-capabilities/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Models-page SlotMap declarations
// ('settings.models.provider-card' / 'settings.models.footer'), our own
// LocaleNamespaceMap merge, and the owner-props types the panel reads.
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { CapabilitiesPanel } from './CapabilitiesPanel.tsx'
import { DisabledProvidersFooter } from './DisabledProvidersFooter.tsx'
import { coalesceDescribe, type RefreshBus } from './settings-face.ts'
import { CAPS_ENTRY_IDS } from '../core/provider-toggle.ts'
import { PI_AI_SETTINGS_NAMESPACE } from '../core/capabilities.ts'
import { NS, zh, en } from './locales.ts'

/**
 * Required services: slot registry, dictionary registry, the remote wire, and
 * the traced settings namespace — accessing `remote.settings` without
 * declaring the dotted path fails at runtime.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Client plugin body: register dictionaries, wire the refresh bus, and seat
 * both Models-page extension areas for the pi-ai family.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-model-capabilities: dictionaries')

  // Concurrent readers (every provider-card panel plus the footer area) share
  // one describe per refresh instead of one full-document read each.
  const settings = coalesceDescribe((ctx.get('remote') as unknown as ClientRemote).settings)

  // Refresh bus: our own toggles notify directly; the host's committed-change
  // event covers every other surface (official cards, other tabs) the same way
  // the official model picker refreshes its catalog.
  const listeners = new Set<() => void>()
  const refresh: RefreshBus = {
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
  ctx.effect(() => {
    try {
      // Only the two entries this plugin renders from: a write anywhere else
      // in the settings document cannot change what a panel shows. The
      // archive is this plugin's own entry, under whichever row id this
      // deployment mounted it.
      return ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === PI_AI_SETTINGS_NAMESPACE || CAPS_ENTRY_IDS.includes(ns)) refresh.notify()
      })
    } catch {
      return () => {}
    }
  }, 'dsh-model-capabilities: document events')

  ctx.slots.inject('settings.models.provider-card', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.models.provider-card',
        key: 'llm-pi-ai',
        inject: () => ({ settings, refresh }),
      }, CapabilitiesPanel)
      return () => {
        unregister()
      }
    } catch {
      // The seat is declared by the official Models section; a host without
      // it (older deployment) offers no slot to fill, so register nothing.
      return () => {}
    }
  })

  ctx.slots.inject('settings.models.footer', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.models.footer',
        id: 'ui-model-capabilities',
        inject: () => ({ settings, refresh }),
      }, DisabledProvidersFooter)
      return () => {
        unregister()
      }
    } catch {
      // Same posture as the provider-card seat: no declaration, no entry.
      return () => {}
    }
  })
}
