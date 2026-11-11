/**
 * Task-board settings for availability, agent announcement, and optional Host
 * idle-sleep protection. Registers into the `web-ui.plugin.item` child slot
 * the Web UI plugin group renders, bound to the `task-board` namespace.
 */

import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect, useState } from 'react'
import type { TaskBoardModelCatalog, TaskBoardPowerSnapshot } from '../protocol.ts'
import type { TaskBoardExtensionDispatch } from '../core/extension.ts'
import type { ExecutionPresetOption } from '../core/controller.ts'
import { TASK_PERMISSIONS } from '../core/tasks.ts'
import { parseModelRoute, type ModelCatalogView } from '../core/model-catalog.ts'
import { CardDefaultPresetField } from './CardDefaultPresetField.tsx'
import { PluginSettingsCard, BooleanField, ChoiceField, ValueField } from './PluginSettingsCard.tsx'
import {
  modelChoiceRows,
  modelDisplayLabel,
  modelOptionsFromCatalog,
  reasoningEffortsFor,
  reasoningHintKey,
  reasoningPickerEnabled,
  reconcileReasoningEffort,
} from './board/model-options.ts'
import { SUBTASK_DEPTH_MAX, SUBTASK_DEPTH_MIN } from '../core/subtask.ts'
import { SESSION_POLL_MAX_SECONDS, SESSION_POLL_MIN_SECONDS } from '../core/poll-cadence.ts'
import { RUN_LAUNCH_WIDTH_MAX, RUN_LAUNCH_WIDTH_MIN } from '../core/launch-width.ts'
import {
  CardForm,
  booleanField,
  choiceField,
  textField,
  type CardActions,
  type CardShell,
  type FieldSpec,
  type FieldState as CardFieldState,
} from './settings-form.ts'
import type { TaskBoardKey } from './locales.ts'
import settingsCss from './board-settings.module.css'

/** The depth choices the card offers, derived from the supported range. */
const SUBTASK_DEPTH_CHOICES: readonly string[] = Array.from(
  { length: SUBTASK_DEPTH_MAX - SUBTASK_DEPTH_MIN + 1 },
  (_, index) => String(SUBTASK_DEPTH_MIN + index),
)

/**
 * The roster-poll cadence field: a whole number of seconds inside the
 * supported range, because the Host schema (`sessionPollSeconds`) is numeric.
 * A draft outside the range blocks the save instead of staging a value the
 * Host would clamp behind the user's back.
 */
function sessionPollField(): FieldSpec {
  return {
    field: 'sessionPollSeconds',
    entry: 'type',
    format: value => typeof value === 'number' && Number.isInteger(value) ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (!/^\d+$/.test(trimmed)) return undefined
      const seconds = Number(trimmed)
      return seconds >= SESSION_POLL_MIN_SECONDS && seconds <= SESSION_POLL_MAX_SECONDS
        ? { kind: 'set', value: seconds }
        : undefined
    },
  }
}

/**
 * The depth field: a choice among the supported levels whose draft text is a
 * number, because the Host schema (`maxSubtaskDepth`) is numeric. A draft
 * outside the range blocks the save instead of staging a value the Host
 * refuses.
 */
function subtaskDepthField(): FieldSpec {
  return {
    field: 'maxSubtaskDepth',
    entry: 'pick',
    format: value => typeof value === 'number' && Number.isInteger(value) ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return SUBTASK_DEPTH_CHOICES.includes(trimmed) ? { kind: 'set', value: Number(trimmed) } : undefined
    },
  }
}

/**
 * The run-launch width field: a whole number of concurrent launches inside the
 * supported range, because the Host schema (`runLaunchWidth`) is numeric. A
 * draft outside the range blocks the save instead of staging a value the Host
 * would clamp behind the user's back.
 */
function runLaunchWidthField(): FieldSpec {
  return {
    field: 'runLaunchWidth',
    entry: 'type',
    format: value => typeof value === 'number' && Number.isInteger(value) ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (!/^\d+$/.test(trimmed)) return undefined
      const width = Number(trimmed)
      return width >= RUN_LAUNCH_WIDTH_MIN && width <= RUN_LAUNCH_WIDTH_MAX
        ? { kind: 'set', value: width }
        : undefined
    },
  }
}

