/**
 * Host half of the in-GUI skin center: mounts the `/api/skin-center/*` routes
 * the browser half uses for one-click apply / restore-official. Every switch
 * delegates to the `dsh-skin` CLI, which owns the `dsh-skin managed` section
 * of the active profile's `cordis.patch.yml` and the profile symlink; the DSH config
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
import { makeWeRoutes, WE_API_PREFIX } from './we-routes.ts'
import { defaultWallpapersStoreDir } from './we-library.ts'
import { reconcileSkinPatches, resolveHarnessHome } from './skin-switch.ts'
import { mountOnce } from './mount-once.ts'

export { makeSkinCenterRoutes, SKIN_CENTER_API_PREFIX } from './routes.ts'
export { makeWeRoutes, WE_API_PREFIX } from './we-routes.ts'

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

/**
 * Plugin-configuration fields for the main-interface background, plus the
 * master switch that turns the whole skin center on or off.
 */
export interface SkinBackgroundConfig {
  /** Master switch for the skin center. */
  enabled?: boolean
  /**
   * Background occlusion 0-100 (0 = no extra veil, 100 = fully obscured).
   * Skins that paint a backdrop image (blue-fantasy / whale-song) read the
   * equivalent CSS variable value and raise their scrim; the official stock
   * look has no backdrop and is unaffected.
   */
  backgroundOpacity?: number
  /**
   * Gaussian blur (px, 0-20) applied to the backdrop while the conversation
   * pane has no content (empty state). Painted only by skins that draw a
   * backdrop; 0 disables the empty-state blur.
   */
  backgroundBlurEmpty?: number
  /**
   * Gaussian blur (px, 0-20) applied to the backdrop once the conversation
   * pane has content. Painted only by skins that draw a backdrop; 0 disables
   * the with-content blur.
   */
  backgroundBlurContent?: number
}

/**
 * Runtime schema for SkinBackgroundConfig. Persists the master switch
 * (`enabled`) alongside the background strength fields.
 */
export const SkinBackgroundConfigSchema: z<SkinBackgroundConfig> = z.object({
  enabled: z.boolean().default(true),
  backgroundOpacity: z.number().min(0).max(100).step(5).default(0),
  backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(0),
  backgroundBlurContent: z.number().min(0).max(20).step(1).default(0),
})

/**
 * Settings namespace for the Wallpaper Engine bridge, owned by the skin
 * center. The browser half renders the applied wallpaper behind the GUI and
 * persists the selection here; the host half reads weLibraryDirs to extend
 * the library scan beyond the auto-detected Steam folders.
 */
export const SKIN_WALLPAPER_NAMESPACE = settingsNamespace('skin-wallpaper')

/**
 * Wallpaper bridge configuration. Wallpapers only ever come from the user's
 * own machine (their Wallpaper Engine library or manual folders); the import
 * store keeps personal local copies, nothing is redistributed.
 */
export interface SkinWallpaperConfig {
  /** Master switch for the wallpaper feature. */
  enabled?: boolean
  /** Manual library folders (each a folder of projects or a single project). */
  weLibraryDirs?: string[]
  /** The applied wallpaper id ('' = none). */
  selection?: string
  /** Render mode: 'live' renders video/web, 'frame' pins a static frame. */
  mode?: 'live' | 'frame'
  /** Pause the video when the window is hidden (saves GPU/battery). */
  pauseOnHidden?: boolean
  /** Darkening scrim over the wallpaper, 0-90 percent. */
  dim?: number
  /** Blur radius applied to the wallpaper itself, 0-60 px. */
  wallpaperBlur?: number
}

/** Runtime schema for SkinWallpaperConfig. */
export const SkinWallpaperConfigSchema: z<SkinWallpaperConfig> = z.object({
  enabled: z.boolean().default(true),
  weLibraryDirs: z.array(z.string()).default([]),
  selection: z.string().default(''),
  mode: z.union(['live', 'frame'] as const).default('live'),
  pauseOnHidden: z.boolean().default(true),
  dim: z.number().min(0).max(90).step(5).default(25),
  wallpaperBlur: z.number().min(0).max(60).step(1).default(0),
})

/**
 * Register the skin-center API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the skin center
 * must not take the GUI down.
 * @param ctx - cordis context.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-skin-center', applyImpl)

function applyImpl(ctx: Context): void {
  // Boot-time self-heal of the managed skin section (issue #495): re-render it
  // from the live registry so insert rows referencing packages that pnpm
  // pruned (a skin dropped from the family bundle, or the whole plugin
  // removed) cannot leave a stale boot-breaking patch behind. Idempotent;
  // logs, never throws — the skin center must not take the GUI down.
  try {
    const { notes } = reconcileSkinPatches()
    for (const note of notes) console.warn('[ui-skin-center] ' + note)
  } catch (error) {
    console.error('[ui-skin-center] managed-section reconciliation failed:', error)
  }

  // Optional-settings wiring for the background scrim namespace. The browser
  // half binds the scope and applies the value to the body CSS variable;
  // this side just declares the namespace + schema so the value persists and
  // re-resolves across reloads. installSettingsSection is a no-op when no
  // settings service is mounted (pure skin-center installs skip it).
  installSettingsSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
    setSource: () => { /* application is browser-side; value is read from the scope */ },
    onChange: () => { /* browser half re-applies on scope publish */ },
  })

  // The wallpaper bridge namespace; the host side keeps a live getter so
  // the /we routes see weLibraryDirs changes without a restart.
  let wallpaperSource: () => SkinWallpaperConfig = () => ({})
  installSettingsSection(ctx, SKIN_WALLPAPER_NAMESPACE, SkinWallpaperConfigSchema, {}, {
    setSource: (source) => { wallpaperSource = source },
    onChange: () => { /* routes re-read through the getter per request */ },
  })

  const routes = [
    ...makeSkinCenterRoutes(),
    ...makeWeRoutes({
      getConfig: () => wallpaperSource(),
      storeDir: defaultWallpapersStoreDir(resolveHarnessHome()),
    }),
  ]
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
