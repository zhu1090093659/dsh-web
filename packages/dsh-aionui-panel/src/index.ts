/**
 * @linxin666/dsh-client-ui-aionui-panel — host half. The AionUi panel is
 * retired: the provider choice was removed and the right panel is always
 * the external dsh-better-sidebar side card, so this half no longer mounts
 * the /aionui-panel/* HTTP routes, the workspace fs watch, the git polling,
 * or the agent prompt section (the panel implementation under ./host stays
 * in the package as the unsupported historical record).
 *
 * What remains is the 'aionui-panel' settings namespace: the browser
 * side-card card binds it as its availability anchor, and keeping the
 * deprecated rightPanel field in the schema lets existing settings
 * documents keep validating. Its value is ignored everywhere.
 *
 * AionUi right-panel design (Apache-2.0, iOfficeAI/AionUi) — re-implemented
 * from measured behavior and architecture, not copied code.
 * @module @linxin666/dsh-client-ui-aionui-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'

/** Settings namespace the browser side-card card binds (the Host registers it). */
export const AIONUI_PANEL_SETTINGS_NAMESPACE = 'aionui-panel'

/**
 * The namespace shape: the deprecated provider field stays accepted so old
 * settings documents keep validating; it is ignored everywhere — the right
 * panel is always dsh-better-sidebar.
 */
export interface AionUiPanelSettings {
  /** Deprecated and ignored: the provider choice no longer exists. */
  rightPanel?: 'aionui-panel' | 'dsh-better-sidebar'
}

/**
 * Register the settings namespace (the browser card's availability anchor).
 * @param ctx - plugin context.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-aionui-panel', applyImpl)

function applyImpl(ctx: Context): void {
  installSettingsSection(
    ctx,
    settingsNamespace(AIONUI_PANEL_SETTINGS_NAMESPACE),
    z.object({
      rightPanel: z.union(['aionui-panel', 'dsh-better-sidebar']).default('dsh-better-sidebar'),
    }),
    {},
    {
      // The resolved values are never read: no provider choice remains.
      setSource: () => undefined,
      onChange: () => undefined,
    },
  )
}
