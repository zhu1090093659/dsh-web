/**
 * Composer dock entry: the retry status row (current attempt count, wait
 * state, final failure reason, cancel / retry-now controls). Registered into
 * conversation.input.dock — the full-width row above the composer card.
 */
import { memo } from 'react'
import { useSyncExternalStore } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RetrySupervisor } from '../core/retry-supervisor.ts'
import styles from './retry-dock.module.css'

/** Business face injected into the slot component by the plugin apply. */
export interface RetryDockFace {
  supervisor: RetrySupervisor
  manualRetry(sessionId: SessionId): void
}

export type RetryDockProps = PropsRuntime<'conversation.input.dock'> & {
  t: TranslateNS<'chat-recovery'>
} & RetryDockFace

export const RetryDockView = memo(function RetryDockView(props: RetryDockProps) {
  const { session, t, supervisor, manualRetry } = props
  const state = useSyncExternalStore(supervisor.subscribe, supervisor.getSnapshot)
  const sessionId = session.sessionId

  const visible =
    (state.phase === 'waiting' && state.sourceId === sessionId) ||
    (state.phase === 'running' && state.targetId === sessionId) ||
    ((state.phase === 'failed' || state.phase === 'exhausted') && state.sourceId === sessionId)
  if (!visible) return null

  const cancelButton = (
    <button type="button" className={styles.button} onClick={() => supervisor.cancel()}>
      {t('retry.cancel')}
    </button>
  )

  if (state.phase === 'waiting') {
    const label = state.kind === 'manual'
      ? t('retry.manualRunning')
      : t('retry.waiting', {
        attempt: String(state.attempt),
        max: String(state.maxAttempts),
        seconds: String(Math.max(1, Math.round((state.delayMs ?? 0) / 1000))),
      })
    return (
      <div className={styles.dock}>
        <div className={styles.row}>
          <span>{label}</span>
          <span className={styles.buttons}>
            {state.kind === 'auto' ? (
              <button type="button" className={styles.button} onClick={() => supervisor.retryNow()}>
                {t('retry.retryNow')}
              </button>
            ) : null}
            {cancelButton}
          </span>
        </div>
        <span className={styles.hint}>{t('retry.forkHint')}</span>
      </div>
    )
  }

  if (state.phase === 'running') {
    const label = state.kind === 'manual'
      ? t('retry.manualRunning')
      : t('retry.running', { attempt: String(state.attempt), max: String(state.maxAttempts) })
    return (
      <div className={styles.dock}>
        <div className={styles.row}>
          <span>{label}</span>
          <span className={styles.buttons}>{cancelButton}</span>
        </div>
        <span className={styles.hint}>{t('retry.forkHint')}</span>
      </div>
    )
  }

  // failed / exhausted: the final failure reason plus a manual retry escape hatch.
  const reason = state.reason ?? ''
  const label = state.phase === 'exhausted'
    ? t('retry.exhausted', { max: String(state.maxAttempts), reason })
    : t('retry.failed', { reason })
  return (
    <div className={styles.dock}>
      <div className={styles.row}>
        <span className={styles.error}>{label}</span>
        <span className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => manualRetry(sessionId)}>
            {t('retry.manualRetry')}
          </button>
        </span>
      </div>
      <span className={styles.hint}>{t('retry.forkHint')}</span>
    </div>
  )
})
