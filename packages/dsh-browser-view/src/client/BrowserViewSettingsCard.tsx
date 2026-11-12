/**
 * The real-browser CDP settings card for the Web Extensions plugin list.
 * @module @linxin666/dsh-client-ui-browser-view/client/settings-card
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PluginSettingsCard, BooleanField, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, textField, type CardActions, type CardShell, type FieldState } from './settings-form.ts'
import { createServedEntryForm } from './settings-entry-form.ts'
import { BrowserViewGuideGlyph } from './guide-icon.tsx'

/** Fields shared with the host's real-browser schema. */
export interface BrowserViewSettings {
  realBrowserEnabled?: boolean
  cdpEndpoint?: string
  idleCloseDays?: number
}

/** Card projection bound by the renderer. */
export interface BrowserViewSettingsCardState extends CardShell {
  realBrowserEnabled: FieldState
  cdpEndpoint: FieldState
  idleCloseDays: FieldState
}

/** Registration-side snapshot and write actions. */
export interface BrowserViewSettingsCardFace extends CardActions {
  hooks: {
    browserViewSettingsCard: SnapshotStore<BrowserViewSettingsCardState>
  }
}

/** Bind the existing browser-view namespace, never a second settings document. */
export function bindBrowserViewSettingsForm(ctx: ClientContext): ConfigForm<BrowserViewSettings> {
  return createServedEntryForm<BrowserViewSettings>({
    forms: ctx.configForms,
    entryIds: ['web-ui-browser-view', 'ui-browser-view', 'browser-view'],
  })

}

/** Bridge the native volatile form onto the shared staged card form. */
export class BrowserViewSettingsCardController {
  private readonly form: CardForm<BrowserViewSettings>
  private readonly store: SnapshotStore<BrowserViewSettingsCardState>

  constructor(scope: ConfigForm<BrowserViewSettings>) {
    this.form = new CardForm(scope, [
      booleanField('realBrowserEnabled'),
      textField('cdpEndpoint'),
      numberField('idleCloseDays', { integer: true, min: 0 }),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): BrowserViewSettingsCardState {
    return {
      ...this.form.shell(),
      realBrowserEnabled: this.form.field('realBrowserEnabled'),
      cdpEndpoint: this.form.field('cdpEndpoint'),
      idleCloseDays: this.form.field('idleCloseDays'),
    }
  }

  inject(): BrowserViewSettingsCardFace {
    return { hooks: { browserViewSettingsCard: this.store }, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}

/** Props supplied by the Web Extensions plugin-item seat. */
export type BrowserViewSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'browser-view'>
  & InjectFace<BrowserViewSettingsCardFace>

/** Render the real-browser card with the same chrome and field semantics as its siblings. */
export function BrowserViewSettingsCard(props: BrowserViewSettingsCardProps) {
  const { t } = props
  const state = props.useBrowserViewSettingsCard(snapshot => snapshot)
  const shared = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidValue'),
    disabled: !state.writable,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      icon={<BrowserViewGuideGlyph size={18} />}
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-browser-view-real"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...shared}
        {...state.realBrowserEnabled}
        onEdit={(text) => { props.edit('realBrowserEnabled', text) }}
        onReset={() => { props.resetField('realBrowserEnabled') }}
      />
      <ValueField
        id="settings-browser-view-endpoint"
        label={t('settings.cdpEndpoint')}
        hint={t('settings.cdpEndpointHint')}
        placeholder="http://127.0.0.1:9222"
        {...shared}
        {...state.cdpEndpoint}
        onEdit={(text) => { props.edit('cdpEndpoint', text) }}
        onReset={() => { props.resetField('cdpEndpoint') }}
      />
      <ValueField
        id="settings-browser-view-idle-days"
        label={t('settings.idleCloseDays')}
        hint={t('settings.idleCloseDaysHint')}
        placeholder="3"
        numeric
        {...shared}
        {...state.idleCloseDays}
        onEdit={(text) => { props.edit('idleCloseDays', text) }}
        onReset={() => { props.resetField('idleCloseDays') }}
      />
    </PluginSettingsCard>
  )
}
