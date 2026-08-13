/**
 * Host half of the in-GUI skin center: mounts the `/api/skin-center/*` routes
 * the browser half uses for one-click apply / restore-official. Every switch
 * delegates to the `dsh-skin` CLI, which owns the `dsh-skin managed` section
 * of `~/.dsh/cordis.patch.yml` and the profile symlink; the DSH config
 * watcher hot-reloads the patch within seconds, so no restart is needed.
 * Try-on stays pure browser work (see src/client/try-on.ts).
 * @module @linxin666/dsh-client-ui-skin-center
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
// Type-only: pulls the dsh-host-webserver service seat (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeSkinCenterRoutes, SKIN_CENTER_API_PREFIX } from './routes.ts'

export { makeSkinCenterRoutes, SKIN_CENTER_API_PREFIX } from './routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-skin-center'

/** Services required before the skin-center can mount its routes. */
export const inject = ['webServer']

/**
 * Settings namespace for the main-interface background scrim, owned by the
 * skin center. The browser half spells the same string so it can bind the
 * scope without depending on this Host package.
 */
export const SKIN_BACKGROUND_NAMESPACE = settingsNamespace('skin-background')

/** Plugin-configuration fields for the main-interface background. */
export interface SkinBackgroundConfig {
  /**
   * Background occlusion 0-100 (0 = no extra veil, 100 = fully obscured).
   * Skins that paint a backdrop image (blue-fantasy / whale-song) read the
   * equivalent CSS variable value and raise their scrim; the official stock
   * look has no backdrop and is unaffected.
   */
  backgroundOpacity?: number
}

/** Runtime schema for SkinBackgroundConfig. */
export const SkinBackgroundConfigSchema: z<SkinBackgroundConfig> = z.object({
  backgroundOpacity: z.number().min(0).max(100).step(5).default(0),
})

/**
 * Register the skin-center API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the skin center
 * must not take the GUI down.
 * @param ctx - cordis context.
 */
export function apply(ctx: Context): void {
  // Optional-settings wiring for the background scrim namespace. The browser
  // half binds the scope and applies the value to the body CSS variable;
  // this side just declares the namespace + schema so the value persists and
  // re-resolves across reloads. installSettingsSection is a no-op when no
  // settings service is mounted (pure skin-center installs skip it).
  installSettingsSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
    setSource: () => { /* application is browser-side; value is read from the scope */ },
    onChange: () => { /* browser half re-applies on scope publish */ },
  })

  const routes = makeSkinCenterRoutes()
  try {
    ctx.effect(() => {
      const disposers: Array<() => void> = []
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        // Roll back whatever registered before the failure so a partial
        // mount never leaves half a route family live; the outer catch logs.
        for (const dispose of disposers) dispose()
        throw error
      }
      return () => { for (const dispose of disposers) dispose() }
    }, 'ui-skin-center: routes')
  } catch (error) {
    console.error('[ui-skin-center] route registration failed:', error)
  }
}
