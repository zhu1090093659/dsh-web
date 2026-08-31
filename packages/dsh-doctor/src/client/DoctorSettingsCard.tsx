/**
 * The dsh-doctor plugin settings card inside the Web UI plugin group
 * (Settings → Web UI plugins): the enable switch plus the safety policy
 * toggles, staged through the family card form, and the live recovery
 * console embedded below them. Bound to the `doctor` settings namespace so
 * toggling enabled on also mounts the host diagnostic endpoints and
 * heartbeats.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { BooleanField, PluginSettingsCard } from './PluginSettingsCard.tsx'
import { booleanField, CardForm, type CardActions, type CardShell, type FieldState } from './settings-form.ts'
import { DoctorRecoveryConsole } from './DoctorRecoveryConsole.tsx'
import type { DoctorController } from './doctor-controller.ts'

/** The doctor namespace fields this card edits (the host section schema). */
export interface DoctorSettings {
  /** Master switch; the host mounts recovery routes only while enabled. */
  enabled?: boolean
  /** Install the Supervisor and launcher on enable. */
  fullProtection?: boolean
  /** Allow deterministic repairs to promote after the isolated gates pass. */
  autoRepair?: boolean
  /** Automatically migrate legacy aggregate packages before starting DSH. */
  autoMigrate?: boolean
  /** Host heartbeat cadence in milliseconds. */
  heartbeatIntervalMs?: number
}

/** What the doctor card renders. */
export interface DoctorSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: FieldState
  /** Full protection switch. */
  fullProtection: FieldState
  /** Auto repair switch. */
  autoRepair: FieldState
  /** Auto migrate switch. */
  autoMigrate: FieldState
}

/** The registration-side face the card slot entry injects. */
export interface DoctorSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useDoctorSettingsCard. */
    doctorSettingsCard: SnapshotStore<DoctorSettingsCardState>
  }
  /** The live recovery console controller (null when the polling loop is unavailable). */
  controller: DoctorController | null
}

/** Bridges the `doctor` scope onto the card staged form. */
export class DoctorSettingsCardController {
  private readonly form: CardForm<DoctorSettings>
  private readonly store: SnapshotStore<DoctorSettingsCardState>

  /** @param scope - the bound settings scope for the `doctor` namespace. */
  constructor(scope: SettingsScope<DoctorSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('fullProtection'),
      booleanField('autoRepair'),
      booleanField('autoMigrate'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): DoctorSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      fullProtection: this.form.field('fullProtection'),
      autoRepair: this.form.field('autoRepair'),
      autoMigrate: this.form.field('autoMigrate'),
    }
  }

  /** Build the form face the card slot registration injects. */
  inject(): Pick<DoctorSettingsCardFace, 'hooks'> & CardActions {
    return { hooks: { doctorSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the doctor card. */
export type DoctorSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'doctor'>
  & InjectFace<DoctorSettingsCardFace>

/**
 * Render the doctor card.
 * @param props - locale copy, the card snapshot, form actions, and the console controller.
 * @returns the card.
 */
export function DoctorSettingsCard(props: DoctorSettingsCardProps) {
  const { t } = props
  const state = props.useDoctorSettingsCard(snapshot => snapshot)
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled: !state.writable,
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
        id="settings-doctor-enabled"
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
        id="settings-doctor-full-protection"
        label={t('settings.fullProtection')}
        hint={t('settings.fullProtectionHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.fullProtection}
        onEdit={(text) => { props.edit('fullProtection', text) }}
        onReset={() => { props.resetField('fullProtection') }}
      />
      <BooleanField
        id="settings-doctor-auto-migrate"
        label={t('settings.autoMigrate')}
        hint={t('settings.autoMigrateHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.autoMigrate}
        onEdit={(text) => { props.edit('autoMigrate', text) }}
        onReset={() => { props.resetField('autoMigrate') }}
      />
      <BooleanField
        id="settings-doctor-auto-repair"
        label={t('settings.autoRepair')}
        hint={t('settings.autoRepairHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.autoRepair}
        onEdit={(text) => { props.edit('autoRepair', text) }}
        onReset={() => { props.resetField('autoRepair') }}
      />
      {props.controller === null
        ? <p role="status">{t('settings.controllerUnavailable')}</p>
        : (
          <DoctorRecoveryConsole
            t={t}
            controller={props.controller}
            settings={null}
            embedded
          />
        )}
    </PluginSettingsCard>
  )
}
