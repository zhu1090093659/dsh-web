/**
 * Unpaired-desktop notice: a full-page blocking surface rendered when the remote channel
 * (see remote-channel.ts) refuses a call because this desktop browser has no
 * live paired-device cookie. Retires automatically once a gated call
 * succeeds (the channel reports pairing) or when the channel itself is
 * torn down (requirePairingForLan off / plugin disabled), so it never
 * outlives the unpaired state it describes.
 */
import { useState, type FormEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { acceptPair } from './pair-api.ts'
import css from './remote.module.css'

/** Notice props: localized copy. */
export interface FenceNoticeProps {
  t: TranslateNS<'remote'>
  /** Retry after the user has opened a freshly issued computer pairing link. */
  onRetry: () => void
  /** Optional custom pairing acceptor for testing / dependency injection. */
  onAccept?: (token: string) => Promise<{ ok: true } | { ok: false; code: 'invalid' | 'used' | 'forbidden' }>
}

/**
 * Extract a pairing token from either a raw token string or a copied pairing link URL.
 */
export function extractPairToken(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined
  try {
    const url = new URL(trimmed)
    const token = url.searchParams.get('pair')
    if (token !== null && token !== '') return token
  } catch {
    // Plain token string
  }
  return trimmed
}

/**
 * Render the unpaired blocking page.
 * @param props - localized copy.
 * @returns the notice element.
 */
export function FenceNotice({ t, onRetry, onAccept = acceptPair }: FenceNoticeProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const token = extractPairToken(tokenInput)
    if (!token) return

    setSubmitting(true)
    setErrorMsg(undefined)

    try {
      const result = await onAccept(token)
      if (result.ok) {
        onRetry()
        return
      }
      if (result.code === 'invalid') {
        setErrorMsg(t('fence.unpaired.tokenInvalid'))
      } else {
        setErrorMsg(t('fence.unpaired.tokenFailed'))
      }
    } catch {
      setErrorMsg(t('fence.unpaired.tokenFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={css.fencePage} role="dialog" aria-modal="true" aria-labelledby="remote-fence-title">
      <main className={css.fenceCard} data-dsh-plugin="remote-web-ui">
        <div className={css.fenceMark} aria-hidden="true">×</div>
        <p className={css.fenceEyebrow}>{t('fence.unpaired.eyebrow')}</p>
        <h1 id="remote-fence-title" className={css.fenceTitle}>{t('fence.unpaired.title')}</h1>
        <p className={css.fenceDetail}>{t('fence.unpaired.hint')}</p>
        <ol className={css.fenceSteps}>
          <li>{t('fence.unpaired.stepDesktop')}</li>
          <li>{t('fence.unpaired.stepLink')}</li>
          <li>{t('fence.unpaired.stepOpen')}</li>
        </ol>

        <form className={css.fenceForm} onSubmit={handleSubmit}>
          <div className={css.fenceInputRow}>
            <input
              type="text"
              className={css.fenceInput}
              placeholder={t('fence.unpaired.tokenPlaceholder')}
              value={tokenInput}
              onChange={event => {
                setTokenInput(event.target.value)
                if (errorMsg !== undefined) setErrorMsg(undefined)
              }}
              disabled={submitting}
              aria-label={t('fence.unpaired.tokenPlaceholder')}
            />
            <button
              className={css.fencePairButton}
              type="submit"
              disabled={submitting || tokenInput.trim() === ''}
            >
              {submitting ? t('fence.unpaired.pairing') : t('fence.unpaired.pairAction')}
            </button>
          </div>
          {errorMsg !== undefined && (
            <p className={css.fenceError} role="alert">{errorMsg}</p>
          )}
        </form>

        <button className={css.fenceRetry} type="button" onClick={onRetry}>
          {t('fence.unpaired.retry')}
        </button>
        <p className={css.fenceFootnote}>{t('fence.unpaired.footnote')}</p>
      </main>
    </div>
  )
}
