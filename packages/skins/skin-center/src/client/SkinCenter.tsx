/**
 * The skin-center card: rendered as the content of a first-level settings
 * section, listing every installed skin plus the official stock look. Live
 * try-on executes the real bundle inside the GUI (light/dark preview, full
 * restore on exit); Apply is one click — the host half runs `dsh-skin use`
 * through /api/skin-center/apply, the config watcher hot-reloads the patch,
 * and the page reloads into the new skin. Copy rides the standard `t` seat;
 * the theme preview control drives the official theme service (persisted,
 * same as the Appearance row).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from './generated/skins.ts'
import { manifestHasSkin } from './manifest.ts'
import type { SkinBackgroundHandle } from './background.ts'
import { activeSkinEntry, TryOnController } from './try-on.ts'
import css from './skin-center.module.css'

/** Business face the skin-center apply() injects into the card. */
export interface SkinCenterInjected {
  controller: TryOnController
  theme: {
    getTheme(): ThemeSnapshot
    subscribe(listener: () => void): () => void
    setTheme(id: 'light' | 'dark'): void
  }
  /** Background occluder over the shared skin-background namespace. */
  background: SkinBackgroundHandle
}

/** Plugin-card component props: locale seat + injected face. */
export type SkinCenterComponentProps =
  PropsLocale<'skinCenter'> & SkinCenterInjected

/** The apply target of the official stock-look card. */
const OFFICIAL = 'official'

/** Skin ids that read the background-scrim variable and paint a backdrop. */
const BACKDROP_SKIN_IDS = new Set(['blue-fantasy', 'whale-song'])

/**
 * Render the skin-center card: a static header naming the plugin, with the
 * always-visible skin list (official default + every installed skin; try-on /
 * theme preview / one-click apply) rendered below it.
 * @param props - card props.
 * @returns the plugin card.
 */
