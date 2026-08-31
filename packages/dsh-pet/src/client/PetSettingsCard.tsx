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
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
  /** Status-decoration master switch (pet-center M5, #567). */
  decorationEnabled?: boolean
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
  /** Status-decoration master switch. */
  decorationEnabled: CardFieldState
  /** Pet choices (registry ids + display names), loaded from the host. */
  petChoices: readonly { value: string; label: string }[]
  /** Registry diagnostics (v1 migration hints, invalid entries), host-served. */
  petDiagnostics: readonly PetDiagnosticView[]
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

/** One registry diagnostic as served by '/api/pet/diagnostics' (#623). */
export interface PetDiagnosticView {
  level: 'error' | 'warning'
  message: string
}

/** Fetch the registry list (the same data the sprite renders from). */
async function fetchPetChoices(): Promise<PetChoice[]> {
  const response = await fetch('/api/pet/pets')
  if (!response.ok) throw new Error('pet pets failed: ' + response.status)
  return (await response.json()) as PetChoice[]
}

/** Fetch the registry diagnostics (v1 migration hints, invalid entries). */
async function fetchPetDiagnostics(): Promise<PetDiagnosticView[]> {
  const response = await fetch('/api/pet/diagnostics')
  if (!response.ok) throw new Error('pet diagnostics failed: ' + response.status)
  const body = (await response.json()) as { diagnostics?: PetDiagnosticView[] }
  return body.diagnostics ?? []
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
  private diagnostics: PetDiagnosticView[] = []
  private loaded = false
  private attempts = 0
  private disposed = false
  /** Pending deferred-load or retry timer; cancelled by dispose(). */
  private pendingTimer: number | undefined

  /** @param scope - the bound settings scope for the 'pet' namespace. */
  constructor(scope: SettingsScope<PetSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('decorationEnabled'),
      booleanField('visible'),
      numberField('size'),
      numberField('right'),
      numberField('bottom'),
      choiceField('petId', this.petChoices),
    ])
    this.store = this.form.bind(() => this.projection())
    // Client plugins are applied synchronously during shell startup. Defer
    // the first registry request until that pass completes so transport
    // plugins (notably remote-web-ui on a paired non-loopback origin) can
    // install their fetch channel before /api/pet/pets is issued.
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = undefined
      if (this.disposed) return
      void this.loadPets()
      void this.loadDiagnostics()
    }, 0)
  }

  /** Fetch registry diagnostics once (soft-fail: an empty list on error). */
  private async loadDiagnostics(): Promise<void> {
    try {
      this.diagnostics = await fetchPetDiagnostics()
      if (this.disposed) return
      this.store.set(this.projection())
    } catch {
      this.diagnostics = []
    }
  }

  /** Resolve the registry choices once (retried a few times on failure). */
  private async loadPets(): Promise<void> {
    if (this.loaded || this.disposed) return
    try {
      const list = await fetchPetChoices()
      if (this.disposed) return
      this.petChoices.splice(0, this.petChoices.length, ...list.map(choice => choice.id))
      for (const choice of list) this.petLabels.set(choice.id, choice.displayName)
      this.loaded = true
      this.store.set(this.projection())
    } catch {
      if (this.disposed) return
      this.attempts += 1
      if (this.attempts < 3) {
        this.pendingTimer = window.setTimeout(() => {
          this.pendingTimer = undefined
          if (this.disposed) return
          void this.loadPets()
        }, 3000)
      }
    }
  }

  private projection(): PetSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      decorationEnabled: this.form.field('decorationEnabled'),
      visible: this.form.field('visible'),
      size: this.form.field('size'),
      right: this.form.field('right'),
      bottom: this.form.field('bottom'),
      petId: this.form.field('petId'),
      petChoices: this.petChoices.map(id => ({ value: id, label: this.petLabels.get(id) ?? id })),
      petDiagnostics: this.diagnostics,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): PetSettingsCardFace {
    return { hooks: { petSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription, bound stores and pending load
   * timers; the slot disposer calls this on teardown.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pendingTimer !== undefined) {
      window.clearTimeout(this.pendingTimer)
      this.pendingTimer = undefined
    }
    this.form.dispose()
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
      <BooleanField
        id="settings-pet-decoration"
        label={t('settings.decoration')}
        hint={t('settings.decorationHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.decorationEnabled}
        onEdit={(text) => { props.edit('decorationEnabled', text) }}
        onReset={() => { props.resetField('decorationEnabled') }}
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
      {state.petDiagnostics.length === 0 ? null : (
        <li className={sectionCss.diagnostics} data-dsh-part="diagnostics">
          <span className={sectionCss.diagnosticsTitle}>{t('settings.diagnosticsTitle')}</span>
          <ul>
            {state.petDiagnostics.map((diagnostic, index) => (
              <li key={index} data-level={diagnostic.level}>{diagnostic.message}</li>
            ))}
          </ul>
        </li>
      )}
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
