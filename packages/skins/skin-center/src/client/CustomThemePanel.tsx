import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import type { CustomThemeController, CustomThemeScheme } from './custom-theme-controller.ts'
import type { CustomThemeProfile } from '../core/custom-theme.ts'
import css from './skin-center.module.css'

type ColorKey = 'accent' | 'background' | 'foreground'

export interface CustomThemeCardProps {
  t: PropsLocale<'skinCenter'>['t']
  customTheme: CustomThemeController
  scheme: CustomThemeScheme
  setScheme(scheme: CustomThemeScheme): void
  isActive: boolean
  isTrying: boolean
  busy: boolean
  disabled: boolean
  onTryOn(): void
  onExitTryOn(): void
  onApply(): void
}

export function CustomThemeCard(props: CustomThemeCardProps): ReactNode {
  const {
    t, customTheme, scheme, setScheme, isActive, isTrying, busy, disabled,
    onTryOn, onExitTryOn, onApply,
  } = props
  const customThemeState = useSyncExternalStore(customTheme.subscribe, customTheme.getState)
  const profile = customTheme.profile(scheme)
  const [expanded, setExpanded] = useState(false)
  const [draftColors, setDraftColors] = useState<Record<ColorKey, string>>({
    accent: profile.accent,
    background: profile.background,
    foreground: profile.foreground,
  })

  useEffect(() => {
    setDraftColors({
      accent: profile.accent,
      background: profile.background,
      foreground: profile.foreground,
    })
  }, [scheme, profile.accent, profile.background, profile.foreground])

  const setDraft = (key: ColorKey, value: string): void => {
    setDraftColors(current => ({ ...current, [key]: value }))
  }
  const commitColor = (key: ColorKey): void => {
    const value = draftColors[key]
    if (/^#[0-9a-f]{6}$/i.test(value)) customTheme.setProfileValue(scheme, key, value)
    else setDraft(key, profile[key])
  }
  const colorField = (key: ColorKey, label: string): ReactNode => {
    const draft = draftColors[key]
    const pickerValue = /^#[0-9a-f]{6}$/i.test(draft) ? draft : profile[key]
    return (
      <label className={css.customThemeField} key={key}>
        <span className={css.customThemeFieldLabel}>{label}</span>
        <span className={css.customThemeInputRow}>
          <input
            className={css.customThemeColor}
            type="color"
            value={pickerValue}
            aria-label={label}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value
              setDraft(key, value)
              customTheme.setProfileValue(scheme, key, value)
            }}
          />
          <input
            className={css.customThemeHex}
            type="text"
            value={draft}
            inputMode="text"
            maxLength={7}
            spellCheck={false}
            aria-label={`${label} hex`}
            disabled={disabled}
            onChange={(event) => { setDraft(key, event.target.value) }}
            onBlur={() => { commitColor(key) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </span>
      </label>
    )
  }

  return (
    <div className={`${css.card} ${css.customThemeCard}`} data-dsh-custom-theme-card="">
      <div className={css.cardHead}>
        <span className={css.swatch} style={{ background: profile.accent }} aria-hidden="true" />
        <span className={css.cardName}>{t('customThemeTitle')}</span>
        {(isActive || isTrying) && (
          <span className={`${css.badge} ${isActive ? css.badgeActive : css.badgeTrying}`}>
            {isActive ? t('active') : t('tryingOn')}
          </span>
        )}
      </div>
      <div className={css.cardTagline}>{t('customThemeTagline')}</div>
      {customThemeState.writeError !== null && (
        <div className={css.error} role="alert">
          {t('customThemeSaveFailed')}
        </div>
      )}
      <div className={css.actions}>
        {isActive && !isTrying ? (
          <button type="button" className={`${css.button} ${css.buttonGhost}`} disabled>{t('tryOn')}</button>
        ) : isTrying ? (
          <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={disabled} onClick={onExitTryOn}>
            {t('exitTryOn')}
          </button>
        ) : (
          <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={disabled} onClick={onTryOn}>
            {busy ? t('loading') : t('tryOn')}
          </button>
        )}
        <button type="button" className={css.button} disabled={disabled} onClick={onApply}>
          {busy ? t('applying') : t('apply')}
        </button>
        <button
          type="button"
          className={css.button}
          aria-expanded={expanded}
          disabled={disabled}
          onClick={() => { setExpanded(value => !value) }}
        >
          {expanded ? t('customThemeCloseEdit') : t('customThemeEdit')}
        </button>
      </div>

      {expanded && (
        <div className={css.customThemeEditor}>
          <div className={css.customThemeScheme} role="group" aria-label={t('customThemeMode')}>
            <span className={css.themeLabel}>{t('customThemeMode')}</span>
            <button
              type="button"
              aria-pressed={scheme === 'light'}
              className={`${css.themeButton} ${scheme === 'light' ? css.themeButtonActive : ''}`}
              disabled={disabled}
              onClick={() => { setScheme('light') }}
            >
              {t('customThemeLight')}
            </button>
            <button
              type="button"
              aria-pressed={scheme === 'dark'}
              className={`${css.themeButton} ${scheme === 'dark' ? css.themeButtonActive : ''}`}
              disabled={disabled}
              onClick={() => { setScheme('dark') }}
            >
              {t('customThemeDark')}
            </button>
          </div>

          <div className={css.customThemeFields}>
            {colorField('accent', t('customThemeAccent'))}
            {colorField('background', t('customThemeBackground'))}
            {colorField('foreground', t('customThemeForeground'))}
          </div>

          <label className={css.customThemeContrast}>
            <span className={css.backgroundHead}>
              <span className={css.customThemeFieldLabel}>{t('customThemeContrast')}</span>
              <span className={css.backgroundValue} aria-hidden="true">{profile.contrast}</span>
            </span>
            <input
              className={css.backgroundRange}
              type="range"
              min="0"
              max="100"
              step="1"
              value={profile.contrast}
              aria-label={t('customThemeContrast')}
              aria-valuetext={String(profile.contrast)}
              disabled={disabled}
              onChange={(event) => { customTheme.setProfileValue(scheme, 'contrast', Number(event.target.value)) }}
            />
          </label>

          <div className={css.customThemeFooter}>
            <span className={css.backgroundHintMuted}>{t('customThemeResetHint')}</span>
            <button type="button" className={css.button} disabled={disabled} onClick={() => { customTheme.reset(scheme) }}>
              {t('customThemeReset')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
