/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the `web-ui.plugin.item` child slot the Web UI plugin group
 * renders, bound to the `remote-web-ui` settings namespace.
 */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, secretField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { readLanBindStatus, type LanBindFrame } from './pair-api.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

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
  /** Idle sessions older than this (ms) are deleted. */
  idleExpireMs?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /** Fence flag: whether non-loopback /api requests must carry a live paired-device cookie. */
  requirePairingForLan?: boolean
  /** Public (tunneled) base URL the QR link is built from when set. */
  publicBaseUrl?: string
  /** When on, the plugin runs its own Cloudflare quick tunnel automatically. */
  autoTunnel?: boolean
  /**
   * Cloudflare named-tunnel token: when set (and autoTunnel is off), the
   * plugin runs the named tunnel toward the fixed public hostname — a phone
   * paired once keeps its session across restarts.
   */
  tunnelToken?: string
  /**
   * Stable-origin relay: when on (default), the quick tunnel is fronted by a
   * fixed `<id>.dsh-market.com` subdomain so the phone's bookmark and
   * pairing cookie survive restarts without any setup.
   */
  relay?: boolean
  /**
   * LAN bind toggle: once flipped, the plugin manages the profile patch's
   * webserver block (0.0.0.0 / 127.0.0.1) and the host firewall rule.
   */
  lanBind?: boolean
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
  /** Idle-expiry window. */
  idleExpireMs: CardFieldState
  /** Device cookie name. */
  cookieName: CardFieldState
  /** LAN fence flag. */
  requirePairingForLan: CardFieldState
  /** Public (tunneled) base URL. */
  publicBaseUrl: CardFieldState
  /** Auto public tunnel switch. */
  autoTunnel: CardFieldState
  /** Named-tunnel token (stored redacted by the Host). */
  tunnelToken: CardFieldState
  /** Stable-origin relay switch. */
  relay: CardFieldState
  /** LAN bind toggle. */
  lanBind: CardFieldState
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
      numberField('idleExpireMs'),
      textField('cookieName'),
      booleanField('requirePairingForLan'),
      textField('publicBaseUrl'),
      booleanField('autoTunnel'),
      secretField('tunnelToken'),
      booleanField('relay'),
      booleanField('lanBind'),
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
      idleExpireMs: this.form.field('idleExpireMs'),
      cookieName: this.form.field('cookieName'),
      requirePairingForLan: this.form.field('requirePairingForLan'),
      publicBaseUrl: this.form.field('publicBaseUrl'),
      autoTunnel: this.form.field('autoTunnel'),
      tunnelToken: this.form.field('tunnelToken'),
      relay: this.form.field('relay'),
      lanBind: this.form.field('lanBind'),
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
        id="settings-remote-idle-expire"
        label={t('settings.idleExpireMs')}
        hint={t('settings.idleExpireMsHint')}
        numeric
        {...fieldProps}
        {...state.idleExpireMs}
        onEdit={(text) => { props.edit('idleExpireMs', text) }}
        onReset={() => { props.resetField('idleExpireMs') }}
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
      <ValueField
        id="settings-remote-tunnel-token"
        label={t('settings.tunnelToken')}
        hint={t('settings.tunnelTokenHint')}
        placeholder="eyJ..."
        {...fieldProps}
        {...state.tunnelToken}
        onEdit={(text) => { props.edit('tunnelToken', text) }}
        onReset={() => { props.resetField('tunnelToken') }}
      />
      <BooleanField
        id="settings-remote-relay"
        label={t('settings.relay')}
        hint={t('settings.relayHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.relay}
        onEdit={(text) => { props.edit('relay', text) }}
        onReset={() => { props.resetField('relay') }}
      />
      <LanBindStatus t={t} />
      <BooleanField
        id="settings-remote-lan-bind"
        label={t('settings.lanBind')}
        hint={t('settings.lanBindHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.lanBind}
        onEdit={(text) => { props.edit('lanBind', text) }}
        onReset={() => { props.resetField('lanBind') }}
      />
    </PluginSettingsCard>
  )
}

/**
 * Live LAN-bind facts above the toggle: the managed block's host, the live
 * bind, the firewall summary, and the reachable LAN URLs. Polls the
 * loopback-only status endpoint; a failure (non-loopback origin) renders
 * nothing — the pairing panel carries the loopback banner instead.
 */
function LanBindStatus({ t }: { t: TranslateNS<'remote'> }) {
  const [frame, setFrame] = useState<LanBindFrame | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const read = (): void => {
      void readLanBindStatus().then((value) => {
        if (alive) setFrame(value)
      }).catch(() => {})
    }
    read()
    const timer = window.setInterval(read, 10_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  if (frame === undefined) return null
  const lanOn = frame.blockHost === '0.0.0.0'
  const firewallText = frame.firewall.managed
    ? t(frame.firewall.ok ? 'lan.firewall.ok' : 'lan.firewall.bad')
    : t('lan.firewall.unmanaged')
  const lines: string[] = [
    t('lan.bind', { host: frame.bindHost, port: String(frame.port) }) + ' · ' + firewallText,
  ]
  if (lanOn && frame.lanUrls.length > 0) {
    lines.push(t('lan.urls', { urls: frame.lanUrls.join('  ') }))
  }
  if (!lanOn) {
    lines.push(t('lan.off'))
  }
  if (frame.setting === null) {
    lines.push(t('lan.untouched'))
  }
  if (frame.pendingRestart === true) {
    lines.push(t('lan.pendingRestart'))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, lineHeight: '18px', opacity: 0.85 }}>
      {lines.map((line, index) => (
        <div key={index} style={{ wordBreak: 'break-all' }}>{line}</div>
      ))}
    </div>
  )
}
