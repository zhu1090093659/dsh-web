/**
 * Browser half of the preset center: registers the dictionaries and
 * contributes the Presets panel into the child slot the Workshop card
 * declares. Nothing here fetches the catalog — the store card owns that — and
 * every mutation goes through the host's loopback gateway.
 * @module @linxin666/dsh-client-ui-preset-center/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { PresetPanel, type WorkshopPanelKeyProps, type WorkshopPanelOwnerProps } from './PresetPanel.tsx'
import { NS, en, zh, type PresetCenterKey } from './locales.ts'

export type { PresetPanelProps, WorkshopPanelKeyProps, WorkshopPanelOwnerProps, WorkshopPresetRecord } from './PresetPanel.tsx'
export { NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Preset panel copy. */
    'dsh-web-ui-preset-center': PresetCenterKey
  }

  interface SlotMap {
    /**
     * The child slot the Workshop card declares for asset-kind panels; this
     * plugin contributes the `preset` cell. Shape mirrors the store card's
     * declaration (both sides declare it identically, the same way the family
     * plugin cards share `web-ui.plugin.item`).
     */
    'dsh-workshop.panel': {
      kind: 'keyed'
      scope: 'root'
      owner: WorkshopPanelOwnerProps
      keyProps: { preset: WorkshopPanelKeyProps }
    }
  }
}

export const inject = ['slots', 'locale']

/** Register the dictionaries and the Presets panel cell. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-preset-center: dictionaries')

  ctx.slots.inject('dsh-workshop.panel', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'dsh-workshop.panel',
        key: 'preset',
        locale: NS,
      }, PresetPanel)
      return () => { unregister() }
    } catch {
      return () => {}
    }
  })
}
