/**
 * Host half of dsh-doctor: the loopback recovery API, the policy the runtime
 * acts on, and the HealthMonitor heartbeats. The plugin's own Config schema is
 * what the 0.1.7 Host settings surface serves (there is no separate settings
 * document and no `installSection` registration any more), so every policy
 * field is declared volatile: the Host projects volatile fields into the
 * entry's form, they are the only paths that accept a write, and an edit is
 * committed into the references this activation holds instead of remounting
 * the row.
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { currentPackageVersion } from './agent/version.ts'
import { doctorPaths } from './agent/paths.ts'
import { currentProfile } from './host/profile.ts'
import { SupervisorClient } from './host/client.ts'
import { startHeartbeat } from './host/heartbeat.ts'
import { makeDoctorRoutes } from './host/routes.ts'
import { createDoctorLifecycle, defaultProvisioned } from './host/ensure.ts'
import { createAutoEnsure, lifecycleWithUninstallMarker, serializeDoctorLifecycle } from './host/auto-ensure.ts'
import { DEFAULT_DOCTOR_POLICY, DOCTOR_PROTOCOL_VERSION, type DoctorPolicy } from './core/protocol.ts'
import { writeJsonAtomic } from './core/store.ts'
import { mountOnce } from './mount-once.ts'

export const name = 'doctor'
export const inject = ['webServer']

/**
 * Live plugin config: the Host hands every field to the plugin as a stable
 * reference it updates in place, which is also what makes the entry's settings
 * page render and accept writes.
 */
export interface Config {
  /** Master switch; the host mounts recovery routes only while enabled. */
  enabled: Volatile<boolean>
  /** Install the Supervisor and launcher on enable. */
  fullProtection: Volatile<boolean>
  /** Allow deterministic repairs to promote after the isolated gates pass. */
  autoRepair: Volatile<boolean>
  /** Automatically migrate legacy aggregate packages before starting DSH. */
  autoMigrate: Volatile<boolean>
  /** Host heartbeat cadence in milliseconds. */
  heartbeatIntervalMs: Volatile<number>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  fullProtection: z.boolean().default(true).volatile(),
  autoRepair: z.boolean().default(false).volatile(),
  autoMigrate: z.boolean().default(true).volatile(),
  heartbeatIntervalMs: z.number().min(1000).default(5000).volatile(),
})

/** Effective policy the runtime acts on, every field read at its use site. */
export interface DoctorConfig {
  enabled: boolean
  fullProtection: boolean
  autoRepair: boolean
  autoMigrate: boolean
  heartbeatIntervalMs: number
}

/**
 * Read one live config field. The Host validates the raw profile config and
 * hands volatile fields over as references, so a read goes through `get()`; a
 * plain value (a caller that resolved the schema itself) passes through, and
 * an absent field falls back to the schema default.
 */
function readField<T>(value: Volatile<T> | T | undefined, fallback: T): T {
  if (value === undefined || value === null) return fallback
  if (typeof (value as Volatile<T>).get === 'function') return ((value as Volatile<T>).get() as T | undefined) ?? fallback
  return value as T
}

export function effectiveConfig(config?: Config): DoctorConfig {
  return { enabled: readField(config?.enabled, true), fullProtection: readField(config?.fullProtection, DEFAULT_DOCTOR_POLICY.fullProtection), autoRepair: readField(config?.autoRepair, DEFAULT_DOCTOR_POLICY.autoRepair), autoMigrate: readField(config?.autoMigrate, DEFAULT_DOCTOR_POLICY.autoMigrate), heartbeatIntervalMs: readField(config?.heartbeatIntervalMs, 5000) }
}

export const apply = mountOnce('@linxin666/dsh-doctor', (ctx: Context, config?: Config): void => {
  let disposeRuntime: (() => void) | undefined
  let wasEnabled = false
  const profile = currentProfile()
  const paths = doctorPaths()
  const client = new SupervisorClient(paths)
  const hostVersion = currentPackageVersion()
  const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url))
  const baseLifecycle = serializeDoctorLifecycle(createDoctorLifecycle({ paths, cliPath, version: hostVersion, status: () => client.status(), markUninstall: () => client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'uninstall', profileId: profile.id }), shutdown: () => client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'shutdown' }), source: { home: profile.dshHome, profile: profile.name } }))
  let lifecycle = baseLifecycle
  const autoEnsure = createAutoEnsure({ stateDir: paths.state, version: hostVersion, cliPath, profileId: profile.id, lifecycle: baseLifecycle, status: () => client.status(), enabled: () => effectiveConfig(config).enabled })
  lifecycle = lifecycleWithUninstallMarker(baseLifecycle, autoEnsure)

  const syncPolicy = async (policy: DoctorPolicy): Promise<void> => {
    await writeJsonAtomic(join(paths.state, 'policy.json'), policy)
    await client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'policy', policy }).catch(() => undefined)
  }

  const sync = (): void => {
    disposeRuntime?.(); disposeRuntime = undefined
    const value = effectiveConfig(config)
    const policy = { fullProtection: value.fullProtection, autoRepair: value.autoRepair, autoMigrate: value.autoMigrate }
    // A policy sync must never take the host down: a failed atomic write or
    // IPC round-trip is a warning, not a fatal load failure.
    void syncPolicy(policy).catch((error) => console.warn('[dsh-doctor] policy sync failed:', error))
    if (!value.enabled) {
      autoEnsure.suppress()
      void client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'pause', profileId: profile.id }).catch(() => undefined)
      wasEnabled = false
      return
    }
    const routeDisposers = makeDoctorRoutes(client, profile.id, { hostVersion, lifecycle, provisioned: () => defaultProvisioned(paths) }).map(route => ctx.webServer.register(route))
    // A heartbeat failure means the supervisor child is gone (its spawning
    // host exited, or it crashed): re-kick the reconciler so this host takes
    // over spawning it. kick() coalesces concurrent runs.
    const disposeHeartbeat = value.fullProtection ? startHeartbeat({ client, profileId: profile.id, runId: process.env.DSH_DOCTOR_RUN_ID || 'unmanaged-' + process.pid, intervalMs: value.heartbeatIntervalMs, webUrl: () => `http://127.0.0.1:${ctx.webServer.port}`, onFailure: () => { void autoEnsure.kick() } }) : () => undefined
    disposeRuntime = () => { disposeHeartbeat(); for (const dispose of routeDisposers) dispose() }
    if (!wasEnabled) void client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'resume', profileId: profile.id }).catch(() => undefined)
    wasEnabled = true
    void autoEnsure.kick()
  }
  ctx.effect(() => { sync(); return () => { autoEnsure.suppress(); disposeRuntime?.() } }, 'doctor: runtime')
  // Live settings: an edit to a volatile config field is committed into the
  // references this activation already holds, and the Loader announces the
  // changed paths instead of remounting the row. Re-run the reconciler so the
  // switched policy (enable pause/resume, protection heartbeat, cadence) takes
  // effect without a host restart. The listener is owned by this fiber, so a
  // later remount cannot leave a stale reconciler subscribed.
  ctx.on('loader/volatile-update', () => { sync() })
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. Spelled here because the
     * Loader package is not a dependency of this plugin, with the Loader's own
     * shape so the two declarations merge when a Host program carries both.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}
