/**
 * Unpaired-desktop notice: a full-page blocking surface rendered when the remote channel
 * (see remote-channel.ts) refuses a call because this desktop browser has no
 * live paired-device cookie. Retires automatically once a gated call
 * succeeds (the channel reports pairing), so it never outlives the
 * unpaired state it describes.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './remote.module.css'

/** Notice props: localized copy. */
export interface FenceNoticeProps {
  t: TranslateNS<'remote'>
  /** Retry after the user has opened a freshly issued computer pairing link. */
  onRetry: () => void
}

/**
 * Render the unpaired blocking page.
 * @param props - localized copy.
 * @returns the notice element.
 */
export function FenceNotice({ t, onRetry }: FenceNoticeProps) {
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
        <button className={css.fenceRetry} type="button" onClick={onRetry}>
          {t('fence.unpaired.retry')}
        </button>
        <p className={css.fenceFootnote}>{t('fence.unpaired.footnote')}</p>
      </main>
    </div>
  )
}
