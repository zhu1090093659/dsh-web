/**
 * Plugin-manager browser half: contributes the family plugin-manager tab to
 * the official Plugins settings section (`settings.plugins.tab` slot). It is
 * dual-channel: on runtimes with the official installer services (DSHCode,
 * the 1.0.4 checkout web) every operation rides the official
 * `/plugin-installer` and `/plugin-control` loopback RPC channels (the single
 * writer); on the npm-published web runtime those channels do not exist, so
 * the same face falls back to this package's own loopback HTTP gateway, which
 * spawns the official CLI for writes. The tab never knows which mode it runs
 * in — only the injected face does.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings surface's slot contracts (settings.plugins.tab).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the client runtime Context merge (ctx.workspaces, ctx.sessions).
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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
import type { ControlChange } from '../core/conflict.ts'

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

/** The face extended with the gateway's install-time conflict ledger. */
export type PluginManagerFace = PluginManagerTabInjected & {
  /** Conflicts the gateway host computed around the last install (gateway mode only). */
  lastInstallConflicts?: () => readonly ControlChange[]
}

/** Contribute the family plugin-manager tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-manager: dictionaries')

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
      const rows = await gateway.list()
      const row = rows.find(item => item.id === id)
      if (row === undefined) throw new Error(`plugin-manager: plugin ${id} is not installed`)
      return gateway.install(row.source.spec)
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

  // ── mode selection and the shared injected face ───────────────────────────

  let modePromise: Promise<'official' | 'gateway'> | undefined
  const ensureMode = (): Promise<'official' | 'gateway'> => {
    if (modePromise === undefined) {
      modePromise = (async () => {
        // Prefer the host verdict: the gateway's /mode route reports whether
        // the official installer channels exist, so the direct channel probe
        // below (which 405s into the browser console on the npm web runtime)
        // only runs when the host half is absent.
        try {
          const mode = await gatewayJson(`${GATEWAY_PREFIX}/mode`) as { official?: boolean }
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
    const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`plugin-manager: repair session ${sessionId} is unavailable`)
    const result = await binding.session.prompt([{ type: 'text', text: message }], 'queue')
    if (!result.ok) throw new Error(`plugin-manager: repair prompt failed: ${result.error.code}: ${result.error.message}`)
    ctx.sessions.open(sessionId)
  }

  const injected = (): PluginManagerFace => ({
    isLoopback: connection.isLoopback,
    list: async () => (await ensureMode()) === 'official' ? official.list() : gateway.list(),
    install: async spec => (await ensureMode()) === 'official' ? official.install(spec) : gateway.install(spec),
    update: async id => (await ensureMode()) === 'official' ? official.update(id) : gateway.update(id),
    uninstall: async id => (await ensureMode()) === 'official' ? official.uninstall(id) : gateway.uninstall(id),
    setEnabled: async (id, enabled) => (await ensureMode()) === 'official' ? official.setEnabled(id, enabled) : gateway.setEnabled(id, enabled),
    checkUpdates: async () => (await ensureMode()) === 'official' ? official.checkUpdates() : gateway.checkUpdates(),
    status: async () => (await ensureMode()) === 'official' ? official.status() : gateway.status(),
    failures: async () => (await ensureMode()) === 'official' ? official.failures() : gateway.failures(),
    setSafeMode: async enabled => (await ensureMode()) === 'official' ? official.setSafeMode(enabled) : gateway.setSafeMode(),
    repairPlugin,
    controlsList: async () => (await ensureMode()) === 'official' ? official.controlsList() : gateway.controlsList(),
    controlsSetEnabled: async (id, enabled) => (await ensureMode()) === 'official' ? official.controlsSetEnabled(id, enabled) : gateway.controlsSetEnabled(id, enabled),
    lastInstallConflicts: () => lastInstallConflicts,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'family-plugins',
    order: 20,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: injected,
  }, PluginManagerTab))
}
