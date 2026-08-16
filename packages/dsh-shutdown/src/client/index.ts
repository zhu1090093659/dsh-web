/**
 * Shutdown plugin — browser half. Registers the `shutdown` dictionaries, the
 * sidebar footer power trigger (the `sidebar.footer.action` seat beside the
 * settings button), and the plugin settings card (the `web-ui.plugin.item`
 * seat). The entry follows the plugin's enabled setting; the confirm gate
 * follows the `confirmShutdown` setting.
 */
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-sidebar SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ShutdownEntry } from './ShutdownEntry.tsx'
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

  // Sidebar footer trigger: declaration-aware registration into the seat the
  // sidebar shell declares; toggling the plugin off removes the button.
  ctx.slots.inject('sidebar.footer.action', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        disposeEntry = ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'shutdown',
          order: 120,
          locale: NS,
          inject: () => ({ confirmShutdown }),
        }, ShutdownEntry)
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

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
