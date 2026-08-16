import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the definitions that
// name the 'settings.*' holes) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopLauncherSettingsCard, DesktopLauncherSettingsCardController, type DesktopLauncherSettings } from './DesktopLauncherSettingsCard.tsx'
import { en, zh, type DesktopLauncherKey } from './locales.ts'

export { DesktopLauncherSettingsCard, DesktopLauncherSettingsCardController } from './DesktopLauncherSettingsCard.tsx'
export type { DesktopLauncherSettings, DesktopLauncherSettingsCardFace, DesktopLauncherSettingsCardState } from './DesktopLauncherSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** desktop-launcher settings-card copy. */
    'desktop-launcher': DesktopLauncherKey
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

/** Owner share of a plugin card (the section supplies nothing). */
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


/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-launcher'

/** Settings namespace the desktop-launcher card edits (the Host plugin registers it). */
const DESKTOP_LAUNCHER_NS = 'desktop-launcher'

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the desktop-launcher surface: the plugin settings card over the
 * `desktop-launcher` namespace, contributed to the plugin-configuration
 * group.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-launcher: dictionaries')

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const controller = new DesktopLauncherSettingsCardController(
    binder.bind<DesktopLauncherSettings>({ namespace: DESKTOP_LAUNCHER_NS }),
  )
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'desktop-launcher',
    order: 130,
    locale: NS,
    inject: () => controller.inject(),
  }, DesktopLauncherSettingsCard))
}
