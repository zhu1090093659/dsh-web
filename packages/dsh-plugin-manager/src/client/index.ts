/**
 * Plugin-manager browser half: contributes this package's surfaces on the
 * official Plugins page — the check-for-updates block, the list-level update
 * toolbar, and the built-in plugin group at the list's bottom — and provides the
 * dual-channel face as the `'pluginManager'` cordis service for sibling client
 * plugins.
 *
 * It is dual-channel: on runtimes with the official installer services
 * (DSHCode, the 1.0.4 checkout web) every operation rides the official
 * `/plugin-installer` and `/plugin-control` loopback RPC channels (the single
 * writer); on the npm-published web runtime those channels do not exist, so the
 * same face falls back to this package's own loopback HTTP gateway, which
 * spawns the official CLI for writes. Neither the patch nor service consumers
 * know which mode the face runs in.
 *
 * The package used to register its own "Plugin manager" tab into the official
 * Plugins settings section (`settings.plugins.tab`). Installing, uninstalling
 * and enabling moved to the official page long ago, and the tab's remaining
 * half was UI no official page renders; the tab is gone and its one genuinely
 * missing capability — comparing an installed plugin against its registry
 * source, with the DSH-runtime compatibility gate — now renders inside the
 * official page through the `plugins.detail.section` seat it declares.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots, the
// registry this package registers its contribution into).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { PluginUpdatePatch, type PluginUpdatePatchInjected } from './PluginUpdatePatch.tsx'
import { mountBuiltinPluginGroup } from './builtin-plugins-mount.tsx'
import { bridgeRemoteNamespaces, getRemoteSnapshot, subscribeRemote } from './native-faces.ts'
import { mountPluginListToolbar } from './plugin-toolbar-mount.tsx'
import { en, zh, type PluginManagerKey } from './locales.ts'
import {
  batchUpdateResult,
  parseFailuresSnapshot,
  parseInstallStatus,
  parseInstalledPlugin,
  parsePluginList,
  parseRestartMode,
  parseRestartPlan,
  parseRestartRequired,
  parseUpdateList,
  parseUpdateOutcomes,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginBatchUpdateResult,
  type PluginFailuresSnapshot,
  type PluginUpdateItem,
  type PluginUpdateOutcome,
  type PluginUpdateResult,
  type RestartMode,
  type RestartPlanWire,
} from '../core/protocol.ts'
import { PLUGIN_MANAGER_SERVICE, type PluginManagerService } from '../core/service.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the check-for-updates patch. */
    'settings.pluginManager': PluginManagerKey
  }
}

const NS = 'settings.pluginManager'
const CHANNEL = '/plugin-installer'
const LIST_ENDPOINT = 'list'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UPDATES_ENDPOINT = 'updates'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const CHECK_UPDATES_ENDPOINT = 'check-updates'
const RESTART_ENDPOINT = 'restart'
const STATUS_ENDPOINT = 'status'
const FAILURES_ENDPOINT = 'failures'

// DOCUMENT-RELATIVE (issue #1707): the GUI is served with `<base href="./">`,
// so a sub-path deployment resolves the gateway prefix against its entry
// directory rather than the origin root.
const GATEWAY_PREFIX = 'api/plugin-manager'
/** Gateway job polling cadence. */
const JOB_POLL_MS = 500
/** Gateway job wait ceiling (the host add deadline is six minutes). */
const JOB_WAIT_MS = 7 * 60_000

/** Services required by the patch registration and both channels. */
export const inject = ['slots', 'locale', 'connection']

/** The gateway job wire shape served by /status. */
interface GatewayJobWire {
  phase: 'running' | 'done' | 'error'
  plugin?: unknown
  error?: string
  /**
   * Bundles the job applied but this process has not loaded (the host read
   * `application: 'restart-required'` from the official manager). Optional and
   * untyped here: it is read through {@link parseRestartRequired}, which
   * degrades an unusable value to "no restart needed" instead of rejecting an
   * update that already landed.
   */
  restartRequired?: unknown
  /**
   * The per-row outcomes of a batch update job, read through
   * {@link parseUpdateOutcomes}: one entry per requested plugin with the phase
   * it reached and, when it could not be applied, the host's reason.
   */
  results?: unknown
}

/**
 * The face the update patch and the `'pluginManager'` cordis service share:
 * the patch's wire surface plus the cross-plugin service contract. The gateway
 * host still records install conflicts and boot failures; no client surface
 * consumes either since the tab left, so neither is on this face.
 */
