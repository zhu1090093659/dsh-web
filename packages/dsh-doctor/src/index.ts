import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
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
export interface Config { enabled?: boolean; fullProtection?: boolean; autoRepair?: boolean; autoMigrate?: boolean; heartbeatIntervalMs?: number }
export const Config: z<Config> = z.object({ enabled: z.boolean().default(true), fullProtection: z.boolean().default(true), autoRepair: z.boolean().default(false), autoMigrate: z.boolean().default(true), heartbeatIntervalMs: z.number().min(1000).default(5000) })
export const DOCTOR_SETTINGS_NAMESPACE = settingsNamespace('doctor')

export function effectiveConfig(config?: Config): Required<Config> {
  return { enabled: config?.enabled ?? true, fullProtection: config?.fullProtection ?? DEFAULT_DOCTOR_POLICY.fullProtection, autoRepair: config?.autoRepair ?? DEFAULT_DOCTOR_POLICY.autoRepair, autoMigrate: config?.autoMigrate ?? DEFAULT_DOCTOR_POLICY.autoMigrate, heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 5000 }
}

export const apply = mountOnce('@linxin666/dsh-doctor', (ctx: Context, config?: Config): void => {
  let current: () => Config = () => config ?? {}
  let disposeRuntime: (() => void) | undefined
  let wasEnabled = false
  const profile = currentProfile()
  const paths = doctorPaths()
  const client = new SupervisorClient(paths)
  const hostVersion = currentPackageVersion()
  const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url))
  const baseLifecycle = serializeDoctorLifecycle(createDoctorLifecycle({ paths, cliPath, version: hostVersion, status: () => client.status(), markUninstall: () => client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'uninstall', profileId: profile.id }), source: { home: profile.dshHome, profile: profile.name } }))
  let lifecycle = baseLifecycle
  const autoEnsure = createAutoEnsure({ stateDir: paths.state, version: hostVersion, cliPath, profileId: profile.id, lifecycle: baseLifecycle, status: () => client.status(), enabled: () => effectiveConfig(current()).enabled })
  lifecycle = lifecycleWithUninstallMarker(baseLifecycle, autoEnsure)

  const syncPolicy = async (policy: DoctorPolicy): Promise<void> => {
    await writeJsonAtomic(join(paths.state, 'policy.json'), policy)
    await client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'policy', policy }).catch(() => undefined)
  }

  const sync = (): void => {
    disposeRuntime?.(); disposeRuntime = undefined
    const value = effectiveConfig(current())
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
    const disposeHeartbeat = value.fullProtection ? startHeartbeat({ client, profileId: profile.id, runId: process.env.DSH_DOCTOR_RUN_ID || 'unmanaged-' + process.pid, intervalMs: value.heartbeatIntervalMs, webUrl: () => `http://127.0.0.1:${ctx.webServer.port}` }) : () => undefined
    disposeRuntime = () => { disposeHeartbeat(); for (const dispose of routeDisposers) dispose() }
    if (!wasEnabled) void client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'action', action: 'resume', profileId: profile.id }).catch(() => undefined)
    wasEnabled = true
    void autoEnsure.kick()
  }
  installSettingsSection(ctx, DOCTOR_SETTINGS_NAMESPACE, Config, config ?? {}, { setSource: source => { current = source; sync() }, onChange: sync })
  ctx.effect(() => { sync(); return () => { autoEnsure.suppress(); disposeRuntime?.() } }, 'doctor: runtime')
})
