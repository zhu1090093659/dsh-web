import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { PowerInhibitor, WINDOWS_HELPER, type SpawnLike } from '../src/power-inhibitor.ts'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stdin = { end: vi.fn() }
  exitCode: number | null = null
  kill = vi.fn((_signal?: string) => true)
}

function child(): ChildProcess & FakeChild {
  return new FakeChild() as unknown as ChildProcess & FakeChild
}

describe('PowerInhibitor', () => {
  it('aggregates zero to one to many to zero reasons into one macOS helper', () => {
    const spawned: Array<{ file: string; args: readonly string[]; child: ChildProcess & FakeChild }> = []
    const spawn: SpawnLike = (file, args) => {
      const process = child()
      spawned.push({ file, args, child: process })
      return process
    }
    const power = new PowerInhibitor({ platform: 'darwin', pid: 42, spawn })
    power.updateReasons({ runningSessions: 0, armedSchedules: 0, sessionStateKnown: true })
    power.setEnabled(true)
    expect(power.snapshot().phase).toBe('idle')
    power.updateReasons({ runningSessions: 1, armedSchedules: 0, sessionStateKnown: true })
    spawned[0].child.emit('spawn')
    expect(spawned).toHaveLength(1)
    expect(spawned[0].file).toBe('/usr/bin/caffeinate')
    expect(spawned[0].args).toEqual(['-i', '-w', '42'])
    expect(spawned[0].args).not.toContain('-d')
    expect(power.snapshot().phase).toBe('active')
    power.updateReasons({ runningSessions: 3, armedSchedules: 2, sessionStateKnown: true })
    expect(spawned).toHaveLength(1)
    power.updateReasons({ runningSessions: 0, armedSchedules: 0, sessionStateKnown: true })
    expect(spawned[0].child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(power.snapshot().phase).toBe('idle')
  })

  it('protects unknown session state and uses only the Windows system-required flag', () => {
    let invocation: { file: string; args: readonly string[] } | undefined
    const process = child()
    const power = new PowerInhibitor({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawn: ((file, args) => { invocation = { file, args }; return process }) as SpawnLike,
    })
    power.setEnabled(true)
    expect(invocation?.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(invocation?.args.at(-1)).toBe(WINDOWS_HELPER)
    expect(WINDOWS_HELPER).toContain("ToUInt32('80000000', 16)")
    expect(WINDOWS_HELPER).toContain('0x00000001')
    expect(WINDOWS_HELPER).not.toContain('DISPLAY_REQUIRED')
    expect(WINDOWS_HELPER).not.toContain('AWAYMODE')
    process.stdout.emit('data', Buffer.from('READY\n'))
    expect(power.snapshot().phase).toBe('active')
    power.updateReasons({ runningSessions: 0, armedSchedules: 0, sessionStateKnown: true })
    expect(process.stdin.end).toHaveBeenCalledOnce()
  })

  it('backs off after helper failure and never spawns on unsupported platforms', () => {
    const delays: number[] = []
    const callbacks: Array<() => void> = []
    const children: Array<ChildProcess & FakeChild> = []
    const spawn: SpawnLike = () => {
      const process = child()
      children.push(process)
      return process
    }
    const timer = ((fn: () => void, delay?: number) => {
      callbacks.push(fn)
      delays.push(delay ?? 0)
      return callbacks.length as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    const power = new PowerInhibitor({ platform: 'darwin', spawn, setTimeout: timer })
    power.setEnabled(true)
    children[0].emit('error', new Error('boom'))
    expect(power.snapshot().phase).toBe('error')
    expect(delays).toEqual([1000])
    callbacks[0]()
    expect(children).toHaveLength(2)

    const unsupportedSpawn = vi.fn()
    const unsupported = new PowerInhibitor({ platform: 'linux', spawn: unsupportedSpawn as SpawnLike })
    unsupported.setEnabled(true)
    expect(unsupported.snapshot().phase).toBe('unsupported')
    expect(unsupportedSpawn).not.toHaveBeenCalled()
  })

  it('notifies subscribers when an asynchronous helper becomes ready', () => {
    const process = child()
    const power = new PowerInhibitor({ platform: 'darwin', spawn: (() => process) as SpawnLike })
    const phases: string[] = []
    power.subscribe(() => { phases.push(power.snapshot().phase) })
    power.setEnabled(true)
    process.emit('spawn')
    expect(phases).toContain('acquiring')
    expect(phases.at(-1)).toBe('active')
    power.dispose()
  })

  it('refuses a relative Windows SystemRoot instead of searching from the current directory', () => {
    const spawn = vi.fn()
    const power = new PowerInhibitor({ platform: 'win32', env: { SystemRoot: 'Windows' }, spawn: spawn as SpawnLike })
    power.setEnabled(true)
    expect(power.snapshot().phase).toBe('error')
    expect(power.snapshot().lastError).toContain('absolute')
    expect(spawn).not.toHaveBeenCalled()
    power.dispose()
  })
})
