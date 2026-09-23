/**
 * Host-half configuration contract. Under 0.1.7 the plugin's own `Config`
 * schema IS what the Host settings surface serves: it derives one settings
 * page per profile entry from it and accepts a write only for the paths it
 * declares volatile. These tests pin what the browser half depends on — the
 * fields and defaults the removed per-namespace registration declared, the
 * volatility of every field the card or the settings page writes, and the
 * live references the runtime reads an edit through.
 */
import { describe, expect, it } from 'vitest'
import {
  Config,
  SKIN_BACKGROUND_NAMESPACE,
  SKIN_CUSTOM_THEME_NAMESPACE,
  SKIN_WALLPAPER_NAMESPACE,
  SkinBackgroundConfigSchema,
  SkinCustomThemeConfigSchema,
  SkinWallpaperConfigSchema,
} from '../src/index.ts'
import { SKIN_BACKGROUND_DEFAULTS, type SkinBackgroundConfig } from '../src/core/background.ts'
import { CUSTOM_THEME_DEFAULTS, CUSTOM_THEME_VERSION } from '../src/core/custom-theme.ts'

/** The write hook the Loader uses to commit a new value into a live reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Commit a value into a live config reference, exactly as the Loader's volatile update does. */
function commit(reference: unknown, value: unknown): void {
  const write = (reference as Record<symbol, ((next: unknown) => void) | undefined>)[VOLATILE_WRITE]
  if (write === undefined) throw new Error('the config field is not a live reference')
  write(value)
}

/**
 * Unwrap one resolved config layer: schema-declared volatile fields arrive as
 * references (see `readField` in src/index.ts), so a test reads them the same
 * way the plugin does.
 */
function plain<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(entry => plain(entry)) as T
  if (typeof value === 'object') {
    const ref = value as { get?: () => unknown }
    if (typeof ref.get === 'function') return plain(ref.get() as T)
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, plain(entry)])) as T
  }
  return value
}

/** The live schema node behind one path, or undefined. */
function node(path: string[]): { meta?: { volatile?: boolean }; dict?: Record<string, unknown> } | undefined {
  let current: unknown = Config
  for (const key of path) {
    const dict = (current as { dict?: Record<string, unknown> }).dict
    current = dict?.[key]
    if (current === undefined) return undefined
  }
  return current as { meta?: { volatile?: boolean } }
}

/**
 * Whether the Host accepts a write at one path: the node itself, or the
 * nearest declared ancestor, is volatile (the Host's own `isVolatilePath`).
 */
function writablePath(path: string[]): boolean {
  let current = node([]) as { meta?: { volatile?: boolean }; dict?: Record<string, unknown> } | undefined
  for (const key of path) {
    if (current?.meta?.volatile === true) return true
    current = current?.dict?.[key] as typeof current
    if (current === undefined) return false
  }
  return current?.meta?.volatile === true
}

