/**
 * The target form: everything one card pins about where and how it runs.
 *
 * Only the fields the chosen mode and workspace kind actually use are on
 * screen, and the value sent is built from exactly those fields — a hidden
 * field can neither pass nor fail, so what the reader sees is what the parser
 * judges. Validation runs the frozen core parser before anything is dispatched,
 * and its refusals land under the field that carries them, addressed to the
 * input through `aria-describedby` and `aria-invalid`.
 *
 * @module dsh-task-board-ssh/client/ssh/target-form
 */
import { type FormEvent, useId, useState } from 'react'
import { validateDraft, type SshDraftField, type SshTargetDraft } from './model.ts'
import type { SshAgentKind, SshExecutionMode, SshTarget, SshValidationIssue, SshWorkspaceKind } from '../../core/target.ts'
import type { SshSummaryHost } from './summary.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import css from '../ssh.module.css'

/** The two execution modes, in the order the form offers them. */
const MODES: readonly SshExecutionMode[] = ['direct', 'proxy']

/** The agent CLIs the form offers, in the order the form offers them. */
const AGENTS: readonly SshAgentKind[] = ['dsh', 'claude', 'codex', 'custom']

/** The two filesystem mechanisms, in the order the form offers them. */
const WORKSPACE_KINDS: readonly SshWorkspaceKind[] = ['in-place', 'git']

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
 * Localized copy for one parser refusal.
 * @param field - the field the refusal is addressed to.
 * @param issue - the parser's own sentence, used when the field has no copy of its own.
 * @returns the sentence to render under the field.
 */
function refusalText(field: SshDraftField, issue: SshValidationIssue): string {
  switch (field) {
    case 'host': return t('detail.error.host')
    case 'workspacePath': return t('detail.error.path')
    case 'agentCommand': return t('detail.error.agentCommand')
    case 'repositoryUrl': return t('detail.error.url')
    case 'workspaceId': return t('detail.error.workspaceId')
    default: return t('detail.error.generic', { error: issue.message })
  }
}

/**
 * Render the target form.
 * @param props - the opening state, the hosts to offer and the write callbacks.
 * @returns the form, in the shape the current draft asks for.
 */
