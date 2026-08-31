/**
 * The dsh-perf settings card: HUD/meter toggles and alert thresholds.
 * Registers into the web-ui.plugin.item slot the Web plugins group renders,
 * bound to the dsh-perf settings namespace.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PluginSettingsCard, ValueField, BooleanField, SelectField } from './plugin-settings-card.tsx'
import { BetterSessionCard } from './better-session-card.tsx'
import { CardForm, booleanField, choiceField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The dsh-perf settings namespace shape (mirrors the host Config schema). */
export interface PerfSettings {
  enabled?: boolean
  mode?: string
  meterIntervalMs?: number
  statsWindowSeconds?: number
  alertPreset?: string
  hudEnabled?: boolean
  renderDegrade?: boolean
}

/** What the card renders. */
export interface PerfSettingsCardState extends CardShell {
  enabled: CardFieldState
  mode: CardFieldState
  meterIntervalMs: CardFieldState
  statsWindowSeconds: CardFieldState
  alertPreset: CardFieldState
  hudEnabled: CardFieldState
  renderDegrade: CardFieldState
}

/** Registration-side face injected by the slot entry. */
export interface PerfSettingsCardFace extends CardActions {
  hooks: {
    perfSettingsCard: SnapshotStore<PerfSettingsCardState>
  }
}

/** Bridges the dsh-perf scope onto the card's staged form. */
export class PerfSettingsCardController {
  private readonly form: CardForm<PerfSettings>
  private readonly store: SnapshotStore<PerfSettingsCardState>

  constructor(scope: SettingsScope<PerfSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      choiceField('mode', ['off', 'balanced', 'aggressive']),
      numberField('meterIntervalMs'),
      numberField('statsWindowSeconds'),
      choiceField('alertPreset', ['light', 'standard', 'strict']),
      booleanField('hudEnabled'),
      booleanField('renderDegrade'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): PerfSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      mode: this.form.field('mode'),
      meterIntervalMs: this.form.field('meterIntervalMs'),
      statsWindowSeconds: this.form.field('statsWindowSeconds'),
      alertPreset: this.form.field('alertPreset'),
      hudEnabled: this.form.field('hudEnabled'),
      renderDegrade: this.form.field('renderDegrade'),
    }
  }

  inject(): PerfSettingsCardFace {
    return { hooks: { perfSettingsCard: this.store }, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the dsh-perf card. */
export type PerfSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'dsh-perf'>
  & InjectFace<PerfSettingsCardFace>

/** Render the dsh-perf card. */
export function PerfSettingsCard(props: PerfSettingsCardProps) {
  const { t } = props
  const state = props.usePerfSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
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
        id="settings-perf-enabled"
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
      <div>
        <SelectField
          id="settings-perf-mode"
          options={[
            { label: t('settings.modeOff'), value: 'off' },
            { label: t('settings.modeBalanced'), value: 'balanced' },
            { label: t('settings.modeAggressive'), value: 'aggressive' },
          ]}
          value={state.mode.text}
          disabled={disabled}
          invalid={state.mode.invalid}
          onEdit={(text) => { props.edit('mode', text) }}
        />
        <p style={{ margin: '6px 0 0', opacity: 0.66, fontSize: '0.92em' }}>{t('settings.modeHint')}</p>
      </div>
      <BooleanField
        id="settings-perf-render-degrade"
        label={t('settings.renderDegrade')}
        hint={t('settings.renderDegradeHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.renderDegrade}
        onEdit={(text) => { props.edit('renderDegrade', text) }}
        onReset={() => { props.resetField('renderDegrade') }}
      />
      <div>
        <SelectField
          id="settings-perf-alert-preset"
          options={[
            { label: t('settings.alertPresetLight'), value: 'light' },
            { label: t('settings.alertPresetStandard'), value: 'standard' },
            { label: t('settings.alertPresetStrict'), value: 'strict' },
          ]}
          value={state.alertPreset.text}
          disabled={disabled}
          invalid={state.alertPreset.invalid}
          onEdit={(text) => { props.edit('alertPreset', text) }}
        />
        <p style={{ margin: '6px 0 0', opacity: 0.66, fontSize: '0.92em' }}>{t('settings.alertPresetHint')}</p>
      </div>
      <BooleanField
        id="settings-perf-hud-enabled"
        label={t('settings.hudEnabled')}
        hint={t('settings.hudEnabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.hudEnabled}
        onEdit={(text) => { props.edit('hudEnabled', text) }}
        onReset={() => { props.resetField('hudEnabled') }}
      />
      {/* Better Session 子节: 第三方外部集成(@morlay/better-session)的启用/迁移
          管理面。better-session 本身是会话性能治理, 所以管理面嵌在本卡内部,
          不再作为 Web 插件组的平级卡片。 */}
      <BetterSessionCard t={t} />
    </PluginSettingsCard>
  )
}