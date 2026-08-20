/**
 * Turn-tail entry: the Edit affordance for the last completed user message
 * and the manual Retry affordance for a failed turn. Registered into the
 * conversation.chat.turnTail chain (rendered before each completed turn's
 * IconActions).
 *
 * The chain selector matches every completed turn (the owner share carries
 * only turn/seq/openFile — a pure selector cannot see the conversation
 * snapshot), so the component gates on the session snapshot itself and
 * returns null wherever nothing applies.
 */
import { memo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { lastCompletedUserTarget } from '../core/transcript.ts'
import { failureOfLastTurn } from '../core/retry-policy.ts'
import type { RetrySupervisor } from '../core/retry-supervisor.ts'
import type { SubmitEditInput } from './wiring.ts'
import styles from './turn-actions.module.css'

/** Business face injected into the slot component by the plugin apply. */
export interface TurnActionsFace {
  supervisor: RetrySupervisor
  submitEdit(input: SubmitEditInput): Promise<void>
  manualRetry(sessionId: SessionId): void
}

export type TurnActionsProps = PropsRuntime<'conversation.chat.turnTail'> & {
  matched: TurnTailOwnerProps
  t: TranslateNS<'chat-recovery'>
} & TurnActionsFace

export const TurnActionsView = memo(function TurnActionsView(props: TurnActionsProps) {
  const { useSession, t, supervisor, submitEdit, manualRetry } = props
  const turn = props.turn.turn
  const sessionId = props.sessionId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = useSession(
    (s) => lastCompletedUserTarget(s),
    (a, b) => a?.seq === b?.seq && a?.turn === b?.turn,
  )
  const failure = useSession(
    (s) => failureOfLastTurn(s),
    (a, b) => a?.turn === b?.turn && a?.kind === b?.kind && a?.message === b?.message && a?.code === b?.code,
  )
  const running = useSession((s) => s.running)
  const retryState = useSyncExternalStore(supervisor.subscribe, supervisor.getSnapshot)

  const canEdit = target !== null && target.turn === turn && !running
  const busy = retryState.phase === 'waiting' || retryState.phase === 'running'
  const canRetry = failure !== null && failure.turn === turn && !running && !busy

  if (!editing && !canEdit && !canRetry) return null

  const startEdit = (): void => {
    if (target === null) return
    setDraft(target.text)
    setError(null)
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    if (target === null || saving || draft.trim() === '') return
    setSaving(true)
    setError(null)
    try {
      await submitEdit({ sessionId, forkAtSeq: target.forkAtSeq, editedText: draft })
      // Success opens the forked child: this session-scoped slot remounts
      // under the child and nothing else needs to happen here.
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (editing) {
    return (
      <div className={styles.editor}>
        <textarea
          className={styles.textarea}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setEditing(false)
              setError(null)
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void save()
            }
          }}
          placeholder={t('edit.button')}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            {t('edit.cancel')}
          </button>
          <button
            type="button"
            className={styles.save}
            disabled={saving || draft.trim() === ''}
            onClick={() => void save()}
          >
            {saving ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
        {error !== null ? <div className={styles.errorText}>{t('edit.failed', { reason: error })}</div> : null}
        <div className={styles.hint}>{t('edit.hint')}</div>
      </div>
    )
  }

  return (
    <div className={styles.row}>
      {canEdit ? (
        <button type="button" className={styles.button} onClick={startEdit}>
          {t('edit.button')}
        </button>
      ) : null}
      {canRetry ? (
        <button
          type="button"
          className={styles.button}
          title={t('retry.forkHint')}
          onClick={() => manualRetry(sessionId)}
        >
          {t('retry.button')}
        </button>
      ) : null}
    </div>
  )
})
