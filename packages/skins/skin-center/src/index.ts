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
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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
 * Configuration section for the main-interface background scrim. Its name is
 * the settings namespace this package owned before 0.1.7; the browser half
 * spells the same string, both as this section's key and as the family
 * namespace the family settings binder resolves this plugin's profile entry
 * id by (it is the entry's only client-side handle).
 */
export const SKIN_BACKGROUND_NAMESPACE = 'skin-background'

/** Configuration section for the official-theme palette editor. */
export const SKIN_CUSTOM_THEME_NAMESPACE = SKIN_CUSTOM_THEME_NS

export type SkinCustomThemeConfig = CustomThemeConfig

const CustomThemeProfileSchema = z.object({
  accent: z.string().default(CUSTOM_THEME_DEFAULTS.light.accent),
  background: z.string().default(CUSTOM_THEME_DEFAULTS.light.background),
  foreground: z.string().default(CUSTOM_THEME_DEFAULTS.light.foreground),
  contrast: z.number().min(0).max(100).step(1).default(50),
})

/** Host-side persistence schema; browser normalization remains fail-closed. */
export const SkinCustomThemeConfigSchema = z.object({
  version: z.number().min(CUSTOM_THEME_VERSION).max(CUSTOM_THEME_VERSION).step(1).default(CUSTOM_THEME_VERSION).volatile(),
  applied: z.boolean().default(false).volatile(),
  // The two profiles are volatile as WHOLE objects: the card persists a whole
  // profile per edit (one atomic write per mode), so the object is the field.
  light: CustomThemeProfileSchema.default(CUSTOM_THEME_DEFAULTS.light).volatile(),
  dark: z.object({
    accent: z.string().default(CUSTOM_THEME_DEFAULTS.dark.accent),
    background: z.string().default(CUSTOM_THEME_DEFAULTS.dark.background),
    foreground: z.string().default(CUSTOM_THEME_DEFAULTS.dark.foreground),
    contrast: z.number().min(0).max(100).step(1).default(50),
  }).default(CUSTOM_THEME_DEFAULTS.dark).volatile(),
})

// The preference set the card edits now persists in the v2 active-state
// document (issue #996); the shared contract lives in core/background.ts and
// is re-exported here for the public API.
export type { SkinBackgroundConfig } from './core/background.ts'

/**
 * Runtime schema for SkinBackgroundConfig. Persists the master switch
 * (`enabled`) alongside the background strength fields; every field is
 * volatile so the settings page can write it.
 */
export const SkinBackgroundConfigSchema = z.object({
  enabled: z.boolean().default(SKIN_BACKGROUND_DEFAULTS.enabled).volatile(),
  backgroundOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.backgroundOpacity).volatile(),
  backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty).volatile(),
  backgroundBlurContent: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurContent).volatile(),
  inputCardBlur: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.inputCardBlur).volatile(),
  bubbleOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.bubbleOpacity).volatile(),
  bubbleBlur: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.bubbleBlur).volatile(),
})

/**
 * Configuration section for the Wallpaper Engine bridge. The browser half
 * renders the applied wallpaper behind the GUI and persists the selection
 * here; the host half reads weLibraryDirs to extend the library scan beyond
 * the auto-detected Steam folders.
 */
export const SKIN_WALLPAPER_NAMESPACE = 'skin-wallpaper'

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
  /** Audible playback for sound-capable wallpapers. */
  sound?: boolean
  /** Playback volume, 0-100 percent. */
  volume?: number
}

/** Runtime schema for SkinWallpaperConfig; every field is volatile (card-writable). */
export const SkinWallpaperConfigSchema = z.object({
  enabled: z.boolean().default(true).volatile(),
  weLibraryDirs: z.array(z.string()).default([]).volatile(),
  selection: z.string().default('').volatile(),
  mode: z.union(['live', 'frame'] as const).default('live').volatile(),
  pauseOnHidden: z.boolean().default(true).volatile(),
  dim: z.number().min(0).max(90).step(5).default(25).volatile(),
  wallpaperBlur: z.number().min(0).max(60).step(1).default(0).volatile(),
  wallpaperOpacity: z.number().min(0).max(100).step(5).default(100).volatile(),
  fit: z.union(['cover', 'contain', 'fill'] as const).default('cover').volatile(),
  // The card's sound toggle and volume always persisted through this
  // namespace's user layer; the section declares them so the Host accepts
  // those writes instead of refusing the whole settings mutation.
  sound: z.boolean().default(false).volatile(),
  volume: z.number().min(0).max(100).step(5).default(100).volatile(),
})

/**
 * One config field as the Host hands it to the plugin: a `volatile()` field
 * resolves to a stable reference the loader re-points in place when a
 * settings write is committed, while a caller that resolved the schema itself
 * holds the plain value. Read it through {@link readField}.
 */
type ConfigField<T> = Volatile<T> | T

/** Runtime face of the skin-background section. */
export interface SkinBackgroundFields {
  enabled?: ConfigField<boolean>
  backgroundOpacity?: ConfigField<number>
  backgroundBlurEmpty?: ConfigField<number>
  backgroundBlurContent?: ConfigField<number>
  inputCardBlur?: ConfigField<number>
  bubbleOpacity?: ConfigField<number>
  bubbleBlur?: ConfigField<number>
}

