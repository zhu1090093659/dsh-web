/**
 * The target form: everything one card pins about where and how it runs.
 *
 * Two frames render these fields — the detail seat's form, which saves one
 * target onto an existing card, and the create dialog's picker, which reports a
 * draft the board stores on the card it is about to create. Both frames render
 * the same {@link SshTargetFields}, so which fields a mode and a workspace kind
 * actually ask for, and how a refusal is worded, cannot drift between them.
 *
 * Only the fields the chosen mode and workspace kind actually use are on
 * screen, and the value sent is built from exactly those fields — a hidden
 * field can neither pass nor fail, so what the reader sees is what the parser
 * judges. Validation runs the frozen core parser before anything leaves the
 * frame, and its refusals land under the field that carries them, addressed to
 * the input through `aria-describedby` and `aria-invalid`.
 *
 * @module dsh-task-board-ssh/client/ssh/target-form
 */
import { type FormEvent, useEffect, useId, useState } from 'react'
import { validateDraft, type SshDraftField, type SshTargetDraft } from './model.ts'
import type { SshAgentKind, SshExecutionMode, SshTarget, SshValidationIssue, SshWorkspaceKind } from '../../core/target.ts'
import { useBoardWorkspaces, type SshBoardWorkspaceOption, type SshSummaryHost } from './summary.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import css from '../ssh.module.css'

/** The two execution modes, in the order the form offers them. */
const MODES: readonly SshExecutionMode[] = ['direct', 'proxy']

/** The agent CLIs the form offers, in the order the form offers them. */
const AGENTS: readonly SshAgentKind[] = ['dsh', 'claude', 'codex', 'custom']

/** The two filesystem mechanisms, in the order the form offers them. */
const WORKSPACE_KINDS: readonly SshWorkspaceKind[] = ['in-place', 'git']

/**
 * Localized copy for one parser refusal.
 * @param field - the field the refusal is addressed to.
 * @param issue - the parser's own sentence, used when the field has no copy of its own.
 * @returns the sentence to render under the field.
 */
export function refusalText(field: SshDraftField, issue: SshValidationIssue): string {
  switch (field) {
    case 'host': return t('detail.error.host')
    case 'workspacePath': return t('detail.error.path')
    case 'agentCommand': return t('detail.error.agentCommand')
    case 'repositoryUrl': return t('detail.error.url')
    case 'workspaceId': return t('detail.error.workspaceId')
    default: return t('detail.error.generic', { error: issue.message })
  }
}

/** Props of the field set both target surfaces render. */
export interface SshTargetFieldsProps {
  /** The values to render. */
  draft: SshTargetDraft
  /** Refusals to show, keyed by the field that carries each one. */
  errors: Partial<Record<SshDraftField, SshValidationIssue>>
  /** Hosts the picker offers; empty when the provider publishes none. */
  hosts: readonly SshSummaryHost[]
  /** Local workspaces the picker offers for `git` -> `workspace` source; falls back to board mirror. */
  workspaces?: readonly SshBoardWorkspaceOption[]
  /** The pinned alias that is no longer in the host list, when there is one. */
  unknownHost?: string
  /** Whether every control is read-only because a write is in flight. */
  disabled?: boolean
  /** One line under the mode choice; a frame with room for it passes one, a dialog skips it. */
  modeHint?: string
  /** Called when the operator leaves a field (blur), so progressive validation can surface refusals. */
  onTouch?(field: SshDraftField): void
  /** Called with the fields one control changed. */
  onChange(patch: Partial<SshTargetDraft>): void
}

/**
 * Render the fields of one target, in the order a reader walks them.
 * @param props - the values, the refusals, the hosts to offer and the edit callback.
 * @returns the field set, in the shape the current draft asks for.
 */
