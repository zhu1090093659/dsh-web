import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the definitions that
// name the 'settings.*' holes) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { LiveStatsSettingsCard, LiveStatsSettingsCardController, type LiveStatsSettings } from './LiveStatsSettingsCard.tsx'
import { TpsLineDockEntry } from './TpsLine.tsx'
import { en, zh, type SettingsCardKey } from './locales.ts'

export { TpsLine, formatTokensPerSecond } from './TpsLine.tsx'
export type { LiveStatsSettings, LiveStatsSettingsCardFace, LiveStatsSettingsCardState } from './LiveStatsSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** live-stats settings-card copy. */
    'live-stats': SettingsCardKey
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

/** Dictionary namespace owned by this plugin. */
const NS = 'live-stats'

/** Settings namespace the live-stats card edits (the Host plugin registers it). */
const LIVE_STATS_NS = 'live-stats'

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the live-stats surface: the generation-throughput TPS group lives
 * in the ui-conversation stats line (read directly from the `liveTokenUsage`
 * projection), and this build of the browser half mounts the plugin settings
 * card over the `live-stats` namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'live-stats: dictionaries')

  // Plugin configuration card: one staged form over the `live-stats` settings
  // namespace, contributed to the plugin-configuration section.
  const liveStatsSettings = new LiveStatsSettingsCardController(
    ctx.settingsScope.bind<LiveStatsSettings>({ namespace: LIVE_STATS_NS }),
  )
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'live-stats',
    order: 110,
    locale: NS,
    inject: () => liveStatsSettings.inject(),
  }, LiveStatsSettingsCard))

  // The live TPS row mounts on the composer dock (the shipped stats-line
  // seat). Its session standard kit supplies `useProjection`, which reads the
  // host's `liveTokenUsage` projection. Previously TpsLine was only exported
  // for shell integration and never actually mounted on rc.6 (issue #56).
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'live-stats',
    order: 100,
    inject: () => ({}),
  }, TpsLineDockEntry))
}
