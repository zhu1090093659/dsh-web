/**
 * Mobile remote control — browser half. Registers the `remote` dictionaries,
 * the sidebar-foot entry (phone trigger + pairing panel) into the
 * ui-sidebar-declared `sidebar.remote` seat, and runs the phone-side boot
 * flow (pair accept + workspace deep-link + presence heartbeats) plus the
 * one-time failed-pair notice. Export discipline: packages/client/AGENTS.md
 * — the /client surface carries only what cordis loading needs plus types.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// ui-sidebar SlotMap merge (the 'sidebar.remote' hole).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { FooterRemoteEntry } from './FooterRemoteEntry.tsx'
import { RemoteEntry } from './RemoteEntry.tsx'
import { PairFailedNotice } from './PairFailedNotice.tsx'
import { RemoteSettingsCard, RemoteSettingsCardController, type RemoteSettings } from './RemoteSettingsCard.tsx'
import { en, zh, type RemoteKey } from './locales.ts'
import { PAIR_FAILED_MARKER, runPairBootFlow } from './deep-link.ts'
import { readPairGatePolicy, sendHeartbeat } from './pair-api.ts'
import {
  channelTransition,
  installRemoteChannel,
  isLoopbackHostname,
  remoteChannelRequired,
  REMOTE_CHANNEL_BOOT_GLOBAL,
  type RemoteChannelBootSeat,
} from './remote-channel.ts'
import { FenceNotice } from './FenceNotice.tsx'
import { reportDailyHeartbeat } from './telemetry.ts'

export type { RemoteEntryProps } from './RemoteEntry.tsx'
export type { PanelState, RemotePanelProps } from './RemotePanel.tsx'
export type { PairFailedNoticeProps } from './PairFailedNotice.tsx'
export type { RemoteKey } from './locales.ts'
export type { RemoteSettingsCardFace, RemoteSettingsCardState } from './RemoteSettingsCard.tsx'
export type { UpdateEntryProps } from './UpdateEntry.tsx'
export type { UpdatePanelProps, UpdateView } from './UpdatePanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mobile remote-control surface copy. */
    remote: RemoteKey
  }

  interface SlotMap {
    /**
     * The sidebar foot seat beside the settings trigger, declared by the
     * sidebar shell on deployments that carry the feature seat; the shell
     * passes only its column display state.
     */
    'sidebar.remote': { kind: 'single'; scope: 'root'; owner: SidebarRemoteOwnerProps }
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of the sidebar remote-control seat: the column display state the trigger renders against. */
export interface SidebarRemoteOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}


/** Dictionary namespace owned by this plugin. */
const NS = 'remote'

/** Settings namespace the remote-control card edits (the Host plugin registers it). */
const REMOTE_WEB_UI_NS = 'remote-web-ui'

