import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PowerInhibitor, type SpawnLike } from '../src/power-inhibitor.ts'

function linuxLogin1Available(): boolean {
  if (process.platform !== 'linux') return false
  const executable = ['/usr/bin/systemd-inhibit', '/bin/systemd-inhibit'].find(path => existsSync(path))
  if (executable === undefined) return false
  return spawnSync(executable, ['--list', '--no-pager'], { stdio: 'ignore', timeout: 2_000 }).status === 0
}

const enabled = process.env.DSH_POWER_SMOKE === '1'
  && (process.platform === 'win32' || process.platform === 'darwin' || linuxLogin1Available())

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('native power helper timed out')
    await new Promise(resolve => { setTimeout(resolve, 50) })
  }
}

describe.runIf(enabled)('native power helper smoke', () => {
  it('starts, reports ready, and exits after release', async () => {
    let process: ChildProcess | undefined
    const realSpawn: SpawnLike = (file, args, options) => {
      process = spawn(file, [...args], options)
      return process
    }
    const power = new PowerInhibitor({ spawn: realSpawn })
    let launched: ChildProcess | undefined
    try {
      power.updateReasons({ runningSessions: 1, armedSchedules: 0, sessionStateKnown: true })
      power.setEnabled(true)
      await waitUntil(() => power.snapshot().phase === 'active' || power.snapshot().phase === 'error', 30_000)
      expect(power.snapshot().phase, power.snapshot().lastError).toBe('active')
      launched = process
      expect(launched).toBeDefined()
    } finally {
      power.dispose()
    }
    await waitUntil(() => launched!.exitCode !== null || launched!.signalCode !== null, 10_000)
  }, 45_000)
})
