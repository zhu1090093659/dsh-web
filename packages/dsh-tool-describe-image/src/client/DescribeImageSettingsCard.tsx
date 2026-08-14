/**
 * The describe-image settings card: the vision endpoint (base URL, model,
 * key reference), the default instruction, and the call bounds. Registers
 * into the `web-ui.plugin.item` slot the Web UI Plugins group renders,
 * bound to the `describe-image` settings namespace through the family
 * settings bridge (or the official settings scope when the deployment
 * exposes the namespace directly).
 * @module @linxin666/dsh-tool-describe-image/client/DescribeImageSettingsCard
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { t } from './locales.ts'

/** The describe-image fields this card edits (the namespace's full schema). */
export interface DescribeImageSettings {
  baseURL?: string
  model?: string
  apiKey?: string
  apiKeyEnv?: string
  defaultPrompt?: string
  maxBytes?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

/** What the describe-image card renders. */
export interface DescribeImageSettingsCardState extends CardShell {
  baseURL: CardFieldState
  model: CardFieldState
  apiKey: CardFieldState
  apiKeyEnv: CardFieldState
  defaultPrompt: CardFieldState
  maxBytes: CardFieldState
  maxOutputTokens: CardFieldState
  timeoutMs: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface DescribeImageSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useDescribeImageSettingsCard. */
    describeImageSettingsCard: SnapshotStore<DescribeImageSettingsCardState>
  }
}

/** Bridges the `describe-image` scope onto the card's staged form. */
export class DescribeImageSettingsCardController {
  private readonly form: CardForm<DescribeImageSettings>
  private readonly store: SnapshotStore<DescribeImageSettingsCardState>

  /** @param scope - the bound settings scope for the `describe-image` namespace. */
  constructor(scope: SettingsScope<DescribeImageSettings>) {
    this.form = new CardForm(scope, [
      textField('baseURL'),
      textField('model'),
      textField('apiKey'),
      textField('apiKeyEnv'),
      textField('defaultPrompt'),
      numberField('maxBytes'),
      numberField('maxOutputTokens'),
      numberField('timeoutMs'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): DescribeImageSettingsCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      apiKey: this.form.field('apiKey'),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      defaultPrompt: this.form.field('defaultPrompt'),
      maxBytes: this.form.field('maxBytes'),
      maxOutputTokens: this.form.field('maxOutputTokens'),
      timeoutMs: this.form.field('timeoutMs'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): DescribeImageSettingsCardFace {
    return { hooks: { describeImageSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the describe-image card. */
export type DescribeImageSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & InjectFace<DescribeImageSettingsCardFace>

/**
 * Render the describe-image card.
 * @param props - the card snapshot and its form actions.
 * @returns the card.
 */
export function DescribeImageSettingsCard(props: DescribeImageSettingsCardProps) {
  const state = props.useDescribeImageSettingsCard(snapshot => snapshot)
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
      <ValueField
        id="settings-describe-image-baseurl"
        label={t('field.baseURL')}
        hint={t('field.baseURL.hint')}
        placeholder="https://api.example.com/v1"
        {...fieldProps}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="settings-describe-image-model"
        label={t('field.model')}
        hint={t('field.model.hint')}
        {...fieldProps}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <ValueField
        id="settings-describe-image-apikey"
        label={t('field.apiKey')}
        hint={t('field.apiKey.hint')}
        {...fieldProps}
        {...state.apiKey}
        onEdit={(text) => { props.edit('apiKey', text) }}
        onReset={() => { props.resetField('apiKey') }}
      />
      <ValueField
        id="settings-describe-image-apikeyenv"
        label={t('field.apiKeyEnv')}
        hint={t('field.apiKeyEnv.hint')}
        {...fieldProps}
        {...state.apiKeyEnv}
        onEdit={(text) => { props.edit('apiKeyEnv', text) }}
        onReset={() => { props.resetField('apiKeyEnv') }}
      />
      <ValueField
        id="settings-describe-image-defaultprompt"
        label={t('field.defaultPrompt')}
        hint={t('field.defaultPrompt.hint')}
        {...fieldProps}
        {...state.defaultPrompt}
        onEdit={(text) => { props.edit('defaultPrompt', text) }}
        onReset={() => { props.resetField('defaultPrompt') }}
      />
      <ValueField
        id="settings-describe-image-maxbytes"
        label={t('field.maxBytes')}
        hint={t('field.maxBytes.hint')}
        numeric
        {...fieldProps}
        {...state.maxBytes}
        onEdit={(text) => { props.edit('maxBytes', text) }}
        onReset={() => { props.resetField('maxBytes') }}
      />
      <ValueField
        id="settings-describe-image-maxoutputtokens"
        label={t('field.maxOutputTokens')}
        hint={t('field.maxOutputTokens.hint')}
        numeric
        {...fieldProps}
        {...state.maxOutputTokens}
        onEdit={(text) => { props.edit('maxOutputTokens', text) }}
        onReset={() => { props.resetField('maxOutputTokens') }}
      />
      <ValueField
        id="settings-describe-image-timeoutms"
        label={t('field.timeoutMs')}
        hint={t('field.timeoutMs.hint')}
        numeric
        {...fieldProps}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
    </PluginSettingsCard>
  )
}
