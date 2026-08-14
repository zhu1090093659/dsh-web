/**
 * Mobile remote control for the dsh web GUI — host half. Mounts the pairing
 * service (one-time tokens, device sessions, revocation), the /api/pair
 * route family (issue/accept/stop/heartbeat/status/events), the api/gate
 * listener that enforces pairing on every other /api request from
 * non-loopback hosts, and the presence sweep. The browser half (the
 * `./client` entry) renders the sidebar entry, the pairing panel, and the
 * phone-side pair/accept + deep-link flow.
 */

import { createRequire } from 'node:module'
import { setInterval as nodeSetInterval } from 'node:timers'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PairingService } from './pairing.ts'
import { makeGateListener } from './gate.ts'
import { isTrustedApiRequest, makeRoutes } from './routes.ts'
import { makeMobileRoutes } from './mobile-routes.ts'
import { makeMobileApiRoutes } from './mobile-api.ts'
import { lanIPv4Addresses } from './lan.ts'
import { TunnelManager, type TunnelInfo } from './tunnel.ts'
import {
  checkUpdates,
  fetchLatestVersion,
  resolveAnchorManifest,
  resolveUpdateTarget,
  runUpdate,
  type UpdateRunResult,
} from './update.ts'
import { makeUpdateRoutes } from './update-routes.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Waterfall seam on the /api transport fence: the connection plugin
     * fires this per /api request before bridging to the API proxy on
     * deployments that carry the pairing/revocation seam; call `next()` to
     * delegate, return false (without calling it) to veto with 403.
     */
    'api/gate'(
      this: Context,
      request: IncomingMessage,
      method: string | undefined,
      next: () => boolean | Promise<boolean>,
    ): boolean | Promise<boolean>
  }
}

/** Stable cordis plugin name. */
export const name = 'remote-web-ui'

/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'apiProxy']

/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = settingsNamespace('remote-web-ui')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /**
   * When true (default), every non-loopback /api request must carry a live
   * paired-device cookie — the QR is the only way into a LAN-exposed dsh
   * web, and stop() genuinely cuts paired devices off. Set false to keep
   * the fence's open-LAN behavior and use pairing only for tokens/status.
   */
  requirePairingForLan?: boolean
  /**
   * Public base URL of a tunnel in front of this server (e.g. a Cloudflare
   * Tunnel quick URL `https://xxx.trycloudflare.com` or a named-tunnel
   * subdomain). When set, the QR link is built from it — a phone anywhere
   * can pair — and its host is trusted by the phone-facing pairing fence.
   * Leave unset for LAN-only usage. Malformed values are ignored with a
   * warning (LAN-only behavior preserved). Ignored while `autoTunnel` is on.
   */
  publicBaseUrl?: string
  /**
   * When true, the plugin runs its own Cloudflare quick tunnel (the
   * cloudflared binary ships with the package — no user-side install) and
   * feeds the minted public URL into both the QR base and the /api trust
   * fence dynamically, so phones anywhere can pair without any manual
   * tunnel setup. The manual `publicBaseUrl` is ignored while this is on.
   */
  autoTunnel?: boolean
  /** Master switch for the plugin (browser half + host pairing surfaces). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000),
  offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
  maxDevices: z.number().step(1).min(1).max(64).default(4),
  cookieName: z.string().min(1).default('dsh_pair'),
  requirePairingForLan: z.boolean().default(true),
  publicBaseUrl: z.string(),
  autoTunnel: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000

/**
 * Fully resolved config: every field non-optional except `publicBaseUrl`,
 * which legitimately resolves to `undefined` when unset (the schema keeps it
 * optional, so `Required` alone would over-narrow it to `string`).
 */
type ResolvedConfig = Required<Omit<Config, 'publicBaseUrl'>> & { publicBaseUrl: string | undefined }

/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS: ResolvedConfig = {
  tokenTtlMs: 10 * 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  cookieName: 'dsh_pair',
  requirePairingForLan: true,
  publicBaseUrl: undefined,
  autoTunnel: false,
  enabled: true,
}

