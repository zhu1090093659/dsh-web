import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SkinCenterKey } from './locales.ts'
import type { SkinRuntimeStore } from './runtime/boot.ts'
import type { CustomThemeController } from './custom-theme-controller.ts'
import css from './skin-center.module.css'

type T = (key: SkinCenterKey) => string

export interface CustomThemePanelProps extends PropsLocale<'skinCenter'> {
  runtime: SkinRuntimeStore
  theme: {
    getTheme(): ThemeSnapshot
  }
  customTheme: CustomThemeController
}

/** Standalone custom-theme card; it deliberately uses the existing runtime API. */
export function CustomThemePanel({ t, runtime, theme, customTheme }: CustomThemePanelProps) {
  const custom = useSyncExternalStore(customTheme.subscribe, customTheme.getState)
  const base = useSyncExternalStore(runtime.subscribe, runtime.controller.getState)
  const scheme = custom.scheme
  const profile = custom.profile
  const [editing, setEditing] = useState(false)
  const [draftColors, setDraftColors] = useState<Record<'accent' | 'background' | 'foreground', string>>({
    accent: profile.accent,
    background: profile.background,
    foreground: profile.foreground,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dark = theme.getTheme().active.colorScheme === 'dark'
  const officialBase = base.active === null
  const active = officialBase && !base.previewing && custom.applied
  const trying = officialBase && base.previewing && base.trying === null && custom.previewing

  useEffect(() => {
    setDraftColors({ accent: profile.accent, background: profile.background, foreground: profile.foreground })
  }, [scheme, profile.accent, profile.background, profile.foreground])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await action() } catch { setError(t('applyFailed')) } finally { setBusy(false) }
  }

  const tryCustom = (): void => {
    void run(async () => {
      const result = await runtime.controller.tryOn(null, null)
      if (result !== null) throw new Error('official base preview failed')
      customTheme.tryOn()
    })
  }

  const applyCustom = (): void => {
    void run(async () => {
      const result = await runtime.controller.switchTo(null, null)
      if (result !== null) throw new Error('official base apply failed')
      customTheme.apply()
    })
  }

  const exitCustom = (): void => {
    void run(async () => {
      const result = await runtime.controller.exitTryOn()
      if (result !== null) throw new Error('base try-on exit failed')
      customTheme.exitTryOn()
    })
  }

  const setColor = (key: 'accent' | 'background' | 'foreground', value: string): void => {
    setDraftColors(current => ({ ...current, [key]: value }))
    if (/^#[0-9a-f]{6}$/i.test(value)) customTheme.set(key, value)
  }

  const commitColor = (key: 'accent' | 'background' | 'foreground'): void => {
    const value = draftColors[key]
    if (/^#[0-9a-f]{6}$/i.test(value)) customTheme.set(key, value)
    else setDraftColors(current => ({ ...current, [key]: profile[key] }))
  }

  const colorField = (key: 'accent' | 'background' | 'foreground', label: string) => (
    <label className={css.officialThemeField} key={key}>
      <span>{label}</span>
      <span className={css.officialThemeInputRow}>
        <input
          type="color"
          value={draftColors[key]}
          aria-label={label}
          onChange={(event) => { setColor(key, event.target.value) }}
        />
        <input
          type="text"
          value={draftColors[key]}
          aria-label={`${label} hex`}
          onChange={(event) => { setColor(key, event.target.value) }}
          onInput={(event) => { setColor(key, event.currentTarget.value) }}
          onBlur={() => { commitColor(key) }}
        />
      </span>
    </label>
  )

  return (
    <div className={css.card} data-custom-theme-card="true">
      <div className={css.cardHead}>
        <span className={css.swatch} style={{ background: profile.accent }} aria-hidden="true" />
        <span className={css.cardName}>{t('customTheme')}</span>
        {active && <span className={`${css.badge} ${css.badgeActive}`}>{t('active')}</span>}
        {trying && <span className={`${css.badge} ${css.badgeTrying}`}>{t('tryingOn')}</span>}
      </div>
      <div className={css.cardTagline}>{t('customThemeTagline')}</div>
      <div className={css.actions}>
        {trying ? (
          <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={busy} onClick={exitCustom}>
            {t('exitTryOn')}
          </button>
        ) : (
          <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={busy} onClick={tryCustom}>
            {t('tryOn')}
          </button>
        )}
        <button type="button" className={css.button} disabled={busy || active} onClick={applyCustom}>
          {t('apply')}
        </button>
        <button type="button" className={`${css.button} ${css.buttonGhost}`} onClick={() => { setEditing(value => !value) }}>
          {editing ? t('closeThemeEditor') : t('editTheme')}
        </button>
      </div>
      {editing && (
        <div className={css.customThemeEditor} data-custom-theme-editor="true">
          <div className={css.themeRow} role="tablist" aria-label={t('theme')}>
            <span className={css.themeLabel}>{t('theme')}</span>
            <button type="button" role="tab" aria-selected={scheme === 'light'} className={`${css.themeButton} ${scheme === 'light' ? css.themeButtonActive : ''}`} onClick={() => { customTheme.setScheme('light') }}>
              {t('customThemeLight')}
            </button>
            <button type="button" role="tab" aria-selected={scheme === 'dark'} className={`${css.themeButton} ${scheme === 'dark' ? css.themeButtonActive : ''}`} onClick={() => { customTheme.setScheme('dark') }}>
              {t('customThemeDark')}
            </button>
          </div>
          <div className={css.officialThemeGrid}>
            {colorField('accent', t('customThemeAccent'))}
            {colorField('background', t('customThemeBackground'))}
            {colorField('foreground', t('customThemeForeground'))}
          </div>
          <div className={css.backgroundHead}>
            <span className={css.backgroundLabel}>{t('customThemeContrast')}</span>
            <span className={css.backgroundValue}>{profile.contrast}</span>
          </div>
          <input
            className={css.backgroundRange}
            type="range"
            min="0"
            max="100"
            step="1"
            value={profile.contrast}
            aria-label={t('customThemeContrast')}
            onChange={(event) => { customTheme.set('contrast', Number(event.target.value)) }}
          />
          <button type="button" className={`${css.button} ${css.buttonGhost}`} onClick={() => { customTheme.resetCurrent() }}>
            {t('customThemeReset')}
          </button>
          <p className={css.backgroundHint}>{dark ? t('customThemeDark') : t('customThemeLight')}</p>
        </div>
      )}
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}