/**
 * The daily token cap field: whole tokens, 0 for "no gate". Every non-negative
 * whole number is a legal cap, so the draft only has to be one; a blank draft
 * clears the entry back to the schema default (0).
 */
function spendBudgetField(): FieldSpec {
  return {
    field: 'spendBudgetTokens',
    entry: 'type',
    format: value => typeof value === 'number' && Number.isInteger(value) ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (!/^\d+$/.test(trimmed)) return undefined
      return { kind: 'set', value: Number(trimmed) }
    },
  }
}

/**
 * The model-route field: blank inherits the host model catalog default, and a
 * non-blank draft must be a qualified provider/model route. An unparseable
 * draft blocks the save instead of storing a route nothing can resolve.
 * The new-card default model uses this gate so it accepts exactly the routes
 * an execution can pin.
 */
function modelRouteField(field: string): FieldSpec {
  return {
    field,
    entry: 'pick',
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return parseModelRoute(trimmed) === undefined ? undefined : { kind: 'set', value: trimmed }
    },
  }
}

/** The task-board fields this card edits (the namespace's full schema). */
export interface TaskBoardSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the board announces itself in every agent's system prompt. */
  announceToAgent?: boolean
  /** Prevent host idle sleep while sessions run or schedules are armed. */
  preventIdleSleep?: boolean
  /**
   * Whether the operator's own reverse proxy or tunnel may speak for the
   * browser (default off). Volatile, so the board's fence reads it per request.
   */
  trustForwardedProxy?: boolean
  /** Subtask depth limit (1..3); 1 means a single level of subtasks. */
  maxSubtaskDepth?: number
  /** Roster-poll cadence in seconds while the board has work to reconcile. */
  sessionPollSeconds?: number
  /**
   * How many run launches may be in flight at once (1..16, default 3). One run
   * opens its whole subtree, so this bounds the burst of sessions a single run
   * action creates; members enter the running column in batches, none is dropped.
   */
  runLaunchWidth?: number
  /**
   * Daily token ceiling for the work this board dispatches; 0 means no gate.
   * Tokens, not money: only DeepSeek's own routes are priced.
   */
  spendBudgetTokens?: number
  /**
   * Agent preset the create dialog of this board opens with. Blank pins
   * nothing, so a new card follows the deployment default as before.
   */
  cardDefaultMode?: string
  /** Permission the create dialog opens with; blank applies no default. */
  cardDefaultPermission?: string
  /** Execution model route the create dialog opens with; blank applies none. */
  cardDefaultModel?: string
  /**
   * Reasoning level bound to `cardDefaultModel`; it applies only while a
   * card's final model IS that configured route, and is inert without one.
   */
  cardDefaultReasoningEffort?: string
}

/** What the task-board card renders. */
export interface TaskBoardSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** System-prompt announcement flag. */
  announceToAgent: CardFieldState
  /** Idle-system-sleep protection flag. */
  preventIdleSleep: CardFieldState
  /** Forwarded-request trust flag. */
  trustForwardedProxy: CardFieldState
  /** Subtask depth limit field. */
  maxSubtaskDepth: CardFieldState
  /** Roster-poll cadence field. */
  sessionPollSeconds: CardFieldState
  /** Run-launch admission width field. */
  runLaunchWidth: CardFieldState
  /** Daily token cap field. */
  spendBudgetTokens: CardFieldState
  /** New-card default agent preset. */
  cardDefaultMode: CardFieldState
  /** New-card default permission. */
  cardDefaultPermission: CardFieldState
  /** New-card default model route. */
  cardDefaultModel: CardFieldState
  /** New-card default reasoning level. */
  cardDefaultReasoningEffort: CardFieldState
  /**
   * The deployment's agent-preset roster, published by the runtime read the
   * plugin wires; undefined until it answers, which leaves the default-preset
   * field offering the inherit choice alone.
   */
  presets?: readonly ExecutionPresetOption[]
}