export function SkinCenter({ t, controller, theme, background }: SkinCenterComponentProps) {
  const snapshot = useSyncExternalStore(theme.subscribe, theme.getTheme)
  const enabled = useSyncExternalStore(background.subscribe, background.enabled)
  const opacity = useSyncExternalStore(background.subscribe, background.opacity)
  const blurEmpty = useSyncExternalStore(background.subscribe, background.blurEmpty)
  const blurContent = useSyncExternalStore(background.subscribe, background.blurContent)
  const activePackage = activeSkinEntry()?.package
  const activeId = activeSkinEntry()?.id
  const backdropActive = activeId !== undefined && BACKDROP_SKIN_IDS.has(activeId)
  const [tryingId, setTryingId] = useState<string | null>(null)
  const [tryingOfficial, setTryingOfficial] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unmount guard for the confirmation poll: once the card is gone, the
  // pending timers must stop and no reload / setState may fire.
  const mounted = useRef(false)
  // Latest-click-wins token for async bundle loads. A chained try-on or exit
  // invalidates older completions so a slow bundle can never overwrite the
  // UI state chosen by a newer click.
  const tryOnRequest = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const tryOn = (entry: SkinCenterEntry): void => {
    if (loadingId === entry.id) return
    const request = ++tryOnRequest.current
    setError(null)
    setLoadingId(entry.id)
    void controller.tryOn(entry)
      .then(mountedTarget => {
        if (!mounted.current || request !== tryOnRequest.current || !mountedTarget) return
        setLoadingId(null)
        setTryingId(entry.id)
        setTryingOfficial(false)
      })
      .catch(() => {
        if (!mounted.current || request !== tryOnRequest.current) return
        // A load failure keeps the previous preview mounted; a mount failure
        // restores the original active skin. Mirror the controller's actual
        // session instead of blindly clearing a preview that may still exist.
        setLoadingId(null)
        setError(t('tryOnError'))
        setTryingId(controller.trying?.id ?? null)
        setTryingOfficial(controller.tryingOfficial)
      })
  }

  const tryOnOfficial = (): void => {
    ++tryOnRequest.current
    setError(null)
    setLoadingId(null)
    try {
      controller.tryOnOfficial()
    } catch {
      setError(t('tryOnError'))
      setTryingOfficial(false)
      return
    }
    setTryingId(null)
    setTryingOfficial(true)
  }

  const exitTryOn = (): void => {
    ++tryOnRequest.current
    controller.exit()
    setLoadingId(null)
    setTryingId(null)
    setTryingOfficial(false)
  }

  /**
   * Poll the host state until the config watcher reports the target active
   * (the patch write lands before the watcher re-applies it), or time out.
   * @param target - skin id, or `official` for the stock look.
   * @returns whether the target became active within the poll budget.
   */
  const confirmActive = (target: string): Promise<boolean> =>
    new Promise(resolve => {
      const expected = target === OFFICIAL ? 'none' : target
      let tries = 0
      const tick = (): void => {
        if (!mounted.current) {
          resolve(false)
          return
        }
        tries += 1
        void fetch('/api/skin-center/state')
          .then(async response => {
            const payload = await response.json().catch(() => null) as { ok?: boolean; active?: string } | null
            if (response.ok && payload?.ok === true && payload.active === expected) {
              resolve(true)
              return
            }
            if (tries >= 20 || !mounted.current) resolve(false)
            else window.setTimeout(tick, 250)
          })
          .catch(() => {
            if (tries >= 20 || !mounted.current) resolve(false)
            else window.setTimeout(tick, 250)
          })
      }
      tick()
    })

  /**
   * Poll the served GUI document until the boot manifest actually enables
   * the target (the config watcher regenerates it asynchronously after the
   * patch write — reloading earlier boots the page into the previous skin),
   * or time out.
   * @param target - skin id, or `official` for the stock look.
   * @returns whether the manifest caught up within the poll budget.
   */
  const manifestReady = (target: string): Promise<boolean> =>
    new Promise(resolve => {
      const expected = target === OFFICIAL ? null : target
      let tries = 0
      const tick = (): void => {
        if (!mounted.current) {
          resolve(false)
          return
        }
        tries += 1
        void fetch(window.location.href, { cache: 'no-store' })
          .then(async response => {
            const html = await response.text().catch(() => null)
            if (html !== null && manifestHasSkin(html, expected)) {
              resolve(true)
              return
            }
            if (tries >= 40 || !mounted.current) resolve(false)
            else window.setTimeout(tick, 500)
          })
          .catch(() => {
            if (tries >= 40 || !mounted.current) resolve(false)
            else window.setTimeout(tick, 500)
          })
      }
      tick()
    })

  /**
   * One-click apply: the host half runs `dsh-skin use <target>` (or
   * `use official`), the config watcher hot-reloads the patch within
   * seconds, then this page reloads to pick up the new boot graph. The
   * reload waits for both the patch (state poll) and the regenerated boot
   * manifest (manifest poll) so the page never boots into the old skin.
   * @param target - skin id, or `official` for the stock look.
   */
  const applySkin = (target: string): void => {
    setError(null)
    setApplying(target)
    const body = target === OFFICIAL ? { official: true } : { skin: target }
    void fetch('/api/skin-center/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async response => {
        const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`)
        }
        setApplying(null)
        // Patch written; reload only once the watcher reports the target
        // active AND the boot manifest caught up, so the page never boots
        // into the old skin.
        void confirmActive(target).then(confirmed => {
          if (!mounted.current) return
          if (!confirmed) {
            const command = target === OFFICIAL ? 'dsh-skin use official' : `dsh-skin use ${target}`
            setError(`${t('appliedUnconfirmed')} — ${command}`)
            return
          }
          void manifestReady(target).then(ready => {
            if (!mounted.current) return
            if (ready) {
              window.location.reload()
            } else {
              const command = target === OFFICIAL ? 'dsh-skin use official' : `dsh-skin use ${target}`
              setError(`${t('appliedUnconfirmed')} — ${command}`)
            }
          })
        })
      })
      .catch((cause: unknown) => {
        setApplying(null)
        const detail = cause instanceof Error ? cause.message : String(cause)
        const command = target === OFFICIAL ? 'dsh-skin use official' : `dsh-skin use ${target}`
        setError(`${t('applyFailed')} (${detail}) — ${command}`)
      })
  }

  const dark = snapshot.active.colorScheme === 'dark'

  /** One row: try-on control + apply button. Shared by the official card and every skin card. */
  const actionButtons = (opts: {
    key: string
    isActive: boolean
    isTrying: boolean
    onTryOn: () => void
    applyLabel: string
  }): ReactNode => (
    <div className={css.actions}>
      {opts.isActive ? (
        <button type="button" className={`${css.button} ${css.buttonGhost}`} disabled>
          {t('tryOn')}
        </button>
      ) : opts.isTrying ? (
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} onClick={exitTryOn}>
          {t('exitTryOn')}
        </button>
      ) : (
        <button
          type="button"
          className={`${css.button} ${css.buttonPrimary}`}
          disabled={loadingId === opts.key}
          onClick={opts.onTryOn}
        >
          {loadingId === opts.key ? t('loading') : t('tryOn')}
        </button>
      )}
      <button
        type="button"
        className={css.button}
        disabled={applying !== null || loadingId !== null}
        onClick={() => { applySkin(opts.key) }}
      >
        {applying === opts.key ? t('applying') : opts.applyLabel}
      </button>
    </div>
  )

  return (
    <li className={css.pluginCard}>
      <div className={css.cardHeaderStatic}>
        <span className={css.headText}>
          <span className={css.pluginName}>
            {t('title')}
            <span className={css.titleBadge}>{String(SKIN_CENTER_ENTRIES.length)}</span>
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
                      <span className={css.backgroundValue} aria-hidden="true">{opacity}%</span>
                    </div>
                    <input
                      id="skin-center-background-opacity"
                      className={css.backgroundRange}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacity}
                      aria-valuetext={`${opacity}%`}
                      aria-label={t('backgroundOpacity')}
                      onChange={(event) => { background.set(Number(event.target.value)) }}
                    />
                    <p className={backdropActive ? css.backgroundHint : css.backgroundHintMuted}>
                      {backdropActive ? t('backgroundHint') : t('backgroundHintInert')}
                    </p>
                  </div>
                  <div className={css.backgroundRow}>
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('backgroundBlurEmpty')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{blurEmpty}px</span>
                    </div>
                    <input
                      id="skin-center-background-blur-empty"
                      className={css.backgroundRange}
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={blurEmpty}
                      aria-valuetext={`${blurEmpty}px`}
                      aria-label={t('backgroundBlurEmpty')}
                      onChange={(event) => { background.setBlurEmpty(Number(event.target.value)) }}
                    />
                    <div className={css.backgroundHead}>
                      <span className={css.backgroundLabel}>{t('backgroundBlurContent')}</span>
                      <span className={css.backgroundValue} aria-hidden="true">{blurContent}px</span>
                    </div>
                    <input
                      id="skin-center-background-blur-content"
                      className={css.backgroundRange}
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={blurContent}
                      aria-valuetext={`${blurContent}px`}
                      aria-label={t('backgroundBlurContent')}
                      onChange={(event) => { background.setBlurContent(Number(event.target.value)) }}
                    />
                    <p className={backdropActive ? css.backgroundHint : css.backgroundHintMuted}>
                      {backdropActive ? t('backgroundBlurHint') : t('backgroundBlurInert')}
                    </p>
                  </div>


                  {error !== null && <div className={css.error}>{error}</div>}

                  <div className={css.list}>
                    {(() => {
                      const isActive = activePackage === undefined
                      const isTrying = tryingOfficial
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

                    {SKIN_CENTER_ENTRIES.map(entry => {
                      const isActive = entry.package === activePackage
                      const isTrying = entry.id === tryingId
                      const badge = isActive ? t('active') : isTrying ? t('tryingOn') : null
                      return (
                        <div className={css.card} key={entry.id}>
                          <div className={css.cardHead}>
                            <span className={css.swatch} style={{ background: entry.accent }} aria-hidden="true" />
                            <span className={css.cardName} title={entry.nameEn}>{entry.nameEn}</span>
                            {badge !== null && (
                              <span className={`${css.badge} ${isActive ? css.badgeActive : css.badgeTrying}`}>
                                {badge}
                              </span>
                            )}
                          </div>
                          <div className={css.cardTagline} title={entry.tagline}>{entry.tagline}</div>
                          {actionButtons({
                            key: entry.id,
                            isActive,
                            isTrying,
                            onTryOn: () => { tryOn(entry) },
                            applyLabel: t('apply'),
                          })}
                        </div>
                      )
                    })}
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
  const { t, controller, theme, background } = props
  return (
    <ul className={css.sectionList}>
      <SkinCenter t={t} controller={controller} theme={theme} background={background} />
    </ul>
  )
}
