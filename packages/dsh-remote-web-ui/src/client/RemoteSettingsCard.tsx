/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the `settings.plugin.item` slot the plugin-configuration
 * section renders, bound to the `remote-web-ui` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The remote-control fields this card edits (the namespace's full schema). */
export interface RemoteSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /** Fence flag: whether non-loopback /api requests must carry a live paired-device cookie. */
  requirePairingForLan?: boolean
  /** Public (tunneled) base URL the QR link is built from when set. */
  publicBaseUrl?: string
  /** When on, the plugin runs its own Cloudflare quick tunnel automatically. */
  autoTunnel?: boolean
  /** Mobile composer: plain Enter sends; off means Enter inserts a newline. */
  mobileEnterToSend?: boolean
  /** Maximum automatic retries for transient model request failures. */
  retryAttempts?: number
}

/** What the remote-control card renders. */
export interface RemoteSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Token lifetime. */
  tokenTtlMs: CardFieldState
  /** Device offline threshold. */
  offlineAfterMs: CardFieldState
  /** Paired-device cap. */
  maxDevices: CardFieldState
  /** Device cookie name. */
  cookieName: CardFieldState
  /** LAN fence flag. */
  requirePairingForLan: CardFieldState
  /** Public (tunneled) base URL. */
  publicBaseUrl: CardFieldState
  /** Auto public tunnel switch. */
  autoTunnel: CardFieldState
  /** Mobile composer Enter-to-send switch. */
  mobileEnterToSend: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface RemoteSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useRemoteSettingsCard. */
    remoteSettingsCard: SnapshotStore<RemoteSettingsCardState>
  }
}

/** Bridges the `remote-web-ui` scope onto the card's staged form. */
export class RemoteSettingsCardController {
  private readonly form: CardForm<RemoteSettings>
  private readonly store: SnapshotStore<RemoteSettingsCardState>

  /** @param scope - the bound settings scope for the `remote-web-ui` namespace. */
  constructor(scope: SettingsScope<RemoteSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('tokenTtlMs'),
      numberField('offlineAfterMs'),
      numberField('maxDevices'),
      textField('cookieName'),
      booleanField('requirePairingForLan'),
      textField('publicBaseUrl'),
      booleanField('autoTunnel'),
      booleanField('mobileEnterToSend'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): RemoteSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      tokenTtlMs: this.form.field('tokenTtlMs'),
      offlineAfterMs: this.form.field('offlineAfterMs'),
      maxDevices: this.form.field('maxDevices'),
      cookieName: this.form.field('cookieName'),
      requirePairingForLan: this.form.field('requirePairingForLan'),
      publicBaseUrl: this.form.field('publicBaseUrl'),
      autoTunnel: this.form.field('autoTunnel'),
      mobileEnterToSend: this.form.field('mobileEnterToSend'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): RemoteSettingsCardFace {
    return { hooks: { remoteSettingsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the remote-control card. */
export type RemoteSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'remote'>
  & InjectFace<RemoteSettingsCardFace>

/**
 * Render the remote-control card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function RemoteSettingsCard(props: RemoteSettingsCardProps) {
  const { t } = props
  const state = props.useRemoteSettingsCard(snapshot => snapshot)
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
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-remote-enabled"
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
      <ValueField
        id="settings-remote-token-ttl"
        label={t('settings.tokenTtlMs')}
        hint={t('settings.tokenTtlMsHint')}
        numeric
        {...fieldProps}
        {...state.tokenTtlMs}
        onEdit={(text) => { props.edit('tokenTtlMs', text) }}
        onReset={() => { props.resetField('tokenTtlMs') }}
      />
      <ValueField
        id="settings-remote-offline"
        label={t('settings.offlineAfterMs')}
        hint={t('settings.offlineAfterMsHint')}
        numeric
        {...fieldProps}
        {...state.offlineAfterMs}
        onEdit={(text) => { props.edit('offlineAfterMs', text) }}
        onReset={() => { props.resetField('offlineAfterMs') }}
      />
      <ValueField
        id="settings-remote-max-devices"
        label={t('settings.maxDevices')}
        hint={t('settings.maxDevicesHint')}
        numeric
        {...fieldProps}
        {...state.maxDevices}
        onEdit={(text) => { props.edit('maxDevices', text) }}
        onReset={() => { props.resetField('maxDevices') }}
      />
      <ValueField
        id="settings-remote-cookie"
        label={t('settings.cookieName')}
        hint={t('settings.cookieNameHint')}
        {...fieldProps}
        {...state.cookieName}
        onEdit={(text) => { props.edit('cookieName', text) }}
        onReset={() => { props.resetField('cookieName') }}
      />
      <BooleanField
        id="settings-remote-fence"
        label={t('settings.requirePairingForLan')}
        hint={t('settings.requirePairingForLanHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.requirePairingForLan}
        onEdit={(text) => { props.edit('requirePairingForLan', text) }}
        onReset={() => { props.resetField('requirePairingForLan') }}
      />
      <ValueField
        id="settings-remote-public-base"
        label={t('settings.publicBaseUrl')}
        hint={t('settings.publicBaseUrlHint')}
        placeholder="https://example.trycloudflare.com"
        {...fieldProps}
        {...state.publicBaseUrl}
        onEdit={(text) => { props.edit('publicBaseUrl', text) }}
        onReset={() => { props.resetField('publicBaseUrl') }}
      />
      <BooleanField
        id="settings-remote-auto-tunnel"
        label={t('settings.autoTunnel')}
        hint={t('settings.autoTunnelHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.autoTunnel}
        onEdit={(text) => { props.edit('autoTunnel', text) }}
        onReset={() => { props.resetField('autoTunnel') }}
      />
      <BooleanField
        id="settings-remote-mobile-enter"
        label={t('settings.mobileEnterToSend')}
        hint={t('settings.mobileEnterToSendHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.mobileEnterToSend}
        onEdit={(text) => { props.edit('mobileEnterToSend', text) }}
        onReset={() => { props.resetField('mobileEnterToSend') }}
      />
          {/*
              d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48713 7.02105 8.48713 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
              fill="currentColor"
            />
          </svg>
        </summary>
        <div className={css.body}>
          <ValueField
            id="settings-remote-retry-attempts"
            label={t('settings.retryAttempts')}
            hint={t('settings.retryAttemptsHint')}
            numeric
            {...fieldProps}
            {...state.retryAttempts}
            onEdit={(text) => { props.edit('retryAttempts', text) }}
            onReset={() => { props.resetField('retryAttempts') }}
          />
        </div>
          */}
    </PluginSettingsCard>
  )
}
