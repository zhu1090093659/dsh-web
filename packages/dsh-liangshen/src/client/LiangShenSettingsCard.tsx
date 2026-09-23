/**
 * LiangShen settings card: availability and the wire presentation. Registers
 * into the `web-ui.plugin.item` child slot the Web UI plugin group renders,
 * bound to the `liangshen` settings namespace (the Host profile entry id).
 *
 * The presentation field does not act on this client half: the Host applies it
 * to the preset it declares to the agent-preset registry, so a session reads it
 * from its preset. This card is the operator's only handle on it, which is why
 * every field the Host schema carries appears here.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BooleanField, ChoiceField, PluginSettingsCard, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** Wire presentations the tool catalog accepts (mirrors the Host schema). */
export const PRESENTATION_CHOICES = ['ptc', 'native', 'both'] as const

/** Sensitivity presets for the circuit breaker (mirrors the Host schema). */
export const SENSITIVITY_CHOICES = ['conservative', 'balanced', 'aggressive'] as const

/** The LiangShen fields this card edits (the namespace's full schema). */
export interface LiangShenSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the plugin announces itself in every agent's system prompt. */
  announceToAgent?: boolean
  /** Wire presentation the Host applies to the preset's tool-catalog row. */
  presentation?: string
  /** Master switch for the runtime degeneration circuit breaker. */
  guardEnabled?: boolean
  /** Sensitivity preset scaling the breaker's adaptive thresholds. */
  guardSensitivity?: string
  /** Per-step reasoning-character floor for the breaker's runaway ladder. */
  guardStallReasoningChars?: number
  /** Consecutive output-free reasoning steps for the breaker's slow-burn ladder. */
  guardGlobalStallCap?: number
  /** Identical-argument tool failures for the breaker's echo ladder. */
  guardEchoFailures?: number
}

/** What the LiangShen card renders. */
export interface LiangShenSettingsCardState extends CardShell {
  enabled: CardFieldState
  announceToAgent: CardFieldState
  presentation: CardFieldState
  guardEnabled: CardFieldState
  guardSensitivity: CardFieldState
  guardStallReasoningChars: CardFieldState
  guardGlobalStallCap: CardFieldState
  guardEchoFailures: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface LiangShenSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useLiangShenSettingsCard. */
    liangShenSettingsCard: SnapshotStore<LiangShenSettingsCardState>
  }
}

/** Bridges the `liangshen` settings form onto the card's staged form. */
export class LiangShenSettingsCardController {
  private readonly form: CardForm<LiangShenSettings>
  private readonly store: SnapshotStore<LiangShenSettingsCardState>

  /** @param scope - the bound configuration form of the entry that owns this namespace. */
  constructor(scope: ConfigForm<LiangShenSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
      choiceField('presentation', PRESENTATION_CHOICES),
      booleanField('guardEnabled'),
      choiceField('guardSensitivity', SENSITIVITY_CHOICES),
      numberField('guardStallReasoningChars', { integer: true, min: 200 }),
      numberField('guardGlobalStallCap', { integer: true, min: 2 }),
      numberField('guardEchoFailures', { integer: true, min: 2 }),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LiangShenSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      presentation: this.form.field('presentation'),
      guardEnabled: this.form.field('guardEnabled'),
      guardSensitivity: this.form.field('guardSensitivity'),
      guardStallReasoningChars: this.form.field('guardStallReasoningChars'),
      guardGlobalStallCap: this.form.field('guardGlobalStallCap'),
      guardEchoFailures: this.form.field('guardEchoFailures'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): LiangShenSettingsCardFace {
    return { hooks: { liangShenSettingsCard: this.store }, ...this.form.actions() }
  }

  /** Release the card's scope subscription and bound stores. */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the LiangShen card. */
export type LiangShenSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'liangshen'>
  & InjectFace<LiangShenSettingsCardFace>

/**
 * Render the LiangShen card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function LiangShenSettingsCard(props: LiangShenSettingsCardProps) {
  const { t } = props
  const state = props.useLiangShenSettingsCard((snapshot: LiangShenSettingsCardState) => snapshot)
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidValue'),
    disabled: !state.writable,
    inheritLabel: t('settings.inherit'),
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      defaultOpen={false}
      state={state}
      renderChildrenWhenNotExposed
      hideNotExposedNotice
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-liangshen-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <BooleanField
        id="settings-liangshen-announce"
        label={t('settings.announceToAgent')}
        hint={t('settings.announceToAgentHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.announceToAgent}
        onEdit={(text) => { props.edit('announceToAgent', text) }}
        onReset={() => { props.resetField('announceToAgent') }}
      />
      <ChoiceField
        id="settings-liangshen-presentation"
        label={t('settings.presentation')}
        hint={t('settings.presentationHint')}
        choices={PRESENTATION_CHOICES.map(choice => ({ value: choice, label: t(`presentation.${choice}`) }))}
        {...fieldProps}
        {...state.presentation}
        onEdit={(text) => { props.edit('presentation', text) }}
        onReset={() => { props.resetField('presentation') }}
      />
      <BooleanField
        id="settings-liangshen-guard-enabled"
        label={t('settings.guardEnabled')}
        hint={t('settings.guardEnabledHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.guardEnabled}
        onEdit={(text) => { props.edit('guardEnabled', text) }}
        onReset={() => { props.resetField('guardEnabled') }}
      />
      <ChoiceField
        id="settings-liangshen-guard-sensitivity"
        label={t('settings.guardSensitivity')}
        hint={t('settings.guardSensitivityHint')}
        choices={SENSITIVITY_CHOICES.map(choice => ({ value: choice, label: t(`sensitivity.${choice}`) }))}
        {...fieldProps}
        {...state.guardSensitivity}
        onEdit={(text) => { props.edit('guardSensitivity', text) }}
        onReset={() => { props.resetField('guardSensitivity') }}
      />
      <ValueField
        id="settings-liangshen-guard-stall-chars"
        numeric
        label={t('settings.guardStallChars')}
        hint={t('settings.guardStallCharsHint')}
        placeholder="8000"
        {...fieldProps}
        {...state.guardStallReasoningChars}
        onEdit={(text) => { props.edit('guardStallReasoningChars', text) }}
        onReset={() => { props.resetField('guardStallReasoningChars') }}
      />
      <ValueField
        id="settings-liangshen-guard-global-cap"
        numeric
        label={t('settings.guardGlobalCap')}
        hint={t('settings.guardGlobalCapHint')}
        placeholder="4"
        {...fieldProps}
        {...state.guardGlobalStallCap}
        onEdit={(text) => { props.edit('guardGlobalStallCap', text) }}
        onReset={() => { props.resetField('guardGlobalStallCap') }}
      />
      <ValueField
        id="settings-liangshen-guard-echo"
        numeric
        label={t('settings.guardEchoFailures')}
        hint={t('settings.guardEchoFailuresHint')}
        placeholder="3"
        {...fieldProps}
        {...state.guardEchoFailures}
        onEdit={(text) => { props.edit('guardEchoFailures', text) }}
        onReset={() => { props.resetField('guardEchoFailures') }}
      />
    </PluginSettingsCard>
  )
}
