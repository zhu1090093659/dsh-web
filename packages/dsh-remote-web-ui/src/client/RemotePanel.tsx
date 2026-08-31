/**
 * The mobile remote-control panel body: status card (state text + badge),
 * the QR code, the open-on-phone hint with the link text, and the three
 * actions (stop / refresh / copy). Pure presentation — all state and
 * actions arrive through props from the entry's behavior component.
 */
import clsx from 'clsx'
import { QRCodeSVG } from 'qrcode.react'
import {
  IconCloseOutline16, IconCopyOutline16, IconRefreshOutline16, IconStopFill16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PairingPhase } from '../pairing.ts'
import {
  formatClock,
  formatLastSeen,
  type DeviceFrame,
  type PostureFrame,
  type TunnelStatusFrame,
} from './pair-api.ts'
import { deviceNameFromUserAgent } from './device-name.ts'
import css from './remote.module.css'

/** The panel's view state, owned by the entry component. */
export type PanelState =
  | { kind: 'lan-required'; tunnel?: TunnelStatusFrame }
  | { kind: 'loopback-required' }
  | { kind: 'unreachable' }
  | {
      kind: 'ready'
      url: string
      expiresAt: number
      expired: boolean
      phase: PairingPhase
      deviceCount: number
      onlineCount: number
      /** Authorized devices for the roster under the QR card. */
      devices: DeviceFrame[]
      /** The LAN literal the current QR was built from. */
      address: string
      /** Every constructible LAN literal (interface order). */
      lanAddresses: string[]
      /** Whether this QR is built on the configured public (tunneled) base. */
      public: boolean
      /** The configured public (tunneled) base URL, when present. */
      publicBaseUrl?: string
      /** Auto-tunnel status, while the auto-tunnel feature is active. */
      tunnel?: TunnelStatusFrame
      /** Latest /api posture probe, once a round has completed. */
      posture?: PostureFrame
    }

/** Full panel props: copy + view state + actions. */
export interface RemotePanelProps {
  t: TranslateNS<'remote'>
  state: PanelState
  copied: boolean
  onClose(): void
  onStop(): void
  onRefresh(): void
  onCopy(url: string): void
  /** Re-mint the QR against a different LAN address. */
  onPickAddress(address: string): void
  /** Re-mint the QR against the configured public (tunneled) base. */
  onPickPublic(): void
  /** Revoke one paired device. */
  onRevoke(deviceId: string): void
}

/** Badge text + tone per phase (ready states only). */
function statusOf(
  t: TranslateNS<'remote'>,
  state: Extract<PanelState, { kind: 'ready' }>,
): { text: string; tone: 'waiting' | 'connected' | 'disconnected' | 'stopped' } {
  switch (state.phase) {
    case 'connected': return { text: t('status.connected', { n: state.onlineCount }), tone: 'connected' }
    case 'disconnected': return { text: t('status.disconnected'), tone: 'disconnected' }
    case 'stopped': return { text: t('status.stopped'), tone: 'stopped' }
    case 'lan-required': return { text: t('status.lanRequired'), tone: 'stopped' }
    case 'waiting': return { text: t('status.waiting'), tone: 'waiting' }
  }
}

/**
 * Render the pairing panel.
 * @param props - copy, state, and actions.
 * @returns the panel element tree.
 */
