import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createAutoEnsure, lifecycleWithUninstallMarker } from '../src/host/auto-ensure.ts'

const ok = { ok: true, code: 'OK', steps: [] as string[] }

describe('automatic Doctor deployment reconciliation', () => {
  it('installs once on a fresh enabled host and records the deployment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-auto-'))
    try {
      const ensure = vi.fn(async () => ok)
      const controller = createAutoEnsure({ stateDir: dir, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', lifecycle: { ensure, uninstall: async () => ok }, status: async () => ({ ok: false }), enabled: () => true, now: () => '2026-01-01T00:00:00Z' })
      await controller.kick()
      expect(ensure).toHaveBeenCalledTimes(1)
      expect(JSON.parse(await readFile(join(dir, 'deployed.json'), 'utf8'))).toMatchObject({ ok: true, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web' })
      expect(controller.state().phase).toBe('ready')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('uses marker plus live status and skips a healthy matching deployment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-auto-'))
    try {
      await writeFile(join(dir, 'deployed.json'), JSON.stringify({ ok: true, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', at: 'x' }))
      const ensure = vi.fn(async () => ok)
      const controller = createAutoEnsure({ stateDir: dir, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', lifecycle: { ensure, uninstall: async () => ok }, status: async () => ({ ok: true, snapshot: { protocol: 1, phase: 'armed', version: '1.2.3', profiles: [], incidents: [], updatedAt: 'x', policy: { fullProtection: true, autoRepair: false, autoMigrate: true } } }), enabled: () => true })
      await controller.kick()
      expect(ensure).not.toHaveBeenCalled()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('does not resurrect an explicitly uninstalled service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-auto-'))
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'deployed.json'), JSON.stringify({ ok: false, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', at: 'x', uninstalled: true }))
      const ensure = vi.fn(async () => ok)
      const controller = createAutoEnsure({ stateDir: dir, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', lifecycle: { ensure, uninstall: async () => ok }, status: async () => ({ ok: false }), enabled: () => true })
      await controller.kick()
      expect(ensure).not.toHaveBeenCalled()
      expect(controller.state().phase).toBe('suppressed')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('marks manual uninstall and manual reinstall durably', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-auto-'))
    try {
      const controller = createAutoEnsure({ stateDir: dir, version: '1.2.3', cliPath: '/pkg/cli.mjs', profileId: 'web', lifecycle: { ensure: async () => ok, uninstall: async () => ok }, status: async () => ({ ok: false }), enabled: () => true })
      const wrapped = lifecycleWithUninstallMarker({ ensure: async () => ok, uninstall: async () => ok }, controller)
      await wrapped.uninstall()
      expect(JSON.parse(await readFile(join(dir, 'deployed.json'), 'utf8')).uninstalled).toBe(true)
      await wrapped.ensure()
      const reinstalled = JSON.parse(await readFile(join(dir, 'deployed.json'), 'utf8')) as Record<string, unknown>
      expect(reinstalled).toMatchObject({ ok: true })
      expect(reinstalled).not.toHaveProperty('uninstalled')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
