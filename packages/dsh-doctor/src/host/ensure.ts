import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialsFingerprint, removeCapsuleCredentialFiles } from '../agent/capsule.ts'
import { removeLegacyService } from '../agent/service.ts'
import type { DoctorPaths } from '../agent/paths.ts'
import type { SupervisorResponse } from '../core/protocol.ts'

/**
 * Lifecycle orchestration for the Doctor supervisor.
 *
 * The supervisor runs as a bounded child of the host that spawned it (with a
 * parent-liveness watch, see agent/supervisor.ts): it dies with the host
 * instead of living as an OS-registered login service. Ensure therefore
 * idempotently retires any legacy service registration, (re)spawns the
 * supervisor child when none answers with the current version, waits for it
 * to answer, and refreshes the rescue capsule when its pinned version is
 * stale. Uninstall marks the supervisor state, removes legacy registrations
 * and the capsule credentials. Every external effect sits behind injectable
 * seams so tests verify the full sequence without spawning real processes.
 * @module @linxin666/dsh-doctor/host
 */

/** Result of one spawned command. */
export interface SpawnResult { code: number; stdout: string; stderr: string }

/**
 * Environment for a Node child spawned through `process.execPath`. When the
 * host runs embedded in an Electron desktop app, execPath is the GUI binary:
 * without ELECTRON_RUN_AS_NODE the spawn boots a second GUI instance — the
 * single-instance lock refuses it, the main window is raised and focused on
 * every retry, and the child exits without ever answering (#1382). Plain
 * Node binaries ignore the variable, so it is set unconditionally.
 */
export function nodeChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, ELECTRON_RUN_AS_NODE: '1' }
}

/** Spawn seam: default runs the real process. */
export type SpawnFn = (command: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<SpawnResult>

/** Supervisor IPC seam (throws while the supervisor is down). */
export type StatusFn = () => Promise<SupervisorResponse>

/** Verdict of one lifecycle verb. */
export interface LifecycleReport {
  ok: boolean
  code: string
  message?: string
  /** Human-readable steps that ran, in order. */
  steps: string[]
}

export interface DoctorLifecycleDeps {
  paths: DoctorPaths
  /** Absolute path of the package CLI (lib/cli.mjs) driving the supervisor. */
  cliPath: string
  /** Version of the host half (package.json); capsule staleness compares against it. */
  version: string
  status: StatusFn
  /** Mark the supervisor state uninstalling before cleanup. */
  markUninstall?: () => Promise<unknown>
  /** One-shot command seam (capsule provisioning); tests inject fakes. */
  spawn?: SpawnFn
  /** Spawn the supervisor as a bounded child of this process; tests inject fakes. */
  spawnSupervisor?: () => void
  /** Ask an answering-but-stale supervisor to exit (IPC shutdown). */
  shutdown?: () => Promise<unknown>
  /** Retire a legacy OS service registration; tests inject fakes. */
  removeLegacyService?: () => Promise<boolean>
  /** Whether the supervisor state is provisioned (token file exists). */
  provisioned?: () => Promise<boolean>
  /** Whether the rescue capsule is missing or pinned to another doctor/credentials version. */
  capsuleStale?: (currentVersion: string, source?: { home: string; profile: string }) => Promise<boolean>
  /** Source profile whose credentials mirror staleness is checked against. */
  source?: { home: string; profile: string }
  pollAttempts?: number
  pollDelayMs?: number
}

export interface DoctorLifecycle {
  ensure(): Promise<LifecycleReport>
  uninstall(): Promise<LifecycleReport>
}

const PROVISION_TIMEOUT_MS = 10 * 60_000

/** Default spawn: buffer stdout/stderr, kill on timeout, never reject. */
function defaultSpawn(command: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<SpawnResult> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error) })
      return
    }
    let stdout = ''; let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
    child.once('error', error => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(error) }) })
    child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }) })
  })
}

/**
 * Default bounded-child spawn: the supervisor runs the current package CLI
 * with a parent-liveness watch on this process. Not detached and unref'd —
 * it joins this host's process group (process-group kills reach it) and it
 * never keeps the host's event loop alive on its own. The child env forces
 * ELECTRON_RUN_AS_NODE so an Electron host binary (desktop app embedding the
 * doctor host) runs the supervisor as headless Node instead of booting a
 * second GUI instance (#1382).
 */
export function defaultSpawnSupervisor(deps: DoctorLifecycleDeps): void {
  const child = spawn(process.execPath, [deps.cliPath, 'supervisor', '--parent-pid', String(process.pid)], { env: nodeChildEnv(), stdio: 'ignore' })
  child.unref()
}

/** True when the supervisor state directory holds the IPC token. */
export async function defaultProvisioned(paths: DoctorPaths): Promise<boolean> {
  try {
    await access(paths.token)
    return true
  } catch {
    return false
  }
}

/**
 * True when the capsule is absent, pinned to another doctor version, or its
 * mirrored credentials no longer match the current source files (the user
 * changed providers or keys since the last provision).
 */
