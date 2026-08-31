/**
 * Remote control — browser half. Registers the `remote` dictionaries, the
 * sidebar-foot entry (phone trigger + pairing panel + update trigger), and
 * the pair boot flow (accept + presence heartbeats) plus the one-time
 * failed-pair notice. The portrait-touch adaptation of the official UI
 * starts at module scope (startMobileAdapt) so its focus guard is installed
 * before the app boots. Export discipline: packages/client/AGENTS.md — the
 * /client surface carries only what cordis loading needs plus types.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// ui-sidebar SlotMap merge (the 'sidebar.footer.action' hole).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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
import { startMobileAdapt, type RemoteAdaptGlobal } from './mobile-adapt.ts'

// Portrait-touch adaptation of the official UI: installed at module scope so
// the composer focus guard exists before any app entry mounts React. The
// layer self-evaluates and reverts with the viewport; the plugin apply below
// wires its toggleSidebar onto the official layout service.
startMobileAdapt()

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

  // The mobile adapt's whale button expands the collapsed sidebar and the
  // activation closes the details panel — both through the official layout
  // service (ctx.layout.toggleSidebar / closeDetails flip the panel state;
  // the narrow-viewport semantics open the drawer).
  const layout = ctx.get('layout') as { toggleSidebar?: () => void; closeDetails?: () => void } | undefined
  const adapt = (window as unknown as { __dshRemoteAdapt?: RemoteAdaptGlobal }).__dshRemoteAdapt
  // The official layout face throws (by contract) when the root entry has
  // not mounted yet; these closures also fire from gestures racing that
  // first mount, so they tolerate the throw instead of surfacing it.
  const layoutCall = (call: (() => void) | undefined): void => {
    try {
      call?.()
    } catch {
      // Boot-order throw: the panel action is a no-op before the root entry.
    }
  }
  if (layout !== undefined && adapt !== undefined) {
    if (typeof layout.toggleSidebar === 'function') {
      adapt.toggleSidebar = () => {
        layoutCall(layout.toggleSidebar)
      }
    }
    if (typeof layout.closeDetails === 'function') {
      adapt.closeDetails = () => {
        layoutCall(layout.closeDetails)
      }
    }
  }
  if (adapt !== undefined && adapt.toggleSidebar === null) {
    // Layout face unavailable (older composition): fall back to clicking the
    // official rail toggle when it exists.
    adapt.toggleSidebar = () => {
      (document.querySelector('[class$="_railFish"] button, [class$="_logoRow"] [class*="_iconButton"]') as HTMLElement | null)?.click()
    }
  }

  const t = ctx.locale.bind(NS)
  // Hand the `remote` translate seat to the module-scope adaptation layer:
  // the whale/compact-picker labels were rendered with the English fallback
  // before any dictionary existed; the wiring plus the layer's own sync tick
  // re-render them in the active locale.
  if (adapt !== undefined) adapt.translate = t
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<RemoteSettings>({ namespace: REMOTE_WEB_UI_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // Master switch for the adaptation layer: the module-scope install runs
  // before any config is readable, so flip it once the settings snapshot is
  // bound and on every later change (disabled plugin = no injected surface).
  // Also replay the pending closeDetails: the first portrait apply ran
  // before the layout face was wired, so its closeDetails was a no-op and a
  // restored details panel would otherwise sit hidden until landscape.
  const syncAdaptEnabled = (): void => {
    ;(window as unknown as { __dshRemoteAdapt?: RemoteAdaptGlobal }).__dshRemoteAdapt?.setEnabled?.(enabled())
  }
  settingsScope.subscribe(syncAdaptEnabled)
  syncAdaptEnabled()
  // The replay closes a details panel restored before the wiring; the
  // layout face throws while the root entry has not mounted yet (a real
  // boot-order race on slow remote loads), and the plugin's apply world
  // must survive it — the replay is a best-effort no-op then.
  try {
    adapt?.flushCloseDetails?.()
  } catch {}

  // Sidebar foot entry: the sidebar foot seat is `sidebar.footer.action` in
  // the 0.1.2 shell composition (the legacy `sidebar.remote` seat is gone
  // upstream). The pairing link is origin-agnostic, so the entry needs no
  // workspace source.
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
