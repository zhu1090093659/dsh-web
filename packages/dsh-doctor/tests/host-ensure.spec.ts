import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { doctorPaths } from '../src/agent/paths.ts'
import {
  createDoctorLifecycle,
  defaultCapsuleStale,
  defaultProvisioned,
  defaultSpawnSupervisor,
  ensureDoctor,
  nodeChildEnv,
  uninstallDoctor,
  type DoctorLifecycleDeps,
  type SpawnResult,
} from '../src/host/ensure.ts'
import { credentialsFingerprint } from '../src/agent/capsule.ts'
import type { SupervisorResponse } from '../src/core/protocol.ts'

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(() => ({ unref: () => undefined }) as never) }
})

const POLICY = { fullProtection: true, autoRepair: false, autoMigrate: true }

function supervisorSnapshot(version: string): SupervisorResponse {
  return { ok: true, snapshot: { protocol: 1, phase: 'armed', version, policy: POLICY, profiles: [], incidents: [], updatedAt: '2026-01-01T00:00:00Z' } }
}

const currentResponse = supervisorSnapshot('9.9.9')

function okSpawn(code = 0): SpawnResult {
  return { code, stdout: '', stderr: code === 0 ? '' : 'boom' }
}

function depsWith(overrides: Partial<DoctorLifecycleDeps>): {
  deps: DoctorLifecycleDeps
  spawn: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  capsuleStale: ReturnType<typeof vi.fn>
  spawnSupervisor: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
  removeLegacyService: ReturnType<typeof vi.fn>
} {
  const spawn = vi.fn(async () => okSpawn(0))
  const status = vi.fn(async () => currentResponse)
  const capsuleStale = vi.fn(async () => false)
  const spawnSupervisor = vi.fn(() => undefined)
  const shutdown = vi.fn(async () => undefined)
  const removeLegacyService = vi.fn(async () => false)
  const paths = doctorPaths({ DSH_DOCTOR_HOME: '/nonexistent' })
  const deps: DoctorLifecycleDeps = {
    paths,
    cliPath: '/site/lib/cli.mjs',
    version: '9.9.9',
    status,
    spawn,
    capsuleStale,
    spawnSupervisor,
    shutdown,
    removeLegacyService,
    ...overrides,
  }
  return { deps, spawn, status, capsuleStale, spawnSupervisor, shutdown, removeLegacyService }
}

