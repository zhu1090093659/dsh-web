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
import { PluginSettingsCard, BooleanField, ChoiceField, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, numberField, secretField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { fetchEndpointModels, testEndpointModel } from './model-probe.ts'
import { NativeImageSection } from './NativeImageSection.tsx'
import { t } from './locales.ts'
import cardCss from './settings-card.module.css'
import css from './probe.module.css'

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
  apiStyle?: 'chat-completions' | 'responses' | 'anthropic-messages'
  renderImagePreview?: boolean
  interceptImageSend?: boolean
}

/** The probe button's live state between clicks. */
export interface ProbeState {
  /** idle before the first click, running while a request crosses the wire. */
  status: 'idle' | 'running'
  /** Which action is running (or ran last), so the status line words itself. */
  pending?: 'fetch' | 'test'
  /** Model ids the last successful listing returned, in listing order. */
  models: string[]
  /** Round-trip milliseconds of the last successful model ping. */
  latencyMs?: number
  /** The failure reason the last action surfaced; absent until one fails. */
  error?: string
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
  apiStyle: CardFieldState
  renderImagePreview: CardFieldState
  interceptImageSend: CardFieldState
  probe: ProbeState
}

/** The registration-side face the card's slot entry injects. */
export interface DescribeImageSettingsCardFace extends CardActions {
  /** List the endpoint's models against the card's current connection drafts. */
  fetchModels: () => void
  /** Ping the selected model once and report its round-trip latency. */
  testModel: () => void
  hooks: {
    /** Card snapshot bound by the renderer as useDescribeImageSettingsCard. */
    describeImageSettingsCard: SnapshotStore<DescribeImageSettingsCardState>
  }
}

/** Bridges the `describe-image` scope onto the card's staged form. */
export class DescribeImageSettingsCardController {
  private readonly form: CardForm<DescribeImageSettings>
  private readonly store: SnapshotStore<DescribeImageSettingsCardState>
  private probeState: ProbeState = { status: 'idle', models: [] }
  private disposed = false

