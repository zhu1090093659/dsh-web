/**
 * Native-image section of the describe-image card (rc.8 feature): reports
 * the current agent-default route's image-input state and toggles the
 * DeepSeek adapter catalog entry through the loopback host route. The
 * section is self-contained (its own fetch state) — it never rides the card
 * form, so a toggle settles immediately while the rest of the card keeps its
 * staged drafts. Unsupported hosts and failed writes render a hint; nothing
 * here throws.
 * @module @linxin666/dsh-tool-describe-image/client/NativeImageSection
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchNativeImageState, setNativeImageEnabled, type NativeImageClientState } from './native-images.ts'
import { t } from './locales.ts'
import cardCss from './settings-card.module.css'
import css from './probe.module.css'

/** The section's lifecycle phases. */
type Phase = 'loading' | 'ready' | 'failed'

/**
 * Render the native-image request section.
 * @returns the section block.
 */
export function NativeImageSection() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<NativeImageClientState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback((): void => {
    let alive = true
    setPhase('loading')
    setError(undefined)
    void fetchNativeImageState().then((value) => {
      if (!alive) return
      setState(value)
      setPhase(value === null ? 'failed' : 'ready')
    })
    const cancel = (): void => { alive = false }
    cancel
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = useCallback((): void => {
    if (busy || state === null) return
    setBusy(true)
    setError(undefined)
    void setNativeImageEnabled(!state.capability.acceptsImages).then((result) => {
      setBusy(false)
      if (result.ok && result.value !== undefined) {
        setState(result.value)
        setPhase('ready')
        return
      }
      setError(result.message ?? 'failed')
    })
  }, [busy, state])

  const enabled = state?.capability.acceptsImages === true
  const canToggle = phase === 'ready' && state !== null && state.supported && state.model !== undefined && !busy

  return (
    <div className={cardCss.field}>
      <div className={cardCss.head}>
        <label className={cardCss.label} htmlFor="settings-describe-image-native-images">{t('native.title')}</label>
        <button
          type="button"
          id="settings-describe-image-native-images"
          className={css.probeInline}
          disabled={!canToggle}
          onClick={toggle}
        >
          {busy ? t('native.busy') : enabled ? t('native.disable') : t('native.enable')}
        </button>
      </div>
      {phase === 'loading'
        ? <p className={cardCss.hint}>{t('native.loading')}</p>
        : null}
      {phase === 'ready' && state !== null
        ? (
          <p className={cardCss.hint}>
            {state.model === undefined
              ? t('native.unknownModel')
              : state.supported
                ? enabled
                  ? t('native.enabled', { model: state.model })
                  : t('native.disabled', { model: state.model })
                : t('native.unsupported')}
          </p>
        )
        : null}
      {phase === 'failed'
        ? <p className={cardCss.hint}>{t('native.unsupported')}</p>
        : null}
      {error !== undefined
        ? <p className={css.probeError} role="status">{t('native.failed', { error })}</p>
        : null}
    </div>
  )
}