describe('ensureDoctor', () => {
  it('skips spawning when a current supervisor answers', async () => {
    const { deps, status, spawnSupervisor } = depsWith({})
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual([])
    expect(spawnSupervisor).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalled()
  })

  it('spawns a bounded supervisor child and records the step when none answers', async () => {
    const { deps, status, spawnSupervisor } = depsWith({})
    status.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual(['supervisor'])
    expect(spawnSupervisor).toHaveBeenCalledTimes(1)
  })

  it('shuts down a stale supervisor before respawning the current one', async () => {
    const { deps, status, shutdown, spawnSupervisor } = depsWith({})
    status.mockResolvedValueOnce(supervisorSnapshot('0.0.1'))
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual(['supervisor'])
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(spawnSupervisor).toHaveBeenCalledTimes(1)
  })

  it('records a legacy-service step only when a registration was removed', async () => {
    const { deps, removeLegacyService } = depsWith({})
    removeLegacyService.mockResolvedValue(true)
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual(['legacy-service'])
  })

  it('refreshes the capsule when stale and polls again', async () => {
    const { deps, spawn, capsuleStale, status } = depsWith({})
    capsuleStale.mockResolvedValue(true)
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual(['capsule'])
    expect(spawn.mock.calls[0]![1]).toEqual(['/site/lib/cli.mjs', 'provision'])
    // The provision child must be forced onto Node as well: under an Electron
    // host binary, execPath is the GUI executable (#1382).
    expect((spawn.mock.calls[0]![2] as { env?: Record<string, string> }).env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('reports SUPERVISOR_UNAVAILABLE when the spawned supervisor never answers', async () => {
    const { deps, status, capsuleStale, spawnSupervisor } = depsWith({})
    status.mockRejectedValue(new Error('ECONNREFUSED'))
    const outcome = await ensureDoctor({ ...deps, pollAttempts: 2, pollDelayMs: 1 })
    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('SUPERVISOR_UNAVAILABLE')
    expect(outcome.steps).toEqual(['supervisor'])
    expect(spawnSupervisor).toHaveBeenCalledTimes(1)
    expect(capsuleStale).not.toHaveBeenCalled()
  })

  it('reports PROVISION_FAILED when the capsule provision fails', async () => {
    const { deps, spawn, capsuleStale } = depsWith({})
    capsuleStale.mockResolvedValue(true)
    spawn.mockResolvedValue(okSpawn(1))
    const outcome = await ensureDoctor(deps)
    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('PROVISION_FAILED')
    expect(outcome.steps).toEqual([])
  })
})

describe('uninstallDoctor', () => {
  it('marks supervisor state, retires legacy registrations, and removes credentials', async () => {
    const markUninstall = vi.fn(async () => undefined)
    const removeLegacyService = vi.fn(async () => true)
    const { deps } = depsWith({ markUninstall, removeLegacyService })
    const outcome = await uninstallDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual(['legacy-service'])
    expect(markUninstall).toHaveBeenCalledTimes(1)
  })

  it('continues when the supervisor is already gone', async () => {
    const markUninstall = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const { deps } = depsWith({ markUninstall })
    const outcome = await uninstallDoctor(deps)
    expect(outcome.ok).toBe(true)
    expect(outcome.steps).toEqual([])
  })
})

describe('createDoctorLifecycle', () => {
  it('coalesces concurrent ensure calls into one reconciliation', async () => {
    const { deps, status, spawnSupervisor } = depsWith({})
    const cycle = createDoctorLifecycle(deps)
    const [a, b] = await Promise.all([cycle.ensure(), cycle.ensure()])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    // One reconciliation: one currency check plus one wait poll, no more.
    expect(status).toHaveBeenCalledTimes(2)
    expect(spawnSupervisor).not.toHaveBeenCalled()
  })
})

describe('capsule staleness and provisioning state', () => {
  it('detects a missing capsule, a stale pin and a fresh pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-cap-'))
    const paths = doctorPaths({ DSH_DOCTOR_HOME: dir })
    await mkdir(join(paths.capsule, 'current'), { recursive: true })
    try {
      expect(await defaultCapsuleStale(paths, '1.0.0')).toBe(true)
      await writeFile(join(paths.capsule, 'current', 'manifest.json'), JSON.stringify({ doctorVersion: '1.0.0' }), 'utf8')
      expect(await defaultCapsuleStale(paths, '1.0.0')).toBe(false)
      expect(await defaultCapsuleStale(paths, '2.0.0')).toBe(true)
      await writeFile(join(paths.capsule, 'current', 'manifest.json'), JSON.stringify({}), 'utf8')
      expect(await defaultCapsuleStale(paths, '1.0.0')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a changed credential source as stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-cap-'))
    const paths = doctorPaths({ DSH_DOCTOR_HOME: dir })
    const source = join(dir, 'source-home')
    await mkdir(join(source, 'profiles', 'web'), { recursive: true })
    await writeFile(join(source, '.env'), 'DSH_API_KEY=first\n', 'utf8')
    await mkdir(join(paths.capsule, 'current'), { recursive: true })
    try {
      const fingerprint = await credentialsFingerprint(source, 'web')
      await writeFile(join(paths.capsule, 'current', 'manifest.json'), JSON.stringify({ doctorVersion: '9.9.9', credentialsMirror: ['.env'], credentialsFingerprint: fingerprint }), 'utf8')
      expect(await defaultCapsuleStale(paths, '9.9.9', { home: source, profile: 'web' })).toBe(false)
      await writeFile(join(source, '.env'), 'DSH_API_KEY=changed\n', 'utf8')
      expect(await defaultCapsuleStale(paths, '9.9.9', { home: source, profile: 'web' })).toBe(true)
      expect(await defaultCapsuleStale(paths, '9.9.9')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats the token file as the provisioning marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-cap-'))
    const paths = doctorPaths({ DSH_DOCTOR_HOME: dir })
    try {
      expect(await defaultProvisioned(paths)).toBe(false)
      await mkdir(paths.state, { recursive: true })
      await writeFile(paths.token, 'x'.repeat(64), { mode: 0o600 })
      expect(await defaultProvisioned(paths)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('nodeChildEnv and defaultSpawnSupervisor', () => {
  it('forces ELECTRON_RUN_AS_NODE while preserving the host environment', () => {
    const env = nodeChildEnv({ PATH: '/bin', DSH_HOME: '/home/u/.dsh' })
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.DSH_HOME).toBe('/home/u/.dsh')
    expect(env.PATH).toBe('/bin')
  })

  it('spawns the supervisor as a headless Node child of this process (#1382)', () => {
    vi.mocked(nodeSpawn).mockClear()
    const deps = depsWith({}).deps
    defaultSpawnSupervisor(deps)
    expect(nodeSpawn).toHaveBeenCalledTimes(1)
    expect(nodeSpawn).toHaveBeenCalledWith(
      process.execPath,
      [deps.cliPath, 'supervisor', '--parent-pid', String(process.pid)],
      {
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        stdio: 'ignore',
      },
    )
  })
})
