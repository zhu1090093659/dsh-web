/**
 * The live-stats settings card: the token-estimation density parameters.
 * Registers into the `settings.plugin.item` slot the plugin-configuration
 * section renders, bound to the `live-stats` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The live-stats fields this card edits (the namespace's full schema). */
export interface LiveStatsSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Approximate text characters represented by one token. */
  charsPerToken?: number
  /** Fixed framing tokens assigned to each content block. */
  blockOverhead?: number
  /** Fixed framing tokens assigned to each message or assistant response. */
  roleOverhead?: number
}

/** What the live-stats card renders. */
export interface LiveStatsSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Characters per token. */
  charsPerToken: CardFieldState
  /** Per-content-block framing tokens. */
  blockOverhead: CardFieldState
  /** Per-message framing tokens. */
  roleOverhead: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface LiveStatsSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useLiveStatsSettingsCard. */
    liveStatsSettingsCard: SnapshotStore<LiveStatsSettingsCardState>
  }
}

/** Bridges the `live-stats` scope onto the card's staged form. */
export class LiveStatsSettingsCardController {
  private readonly form: CardForm<LiveStatsSettings>
  private readonly store: SnapshotStore<LiveStatsSettingsCardState>

  /** @param scope - the bound settings scope for the `live-stats` namespace. */
  constructor(scope: SettingsScope<LiveStatsSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('charsPerToken', { min: 0.01 }),
      numberField('blockOverhead', { integer: true, min: 0 }),
      numberField('roleOverhead', { integer: true, min: 0 }),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LiveStatsSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      charsPerToken: this.form.field('charsPerToken'),
      blockOverhead: this.form.field('blockOverhead'),
      roleOverhead: this.form.field('roleOverhead'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): LiveStatsSettingsCardFace {
    return { hooks: { liveStatsSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the live-stats card. */
export type LiveStatsSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'live-stats'>
  & InjectFace<LiveStatsSettingsCardFace>

/**
 * Render the live-stats card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function LiveStatsSettingsCard(props: LiveStatsSettingsCardProps) {
  const { t } = props
  const state = props.useLiveStatsSettingsCard(snapshot => snapshot)
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
        id="settings-live-stats-enabled"
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
      <ValueField
        id="settings-live-stats-chars"
        label={t('settings.charsPerToken')}
        hint={t('settings.charsPerTokenHint')}
        numeric
        {...fieldProps}
        {...state.charsPerToken}
        onEdit={(text) => { props.edit('charsPerToken', text) }}
        onReset={() => { props.resetField('charsPerToken') }}
      />
      <ValueField
        id="settings-live-stats-block"
        label={t('settings.blockOverhead')}
        hint={t('settings.blockOverheadHint')}
        numeric
        {...fieldProps}
        {...state.blockOverhead}
        onEdit={(text) => { props.edit('blockOverhead', text) }}
        onReset={() => { props.resetField('blockOverhead') }}
      />
      <ValueField
        id="settings-live-stats-role"
        label={t('settings.roleOverhead')}
        hint={t('settings.roleOverheadHint')}
        numeric
        {...fieldProps}
        {...state.roleOverhead}
        onEdit={(text) => { props.edit('roleOverhead', text) }}
        onReset={() => { props.resetField('roleOverhead') }}
      />
    </PluginSettingsCard>
  )
}