export async function defaultCapsuleStale(paths: DoctorPaths, currentVersion: string, source?: { home: string; profile: string }): Promise<boolean> {
  try {
    const raw = await readFile(join(paths.capsule, 'current', 'manifest.json'), 'utf8')
    const manifest = JSON.parse(raw) as { doctorVersion?: unknown; credentialsMirror?: unknown; credentialsFingerprint?: unknown }
    if (manifest.doctorVersion !== currentVersion) return true
    const mirror = Array.isArray(manifest.credentialsMirror) ? manifest.credentialsMirror : []
    if (mirror.length === 0) return false
    if (source === undefined) return true
    const current = await credentialsFingerprint(source.home, source.profile)
    return manifest.credentialsFingerprint !== current
  } catch {
    return true
  }
}

/** Run one lifecycle verb; concurrent calls of the same verb share the run. */
export function createDoctorLifecycle(deps: DoctorLifecycleDeps): DoctorLifecycle {
  let ensuring: Promise<LifecycleReport> | undefined
  let uninstalling: Promise<LifecycleReport> | undefined
  return {
    ensure(): Promise<LifecycleReport> {
      ensuring ??= ensureDoctor(deps).finally(() => { ensuring = undefined })
      return ensuring
    },
    uninstall(): Promise<LifecycleReport> {
      uninstalling ??= uninstallDoctor(deps).finally(() => { uninstalling = undefined })
      return uninstalling
    },
  }
}

/** Retire legacy registrations, (re)spawn the supervisor, then refresh a stale capsule. */
export async function ensureDoctor(deps: DoctorLifecycleDeps): Promise<LifecycleReport> {
  const steps: string[] = []
  // One-time migration for pre-child deployments: the first ensure on a
  // machine that still carries an OS-registered service removes it. Cheap
  // and idempotent on every later run.
  const removeLegacy = deps.removeLegacyService ?? (() => removeLegacyService())
  if (await removeLegacy().catch(() => false)) steps.push('legacy-service')

  let response: SupervisorResponse | undefined
  try { response = await deps.status() } catch { response = undefined }
  const current = response?.ok === true
    && response.snapshot?.version === deps.version
    && response.snapshot?.policy !== undefined
  if (!current) {
    // An answering supervisor pinned to another version must make room for
    // the current one; a graceful IPC shutdown avoids racing its socket.
    if (response?.ok === true) await deps.shutdown?.().catch(() => undefined)
    ;(deps.spawnSupervisor ?? (() => defaultSpawnSupervisor(deps)))()
    steps.push('supervisor')
  }

  const awaited = await waitForSupervisor(deps)
  if (!awaited.ok) {
    return { ok: false, code: 'SUPERVISOR_UNAVAILABLE', message: awaited.message ?? 'supervisor did not answer', steps }
  }
  if (await (deps.capsuleStale ?? defaultCapsuleStale.bind(undefined, deps.paths))(deps.version, deps.source)) {
    const spawnImpl = deps.spawn ?? defaultSpawn
    const second = await spawnImpl(process.execPath, [deps.cliPath, 'provision'], { timeoutMs: PROVISION_TIMEOUT_MS, env: nodeChildEnv() })
    if (second.code !== 0) {
      return { ok: false, code: 'PROVISION_FAILED', message: second.stderr.trim() || second.stdout.trim() || 'provision exited ' + String(second.code), steps }
    }
    steps.push('capsule')
    const refreshed = await waitForSupervisor(deps)
    if (!refreshed.ok) {
      return { ok: false, code: 'SUPERVISOR_UNAVAILABLE', message: refreshed.message ?? 'supervisor did not answer after capsule refresh', steps }
    }
  }
  return { ok: true, code: 'OK', steps }
}

/** Mark the supervisor state, retire legacy registrations, drop capsule credentials. */
export async function uninstallDoctor(deps: DoctorLifecycleDeps): Promise<LifecycleReport> {
  const steps: string[] = []
  try {
    await deps.markUninstall?.()
  } catch {
    // The supervisor may already be gone; the cleanup still runs.
  }
  const removed = await (deps.removeLegacyService ?? (() => removeLegacyService()))().catch(() => false)
  if (removed) steps.push('legacy-service')
  const removedCredentials = await removeCapsuleCredentialFiles(deps.paths).catch(() => ({ removed: 0 }))
  if (removedCredentials.removed > 0) steps.push('credentials')
  return { ok: true, code: 'OK', steps }
}

/** Poll the supervisor until it answers or the attempts run out. */
async function waitForSupervisor(deps: DoctorLifecycleDeps): Promise<{ ok: boolean; message?: string }> {
  const attempts = deps.pollAttempts ?? 20
  const delay = deps.pollDelayMs ?? 1000
  const provisioned = deps.provisioned ?? defaultProvisioned.bind(undefined, deps.paths)
  let last = ''
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await deps.status()
      if (response.ok) return { ok: true }
      last = response.error?.message ?? 'supervisor refused'
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  const hasState = await provisioned().catch(() => false)
  if (!hasState) return { ok: false, message: 'supervisor is not provisioned' }
  return { ok: false, message: last || 'supervisor did not answer' }
}
