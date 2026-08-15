/**
 * The mermaid settings card: the render enable toggle and the diagram theme
 * choice. Registers into the `web-ui.plugin.item` slot the Web UI plugins
 * group renders, bound to the `mermaid` settings namespace through the
 * family settings bridge (or the official settings scope when the deployment
 * exposes the namespace directly).
 * @module @linxin666/dsh-client-ui-mermaid/client/MermaidSettingsCard
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField, ChoiceField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { MERMAID_THEMES, type MermaidThemeSetting } from '../core/themes.ts'
import { t } from './locales.ts'

/** The mermaid fields this card edits (the namespace's full schema). */
export interface MermaidSettings {
  enabled?: boolean
  theme?: string
}

/** What the mermaid card renders. */
export interface MermaidSettingsCardState extends CardShell {
  enabled: CardFieldState
  theme: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface MermaidSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMermaidSettingsCard. */
    mermaidSettingsCard: SnapshotStore<MermaidSettingsCardState>
  }
}

/** Bridges the `mermaid` scope onto the card's staged form. */
export class MermaidSettingsCardController {
  private readonly form: CardForm<MermaidSettings>
  private readonly store: SnapshotStore<MermaidSettingsCardState>

  /** @param scope - the bound settings scope for the `mermaid` namespace. */
  constructor(scope: SettingsScope<MermaidSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      choiceField('theme', [...MERMAID_THEMES]),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): MermaidSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      theme: this.form.field('theme'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): MermaidSettingsCardFace {
    return { hooks: { mermaidSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the mermaid card. */
export type MermaidSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & InjectFace<MermaidSettingsCardFace>

/** Choice list over the selectable themes. */
const THEME_CHOICES = MERMAID_THEMES.map(theme => ({
  value: theme,
  label: t(`field.theme.${theme satisfies MermaidThemeSetting}`),
}))

/**
 * Render the mermaid card.
 * @param props - the card snapshot and its form actions.
 * @returns the card.
 */
export function MermaidSettingsCard(props: MermaidSettingsCardProps) {
  const state = props.useMermaidSettingsCard(snapshot => snapshot)
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
      titleKey="card.title"
      descriptionKey="card.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-mermaid-enabled"
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
      <ChoiceField
        id="settings-mermaid-theme"
        label={t('field.theme')}
        hint={t('field.theme.hint')}
        inheritLabel={t('settings.inherit')}
        choices={THEME_CHOICES}
        {...fieldProps}
        {...state.theme}
        onEdit={(text) => { props.edit('theme', text) }}
        onReset={() => { props.resetField('theme') }}
      />
    </PluginSettingsCard>
  )
}
