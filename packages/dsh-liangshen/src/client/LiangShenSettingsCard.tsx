/**
 * LiangShen settings card: availability, the wire presentation, and the
 * dispatcher identity. Registers into the `web-ui.plugin.item` child slot the
 * Web UI plugin group renders, bound to the `liangshen` settings namespace
 * (the Host profile entry id).
 *
 * No field acts on this client half: the Host applies the presentation and the
 * dispatcher switch to the preset it declares to the agent-preset registry, so
 * a session reads both from its preset. The card is the operator's only handle
 * on them, which is why every field the Host schema carries appears here.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { LiangShenMark } from './LiangShenMark.tsx'
import { BooleanField, ChoiceField, PluginSettingsCard, ValueField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, textField, type CardActions, type CardShell, type FieldSpec, type FieldState as CardFieldState } from './settings-form.ts'

/** A tool family entry: a prefix ending in exactly one trailing star. */
const FAMILY_ENTRY_RE = /^[^*]+\*$/

/**
 * The on-demand tool family list: comma separated entries, each a prefix with
 * one trailing star. Blank clears the field; any malformed entry holds the
 * draft unwritten.
 */
export function pagedToolPatternsField(field: string): FieldSpec {
  return {
    ...textField(field),
    parse: (text) => {
      const entries = text.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
      if (entries.length === 0) return { kind: 'clear' }
      if (!entries.every(entry => FAMILY_ENTRY_RE.test(entry))) return undefined
      return { kind: 'set', value: entries.join(', ') }
    },
  }
}

/** Wire presentations the tool catalog accepts (mirrors the Host schema). */
export const PRESENTATION_CHOICES = ['ptc', 'native'] as const

/** The LiangShen fields this card edits (the namespace's full schema). */
export interface LiangShenSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the plugin announces itself in every agent's system prompt. */
  announceToAgent?: boolean
  /** Wire presentation the Host applies to the preset's tool-catalog row. */
  presentation?: string
  /** Whether the preset appends the dispatcher rules section after the persona. */
  dispatcher?: boolean
  /** Comma-separated on-demand tool families the Host writes to the tool-catalog row. */
  pagedToolPatterns?: string
}

/** What the LiangShen card renders. */
export interface LiangShenSettingsCardState extends CardShell {
  enabled: CardFieldState
  announceToAgent: CardFieldState
  presentation: CardFieldState
  dispatcher: CardFieldState
  pagedToolPatterns: CardFieldState
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
      booleanField('dispatcher'),
      pagedToolPatternsField('pagedToolPatterns'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LiangShenSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      presentation: this.form.field('presentation'),
      dispatcher: this.form.field('dispatcher'),
      pagedToolPatterns: this.form.field('pagedToolPatterns'),
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
      icon={<LiangShenMark />}
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
        presentation="segment"
        {...fieldProps}
        {...state.presentation}
        onEdit={(text) => { props.edit('presentation', text) }}
        onReset={() => { props.resetField('presentation') }}
      />
      <BooleanField
        id="settings-liangshen-dispatcher"
        label={t('settings.dispatcher')}
        hint={t('settings.dispatcherHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.dispatcher}
        onEdit={(text) => { props.edit('dispatcher', text) }}
        onReset={() => { props.resetField('dispatcher') }}
      />
      <ValueField
        id="settings-liangshen-paged-tool-patterns"
        label={t('settings.pagedToolPatterns')}
        hint={t('settings.pagedToolPatternsHint')}
        placeholder="browser_*, task_board_*"
        {...fieldProps}
        invalidLabel={t('settings.pagedToolPatternsInvalid')}
        {...state.pagedToolPatterns}
        onEdit={(text) => { props.edit('pagedToolPatterns', text) }}
        onReset={() => { props.resetField('pagedToolPatterns') }}
      />
    </PluginSettingsCard>
  )
}
