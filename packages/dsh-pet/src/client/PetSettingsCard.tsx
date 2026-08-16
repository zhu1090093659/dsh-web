/**
 * The pet settings card: pet selection plus display layout, bound to the
 * 'pet' settings namespace the host plugin registers. Rendered as an
 * always-open first-level settings page; the section wrapper below mounts it
 * as the content of the top-level 'settings.section' nav entry. The petId
 * choices come from the registry endpoint ('/api/pet/pets') — the same list
 * the sprite renders from — so the card carries no per-pet knowledge.
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginSettingsCard, ValueField, BooleanField, ChoiceField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import sectionCss from './settings-section.module.css'

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
  /** Selected pet id (a registry entry). */
  petId?: string
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
  /** Selected pet. */
  petId: CardFieldState
  /** Pet choices (registry ids + display names), loaded from the host. */
  petChoices: readonly { value: string; label: string }[]
}

/** The registration-side face the card's slot entry injects. */
export interface PetSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as usePetSettingsCard. */
    petSettingsCard: SnapshotStore<PetSettingsCardState>
  }
}

/** One registry choice as served by '/api/pet/pets'. */
interface PetChoice {
  id: string
  displayName: string
}

/** Fetch the registry list (the same data the sprite renders from). */
async function fetchPetChoices(): Promise<PetChoice[]> {
  const response = await fetch('/api/pet/pets')
  if (!response.ok) throw new Error('pet pets failed: ' + response.status)
  return (await response.json()) as PetChoice[]
}

/** Bridges the 'pet' scope onto the card's staged form. */
export class PetSettingsCardController {
  private readonly form: CardForm<PetSettings>
  private readonly store: SnapshotStore<PetSettingsCardState>
  // The choice list rides a mutable array shared with the choiceField spec,
  // so loading the registry re-validates and re-formats the petId field
  // without rebuilding the form.
  private readonly petChoices: string[] = []
  private readonly petLabels = new Map<string, string>()
  private loaded = false
  private attempts = 0

  /** @param scope - the bound settings scope for the 'pet' namespace. */
  constructor(scope: SettingsScope<PetSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('visible'),
      numberField('size'),
      numberField('right'),
      numberField('bottom'),
      choiceField('petId', this.petChoices),
    ])
    this.store = this.form.bind(() => this.projection())
    void this.loadPets()
  }

  /** Resolve the registry choices once (retried a few times on failure). */
  private async loadPets(): Promise<void> {
    if (this.loaded) return
    try {
      const list = await fetchPetChoices()
      this.petChoices.splice(0, this.petChoices.length, ...list.map(choice => choice.id))
      for (const choice of list) this.petLabels.set(choice.id, choice.displayName)
      this.loaded = true
      this.store.set(this.projection())
    } catch {
      this.attempts += 1
      if (this.attempts < 3) {
        window.setTimeout(() => { void this.loadPets() }, 3000)
      }
    }
  }

  private projection(): PetSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visible: this.form.field('visible'),
      size: this.form.field('size'),
      right: this.form.field('right'),
      bottom: this.form.field('bottom'),
      petId: this.form.field('petId'),
      petChoices: this.petChoices.map(id => ({ value: id, label: this.petLabels.get(id) ?? id })),
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
  PropsLocale<'pet'>
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
      alwaysOpen
    >
      <BooleanField
        id="settings-pet-enabled"
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
        id="settings-pet-pet"
        label={t('settings.pet')}
        hint={t('settings.petHint')}
        inheritLabel={t('settings.inherit')}
        {...fieldProps}
        {...state.petId}
        choices={state.petChoices}
        onEdit={(text) => { props.edit('petId', text) }}
        onReset={() => { props.resetField('petId') }}
      />
      <BooleanField
        id="settings-pet-visible"
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
        id="settings-pet-size"
        label={t('settings.size')}
        hint={t('settings.sizeHint')}
        numeric
        {...fieldProps}
        {...state.size}
        onEdit={(text) => { props.edit('size', text) }}
        onReset={() => { props.resetField('size') }}
      />
      <ValueField
        id="settings-pet-right"
        label={t('settings.right')}
        hint={t('settings.rightHint')}
        numeric
        {...fieldProps}
        {...state.right}
        onEdit={(text) => { props.edit('right', text) }}
        onReset={() => { props.resetField('right') }}
      />
      <ValueField
        id="settings-pet-bottom"
        label={t('settings.bottom')}
        hint={t('settings.bottomHint')}
        numeric
        {...fieldProps}
        {...state.bottom}
        onEdit={(text) => { props.edit('bottom', text) }}
        onReset={() => { props.resetField('bottom') }}
      />
    </PluginSettingsCard>
  )
}

/** Props the settings section binds for the pet card page. */
export type PetSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'pet'>
  & InjectFace<PetSettingsCardFace>

/** Render the pet settings card as a first-level settings page. */
export function PetSettingsSection(props: PetSettingsSectionProps): ReactNode {
  const { t, usePetSettingsCard, save, discard, edit, resetField } = props
  return (
    <ul className={sectionCss.sectionList}>
      <PetSettingsCard t={t} usePetSettingsCard={usePetSettingsCard} save={save} discard={discard} edit={edit} resetField={resetField} />
    </ul>
  )
}
