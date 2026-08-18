/**
 * Host half of the community plugin index card: registers the
 * community-plugins settings namespace so the card's enable switch persists
 * across reloads. The index itself is build-time data compiled into the
 * browser half (community.json); this half owns only the durable setting.
 * @module @linxin666/dsh-client-ui-community-plugins
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-community-plugins'

/** Services the settings registration needs (the settings seam is optional). */
export const inject = []

/**
 * Settings namespace of the card's enable switch — the section the web
 * settings surface edits. Spelled here rather than imported: the browser half
 * spells the same value and must not depend on a Host package.
 */
export const COMMUNITY_PLUGINS_SETTINGS_NAMESPACE = settingsNamespace('community-plugins')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the community plugin index card. */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Register the community-plugins settings namespace. The application of the
 * value is browser-side (the card hides its list while off), so the hooks
 * only keep the source reachable; installSettingsSection is a no-op when no
 * settings service is mounted (pure community-card installs skip it).
 * @param ctx - cordis context.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-community-plugins', applyImpl)

function applyImpl(ctx: Context): void {
  installSettingsSection(ctx, COMMUNITY_PLUGINS_SETTINGS_NAMESPACE, Config, {}, {
    setSource: () => { /* application is browser-side; value is read from the scope */ },
    onChange: () => { /* browser half re-reads on scope publish */ },
  })
}
