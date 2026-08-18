/** The Web UI plugin's top-level fault-handling settings card. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import type { RemoteSettings } from './RemoteSettingsCard.tsx'

interface FaultHandlingCardState extends CardShell {
  retryAttempts: CardFieldState
}

interface FaultHandlingCardFace extends CardActions {
  hooks: { faultHandlingCard: SnapshotStore<FaultHandlingCardState> }
}

export class FaultHandlingSettingsCardController {
  private readonly form: CardForm<RemoteSettings>
  private readonly store: SnapshotStore<FaultHandlingCardState>

  constructor(scope: SettingsScope<RemoteSettings>) {
    this.form = new CardForm(scope, [numberField('retryAttempts', { integer: true, min: 0 })])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      retryAttempts: this.form.field('retryAttempts'),
    }))
  }

  inject(): FaultHandlingCardFace {
    return { hooks: { faultHandlingCard: this.store }, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}

type FaultHandlingSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'remote'>
  & InjectFace<FaultHandlingCardFace>

export function FaultHandlingSettingsCard(props: FaultHandlingSettingsCardProps) {
  const { t } = props
  const state = props.useFaultHandlingCard(snapshot => snapshot)
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled: !state.writable,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.faultHandling"
      descriptionKey="settings.faultHandlingDescription"
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="settings-remote-retry-attempts"
        label={t('settings.retryAttempts')}
        hint={t('settings.retryAttemptsHint')}
        numeric
        {...fieldProps}
        {...state.retryAttempts}
        onEdit={(text) => { props.edit('retryAttempts', text) }}
        onReset={() => { props.resetField('retryAttempts') }}
      />
    </PluginSettingsCard>
  )
}
