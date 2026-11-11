/**
 * New-task modal: title + description + the prompt that execution will send.
 * Creates through the Host and closes only after the Host confirms it.
 */
import { useEffect, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { resolveCardTargets, type CardTargetSource } from '../../core/card-defaults.ts'
import { isValidCron, nextRunAtMs } from '../../core/schedule.ts'
import { parseFreezeRequest } from '../../core/freeze-snapshot.ts'
import { effectiveTaskPermission } from '../../core/subtask.ts'
import { collectKnownTags, TASK_PERMISSIONS, type ScheduleMode, type TaskPermission, type TaskRecord, type TaskTag } from '../../core/tasks.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { SCHEDULE_PRESETS } from '../schedule-presets.ts'
import { defaultZonedInputValue, nextRunLabel, parseZonedInput, runCapOption, zonedInputValue, zoneChoices } from '../schedule-zone.ts'
import { CollapsibleSection, ModalShell, TaskContentFields, TaskTagFields, cleanTags } from './TaskForm.tsx'
import { AttachmentField, type AttachmentSelection } from './AttachmentField.tsx'
import { dedupeAttachments, type TaskAttachment } from '../../core/attachment.ts'
import type { OverlayPhase } from './overlay.tsx'
import { formatHostTimestamp } from './TaskCard.tsx'
import { readParseModelPreference, writeParseModelPreference } from './parse-model-pref.ts'
import { inheritPresetLabel, presetChoiceRows, presetLabel } from './preset-label.ts'
import { ReasoningEffortField } from './ReasoningEffortField.tsx'
import { modelDisplayLabel, reconcileReasoningEffort } from './model-options.ts'
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
  /**
   * Task the new card becomes a subtask of ("add subtask" from its detail
   * view). The execution targets start from the parent's and the create action
   * carries the parent link; unset targets inherit again at run time.
   */
  parentTask?: TaskRecord
  /** Which leg of the enter/exit motion pair the surface is on. */
  phase?: OverlayPhase
}

/**
 * Mark one staged attachment row: the upload state and the failure reason.
 */
