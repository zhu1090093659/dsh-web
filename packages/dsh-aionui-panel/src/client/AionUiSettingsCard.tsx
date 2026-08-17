/**
 * The aionui-panel settings card: the total on/off switch (issue #307).
 * Registers into the `web-ui.plugin.item` slot the Web UI Plugins group
 * renders, bound to the `aionui-panel` settings namespace through the family
 * settings bridge (or the official settings scope when the deployment exposes
 * the namespace directly). Turning the panel off unmounts the right-panel
 * columns, the floating expand button, the /aionui-panel/* routes and the
 * workspace fs watch + git polling behind them.
 * @module @linxin666/dsh-client-ui-aionui-panel/client/AionUiSettingsCard
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The aionui-panel fields this card edits (the namespace's full schema). */
export interface AionUiPanelSettings {
  /** Whether the right-panel system (columns, floating button, routes, watch/polling) is mounted at all; default on. */
  enabled?: boolean
}

/** What the aionui-panel card renders. */
export interface AionUiSettingsCardState extends CardShell {
  enabled: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface AionUiSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAionUiSettingsCard. */
    aionUiSettingsCard: SnapshotStore<AionUiSettingsCardState>
  }
}

/** Bridges the `aionui-panel` scope onto the card's staged form. */
export class AionUiSettingsCardController {
  private readonly form: CardForm<AionUiPanelSettings>
  private readonly store: SnapshotStore<AionUiSettingsCardState>

  /** @param scope - the bound settings scope for the `aionui-panel` namespace. */
  constructor(scope: SettingsScope<AionUiPanelSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AionUiSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AionUiSettingsCardFace {
    return { hooks: { aionUiSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the aionui-panel card. */
export type AionUiSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'aionui-panel'>
  & InjectFace<AionUiSettingsCardFace>

/**
 * Render the aionui-panel card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function AionUiSettingsCard(props: AionUiSettingsCardProps) {
  const { t } = props
  const state = props.useAionUiSettingsCard(snapshot => snapshot)
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
        id="settings-aionui-panel-enabled"
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
    </PluginSettingsCard>
  )
}
