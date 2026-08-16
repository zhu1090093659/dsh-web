/**
 * Community plugin manager, browser half. Registers the community-plugins
 * dictionaries and one section into the settings panel's first-level nav
 * (settings.section; the promoted family sections sit beside the built-in
 * general / models / plugins / agent-presets entries). The card carries its
 * own enable switch (backed by the community-plugins settings namespace) and
 * loads the live Store catalog with Host-mediated lifecycle controls.
 * @module @linxin666/dsh-client-ui-community-plugins/client
 */

import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the slot-surface types (the settings.section seat).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CommunityPluginsCardController, CommunityPluginsSection, type CommunityPluginsSettings } from './CommunityPluginsCard.tsx'
import { CatalogStore } from './catalog-store.ts'
import { en, zh, type CommunityPluginKey } from './locales.ts'

export type { CommunityPluginsCardProps, CommunityPluginsSectionProps } from './CommunityPluginsCard.tsx'

/** Settings namespace the card's enable switch edits (the Host plugin registers it). */
const COMMUNITY_PLUGINS_NS = 'community-plugins'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Community plugin manager copy. */
    'community-plugins': CommunityPluginKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

interface SettingsBinder {
  bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S>
}

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Mount one settings section. Callers must dispose the current mount before
 * switching binders because the first-level settings slot does not deduplicate
 * registrations that share an id.
 */
function mountSection(ctx: ClientContext, binder: SettingsBinder, catalogStore: CatalogStore, priority: number): () => void {
  const settingsScope = binder.bind<CommunityPluginsSettings>({ namespace: COMMUNITY_PLUGINS_NS })
  const controller = new CommunityPluginsCardController(settingsScope)
  const disposeSlot = ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'community-plugins',
    order: 140,
    priority,
    label: () => ctx.locale.bind('community-plugins')('settings.title'),
    locale: 'community-plugins',
    inject: () => ({ ...controller.inject(), catalogStore }),
  }, CommunityPluginsSection))
  return () => {
    disposeSlot()
    controller.dispose()
  }
}

/**
 * Register the community plugin manager as a first-level settings section, with
 * its own enable switch over the community-plugins settings namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('community-plugins', { zh, en }), 'community-plugins: dictionaries')

  const catalogStore = new CatalogStore()
  let disposed = false
  let disposeSection = mountSection(ctx, ctx.settingsScope, catalogStore, 10)

  ctx.effect(
    () => () => {
      disposed = true
      disposeSection()
    },
    'community-plugins: settings section lifecycle',
  )

  // Standalone installs keep the official scope as a fallback. When the rc.6
  // compatibility binder arrives later, replace that mount instead of keeping
  // two registrations with the same id in the first-level navigation.
  ctx.inject(['webUiSettings'], (settingsCtx: ClientContext) => {
    const binder = settingsCtx.get('webUiSettings')
    if (binder === undefined || disposed) return

    disposeSection()
    disposeSection = mountSection(settingsCtx, binder, catalogStore, 0)
    let active = true

    return () => {
      if (!active) return
      active = false
      if (disposed) return
      disposeSection()
      disposeSection = mountSection(ctx, ctx.settingsScope, catalogStore, 10)
    }
  })
}