export type PluginManagerFace = PluginUpdatePatchInjected & PluginManagerService & {
  /**
   * Restart DSH so an applied plugin update is loaded. Always rides this
   * package's own loopback route: neither official channel
   * (`/plugin-installer`, `/plugin-control`) has a restart method, and the
   * route answers how the restart was carried out (in-place relaunch, or a
   * packaged Desktop shell that owns the process tree). See host/restart.ts.
   */
  restart: () => Promise<RestartMode>
  /**
   * Read how a restart would be carried out without triggering it (the same
   * route's plan read). The toolbar words its confirmation from this, so a
   * packaged Desktop host can say what its system dialog will do, and a
   * systemd host can name the unit that restarts, instead of surprising the
   * user with either.
   */
  restartPlan: () => Promise<RestartPlanWire>
  /**
   * Apply every listed update in one run, answering the rows that landed and the
   * rows that did not.
   *
   * The list-level toolbar used to drive one update job per plugin from the
   * browser, which spent a request and a job on each row and left the sequence —
   * and the decision to stop at the first refusal — in the component. The gateway
   * half now runs that sequence on the host as one job; the official installer
   * channel has no batch endpoint, so there the batch stays a loop of its own
   * single update, which is the only writer that channel accepts.
   */
  updateAll: (ids: readonly string[]) => Promise<PluginBatchUpdateResult>
}

/** Error text for a failed call, keeping the reason a thrown value carries. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the dual-channel face once: official-channel and gateway-channel
 * implementations, the mode detection that picks between them, and the
 * change-notification listener set. The returned face is both the update
 * patch's injected props and the value provided as the
 * `'pluginManager'` cordis service.
 * @param ctx - the client context (connection).
 * @returns the shared face.
 */
