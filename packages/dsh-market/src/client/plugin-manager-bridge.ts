/**
 * Bridge to the optional 'pluginManager' cordis service provided by the
 * sibling plugin @linxin666/dsh-client-ui-plugin-manager. The service is
 * OPTIONAL: when that plugin is not installed the bridge holds null and the
 * card degrades to the read-only copy-command index, exactly as before.
 *
 * CONTRACT OBSERVATION: the InstalledPluginItem / InstallProgressItem /
 * PluginManagerService shapes below mirror the sibling package's frozen
 * contract (its src/core/protocol.ts and src/core/service.ts). Repository
 * rules forbid cross-package value imports, so this file re-declares the
 * types locally; both sides must stay byte-compatible on the wire.
 */

/**
 * One installed user-plugin row (mirrors the sibling's protocol).
 */
export interface InstalledPluginItem {
  id: string
  name: string
  version: string
  source: { kind: 'npm' | 'git'; spec: string }
  installedAt: string
  /** Saved next-start enablement from the managed profile patch row. */
  enabled: boolean
  commit?: string
}

/** Point-in-time install/update progress reported by the host. */
export interface InstallProgressItem {
  kind: 'idle' | 'install' | 'update'
  stage: 'fetch' | 'download' | 'extract' | 'write'
  percent?: number
}

/**
 * The frozen cross-plugin service contract (cordis service name
 * 'pluginManager'). Kept intentionally narrow: observe and drive the
 * installed-plugin set.
 */
export interface PluginManagerService {
  /** Whether this browser has loopback authority over the host routes. */
  readonly isLoopback: boolean
  /** Read the installed snapshot. */
  list(): Promise<InstalledPluginItem[]>
  /** Install one plugin from an npm spec or git URL. */
  install(spec: string): Promise<InstalledPluginItem>
  /** Remove one plugin; resolves with the fresh installed snapshot. */
  uninstall(id: string): Promise<InstalledPluginItem[]>
  /** Read the current install/update progress. */
  status(): Promise<InstallProgressItem>
  /** Subscribe to successful mutations; returns the unsubscribe function. */
  onChange(cb: () => void): () => void
}

import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The plugin-manager face, present only when the sibling
     * dsh-plugin-manager client plugin is installed and active.
     */
    pluginManager?: PluginManagerService
  }
}

/** Bridge snapshot: the current face (or null) plus a monotonically increasing version. */
export interface PluginManagerBridgeSnapshot {
  /** The service face while the sibling plugin provides it, else null. */
  readonly face: PluginManagerService | null
  /** Bumped on every face change (lets consumers detect same-reference swaps). */
  readonly version: number
}

let snapshot: PluginManagerBridgeSnapshot = { face: null, version: 0 }
const listeners = new Set<() => void>()

/** Replace the held face and notify subscribers. */
function setFace(face: PluginManagerService | null): void {
  snapshot = { face, version: snapshot.version + 1 }
  for (const listener of listeners) listener()
}

/** Current bridge snapshot (cached reference, safe for useSyncExternalStore). */
export function getPluginManagerSnapshot(): PluginManagerBridgeSnapshot {
  return snapshot
}

/** Subscribe to face changes; returns the unsubscribe function. */
export function subscribePluginManager(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Bridge the optional 'pluginManager' service into the module store. Uses
 * ctx.inject (NOT the plugin's module-level inject array) so the service
 * stays optional: the inner callback runs when the sibling plugin provides
 * the face and is disposed when it goes away, which clears the store.
 * @param ctx - the client root context.
 */
export function bridgePluginManager(ctx: Context): void {
  ctx.inject(['pluginManager'], (inner) => {
    inner.effect(() => {
      setFace(inner.pluginManager ?? null)
      return () => { setFace(null) }
    }, 'dsh-web-ui-market: pluginManager bridge')
  })
}
