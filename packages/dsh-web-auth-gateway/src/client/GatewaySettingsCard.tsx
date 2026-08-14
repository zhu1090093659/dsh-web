import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, type CardActions, type CardShell, type FieldState } from './settings-form.ts'

export interface GatewaySettings { enabled?: boolean; port?: number; sessionTtlHours?: number }
interface State extends CardShell { enabled: FieldState; port: FieldState; sessionTtlHours: FieldState }
interface Face extends CardActions { hooks: { gatewaySettingsCard: SnapshotStore<State> } }
export class GatewaySettingsCardController {
  private readonly form: CardForm<GatewaySettings>
  private readonly store: SnapshotStore<State>
  constructor(scope: SettingsScope<GatewaySettings>) {
    this.form = new CardForm(scope, [booleanField('enabled'), numberField('port', { integer: true, min: 1 }), numberField('sessionTtlHours', { integer: true, min: 1 })])
    this.store = this.form.bind(() => ({ ...this.form.shell(), enabled: this.form.field('enabled'), port: this.form.field('port'), sessionTtlHours: this.form.field('sessionTtlHours') }))
  }
  inject(): Face { return { hooks: { gatewaySettingsCard: this.store }, ...this.form.actions() } }
}
type Props = PropsRuntime<'web-ui.plugin.item'> & PropsLocale<'web-auth-gateway'> & InjectFace<Face>
export function GatewaySettingsCard(props: Props) {
  const { t } = props; const state = props.useGatewaySettingsCard(value => value); const disabled = !state.writable
  const common = { overriddenLabel: t('settings.overridden'), resetLabel: t('settings.reset'), invalidLabel: t('settings.invalidNumber'), disabled }
  return <PluginSettingsCard t={t} titleKey="settings.title" descriptionKey="settings.description" state={state} onSave={props.save} onDiscard={props.discard}>
    <BooleanField id="settings-gateway-enabled" label={t('settings.enabled')} hint={t('settings.enabledHint')} inheritLabel={t('settings.inherit')} onLabel={t('settings.on')} offLabel={t('settings.off')} {...common} {...state.enabled} onEdit={text => props.edit('enabled', text)} onReset={() => props.resetField('enabled')} />
    <ValueField id="settings-gateway-port" label={t('settings.port')} hint={t('settings.portHint')} numeric {...common} {...state.port} onEdit={text => props.edit('port', text)} onReset={() => props.resetField('port')} />
    <ValueField id="settings-gateway-ttl" label={t('settings.ttl')} hint={t('settings.ttlHint')} numeric {...common} {...state.sessionTtlHours} onEdit={text => props.edit('sessionTtlHours', text)} onReset={() => props.resetField('sessionTtlHours')} />
  </PluginSettingsCard>
}
