/**
 * The shutdown settings card: the plugin master switch, the confirm gate,
 * and the agent announcement toggle. Registers into the
 * `web-ui.plugin.item` slot the plugin-configuration section renders, bound
 * to the `shutdown` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The shutdown fields this card edits (the namespace's full schema). */
export interface ShutdownSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the sidebar button asks for confirmation before exiting. */
  confirmShutdown?: boolean
  /** Whether the host announces the plugin in the system prompt. */
  announceToAgent?: boolean
}

/** What the shutdown card renders. */
export interface ShutdownSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Confirm gate. */
  confirmShutdown: CardFieldState
  /** Announcement toggle. */
  announceToAgent: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface ShutdownSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useShutdownSettingsCard. */
    shutdownSettingsCard: SnapshotStore<ShutdownSettingsCardState>
  }
}

/** Bridges the `shutdown` scope onto the card's staged form. */
export class ShutdownSettingsCardController {
  private readonly form: CardForm<ShutdownSettings>
  private readonly store: SnapshotStore<ShutdownSettingsCardState>

  /** @param scope - the bound settings scope for the `shutdown` namespace. */
  constructor(scope: SettingsScope<ShutdownSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('confirmShutdown'),
      booleanField('announceToAgent'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ShutdownSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      confirmShutdown: this.form.field('confirmShutdown'),
      announceToAgent: this.form.field('announceToAgent'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): ShutdownSettingsCardFace {
    return { hooks: { shutdownSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the shutdown card. */
export type ShutdownSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'shutdown'>
  & InjectFace<ShutdownSettingsCardFace>

/**
 * Render the shutdown card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ShutdownSettingsCard(props: ShutdownSettingsCardProps) {
  const { t } = props
  const state = props.useShutdownSettingsCard(snapshot => snapshot)
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
        id="settings-shutdown-enabled"
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
        id="settings-shutdown-confirm"
        label={t('settings.confirmShutdown')}
        hint={t('settings.confirmShutdownHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.confirmShutdown}
        onEdit={(text) => { props.edit('confirmShutdown', text) }}
        onReset={() => { props.resetField('confirmShutdown') }}
      />
      <BooleanField
        id="settings-shutdown-announce"
        label={t('settings.announceToAgent')}
        hint={t('settings.announceToAgentHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.announceToAgent}
        onEdit={(text) => { props.edit('announceToAgent', text) }}
        onReset={() => { props.resetField('announceToAgent') }}
      />
    </PluginSettingsCard>
  )
}
