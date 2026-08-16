import { spawn, type ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PowerInhibitor, type SpawnLike } from '../src/power-inhibitor.ts'

const enabled = process.env.DSH_POWER_SMOKE === '1' && (process.platform === 'win32' || process.platform === 'darwin')

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
    power.updateReasons({ runningSessions: 1, armedSchedules: 0, sessionStateKnown: true })
    power.setEnabled(true)
    await waitUntil(() => power.snapshot().phase === 'active' || power.snapshot().phase === 'error', 10_000)
    expect(power.snapshot().phase, power.snapshot().lastError).toBe('active')
    const launched = process
    expect(launched).toBeDefined()
    power.dispose()
    await waitUntil(() => launched!.exitCode !== null || launched!.signalCode !== null, 5_000)
  }, 20_000)
})
