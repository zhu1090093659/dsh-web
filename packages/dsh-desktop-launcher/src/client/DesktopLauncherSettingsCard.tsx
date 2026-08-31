/**
 * The desktop-launcher settings card: launcher behavior fields plus the
 * "create desktop icon" action and the shutdown confirmation toggle.
 * Registers into the `web-ui.plugin.item` slot the Web UI plugin group
 * renders, bound to the `desktop-launcher` settings namespace.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CreateResult } from '../protocol.ts'
import { createDesktopShortcut } from './api.ts'
import { BooleanField, PluginSettingsCard, ValueField } from './PluginSettingsCard.tsx'
import { booleanField, CardForm, textField, type CardActions, type CardShell, type FieldState } from './settings-form.ts'
import css from './launcher-card.module.css'
import shutdownCss from './shutdown.module.css'

/** The desktop-launcher fields this card edits (the namespace full schema). */
export interface DesktopLauncherSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the host announces the plugin to every agent. */
  announceToAgent?: boolean
  /** Command that starts dsh. */
  dshCommand?: string
  /** Base URL of the dsh web GUI. */
  url?: string
  /** Optional profile passed as `dsh web --profile <profile>`. */
  profile?: string
  /** Optional icon file (.ico/.png) for the desktop icon. */
  iconPath?: string
  /** Whether the floating shutdown button asks for confirmation before exiting. */
  confirmShutdown?: boolean
}

/** What the desktop-launcher card renders. */
export interface DesktopLauncherSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: FieldState
  /** Agent announcement switch. */
  announceToAgent: FieldState
  /** dsh command. */
  dshCommand: FieldState
  /** GUI URL. */
  url: FieldState
  /** Startup profile. */
  profile: FieldState
  /** Desktop icon file. */
  iconPath: FieldState
  /** Confirm gate for shutdown. */
  confirmShutdown: FieldState
}

/** The registration-side face the card slot entry injects. */
export interface DesktopLauncherSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useDesktopLauncherSettingsCard. */
    desktopLauncherSettingsCard: SnapshotStore<DesktopLauncherSettingsCardState>
  }
}

/** Bridges the `desktop-launcher` scope onto the card staged form. */
export class DesktopLauncherSettingsCardController {
  private readonly form: CardForm<DesktopLauncherSettings>
  private readonly store: SnapshotStore<DesktopLauncherSettingsCardState>

  /** @param scope - the bound settings scope for the `desktop-launcher` namespace. */
  constructor(scope: SettingsScope<DesktopLauncherSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
      textField('dshCommand'),
      textField('url'),
      textField('profile'),
      textField('iconPath'),
      booleanField('confirmShutdown'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): DesktopLauncherSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      dshCommand: this.form.field('dshCommand'),
      url: this.form.field('url'),
      profile: this.form.field('profile'),
      iconPath: this.form.field('iconPath'),
      confirmShutdown: this.form.field('confirmShutdown'),
    }
  }

/**
 * Build the face the card slot registration injects.
 * @returns the card snapshot and its form actions.
 */
  inject(): DesktopLauncherSettingsCardFace {
    return { hooks: { desktopLauncherSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the desktop-launcher card. */
export type DesktopLauncherSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'desktop-launcher'>
  & InjectFace<DesktopLauncherSettingsCardFace>

/**
 * Render the desktop-launcher card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function DesktopLauncherSettingsCard(props: DesktopLauncherSettingsCardProps) {
  const { t } = props
  const state = props.useDesktopLauncherSettingsCard(snapshot => snapshot)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResult | undefined>()
  const [error, setError] = useState<string | undefined>()
  const disabled = !state.writable
  // The create action calls the host route, which mounts only while the
  // saved `enabled` is on. Keep it inert for every staged draft so the route
  // and all launcher fields match what the card currently shows.
  const createReady = state.enabled.text === 'true' && !state.dirty && !state.saving
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  const create = async (): Promise<void> => {
    setCreating(true)
    setError(undefined)
    setCreated(undefined)
    try {
      setCreated(await createDesktopShortcut())
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-desktop-launcher-enabled"
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
        id="settings-desktop-launcher-announce"
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
      <ValueField
        id="settings-desktop-launcher-command"
        label={t('settings.dshCommand')}
        hint={t('settings.dshCommandHint')}
        placeholder="dsh"
        {...fieldProps}
        {...state.dshCommand}
        onEdit={(text) => { props.edit('dshCommand', text) }}
        onReset={() => { props.resetField('dshCommand') }}
      />
      <ValueField
        id="settings-desktop-launcher-url"
        label={t('settings.url')}
        hint={t('settings.urlHint')}
        placeholder="http://127.0.0.1:3080"
        {...fieldProps}
        {...state.url}
        onEdit={(text) => { props.edit('url', text) }}
        onReset={() => { props.resetField('url') }}
      />
      <ValueField
        id="settings-desktop-launcher-profile"
        label={t('settings.profile')}
        hint={t('settings.profileHint')}
        {...fieldProps}
        {...state.profile}
        onEdit={(text) => { props.edit('profile', text) }}
        onReset={() => { props.resetField('profile') }}
      />
      <ValueField
        id="settings-desktop-launcher-icon"
        label={t('settings.iconPath')}
        hint={t('settings.iconPathHint')}
        placeholder=""
        {...fieldProps}
        {...state.iconPath}
        onEdit={(text) => { props.edit('iconPath', text) }}
        onReset={() => { props.resetField('iconPath') }}
      />
      <div className={css.actions}>
        <button
          type="button"
          className={css.create}
          disabled={creating || disabled || !createReady}
          onClick={() => { void create() }}
        >
          {t(creating ? 'settings.creating' : 'settings.create')}
        </button>
        {!createReady && !disabled
          ? <p className={css.off} role="status">{t('settings.requireEnabled')}</p>
          : null}
        {created
          ? (
            <p className={css.ok} role="status">
              {t('settings.created')}: {created.path}
              {created.warning ? ` (${t('settings.warning')}: ${created.warning})` : ''}
            </p>
          )
          : null}
        {error
          ? (
            <p className={css.error} role="status">
              {t('settings.createFailed')}: {error}
            </p>
          )
          : null}
      </div>
      <div className={shutdownCss.separator} role="separator" />
      <h4 className={shutdownCss.sectionTitle}>{t('settings.shutdownSection')}</h4>
      <BooleanField
        id="settings-desktop-launcher-confirm"
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
    </PluginSettingsCard>
  )
}
