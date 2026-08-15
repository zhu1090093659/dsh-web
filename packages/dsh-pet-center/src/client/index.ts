/**
 * In-GUI pet center, browser half: registers the Pet Center card into the
 * Web UI plugin group (`web-ui.plugin.item`, declared by the web-ui-settings
 * group card under 插件配置). The card lists the two pet companions, tries
 * one on live and applies it through the host /api/pet-center API. The plugin
 * writes only DOM — no services, no events, no model access.
 */
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { PetCenter, type PetCenterComponentProps } from './PetCenter.tsx'
import { en, zh, type PetCenterKey } from './locales.ts'

export type { PetCenterComponentProps } from './PetCenter.tsx'

/** Locale namespace owned by this plugin. */
export const NS = 'petCenter'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The pet-center card's copy. */
    petCenter: PetCenterKey
  }

  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the group card supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
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


/** Required services: slots + locale (plugin card). */
export const inject = ['slots', 'locale']

/**
 * Register the pet-center dictionaries and the Pet Center plugin card inside
 * the Web UI plugin group.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pet-center: dictionaries')

  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'pet-center',
    order: 125,
    locale: NS,
    inject: () => ({} as PetCenterComponentProps & {}),
  }, PetCenter))
}