/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the remote-control surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-remote-web-ui' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'remote-web-ui: dictionaries')

  const t = ctx.locale.bind(NS)
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<RemoteSettings>({ namespace: REMOTE_WEB_UI_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // Sidebar foot entry: the shell declares 'sidebar.remote' in unconstrained
  // order, so registration is declaration-aware — slots.inject waits on the
  // declaration, removes the contribution when it collapses, and re-runs
  // after a redeclaration. The entry follows the plugin's enabled setting:
  // toggling it off removes the trigger, toggling it back on re-registers it.
  ctx.slots.inject('sidebar.remote', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        try {
          disposeEntry = ctx.slots.register({ name: 'sidebar.remote', locale: NS }, RemoteEntry)
        } catch {
          // ignore registration collision
        }
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

  // Current shells declare `sidebar.footer.action` instead of the legacy
  // `sidebar.remote` seat; this fallback registers the same entry there when
  // the legacy seat never arrives (declaration-aware: only one of the two
  // injects ever fires, so the trigger can never render twice).
  ctx.slots.inject('sidebar.footer.action', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        try {
          disposeEntry = ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-web-ui', locale: NS }, FooterRemoteEntry)
        } catch {
          // ignore registration collision
        }
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

  // Plugin configuration card: one staged form over the `remote-web-ui`
  // settings namespace, contributed to the Web UI plugin group.
  const remoteSettings = new RemoteSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'web-ui.plugin.item',
        id: 'remote-web-ui',
        order: 90,
        locale: NS,
        inject: () => remoteSettings.inject(),
      }, RemoteSettingsCard)
      return () => {
        remoteSettings.dispose()
        unregister()
      }
    } catch {
      return () => {}
    }
  })

  // Phone-side boot flow + heartbeats. Loopback pages (the desktop) never
  // heartbeat; the server ignores unpaired heartbeats anyway. Both run only
  // while the plugin is enabled.
  let disposeRuntime: (() => void) | undefined
  const syncRuntime = (): void => {
    if (enabled() && disposeRuntime === undefined) {
      disposeRuntime = ctx.effect(() => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        const loopback = connection?.isLoopback ?? true
        runPairBootFlow(ctx, window.location.search)
        if (loopback) return () => {}
        const timer = window.setInterval(() => { void sendHeartbeat().catch(() => {}) }, HEARTBEAT_INTERVAL_MS)
        return () => { window.clearInterval(timer) }
      }, 'remote-web-ui: pair flow + heartbeats')
    } else if (!enabled() && disposeRuntime !== undefined) {
      disposeRuntime()
      disposeRuntime = undefined
    }
  }
  settingsScope.subscribe(syncRuntime)
  syncRuntime()

  // Remote desktop channel: on a non-loopback origin (LAN address or public
  // tunnel) the connection plugin's /api fence refuses this desktop Web GUI,
  // and pairing is the access control — so the SDK client's /api traffic is
  // rewritten onto this plugin's gated /remote/api prefix (remote-channel.ts)
  // while the fence setting demands it. Loopback origins are untouched.
  let disposeChannel: (() => void) | undefined
  let hostPairingPolicy: boolean | undefined
  let unpairedWhilePolicyPending = false
  let fenceNotice: { unmount: () => void; node: HTMLElement } | undefined
  const showFenceNotice = (): void => {
    if (fenceNotice !== undefined) return
    const node = document.createElement('div')
    document.body.appendChild(node)
    const root = createRoot(node)
    root.render(createElement(FenceNotice, { t, onRetry: () => { window.location.reload() } }))
    fenceNotice = { unmount: () => { root.unmount(); node.remove() }, node }
  }
  const hideFenceNotice = (): void => {
    fenceNotice?.unmount()
    fenceNotice = undefined
  }
  const handleUnpaired = (): void => {
    if (settingsScope.getSnapshot().status !== 'ready' && hostPairingPolicy === undefined) {
      unpairedWhilePolicyPending = true
      return
    }
    showFenceNotice()
  }
  const channelActive = (): boolean => remoteChannelRequired(
    window.location.hostname,
    settingsScope.getSnapshot(),
    hostPairingPolicy,
  )
  // The parse-time boot patch (issue #987), when the served index carried
  // it: already installed before any boot entry ran, so adopting its seat
  // beats patching a second time (which would double-rewrite onto
  // /remote/remote/...).
  const bootSeat = (): RemoteChannelBootSeat | undefined =>
    (window as unknown as Record<string, RemoteChannelBootSeat | undefined>)[REMOTE_CHANNEL_BOOT_GLOBAL]
  const syncChannel = (): void => {
    const transition = channelTransition(channelActive(), disposeChannel !== undefined)
    if (transition === 'install') {
      const seat = bootSeat()
      if (seat !== undefined) {
        seat.onUnpaired = handleUnpaired
        seat.onPaired = hideFenceNotice
        // Replay a signal raised before adoption (early unpaired responses).
        if (seat.pendingUnpaired) {
          seat.pendingUnpaired = false
          handleUnpaired()
        }
        disposeChannel = ctx.effect(() => () => {
          seat.onUnpaired = null
          seat.onPaired = null
        }, 'remote-web-ui: remote desktop channel (boot patch)')
      } else {
        disposeChannel = ctx.effect(() => {
          const restore = installRemoteChannel(window, { onUnpaired: handleUnpaired, onPaired: hideFenceNotice })
          return restore
        }, 'remote-web-ui: remote desktop channel')
      }
    } else if (transition === 'retire' && disposeChannel !== undefined) {
      disposeChannel()
      disposeChannel = undefined
      // Retire the provisional parse-time install with the channel: the
      // desktop now rides plain /api, so the rewrite must go (its seat
      // removes the global; a later re-activation patches afresh).
      bootSeat()?.restore()
      // Retire the notice with the channel: once requirePairingForLan turns
      // off (or the plugin is disabled) the desktop rides plain /api again,
      // so an unpaired notice raised while the channel was briefly active
      // (the settings snapshot loads after boot) must not outlive it. The
      // installed channel is the only path that raises the notice, so with
      // the channel gone nothing can re-raise it (issue #808).
      hideFenceNotice()
    } else if (transition === 'none' && !channelActive()) {
      // The channel was never adopted (policy settled to off before apply
      // ran): the provisional boot patch still retires.
      bootSeat()?.restore()
    }
  }
  settingsScope.subscribe(syncChannel)
  syncChannel()
  if (!isLoopbackHostname(window.location.hostname) && settingsScope.getSnapshot().status !== 'ready') {
    void readPairGatePolicy().then((policy) => {
      hostPairingPolicy = policy.requirePairingForLan
      syncChannel()
      if (hostPairingPolicy && unpairedWhilePolicyPending) showFenceNotice()
      unpairedWhilePolicyPending = false
    }).catch(() => {
      // Fail closed when the policy endpoint is unavailable or malformed.
      hostPairingPolicy = true
      syncChannel()
      if (unpairedWhilePolicyPending) showFenceNotice()
      unpairedWhilePolicyPending = false
    })
  }

  // One-time failed-pair toast. The accept result lands asynchronously, so
  // the marker check is deferred past the accept round trip.
  ctx.effect(() => {
    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem(PAIR_FAILED_MARKER) === null) return
      sessionStorage.removeItem(PAIR_FAILED_MARKER)
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      const root = createRoot(mount)
      root.render(createElement(PairFailedNotice, { t }))
      // The toast owns its dismissal; the root lives for the page lifetime.
      void root
    }, 1500)
    return () => { window.clearTimeout(timer) }
  }, 'remote-web-ui: failed-pair notice')
}
