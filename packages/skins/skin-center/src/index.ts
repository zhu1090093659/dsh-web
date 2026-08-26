/**
 * Host half of the in-GUI skin center: mounts the `/api/skin-center/*` routes
 * the browser half uses for the skin catalog, the active selection and
 * one-click apply / restore-official (v2, issue #506). Skins are pure asset
 * directories served through the safety pipeline; switching is a client-side
 * atomic swap and never touches `cordis.patch.yml`. Try-on stays pure
 * browser work (see src/client/runtime/skin-controller.ts).
 * @module @linxin666/dsh-client-ui-skin-center
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
// Type-only: pulls the dsh-host-webserver service seat (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeSkinCenterV2Routes } from './routes-v2.ts'
import { makeSkinIndexRows, makeSkinIndexTap } from './tap-index-adapter.ts'
import { defaultActiveStatePath, readActiveSelection, seedDefaultActiveSkin } from './active-state.ts'
import { migrateBackgroundFromSettings } from './background-migration.ts'
import { migrateLegacySelection } from './legacy-bridge.ts'
import { SKIN_BACKGROUND_DEFAULTS, type SkinBackgroundConfig } from './core/background.ts'
import { findSkin, loadSkinCatalog } from './skin-repo.ts'
import { makeWeRoutes } from './we-routes.ts'
import { defaultWallpapersStoreDir } from './we-library.ts'
import { resolveHarnessHome } from './harness-home.ts'
import { mountOnce } from './mount-once.ts'
import {
  CUSTOM_THEME_DEFAULTS,
  CUSTOM_THEME_VERSION,
  SKIN_CUSTOM_THEME_NS,
  type CustomThemeConfig,
} from './core/custom-theme.ts'

export { makeSkinCenterV2Routes, SKIN_CENTER_V2_PREFIX } from './routes-v2.ts'
export { makeWeRoutes, WE_API_PREFIX } from './we-routes.ts'
// The contract surface, re-exported for tooling (the dsh-skin CLI validates
// and installs skin directories through these; never duplicate the logic).
export { validateSkinManifestV2 } from './core/manifest-v2/validate.ts'
export type { SkinManifestV2, SkinManifestValidation } from './core/manifest-v2/types.ts'
export { transformSkinCss, SkinCssSafetyError } from './core/css-safety/transform.ts'
export { auditTokenContract } from './core/css-safety/token-audit.ts'
export type { TokenAuditStylesheet, TokenAuditResult } from './core/css-safety/token-audit.ts'
export { loadSkinCatalog, findSkin, resolveInsideSkin, userSkinsDir, builtinSkinsDir, canServeSkinHooks } from './skin-repo.ts'
export type { SkinCatalog, SkinCatalogEntry } from './skin-repo.ts'
export { defaultActiveStatePath, readActiveSelection, writeActiveSelection } from './active-state.ts'

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

/** Versioned settings namespace for the official-theme palette editor. */
export const SKIN_CUSTOM_THEME_NAMESPACE = settingsNamespace(SKIN_CUSTOM_THEME_NS)

export type SkinCustomThemeConfig = CustomThemeConfig

const CustomThemeProfileSchema = z.object({
  accent: z.string().default(CUSTOM_THEME_DEFAULTS.light.accent),
  background: z.string().default(CUSTOM_THEME_DEFAULTS.light.background),
  foreground: z.string().default(CUSTOM_THEME_DEFAULTS.light.foreground),
  contrast: z.number().min(0).max(100).step(1).default(50),
})

/** Host-side persistence schema; browser normalization remains fail-closed. */
export const SkinCustomThemeConfigSchema: z<SkinCustomThemeConfig> = z.object({
  version: z.number().min(CUSTOM_THEME_VERSION).max(CUSTOM_THEME_VERSION).step(1).default(CUSTOM_THEME_VERSION),
  applied: z.boolean().default(false),
  light: CustomThemeProfileSchema.default(CUSTOM_THEME_DEFAULTS.light),
  dark: z.object({
    accent: z.string().default(CUSTOM_THEME_DEFAULTS.dark.accent),
    background: z.string().default(CUSTOM_THEME_DEFAULTS.dark.background),
    foreground: z.string().default(CUSTOM_THEME_DEFAULTS.dark.foreground),
    contrast: z.number().min(0).max(100).step(1).default(50),
  }).default(CUSTOM_THEME_DEFAULTS.dark),
})

// The preference set the card edits now persists in the v2 active-state
// document (issue #996); the shared contract lives in core/background.ts and
// is re-exported here for the public API.
export type { SkinBackgroundConfig } from './core/background.ts'

