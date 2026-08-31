/**
 * Task detail: the full view of one task — content, prompt, execution
 * history — and the only place execution can be triggered. Also offers
 * delete (with confirmation), manual status moves, and a jump to the
 * execution's session transcript.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { isValidCron } from '../../core/schedule.ts'
import { MANUAL_STATUSES, TASK_PERMISSIONS, type ExecutionRecord, type TaskPermission, type TaskRecord } from '../../core/tasks.ts'
import { canEditTaskContent } from '../../core/use-cases/task-update.ts'
import { requiresPermissionConfirmation } from '../../core/handover.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { SCHEDULE_PRESETS } from '../schedule-presets.ts'
import css from '../board.module.css'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { EditTaskModal } from './EditTaskModal.tsx'
import { formatHostTimestamp, formatTime } from './TaskCard.tsx'
import { STATUS_KEY } from './status-key.ts'

/** Execution outcome → locale key. */
const RESULT_KEY: Record<NonNullable<ExecutionRecord['result']>, TaskBoardKey> = {
  succeeded: 'detail.result.succeeded',
  failed: 'detail.result.failed',
  cancelled: 'detail.result.cancelled',
}

/** One execution-history row. */
function ExecutionRow({ execution, timeZone, onOpen }: { execution: ExecutionRecord; timeZone?: string; onOpen: (sessionId: string) => void }) {
  const result = execution.result
  return (
    <li className={css.executionRow} data-result={result}>
      <span className={css.executionBadge} data-result={result}>
        {result === undefined ? t('detail.result.running') : t(RESULT_KEY[result])}
      </span>
      <span className={css.executionTimes}>
        {t('detail.executionStarted')} {formatTime(execution.startedAt, timeZone)}
        {execution.endedAt !== undefined && ` · ${t('detail.executionEnded')} ${formatTime(execution.endedAt, timeZone)}`}
      </span>
      {execution.initiatedBy !== undefined && (
        <span className={css.executionTimes} title={execution.initiatedBy}>
          {t('detail.execution.initiator', { session: execution.initiatedBy })}
        </span>
      )}
      {execution.sessionId !== undefined && (
        <button
          type="button"
          className={css.linkButton}
          onClick={() => { onOpen(execution.sessionId as string) }}
          title={execution.sessionId}
        >
          {t('detail.viewSession')} ⌁
        </button>
      )}
      {execution.error !== undefined && execution.error !== '' && (
        <span className={css.executionError}>{execution.error}</span>
      )}
    </li>
  )
}

