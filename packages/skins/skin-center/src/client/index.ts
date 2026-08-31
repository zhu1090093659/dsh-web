/**
 * In-GUI skin center, browser half: registers the Skin Center as a first-level
 * settings section (`settings.section`) and boots the v2 skin runtime
 * (effect ledger + atomic switch controller + semantic adapter + catalog
 * store). The section lists the installed skins (shipped built-ins +
 * $DSH_HOME/skins), tries them on live, and applies in one click — no reload,
 * no cordis.patch.yml rewrite (issue #506). The plugin writes only DOM and
 * the settings ledger — no services, no events, no model access.
 *
 * Background preferences persist through the v2 /active channel instead of
 * the settings scope (issue #996): the remote pairing channel fences
 * settings.* as loopback-only, so scope-backed writes never reached the
 * server from a paired desktop. The legacy skin-background scope is still
 * bound as a live input for the official settings page (loopback only);
 * card edits flow card -> POST /active, page edits flow scope -> POST
 * /active.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote namespace (ctx.remote), including directoryPicker.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkinCenterSection, type SkinCenterInjected } from './SkinCenter.tsx'
import { BackgroundController, SKIN_BACKGROUND_NS } from './background.ts'
import type { SkinBackgroundConfig } from '../core/background.ts'
import { reconcileSkinBackgroundScope, serializeSkinBackgroundUserLayer } from '../core/background-scope.ts'
import { SKIN_WALLPAPER_NS, WallpaperController, installBootRestore } from './wallpaper.ts'
import { en, zh, type SkinCenterKey } from './locales.ts'
import { bootSkinRuntime } from './runtime/boot.ts'
import { PreviewCoordinator } from './preview-coordinator.ts'
import { CustomThemeController } from './custom-theme-controller.ts'
import { SKIN_CUSTOM_THEME_NS, type CustomThemeConfig } from '../core/custom-theme.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

export type { SkinCenterComponentProps, SkinCenterInjected } from './SkinCenter.tsx'
export { bootSkinRuntime } from './runtime/boot.ts'

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
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}


/** Required services: slots + locale (plugin card), theme (preview toggle), settingsScope + its transport (background scrim), and remote (wallpaper directory picker). */
export const inject = ['slots', 'locale', 'theme', 'settingsScope', 'connection', 'remote']

/** Self-report item for the install heartbeat. */
const SELF_ITEM = [{ name: '@linxin666/dsh-client-ui-skin-center' }]

/**
 * Beat the install heartbeat (docs/telemetry.md), enriching it with the
 * installed skin inventory (skin:<id> + version + channel) once the v2
 * catalog answers. Offline or pre-boot the beat stays package-only.
 */
function beatHeartbeat(): void {
  reportDailyHeartbeat(SELF_ITEM)
  void fetch('/api/skin-center/v2/catalog')
    .then((res) => (res.ok ? res.json() : null))
    .then((catalog) => {
      if (!catalog || !Array.isArray(catalog.skins)) return
      const items = [...SELF_ITEM]
      for (const skin of catalog.skins) {
        const id = skin && skin.manifest && typeof skin.manifest.id === 'string' ? skin.manifest.id : ''
        if (!id) continue
        const item: { name: string; version?: string; channel?: 'market' | 'npm' | 'unknown' } = { name: 'skin:' + id }
        if (typeof skin.manifest.version === 'string') item.version = skin.manifest.version
        if (typeof skin.channel === 'string') item.channel = skin.channel
        items.push(item)
      }
      reportDailyHeartbeat(items.slice(0, 64))
    })
    .catch(() => { /* offline or fenced: the package-only beat already went out */ })
}

