/**
 * Plugin-manager browser half: contributes the family plugin-manager tab to
 * the official Plugins settings section (`settings.plugins.tab` slot) and
 * provides the same dual-channel face as the `'pluginManager'` cordis
 * service for sibling client plugins. It is dual-channel: on runtimes with
 * the official installer services (DSHCode, the 1.0.4 checkout web) every
 * operation rides the official `/plugin-installer` and `/plugin-control`
 * loopback RPC channels (the single writer); on the npm-published web runtime
 * those channels do not exist, so the same face falls back to this package's
 * own loopback HTTP gateway, which spawns the official CLI for writes.
 * Neither the tab nor service consumers know which mode the face runs in.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings surface's slot contracts (settings.plugins.tab).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the client runtime Context merge (ctx.workspaces, ctx.sessions).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { PluginManagerTab, type PluginManagerTabInjected } from './PluginManagerTab.tsx'
import { en, zh, type PluginManagerKey } from './locales.ts'
import {
  parseFailuresSnapshot,
  parseInstallStatus,
  parseInstalledPlugin,
  parsePluginControlSnapshot,
  parsePluginList,
  parseUpdateList,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginControlItem,
  type PluginFailuresSnapshot,
  type PluginUpdateItem,
} from '../core/protocol.ts'
import { PLUGIN_MANAGER_SERVICE, type PluginManagerService } from '../core/service.ts'
import type { ControlChange } from '../core/conflict.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the family plugin-manager tab. */
    'settings.pluginManager': PluginManagerKey
  }
}

const NS = 'settings.pluginManager'
const CHANNEL = '/plugin-installer'
const CONTROL_CHANNEL = '/plugin-control'
const LIST_ENDPOINT = 'list'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const CHECK_UPDATES_ENDPOINT = 'check-updates'
const STATUS_ENDPOINT = 'status'
const FAILURES_ENDPOINT = 'failures'
const SET_SAFE_MODE_ENDPOINT = 'set-safe-mode'

const GATEWAY_PREFIX = '/api/plugin-manager'
/** Gateway job polling cadence. */
const JOB_POLL_MS = 500
/** Gateway job wait ceiling (the host add deadline is six minutes). */
const JOB_WAIT_MS = 7 * 60_000

/** Services required by the slot registration and both channels. */
export const inject = ['slots', 'locale', 'connection', 'workspaces', 'sessions']

/** The gateway job wire shape served by /status. */
interface GatewayJobWire {
  phase: 'running' | 'done' | 'error'
  plugin?: unknown
  conflicts?: unknown
  error?: string
}

/**
 * The face the Plugin manager tab and the `'pluginManager'` cordis service
 * share: the full tab surface plus the cross-plugin service contract.
 */
export type PluginManagerFace = PluginManagerTabInjected & PluginManagerService

/**
 * Build the dual-channel face once: official-channel and gateway-channel
 * implementations, the mode detection that picks between them, the repair
 * handoff, and the change-notification listener set. The returned face is
 * both the tab's injected props and the value provided as the
 * `'pluginManager'` cordis service.
 * @param ctx - the client context (connection, workspaces, sessions).
 * @returns the shared face.
 */