describe('skin-center host config', () => {
  it('user gets the three preference sections the browser half edits', () => {
    // Given the plugin's own configuration schema, which the Host serves as
    // this profile entry's settings page
    // When the entry's sections are read
    // Then they are the three preference families the card owns
    expect(Object.keys(Config.dict ?? {})).toEqual([
      SKIN_BACKGROUND_NAMESPACE,
      SKIN_CUSTOM_THEME_NAMESPACE,
      SKIN_WALLPAPER_NAMESPACE,
    ])
  })

  it('user gets the background section resolved to its previous defaults', () => {
    // Given a profile row that carries no skin-center config at all
    // When the Host resolves the entry
    const resolved = plain(Config({})['skin-background']) as SkinBackgroundConfig

    // Then the background fields keep the defaults the removed registration declared
    expect(resolved).toEqual(SKIN_BACKGROUND_DEFAULTS)
  })

  it('user gets the wallpaper section defaults, sound fields included', () => {
    // Given a profile row that never touched the wallpaper settings
    // When the Host resolves the entry
    const resolved = plain(Config({})['skin-wallpaper'])

    // Then every wallpaper field — including the sound toggle and volume the
    // card persists — carries the value the previous namespace declared
    expect(resolved).toEqual({
      enabled: true,
      weLibraryDirs: [],
      selection: '',
      mode: 'live',
      pauseOnHidden: true,
      dim: 25,
      wallpaperBlur: 0,
      wallpaperOpacity: 100,
      fit: 'cover',
      sound: false,
      volume: 100,
    })
  })

  it('user gets the custom-theme section resolved from the versioned contract', () => {
    // Given a profile row that never applied a custom theme
    // When the Host resolves the entry
    const resolved = plain(Config({})['skin-custom-theme'])

    // Then the palette editor starts from the contract defaults, inert
    expect(resolved).toEqual({
      version: CUSTOM_THEME_VERSION,
      applied: false,
      light: CUSTOM_THEME_DEFAULTS.light,
      dark: CUSTOM_THEME_DEFAULTS.dark,
    })
  })

  it('user keeps a per-field profile value while the section defaults fill the rest', () => {
    // Given a profile row that selects a wallpaper and dims it
    const resolved = plain(Config({ 'skin-wallpaper': { selection: '1218076433', dim: 40 } }))

    // When the Host resolves the entry
    // Then the explicit fields win and the untouched ones keep their defaults
    expect((resolved['skin-wallpaper'] as { selection: string }).selection).toBe('1218076433')
    expect((resolved['skin-wallpaper'] as { dim: number }).dim).toBe(40)
    expect((resolved['skin-wallpaper'] as { wallpaperOpacity: number }).wallpaperOpacity).toBe(100)
  })

  it('user gets every field of every section declared volatile', () => {
    // Given the schema the Host projects the entry's form from
    // When each section's declared fields are inspected
    // Then every one of them is volatile, which is what puts it on the
    // generated settings page and lets its path accept a write
    for (const section of [SKIN_BACKGROUND_NAMESPACE, SKIN_CUSTOM_THEME_NAMESPACE, SKIN_WALLPAPER_NAMESPACE]) {
      const fields = Object.keys(node([section])!.dict ?? {})
      expect(fields.length).toBeGreaterThan(0)
      const nonVolatile = fields.filter(field => node([section, field])?.meta?.volatile !== true)
      expect(nonVolatile).toEqual([])
    }
  })

  it('user gets the card-writable paths volatile, with no volatile field inside another', () => {
    // Given the paths the browser half writes: whole light/dark profiles,
    // single wallpaper fields, and the background fields the settings page edits
    const writable = [
      [SKIN_CUSTOM_THEME_NAMESPACE, 'applied'],
      [SKIN_CUSTOM_THEME_NAMESPACE, 'light'],
      [SKIN_CUSTOM_THEME_NAMESPACE, 'light', 'accent'],
      [SKIN_WALLPAPER_NAMESPACE, 'selection'],
      [SKIN_WALLPAPER_NAMESPACE, 'sound'],
      [SKIN_WALLPAPER_NAMESPACE, 'weLibraryDirs'],
      [SKIN_BACKGROUND_NAMESPACE, 'enabled'],
    ]

    // When each path is looked up in the schema
    // Then every one of them accepts a write, and schemastery refuses to
    // resolve a volatile field inside a volatile one, so the profiles are
    // volatile as whole objects while their own fields stay plain
    expect(writable.filter(path => node(path) === undefined)).toEqual([])
    expect(writable.filter(path => !writablePath(path))).toEqual([])
    expect(['light', 'dark'].flatMap(profile => Object.keys(node([SKIN_CUSTOM_THEME_NAMESPACE, profile])!.dict ?? {})
      .filter(field => node([SKIN_CUSTOM_THEME_NAMESPACE, profile, field])?.meta?.volatile === true)))
      .toEqual([])
  })

  it('user gets the exported section schemas as the Config sections', () => {
    // Given the schemas this package exports for readers of the contract
    // When the entry's own sections are compared with them
    // Then they are the same schemas, so no reader sees a second field set
    expect(Config.dict?.['skin-background']).toBe(SkinBackgroundConfigSchema)
    expect(Config.dict?.['skin-custom-theme']).toBe(SkinCustomThemeConfigSchema)
    expect(Config.dict?.['skin-wallpaper']).toBe(SkinWallpaperConfigSchema)
  })

  it('user gets a wallpaper edit the running activation reads without a remount', () => {
    // Given a validated config whose references a running activation holds
    const resolved = Config({})
    const held = resolved['skin-wallpaper'].selection
    expect(held.get()).toBe('')

    // When the Host commits a settings write into that same reference (the
    // Loader's live update for a volatile field, not a row remount)
    commit(held, Config({ 'skin-wallpaper': { selection: '1218076433' } })['skin-wallpaper'].selection.get())

    // Then the activation's own reference reports the new selection, which is
    // what the /we routes serve
    expect(held.get()).toBe('1218076433')
  })
})
