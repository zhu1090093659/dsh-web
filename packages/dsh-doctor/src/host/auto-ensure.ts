import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SupervisorResponse } from '../core/protocol.ts'
import { writeJsonAtomic } from '../core/store.ts'
import type { DoctorLifecycle, LifecycleReport } from './ensure.ts'

export interface DeploymentMarker {
  version: string
  cliPath: string
  profileId: string
  ok: boolean
  at: string
  uninstalled?: boolean
  error?: string
}

export interface AutoEnsureState {
  phase: 'idle' | 'checking' | 'installing' | 'ready' | 'failed' | 'suppressed'
  lastAt?: string
  lastError?: string
}

export interface AutoEnsureDeps {
  stateDir: string
  version: string
  cliPath: string
  profileId: string
  lifecycle: DoctorLifecycle
  status(): Promise<SupervisorResponse>
  enabled(): boolean
  now?: () => string
}

export interface AutoEnsureController {
  kick(force?: boolean): Promise<void>
  suppress(): void
  markUninstalled(): Promise<void>
  record(report: LifecycleReport): Promise<void>
  state(): AutoEnsureState
}

/** Reconcile one user-level Doctor deployment without blocking host startup. */
export function createAutoEnsure(deps: AutoEnsureDeps): AutoEnsureController {
  const markerPath = join(deps.stateDir, 'deployed.json')
  const lockPath = join(deps.stateDir, 'reconcile.lock')
  const now = deps.now ?? (() => new Date().toISOString())
  let epoch = 0
  let pending: Promise<void> | undefined
  let snapshot: AutoEnsureState = { phase: 'idle' }

  const readMarker = async (): Promise<DeploymentMarker | undefined> => {
    try { return JSON.parse(await readFile(markerPath, 'utf8')) as DeploymentMarker } catch { return undefined }
  }
  const writeMarker = async (value: DeploymentMarker): Promise<void> => { await writeJsonAtomic(markerPath, value) }
  const desired = (marker: DeploymentMarker | undefined): boolean => marker === undefined || (marker.uninstalled !== true && (marker.ok !== true || marker.version !== deps.version || marker.cliPath !== deps.cliPath || marker.profileId !== deps.profileId))
  const record = async (report: LifecycleReport): Promise<void> => {
    const at = now()
    const error = report.ok ? undefined : (report.message ?? report.code)
    await writeMarker({ version: deps.version, cliPath: deps.cliPath, profileId: deps.profileId, ok: report.ok, at, ...(error === undefined ? {} : { error }) })
    snapshot = report.ok ? { phase: 'ready', lastAt: at } : { phase: 'failed', lastAt: at, lastError: error }
  }

  const acquireLock = async (): Promise<boolean> => {
    try {
      await mkdir(lockPath)
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, at: now() }), { mode: 0o600 })
      return true
    } catch {
      try {
        const age = Date.now() - (await stat(lockPath)).mtimeMs
        if (age <= 15 * 60_000) return false
        await rm(lockPath, { recursive: true, force: true })
        await mkdir(lockPath)
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, at: now() }), { mode: 0o600 })
        return true
      } catch { return false }
    }
  }

  const reconcile = async (force: boolean, runEpoch: number): Promise<void> => {
    if (!deps.enabled() || runEpoch !== epoch) { snapshot = { ...snapshot, phase: 'suppressed' }; return }
    snapshot = { phase: 'checking', lastAt: now() }
    const marker = await readMarker()
    if (marker?.uninstalled === true && !force) { snapshot = { phase: 'suppressed', lastAt: marker.at }; return }
    let needsEnsure = force || desired(marker)
    if (!needsEnsure) {
      try {
        const response = await deps.status()
        needsEnsure = !response.ok || response.snapshot?.version !== deps.version || response.snapshot?.policy === undefined
      } catch { needsEnsure = true }
    }
    if (!needsEnsure) { snapshot = { phase: 'ready', lastAt: now() }; return }
    await mkdir(deps.stateDir, { recursive: true, mode: 0o700 })
    if (!(await acquireLock())) {
      snapshot = { phase: 'checking', lastAt: now() }
      return
    }
    try {
      if (!deps.enabled() || runEpoch !== epoch) { snapshot = { phase: 'suppressed', lastAt: now() }; return }
      snapshot = { phase: 'installing', lastAt: now() }
      const report = await deps.lifecycle.ensure()
      if (!deps.enabled() || runEpoch !== epoch) { snapshot = { phase: 'suppressed', lastAt: now() }; return }
      await record(report)
    } finally { await rm(lockPath, { recursive: true, force: true }) }
  }

  return {
    kick(force = false): Promise<void> {
      const runEpoch = epoch
      pending ??= reconcile(force, runEpoch).catch(error => { snapshot = { phase: 'failed', lastAt: now(), lastError: error instanceof Error ? error.message : String(error) } }).finally(() => { pending = undefined })
      return pending
    },
    suppress(): void { epoch += 1; snapshot = { ...snapshot, phase: 'suppressed', lastAt: now() } },
    async markUninstalled(): Promise<void> {
      epoch += 1
      const at = now()
      await writeMarker({ version: deps.version, cliPath: deps.cliPath, profileId: deps.profileId, ok: false, at, uninstalled: true })
      snapshot = { phase: 'suppressed', lastAt: at }
    },
    record,
    state(): AutoEnsureState { return { ...snapshot } },
  }
}

export function serializeDoctorLifecycle(lifecycle: DoctorLifecycle): DoctorLifecycle {
  let tail: Promise<unknown> = Promise.resolve()
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const current = tail.catch(() => undefined).then(task)
    tail = current
    return current
  }
  return { ensure: () => run(() => lifecycle.ensure()), uninstall: () => run(() => lifecycle.uninstall()) }
}

export function lifecycleWithUninstallMarker(lifecycle: DoctorLifecycle, marker: Pick<AutoEnsureController, 'markUninstalled' | 'record'>): DoctorLifecycle {
  return {
    async ensure(): Promise<LifecycleReport> { const report = await lifecycle.ensure(); await marker.record(report); return report },
    async uninstall(): Promise<LifecycleReport> {
      const report = await lifecycle.uninstall()
      if (report.ok) await marker.markUninstalled()
      return report
    },
  }
}
