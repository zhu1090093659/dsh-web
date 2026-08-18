/**
 * The side-card settings card: declares that the right panel is the side
 * card from the external dsh-better-sidebar plugin
 * (https://github.com/omdsh-dev/DSH-better-sidebar) and edits its everyday
 * preferences inline (SideCardPrefs, over the plugin's own /sidebar/api
 * settings transport), so the side card settings live inside this card
 * instead of a first-level settings nav row (the nav row is hidden through
 * the plugin's own marker — see AionUiSettingsCard.module.css). The aionui
 * provider choice is removed: the right panel is always dsh-better-sidebar.
 *
 * The card keeps binding the 'aionui-panel' namespace only as its
 * availability anchor: the namespace stays registered host-side so the card
 * can tell a composing deployment apart from one without the plugin; its
 * deprecated rightPanel field is ignored everywhere.
 * @module @linxin666/dsh-client-ui-aionui-panel/client/AionUiSettingsCard
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard } from './PluginSettingsCard.tsx'
import { CardForm, type CardActions, type CardShell } from './settings-form.ts'
import { SideCardPrefs, type SideCardRegistry } from './SideCardPrefs.tsx'
import css from './settings-card.module.css'
import cardCss from './AionUiSettingsCard.module.css'

/** The external plugin the side card (right panel) comes from. */
export const SIDE_CARD_SOURCE_URL = 'https://github.com/omdsh-dev/DSH-better-sidebar'

/**
 * The 'aionui-panel' namespace shape: no editable fields remain (the
 * provider choice was removed — the right panel is always
 * dsh-better-sidebar). The deprecated field stays in the host schema so
 * existing settings documents keep validating; every consumer ignores it.
 */
export interface AionUiPanelSettings {
  /** Deprecated and ignored: the provider choice no longer exists. */
  rightPanel?: 'aionui-panel' | 'dsh-better-sidebar'
}

/** What the side-card card renders (no fields of its own). */
export type AionUiSettingsCardState = CardShell

/** The registration-side face the card's slot entry injects. */
export interface AionUiSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAionUiSettingsCard. */
    aionUiSettingsCard: SnapshotStore<AionUiSettingsCardState>
  }
  /** The external side card's registry (tab/viewer enumeration); absent while the plugin is not loaded. */
  sidebar?: SideCardRegistry
}

/** Bridges the 'aionui-panel' scope onto the card's availability anchor. */
export class AionUiSettingsCardController {
  private readonly form: CardForm<AionUiPanelSettings>
  private readonly store: SnapshotStore<AionUiSettingsCardState>

  /** @param scope - the bound settings scope for the 'aionui-panel' namespace. */
  constructor(scope: SettingsScope<AionUiPanelSettings>) {
    this.form = new CardForm(scope, [])
    this.store = this.form.bind(() => this.form.shell())
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AionUiSettingsCardFace {
    return { hooks: { aionUiSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the side-card card. */
export type AionUiSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'aionui-panel'>
  & InjectFace<AionUiSettingsCardFace>

/**
 * Render the side-card card: the attribution line plus the embedded side
 * card preferences editor.
 * @param props - locale copy, the card snapshot, its form actions, and the
 *   external registry face.
 * @returns the card.
 */
export function AionUiSettingsCard(props: AionUiSettingsCardProps) {
  const { t } = props
  const state = props.useAionUiSettingsCard(snapshot => snapshot)
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      defaultOpen={false}
      hideFooter
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.hint}>
        {t('settings.sourcePrefix')}
        <a href={SIDE_CARD_SOURCE_URL} target="_blank" rel="noreferrer">github.com/omdsh-dev/DSH-better-sidebar</a>
        {t('settings.sourceSuffix')}
      </p>
      <div className={cardCss.embeddedSection}>
        <SideCardPrefs t={t} sidebar={props.sidebar} />
      </div>
    </PluginSettingsCard>
  )
}
