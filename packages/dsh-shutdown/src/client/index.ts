/**
 * Shutdown plugin — browser half. Registers the `shutdown` dictionaries, the
 * floating bottom-right power trigger, and the plugin settings card (the
 * `web-ui.plugin.item` seat). The button follows the plugin's enabled
 * setting; the confirm gate follows the `confirmShutdown` setting.
 */
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { mountShutdownButton } from './floating-mount.tsx'
import { ShutdownSettingsCard, ShutdownSettingsCardController, type ShutdownSettings } from './ShutdownSettingsCard.tsx'
import { en, zh, type ShutdownKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'shutdown'

/** Settings namespace the settings card edits (the Host plugin registers it). */
const SHUTDOWN_NS = 'shutdown'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shutdown surface copy. */
    shutdown: ShutdownKey
  }

  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
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

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Register the shutdown surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'shutdown: dictionaries')

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<ShutdownSettings>({ namespace: SHUTDOWN_NS })
  const read = (): ShutdownSettings | undefined => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready' ? snapshot.value : undefined
  }
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
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

  // Plugin configuration card: one staged form over the `shutdown` settings
  // namespace, contributed to the Web UI plugin group.
  const settingsCard = new ShutdownSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'shutdown',
    order: 120,
    locale: NS,
    inject: () => settingsCard.inject(),
  }, ShutdownSettingsCard))
}
