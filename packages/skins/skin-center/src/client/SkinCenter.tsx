/**
 * The skin-center plugin card: one disclosure card inside the Web UI plugin
 * group (插件配置 → Web UI 插件), listing every installed skin plus the
 * official stock look. Live try-on executes the real bundle inside the GUI
 * (light/dark preview, full restore on exit); Apply is one click — the host
 * half runs `dsh-skin use` through /api/skin-center/apply, the config
 * watcher hot-reloads the patch, and the page reloads into the new skin.
 * Copy rides the standard `t` seat; the theme preview control drives the
 * official theme service (persisted, same as the Appearance row).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from './generated/skins.ts'
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

/** Plugin-card component props: group-item runtime share + locale seat + injected face. */
export type SkinCenterComponentProps =
  PropsRuntime<'web-ui.plugin.item'> & PropsLocale<'skinCenter'> & SkinCenterInjected

/** The apply target of the official stock-look card. */
const OFFICIAL = 'official'

/** Skin ids that read the background-scrim variable and paint a backdrop. */
const BACKDROP_SKIN_IDS = new Set(['blue-fantasy', 'whale-song'])

/**
 * Render the skin-center card: a disclosure header naming the plugin, with
 * the skin list (official default + every installed skin; try-on / theme
 * preview / one-click apply) inside its body.
 * @param props - card props.
 * @returns the plugin card.
 */
export function SkinCenter({ t, controller, theme, background }: SkinCenterComponentProps) {
  const snapshot = useSyncExternalStore(theme.subscribe, theme.getTheme)
  const opacity = useSyncExternalStore(background.subscribe, background.opacity)
  const activePackage = activeSkinEntry()?.package
  const activeId = activeSkinEntry()?.id
  const backdropActive = activeId !== undefined && BACKDROP_SKIN_IDS.has(activeId)
  const [open, setOpen] = useState(false)
  const [tryingId, setTryingId] = useState<string | null>(null)
  const [tryingOfficial, setTryingOfficial] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tryOn = (entry: SkinCenterEntry): void => {
    setError(null)
    void controller.tryOn(entry)
      .then(() => {
        setTryingId(entry.id)
        setTryingOfficial(false)
      })
      .catch(() => {
        // The controller may have torn down a previous session before the
        // load failed; reset both flags so no stale "trying on" lingers.
        setError(t('tryOnError'))
        setTryingId(null)
        setTryingOfficial(false)
      })
  }

  const tryOnOfficial = (): void => {
    setError(null)
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
    controller.exit()
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
        tries += 1
        void fetch('/api/skin-center/state')
          .then(async response => {
            const payload = await response.json().catch(() => null) as { ok?: boolean; active?: string } | null
            if (response.ok && payload?.ok === true && payload.active === expected) {
              resolve(true)
              return
            }
            if (tries >= 20) resolve(false)
            else window.setTimeout(tick, 250)
          })
          .catch(() => {
            if (tries >= 20) resolve(false)
            else window.setTimeout(tick, 250)
          })
      }
      tick()
    })

  /**
   * One-click apply: the host half runs `dsh-skin use <target>` (or
   * `use official`), the config watcher hot-reloads the patch within
   * seconds, then this page reloads to pick up the new boot graph.
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
        // active, so the page never boots into the old skin.
        void confirmActive(target).then(confirmed => {
          if (confirmed) {
            window.location.reload()
          } else {
            const command = target === OFFICIAL ? 'dsh-skin use official' : `dsh-skin use ${target}`
            setError(`${t('appliedUnconfirmed')} — ${command}`)
          }
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
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} onClick={opts.onTryOn}>
          {t('tryOn')}
        </button>
      )}
      <button
        type="button"
        className={css.button}
        disabled={applying !== null}
        onClick={() => { applySkin(opts.key) }}
      >
        {applying === opts.key ? t('applying') : opts.applyLabel}
      </button>
    </div>
  )

  return (
    <li className={css.pluginCard}>
      <button
        type="button"
        className={css.cardHeader}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className={css.headText}>
          <span className={css.pluginName}>
            {t('title')}
            <span className={css.titleBadge}>{String(SKIN_CENTER_ENTRIES.length)}</span>
          </span>
          <span className={css.cardDescription} title={t('cardDescription')}>{t('cardDescription')}</span>
        </span>
        <span className={open ? css.chevronOpen : css.chevron}>▾</span>
      </button>

      {open
        ? (
          <div className={css.cardBody}>
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
          </div>
        )
        : null}
    </li>
  )
}