export function createPluginManagerFace(ctx: ClientContext): PluginManagerFace {
  const connection = ctx.get('connection') as ConnectionHandle

  // Official channel implementations.

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
    update: async (id: string): Promise<PluginUpdateResult> => ({
      plugin: parseInstalledPlugin(await call(UPDATE_ENDPOINT, { id })),
      // The official installer channel reports no restart fact: it owns the
      // load itself, so an applied update there is one this process serves.
      restartRequired: [],
    }),
    uninstall: async (id: string): Promise<InstalledPluginItem[]> => parsePluginList(await call(UNINSTALL_ENDPOINT, { id })),
    setEnabled: async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
      parseInstalledPlugin(await call(SET_ENABLED_ENDPOINT, { id, enabled })),
    checkUpdates: async (): Promise<PluginUpdateItem[]> => parseUpdateList(await call(CHECK_UPDATES_ENDPOINT, {})),
    status: async (): Promise<InstallProgressItem> => parseInstallStatus(await call(STATUS_ENDPOINT, {})),
    failures: async (): Promise<PluginFailuresSnapshot> => parseFailuresSnapshot(await call(FAILURES_ENDPOINT, {})),
    // One official update per id: this channel publishes no batch endpoint, and
    // its single call is the only writer it accepts. A refused row is collected
    // rather than thrown, so one plugin cannot discard the rest of the run.
    updateAll: async (ids: readonly string[]): Promise<PluginBatchUpdateResult> => {
      const applied: PluginUpdateOutcome[] = []
      const failed: PluginUpdateOutcome[] = []
      for (const id of ids) {
        try {
          const result = await official.update(id)
          applied.push({
            id,
            phase: 'done',
            landed: result.plugin.version,
            ...result.restartRequired.length > 0 ? { restartRequired: true } : {},
          })
        } catch (error) {
          failed.push({ id, phase: 'error', error: failureText(error) })
        }
      }
      return { applied, failed }
    },
  }

  // Gateway channel implementations.

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
        return parseInstalledPlugin({ plugin: job.plugin })
      } finally {
        gatewayInflight = false
      }
    },
    update: async (id: string): Promise<PluginUpdateResult> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/update`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway update returned no job')
        const job = await waitJob(started.jobId)
        return {
          plugin: parseInstalledPlugin({ plugin: job.plugin }),
          // The job is done either way; this is the difference between an
          // update this process serves and one only a restart loads.
          restartRequired: parseRestartRequired(job.restartRequired),
        }
      } finally {
        gatewayInflight = false
      }
    },
    updateAll: async (ids: readonly string[]): Promise<PluginBatchUpdateResult> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/${UPDATES_ENDPOINT}`, {
          method: 'POST',
          body: JSON.stringify({ ids: [...ids] }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway updates returned no job')
        const job = await waitJob(started.jobId)
        return batchUpdateResult(parseUpdateOutcomes(job.results))
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
    // Restart has no official-channel counterpart, so this route is the one
    // call that is always the gateway's, whichever mode the face runs in. The
    // GET-shaped call is the plan read: no state changes, no process exits.
    restartPlan: async (): Promise<RestartPlanWire> =>
      parseRestartPlan(await gatewayJson(`${GATEWAY_PREFIX}/${RESTART_ENDPOINT}`)),
    restart: async (): Promise<RestartMode> =>
      parseRestartMode(await gatewayJson(`${GATEWAY_PREFIX}/${RESTART_ENDPOINT}`, { method: 'POST' })),
  }

  // Mode selection.

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

  // Change notification.

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

  // The shared face.

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
    updateAll: async ids => {
      const result = await ((await ensureMode()) === 'official' ? official.updateAll(ids) : gateway.updateAll(ids))
      // Only a landed row is a change a consumer has to react to; a run whose
      // every row was refused leaves the installed set exactly as it was.
      if (result.applied.length > 0) notifyChange()
      return result
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
    restartPlan: () => gateway.restartPlan(),
    restart: () => gateway.restart(),
    status: async () => (await ensureMode()) === 'official' ? official.status() : gateway.status(),
    failures: async () => (await ensureMode()) === 'official' ? official.failures() : gateway.failures(),
    onChange: cb => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
}

/** Contribute the check-for-updates patch and provide the shared face. */
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

  // Built once: the patch and the 'pluginManager' cordis service share one
  // face, so consumers observe exactly the mutations the patch performs.
  const face = createPluginManagerFace(ctx)
  try {
    if (!ctx.get(PLUGIN_MANAGER_SERVICE)) {
      ctx.provide(PLUGIN_MANAGER_SERVICE, face)
    }
  } catch {
    // ignore duplicate provide
  }

  // The official remote namespaces the built-in group reads are OPTIONAL faces:
  // injecting each one keeps its arrival and withdrawal observable, so the
  // group shows what this deployment publishes instead of assuming it.
  try {
    bridgeRemoteNamespaces(ctx)
  } catch (error) {
    // A carrier without them keeps the group's own unavailable state; the
    // failure is logged so it is not mistaken for a deployment that has them.
    console.warn('plugin-manager: bridging the official plugin faces failed', error)
  }

  // The list-level toolbar rides the page's own "Installed" heading: the
  // official page declares no seat beside it, so the entry is inserted into
  // the heading element itself and tracks the page through the shared body
  // mutation hub. Its translate function is rebuilt on every render so a
  // language switch reaches copy that no slot outlet owns.
  ctx.effect(() => {
    try {
      return mountPluginListToolbar({
        props: () => ({
          isLoopback: face.isLoopback,
          checkUpdates: face.checkUpdates,
          update: face.update,
          updateAll: face.updateAll,
          restartPlan: face.restartPlan,
          restart: face.restart,
          t: ctx.locale.bind(NS),
        }),
        subscribe: listener => ctx.locale.subscribe(listener),
      })
    } catch {
      return () => {}
    }
  }, 'plugin-manager: update toolbar')

  // The built-in group sits at the list's bottom the way the toolbar sits beside
  // its heading: the page declares no seat there, so it is inserted after the
  // page's own installed panel and follows the page through the shared mutation
  // hub. The official faces are sampled per render and the subscription below
  // covers both a language switch and a host-side change event, so the mounted
  // copy never holds a stale answer.
  ctx.effect(() => {
    try {
      return mountBuiltinPluginGroup({
        props: () => ({
          remote: getRemoteSnapshot(),
          resolveText: text => ctx.locale.resolveText(text),
          t: ctx.locale.bind(NS),
        }),
        subscribe: listener => {
          const offLocale = ctx.locale.subscribe(listener)
          const offRemote = subscribeRemote(listener)
          return () => {
            offLocale()
            offRemote()
          }
        },
      })
    } catch (error) {
      // The group is chrome on someone else's page: a failed mount must not take
      // the page down, but it must not disappear without a trace either.
      console.warn('plugin-manager: mounting the built-in plugin group failed', error)
      return () => {}
    }
  }, 'plugin-manager: built-in plugin group')

  // The official Plugins page declares this seat on its main-panel entry and
  // renders one section per contribution on each bundle / row / plugin page;
  // `inject` waits for that declaration, exactly like the family plugin cards
  // that register into `plugins.bundle.config`.
  ctx.slots.inject('plugins.detail.section', () => {
    try {
      return ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'family-update-check',
        order: 30,
        locale: NS,
        inject: () => face,
      }, PluginUpdatePatch)
    } catch {
      return () => {}
    }
  })
}