/** Runtime face of the skin-custom-theme section (the browser half owns it). */
export interface SkinCustomThemeFields {
  version?: ConfigField<number>
  applied?: ConfigField<boolean>
  light?: ConfigField<CustomThemeConfig['light']>
  dark?: ConfigField<CustomThemeConfig['dark']>
}

/** Runtime face of the skin-wallpaper section. */
export interface SkinWallpaperFields {
  enabled?: ConfigField<boolean>
  weLibraryDirs?: ConfigField<string[]>
  selection?: ConfigField<string>
  mode?: ConfigField<'live' | 'frame'>
  pauseOnHidden?: ConfigField<boolean>
  dim?: ConfigField<number>
  wallpaperBlur?: ConfigField<number>
  wallpaperOpacity?: ConfigField<number>
  fit?: ConfigField<'cover' | 'contain' | 'fill'>
  sound?: ConfigField<boolean>
  volume?: ConfigField<number>
}

/** The Host-resolved configuration this plugin's activation receives. */
export interface SkinCenterConfig {
  'skin-background'?: SkinBackgroundFields
  'skin-custom-theme'?: SkinCustomThemeFields
  'skin-wallpaper'?: SkinWallpaperFields
}

/**
 * Editable configuration of the skin center: what 0.1.7 serves as this
 * profile entry's settings page (the Host derives the page from this schema
 * and there is no separate settings document). The three sections are the
 * preference families the browser half owns — the same names this package
 * registered as settings namespaces before 0.1.7, now sections of one Config.
 *
 * A volatile field is the only kind the Host projects into the entry's form
 * or accepts a write for, and an edit is committed into the running
 * activation's references instead of remounting the row. The schema carries
 * no `z<...>` annotation on purpose: a volatile field parses to a `Volatile`
 * reference while accepting the plain value, so the annotation no longer
 * describes it ({@link SkinCenterConfig} is the runtime face instead).
 */
export const Config = z.object({
  'skin-background': SkinBackgroundConfigSchema,
  'skin-custom-theme': SkinCustomThemeConfigSchema,
  'skin-wallpaper': SkinWallpaperConfigSchema,
})

/**
 * Read one live config field.
 * @param field - the resolved field (a reference, a plain value, or absent).
 * @param fallback - schema default to use when the field carries no value.
 * @returns the field's current value.
 */
function readField<T>(field: ConfigField<T> | undefined, fallback: T): T {
  if (field === undefined) return fallback
  const ref = field as Volatile<T>
  if (typeof ref === 'object' && ref !== null && typeof ref.get === 'function') {
    const value = ref.get() as T | undefined
    return value === undefined ? fallback : value
  }
  return field as T
}

/** The live skin-background section, every field resolved over its default. */
function readBackgroundSection(section: SkinBackgroundFields | undefined): SkinBackgroundConfig {
  return {
    enabled: readField(section?.enabled, SKIN_BACKGROUND_DEFAULTS.enabled),
    backgroundOpacity: readField(section?.backgroundOpacity, SKIN_BACKGROUND_DEFAULTS.backgroundOpacity),
    backgroundBlurEmpty: readField(section?.backgroundBlurEmpty, SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty),
    backgroundBlurContent: readField(section?.backgroundBlurContent, SKIN_BACKGROUND_DEFAULTS.backgroundBlurContent),
    inputCardBlur: readField(section?.inputCardBlur, SKIN_BACKGROUND_DEFAULTS.inputCardBlur),
    bubbleOpacity: readField(section?.bubbleOpacity, SKIN_BACKGROUND_DEFAULTS.bubbleOpacity),
    bubbleBlur: readField(section?.bubbleBlur, SKIN_BACKGROUND_DEFAULTS.bubbleBlur),
  }
}

/**
 * Register the skin-center API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the skin center
 * must not take the GUI down.
 * @param ctx - cordis context.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-skin-center', applyImpl)

/**
 * @param ctx - cordis context.
 * @param config - this entry's effective configuration (the Host resolves
 *   `Config` over the profile patch and hands it to the activation).
 */
function applyImpl(ctx: Context, config?: SkinCenterConfig): void {
  // Settings (0.1.7): the plugin's own `Config` IS its settings page — the
  // Host derives the page from the schema and applies writes to this entry,
  // so nothing is registered here. `config` holds the resolved sections; its
  // volatile fields are live references the loader re-points in place.
  //
  // Issue #996: the authoritative background store is the v2 active-state
  // document (reachable through the remote pairing channel); the
  // skin-background section stays as the settings page's input face. Copy a
  // customized section into the v2 store exactly once — safe to run on every
  // boot, since a never-touched section resolves to schema defaults, which
  // hasCustomSkinBackground excludes, and an already-migrated document is
  // skipped outright.
  try {
    const migration = migrateBackgroundFromSettings({
      activeStatePath: defaultActiveStatePath(),
      readSettings: () => readBackgroundSection(config?.['skin-background']),
    })
    for (const note of migration.notes) {
      if (migration.migrated) console.info(`[ui-skin-center] background migration: ${note}`)
      else console.error(`[ui-skin-center] background migration: ${note}`)
    }
  } catch (error) {
    console.error('[ui-skin-center] background migration failed:', error)
  }

  const routes = [
    ...makeSkinCenterV2Routes(),
    ...makeWeRoutes({
      // The /we routes read the live section per request, so a settings write
      // reaches the library scan without a restart.
      getConfig: () => ({ weLibraryDirs: readField(config?.['skin-wallpaper']?.weLibraryDirs, []) }),
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
