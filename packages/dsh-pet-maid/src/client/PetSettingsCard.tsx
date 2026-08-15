/**
 * The pet settings card: display layout, interactions and name, bound to the
 * `pet-maid` settings namespace the host plugin registers. Registered into
 * the `settings.plugin.item` slot the plugin-configuration section renders.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The pet's settings fields this card edits (the namespace's full schema). */
export interface PetSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Master switch. */
  visible?: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size?: number
  /** Horizontal inset from the viewport right edge, px. */
  right?: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom?: number
  /** User-customizable pet display name. */
  name?: string
  /** Cursor-follow eye tracking in idle poses. */
  eyeTracking?: boolean
  /** Edge-dock mini mode. */
  miniMode?: boolean
}

/** What the pet settings card renders. */
export interface PetSettingsCardState extends CardShell {
  /** Plugin master switch. */
  enabled: CardFieldState
  /** Master switch. */
  visible: CardFieldState
  /** Pet scale. */
  size: CardFieldState
  /** Right inset. */
  right: CardFieldState
  /** Bottom inset. */
  bottom: CardFieldState
  /** Pet name. */
  name: CardFieldState
  /** Eye tracking. */
  eyeTracking: CardFieldState
  /** Mini mode. */
  miniMode: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface PetSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as usePetSettingsCard. */
    petSettingsCard: SnapshotStore<PetSettingsCardState>
  }
}

/** Bridges the `pet-maid` scope onto the card's staged form. */
export class PetSettingsCardController {
  private readonly form: CardForm<PetSettings>
  private readonly store: SnapshotStore<PetSettingsCardState>

  /** @param scope - the bound settings scope for the `pet-maid` namespace. */
  constructor(scope: SettingsScope<PetSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('visible'),
      numberField('size'),
      numberField('right'),
      numberField('bottom'),
      textField('name'),
      booleanField('eyeTracking'),
      booleanField('miniMode'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): PetSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visible: this.form.field('visible'),
      size: this.form.field('size'),
      right: this.form.field('right'),
      bottom: this.form.field('bottom'),
      name: this.form.field('name'),
      eyeTracking: this.form.field('eyeTracking'),
      miniMode: this.form.field('miniMode'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): PetSettingsCardFace {
    return { hooks: { petSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the pet settings card. */
export type PetSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'pet-maid'>
  & InjectFace<PetSettingsCardFace>

/**
 * Render the pet settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function PetSettingsCard(props: PetSettingsCardProps) {
  const { t } = props
  const state = props.usePetSettingsCard(snapshot => snapshot)
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
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-pet-maid-enabled"
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
      <BooleanField
        id="settings-pet-maid-visible"
        label={t('settings.visible')}
        hint={t('settings.visibleHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.visible}
        onEdit={(text) => { props.edit('visible', text) }}
        onReset={() => { props.resetField('visible') }}
      />
      <ValueField
        id="settings-pet-maid-size"
        label={t('settings.size')}
        hint={t('settings.sizeHint')}
        numeric
        {...fieldProps}
        {...state.size}
        onEdit={(text) => { props.edit('size', text) }}
        onReset={() => { props.resetField('size') }}
      />
      <ValueField
        id="settings-pet-maid-right"
        label={t('settings.right')}
        hint={t('settings.rightHint')}
        numeric
        {...fieldProps}
        {...state.right}
        onEdit={(text) => { props.edit('right', text) }}
        onReset={() => { props.resetField('right') }}
      />
      <ValueField
        id="settings-pet-maid-bottom"
        label={t('settings.bottom')}
        hint={t('settings.bottomHint')}
        numeric
        {...fieldProps}
        {...state.bottom}
        onEdit={(text) => { props.edit('bottom', text) }}
        onReset={() => { props.resetField('bottom') }}
      />
      <ValueField
        id="settings-pet-maid-name"
        label={t('settings.name')}
        hint={t('settings.nameHint')}
        {...fieldProps}
        {...state.name}
        onEdit={(text) => { props.edit('name', text) }}
        onReset={() => { props.resetField('name') }}
      />
      <BooleanField
        id="settings-pet-maid-eyetracking"
        label={t('settings.eyeTracking')}
        hint={t('settings.eyeTrackingHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.eyeTracking}
        onEdit={(text) => { props.edit('eyeTracking', text) }}
        onReset={() => { props.resetField('eyeTracking') }}
      />
      <BooleanField
        id="settings-pet-maid-mini"
        label={t('settings.miniMode')}
        hint={t('settings.miniModeHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.miniMode}
        onEdit={(text) => { props.edit('miniMode', text) }}
        onReset={() => { props.resetField('miniMode') }}
      />
    </PluginSettingsCard>
  )
}
