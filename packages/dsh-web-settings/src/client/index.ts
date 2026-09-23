/**
 * Web UI plugin group, browser half. Registers the `web-ui-plugins`
 * dictionaries and one first-level settings section that renders the family
 * plugin cards (task-board, remote-web-ui, describe-image)
 * directly under a static heading. The section declares the
 * `web-ui.plugin.item` child slot; the dsh-web family plugins register
 * their per-plugin cards there. Skin Center, Community Plugins and Desktop
 * Pet are sibling plugins that register their own first-level sections.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer-owned ctx.slots Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WebUiSettingsBinder } from './compat-settings-scope.ts'
import { WebUIPluginsSection } from './WebUIPluginsCard.tsx'
import { en, zh, type WebUIPluginsKey } from './locales.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

export type { WebUIPluginsSectionProps } from './WebUIPluginsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Web UI plugin group card copy. */
    'web-ui-plugins': WebUIPluginsKey
  }

  interface SlotMap {
    /**
     * The child slot one family plugin card registers into, declared by the
     * group section. A list seat keyed by entry id, so the family plugins can
     * reuse their existing card implementations.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the group card supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'configForms', 'remote']

/**
 * Register the Web UI plugin group as a first-level settings section: its own
 * nav item hosts the family plugin cards in the section body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-web-ui-settings' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register('web-ui-plugins', { zh, en })
    } catch {
      return () => {}
    }
  }, 'web-ui-settings: dictionaries')

  // The family settings binder: family plugins read ctx.get('webUiSettings')
  // for their card's settings form; it resolves their profile entry id through
  // the host bridge and binds the native ctx.configForms form.
  new WebUiSettingsBinder(ctx)

  ctx.slots.inject('settings.section', () => {
    try {
      return ctx.slots.register({
        name: 'settings.section',
        id: 'web-ui-plugins',
        order: 110,
        label: () => ctx.locale.bind('web-ui-plugins')('title'),
        locale: 'web-ui-plugins',
        children: { 'web-ui.plugin.item': { kind: 'list', scope: 'root' } },
      }, WebUIPluginsSection)
    } catch {
      return () => {}
    }
  })
}