/** The registration-side face the card's slot entry injects. */
export interface TaskBoardSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useTaskBoardSettingsCard. */
    taskBoardSettingsCard: SnapshotStore<TaskBoardSettingsCardState>
  }
  /** Deliver one provider action over the board's same-origin channel. */
  dispatch: TaskBoardExtensionDispatch
}

/** Bridges the `task-board` settings form onto the card's staged form. */
export class TaskBoardSettingsCardController {
  private readonly form: CardForm<TaskBoardSettings>
  private readonly store: SnapshotStore<TaskBoardSettingsCardState>
  /** The deployment's agent-preset roster, once its runtime read has answered. */
  private presets: readonly ExecutionPresetOption[] | undefined

  /** @param scope - the bound configuration form for the `task-board` namespace. */
  constructor(scope: ConfigForm<TaskBoardSettings>, private readonly dispatch: TaskBoardExtensionDispatch) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
      booleanField('preventIdleSleep'),
      booleanField('trustForwardedProxy'),
      subtaskDepthField(),
      sessionPollField(),
      runLaunchWidthField(),
      spendBudgetField(),
      // The new-card defaults: blank is a real value every one of them keeps
      // ("apply no default"), which is why they are applied like any other field
      // and only their parse rules differ.
      textField('cardDefaultMode', 'pick'),
      choiceField('cardDefaultPermission', TASK_PERMISSIONS),
      modelRouteField('cardDefaultModel'),
      textField('cardDefaultReasoningEffort', 'pick'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TaskBoardSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      preventIdleSleep: this.form.field('preventIdleSleep'),
      trustForwardedProxy: this.form.field('trustForwardedProxy'),
      maxSubtaskDepth: this.form.field('maxSubtaskDepth'),
      sessionPollSeconds: this.form.field('sessionPollSeconds'),
      runLaunchWidth: this.form.field('runLaunchWidth'),
      spendBudgetTokens: this.form.field('spendBudgetTokens'),
      cardDefaultMode: this.form.field('cardDefaultMode'),
      cardDefaultPermission: this.form.field('cardDefaultPermission'),
      cardDefaultModel: this.form.field('cardDefaultModel'),
      cardDefaultReasoningEffort: this.form.field('cardDefaultReasoningEffort'),
      ...(this.presets === undefined ? {} : { presets: this.presets }),
    }
  }

  /**
   * Publish the deployment's agent-preset roster to the default-preset field.
   * The roster is a runtime fact read outside this card (src/client/index.ts
   * wires it once for both the board's pickers and this topic); it can arrive
   * late or not at all, and until it does the field lists the inherit choice
   * alone. This never blocks a save: a deployment that serves no roster still
   * has a writable settings document.
   * @param presets - the roster rows.
   */
  setPresetRoster(presets: readonly ExecutionPresetOption[]): void {
    this.presets = presets
    this.store.set(this.projection())
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): TaskBoardSettingsCardFace {
    return { hooks: { taskBoardSettingsCard: this.store }, ...this.form.actions(), dispatch: this.dispatch }
  }

  /**
   * Release the card's form subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the task-board card. */
export type TaskBoardSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'task-board'>
  & InjectFace<TaskBoardSettingsCardFace>
  & PropsRenderSlots<'task-board.settings.section'>

/** Kanban mark for the card header: three columns of unequal depth. */
function BoardMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.2" y="2.6" width="3.9" height="12.8" rx="1.95" fill="currentColor" />
      <rect x="7.05" y="2.6" width="3.9" height="7.6" rx="1.95" fill="currentColor" />
      <rect x="11.9" y="2.6" width="3.9" height="10.2" rx="1.95" fill="currentColor" />
    </svg>
  )
}