/**
 * Mount the pairing service, routes, gate listener, and presence sweep.
 * @param ctx - host plugin context carrying webServer.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved: ResolvedConfig = {
    tokenTtlMs: config?.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
    offlineAfterMs: config?.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
    maxDevices: config?.maxDevices ?? DEFAULTS.maxDevices,
    cookieName: config?.cookieName ?? DEFAULTS.cookieName,
    requirePairingForLan: config?.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
    publicBaseUrl: config?.publicBaseUrl,
    autoTunnel: config?.autoTunnel ?? DEFAULTS.autoTunnel,
    enabled: config?.enabled ?? DEFAULTS.enabled,
  }
  // The live source the pairing service and the gate read: the settings
  // section once the web settings surface is served, the composition entry
  // otherwise (installSettingsSection swaps it when the namespace registers).
  let current: () => Config = () => config ?? {}
  const resolve = (): ResolvedConfig => {
    const value = current()
    return {
      tokenTtlMs: value.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
      offlineAfterMs: value.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
      maxDevices: value.maxDevices ?? DEFAULTS.maxDevices,
      cookieName: value.cookieName ?? DEFAULTS.cookieName,
      requirePairingForLan: value.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
      publicBaseUrl: value.publicBaseUrl,
      autoTunnel: value.autoTunnel ?? DEFAULTS.autoTunnel,
      enabled: value.enabled ?? DEFAULTS.enabled,
    }
  }
  const service = new PairingService({
    tokenTtlMs: resolved.tokenTtlMs,
    offlineAfterMs: resolved.offlineAfterMs,
    maxDevices: resolved.maxDevices,
    cookieName: resolved.cookieName,
  })

  // ── auto tunnel ─────────────────────────────────────────────────────────
  // The minted public URL becomes the QR base (and the pairing fence's
  // trusted host). Phone /api traffic rides the plugin's own /m/api channel,
  // which is NOT subject to the connection trust fence — so no fence
  // mutation is needed here (a distributable plugin must not change the
  // harness's connection plugin).
  const tunnel = new TunnelManager()
  let autoTunnel = resolved.autoTunnel
  tunnel.onPhase((info: TunnelInfo) => {
    if (!autoTunnel) return
    if (info.phase === 'running' && info.url !== undefined) {
      service.setPublicBaseUrl(info.url)
      service.setTunnelStatus({ state: 'running', url: info.url })
    } else if (info.phase === 'starting') {
      // A restart mints a NEW hostname: the previous URL dies with the old
      // process, so clear it now rather than advertising a dead link.
      service.setPublicBaseUrl(undefined)
      service.setTunnelStatus({ state: 'starting' })
    } else if (info.phase === 'failed') {
      service.setPublicBaseUrl(undefined)
      service.setTunnelStatus(info.error === undefined ? { state: 'failed' } : { state: 'failed', error: info.error })
    }
  })
  ctx.effect(() => () => {
    tunnel.dispose()
  }, 'remote-web-ui: auto tunnel')
  // The bind facts are known by now (webServer is an inject edge): the LAN
  // bases are frozen per process, matching the CLI's once-per-invocation
  // sampling stance. The QR can only advertise addresses the fence accepts;
  // every interface gets its own base URL so a multi-homed machine can pick
  // the network the phone can actually reach.
  const lanBases = ctx.webServer.host === '0.0.0.0'
    ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(ctx.webServer.port)}` }))
    : []
  service.setLanBases(lanBases)
  const lanAddresses = lanBases.map(entry => entry.address)

  // Push a committed settings section into the service and gate. The service
  // config object is read per operation (token mint, touch, sweep), and the
  // gate re-reads its fence flag per request, so a live edit takes effect
  // without a restart. When `enabled` turns off, the pairing routes and
  // sweep timer are dropped and all device/token state is revoked, but the
  // gate listener stays mounted so a LAN-exposed /api stays behind pairing
  // (now vetoing every non-loopback request) instead of opening the fence.
  let disposeRoutes: (() => void) | undefined
  let disposeSweep: (() => void) | undefined
  // The phone's data channel: pairing routes + the /m page + the /m/api
  // proxy (which needs the host ApiProxy service; the plugin injects it).
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) {
    console.warn('remote-web-ui: apiProxy service unavailable — the mobile data channel is disabled')
  }
  // ── remote update ────────────────────────────────────────────────────────
  // The dsh-web-ui self-update surface: probe the npm registry for family
  // releases and run `pnpm update` in the owning profile. Resolutions anchor
  // on the host process's own module graph, so the update always targets the
  // profile the running web GUI was booted from. The probe path resolves once
  // (the anchor stays the same package across updates); versions are re-read
  // from disk per check.
  const requireFromHost = createRequire(import.meta.url)
  const anchorManifestPath = resolveAnchorManifest(specifier => requireFromHost.resolve(specifier))
  const updateRoutes = makeUpdateRoutes({
    // Control endpoints are host-surface only: a LAN/phone origin must never
    // trigger a real install on this machine.
    fence: request => isTrustedApiRequest(request, []),
    check: () => checkUpdates({
      anchorManifestPath,
      resolve: specifier => {
        try {
          return requireFromHost.resolve(specifier)
        } catch {
          return undefined
        }
      },
      fetchLatest: name => fetchLatestVersion(name, fetch),
    }),
    run: async (): Promise<UpdateRunResult> => {
      const target = resolveUpdateTarget({ anchorManifestPath })
      if ('error' in target) {
        const code = target.error
        return {
          ok: false,
          exitCode: null,
          output: '',
          error: code === 'not-found' ? 'dsh-web-ui aggregate not installed' : 'local link install — update unavailable',
          errorCode: code,
        }
      }
      return runUpdate({ profileDir: target.profileDir, packages: target.packages })
    },
  })
  const routes = [
    ...makeRoutes({ service, lanAddresses }),
    ...makeMobileRoutes(),
    ...(apiProxy !== undefined ? makeMobileApiRoutes({ service, apiProxy }) : []),
    ...updateRoutes,
  ]
  const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled)
  ctx.effect(() => ctx.on('api/gate', gate), 'remote-web-ui: api gate')
  const sync = (): void => {
    const value = resolve()
    service.config = {
      tokenTtlMs: value.tokenTtlMs,
      offlineAfterMs: value.offlineAfterMs,
      maxDevices: value.maxDevices,
      cookieName: value.cookieName,
    }
    // The auto tunnel owns the public base while enabled: the minted URL
    // lands in the service through the tunnel's phase listener. The manual
    // publicBaseUrl applies only when the auto tunnel is off.
    autoTunnel = value.autoTunnel === true
    if (autoTunnel) {
      if (value.publicBaseUrl !== undefined) {
        console.warn('remote-web-ui: autoTunnel is on — ignoring the manually configured publicBaseUrl')
      }
      tunnel.start(`http://127.0.0.1:${String(ctx.webServer.port)}`)
    } else {
      tunnel.stop()
      // A malformed public base is ignored with a warning — LAN-only behavior
      // stays intact rather than silently minting unusable QR links.
      if (value.publicBaseUrl !== undefined && !isHttpUrl(value.publicBaseUrl)) {
        console.warn(`remote-web-ui: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`)
        service.setPublicBaseUrl(undefined)
      } else {
        service.setPublicBaseUrl(value.publicBaseUrl)
      }
    }
    const enabled = value.enabled
    if (!enabled) service.stop()
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map(route => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'remote-web-ui: pairing routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSweep === undefined && enabled) {
      disposeSweep = ctx.effect(
        () => {
          const timer = nodeSetInterval(() => { service.sweep() }, SWEEP_INTERVAL_MS)
          timer.unref()
          return () => { clearInterval(timer) }
        },
        'remote-web-ui: presence sweep',
      )
    } else if (disposeSweep !== undefined && !enabled) {
      disposeSweep()
      disposeSweep = undefined
    }
  }
  installSettingsSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })
  sync()
}

/** Whether a configured public base is a parseable http(s) URL with a host. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}