export function RemotePanel({ t, state, copied, onClose, onStop, onRefresh, onCopy, onPickAddress, onPickPublic, onRevoke }: RemotePanelProps) {
  return (
    <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <button type="button" className={css.close} aria-label={t('close.label')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>

      {state.kind === 'lan-required' ? (
        <div className={css.banner} role="alert">
          <p className={css.bannerTitle}>{t('status.lanRequired')}</p>
          <p className={css.bannerHint}>{t('status.lanRequiredHint')}</p>
        </div>
      ) : state.kind === 'loopback-required' ? (
        <div className={css.banner} role="alert">
          <p className={css.bannerTitle}>{t('status.loopbackRequired')}</p>
          <p className={css.bannerHint}>{t('status.loopbackRequiredHint')}</p>
        </div>
      ) : state.kind === 'unreachable' ? (
        <div className={css.banner} role="alert">
          <p className={css.bannerTitle}>{t('status.unreachable')}</p>
          <p className={css.bannerHint}>{t('status.unreachableHint')}</p>
        </div>
      ) : (
        <>
          {state.posture !== undefined && state.posture.hosts.some(host => host.exposed) && (
            <div className={css.banner} role="alert">
              <p className={css.bannerTitle}>{t('posture.exposed')}</p>
              <p className={css.bannerHint}>
                {t('posture.exposedHint', { hosts: state.posture.hosts.filter(host => host.exposed).map(host => host.host).join(', ') })}
              </p>
            </div>
          )}
          <div className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.cardTitle}>{t('card.title')}</span>
              <span className={css.badges}>
                {state.public && <span className={clsx(css.badge, css.badgePublic)}>{t('public.badge')}</span>}
                <span className={clsx(css.badge, css[`badge-${statusOf(t, state).tone}`])}>
                  {statusOf(t, state).text}
                </span>
              </span>
            </div>
            <div className={css.qrWrap} data-testid="remote-qr">
              <QRCodeSVG value={state.url} size={184} level="M" marginSize={1} className={css.qr} />
            </div>
            {state.expired
              ? <p className={css.expired}>{t('pair.expired')}</p>
              : <p className={css.expiry}>{t('pair.expires', { time: formatClock(state.expiresAt) })}</p>}
          </div>

          <p className={css.hint}>{state.public ? t('pair.publicHint') : t('pair.hint')}</p>
          <div className={css.pairLinks}>
            <div className={css.pairLinkRow}>
              <div className={css.pairLinkText}>
                <span className={css.pairLinkLabel}>{t('pair.linkLabel')}</span>
                <code className={css.link} title={state.url}>{state.url}</code>
              </div>
              <button type="button" className={css.copyLink} onClick={() => onCopy(state.url)}>
                <IconCopyOutline16 size={14} />
                {copied ? t('action.copied') : t('action.copyLink')}
              </button>
            </div>
          </div>
          <p className={css.oneTimeHint}>{t('pair.oneTimeHint')}</p>
          {state.phase === 'stopped' && <p className={css.stoppedHint}>{t('stopped.hint')}</p>}
          {state.tunnel !== undefined && state.tunnel.state !== 'running' && (
            <p className={state.tunnel.state === 'failed' ? css.tunnelFailed : css.tunnelNote} role="status">
              {state.tunnel.state === 'failed'
                ? t('tunnel.failed', { error: state.tunnel.error ?? t('tunnel.unknownError') })
                : t('tunnel.starting')}
            </p>
          )}

          {(state.publicBaseUrl !== undefined || state.lanAddresses.length > 1) && (
            <fieldset className={css.addresses}>
              <legend>{t('address.label')}</legend>
              {state.publicBaseUrl !== undefined && (
                <label key="public" className={css.address}>
                  <input
                    type="radio"
                    name="lan-address"
                    aria-label={t('address.public')}
                    checked={state.public}
                    onChange={onPickPublic}
                  />
                  <span>{t('address.public')}</span>
                  <code className={css.addressValue}>{state.publicBaseUrl}</code>
                </label>
              )}
              {state.lanAddresses.map(address => (
                <label key={address} className={css.address}>
                  <input
                    type="radio"
                    name="lan-address"
                    aria-label={address}
                    checked={!state.public && address === state.address}
                    onChange={() => onPickAddress(address)}
                  />
                  <span>{t('address.lan')}</span>
                  <code className={css.addressValue}>{address}</code>
                </label>
              ))}
              <p className={css.addressHint}>{t('address.hint')}</p>
            </fieldset>
          )}

          <div className={css.actions}>
            <button type="button" className={css.action} onClick={onStop}>
              <IconStopFill16 size={14} />
              {t('action.stop')}
            </button>
            <button type="button" className={css.action} onClick={onRefresh}>
              <IconRefreshOutline16 size={14} />
              {t('action.refresh')}
            </button>
          </div>

          <section className={css.devices} data-testid="remote-devices" aria-label={t('devices.title')}>
            <h3 className={css.devicesTitle}>{t('devices.title')}</h3>
            {state.devices.length === 0 ? (
              <p className={css.devicesEmpty}>{t('devices.empty')}</p>
            ) : (
              <ul className={css.deviceList}>
                {state.devices.map(device => (
                  <li key={device.id} className={css.deviceRow}>
                    <div className={css.deviceMeta}>
                      <span className={css.deviceName}>
                        {deviceNameFromUserAgent(device.userAgent) ?? t('devices.unknown')}
                      </span>
                      <span className={clsx(css.devicePresence, device.online ? css.deviceOnline : css.deviceOffline)}>
                        {device.online ? t('devices.online') : t('devices.offline')}
                      </span>
                      <span className={css.deviceSeen}>
                        {t('devices.lastSeen', { time: formatLastSeen(device.lastSeenAt) })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={css.deviceRevoke}
                      aria-label={t('devices.revoke.label')}
                      onClick={() => { onRevoke(device.id) }}
                    >
                      {t('devices.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
