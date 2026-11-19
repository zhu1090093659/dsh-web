/**
 * The task-detail seat: what this card runs on, where it is, and what it said.
 *
 * The section is built out of three facts the card already holds and one
 * channel it reads: the ledger payload carries the pinned target and the run
 * records, the published summary carries the host list and the log increments,
 * and every write leaves through the board's `dispatch` — the section owns no
 * HTTP surface and no board internal.
 *
 * An untargeted card shows the form and nothing else: there is no run state to
 * report and no log to read, so showing either would be decoration.
 *
 * @module dsh-task-board-ssh/client/ssh/detail-section
 */
import { useEffect, useRef, useState } from 'react'
import { SSH_EXTENSION_ID } from '../../core/action.ts'
import type { TaskBoardExtensionActionRequest } from '../../core/contract.ts'
import type { SshAgentKind, SshTarget } from '../../core/target.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import type { SshDetailSectionProps } from '../seat-props.ts'
import { SshLogBuffer } from './log-buffer.ts'
import { SshLogView } from './log-view.tsx'
import { draftOf, isSshRunActive, sshCardView, targetSummaryParts } from './model.ts'
import { useHostHalfStatus, usePublishedSummary } from './summary.ts'
import { SshTargetForm } from './target-form.tsx'
import css from '../ssh.module.css'

/** Short plugin name the semantic attributes carry. */
const PLUGIN_ATTR = 'task-board-ssh'

/** Copy key naming one run phase; the pill and the badge read the same table. */
function phaseKey(phase: ReturnType<typeof sshCardView>['phase']): TaskBoardSshKey {
  return `run.${phase}`
}

/** Display name of one agent CLI. */
function agentLabel(kind: SshAgentKind): string {
  return t(`detail.agent.${kind}`)
}

/** One sentence from whatever was thrown, for the section's error line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the SSH provider's task-detail section.
 * @param props - the card and the board's action channel.
 * @returns the section in the shape the card's payload asks for.
 */
