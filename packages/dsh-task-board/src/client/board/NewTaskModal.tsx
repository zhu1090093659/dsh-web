/**
 * New-task modal: title + description + the prompt that execution will send.
 * Creates through the Host and closes only after the Host confirms it.
 */
import { useEffect, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { isValidCron, nextRunAtMs } from '../../core/schedule.ts'
import { parseFreezeRequest } from '../../core/freeze-snapshot.ts'
import { collectKnownTags, TASK_PERMISSIONS, type TaskPermission, type TaskRecord, type TaskTag } from '../../core/tasks.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { SCHEDULE_PRESETS } from '../schedule-presets.ts'
import { ModalShell, TaskContentFields, TaskTagFields, cleanTags } from './TaskForm.tsx'
import { readParseModelPreference, writeParseModelPreference } from './parse-model-pref.ts'
import css from '../board.module.css'

export interface NewTaskModalProps {
  controller: BoardController
  onClose: () => void
  /** Optional task template to clone/duplicate from. */
  initialTask?: TaskRecord
  /**
   * Workspace the board's project filter has selected (#1536): a task created
   * while a project is open belongs to that project unless the user changes it.
   */
  defaultWorkspaceId?: string
  /** Optional callback after successful duplication (e.g. to archive source). */
  onDuplicateSuccess?: (sourceTaskId: string) => Promise<void>
}

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose, initialTask, defaultWorkspaceId, onDuplicateSuccess }: NewTaskModalProps) {
  const isDuplicate = initialTask !== undefined
  const [title, setTitle] = useState(initialTask?.title ?? '')
  const [description, setDescription] = useState(initialTask?.description ?? '')
  const [prompt, setPrompt] = useState(initialTask?.prompt ?? '')
  const [workspaceId, setWorkspaceId] = useState(initialTask?.workspaceId ?? defaultWorkspaceId ?? '')
  const [mode, setMode] = useState(initialTask?.mode ?? '')
  const [permission, setPermission] = useState(initialTask?.permission ?? '')
  const [model, setModel] = useState(initialTask?.model ?? '')
  const [reuseSession, setReuseSession] = useState(initialTask?.reuseSession ?? false)
  const [scheduleEnabled, setScheduleEnabled] = useState(initialTask?.schedule?.enabled ?? false)
  const [scheduleCron, setScheduleCron] = useState(initialTask?.schedule?.cron ?? '')
  const [scheduleError, setScheduleError] = useState<string | undefined>(undefined)
  const [freezeText, setFreezeText] = useState('')
  const [freezeError, setFreezeError] = useState<string | undefined>(undefined)
  const [handoverText, setHandoverText] = useState(
    initialTask?.handover?.references !== undefined ? initialTask.handover.references.join('\n') : '',
  )
  const [tags, setTags] = useState<TaskTag[]>(initialTask?.tags ?? [])
  const [archiveOriginal, setArchiveOriginal] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [options, setOptions] = useState(controller.getSnapshot().executionOptions)
  // "Parse pasted text" (issue #1540) exists only when the deployment carries a
  // parse face; the section stays hidden otherwise.
  const [canParse] = useState(controller.getSnapshot().canParseTask === true)
  const [parseText, setParseText] = useState('')
  // Issue #1621: start from the model this browser used last, not from the
  // roster's first entry; '' is the Host default and stays valid.
  const [parseModel, setParseModel] = useState(() => readParseModelPreference())
  const [parsePending, setParsePending] = useState(false)
  const [parseError, setParseError] = useState<string | undefined>(undefined)
  const parseAbort = useRef<AbortController | undefined>(undefined)
  const parseModels = options.models ?? []

  // The workspace list and preset roster arrive from the runtime after mount;
  // follow them so the pickers never freeze on an empty snapshot.
  useEffect(
    () => controller.subscribe(() => setOptions(controller.getSnapshot().executionOptions)),
    [controller],
  )

  // The model roster arrives asynchronously. A remembered model the deployment
  // no longer offers falls back to the Host default; an empty value is the
  // Host-default choice and is never overwritten by the roster (issue #1621).
  useEffect(() => {
    if (parseModel === '' || parseModels.length === 0) return
    if (parseModels.some(option => option.id === parseModel)) return
    setParseModel('')
    writeParseModelPreference('')
  }, [parseModel, options.models])

  const runParse = async (): Promise<void> => {
    const text = parseText.trim()
    if (text === '') {
      setParseError(t('new.aiParseEmpty'))
      return
    }
    const abort = new AbortController()
    parseAbort.current = abort
    setParsePending(true)
    setParseError(undefined)
    try {
      const draft = await controller.parseTaskDraft({ text, ...(parseModel === '' ? {} : { model: parseModel }) }, abort.signal)
      setTitle(draft.title)
      setDescription(draft.description)
      setPrompt(draft.prompt)
    } catch (parseFailure) {
      // A cancelled parse reports nothing: the user asked for it to stop.
      if (!abort.signal.aborted) setParseError(parseFailure instanceof Error ? parseFailure.message : String(parseFailure))
    } finally {
      parseAbort.current = undefined
      setParsePending(false)
    }
  }

  /**
   * Create the task through the Host, then optionally start it.
   * @param runAfterCreate - true for the "create and run" action: the task is
   * committed either way, and a refused start opens the task instead of
   * reporting the creation as failed.
   */
  const submit = async (runAfterCreate: boolean): Promise<void> => {
    if (scheduleEnabled) {
      const cron = scheduleCron.trim()
      if (cron === '' || !isValidCron(cron)) {
        setScheduleError(t('detail.schedule.invalid'))
        return
      }
    }
    // Optional continuation-card snapshot: parse the freeze block through the
    // T2 gate (structure + redaction + taint + size); a malformed block stops
    // submission with the parser's error instead of creating a plain task.
    let freeze: Parameters<typeof controller.createTaskConfirmed>[0]['freeze'] = undefined
    if (freezeText.trim() !== '') {
      const parsed = parseFreezeRequest(freezeText)
      if (!parsed.ok) {
        setFreezeError(parsed.error.message)
        return
      }
      freeze = { ...parsed.snapshot, ...(parsed.warnings.includes('redacted') ? { redacted: true } : {}) }
    }
    // Optional handover bundle: non-empty reference lines attach the picked
    // triplet (workspace/mode/permission above) plus the references.
    const references = handoverText.split('\n').map(line => line.trim()).filter(line => line !== '')
    const handover = references.length === 0 ? undefined : {
      references,
      workspaceId: workspaceId === '' ? undefined : workspaceId,
      mode: mode === '' ? undefined : mode,
      permission: permission === '' ? undefined : permission as TaskPermission,
    }
    // Blank rows never reach the wire: the protocol rejects a tag with an
    // empty name, and an empty list is expressed by omitting the field.
    const tagList = cleanTags(tags)
    setPending(true)
    const task = await controller.createTaskConfirmed({
      title,
      description,
      prompt,
      freeze,
      handover,
      workspaceId: workspaceId === '' ? undefined : workspaceId,
      mode: mode === '' ? undefined : mode,
      permission: permission === '' ? undefined : permission as TaskPermission,
      model: model === '' ? undefined : model,
      ...(reuseSession ? { reuseSession: true } : {}),
      ...(tagList.length > 0 ? { tags: tagList } : {}),
      schedule: scheduleEnabled ? { enabled: true, cron: scheduleCron.trim() } : undefined,
    })
    if (task === undefined) {
      setPending(false)
      setError(controller.getSnapshot().transportError ?? t('new.required'))
      return
    }
    if (isDuplicate && archiveOriginal && initialTask !== undefined) {
      if (onDuplicateSuccess !== undefined) {
        await onDuplicateSuccess(initialTask.id)
      } else {
        await controller.archiveTask(initialTask.id)
      }
    }
    if (runAfterCreate) {
      // The task exists from here on, so a refused start (a permission above
      // the session default, a pinned target that went stale) must not read as
      // a failed creation: open the task, whose detail view owns the
      // confirmation step and the refusal message.
      const started = await controller.runTask(task.id)
      if (!started) controller.openTask(task.id)
    }
    onClose()
  }

  /** Next-run preview for a valid armed cron (creation-time only). */
  const scheduleNextRun = scheduleEnabled && scheduleCron.trim() !== '' && isValidCron(scheduleCron)
    ? nextRunAtMs(scheduleCron, Date.now())
    : undefined

  const modalTitle = isDuplicate ? t('new.duplicateTitle') : t('board.new')

  return (
    <ModalShell
      ariaLabel={modalTitle}
      title={modalTitle}
      error={error}
      pending={pending}
      submitLabel={t('new.submit')}
      onSubmit={() => { void submit(false) }}
      onClose={onClose}
      secondaryAction={{ label: t('new.createAndRun'), onSubmit: () => { void submit(true) } }}
    >
      {canParse && (
        <section className={css.aiParse} data-dsh-part="ai-parse">
          <span className={css.fieldLabel}>{t('new.aiParse')}</span>
          <p className={css.fieldHint}>{t('new.aiParseHint')}</p>
          <textarea
            className={css.input}
            rows={3}
            value={parseText}
            placeholder={t('new.aiParsePlaceholder')}
            spellCheck={false}
            onChange={event => { setParseText(event.target.value); setParseError(undefined) }}
          />
          <div className={css.aiParseRow}>
            <select
              className={css.select}
              value={parseModel}
              aria-label={t('new.aiParseModel')}
              onChange={event => {
                setParseModel(event.target.value)
                writeParseModelPreference(event.target.value)
              }}
            >
              <option value="">{t('exec.model.default')}</option>
              {parseModels.map(option => (
                <option key={option.id} value={option.id}>{option.name ?? option.id}</option>
              ))}
            </select>
            {parsePending
              ? (
                <button type="button" className={css.ghostButton} onClick={() => { parseAbort.current?.abort() }}>
                  {t('new.aiParseCancel')}
                </button>
                )
              : (
                <button
                  type="button"
                  className={css.primaryButton}
                  disabled={parseText.trim() === ''}
                  onClick={() => { void runParse() }}
                >
                  {t('new.aiParseRun')}
                </button>
                )}
          </div>
          {parseError !== undefined && <p className={css.formError}>{parseError}</p>}
        </section>
      )}

      <TaskContentFields
        title={title}
        description={description}
        prompt={prompt}
        onTitleChange={value => { setTitle(value); setError(undefined) }}
        onDescriptionChange={setDescription}
        onPromptChange={setPrompt}
      />

      <TaskTagFields tags={tags} knownTags={collectKnownTags(controller.getSnapshot().tasks)} onChange={setTags} />

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.freeze')}</span>
          <textarea
            className={css.input}
            rows={4}
            value={freezeText}
            placeholder={t('new.freezePlaceholder')}
            spellCheck={false}
            onChange={event => { setFreezeText(event.target.value); setFreezeError(undefined) }}
          />
        </label>
        {freezeError !== undefined && <p className={css.formError}>{freezeError}</p>}

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.handover')}</span>
          <textarea
            className={css.input}
            rows={3}
            value={handoverText}
            placeholder={t('new.handoverPlaceholder')}
            spellCheck={false}
            onChange={event => { setHandoverText(event.target.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.workspace')}</span>
          <select
            className={css.select}
            value={workspaceId}
            onChange={event => { setWorkspaceId(event.target.value) }}
          >
            <option value="">{t('exec.workspace.recent')}</option>
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
            onChange={event => { setMode(event.target.value) }}
          >
            <option value="">{t('exec.mode.default')}</option>
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
            onChange={event => { setPermission(event.target.value) }}
          >
            <option value="">{t('exec.permission.default')}</option>
            {TASK_PERMISSIONS.map(id => (
              <option key={id} value={id}>{t(`exec.permission.${id}` as TaskBoardKey)}</option>
            ))}
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.model')}</span>
          <select
            className={css.select}
            value={model}
            onChange={event => { setModel(event.target.value) }}
          >
            <option value="">{t('exec.model.default')}</option>
            {options.models?.map(item => (
              <option key={item.id} value={item.id}>{item.name ?? item.id}</option>
            ))}
          </select>
        </label>

        <label className={css.scheduleToggle}>
          <input
            type="checkbox"
            checked={reuseSession}
            onChange={event => { setReuseSession(event.target.checked) }}
          />
          <span>{t('exec.reuseSession')}</span>
        </label>
        <p className={css.detailText}>{t('exec.reuseSessionHint')}</p>

        <section className={css.detailSection}>
          <h4>{t('detail.schedule')}</h4>
          <label className={css.scheduleToggle}>
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={event => {
                setScheduleEnabled(event.target.checked)
                if (!event.target.checked) setScheduleError(undefined)
              }}
            />
            <span>{t('detail.schedule.enable')}</span>
          </label>
          {scheduleEnabled && (
            <>
              <div className={css.scheduleRow}>
                <input
                  className={`${css.input} ${css.scheduleInput}${scheduleError !== undefined ? ` ${css.scheduleInputInvalid}` : ''}`}
                  value={scheduleCron}
                  placeholder="0 9 * * *"
                  spellCheck={false}
                  aria-label={t('detail.schedule.cron')}
                  onChange={event => { setScheduleCron(event.target.value); setScheduleError(undefined) }}
                />
                <select
                  className={css.schedulePreset}
                  value=""
                  aria-label={t('detail.schedule.presets')}
                  onChange={event => {
                    if (event.target.value === '') return
                    setScheduleCron(event.target.value)
                    setScheduleError(undefined)
                  }}
                >
                  <option value="">{t('detail.schedule.presets')}…</option>
                  {SCHEDULE_PRESETS.map(preset => (
                    <option key={preset.cron} value={preset.cron}>{t(preset.label)}</option>
                  ))}
                </select>
              </div>
              {scheduleError !== undefined && <p className={css.formError}>{scheduleError}</p>}
              {scheduleError === undefined && scheduleNextRun !== undefined && (
                <p className={css.scheduleMeta}>
                  {t('detail.schedule.nextRun')} {new Date(scheduleNextRun).toLocaleString()}
                </p>
              )}
            </>
          )}
        </section>
        {isDuplicate && (
          <label className={css.checkboxLabel} style={{ marginTop: '12px' }}>
            <input
              type="checkbox"
              checked={archiveOriginal}
              onChange={event => { setArchiveOriginal(event.target.checked) }}
            />
            <span>{t('new.archiveOriginal')}</span>
          </label>
        )}
    </ModalShell>
  )
}