/**
 * Register the skin-center dictionaries, the body scope attribute, and the
 * Skin Center as a first-level settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name plus installed-skin inventory, silent failure.
  beatHeartbeat()

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'ui-skin-center: dictionaries')

  // The card's own styles scope under this attribute so they keep applying
  // during try-on (when the active skin's attribute is retracted).
  ctx.effect(() => {
    document.body.dataset.dshSkinCenter = ''
    return () => { delete document.body.dataset.dshSkinCenter }
  }, 'ui-skin-center: body scope')

  const theme = ctx.get('theme') as ThemeRuntime
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  // The v2 state channel: GET backfills on boot, edits POST back debounced.
  // The remote proxy rewrites this path into the allow-listed channel, so it
  // works from paired desktops where the settings scope is fenced (#996).
  const V2_ACTIVE_URL = '/api/skin-center/v2/active'
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  const postBackground = (next: SkinBackgroundConfig, keepalive = false): void => {
    void fetch(V2_ACTIVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ background: next }),
      keepalive,
    }).catch(() => { /* offline or pre-boot: the in-memory values stay applied */ })
  }
  // Coalesce slider drags into one write; dispose flushes the pending one.
  const persistBackground = (next: SkinBackgroundConfig): void => {
    if (persistTimer !== null) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      postBackground(next)
    }, 250)
  }
  const flushBackground = (): void => {
    if (persistTimer === null) return
    clearTimeout(persistTimer)
    persistTimer = null
    postBackground(background.snapshot(), true)
  }
  // The legacy scope is an input face for the loopback settings page only.
  // Its resolved value contains schema defaults, so only the raw user layer may
  // be reconciled into the authoritative v2 state.
  const backgroundScope = binder.bind<SkinBackgroundConfig>({ namespace: SKIN_BACKGROUND_NS })
  const scopeConfig = (): SkinBackgroundConfig | null => {
    const value = backgroundScope.getSnapshot().value
    if (value === undefined || value === null) return null
    return value
  }
  let v2Loaded = false
  // Scope revision fences unrelated settings-document publications. Seed it
  // from the first view so the initial mirror publication is not mistaken for
  // a user edit after the v2 fetch completes.
  let lastScopeRevision: number | undefined = backgroundScope.getSnapshot().revision
  // Content-based dedup: a revision bump with identical user-layer content is
  // a replay (WS reconnect, mirror resync, or another plugin writing to the
  // global settings document) and must not overwrite the authoritative v2
  // state (#1109, #1107).
  let lastUserJson: string = serializeSkinBackgroundUserLayer(backgroundScope.getSnapshot().user)
  const background = new BackgroundController(scopeConfig(), persistBackground)
  const reconcileScope = (): void => {
    if (!v2Loaded) return
    const snapshot = backgroundScope.getSnapshot()
    const result = reconcileSkinBackgroundScope(
      background.snapshot(),
      { revision: snapshot.revision, user: snapshot.user },
      lastScopeRevision,
      lastUserJson,
    )
    lastScopeRevision = result.revision
    lastUserJson = result.lastUserJson
    if (!result.accepted || result.patch === null) return
    const current = background.snapshot()
    background.init({ ...current, ...result.patch })
    persistBackground(background.snapshot())
  }
  // Refetch the authoritative v2 state once booted; it wins over the scope
  // snapshot (the migration may only have run with this boot).
  void fetch(V2_ACTIVE_URL)
    .then((res) => (res.ok ? res.json() as Promise<{ background?: SkinBackgroundConfig | null }> : null))
    .then((body) => {
      v2Loaded = true
      if (body?.background) background.init(body.background)
      // Reconcile only a scope revision that changed while the v2 state was
      // loading; an unchanged revision is the legacy boot snapshot.
      reconcileScope()
    })
    .catch(() => {
      v2Loaded = true
      reconcileScope()
    })
  // Settings-page edits arrive through the scope publish. The settings mirror
  // may republish this namespace for an unrelated document change, so fence on
  // the namespace revision and use only explicitly stored user fields.
  ctx.effect(
    () => backgroundScope.subscribe(reconcileScope),
    'ui-skin-center: background scope sync',
  )
  // Tear the blur element + observer down when this plugin's fiber goes away.
  ctx.effect(() => () => {
    flushBackground()
    background.dispose()
  }, 'ui-skin-center: background dispose')
  const customThemeScope = binder.bind<CustomThemeConfig>({ namespace: SKIN_CUSTOM_THEME_NS })
  const customTheme = new CustomThemeController(customThemeScope)
  ctx.effect(() => () => customTheme.dispose(), 'ui-skin-center: custom theme dispose')
  // The Wallpaper Engine bridge over the skin-wallpaper namespace.
  const wallpaperScope = binder.bind<{
    enabled?: boolean
    selection?: string
    mode?: 'live' | 'frame'
    pauseOnHidden?: boolean
    dim?: number
    wallpaperBlur?: number
    wallpaperOpacity?: number
    fit?: 'cover' | 'contain' | 'fill'
  }>({ namespace: SKIN_WALLPAPER_NS })
  const wallpaper = new WallpaperController(wallpaperScope)
  ctx.effect(() => () => wallpaper.dispose(), 'ui-skin-center: wallpaper dispose')
  // Mount the persisted wallpaper selection at boot (page load), so a
  // selection survives reloads without first opening the skin-center card.
  installBootRestore(wallpaper)

  // The v2 skin runtime store: outlives the settings card so a try-on
  // preview survives closing and reopening the panel. Background-media
  // priority: an active WE wallpaper suppresses skin manifest backgrounds;
  // toggling the wallpaper re-activates the current skin so the priority
  // flip paints immediately.
  const runtime = bootSkinRuntime({
    suppressBackgroundMedia: () => wallpaper.enabled() && wallpaper.isDisplaying(),
  })
  ctx.effect(() => () => runtime.shutdown(), 'ui-skin-center: runtime shutdown')
  ctx.effect(
    () => wallpaper.subscribe(() => { void runtime.controller.refresh() }),
    'ui-skin-center: wallpaper priority refresh',
  )
  const preview = new PreviewCoordinator(runtime.controller, wallpaper, customTheme)
  ctx.effect(
    () => ctx.on('theme/change', () => wallpaper.recoverScenePlayer()),
    'ui-skin-center: scene recovery after theme change',
  )
  const injected = (): SkinCenterInjected => ({
    runtime,
    preview,
    customTheme,
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
      inputCardBlur: () => background.inputCardBlur(),
      bubbleOpacity: () => background.bubbleOpacity(),
      subscribe: listener => background.subscribe(listener),
      set: opacity => background.set(opacity),
      setBlurEmpty: value => background.setBlurEmpty(value),
      setBlurContent: value => background.setBlurContent(value),
      setInputCardBlur: value => background.setInputCardBlur(value),
      setBubbleOpacity: value => background.setBubbleOpacity(value),
      dispose: () => background.dispose(),
    },
    wallpaper: {
      enabled: () => wallpaper.enabled(),
      selection: () => wallpaper.selection(),
      mode: () => wallpaper.mode(),
      fit: () => wallpaper.fit(),
      dim: () => wallpaper.dim(),
      wallpaperBlur: () => wallpaper.wallpaperBlur(),
      wallpaperOpacity: () => wallpaper.wallpaperOpacity(),
      pauseOnHidden: () => wallpaper.pauseOnHidden(),
      sound: () => wallpaper.sound(),
      volume: () => wallpaper.volume(),
      dirs: () => wallpaper.dirs(),
      addDir: dir => wallpaper.addDir(dir),
      removeDir: dir => wallpaper.removeDir(dir),
      pickDir: async () => {
        const result = await ctx.remote.directoryPicker.pick()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      activeId: () => wallpaper.activeId(),
      trying: () => wallpaper.trying(),
      subscribe: listener => wallpaper.subscribe(listener),
      setEnabled: value => wallpaper.setEnabled(value),
      setMode: value => wallpaper.setMode(value),
      setFit: fit => wallpaper.setFit(fit),
      setDim: value => wallpaper.setDim(value),
      setBlur: value => wallpaper.setBlur(value),
      setOpacity: value => wallpaper.setOpacity(value),
      setPauseOnHidden: value => wallpaper.setPauseOnHidden(value),
      setSound: value => wallpaper.setSound(value),
      setVolume: value => wallpaper.setVolume(value),
      applySelection: descriptor => { void preview.runWallpaper(() => wallpaper.applySelection(descriptor)) },
      clearSelection: () => wallpaper.clearSelection(),
      sync: descriptor => wallpaper.sync(descriptor),
      tryOn: descriptor => { void preview.runWallpaper(() => wallpaper.tryOn(descriptor)) },
      exitTryOn: () => wallpaper.exitTryOn(),
      recoverScenePlayer: () => wallpaper.recoverScenePlayer(),
      dispose: () => wallpaper.dispose(),
    },
  })

  // First-level settings section: the Skin Center card as its own top-level
  // settings page. Browsing and installing new skins happens in the DSH
  // Market store; this section manages the installed ones (try-on, apply,
  // wallpaper, custom theme).
  ctx.slots.inject('settings.section', () => {
    try {
      return ctx.slots.register({
        name: 'settings.section',
        id: 'skin-center',
        order: 120,
        label: () => ctx.locale.bind('skinCenter')('title'),
        locale: 'skinCenter',
        inject: injected,
      }, SkinCenterSection)
    } catch {
      return () => {}
    }
  })
}
