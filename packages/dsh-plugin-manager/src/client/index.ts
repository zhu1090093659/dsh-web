/**
 * Plugin manager, browser half: shadows the official read-only "All"
 * inventory tab inside the Plugins settings section. The registration uses
 * the official tab's cell (id `all`) at a lower priority, so the slot
 * machinery elects this entry as the winner and the read-only inventory list
 * is replaced by the same list plus per-row enable/disable switches. The tab
 * talks to the host exclusively through the /api/dsh-plugin-manager routes.
 * @module @linxin666/dsh-plugin-manager/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// settings-surface SlotMap merge (the 'settings.plugins.tab' entry).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginManagerApi } from './api.ts'
import { PluginManagerController } from './controller.ts'
import { PluginManagerTab } from './PluginManagerTab.tsx'
import { en, zh, type PluginManagerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plugin manager tab copy. */
    'plugin-manager': PluginManagerKey
  }
}

/** Locale namespace of the browser half. */
export const NS = 'plugin-manager'

/** Required services: slots for the tab seat, locale for copy. */
export const inject = ['slots', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-manager: dictionaries')

  const controller = new PluginManagerController({ api: new PluginManagerApi() })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    // The official inventory tab occupies id 'all' at priority 0; a lower
    // priority wins the cell, so this entry replaces its rendered UI.
    id: 'all',
    order: 10,
    priority: -1,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: () => controller.inject(),
  }, PluginManagerTab))
}
