/**
 * dsh-mermaid host half — registers the "mermaid" settings section.
 *
 * All rendering lives in the browser half (the DOM enhancer plus the bundled
 * mermaid runtime); the host side exists so the web settings surface can edit
 * the section (enable toggle + diagram theme) and the browser half can read
 * it through the settings scope. No routes, no tools, no host behavior.
 *
 * Mounting constraint (family docs, "移植 harness 插件的挂载约束"): the
 * aggregate insert row carries no config, so apply never validates — the
 * loader fills schema defaults first and an empty config is legal.
 * @module @linxin666/dsh-client-ui-mermaid
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { MERMAID_THEMES, type MermaidSettingsSection } from './core/themes.ts'

export { MERMAID_THEMES } from './core/themes.ts'
export type { MermaidBuiltInTheme, MermaidSettingsSection, MermaidThemeSetting } from './core/themes.ts'

/** Stable cordis plugin name (matches the cordis.patch.yml insert id suffix). */
export const name = 'mermaid'

/** Settings namespace the browser half binds (`settingsScope.bind`). */
export const MERMAID_SETTINGS_NAMESPACE = 'mermaid'

/** Composition-entry config (the aggregate row fills schema defaults). */
export type MermaidConfig = MermaidSettingsSection

/**
 * Settings section schema: diagram rendering on by default, theme following
 * the interface brightness.
 */
export function makeMermaidSettingsSchema(): z<MermaidSettingsSection> {
  return z.object({
    enabled: z.boolean().default(true),
    theme: z.string().default('auto'),
  })
}

/**
 * Register the settings section on the context.
 * @param ctx - host context.
 * @param config - composition entry config (schema defaults when absent).
 */
export function apply(ctx: Context, config: MermaidConfig = {}): void {
  const base: MermaidSettingsSection = {
    enabled: config.enabled ?? true,
    theme: config.theme ?? 'auto',
  }
  // The browser half reads the resolved scope live (it re-renders diagrams on
  // change through its own subscription), so the host hooks only keep the
  // source sink contract.
  installSettingsSection(ctx, settingsNamespace(MERMAID_SETTINGS_NAMESPACE), makeMermaidSettingsSchema(), base, {
    setSource: () => {
      // Source thunk sink; nothing host-side derives from the section.
    },
    onChange: () => {
      // Live follow-through happens in the browser half.
    },
  })
}
