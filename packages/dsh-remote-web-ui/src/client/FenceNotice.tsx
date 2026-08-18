/**
 * Unpaired-desktop notice: a fixed banner rendered when the remote channel
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
}

/**
 * Render the unpaired banner.
 * @param props - localized copy.
 * @returns the notice element.
 */
export function FenceNotice({ t }: FenceNoticeProps) {
  return (
    <div className={css.notice} role="alert">
      <p className={css.noticeTitle}>{t('fence.unpaired.title')}</p>
      <p className={css.noticeDetail}>{t('fence.unpaired.hint')}</p>
    </div>
  )
}