/** The execution-target editor: workspace / mode / permission pickers. */
function ExecutionSettingsSection({ controller, task, pending }: { controller: BoardController; task: TaskRecord; pending: boolean }) {
  const [options, setOptions] = useState(controller.getSnapshot().executionOptions)
  useEffect(
    () => controller.subscribe(() => setOptions(controller.getSnapshot().executionOptions)),
    [controller],
  )
  const workspaceId = task.workspaceId ?? ''
  const mode = task.mode ?? ''
  const permission = task.permission ?? ''
  // A pinned target may disappear from the runtime (workspace deleted,
  // preset removed); keep it selectable as a stale row instead of silently
  // dropping it, so the user sees exactly what the task will ask for.
  const workspaceKnown = workspaceId === '' || options.workspaces.some(item => item.workspaceId === workspaceId)
  const modeKnown = mode === '' || options.presets.some(item => item.id === mode)
  return (
    <section className={css.detailSection}>
      <h4>{t('detail.executionSettings')}</h4>
      <p className={css.detailText}>{t('exec.hint')}</p>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.workspace')}</span>
        <select
          className={css.select}
          value={workspaceId}
          disabled={pending}
          onChange={event => { controller.updateTask(task.id, { workspaceId: event.target.value }) }}
        >
          <option value="">{t('exec.workspace.recent')}</option>
          {!workspaceKnown && <option value={workspaceId}>{workspaceId}{t('exec.mode.removed')}</option>}
          {options.workspaces.map(workspace => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.mode')}</span>
        <select
          className={css.select}
          value={mode}
          disabled={pending}
          onChange={event => { controller.updateTask(task.id, { mode: event.target.value }) }}
        >
          <option value="">{t('exec.mode.default')}</option>
          {!modeKnown && <option value={mode}>{mode}{t('exec.mode.removed')}</option>}
          {options.presets.map(preset => (
            <option key={preset.id} value={preset.id} disabled={preset.broken !== undefined}>
              {preset.name ?? preset.id}
              {preset.isDefault ? t('exec.mode.defaultSuffix') : ''}
              {preset.broken !== undefined ? t('exec.mode.brokenSuffix') : ''}
            </option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.permission')}</span>
        <select
          className={css.select}
          value={permission}
          disabled={pending}
          onChange={event => { controller.updateTask(task.id, { permission: event.target.value === '' ? undefined : event.target.value as TaskPermission }) }}
        >
          <option value="">{t('exec.permission.default')}</option>
          {TASK_PERMISSIONS.map(id => (
            <option key={id} value={id}>{t(`exec.permission.${id}` as TaskBoardKey)}</option>
          ))}
        </select>
      </label>
    </section>
  )
}

/** The scheduled-runs editor: enable toggle, cron input + presets, next-run info. */
function ScheduleSection({ controller, task, pending }: { controller: BoardController; task: TaskRecord; pending: boolean }) {
  const schedule = task.schedule
  const [cron, setCron] = useState(schedule?.cron ?? '0 9 * * *')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false)
  const [nextRunAt, setNextRunAt] = useState<number | undefined>(schedule?.nextRunAt)
  const [lastTriggeredAt, setLastTriggeredAt] = useState<number | undefined>(schedule?.lastTriggeredAt)
  const [error, setError] = useState<string | undefined>(undefined)
  const timeZone = controller.getSnapshot().host?.scheduler.timeZone

  // Keep the editor in sync when the task record changes underneath (the
  // schedule rolls forward as runs trigger).
  useEffect(() => {
    setCron(schedule?.cron ?? '0 9 * * *')
    setEnabled(schedule?.enabled ?? false)
    setNextRunAt(schedule?.nextRunAt)
    setLastTriggeredAt(schedule?.lastTriggeredAt)
    setError(undefined)
  }, [task.id, schedule?.enabled, schedule?.cron, schedule?.nextRunAt, schedule?.lastTriggeredAt])

  /** Validate + persist the current cron text (Enter or blur). */
  const saveCron = (value: string): void => {
    const trimmed = value.trim()
    setCron(trimmed)
    if (trimmed === '' || !isValidCron(trimmed)) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    controller.setSchedule(task.id, { cron: trimmed })
  }

  /** Arm/disarm the schedule (arming first persists the edited cron). */
  const toggleEnabled = (next: boolean): void => {
    const trimmed = cron.trim()
    if (next && (trimmed === '' || !isValidCron(trimmed))) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    const submitted = controller.setSchedule(task.id, {
      enabled: next,
      ...(next && trimmed !== schedule?.cron ? { cron: trimmed } : {}),
    })
    if (submitted && !controller.isHostBacked()) setEnabled(next)
  }

  const applyPreset = (preset: string): void => {
    if (preset === '') return
    setCron(preset)
    setError(undefined)
    controller.setSchedule(task.id, { cron: preset })
  }

  const nextLabel = !enabled || nextRunAt === undefined
    ? t('detail.schedule.notScheduled')
    : nextRunAt <= Date.now()
      ? t('detail.schedule.dueSoon')
      : formatHostTimestamp(nextRunAt, timeZone)
  const lastLabel = lastTriggeredAt === undefined ? '—' : formatHostTimestamp(lastTriggeredAt, timeZone)

  return (
    <section className={css.detailSection}>
      <h4>{t('detail.schedule')}</h4>
      <label className={css.scheduleToggle}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={event => { toggleEnabled(event.target.checked) }}
        />
        <span>{t('detail.schedule.enable')}</span>
      </label>
      <div className={css.scheduleRow}>
        <input
          className={`${css.input} ${css.scheduleInput}${error !== undefined ? ` ${css.scheduleInputInvalid}` : ''}`}
          value={cron}
          disabled={pending}
          placeholder="0 9 * * *"
          spellCheck={false}
          aria-label={t('detail.schedule.cron')}
          onChange={event => { setCron(event.target.value); setError(undefined) }}
          onBlur={() => { saveCron(cron) }}
          onKeyDown={event => { if (event.key === 'Enter') saveCron(cron) }}
        />
        <select
          className={css.schedulePreset}
          value=""
          disabled={pending}
          aria-label={t('detail.schedule.presets')}
          onChange={event => { applyPreset(event.target.value) }}
        >
          <option value="">{t('detail.schedule.presets')}…</option>
          {SCHEDULE_PRESETS.map(preset => (
            <option key={preset.cron} value={preset.cron}>{t(preset.label)}</option>
          ))}
        </select>
      </div>
      {error !== undefined && <p className={css.formError}>{error}</p>}
      <p className={css.scheduleMeta}>
        {t('detail.schedule.nextRun')} {nextLabel}
        {' · '}{t('detail.schedule.lastTriggered')} {lastLabel}
      </p>
    </section>
  )
}

/** Task detail overlay. */
export function TaskDetail({ controller, task }: { controller: BoardController; task: TaskRecord }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  // Keep the overlay in sync if the task record changes underneath.
  const [latest, setLatest] = useState(task)
  useEffect(() => { setLatest(task) }, [task])
  // A re-used overlay instance must not carry an edit session across tasks.
  useEffect(() => { setShowEdit(false) }, [task.id])
  const current = latest
  const snapshot = controller.getSnapshot()
  const running = current.status === 'running'
  const archived = current.archivedAt !== undefined
  const pending = snapshot.pendingTaskIds.includes(current.id)
  const transportError = snapshot.transportError
  const timeZone = snapshot.host?.scheduler.timeZone
  const permissionPending = requiresPermissionConfirmation(current, snapshot.host?.sessionDefaultPermission)

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) controller.closeTask() }}>
      <div className={css.detail} role="dialog" aria-label={t('detail.title')}>
        <header className={css.detailHeader}>
          <h2 className={css.detailTitle}>{current.title}</h2>
          <span className={css.statusBadge} data-status={archived ? 'archived' : current.status}>
            {archived ? t('board.archive') : t(STATUS_KEY[current.status])}
          </span>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('detail.close')}
            onClick={() => { controller.closeTask() }}
          >
            ×
          </button>
        </header>

        <div className={css.detailBody}>
          {transportError !== undefined && (
            <div className={css.formError}>
              {t('board.hostError', { error: transportError })}{' '}
              <button type="button" className={css.linkButton} onClick={() => { void controller.retryHostSync() }}>
                {t('board.retryHost')}
              </button>
            </div>
          )}
          <section className={css.detailSection}>
            <h4>{t('detail.description')}</h4>
            <p className={css.detailText}>{current.description !== '' ? current.description : '—'}</p>
          </section>

          {current.freeze !== undefined && (
            <section className={css.detailSection} data-dsh-part="freeze">
              <h4>{t('detail.freeze')}</h4>
              {current.freeze.redacted === true && <p className={css.formError}>{t('detail.freeze.redacted')}</p>}
              <p className={css.detailText}><strong>{t('detail.freeze.goal')}</strong></p>
              <pre className={css.promptBlock}>{current.freeze.goal}</pre>
              <p className={css.detailText}><strong>{t('detail.freeze.progress')}</strong></p>
              <pre className={css.promptBlock}>{current.freeze.progress}</pre>
              <p className={css.detailText}><strong>{t('detail.freeze.next')}</strong></p>
              <pre className={css.promptBlock}>{current.freeze.next}</pre>
              <p className={css.detailMeta}>{t('detail.freeze.frozenAt', { time: formatHostTimestamp(current.freeze.frozenAt, timeZone) })}</p>
              {current.freeze.frozenBy !== undefined && (
                <p className={css.detailMeta}>{t('detail.freeze.frozenBy', { session: current.freeze.frozenBy })}</p>
              )}
            </section>
          )}

          {current.handover !== undefined && (
            <section className={css.detailSection} data-dsh-part="handover">
              <h4>{t('detail.handover')}</h4>
              <p className={css.detailText}>
                {t('new.workspace')}: {current.handover.workspaceId ?? t('exec.workspace.recent')}
                {' · '}{t('new.mode')}: {current.handover.mode ?? t('exec.mode.default')}
                {' · '}{t('new.permission')}: {current.handover.permission === undefined ? t('exec.permission.default') : t(`exec.permission.${current.handover.permission}` as TaskBoardKey)}
              </p>
              <p className={css.detailText}><strong>{t('detail.handover.references')}</strong></p>
              <ul className={css.executionList}>
                {current.handover.references.map(reference => (
                  <li key={reference} className={css.executionRow}><code>{reference}</code></li>
                ))}
              </ul>
              <p className={css.detailMeta}>{t('detail.handover.bundledAt', { time: formatHostTimestamp(current.handover.bundledAt, timeZone) })}</p>
            </section>
          )}

          {permissionPending && (
            <section className={css.detailSection} data-dsh-part="permission-gate">
              <p className={css.formError}>{t('detail.permissionPending', { permission: t(`exec.permission.${current.handover?.permission ?? current.permission}` as TaskBoardKey) })}</p>
              <button type="button" className={css.primaryButton} disabled={pending} onClick={() => { void controller.confirmPermission(current.id) }}>
                {t('detail.permissionConfirm')}
              </button>
            </section>
          )}
          {current.permissionConfirmedAt !== undefined && (
            <p className={css.detailMeta}>{t('detail.permissionConfirmed', { time: formatHostTimestamp(current.permissionConfirmedAt, timeZone) })}</p>
          )}

          <section className={css.detailSection}>
            <h4>{t('detail.prompt')}</h4>
            <pre className={css.promptBlock}>{current.prompt !== '' ? current.prompt : current.title}</pre>
          </section>

          {!archived && (
            <>
              <ExecutionSettingsSection controller={controller} task={current} pending={pending} />
              <ScheduleSection controller={controller} task={current} pending={pending} />
            </>
          )}

          <section className={css.detailSection}>
            <h4>{t('detail.execution')}</h4>
            {current.executions.length === 0 ? (
              <p className={css.detailText}>{t('detail.noExecution')}</p>
            ) : (
              <ul className={css.executionList}>
                {[...current.executions].reverse().map(execution => (
                  <ExecutionRow
                    key={execution.id}
                    execution={execution}
                    timeZone={timeZone}
                    onOpen={sessionId => { controller.openSession(sessionId) }}
                  />
                ))}
              </ul>
            )}
          </section>

          {!archived && (
            <section className={css.detailSection}>
              <h4>{t('board.status')}</h4>
              <div className={css.moveRow}>
                {MANUAL_STATUSES.map(status => (
                  <button
                    key={status}
                    type="button"
                    className={css.ghostButton}
                    disabled={current.status === status || running || pending}
                    onClick={() => { controller.moveTask(current.id, status) }}
                  >
                    {t(`status.move.${status}` as TaskBoardKey)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className={css.detailFooter}>
          {!archived && pending && <span className={css.detailMeta}>{t('board.pending')}…</span>}
          {!archived && canEditTaskContent(current) && (
            <button
              type="button"
              className={css.ghostButton}
              disabled={pending}
              onClick={() => { setShowEdit(true) }}
            >
              {t('detail.edit')}
            </button>
          )}
          {!archived && (
            <button
              type="button"
              className={css.primaryButton}
              disabled={running || pending}
              onClick={() => {
                void controller.rerunTask(current.id).then(() => {
                  if (controller.getSnapshot().transportError === undefined) controller.closeTask()
                })
              }}
            >
              {current.executions.length === 0 ? t('detail.run') : t('detail.rerun')}
            </button>
          )}
          {archived ? (
            <button
              type="button"
              className={css.primaryButton}
              disabled={pending}
              onClick={() => {
                controller.restoreTask(current.id)
              }}
            >
              {t('detail.restore')}
            </button>
          ) : (
            (current.status === 'done' || current.status === 'failed') && (
              <button
                type="button"
                className={css.ghostButton}
                disabled={pending}
                onClick={() => {
                  controller.archiveTask(current.id)
                }}
              >
                {t('detail.archive')}
              </button>
            )
          )}
          <button
            type="button"
            className={css.dangerButton}
            disabled={pending}
            onClick={() => { setConfirmDelete(true) }}
          >
            {t('detail.delete')}
          </button>
          <span className={css.detailMeta}>
            {t('board.created')} {formatTime(current.createdAt, timeZone)}
            {archived && ` · ${t('detail.archivedAt', { time: formatTime(current.archivedAt!, timeZone) })}`}
          </span>
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.confirm', { name: current.title })}
          confirmLabel={t('delete.ok')}
          danger
          onCancel={() => { setConfirmDelete(false) }}
          onConfirm={() => {
            setConfirmDelete(false)
            controller.deleteTask(current.id)
          }}
        />
      )}

      {showEdit && !archived && canEditTaskContent(current) && (
        <EditTaskModal controller={controller} task={current} onClose={() => { setShowEdit(false) }} />
      )}
    </div>
  )
}
