/**
 * The skin-center card: rendered as the content of a first-level settings
 * section, listing the official stock look plus every installed skin in the
 * v2 catalog (package-shipped built-ins + user dirs under $DSH_HOME/skins).
 *
 * v2 architecture (issue #506): skins are pure asset directories loaded by
 * the skin-center runtime. Try-on and apply both go through the same atomic
 * switch engine (src/client/runtime/skin-controller.ts) — try-on simply
 * skips persistence, and apply is one click with NO page reload, no
 * cordis.patch.yml rewrite, no boot-graph regeneration. The "trying on"
 * badge tracks the controller's live state, so closing and reopening the
 * settings panel keeps showing the skin that is still being previewed.
 * Copy rides the standard `t` seat; the theme preview control drives the
 * official theme service (persisted, same as the Appearance row).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { CatalogSkin, SkinRuntimeStore } from './runtime/boot.ts'
import type { SkinBackgroundHandle } from './background.ts'
import type { WallpaperHandle } from './wallpaper.ts'
import type { PreviewCoordinator } from './preview-coordinator.ts'
import type { CustomThemeController } from './custom-theme-controller.ts'
import { CustomThemeCard } from './CustomThemePanel.tsx'
import { WallpaperPanel } from './WallpaperPanel.tsx'
import { SliderControl } from './SliderControl.tsx'
import css from './skin-center.module.css'

/** Business face the skin-center apply() injects into the card. */
export interface SkinCenterInjected {
  /** The v2 skin runtime store (controller + catalog). */
  runtime: SkinRuntimeStore
  theme: {
    getTheme(): ThemeSnapshot
    subscribe(listener: () => void): () => void
    setTheme(id: 'light' | 'dark'): void
  }
  /** Background occluder over the shared skin-background namespace. */
  background: SkinBackgroundHandle
  /** Wallpaper Engine bridge over the skin-wallpaper namespace. */
  wallpaper: WallpaperHandle
  /** One serialized preview session shared by skins and wallpapers. */
  preview: PreviewCoordinator
  /** User palette derived from the official stock theme. */
  customTheme: CustomThemeController
}

/** Plugin-card component props: locale seat + injected face. */
export type SkinCenterComponentProps =
  PropsLocale<'skinCenter'> & SkinCenterInjected

/** The apply target of the official stock-look card. */
const OFFICIAL = 'official'

/**
 * Live-label helper: the shown value follows the in-drag thumb immediately,
 * and falls back to the store value once the store settles (issue #725).
 */
function useLiveValue(value: number): [number, (v: number | null) => void] {
  const [live, setLive] = useState<number | null>(null)
  useEffect(() => {
    setLive(null)
  }, [value])
  return [live ?? value, setLive]
}

/**
 * Render the skin-center card: a static header naming the plugin, with the
 * always-visible skin list (official default + every installed skin; try-on /
 * theme preview / one-click apply) rendered below it.
 * @param props - card props.
 * @returns the plugin card.
 */
