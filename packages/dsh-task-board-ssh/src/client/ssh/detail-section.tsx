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
import { getLastBoardError, useHostHalfStatus, usePublishedSummary } from './summary.ts'
import { SshTargetForm } from './target-form.tsx'
import css from '../ssh.module.css'

/** Short plugin name the semantic attributes carry. */
const PLUGIN_ATTR = 'task-board-ssh'

/** Upper bound for auto-paging settled remote logs into the detail viewer, in bytes. */
const AUTO_PAGE_MAX_BYTES = 512 * 1024

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
  const [queuedLocal, setQueuedLocal] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const buffer = useRef<SshLogBuffer | undefined>(undefined)
  if (buffer.current === undefined) buffer.current = new SshLogBuffer()
  const [version, setVersion] = useState(0)
  const awaitingReplay = useRef(false)
  const lastRequestedOffset = useRef(0)

  const targeted = view.target !== undefined
  const isProxy = view.target?.mode === 'proxy'
  const archived = task.archivedAt !== undefined
  const active = !isProxy && isSshRunActive(view.phase)
  const pending = summary?.logs?.[task.id]

  // Reset per-card ephemeral state whenever the reused TaskDetail panel
  // switches to another card, preventing cross-card form/draft/error bleed.
  useEffect(() => {
    setEditing(false)
    setSaving(false)
    setCancelling(false)
    setSending(false)
    setQueuedLocal(false)
    setText('')
    setError(undefined)
  }, [task.id])

  // Close target edit form automatically if a run becomes active or archived.
  useEffect(() => {
    if (active || archived) setEditing(false)
  }, [active, archived])

  // One write path for every control: the board's action channel, with a
  // refusal (a thrown channel error or a refused commit) surfacing as a line
  // the reader can act on instead of a silent no-op.
  const send = async (request: TaskBoardExtensionActionRequest): Promise<boolean> => {
    setError(undefined)
    try {
      const accepted = await dispatch(request)
      if (!accepted) {
        const hostReason = getLastBoardError()
        setError(hostReason !== undefined && hostReason !== '' ? t('detail.actionFailed', { error: hostReason }) : t('detail.rejected'))
      }
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
    lastRequestedOffset.current = 0
    awaitingReplay.current = targeted && !isProxy && view.runId !== undefined
    setVersion(previous => previous + 1)
    if (!targeted || isProxy) return
    void dispatch({
      extensionId: SSH_EXTENSION_ID,
      action: 'refresh',
      taskId: task.id,
      ...(view.runId === undefined ? {} : { payload: { runId: view.runId } }),
    }).catch(() => {})
  }, [task.id, view.runId, targeted, isProxy])

  // The provider publishes log increments; ignore stale pre-replay frames with
  // a non-zero offset until the byte-0 replay lands, and auto-page remaining
  // windows of settled >8 KiB logs via `refresh({ runId, offset })`.
  useEffect(() => {
    const current = buffer.current
    if (current === undefined || pending === undefined || isProxy) return
    if (view.runId !== undefined && pending.runId !== view.runId) return
    if (awaitingReplay.current) {
      if (pending.baseOffset > 0) return
      awaitingReplay.current = false
    }
    if (current.append(pending)) setVersion(previous => previous + 1)
    if (
      pending.hasMore === true
      && !active
      && view.runId !== undefined
      && pending.endOffset > lastRequestedOffset.current
      && pending.endOffset < AUTO_PAGE_MAX_BYTES
    ) {
      lastRequestedOffset.current = pending.endOffset
      void dispatch({
        extensionId: SSH_EXTENSION_ID,
        action: 'refresh',
        taskId: task.id,
        payload: { runId: view.runId, offset: pending.endOffset },
      }).catch(() => {})
    }
  }, [pending, isProxy, active, task.id, view.runId, dispatch])

  // Clear local optimistic queued chip when the run is no longer active or the
  // ledger itself now owns the pending state.
  useEffect(() => {
    if (!active || view.pending !== undefined) setQueuedLocal(false)
  }, [active, view.pending])

  const hasQueuedFollowUp = view.pending !== undefined || (queuedLocal && active)

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
    if (active) setQueuedLocal(true)
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
    if (archived) return null
    return (
      <section className={css.section} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="target">
        <h4 className={css.sectionTitle}>{t('detail.setTarget')}</h4>
        <SshTargetForm
          key={task.id}
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
  const canEditTarget = !active && !archived
  // Only offer follow-ups on direct cards that are active or have already run
  // (sending a follow-up on a never-run idle card would overwrite the card's
  // initial prompt on first launch).
  const canFollowUp = !isProxy && !archived && (active || lastRun !== undefined)
  // What the run left behind in the workspace it came back from; the provider
  // publishes a count only when there was something to report.
  const untracked = summary?.runs?.find(run => run.taskId === task.id)?.untrackedFiles ?? 0
  return (
    <section className={css.section} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="run">
      <div className={css.head}>
        <h4 className={css.sectionTitle}>{t('detail.target')}</h4>
        {!isProxy && (
          <span className={css.statePill} data-run={view.phase}>{t(phaseKey(view.phase))}</span>
        )}
        {canEditTarget && (
          <button type="button" className={css.linkButton} onClick={() => setEditing(current => !current)}>
            {t(editing ? 'detail.cancelEdit' : 'detail.editTarget')}
          </button>
        )}
      </div>
      {!editing && (
        <p className={css.targetLine} title={parts.workspace}>
          {t('detail.targetSummary', {
            host: parts.host,
            agent: isProxy ? t('detail.mode.proxy') : agentLabel(parts.agent),
            workspace: parts.workspace,
          })}
        </p>
      )}
      {!editing && isProxy && <p className={css.meta}>{t('detail.modeHintProxy')}</p>}

      {editing && canEditTarget && (
        <SshTargetForm
          key={`${task.id}:edit`}
          initial={draftOf(target, summary?.defaults)}
          hosts={summary?.hosts ?? []}
          unknownHost={(summary?.hosts ?? []).some(host => host.alias === target.host) ? undefined : target.host}
          saving={saving}
          submitLabel={saving ? t('detail.saving') : t('detail.save')}
          onCancel={() => setEditing(false)}
          onSubmit={next => { void saveTarget(next) }}
        />
      )}

      {!isProxy && !active && lastRun?.error !== undefined && <p className={css.formError}>{lastRun.error}</p>}
      {!isProxy && lastRun?.branch !== undefined && <p className={css.meta}>{t('detail.branch', { branch: lastRun.branch })}</p>}
      {!isProxy && untracked > 0 && <p className={css.meta}>{t('detail.untrackedFiles', { count: String(untracked) })}</p>}
      {!isProxy && !active && lastRun?.summary !== undefined && lastRun.summary !== '' && (
        <p className={css.summary} title={lastRun.summary}>{lastRun.summary}</p>
      )}

      {!isProxy && (
        <SshLogView
          buffer={buffer.current as SshLogBuffer}
          version={version}
          live={view.phase === 'running'}
          resetKey={`${task.id}:${view.runId ?? ''}`}
          labels={{
            empty: t('detail.logEmpty'),
            truncated: t('detail.logTruncated'),
            latest: t('detail.logLatest'),
            name: t('detail.log'),
          }}
        />
      )}

      {(canFollowUp || (!isProxy && active && !archived)) && (
        <div className={css.actions}>
          {canFollowUp && (
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
          )}
          <div className={css.actionRow}>
            {hasQueuedFollowUp && <span className={css.queuedChip}>{t('detail.followUpQueued')}</span>}
            {active && !archived && (
              <button type="button" className={css.ghostButton} onClick={() => { void cancelRun() }} disabled={cancelling}>
                {t(cancelling ? 'detail.cancelling' : 'detail.cancel')}
              </button>
            )}
            {canFollowUp && (
              <button
                type="button"
                className={css.primaryButton}
                onClick={() => { void submitFollowUp() }}
                disabled={sending || text.trim() === ''}
              >
                {t('detail.followUpSend')}
              </button>
            )}
          </div>
          {error !== undefined && <p className={css.formError} role="alert">{error}</p>}
        </div>
      )}
      {!canFollowUp && !(active && !archived) && error !== undefined && (
        <p className={css.formError} role="alert">{error}</p>
      )}
    </section>
  )
}