/**
 * Render the task-board card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function TaskBoardSettingsCard(props: TaskBoardSettingsCardProps) {
  const { t, renderSlot, dispatch } = props
  const state = props.useTaskBoardSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  const [power, setPower] = useState<TaskBoardPowerSnapshot | undefined>()
  const [modelCatalog, setModelCatalog] = useState<TaskBoardModelCatalog | undefined>()
  useEffect(() => {
    // The SSE channel already carries power on every real change and pushes
    // one frame on subscribe; polling the full /state snapshot every 5 s
    // re-cloned and re-serialized the whole ledger server-side for one field.
    let live = true
    void fetch('api/task-board/model-catalog')
      .then(r => r.ok ? r.json() : undefined)
      .then((data: TaskBoardModelCatalog | undefined) => {
        if (data?.catalog && live) setModelCatalog(data)
      })
      .catch(() => {})
    const events = new EventSource('api/task-board/events')
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const frame = JSON.parse(message.data) as { power?: TaskBoardPowerSnapshot }
        if (frame.power !== undefined && live) setPower(frame.power)
      } catch {
        // The settings form remains usable while the host status is reconnecting.
      }
    }
    return () => { live = false; events.close() }
  }, [])
  const catalog: ModelCatalogView = modelCatalog?.catalog ?? { groups: [] }
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  // The new-card-defaults topic reads the SAME catalog the create dialog reads (session/modelCatalog, served here through the
  // model-catalog payload), normalized once into the roster the reasoning
  // helpers below consume, so the default level can only offer levels the
  // chosen default model really declares.
  const defaultModels = modelOptionsFromCatalog(catalog)
  const defaultModel = state.cardDefaultModel.text
  const defaultEffortChoices = reasoningEffortsFor(defaultModels, defaultModel)
    .map(effort => ({ value: effort, label: effort }))
  /**
   * Drop a staged default level the newly picked default model cannot honour,
   * exactly as the create dialog's own model picker does (one shared rule):
   * the level belongs to the route it was chosen for.
   */
  const dropUnhonouredEffort = (nextModel: string): void => {
    const current = state.cardDefaultReasoningEffort.text
    const kept = reconcileReasoningEffort(defaultModels, nextModel, current)
    if (kept !== current) props.edit('cardDefaultReasoningEffort', kept)
  }
  // Chrome state of the nested disclosure cards below: they stage into this
  // card's form and are written by its one save, so they carry no footer and no
  // unsaved pill of their own (the outer header owns the pill).
  const nestedShell: CardShell = {
    available: true,
    exposed: true,
    writable: state.writable,
    dirty: false,
    invalid: state.invalid,
    saving: state.saving,
    failed: false,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      icon={<BoardMark />}
      defaultOpen={false}
      state={state}
      renderChildrenWhenNotExposed
      hideNotExposedNotice
      onSave={props.save}
      onDiscard={props.discard}
    >
      {/* The board's own settings are nested disclosure cards, so an expanded
          card reads as a short topic list: the board and its runtime behavior,
          and whatever a provider contributes (a provider
          extension registers into the seat rendered last). Every one
          of them starts collapsed and shares this card's single save. */}
      <ul className={settingsCss.nestedCards}>
        <PluginSettingsCard
          t={t}
          density="nested"
          titleKey="settings.enabledTopic"
          descriptionKey="settings.enabledCardHint"
          defaultOpen={false}
          hideFooter
          state={nestedShell}
          onSave={props.save}
          onDiscard={props.discard}
        >
          <BooleanField
            id="settings-task-board-enabled"
            label={t('settings.enabled')}
            hint={t('settings.enabledHintBrief')}
            hintTitle={t('settings.enabledHint')}
            inheritLabel={t('settings.inherit')}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            {...fieldProps}
            {...state.enabled}
            onEdit={(text) => { props.edit('enabled', text) }}
            onReset={() => { props.resetField('enabled') }}
          />
          <BooleanField
            id="settings-task-board-announce"
            label={t('settings.announceToAgent')}
            hint={t('settings.announceToAgentHintBrief')}
            hintTitle={t('settings.announceToAgentHint')}
            inheritLabel={t('settings.inherit')}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            {...fieldProps}
            {...state.announceToAgent}
            onEdit={(text) => { props.edit('announceToAgent', text) }}
            onReset={() => { props.resetField('announceToAgent') }}
          />
          <BooleanField
            id="settings-task-board-prevent-idle-sleep"
            label={t('settings.preventIdleSleep')}
            hint={t('settings.preventIdleSleepHintBrief')}
            hintTitle={t('settings.preventIdleSleepHint')}
            inheritLabel={t('settings.inherit')}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            {...fieldProps}
            {...state.preventIdleSleep}
            onEdit={(text) => { props.edit('preventIdleSleep', text) }}
            onReset={() => { props.resetField('preventIdleSleep') }}
          />
          <BooleanField
            id="settings-task-board-trust-forwarded-proxy"
            label={t('settings.trustForwardedProxy')}
            hint={t('settings.trustForwardedProxyHintBrief')}
            hintTitle={t('settings.trustForwardedProxyHint')}
            inheritLabel={t('settings.inherit')}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            {...fieldProps}
            {...state.trustForwardedProxy}
            onEdit={(text) => { props.edit('trustForwardedProxy', text) }}
            onReset={() => { props.resetField('trustForwardedProxy') }}
          />
          <ValueField
            id="settings-task-board-session-poll"
            label={t('settings.sessionPollSeconds')}
            hint={t('settings.sessionPollSecondsHintBrief')}
            hintTitle={t('settings.sessionPollSecondsHint')}
            numeric
            range={{ min: SESSION_POLL_MIN_SECONDS, max: SESSION_POLL_MAX_SECONDS, step: 1 }}
            {...fieldProps}
            {...state.sessionPollSeconds}
            onEdit={(text) => { props.edit('sessionPollSeconds', text) }}
            onReset={() => { props.resetField('sessionPollSeconds') }}
          />
          <ChoiceField
            id="settings-task-board-subtask-depth"
            label={t('settings.maxSubtaskDepth')}
            hint={t('settings.maxSubtaskDepthHintBrief')}
            hintTitle={t('settings.maxSubtaskDepthHint')}
            inheritLabel={t('settings.inherit')}
            choices={SUBTASK_DEPTH_CHOICES.map(value => ({
              value,
              label: t('settings.maxSubtaskDepthOption', { depth: value }),
            }))}
            {...fieldProps}
            {...state.maxSubtaskDepth}
            onEdit={(text) => { props.edit('maxSubtaskDepth', text) }}
            onReset={() => { props.resetField('maxSubtaskDepth') }}
          />
          <ValueField
            id="settings-task-board-run-launch-width"
            label={t('settings.runLaunchWidth')}
            hint={t('settings.runLaunchWidthHintBrief')}
            hintTitle={t('settings.runLaunchWidthHint')}
            numeric
            range={{ min: RUN_LAUNCH_WIDTH_MIN, max: RUN_LAUNCH_WIDTH_MAX, step: 1 }}
            {...fieldProps}
            {...state.runLaunchWidth}
            onEdit={(text) => { props.edit('runLaunchWidth', text) }}
            onReset={() => { props.resetField('runLaunchWidth') }}
          />
          <ValueField
            id="settings-task-board-spend-budget"
            label={t('settings.spendBudgetTokens')}
            hint={t('settings.spendBudgetTokensHintBrief')}
            hintTitle={t('settings.spendBudgetTokensHint')}
            numeric
            {...fieldProps}
            {...state.spendBudgetTokens}
            onEdit={(text) => { props.edit('spendBudgetTokens', text) }}
            onReset={() => { props.resetField('spendBudgetTokens') }}
          />
        </PluginSettingsCard>

        {/* New-card defaults: what the create dialog opens with, and what the
            Host create path fills an omitted target from when the caller opts
            in. Every field's blank choice is a real value — "apply no default"
            — so a deployment that configures none of them creates cards
            exactly as it did before this topic existed. */}
        <PluginSettingsCard
          t={t}
          density="nested"
          titleKey="settings.cardDefaultsTitle"
          descriptionKey="settings.cardDefaultsCardBrief"
          descriptionTitleKey="settings.cardDefaultsCardHint"
          defaultOpen={false}
          hideFooter
          state={nestedShell}
          onSave={props.save}
          onDiscard={props.discard}
        >
          <CardDefaultPresetField
            id="settings-task-board-card-default-mode"
            label={t('new.agentPreset')}
            hint={t('settings.cardDefaultModeHintBrief')}
            hintTitle={t('settings.cardDefaultModeHint')}
            presets={state.presets}
            {...fieldProps}
            {...state.cardDefaultMode}
            onEdit={(text) => { props.edit('cardDefaultMode', text) }}
            onReset={() => { props.resetField('cardDefaultMode') }}
          />
          <ChoiceField
            id="settings-task-board-card-default-permission"
            label={t('new.permission')}
            hint={t('settings.cardDefaultPermissionHintBrief')}
            hintTitle={t('settings.cardDefaultPermissionHint')}
            inheritLabel={t('exec.permission.default')}
            choices={TASK_PERMISSIONS.map(id => ({ value: id, label: t(`exec.permission.${id}` as TaskBoardKey) }))}
            {...fieldProps}
            {...state.cardDefaultPermission}
            onEdit={(text) => { props.edit('cardDefaultPermission', text) }}
            onReset={() => { props.resetField('cardDefaultPermission') }}
          />
          <ChoiceField
            id="settings-task-board-card-default-model"
            label={t('new.model')}
            hint={t('settings.cardDefaultModelHintBrief')}
            hintTitle={t('settings.cardDefaultModelHint')}
            inheritLabel={t('exec.model.default')}
            choices={modelChoiceRows(defaultModels)}
            {...fieldProps}
            {...state.cardDefaultModel}
            onEdit={(text) => {
              props.edit('cardDefaultModel', text)
              dropUnhonouredEffort(text)
            }}
            onReset={() => {
              props.resetField('cardDefaultModel')
              // A blank default model carries no route for a level to bind to,
              // so the staged default level goes with it.
              dropUnhonouredEffort('')
            }}
          />
          <ChoiceField
            id="settings-task-board-card-default-effort"
            label={t('exec.reasoning')}
            hint={t(reasoningHintKey(defaultModels, defaultModel))}
            inheritLabel={t('exec.reasoning.inherit')}
            choices={defaultEffortChoices}
            {...fieldProps}
            {...state.cardDefaultReasoningEffort}
            // The levels on offer are the declared ones of the picked default
            // model, so without a model that declares any there is nothing to
            // choose: the selector locks instead of offering a level no model
            // would accept.
            disabled={disabled || !reasoningPickerEnabled(defaultModels, defaultModel)}
            onEdit={(text) => { props.edit('cardDefaultReasoningEffort', text) }}
            onReset={() => { props.resetField('cardDefaultReasoningEffort') }}
          />
        </PluginSettingsCard>

        {/* Provider sections: a family extension contributes its own nested
            settings card into this list through the seat this card declares —
            the family provider extension is the one that does. Each
            contributed card keeps its own chrome and save row, and an empty
            seat draws nothing. */}
        {renderSlot('task-board.settings.section', { dispatch })}
      </ul>
      {/* Live power facts as label/value rows, then the battery caveat: quiet
          small print that closes the card instead of a run-on sentence. */}
      <div className={settingsCss.power}>
        <dl className={settingsCss.powerFacts}>
          <dt className={settingsCss.powerTerm}>{t('settings.powerPlatform')}</dt>
          <dd className={settingsCss.powerValue}>{power?.platform ?? t('settings.powerUnknown')}</dd>
          <dt className={settingsCss.powerTerm}>{t('settings.powerPhase')}</dt>
          <dd className={settingsCss.powerValue}>{power?.phase ?? t('settings.powerUnknown')}</dd>
          <dt className={settingsCss.powerTerm}>{t('settings.powerRunning')}</dt>
          <dd className={settingsCss.powerValue}>{String(power?.runningSessions ?? 0)}</dd>
          <dt className={settingsCss.powerTerm}>{t('settings.powerSchedules')}</dt>
          <dd className={settingsCss.powerValue}>{String(power?.armedSchedules ?? 0)}</dd>
        </dl>
        <p className={settingsCss.powerLine}>{t('settings.powerBoundary')}</p>
        {power?.lastError !== undefined && (
          <p className={settingsCss.powerError}>{t('settings.powerError', { error: power.lastError })}</p>
        )}
      </div>
    </PluginSettingsCard>
  )
}
