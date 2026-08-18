/**
 * In-GUI skin center, browser half: registers the Skin Center as a first-level
 * settings section (`settings.section`) and provides the try-on controller +
 * official theme handle to it. The section lists every installed skin
 * (embedded registry), tries it on live inside the GUI, exits with a full
 * restore, and applies the chosen skin in one click. The plugin writes only
 * DOM and the settings ledger — no services, no events, no model access.
 */
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkinCenterSection, type SkinCenterInjected } from './SkinCenter.tsx'
import { BackgroundController, SKIN_BACKGROUND_NS } from './background.ts'
import { SKIN_WALLPAPER_NS, WallpaperController } from './wallpaper.ts'
import { en, zh, type SkinCenterKey } from './locales.ts'
import { TryOnController } from './try-on.ts'

export type { SkinCenterComponentProps, SkinCenterInjected } from './SkinCenter.tsx'
export { TryOnController } from './try-on.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'skinCenter'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skin-center card's copy. */
    skinCenter: SkinCenterKey
  }
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


/** Required services: slots + locale (plugin card), theme (preview toggle), and settingsScope + its transport (background scrim). */
export const inject = ['slots', 'locale', 'theme', 'settingsScope', 'connection', 'remote']

/**
 * Register the skin-center dictionaries, the body scope attribute, and the
 * Skin Center as a first-level settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skin-center: dictionaries')

  // The card's own styles scope under this attribute so they keep applying
  // during try-on (when the active skin's attribute is retracted).
  ctx.effect(() => {
    document.body.dataset.dshSkinCenter = ''
    return () => { delete document.body.dataset.dshSkinCenter }
  }, 'ui-skin-center: body scope')

  const theme = ctx.get('theme') as ThemeRuntime
  const controller = new TryOnController()
  // Background occluder over the shared skin-background namespace. The scope
  // is bound to this plugin's fiber, so it is torn down with the card.
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const backgroundScope = binder.bind<{
    enabled?: boolean
    backgroundOpacity?: number
    backgroundBlurEmpty?: number
    backgroundBlurContent?: number
    bubbleOpacity?: number
  }>({ namespace: SKIN_BACKGROUND_NS })
  const background = new BackgroundController(backgroundScope)
  // Tear the blur element + observer down when this plugin's fiber goes away.
  ctx.effect(() => () => background.dispose(), 'ui-skin-center: background dispose')
  // The Wallpaper Engine bridge over the skin-wallpaper namespace.
  const wallpaperScope = binder.bind<{
    enabled?: boolean
    selection?: string
    mode?: 'live' | 'frame'
    pauseOnHidden?: boolean
    dim?: number
    wallpaperBlur?: number
  }>({ namespace: SKIN_WALLPAPER_NS })
  const wallpaper = new WallpaperController(wallpaperScope)
  ctx.effect(() => () => wallpaper.dispose(), 'ui-skin-center: wallpaper dispose')
  const injected = (): SkinCenterInjected => ({
    controller,
    theme: {
      getTheme: () => theme.getTheme(),
      subscribe: listener => ctx.on('theme/change', listener),
      setTheme: id => theme.setTheme(id),
    },
    background: {
      enabled: () => background.enabled(),
      setEnabled: value => background.setEnabled(value),
      opacity: () => background.opacity(),
      blurEmpty: () => background.blurEmpty(),
      blurContent: () => background.blurContent(),
      bubbleOpacity: () => background.bubbleOpacity(),
      subscribe: listener => background.subscribe(listener),
      set: opacity => background.set(opacity),
      setBlurEmpty: value => background.setBlurEmpty(value),
      setBlurContent: value => background.setBlurContent(value),
      setBubbleOpacity: value => background.setBubbleOpacity(value),
      dispose: () => background.dispose(),
    },
    wallpaper: {
      enabled: () => wallpaper.enabled(),
      selection: () => wallpaper.selection(),
      mode: () => wallpaper.mode(),
      dim: () => wallpaper.dim(),
      wallpaperBlur: () => wallpaper.wallpaperBlur(),
      pauseOnHidden: () => wallpaper.pauseOnHidden(),
      dirs: () => wallpaper.dirs(),
      addDir: dir => wallpaper.addDir(dir),
      removeDir: dir => wallpaper.removeDir(dir),
      activeId: () => wallpaper.activeId(),
      trying: () => wallpaper.trying(),
      subscribe: listener => wallpaper.subscribe(listener),
      setEnabled: value => wallpaper.setEnabled(value),
      setMode: value => wallpaper.setMode(value),
      setDim: value => wallpaper.setDim(value),
      setBlur: value => wallpaper.setBlur(value),
      setPauseOnHidden: value => wallpaper.setPauseOnHidden(value),
      applySelection: descriptor => wallpaper.applySelection(descriptor),
      clearSelection: () => wallpaper.clearSelection(),
      sync: descriptor => wallpaper.sync(descriptor),
      tryOn: descriptor => wallpaper.tryOn(descriptor),
      exitTryOn: () => wallpaper.exitTryOn(),
      dispose: () => wallpaper.dispose(),
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skin-center',
    order: 120,
    label: () => ctx.locale.bind('skinCenter')('title'),
    locale: 'skinCenter',
    inject: injected,
  }, SkinCenterSection))
}
