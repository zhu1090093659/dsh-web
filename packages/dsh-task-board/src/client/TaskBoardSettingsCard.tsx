/**
 * Task-board settings for availability, agent announcement, and optional Host
 * idle-sleep protection. Registers into the `web-ui.plugin.item` child slot
 * the Web UI plugin group renders, bound to the `task-board` namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect, useState } from 'react'
import type { TaskBoardPowerSnapshot } from '../protocol.ts'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The task-board fields this card edits (the namespace's full schema). */
export interface TaskBoardSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the board announces itself in every agent's system prompt. */
  announceToAgent?: boolean
  /** Prevent host idle sleep while sessions run or schedules are armed. */
  preventIdleSleep?: boolean
}

/** What the task-board card renders. */
export interface TaskBoardSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** System-prompt announcement flag. */
  announceToAgent: CardFieldState
  /** Idle-system-sleep protection flag. */
  preventIdleSleep: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface TaskBoardSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useTaskBoardSettingsCard. */
    taskBoardSettingsCard: SnapshotStore<TaskBoardSettingsCardState>
  }
}

/** Bridges the `task-board` scope onto the card's staged form. */
export class TaskBoardSettingsCardController {
  private readonly form: CardForm<TaskBoardSettings>
  private readonly store: SnapshotStore<TaskBoardSettingsCardState>

  /** @param scope - the bound settings scope for the `task-board` namespace. */
  constructor(scope: SettingsScope<TaskBoardSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
      booleanField('preventIdleSleep'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TaskBoardSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      preventIdleSleep: this.form.field('preventIdleSleep'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): TaskBoardSettingsCardFace {
    return { hooks: { taskBoardSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
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

/**
 * Render the task-board card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function TaskBoardSettingsCard(props: TaskBoardSettingsCardProps) {
  const { t } = props
  const state = props.useTaskBoardSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  const [power, setPower] = useState<TaskBoardPowerSnapshot | undefined>()
  useEffect(() => {
    // The SSE channel already carries power on every real change and pushes
    // one frame on subscribe; polling the full /state snapshot every 5 s
    // re-cloned and re-serialized the whole ledger server-side for one field.
    let live = true
    const events = new EventSource('/api/task-board/events')
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
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-task-board-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
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
        hint={t('settings.announceToAgentHint')}
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
        hint={t('settings.preventIdleSleepHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.preventIdleSleep}
        onEdit={(text) => { props.edit('preventIdleSleep', text) }}
        onReset={() => { props.resetField('preventIdleSleep') }}
      />
      <p>
        {t('settings.powerStatus', {
          platform: power?.platform ?? t('settings.powerUnknown'),
          phase: power?.phase ?? t('settings.powerUnknown'),
          running: String(power?.runningSessions ?? 0),
          schedules: String(power?.armedSchedules ?? 0),
        })}
      </p>
      <p>{t('settings.powerBoundary')}</p>
      {power?.lastError !== undefined && <p>{t('settings.powerError', { error: power.lastError })}</p>}
    </PluginSettingsCard>
  )
}