export function SshTargetForm({ initial, hosts, unknownHost, saving, submitLabel, onCancel, onSubmit }: SshTargetFormProps) {
  const baseId = useId()
  const [draft, setDraft] = useState<SshTargetDraft>(initial)
  const [errors, setErrors] = useState<Partial<Record<SshDraftField, SshValidationIssue>>>({})

  const edit = (patch: Partial<SshTargetDraft>): void => {
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

  const errorFor = (field: SshDraftField): string | undefined => {
    const issue = errors[field]
    return issue === undefined ? undefined : refusalText(field, issue)
  }

  /** Render one labelled text input and its refusal. */
  const textField = (
    field: SshDraftField,
    labelKey: TaskBoardSshKey,
    value: string,
    onChange: (next: string) => void,
    placeholder?: string,
  ) => {
    const id = `${baseId}-${field}`
    const error = errorFor(field)
    return (
      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor={id}>{t(labelKey)}</label>
        <input
          id={id}
          className={css.input}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={event => onChange(event.target.value)}
          disabled={saving}
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
    onChange: (next: Value) => void,
  ) => {
    const error = errorFor(field)
    return (
      <fieldset className={css.field} data-invalid={error !== undefined || undefined}>
        <legend className={css.fieldLabel}>{t(labelKey)}</legend>
        <div className={css.segments}>
          {options.map(option => (
            <label key={option.value} className={css.segment}>
              <input
                type="radio"
                name={field}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                disabled={saving}
              />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </div>
        {error !== undefined && <p className={css.fieldError}>{error}</p>}
      </fieldset>
    )
  }

  const hostError = errorFor('host')
  const hostOptions = hosts.map(host => ({ alias: host.alias, label: `${host.alias} · ${host.user}@${host.host}` }))
  const hostInList = hostOptions.some(option => option.alias === draft.host)
  const agentError = errorFor('agent')

  return (
    <form className={css.form} onSubmit={submit} data-dsh-part="target-form">
      {choiceGroup(
        'mode',
        'detail.mode',
        MODES.map(value => ({ value, label: `detail.mode.${value}` as TaskBoardSshKey })),
        draft.mode,
        next => edit({ mode: next }),
      )}
      <p className={css.fieldHint}>{t(draft.mode === 'direct' ? 'detail.modeHintDirect' : 'detail.modeHintProxy')}</p>

      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor={`${baseId}-host`}>{t('detail.host')}</label>
        <select
          id={`${baseId}-host`}
          className={css.select}
          value={draft.host}
          aria-invalid={hostError !== undefined}
          aria-describedby={hostError === undefined ? `${baseId}-host-hint` : `${baseId}-host-hint ${baseId}-host-error`}
          onChange={event => edit({ host: event.target.value })}
          disabled={saving || hostOptions.length === 0}
        >
          <option value="">{t(hostOptions.length === 0 ? 'detail.hostNone' : 'detail.host')}</option>
          {!hostInList && unknownHost !== undefined && unknownHost !== '' && (
            <option value={unknownHost}>{t('detail.hostUnknown', { alias: unknownHost })}</option>
          )}
          {hostOptions.map(option => (
            <option key={option.alias} value={option.alias}>{option.label}</option>
          ))}
        </select>
        {hostOptions.length === 0 && <p className={css.fieldHint} id={`${baseId}-host-hint`}>{t('detail.hostMissing')}</p>}
        {hostError !== undefined && <p className={css.fieldError} id={`${baseId}-host-error`}>{hostError}</p>}
      </div>

      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor={`${baseId}-agent`}>{t('detail.agent')}</label>
        <select
          id={`${baseId}-agent`}
          className={css.select}
          value={draft.agent}
          aria-invalid={agentError !== undefined}
          onChange={event => edit({ agent: event.target.value as SshAgentKind })}
          disabled={saving}
        >
          {AGENTS.map(agent => (
            <option key={agent} value={agent}>{t(`detail.agent.${agent}` as TaskBoardSshKey)}</option>
          ))}
        </select>
        {agentError !== undefined && <p className={css.fieldError}>{agentError}</p>}
      </div>

      {draft.agent === 'custom' && (
        <>
          {textField('agentCommand', 'detail.agentCommand', draft.agentCommand, next => edit({ agentCommand: next }), '{prompt_file}')}
          {textField('agentResumeCommand', 'detail.agentResumeCommand', draft.agentResumeCommand, next => edit({ agentResumeCommand: next }))}
        </>
      )}

      {choiceGroup(
        'workspaceKind',
        'detail.workspace',
        WORKSPACE_KINDS.map(value => ({ value, label: `detail.workspace.${value}` as TaskBoardSshKey })),
        draft.workspaceKind,
        next => edit({ workspaceKind: next }),
      )}

      {draft.workspaceKind === 'in-place'
        ? textField('workspacePath', 'detail.workspace.path', draft.workspacePath, next => edit({ workspacePath: next }), '/home/me/project')
        : (
            <>
              {choiceGroup(
                'gitSource',
                'detail.workspace.source',
                [
                  { value: 'url' as const, label: 'detail.workspace.source.url' as TaskBoardSshKey },
                  { value: 'workspace' as const, label: 'detail.workspace.source.workspace' as TaskBoardSshKey },
                ],
                draft.gitSource,
                next => edit({ gitSource: next }),
              )}
              {draft.gitSource === 'url'
                ? (
                    <>
                      {textField('repositoryUrl', 'detail.workspace.url', draft.repositoryUrl, next => edit({ repositoryUrl: next }), 'git@example.com:team/repo.git')}
                      {textField('baseBranch', 'detail.workspace.base', draft.baseBranch, next => edit({ baseBranch: next }), 'main')}
                    </>
                  )
                : textField('workspaceId', 'detail.workspace.workspaceId', draft.workspaceId, next => edit({ workspaceId: next }), t('detail.workspace.workspaceIdPlaceholder'))}
            </>
          )}

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