function markStaged(
  selection: AttachmentSelection,
  id: string,
  patch: { pending?: boolean; error?: string },
): AttachmentSelection {
  return {
    ...selection,
    staged: selection.staged.map(staged => staged.id === id ? { ...staged, ...patch } : staged),
  }
}

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose, initialTask, defaultWorkspaceId, onDuplicateSuccess, parentTask, phase }: NewTaskModalProps) {
  const isDuplicate = initialTask !== undefined
  const [title, setTitle] = useState(initialTask?.title ?? '')
  const [description, setDescription] = useState(initialTask?.description ?? '')
  const [prompt, setPrompt] = useState(initialTask?.prompt ?? '')
  // The four execution targets this dialog opens on, resolved by the one rule
  // the Host create path also uses (core/card-defaults.ts): what the card is
  // created from (a duplicate's source, a subtask's parent) first, the board's
  // new-card defaults second, blank when neither supplies a value. Resolving it
  // from the SAME function the ledger uses is what keeps the dialog from
  // drifting from what a create without an explicit choice stores.
  const [seed] = useState(() => {
    const source: CardTargetSource | undefined = parentTask !== undefined
      ? { kind: 'parent', task: parentTask }
      : initialTask !== undefined ? { kind: 'duplicate', task: initialTask } : undefined
    return resolveCardTargets(controller.getSnapshot().host?.cardDefaults, source)
  })
  // A subtask starts from its parent's execution contract (issue: subtask
  // inheritance); each picker below still overrides it for this card. The
  // permission stays UNSET unless a default supplies one: leaving it empty is
  // what makes the Host inherit the parent's binding together with its human
  // confirmation, while picking a value pins this card's own binding and
  // re-arms the gate. A parent's permission never travels here at all.
  const [workspaceId, setWorkspaceId] = useState(initialTask?.workspaceId ?? parentTask?.workspaceId ?? defaultWorkspaceId ?? '')
  const [mode, setMode] = useState(seed.mode)
  const [permission, setPermission] = useState(seed.permission)
  const [model, setModel] = useState(seed.model)
  // The effort belongs to the model pin: the resolved seed carries the source
  // card's pair and applies the configured default level only while the final
  // model IS the configured default model; '' follows the model/Host default.
  const [reasoningEffort, setReasoningEffort] = useState(seed.reasoningEffort)
  const inheritedPermission = parentTask === undefined ? undefined : effectiveTaskPermission(parentTask)
  const [reuseSession, setReuseSession] = useState(initialTask?.reuseSession ?? false)
  const [scheduleEnabled, setScheduleEnabled] = useState(initialTask?.schedule?.enabled ?? false)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialTask?.schedule?.mode ?? 'cron')
  const [scheduleCron, setScheduleCron] = useState(initialTask?.schedule?.cron ?? '')
  // A duplicate keeps the original card's plan; a fresh one-shot defaults to
  // the next hour, so the field never opens on a past instant.
  const [scheduleAt, setScheduleAt] = useState<string>(() => initialTask?.schedule?.mode === 'once' && initialTask.schedule.at !== undefined
    ? zonedInputValue(initialTask.schedule.at, initialTask.schedule.timeZone)
    : defaultZonedInputValue(Date.now(), initialTask?.schedule?.timeZone))
  const [scheduleMaxRunsChoice, setScheduleMaxRunsChoice] = useState<string>(() => runCapOption(initialTask?.schedule?.maxRuns))
  const [scheduleMaxRunsText, setScheduleMaxRunsText] = useState<string>(initialTask?.schedule?.maxRuns === undefined ? '' : String(initialTask.schedule.maxRuns))
  // '' means "follow the Host zone" (store no zone), which is the default a
  // user gets unless they pick one explicitly.
  const [scheduleZone, setScheduleZone] = useState(initialTask?.schedule?.timeZone ?? '')
  const [scheduleError, setScheduleError] = useState<string | undefined>(undefined)
  const [freezeText, setFreezeText] = useState('')
  const [freezeError, setFreezeError] = useState<string | undefined>(undefined)
  const [handoverText, setHandoverText] = useState(
    initialTask?.handover?.references !== undefined ? initialTask.handover.references.join('\n') : '',
  )
  const [tags, setTags] = useState<TaskTag[]>(initialTask?.tags ?? [])
  // The card's attachments: what a duplicated card already carries, plus the
  // files staged locally. A staged file is a local preview until the card is
  // SAVED: the upload happens on save, never on selection.
  const [attachments, setAttachments] = useState<AttachmentSelection>({
    persisted: initialTask?.attachments ?? [],
    staged: [],
  })
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined)
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
  const models = options.models ?? []
  // A pinned target may have disappeared from the runtime (workspace deleted,
  // preset removed) — especially when the form starts from a subtask's parent.
  // Keep it selectable as a stale row, so the field shows what the create
  // action will actually send instead of silently displaying the default.
  const workspaceKnown = workspaceId === '' || options.workspaces.some(item => item.workspaceId === workspaceId)
  const modeKnown = mode === '' || options.presets.some(item => item.id === mode)
  const modelKnown = model === '' || models.some(item => item.id === model)

  // The workspace list and preset roster arrive from the runtime after mount;
  // follow them so the pickers never freeze on an empty snapshot.
  useEffect(
    () => controller.subscribe(() => {
      const snapshot = controller.getSnapshot()
      setOptions(snapshot.executionOptions)
    }),
    [controller],
  )

  // The model roster arrives asynchronously. A remembered model the deployment
  // no longer offers falls back to the Host default; an empty value is the
  // Host-default choice and is never overwritten by the roster (issue #1621).
  useEffect(() => {
    if (parseModel === '' || models.length === 0) return
    if (models.some(option => option.id === parseModel)) return
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
      if (scheduleMode === 'once') {
        const at = parseZonedInput(scheduleAt, scheduleZone === '' ? hostTimeZone : scheduleZone)
        if (at === undefined || at <= Date.now()) {
          setScheduleError(t('detail.schedule.atInvalid'))
          return
        }
      } else {
        const cron = scheduleCron.trim()
        if (cron === '' || !isValidCron(cron)) {
          setScheduleError(t('detail.schedule.invalid'))
          return
        }
        if (scheduleMaxRunsChoice === 'custom') {
          const cap = Number(scheduleMaxRunsText.trim())
          if (scheduleMaxRunsText.trim() === '' || !Number.isInteger(cap) || cap < 1) {
            setScheduleError(t('detail.schedule.maxRunsInvalid'))
            return
          }
        }
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
    // The staged files are uploaded NOW, because the card is being saved: the
    // upload is what turns a local file into a stored object the card can
    // reference. A card the user abandons never uploads anything.
    const uploaded: TaskAttachment[] = []
    for (const staged of attachments.staged) {
      setAttachments(current => markStaged(current, staged.id, { pending: true, error: undefined }))
      try {
        const attachment = await controller.uploadAttachment(staged.file, staged.kind)
        if (attachment === undefined) throw new Error(t('new.attachments.unavailable'))
        uploaded.push(attachment)
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        setAttachments(current => markStaged(current, staged.id, { pending: false, error: message }))
        setPending(false)
        setError(message)
        return
      }
    }
    const task = await controller.createTaskConfirmed({
      title,
      description,
      prompt,
      ...(parentTask === undefined ? {} : { parentId: parentTask.id }),
      freeze,
      handover,
      // A cleared picker is OMITTED, never sent as an empty value: absence is
      // how "no pin, resolved at run time" is stored, so blanking a field the
      // dialog opened prefilled really unpins it. This dialog never sends
      // `applyCardDefaults` — the prefill above is the whole feature here.
      ...(workspaceId === '' ? {} : { workspaceId }),
      ...(mode === '' ? {} : { mode }),
      ...(permission === '' ? {} : { permission: permission as TaskPermission }),
      ...(model === '' ? {} : { model }),
      ...(reasoningEffort === '' ? {} : { reasoningEffort }),
      ...(reuseSession ? { reuseSession: true } : {}),
      ...(tagList.length > 0 ? { tags: tagList } : {}),
      ...(attachments.persisted.length + uploaded.length > 0
        // The storage is content-addressed: the same content uploaded twice
        // answers with one identifier, and the card may claim it once.
        ? { attachments: dedupeAttachments([...attachments.persisted, ...uploaded]) }
        : {}),
      schedule: scheduleEnabled
        ? scheduleMode === 'once'
          ? {
              enabled: true,
              mode: 'once' as const,
              at: parseZonedInput(scheduleAt, scheduleZone === '' ? hostTimeZone : scheduleZone)!,
              ...(scheduleZone === '' ? {} : { timeZone: scheduleZone }),
            }
          : {
              enabled: true,
              mode: 'cron' as const,
              cron: scheduleCron.trim(),
              ...(scheduleMaxRunsChoice === 'unlimited' ? {} : {
                maxRuns: scheduleMaxRunsChoice === 'custom' ? Number(scheduleMaxRunsText.trim()) : Number(scheduleMaxRunsChoice),
              }),
              ...(scheduleZone === '' ? {} : { timeZone: scheduleZone }),
            }
        : undefined,
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

  // Next-run preview for the armed plan (creation-time only), computed in the
  // selected zone so it matches what the Host will arm. A one-shot's next run
  // IS its planned instant; a recurring rule resolves its next occurrence.
  const hostTimeZone = controller.getSnapshot().host?.scheduler.timeZone
  const scheduleTimeZone = scheduleZone === '' ? hostTimeZone : scheduleZone
  const scheduleNextRun = !scheduleEnabled
    ? undefined
    : scheduleMode === 'once'
      ? parseZonedInput(scheduleAt, scheduleTimeZone)
      : scheduleCron.trim() !== '' && isValidCron(scheduleCron)
        ? nextRunAtMs(scheduleCron, Date.now(), scheduleTimeZone)
        : undefined

  const modalTitle = parentTask !== undefined
    ? t('new.subtaskTitle')
    : isDuplicate ? t('new.duplicateTitle') : t('board.new')

  // Agent-preset picker rows: the four built-in presets first, then every other
  // roster row (user presets), each labelled with its default/unavailable
  // suffixes by the one row builder the settings card's default-preset field
  // also renders through. The inherit option names the preset a run actually
  // lands on when the card pins nothing.
  const presetRows = presetChoiceRows(options.presets)
  const inheritLabel = inheritPresetLabel(options.presets)
  const selectedPreset = options.presets.find(preset => preset.id === mode)
  const modeLabel = mode === '' ? inheritLabel : selectedPreset === undefined ? mode : presetLabel(selectedPreset)
  const workspaceLabel = workspaceId === ''
    ? t('exec.workspace.recent')
    : options.workspaces.find(item => item.workspaceId === workspaceId)?.title ?? workspaceId
  const permissionLabel = permission === ''
    ? inheritedPermission === undefined
      ? t('exec.permission.default')
      : t('exec.permission.inheritParent', { permission: t(`exec.permission.${inheritedPermission}` as TaskBoardKey) })
    : t(`exec.permission.${permission}` as TaskBoardKey)
  // The pinned model is shown in the shared display form, so a model two
  // providers publish stays tellable apart in the collapsed line too. A
  // route the roster does not describe keeps its own id: the display never
  // invents a provider for a route it cannot resolve.
  const modelLabel = model === ''
    ? t('exec.model.default')
    : modelDisplayLabel(models.find(item => item.id === model) ?? { id: model })
  // The effort is part of the model pin, so a pinned one rides the model's own
  // summary entry instead of standing as a region-level value of its own.
  const modelSummary = reasoningEffort === '' ? modelLabel : `${modelLabel} · ${reasoningEffort}`
  // Collapsed-region summaries: what each closed region currently holds, so a
  // collapse never hides the configuration without a trace.
  // A host-default model adds only the long parenthetical name to the
  // collapsed line, so it is summarized only once it is actually pinned.
  const executionSummary = [
    workspaceLabel,
    modeLabel,
    permissionLabel,
    ...(model === '' ? [] : [modelSummary]),
  ].join(' · ')
  // The collapsed line of the attachment region: how many objects the card
  // will carry once it is saved.
  const attachmentCount = attachments.persisted.length + attachments.staged.length
  const attachmentSummary = attachmentCount === 0
    ? t('new.summary.none')
    : t('new.summary.attachmentCount', { count: String(attachmentCount) })
  const tagCount = cleanTags(tags).length
  const labelsSummary = tagCount === 0 ? t('new.summary.none') : t('new.summary.labelCount', { count: String(tagCount) })
  const runSummary = reuseSession ? t('exec.reuseSession') : t('new.summary.none')
  const handoverSummary = freezeText.trim() !== '' || handoverText.trim() !== ''
    ? t('new.summary.filled')
    : t('new.summary.none')
  const scheduleSummary = !scheduleEnabled
    ? t('new.summary.scheduleOff')
    : scheduleMode === 'once'
      ? `${t('detail.schedule.mode.once')} · ${scheduleAt.replace('T', ' ')}`
      : scheduleCron.trim() === ''
        ? t('new.summary.none')
        : [
            scheduleCron.trim(),
            ...(scheduleMaxRunsChoice === 'unlimited'
              ? []
              : [t('detail.schedule.maxRunsValue', {
                  count: scheduleMaxRunsChoice === 'custom' ? scheduleMaxRunsText : scheduleMaxRunsChoice,
                })]),
          ].join(' · ')
  const parseSummary = parseText.trim() === '' ? t('new.summary.none') : t('new.summary.filled')

  return (
    <ModalShell
      ariaLabel={modalTitle}
      title={modalTitle}
      error={error}
      pending={pending}
      submitLabel={t('new.submit')}
      onSubmit={() => { void submit(false) }}
      onClose={onClose}
      phase={phase}
      secondaryAction={{ label: t('new.createAndRun'), onSubmit: () => { void submit(true) } }}
    >
      {canParse && (
        <CollapsibleSection
          title={t('new.section.parse')}
          summary={parseSummary}
          forceOpen={parseError !== undefined}
        >
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
                {models.map(option => (
                  <option key={option.id} value={option.id}>{modelDisplayLabel(option)}</option>
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
                    className={css.ghostButton}
                    disabled={parseText.trim() === ''}
                    onClick={() => { void runParse() }}
                  >
                    {t('new.aiParseRun')}
                  </button>
                  )}
            </div>
            {parseError !== undefined && <p className={css.formError}>{parseError}</p>}
          </section>
        </CollapsibleSection>
      )}

      {parentTask !== undefined && (
        <>
          <p className={css.detailText} data-dsh-part="subtask-inherit">
            {t('detail.parent')}: {parentTask.title} · {t('new.subtaskInherit')}
          </p>
        </>
      )}

      <CollapsibleSection title={t('new.section.content')} defaultOpen>
        <TaskContentFields
          title={title}
          description={description}
          prompt={prompt}
          onTitleChange={value => { setTitle(value); setError(undefined) }}
          onDescriptionChange={setDescription}
          onPromptChange={setPrompt}
        />
        {isDuplicate && (
          <label className={css.scheduleToggle}>
            <input
              type="checkbox"
              checked={archiveOriginal}
              onChange={event => { setArchiveOriginal(event.target.checked) }}
            />
            <span>{t('new.archiveOriginal')}</span>
          </label>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={t('new.section.labels')} summary={labelsSummary}>
        <TaskTagFields tags={tags} knownTags={collectKnownTags(controller.getSnapshot().tasks)} onChange={setTags} />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('new.section.attachments')}
        summary={attachmentSummary}
        forceOpen={attachmentError !== undefined}
      >
        <AttachmentField
          selection={attachments}
          onChange={setAttachments}
          limits={controller.getSnapshot().host?.attachmentLimits}
          disabled={pending}
          onError={message => { setAttachmentError(message) }}
        />
        {attachmentError !== undefined && <p className={css.formError}>{attachmentError}</p>}
      </CollapsibleSection>

      <CollapsibleSection title={t('new.section.execution')} summary={executionSummary}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.workspace')}</span>
          <select
            className={css.select}
            value={workspaceId}
            onChange={event => { setWorkspaceId(event.target.value) }}
          >
            <option value="">{t('exec.workspace.recent')}</option>
            {!workspaceKnown && <option value={workspaceId}>{workspaceId}{t('exec.mode.removed')}</option>}
            {options.workspaces.map(workspace => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
            ))}
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
          <select
            className={css.select}
            value={mode}
            onChange={event => { setMode(event.target.value) }}
          >
            <option value="">{inheritLabel}</option>
            {!modeKnown && <option value={mode}>{mode}{t('exec.mode.removed')}</option>}
            {presetRows.builtin.length > 0 && (
              <optgroup label={t('exec.mode.builtinGroup')}>
                {presetRows.builtin.map(row => (
                  <option key={row.id} value={row.id} disabled={row.disabled}>{row.label}</option>
                ))}
              </optgroup>
            )}
            {presetRows.custom.length > 0 && (
              <optgroup label={t('exec.mode.customGroup')}>
                {presetRows.custom.map(row => (
                  <option key={row.id} value={row.id} disabled={row.disabled}>{row.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.permission')}</span>
          <select
            className={css.select}
            value={permission}
            onChange={event => { setPermission(event.target.value) }}
          >
            <option value="">{inheritedPermission === undefined
              ? t('exec.permission.default')
              : t('exec.permission.inheritParent', { permission: t(`exec.permission.${inheritedPermission}` as TaskBoardKey) })}</option>
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
            onChange={event => {
              // The effort belongs to the model: switching to a model that
              // cannot honor the picked level drops it instead of carrying it.
              const next = event.target.value
              setModel(next)
              setReasoningEffort(current => reconcileReasoningEffort(models, next, current))
            }}
          >
            <option value="">{t('exec.model.default')}</option>
            {!modelKnown && <option value={model}>{model}{t('exec.model.unknown')}</option>}
            {models.map(item => (
              <option key={item.id} value={item.id}>{modelDisplayLabel(item)}</option>
            ))}
          </select>
        </label>

        <ReasoningEffortField
          models={models}
          modelId={model}
          value={reasoningEffort}
          pending={pending}
          onChange={setReasoningEffort}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t('new.section.run')} summary={runSummary}>
        <label className={css.scheduleToggle}>
          <input
            type="checkbox"
            checked={reuseSession}
            onChange={event => { setReuseSession(event.target.checked) }}
          />
          <span>{t('exec.reuseSession')}</span>
        </label>
        <p className={css.detailText}>{t('exec.reuseSessionHint')}</p>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('new.section.handover')}
        summary={handoverSummary}
        forceOpen={freezeError !== undefined}
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        title={t('new.section.schedule')}
        summary={scheduleSummary}
        forceOpen={scheduleError !== undefined}
      >
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
            <label className={css.scheduleZone}>
              <span>{t('detail.schedule.mode')}</span>
              <select
                className={css.schedulePreset}
                value={scheduleMode}
                aria-label={t('detail.schedule.mode')}
                onChange={event => { setScheduleMode(event.target.value as ScheduleMode); setScheduleError(undefined) }}
              >
                <option value="cron">{t('detail.schedule.mode.cron')}</option>
                <option value="once">{t('detail.schedule.mode.once')}</option>
              </select>
            </label>
            {scheduleMode === 'once' ? (
              <label className={css.scheduleZone}>
                <span>{t('detail.schedule.at')}</span>
                <input
                  className={css.input}
                  type="datetime-local"
                  value={scheduleAt}
                  aria-label={t('detail.schedule.at')}
                  title={t('detail.schedule.atHint')}
                  onChange={event => { setScheduleAt(event.target.value); setScheduleError(undefined) }}
                />
              </label>
            ) : (
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
                <label className={css.scheduleZone}>
                  <span>{t('detail.schedule.maxRuns')}</span>
                  <select
                    className={css.schedulePreset}
                    value={scheduleMaxRunsChoice}
                    aria-label={t('detail.schedule.maxRuns')}
                    onChange={event => {
                      setScheduleMaxRunsChoice(event.target.value)
                      setScheduleError(undefined)
                      if (event.target.value === 'custom') {
                        setScheduleMaxRunsText(initialTask?.schedule?.maxRuns === undefined ? '' : String(initialTask.schedule.maxRuns))
                      }
                    }}
                  >
                    <option value="unlimited">{t('detail.schedule.maxRunsUnlimited')}</option>
                    <option value="1">{t('detail.schedule.maxRunsValue', { count: '1' })}</option>
                    <option value="2">{t('detail.schedule.maxRunsValue', { count: '2' })}</option>
                    <option value="custom">{t('detail.schedule.maxRunsCustom')}</option>
                  </select>
                </label>
                {scheduleMaxRunsChoice === 'custom' && (
                  <label className={css.scheduleZone}>
                    <span>{t('detail.schedule.maxRuns')}</span>
                    <input
                      className={css.input}
                      type="number"
                      min={1}
                      step={1}
                      value={scheduleMaxRunsText}
                      aria-label={t('detail.schedule.maxRuns')}
                      onChange={event => { setScheduleMaxRunsText(event.target.value); setScheduleError(undefined) }}
                    />
                  </label>
                )}
              </>
            )}
            {scheduleError !== undefined && <p className={css.formError}>{scheduleError}</p>}
            <label className={css.scheduleZone}>
              <span>{t('detail.schedule.timeZone')}</span>
              <select
                className={css.schedulePreset}
                value={scheduleZone}
                aria-label={t('detail.schedule.timeZone')}
                title={scheduleMode === 'once' ? t('detail.schedule.zoneOnceHint') : t('detail.schedule.timeZoneHint')}
                onChange={event => { setScheduleZone(event.target.value); setScheduleError(undefined) }}
              >
                {zoneChoices(hostTimeZone, initialTask?.schedule?.timeZone).map(choice => (
                  <option key={choice.id === '' ? '__host' : choice.id} value={choice.id}>{choice.label}</option>
                ))}
              </select>
            </label>
            {scheduleError === undefined && scheduleNextRun !== undefined && (
              <p className={css.scheduleMeta}>
                {t('detail.schedule.nextRun')}{' '}
                {nextRunLabel(scheduleNextRun, scheduleTimeZone, formatHostTimestamp, Date.now())}
              </p>
            )}
          </>
        )}
      </CollapsibleSection>
    </ModalShell>
  )
}
