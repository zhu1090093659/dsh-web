import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the definitions that
// name the 'settings.*' holes) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DesktopLauncherSettingsCard, DesktopLauncherSettingsCardController, type DesktopLauncherSettings } from './DesktopLauncherSettingsCard.tsx'
import { en, zh, type DesktopLauncherKey } from './locales.ts'
import { mountShutdownButton } from './floating-mount.tsx'
import { reportDailyHeartbeat } from './telemetry.ts'

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
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
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
 * group, plus the floating shutdown button.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-desktop-launcher' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'desktop-launcher: dictionaries')

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<DesktopLauncherSettings>({ namespace: DESKTOP_LAUNCHER_NS })
  const read = (): DesktopLauncherSettings | undefined => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready' ? snapshot.value : undefined
  }
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      // Default off: a snapshot without an explicit `enabled` stays off.
      ? snapshot.value?.enabled ?? false
      // Fail-open when the settings surface is unreachable: the shutdown
      // control must stay reachable even if the plugin config cannot be read.
      : snapshot.status === 'unavailable'
  }
  const confirmShutdown = (): boolean => read()?.confirmShutdown ?? true

  // Floating power button: a fixed bottom-right trigger that is independent
  // of the sidebar layout. Toggling the plugin off removes it.
  let disposeFloating: (() => void) | undefined
  const syncFloating = (): void => {
    if (enabled() && disposeFloating === undefined) {
      disposeFloating = mountShutdownButton({
        t: ctx.locale.bind(NS),
        confirmShutdown,
      })
    } else if (!enabled() && disposeFloating !== undefined) {
      disposeFloating()
      disposeFloating = undefined
    }
  }
  settingsScope.subscribe(syncFloating)
  syncFloating()

  // Plugin configuration card: one staged form over the `desktop-launcher`
  // settings namespace, contributed to the Web UI plugin group.
  const controller = new DesktopLauncherSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => {
    try {
      return ctx.slots.register({
        name: 'web-ui.plugin.item',
        id: 'desktop-launcher',
        order: 130,
        locale: NS,
        inject: () => controller.inject(),
      }, DesktopLauncherSettingsCard)
    } catch {
      return () => {}
    }
  })
}