  /** @param scope - the bound settings scope for the `describe-image` namespace. */
  constructor(scope: SettingsScope<DescribeImageSettings>) {
    this.form = new CardForm(scope, [
      textField('baseURL'),
      textField('model'),
      choiceField('apiStyle', ['chat-completions', 'responses', 'anthropic-messages']),
      secretField('apiKey'),
      textField('apiKeyEnv'),
      textField('defaultPrompt'),
      numberField('maxBytes'),
      numberField('maxOutputTokens'),
      numberField('timeoutMs'),
      booleanField('renderImagePreview'),
      booleanField('interceptImageSend'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  /**
   * List the endpoint named by the card's current drafts. Drafts ride the
   * request so an unsaved endpoint can be verified before saving; the key
   * never crosses into the browser. A failed listing drops any stale list.
   */
  fetchModels(): void {
    if (this.disposed || this.probeState.status === 'running') return
    const draft = {
      baseURL: this.form.field('baseURL').text,
      apiStyle: this.form.field('apiStyle').text,
      apiKey: this.form.field('apiKey').text,
    }
    this.probeState = { ...this.probeState, status: 'running', pending: 'fetch', error: undefined }
    this.publish()
    void fetchEndpointModels(draft).then((result) => {
      if (this.disposed) return
      this.probeState = result.ok
        ? { status: 'idle', pending: 'fetch', models: result.models }
        : { status: 'idle', pending: 'fetch', models: [], error: result.message }
      this.publish()
    })
  }

  /**
   * Ping the selected model once: one minimal completion call whose
   * round-trip latency is the model's own first-response time. Hidden until
   * the model field carries a value; the listing stays while it runs.
   */
  testModel(): void {
    if (this.disposed || this.probeState.status === 'running') return
    const model = this.form.field('model').text
    if (model.trim() === '') return
    const draft = {
      baseURL: this.form.field('baseURL').text,
      apiStyle: this.form.field('apiStyle').text,
      apiKey: this.form.field('apiKey').text,
      model,
    }
    this.probeState = { ...this.probeState, status: 'running', pending: 'test', latencyMs: undefined, error: undefined }
    this.publish()
    void testEndpointModel(draft).then((result) => {
      if (this.disposed) return
      this.probeState = result.ok
        ? { ...this.probeState, status: 'idle', pending: 'test', latencyMs: result.latencyMs }
        : { ...this.probeState, status: 'idle', pending: 'test', error: result.message }
      this.publish()
    })
  }

  /** Re-emit the projection; a probe settling publishes outside scope changes. */
  private publish(): void {
    this.store.set(this.projection())
  }

  private projection(): DescribeImageSettingsCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      apiStyle: this.form.field('apiStyle'),
      apiKey: this.form.field('apiKey'),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      defaultPrompt: this.form.field('defaultPrompt'),
      maxBytes: this.form.field('maxBytes'),
      maxOutputTokens: this.form.field('maxOutputTokens'),
      timeoutMs: this.form.field('timeoutMs'),
      renderImagePreview: this.form.field('renderImagePreview'),
      interceptImageSend: this.form.field('interceptImageSend'),
      probe: this.probeState,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): DescribeImageSettingsCardFace {
    return {
      hooks: { describeImageSettingsCard: this.store },
      ...this.form.actions(),
      fetchModels: () => { this.fetchModels() },
      testModel: () => { this.testModel() },
    }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown. A request still in flight settles into
   * nothing once disposed.
   */
  dispose(): void {
    this.disposed = true
    this.form.dispose()
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
      defaultOpen={false}
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
      <div className={cardCss.field}>
        <div className={cardCss.head}>
          <label className={cardCss.label} htmlFor="settings-describe-image-model">{t('field.model')}</label>
          <span className={cardCss.badges}>
            {state.model.overridden ? <span className={cardCss.badge}>{t('settings.overridden')}</span> : null}
            <button
              type="button"
              className={css.probeInline}
              title={t('probe.hint')}
              disabled={disabled || state.probe.status === 'running'}
              onClick={props.fetchModels}
            >
              {t(state.probe.status === 'running' && state.probe.pending === 'fetch' ? 'probe.running' : 'probe.fetchModels')}
            </button>
            {state.model.text.trim() !== ''
              ? (
                <button
                  type="button"
                  className={css.probeInline}
                  title={t('probe.testHint')}
                  disabled={disabled || state.probe.status === 'running'}
                  onClick={props.testModel}
                >
                  {t(state.probe.status === 'running' && state.probe.pending === 'test' ? 'probe.running' : 'probe.connectivity')}
                </button>
              )
              : null}
          </span>
        </div>
        {state.probe.models.length > 0
          ? (
            <select
              id="settings-describe-image-model"
              className={cardCss.select}
              value={state.model.text}
              disabled={disabled}
              onChange={(event) => { props.edit('model', event.target.value) }}
            >
              <option value="">{t('settings.inherit')}</option>
              {state.model.text !== '' && !state.probe.models.includes(state.model.text)
                ? <option value={state.model.text}>{state.model.text}</option>
                : null}
              {state.probe.models.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          )
          : (
            <input
              id="settings-describe-image-model"
              className={state.model.invalid ? cardCss.inputInvalid : cardCss.input}
              type="text"
              {...state.model.invalid ? { 'aria-invalid': true } : {}}
              value={state.model.text}
              placeholder=""
              disabled={disabled}
              onChange={(event) => { props.edit('model', event.target.value) }}
            />
          )}
        {state.probe.status === 'running'
          ? <p className={css.probeRunning} role="status">{t('probe.running')}</p>
          : null}
        {state.probe.status === 'idle' && state.probe.error !== undefined
          ? <p className={css.probeError} role="status">{t('probe.error', { error: state.probe.error })}</p>
          : null}
        {state.probe.status === 'idle' && state.probe.error === undefined && state.probe.pending === 'test' && state.probe.latencyMs !== undefined
          ? (
            <p className={css.probeOk} role="status">
              {t('probe.success', { ms: String(state.probe.latencyMs) })}
            </p>
          )
          : null}
        {state.probe.status === 'idle' && state.probe.error === undefined && state.probe.pending === 'fetch' && state.probe.models.length > 0
          ? (
            <p className={css.probeOk} role="status">
              {t('probe.fetched', { count: String(state.probe.models.length) })}
            </p>
          )
          : null}
        {state.probe.status === 'idle' && state.probe.error === undefined && state.probe.models.length === 0
          ? (
            <p className={state.model.invalid ? cardCss.invalid : cardCss.hint}>
              {state.model.invalid ? t('settings.invalidNumber') : t('field.model.hint')}
            </p>
          )
          : null}
      </div>
      <ChoiceField
        id="settings-describe-image-apistyle"
        label={t('field.apiStyle')}
        hint={t('field.apiStyle.hint')}
        inheritLabel={t('settings.inherit')}
        choices={[
          { value: 'chat-completions', label: t('field.apiStyle.chatCompletions') },
          { value: 'responses', label: t('field.apiStyle.responses') },
          { value: 'anthropic-messages', label: t('field.apiStyle.anthropicMessages') },
        ]}
        {...fieldProps}
        {...state.apiStyle}
        onEdit={(text) => { props.edit('apiStyle', text) }}
        onReset={() => { props.resetField('apiStyle') }}
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
      <BooleanField
        id="settings-describe-image-render-preview"
        label={t('field.renderImagePreview')}
        hint={t('field.renderImagePreview.hint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.renderImagePreview}
        onEdit={(text) => { props.edit('renderImagePreview', text) }}
        onReset={() => { props.resetField('renderImagePreview') }}
      />
      <BooleanField
        id="settings-describe-image-intercept-send"
        label={t('field.interceptImageSend')}
        hint={t('field.interceptImageSend.hint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.interceptImageSend}
        onEdit={(text) => { props.edit('interceptImageSend', text) }}
        onReset={() => { props.resetField('interceptImageSend') }}
      />
      <NativeImageSection />
    </PluginSettingsCard>
  )
}