export function SshTargetFields({ draft, errors, hosts, workspaces, unknownHost, disabled = false, modeHint, onTouch, onChange }: SshTargetFieldsProps) {
  const baseId = useId()
  const mirrorWorkspaces = useBoardWorkspaces()
  const workspaceOptions = workspaces ?? mirrorWorkspaces
  const isProxy = draft.mode === 'proxy'

  const errorFor = (field: SshDraftField): string | undefined => {
    const issue = errors[field]
    return issue === undefined ? undefined : refusalText(field, issue)
  }

  /** Render one labelled text input and its refusal. */
  const textField = (
    field: SshDraftField,
    labelKey: TaskBoardSshKey,
    value: string,
    onChangeText: (next: string) => void,
    placeholder?: string,
  ) => {
    const id = `${baseId}-${field}`
    const error = errorFor(field)
    return (
      <div className={css.field} key={field}>
        <label className={css.fieldLabel} htmlFor={id}>{t(labelKey)}</label>
        <input
          id={id}
          className={css.input}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={event => onChangeText(event.target.value)}
          onBlur={() => onTouch?.(field)}
          disabled={disabled}
        />
        {error !== undefined && <p className={css.fieldError} id={`${id}-error`}>{error}</p>}
      </div>
    )
  }

  /** Render one labelled choice group whose options are radio inputs. */
  const choiceGroup = <Value extends string>(
    field: SshDraftField,
    labelKey: TaskBoardSshKey,
    options: readonly { value: Value, label: TaskBoardSshKey }[],
    value: Value,
    onChangeChoice: (next: Value) => void,
  ) => {
    const error = errorFor(field)
    const errorId = `${baseId}-${field}-error`
    return (
      <fieldset
        className={css.field}
        data-invalid={error !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        key={field}
      >
        <legend className={css.fieldLabel}>{t(labelKey)}</legend>
        <div className={css.segments}>
          {options.map(option => (
            <label key={option.value} className={css.segment} data-disabled={disabled || undefined}>
              <input
                type="radio"
                name={`${baseId}-${field}`}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChangeChoice(option.value)}
                disabled={disabled}
              />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </div>
        {error !== undefined && <p className={css.fieldError} id={errorId}>{error}</p>}
      </fieldset>
    )
  }

  const hostOptions = hosts.map(host => ({ alias: host.alias, label: `${host.alias} · ${host.user}@${host.host}` }))
  const hostInList = hostOptions.some(option => option.alias === draft.host)
  // With no host to pick the hint says everything there is to say, so a refusal
  // would only repeat it: an error speaks while the field can still be answered.
  const hostHint = hostOptions.length === 0 ? t('detail.hostMissing') : undefined
  const hostError = hostHint === undefined ? errorFor('host') : undefined
  const hostDescribedBy = [
    hostHint === undefined ? undefined : `${baseId}-host-hint`,
    hostError === undefined ? undefined : `${baseId}-host-error`,
  ].filter(part => part !== undefined).join(' ')
  const agentError = errorFor('agent')

  return (
    <div className={css.fields} data-dsh-part="target-fields">
      {choiceGroup(
        'mode',
        'detail.mode',
        MODES.map(value => ({ value, label: `detail.mode.${value}` as TaskBoardSshKey })),
        draft.mode,
        next => onChange({ mode: next }),
      )}
      {modeHint !== undefined && <p className={css.fieldHint}>{modeHint}</p>}

      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor={`${baseId}-host`}>{t('detail.host')}</label>
        <select
          id={`${baseId}-host`}
          className={css.select}
          value={draft.host}
          aria-invalid={hostError !== undefined}
          aria-describedby={hostDescribedBy === '' ? undefined : hostDescribedBy}
          onChange={event => onChange({ host: event.target.value })}
          onBlur={() => onTouch?.('host')}
          disabled={disabled || hostOptions.length === 0}
        >
          <option value="">{t(hostOptions.length === 0 ? 'detail.hostNone' : 'detail.host')}</option>
          {!hostInList && unknownHost !== undefined && unknownHost !== '' && (
            <option value={unknownHost}>{t('detail.hostUnknown', { alias: unknownHost })}</option>
          )}
          {hostOptions.map(option => (
            <option key={option.alias} value={option.alias}>{option.label}</option>
          ))}
        </select>
        {hostHint !== undefined && <p className={css.fieldHint} id={`${baseId}-host-hint`}>{hostHint}</p>}
        {hostError !== undefined && <p className={css.fieldError} id={`${baseId}-host-error`}>{hostError}</p>}
      </div>

      {!isProxy && (
        <div className={css.field}>
          <label className={css.fieldLabel} htmlFor={`${baseId}-agent`}>{t('detail.agent')}</label>
          <select
            id={`${baseId}-agent`}
            className={css.select}
            value={draft.agent}
            aria-invalid={agentError !== undefined}
            aria-describedby={agentError === undefined ? undefined : `${baseId}-agent-error`}
            onChange={event => onChange({ agent: event.target.value as SshAgentKind })}
            disabled={disabled}
          >
            {AGENTS.map(agent => (
              <option key={agent} value={agent}>{t(`detail.agent.${agent}` as TaskBoardSshKey)}</option>
            ))}
          </select>
          {agentError !== undefined && <p className={css.fieldError} id={`${baseId}-agent-error`}>{agentError}</p>}
        </div>
      )}

      {!isProxy && draft.agent === 'custom' && (
        <>
          {textField('agentCommand', 'detail.agentCommand', draft.agentCommand, next => onChange({ agentCommand: next }), '{prompt_file}')}
          {textField('agentResumeCommand', 'detail.agentResumeCommand', draft.agentResumeCommand, next => onChange({ agentResumeCommand: next }))}
        </>
      )}

      {choiceGroup(
        'workspaceKind',
        'detail.workspace',
        WORKSPACE_KINDS.map(value => ({ value, label: `detail.workspace.${value}` as TaskBoardSshKey })),
        draft.workspaceKind,
        next => onChange({ workspaceKind: next }),
      )}

      {draft.workspaceKind === 'in-place'
        ? textField('workspacePath', 'detail.workspace.path', draft.workspacePath, next => onChange({ workspacePath: next }), '/home/me/project')
        : (
            <>
              {!isProxy && choiceGroup(
                'gitSource',
                'detail.workspace.source',
                [
                  { value: 'url' as const, label: 'detail.workspace.source.url' as TaskBoardSshKey },
                  { value: 'workspace' as const, label: 'detail.workspace.source.workspace' as TaskBoardSshKey },
                ],
                draft.gitSource,
                next => onChange({ gitSource: next }),
              )}
              {(isProxy || draft.gitSource === 'url')
                ? (
                    <>
                      {textField('repositoryUrl', 'detail.workspace.url', draft.repositoryUrl, next => onChange({ repositoryUrl: next }), 'git@example.com:team/repo.git')}
                      {textField('baseBranch', 'detail.workspace.base', draft.baseBranch, next => onChange({ baseBranch: next }), 'main')}
                    </>
                  )
                : workspaceOptions.length > 0
                  ? (() => {
                      const id = `${baseId}-workspaceId`
                      const wsError = errorFor('workspaceId')
                      const known = workspaceOptions.some(item => item.workspaceId === draft.workspaceId)
                      return (
                        <div className={css.field} key="workspaceId">
                          <label className={css.fieldLabel} htmlFor={id}>{t('detail.workspace.workspaceId')}</label>
                          <select
                            id={id}
                            className={css.select}
                            value={draft.workspaceId}
                            aria-invalid={wsError !== undefined}
                            aria-describedby={wsError === undefined ? undefined : `${id}-error`}
                            onChange={event => onChange({ workspaceId: event.target.value })}
                            onBlur={() => onTouch?.('workspaceId')}
                            disabled={disabled}
                          >
                            <option value="">{t('detail.workspace.workspaceIdPlaceholder')}</option>
                            {!known && draft.workspaceId !== '' && (
                              <option value={draft.workspaceId}>{draft.workspaceId}</option>
                            )}
                            {workspaceOptions.map(item => (
                              <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>
                            ))}
                          </select>
                          {wsError !== undefined && <p className={css.fieldError} id={`${id}-error`}>{wsError}</p>}
                        </div>
                      )
                    })()
                  : textField('workspaceId', 'detail.workspace.workspaceId', draft.workspaceId, next => onChange({ workspaceId: next }), t('detail.workspace.workspaceIdPlaceholder'))}
            </>
          )}
    </div>
  )
}

/** Props of the target form. */
export interface SshTargetFormProps {
  /** State the form opens with. */
  initial: SshTargetDraft
  /** Hosts the picker offers; empty when the provider publishes none. */
  hosts: readonly SshSummaryHost[]
  /** The pinned alias that is no longer in the host list, when there is one. */
  unknownHost?: string
  /** Whether a write is in flight. */
  saving: boolean
  /** Text of the submit control. */
  submitLabel: string
  /** Drop the form without writing, when the caller has somewhere to go back to. */
  onCancel?: () => void
  /** Called with the parsed target once every field passes. */
  onSubmit(target: SshTarget): void
}

/**
 * Render the target form: the same fields, framed by one save action.
 * @param props - the opening state, the hosts to offer and the write callbacks.
 * @returns the form, in the shape the current draft asks for.
 */
export function SshTargetForm({ initial, hosts, unknownHost, saving, submitLabel, onCancel, onSubmit }: SshTargetFormProps) {
  const [draft, setDraft] = useState<SshTargetDraft>(initial)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<SshDraftField, SshValidationIssue>>>({})

  // Adopt late-arriving provider defaults until the operator starts editing.
  useEffect(() => {
    if (!dirty) setDraft(initial)
  }, [dirty, initial.mode, initial.host, initial.agent, initial.agentCommand, initial.agentResumeCommand, initial.workspaceKind, initial.gitSource, initial.workspacePath, initial.repositoryUrl, initial.baseBranch, initial.workspaceId])

  const edit = (patch: Partial<SshTargetDraft>): void => {
    setDirty(true)
    setDraft(current => ({ ...current, ...patch }))
    // A field that changed is re-judged on the next submit; its old refusal
    // must not outlive the value it was about.
    setErrors(current => {
      const fields = Object.keys(patch)
      if (!fields.some(field => current[field as SshDraftField] !== undefined)) return current
      const kept = { ...current }
      for (const field of fields) delete kept[field as SshDraftField]
      return kept
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const result = validateDraft(draft)
    if (result.target === undefined) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.target)
  }

  return (
    <form className={css.form} onSubmit={submit} data-dsh-part="target-form">
      <SshTargetFields
        draft={draft}
        errors={errors}
        hosts={hosts}
        {...(unknownHost === undefined ? {} : { unknownHost })}
        disabled={saving}
        modeHint={t(draft.mode === 'direct' ? 'detail.modeHintDirect' : 'detail.modeHintProxy')}
        onChange={edit}
      />

      <div className={css.actions}>
        <button type="submit" className={css.primaryButton} disabled={saving}>
          {submitLabel}
        </button>
        {onCancel !== undefined && (
          <button type="button" className={css.ghostButton} onClick={onCancel} disabled={saving}>
            {t('detail.cancelEdit')}
          </button>
        )}
      </div>
    </form>
  )
}