export function SshDetailSection({ task, dispatch }: SshDetailSectionProps) {
  const view = sshCardView(task)
  const summary = usePublishedSummary()
  const hostHalf = useHostHalfStatus()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [sending, setSending] = useState(false)
  const [queued, setQueued] = useState<number | undefined>()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const buffer = useRef<SshLogBuffer | undefined>(undefined)
  if (buffer.current === undefined) buffer.current = new SshLogBuffer()
  const [version, setVersion] = useState(0)

  const targeted = view.target !== undefined
  const active = isSshRunActive(view.phase)
  const pending = summary?.logs?.[task.id]

  // One write path for every control: the board's action channel, with a
  // refusal (a thrown channel error or a refused commit) surfacing as a line
  // the reader can act on instead of a silent no-op.
  const send = async (request: TaskBoardExtensionActionRequest): Promise<boolean> => {
    setError(undefined)
    try {
      const accepted = await dispatch(request)
      if (!accepted) setError(t('detail.rejected'))
      return accepted
    } catch (cause) {
      setError(t('detail.actionFailed', { error: messageOf(cause) }))
      return false
    }
  }

  // Opening the panel replays the run's log from its first byte: the buffer is
  // this panel's, and the provider re-reads the remote file from zero on this
  // request. A different run (or a different card) starts a different log.
  useEffect(() => {
    const current = buffer.current
    if (current === undefined) return
    current.reset(view.runId)
    setVersion(previous => previous + 1)
    if (!targeted) return
    void dispatch({
      extensionId: SSH_EXTENSION_ID,
      action: 'refresh',
      taskId: task.id,
      ...(view.runId === undefined ? {} : { payload: { runId: view.runId } }),
    }).catch(() => {})
  }, [task.id, view.runId, targeted])

  // The provider publishes log increments; the buffer decides whether one is
  // new, so a mirror frame that changed nothing on this card costs nothing.
  useEffect(() => {
    const current = buffer.current
    if (current === undefined || pending === undefined) return
    if (current.append(pending)) setVersion(previous => previous + 1)
  }, [pending])

  // A queued follow-up leaves the "sent after this turn" state the moment the
  // run accounts for it, or when the run it was queued behind ends.
  const delivered = view.activeRun?.followUps ?? 0
  useEffect(() => {
    if (queued === undefined) return
    if (delivered > queued || view.phase !== 'running') setQueued(undefined)
  }, [queued, delivered, view.phase])

  const saveTarget = async (target: SshTarget): Promise<void> => {
    setSaving(true)
    const accepted = await send({
      extensionId: SSH_EXTENSION_ID,
      action: 'set-target',
      taskId: task.id,
      payload: { target: target as unknown as Record<string, unknown> },
    })
    setSaving(false)
    if (accepted) setEditing(false)
  }

  const cancelRun = async (): Promise<void> => {
    setCancelling(true)
    await send({ extensionId: SSH_EXTENSION_ID, action: 'cancel', taskId: task.id })
    setCancelling(false)
  }

  const submitFollowUp = async (): Promise<void> => {
    if (text.trim() === '') return
    setSending(true)
    const accepted = await send({
      extensionId: SSH_EXTENSION_ID,
      action: 'follow-up',
      taskId: task.id,
      payload: { text },
    })
    setSending(false)
    if (!accepted) return
    setText('')
    if (view.phase === 'running') setQueued(delivered)
  }

  // A deployment that ships dsh-ssh disabled never mounts this provider's host
  // half, so no summary can ever arrive and every control below would write into
  // a surface nothing serves. The section says what to enable instead.
  if (hostHalf === 'unmounted') {
    return (
      <section className={css.section} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="unmounted">
        <p className={css.meta}>{t('detail.hostHalfMissing')}</p>
      </section>
    )
  }

  if (!targeted) {
    return (
      <section className={css.section} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="target">
        <h4 className={css.sectionTitle}>{t('detail.setTarget')}</h4>
        <SshTargetForm
          initial={draftOf(undefined, summary?.defaults)}
          hosts={summary?.hosts ?? []}
          saving={saving}
          submitLabel={saving ? t('detail.saving') : t('detail.save')}
          onSubmit={target => { void saveTarget(target) }}
        />
        {error !== undefined && <p className={css.formError} role="alert">{error}</p>}
      </section>
    )
  }

  const target = view.target as SshTarget
  const parts = targetSummaryParts(target)
  const lastRun = view.lastRun
  // What the run left behind in the workspace it came back from; the provider
  // publishes a count only when there was something to report.
  const untracked = summary?.runs?.find(run => run.taskId === task.id)?.untrackedFiles ?? 0
  return (
    <section className={css.section} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="run">
      <div className={css.head}>
        <h4 className={css.sectionTitle}>{t('detail.target')}</h4>
        <span className={css.statePill} data-run={view.phase}>{t(phaseKey(view.phase))}</span>
        <button type="button" className={css.linkButton} onClick={() => setEditing(current => !current)}>
          {t(editing ? 'detail.cancelEdit' : 'detail.editTarget')}
        </button>
      </div>
      {!editing && (
        <p className={css.targetLine} title={parts.workspace}>
          {t('detail.targetSummary', { host: parts.host, agent: agentLabel(parts.agent), workspace: parts.workspace })}
        </p>
      )}

      {editing && (
        <SshTargetForm
          initial={draftOf(target, summary?.defaults)}
          hosts={summary?.hosts ?? []}
          unknownHost={(summary?.hosts ?? []).some(host => host.alias === target.host) ? undefined : target.host}
          saving={saving}
          submitLabel={saving ? t('detail.saving') : t('detail.save')}
          onCancel={() => setEditing(false)}
          onSubmit={next => { void saveTarget(next) }}
        />
      )}

      {lastRun?.error !== undefined && <p className={css.formError}>{lastRun.error}</p>}
      {lastRun?.branch !== undefined && <p className={css.meta}>{t('detail.branch', { branch: lastRun.branch })}</p>}
      {untracked > 0 && <p className={css.meta}>{t('detail.untrackedFiles', { count: String(untracked) })}</p>}
      {lastRun?.summary !== undefined && lastRun.summary !== '' && (
        <p className={css.summary} title={lastRun.summary}>{lastRun.summary}</p>
      )}

      <SshLogView
        buffer={buffer.current as SshLogBuffer}
        version={version}
        live={view.phase === 'running'}
        labels={{
          empty: t('detail.logEmpty'),
          truncated: t('detail.logTruncated'),
          latest: t('detail.logLatest'),
          name: t('detail.log'),
        }}
      />

      <div className={css.actions}>
        <textarea
          className={css.followUp}
          aria-label={t('detail.followUp')}
          placeholder={t('detail.followUpPlaceholder')}
          rows={2}
          value={text}
          disabled={sending}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submitFollowUp()
            }
          }}
        />
        <div className={css.actionRow}>
          {queued !== undefined && <span className={css.queuedChip}>{t('detail.followUpQueued')}</span>}
          {active && (
            <button type="button" className={css.ghostButton} onClick={() => { void cancelRun() }} disabled={cancelling}>
              {t(cancelling ? 'detail.cancelling' : 'detail.cancel')}
            </button>
          )}
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => { void submitFollowUp() }}
            disabled={sending || text.trim() === ''}
          >
            {t('detail.followUpSend')}
          </button>
        </div>
        {error !== undefined && <p className={css.formError} role="alert">{error}</p>}
      </div>
    </section>
  )
}