export function createPluginManagerFace(ctx: ClientContext): PluginManagerFace {
  const connection = ctx.get('connection') as ConnectionHandle

  // ── official channel implementations ──────────────────────────────────────

  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new Error(`plugin-installer ${endpoint} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const official = {
    list: async (): Promise<InstalledPluginItem[]> => parsePluginList(await call(LIST_ENDPOINT, {})),
    install: async (spec: string): Promise<InstalledPluginItem> => parseInstalledPlugin(await call(INSTALL_ENDPOINT, { spec })),
    update: async (id: string): Promise<InstalledPluginItem> => parseInstalledPlugin(await call(UPDATE_ENDPOINT, { id })),
    uninstall: async (id: string): Promise<InstalledPluginItem[]> => parsePluginList(await call(UNINSTALL_ENDPOINT, { id })),
    setEnabled: async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
      parseInstalledPlugin(await call(SET_ENABLED_ENDPOINT, { id, enabled })),
    checkUpdates: async (): Promise<PluginUpdateItem[]> => parseUpdateList(await call(CHECK_UPDATES_ENDPOINT, {})),
    status: async (): Promise<InstallProgressItem> => parseInstallStatus(await call(STATUS_ENDPOINT, {})),
    failures: async (): Promise<PluginFailuresSnapshot> => parseFailuresSnapshot(await call(FAILURES_ENDPOINT, {})),
    setSafeMode: async (enabled: boolean): Promise<void> => {
      await call(SET_SAFE_MODE_ENDPOINT, { enabled })
    },
    controlsList: async (): Promise<PluginControlItem[]> =>
      parsePluginControlSnapshot(await connection.rpc.call(CONTROL_CHANNEL, 'list', {}).then(result => {
        if (!result.ok) throw new Error(`plugin-control list failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      })),
    controlsSetEnabled: async (pluginId: string, enabled: boolean): Promise<PluginControlItem[]> =>
      parsePluginControlSnapshot(await connection.rpc.call(CONTROL_CHANNEL, 'set-enabled', { pluginId, enabled }).then(result => {
        if (!result.ok) throw new Error(`plugin-control set-enabled failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      })),
  }

  // ── gateway channel implementations ──────────────────────────────────────

  const gatewayJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
    if (response.status === 403) {
      throw new Error('plugin-manager: plugin management is only available from a local browser')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `plugin-manager: gateway ${path} failed: HTTP ${String(response.status)}`)
    }
    return response.json()
  }

  /** Wait for one gateway job to settle, returning its wire state. */
  const waitJob = async (jobId: string): Promise<GatewayJobWire> => {
    const deadline = Date.now() + JOB_WAIT_MS
    for (;;) {
      const body = await gatewayJson(`${GATEWAY_PREFIX}/status?job=${encodeURIComponent(jobId)}`) as { job?: GatewayJobWire }
      const job = body.job
      if (job === undefined) throw new Error('plugin-manager: gateway job vanished')
      if (job.phase === 'done') return job
      if (job.phase === 'error') throw new Error(job.error ?? 'plugin-manager: gateway job failed')
      if (Date.now() > deadline) throw new Error('plugin-manager: gateway job timed out')
      await new Promise(resolve => { setTimeout(resolve, JOB_POLL_MS) })
    }
  }

  /** The conflict ledger of the last settled gateway install. */
  let lastInstallConflicts: ControlChange[] = []
  /** Whether a gateway install/remove is in flight (drives the progress row). */
  let gatewayInflight = false

  const gateway = {
    list: async (): Promise<InstalledPluginItem[]> =>
      parsePluginList(await gatewayJson(`${GATEWAY_PREFIX}/list`)),
    install: async (spec: string): Promise<InstalledPluginItem> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/install`, {
          method: 'POST',
          body: JSON.stringify({ spec }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway install returned no job')
        const job = await waitJob(started.jobId)
        lastInstallConflicts = Array.isArray(job.conflicts) ? job.conflicts as ControlChange[] : []
        return parseInstalledPlugin({ plugin: job.plugin })
      } finally {
        gatewayInflight = false
      }
    },
    update: async (id: string): Promise<InstalledPluginItem> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/update`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway update returned no job')
        const job = await waitJob(started.jobId)
        lastInstallConflicts = Array.isArray(job.conflicts) ? job.conflicts as ControlChange[] : []
        return parseInstalledPlugin({ plugin: job.plugin })
      } finally {
        gatewayInflight = false
      }
    },
    uninstall: async (id: string): Promise<InstalledPluginItem[]> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/remove`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway remove returned no job')
        await waitJob(started.jobId)
        return gateway.list()
      } finally {
        gatewayInflight = false
      }
    },
    setEnabled: async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
      parseInstalledPlugin(await gatewayJson(`${GATEWAY_PREFIX}/set-enabled`, {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      })),
    checkUpdates: async (): Promise<PluginUpdateItem[]> =>
      parseUpdateList(await gatewayJson(`${GATEWAY_PREFIX}/check-updates`)),
    status: async (): Promise<InstallProgressItem> =>
      gatewayInflight ? { kind: 'install', stage: 'download' } : { kind: 'idle', stage: 'fetch' },
    failures: async (): Promise<PluginFailuresSnapshot> =>
      parseFailuresSnapshot(await gatewayJson(`${GATEWAY_PREFIX}/failures`)),
    setSafeMode: async (): Promise<void> => {
      throw new Error('plugin-manager: safe mode is unavailable in this runtime')
    },
    controlsList: async (): Promise<PluginControlItem[]> => [],
    controlsSetEnabled: async (pluginId: string, enabled: boolean): Promise<PluginControlItem[]> => {
      await gateway.setEnabled(pluginId, enabled)
      return []
    },
  }

  // ── mode selection ────────────────────────────────────────────────────────

  let modePromise: Promise<'official' | 'gateway'> | undefined
  const ensureMode = (): Promise<'official' | 'gateway'> => {
    if (modePromise === undefined) {
      modePromise = (async () => {
        // Prefer the host verdict: the gateway's /mode route reports whether
        // the official installer channels exist, so the direct channel probe
        // below (which 405s into the browser console on the npm web runtime)
        // only runs when the host half is absent or explicitly returns null
        // for a desktop runtime whose services are registered in-process.
        try {
          const mode = await gatewayJson(`${GATEWAY_PREFIX}/mode`) as { official?: boolean | null }
          if (mode.official === true) return 'official' as const
          if (mode.official === false) return 'gateway' as const
        } catch {
          // Host half absent (an official runtime without a boot profile):
          // fall back to the direct channel probe.
        }
        try {
          const result = await connection.rpc.call(CHANNEL, LIST_ENDPOINT, {})
          return result.ok ? 'official' as const : 'gateway' as const
        } catch {
          return 'gateway' as const
        }
      })()
    }
    return modePromise
  }

  /**
   * Start a repair conversation for a failed plugin: resolve a workspace over
   * the plugin install root (created once, reused after), open a fresh
   * session there, and seed its first prompt with the failure details. The
   * session's workspace is the plugin home so the agent's file tools reach
   * the plugin code without leaving the workspace boundary.
   * @param pluginRoot - absolute plugin install root.
   * @param message - the seeded first user message.
   * @returns resolution after the prompt is accepted and the session opens.
   */
  const repairPlugin = async (pluginRoot: string, message: string): Promise<void> => {
    const workspace = await ctx.workspaces.create({ path: pluginRoot })
    const sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`plugin-manager: repair session ${sessionId} is unavailable`)
    const result = await binding.session.prompt([{ type: 'text', text: message }], 'queue')
    if (!result.ok) throw new Error(`plugin-manager: repair prompt failed: ${result.error.code}: ${result.error.message}`)
    ctx.sessions.open(sessionId)
  }

  // ── change notification ───────────────────────────────────────────────────

  /** Listeners subscribed through onChange; fired after successful mutations. */
  const listeners = new Set<() => void>()
  /** Notify every listener; one listener throwing never breaks the others. */
  const notifyChange = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A consumer's listener failure is its own; keep notifying the rest.
      }
    }
  }

  // ── the shared face ───────────────────────────────────────────────────────

  return {
    isLoopback: connection.isLoopback,
    list: async () => (await ensureMode()) === 'official' ? official.list() : gateway.list(),
    install: async spec => {
      const item = await ((await ensureMode()) === 'official' ? official.install(spec) : gateway.install(spec))
      notifyChange()
      return item
    },
    update: async id => {
      const item = await ((await ensureMode()) === 'official' ? official.update(id) : gateway.update(id))
      notifyChange()
      return item
    },
    uninstall: async id => {
      const rows = await ((await ensureMode()) === 'official' ? official.uninstall(id) : gateway.uninstall(id))
      notifyChange()
      return rows
    },
    setEnabled: async (id, enabled) => {
      const item = await ((await ensureMode()) === 'official' ? official.setEnabled(id, enabled) : gateway.setEnabled(id, enabled))
      notifyChange()
      return item
    },
    checkUpdates: async () => (await ensureMode()) === 'official' ? official.checkUpdates() : gateway.checkUpdates(),
    status: async () => (await ensureMode()) === 'official' ? official.status() : gateway.status(),
    failures: async () => (await ensureMode()) === 'official' ? official.failures() : gateway.failures(),
    setSafeMode: async enabled => (await ensureMode()) === 'official' ? official.setSafeMode(enabled) : gateway.setSafeMode(),
    repairPlugin,
    controlsList: async () => (await ensureMode()) === 'official' ? official.controlsList() : gateway.controlsList(),
    controlsSetEnabled: async (id, enabled) => (await ensureMode()) === 'official' ? official.controlsSetEnabled(id, enabled) : gateway.controlsSetEnabled(id, enabled),
    lastInstallConflicts: () => lastInstallConflicts,
    onChange: cb => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
}

/** Contribute the family plugin-manager tab and provide the shared face. */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-plugin-manager' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'plugin-manager: dictionaries')

  // Built once: the tab and the 'pluginManager' cordis service share one
  // face, so consumers observe exactly the mutations the tab performs.
  const face = createPluginManagerFace(ctx)
  try {
    if (!ctx.get(PLUGIN_MANAGER_SERVICE)) {
      ctx.provide(PLUGIN_MANAGER_SERVICE, face)
    }
  } catch {
    // ignore duplicate provide
  }

  ctx.slots.inject('settings.plugins.tab', () => {
    try {
      return ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'family-plugins',
        order: 20,
        label: () => ctx.locale.bind(NS)('tab'),
        locale: NS,
        inject: () => face,
      }, PluginManagerTab)
    } catch {
      return () => {}
    }
  })
}