export function SkinCenter({ t, runtime, theme, background, wallpaper, preview, customTheme }: SkinCenterComponentProps) {
  const snapshot = useSyncExternalStore((listener) => theme.subscribe(listener), () => theme.getTheme())
  const enabled = useSyncExternalStore(background.subscribe, background.enabled)
  const opacity = useSyncExternalStore(background.subscribe, background.opacity)
  const blurEmpty = useSyncExternalStore(background.subscribe, background.blurEmpty)
  const blurContent = useSyncExternalStore(background.subscribe, background.blurContent)
  const inputCardBlur = useSyncExternalStore(background.subscribe, background.inputCardBlur)
  const bubbleOpacity = useSyncExternalStore(background.subscribe, background.bubbleOpacity)
  const [shownOpacity, setShownOpacity] = useLiveValue(opacity)
  const [shownBlurEmpty, setShownBlurEmpty] = useLiveValue(blurEmpty)
  const [shownBlurContent, setShownBlurContent] = useLiveValue(blurContent)
  const [shownInputCardBlur, setShownInputCardBlur] = useLiveValue(inputCardBlur)
  const [shownBubbleOpacity, setShownBubbleOpacity] = useLiveValue(bubbleOpacity)
  const catalog = useSyncExternalStore(runtime.subscribe, runtime.catalog)
  const state = useSyncExternalStore(runtime.subscribe, runtime.controller.getState)
  const customThemeState = useSyncExternalStore(customTheme.subscribe, customTheme.getState)
  const activeId = state.active
  const previewing = state.previewing
  const tryingId = state.trying
  const activeEntry = activeId === null ? null : runtime.find(activeId)
  const backdropActive = activeEntry?.manifest.contributes.backgroundMedia !== undefined
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unmount guard: once the card is gone, pending async completions must not
  // setState (the controller itself owns the skin state and lives on).
  const mounted = useRef(false)
  // Latest-click-wins token; a newer click invalidates older completions.
  const requestSeq = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const run = (target: string, action: () => Promise<string | null>): void => {
    const seq = ++requestSeq.current
    setError(null)
    setBusyId(target)
    void action()
      .catch(() => {
        if (!mounted.current || seq !== requestSeq.current) return
        setError(t('applyFailed'))
      })
      .finally(() => {
        if (!mounted.current || seq !== requestSeq.current) return
        setBusyId(null)
      })
  }

  const tryOn = (entry: CatalogSkin): void => {
    run(entry.manifest.id, () => preview.runSkin(() => runtime.controller.tryOn(entry.manifest.id, entry)))
  }

  const tryOnOfficial = (): void => {
    run(OFFICIAL, () => preview.runSkin(() => runtime.controller.tryOn(null, null)))
  }

  const exitTryOn = (): void => {
    run(tryingId ?? OFFICIAL, () => preview.runSkin(() => runtime.controller.exitTryOn()))
  }

  const restoreCommittedSkin = async (state: { active: string | null }): Promise<void> => {
    const entry = state.active === null ? null : runtime.find(state.active)
    if (state.active !== null && entry === null) {
      throw new Error(`cannot restore skin ${state.active}`)
    }
    const restored = await runtime.controller.switchTo(state.active, entry)
    if (restored !== state.active) {
      throw new Error(`skin ${state.active ?? 'stock'} did not restore`)
    }
  }

  const switchAndDeactivateCustomTheme = async (
    target: string | null,
    entry: CatalogSkin | null,
  ): Promise<string | null> => {
    const previous = { ...runtime.controller.getState() }
    const active = await runtime.controller.switchTo(target, entry)
    if (active !== target) {
      throw new Error(`${target === null ? 'stock theme' : `skin ${target}`} did not activate`)
    }
    try {
      await customTheme.deactivate()
      return active
    } catch (error) {
      try {
        await restoreCommittedSkin(previous)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'skin switch cleanup and rollback failed')
      }
      throw error
    }
  }

  const restoreOfficialLook = async (): Promise<string | null> => {
    const active = await switchAndDeactivateCustomTheme(null, null)
    if (wallpaper.selection() !== '') wallpaper.clearSelection()
    return active
  }

  /**
   * One-click apply: atomic client-side switch + persisted selection. No
   * reload, no boot-graph wait — the tapIndex adapter makes the next page
   * load boot straight into this skin.
   * @param target - skin id, or `official` for the stock look.
   */
  const applySkin = (target: string): void => {
    if (target === OFFICIAL) {
      run(OFFICIAL, () => preview.runSkin(restoreOfficialLook))
      return
    }
    const entry = runtime.find(target)
    if (entry === null) {
      setError(t('applyFailed'))
      return
    }
    run(target, () => preview.runSkin(async () => {
      const active = await switchAndDeactivateCustomTheme(target, entry)
      if (wallpaper.selection() !== '') wallpaper.clearSelection()
      return active
    }))
  }

  const tryOnCustomTheme = (): void => {
    run('custom-theme', () => preview.runCustomTheme(async () => {
      const active = await runtime.controller.tryOn(null, null)
      if (active !== null) throw new Error('stock preview did not activate')
      customTheme.tryOn()
      return active
    }))
  }

  const exitCustomThemeTryOn = (): void => {
    run('custom-theme', () => preview.runCustomTheme(async () => {
      customTheme.exitTryOn()
      return await runtime.controller.exitTryOn()
    }))
  }

  const applyCustomTheme = (): void => {
    run('custom-theme', () => preview.runCustomTheme(async () => {
      await customTheme.apply()
      const active = await runtime.controller.switchTo(null, null)
      if (active !== null) {
        await customTheme.deactivate()
        throw new Error('stock theme did not activate')
      }
      return active
    }))
  }

  const dark = document.body.hasAttribute('data-ds-dark-theme')

  /** One row: try-on control + apply button. Shared by the official card and every skin card. */
  const actionButtons = (opts: {
    key: string
    isActive: boolean
    isTrying: boolean
    onTryOn: () => void
    applyLabel: string
  }): ReactNode => (
    <div className={css.actions}>
      {opts.isActive && !opts.isTrying ? (
        <button type="button" className={`${css.button} ${css.buttonGhost}`} disabled>
          {t('tryOn')}
        </button>
      ) : opts.isTrying ? (
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={busyId !== null} onClick={exitTryOn}>
          {t('exitTryOn')}
        </button>
      ) : (
        <button
          type="button"
          className={`${css.button} ${css.buttonPrimary}`}
          disabled={busyId !== null}
          onClick={opts.onTryOn}
        >
          {busyId === opts.key ? t('loading') : t('tryOn')}
        </button>
      )}
      <button
        type="button"
        className={css.button}
        disabled={busyId !== null}
        onClick={() => { applySkin(opts.key) }}
      >
        {busyId === opts.key ? t('applying') : opts.applyLabel}
      </button>
    </div>
  )

  return (
    <li className={css.pluginCard}>
      <div className={css.cardHeaderStatic}>
        <span className={css.headText}>
          <span className={css.pluginName}>
            {t('title')}
            <span className={css.titleBadge}>{String(catalog?.length ?? 0)}</span>
          </span>
          <span className={css.cardDescription} title={t('cardDescription')}>{t('cardDescription')}</span>
        </span>
      </div>

      <div className={css.cardBody}>
            <div className={css.enableRow}>
              <span className={css.enableLabel} title={t('enabled')}>{t('enabled')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={t('enabled')}
                className={enabled ? css.switch + ' ' + css.switchOn : css.switch}
                onClick={() => { background.setEnabled(!enabled) }}
              >
                <span className={css.switchThumb} />
              </button>
              <p className={css.enableHint}>{t('enabledHint')}</p>
            </div>
            {enabled
              ? (
                <>
                  <div className={css.head}>
                    <div className={css.intro} title={t('intro')}>{t('intro')}</div>
                    <div className={css.themeRow}>
                      <span className={css.themeLabel}>{t('theme')}</span>
                      <button
                        type="button"
                        className={`${css.themeButton} ${dark ? '' : css.themeButtonActive}`}
                        onClick={() => { theme.setTheme('light') }}
                      >
                        {t('themeLight')}
                      </button>
                      <button
                        type="button"
                        className={`${css.themeButton} ${dark ? css.themeButtonActive : ''}`}
                        onClick={() => { theme.setTheme('dark') }}
                      >
                        {t('themeDark')}
                      </button>
                    </div>
                  </div>

                  <div className={css.backgroundRow}>
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('backgroundOpacity')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{shownOpacity}%</span>
                    </div>
                                        <SliderControl
                      id="skin-center-background-opacity"
                      className={css.backgroundRange}
                      min={0}
                      max={100}
                      step={5}
                      value={opacity}
                      ariaValuetext={shownOpacity + '%'}
                      ariaLabel={t('backgroundOpacity')}
                      onChanging={setShownOpacity}
                      onChange={(value) => { background.set(value) }}
                    />
                    <p className={backdropActive ? css.backgroundHint : css.backgroundHintMuted}>
                      {backdropActive ? t('backgroundHint') : t('backgroundHintInert')}
                    </p>
                  </div>
                  <div className={css.backgroundRow}>
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('backgroundBlurEmpty')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{shownBlurEmpty}px</span>
                    </div>
                                        <SliderControl
                      id="skin-center-background-blur-empty"
                      className={css.backgroundRange}
                      min={0}
                      max={20}
                      step={1}
                      value={blurEmpty}
                      ariaValuetext={shownBlurEmpty + 'px'}
                      ariaLabel={t('backgroundBlurEmpty')}
                      onChanging={setShownBlurEmpty}
                      onChange={(value) => { background.setBlurEmpty(value) }}
                    />
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('backgroundBlurContent')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{shownBlurContent}px</span>
                    </div>
                                        <SliderControl
                      id="skin-center-background-blur-content"
                      className={css.backgroundRange}
                      min={0}
                      max={20}
                      step={1}
                      value={blurContent}
                      ariaValuetext={shownBlurContent + 'px'}
                      ariaLabel={t('backgroundBlurContent')}
                      onChanging={setShownBlurContent}
                      onChange={(value) => { background.setBlurContent(value) }}
                    />
                    <p className={backdropActive ? css.backgroundHint : css.backgroundHintMuted}>
                      {backdropActive ? t('backgroundBlurHint') : t('backgroundBlurInert')}
                    </p>
                  </div>


                  <div className={css.backgroundRow}>
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('inputCardBlur')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{shownInputCardBlur}px</span>
                    </div>
                                        <SliderControl
                      id="skin-center-input-card-blur"
                      className={css.backgroundRange}
                      min={0}
                      max={20}
                      step={1}
                      value={inputCardBlur}
                      ariaValuetext={shownInputCardBlur + 'px'}
                      ariaLabel={t('inputCardBlur')}
                      onChanging={setShownInputCardBlur}
                      onChange={(value) => { background.setInputCardBlur(value) }}
                    />
                    <p className={css.backgroundHint}>{t('inputCardBlurHint')}</p>
                  </div>

                  <div className={css.backgroundRow}>
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('bubbleOpacity')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{shownBubbleOpacity}%</span>
                    </div>
                                        <SliderControl
                      id="skin-center-bubble-opacity"
                      className={css.backgroundRange}
                      min={0}
                      max={100}
                      step={5}
                      value={bubbleOpacity}
                      ariaValuetext={shownBubbleOpacity + '%'}
                      ariaLabel={t('bubbleOpacity')}
                      onChanging={setShownBubbleOpacity}
                      onChange={(value) => { background.setBubbleOpacity(value) }}
                    />
                    <p className={css.backgroundHint}>{t('bubbleOpacityHint')}</p>
                  </div>

                  <WallpaperPanel t={t} wallpaper={wallpaper} />

                  {error !== null && <div className={css.error}>{error}</div>}

                  <div className={css.list}>
                    {(() => {
                      const isActive = activeId === null && !previewing && !customThemeState.applied
                      const isTrying = previewing && tryingId === null && !customThemeState.previewing
                      const badge = isActive ? t('active') : isTrying ? t('tryingOn') : null
                      return (
                        <div className={css.card} key={OFFICIAL}>
                          <div className={css.cardHead}>
                            <span className={css.swatch} style={{ background: '#98a1ab' }} aria-hidden="true" />
                            <span className={css.cardName} title={t('official')}>{t('official')}</span>
                            {badge !== null && (
                              <span className={`${css.badge} ${isActive ? css.badgeActive : css.badgeTrying}`}>
                                {badge}
                              </span>
                            )}
                          </div>
                          <div className={css.cardTagline} title={t('officialTagline')}>{t('officialTagline')}</div>
                          {actionButtons({
                            key: OFFICIAL,
                            isActive,
                            isTrying,
                            onTryOn: tryOnOfficial,
                            applyLabel: t('restore'),
                          })}
                        </div>
                      )
                    })()}

                    {(catalog ?? []).map(entry => {
                      const id = entry.manifest.id
                      const isActive = id === activeId && !previewing
                      const isTrying = previewing && id === tryingId
                      const badge = isActive ? t('active') : isTrying ? t('tryingOn') : null
                      return (
                        <div className={css.card} key={id}>
                          <div className={css.cardHead}>
                            <span
                              className={css.swatch}
                              style={{ background: entry.manifest.accent ?? '#98a1ab' }}
                              aria-hidden="true"
                            />
                            <span className={css.cardName} title={entry.manifest.nameEn}>{entry.manifest.nameEn}</span>
                            {badge !== null && (
                              <span className={`${css.badge} ${isActive ? css.badgeActive : css.badgeTrying}`}>
                                {badge}
                              </span>
                            )}
                          </div>
                          <div className={css.cardTagline} title={entry.manifest.tagline ?? ''}>
                            {entry.manifest.tagline ?? ''}
                          </div>
                          {actionButtons({
                            key: id,
                            isActive,
                            isTrying,
                            onTryOn: () => { tryOn(entry) },
                            applyLabel: t('apply'),
                          })}
                        </div>
                      )
                    })}

                    <CustomThemeCard
                      t={t}
                      customTheme={customTheme}
                      scheme={dark ? 'dark' : 'light'}
                      setScheme={scheme => { theme.setTheme(scheme) }}
                      isActive={customThemeState.applied && activeId === null && !previewing}
                      isTrying={customThemeState.previewing}
                      busy={busyId === 'custom-theme'}
                      disabled={busyId !== null}
                      onTryOn={tryOnCustomTheme}
                      onExitTryOn={exitCustomThemeTryOn}
                      onApply={applyCustomTheme}
                    />
                  </div>
                </>
              )
              : (
                <p className={css.offNote} role="status">{t('offNote')}</p>
              )}
          </div>
    </li>
  )
}

/** Props the settings section binds for the skin-center card page. */
export type SkinCenterSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skinCenter'>
  & SkinCenterInjected

/** Render the skin-center card as a first-level settings page. */
export function SkinCenterSection(props: SkinCenterSectionProps): ReactNode {
  const { t, runtime, theme, background, wallpaper, preview, customTheme } = props
  return (
    <ul className={css.sectionList}>
      <SkinCenter
        t={t}
        runtime={runtime}
        theme={theme}
        background={background}
        wallpaper={wallpaper}
        preview={preview}
        customTheme={customTheme}
      />
    </ul>
  )
}