/**
 * Runtime schema for SkinBackgroundConfig. Persists the master switch
 * (`enabled`) alongside the background strength fields.
 */
export const SkinBackgroundConfigSchema: z<SkinBackgroundConfig> = z.object({
  enabled: z.boolean().default(SKIN_BACKGROUND_DEFAULTS.enabled),
  backgroundOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.backgroundOpacity),
  backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty),
  backgroundBlurContent: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurContent),
  inputCardBlur: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.inputCardBlur),
  bubbleOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.bubbleOpacity),
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
  /** Opacity of the wallpaper media layer itself, 0-100 percent. */
  wallpaperOpacity?: number
  /** Sizing mode for live wallpapers: cover | contain | fill (stretch). */
  fit?: 'cover' | 'contain' | 'fill'
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
  wallpaperOpacity: z.number().min(0).max(100).step(5).default(100),
  fit: z.union(['cover', 'contain', 'fill'] as const).default('cover'),
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
  // Optional-settings wiring for the background scrim namespace. The browser
  // half binds the scope and applies the value to the body CSS variable;
  // this side just declares the namespace + schema so the value persists and
  // re-resolves across reloads. installSettingsSection is a no-op when no
  // settings service is mounted (pure skin-center installs skip it).
  installSettingsSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
    setSource: (source) => {
      // Issue #996: the authoritative store is now the v2 active-state
      // document (reachable through the remote pairing channel); this legacy
      // namespace stays as the official settings page's input face. Copy a
      // customized legacy section into the v2 store exactly once — safe at
      // detach too, since the entry fallback resolves to schema defaults,
      // which hasCustomSkinBackground excludes.
      const migration = migrateBackgroundFromSettings({
        activeStatePath: defaultActiveStatePath(),
        readSettings: source,
      })
      for (const note of migration.notes) {
        if (migration.migrated) console.info(`[ui-skin-center] background migration: ${note}`)
        else console.error(`[ui-skin-center] background migration: ${note}`)
      }
    },
    onChange: () => { /* browser half re-applies on scope publish and persists via the v2 channel */ },
  })

  installSettingsSection(ctx, SKIN_CUSTOM_THEME_NAMESPACE, SkinCustomThemeConfigSchema, {
    ...CUSTOM_THEME_DEFAULTS,
    light: { ...CUSTOM_THEME_DEFAULTS.light },
    dark: { ...CUSTOM_THEME_DEFAULTS.dark },
  }, {
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
    ...makeSkinCenterV2Routes(),
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
        // The anti-FOUC seam (issue #506): contribute stylesheet links through
        // DSH 0.1.1's structured table, then stamp html[data-dsh-skin] through
        // the raw tap because the table cannot mutate the opening html tag.
        const statePath = defaultActiveStatePath()
        const indexDeps = { readActiveId: () => readActiveSelection(statePath) }
        const collectSkinRows = makeSkinIndexRows(indexDeps)
        disposers.push(ctx.on('webserver/index-inject', (table) => {
          table.push(...collectSkinRows())
        }))
        disposers.push(ctx.webServer.tapIndex(makeSkinIndexTap(indexDeps)))
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

  // Default-skin seed (market on-demand plan): only blue-fantasy ships in
  // the package; every other skin is a market install into the user skins
  // directory. A first boot with no persisted selection activates the shipped
  // default once, so fresh installs see the intended look without the user
  // opening the skin center. Existing selections are never overwritten; a
  // selection no longer in the catalog resolves to the stock look browser-side.
  try {
    const statePath = defaultActiveStatePath()
    seedDefaultActiveSkin(statePath, (id) => findSkin(loadSkinCatalog(), id) !== null)
  } catch (error) {
    console.error('[ui-skin-center] default-skin seed failed:', error)
  }

  // One-shot legacy bridge (issue #506): migrate the retired dsh-skin
  // managed-section selection into the v2 store and strip the legacy rows.
  // Idempotent and fail-closed. Notes go to the host log only when the
  // bridge migrated, cleaned, or failed — the nothing-to-migrate steady
  // state stays silent instead of logging on every boot (issue #788).
  try {
    const statePath = defaultActiveStatePath()
    const knownIds = loadSkinCatalog().skins.map((s) => s.manifest.id)
    const migration = migrateLegacySelection({ knownIds, activeStatePath: statePath })
    if (migration.failed) {
      for (const note of migration.notes) console.error(`[ui-skin-center] legacy bridge: ${note}`)
    } else if (migration.migrated !== null || migration.patchCleaned) {
      for (const note of migration.notes) console.info(`[ui-skin-center] legacy bridge: ${note}`)
    }
  } catch (error) {
    console.error('[ui-skin-center] legacy bridge failed:', error)
  }
}
