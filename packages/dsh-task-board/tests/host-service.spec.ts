import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'

const roots: string[] = []

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-task-board-service-'))
  roots.push(value)
  return value
}

function ok<T>(request: { rpcId: unknown }, value: T) {
  return { rpcId: request.rpcId, result: { ok: true as const, value } }
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('TaskBoardHostService scheduling without a browser', () => {
  it('fires one due run and records its independent session', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'scheduled', input: {
        title: 'Scheduled', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *' },
      },
    })
    const create = vi.fn(async (request) => ok(request, { sessionId: 'session-scheduled' }))
    const prompt = vi.fn(async (request) => ok(request, { accepted: true }))
    const api = {
      sessions: {
        create,
        rename: async (request: { rpcId: unknown }) => ok(request, { title: 'Scheduled', seq: 1 }),
        prompt,
      },
    } as unknown as ApiProxy
    const service = new TaskBoardHostService(api, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => now,
    })
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await (service as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    expect(ledger.state().tasks[0].executions[0].sessionId).toBe('session-scheduled')
    await (service as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    expect(create).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('skips a due occurrence on the recovery tick and rolls from current Host time', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'scheduled', input: {
        title: 'Scheduled', description: '', prompt: '', schedule: { enabled: true, cron: '* * * * *' },
      },
    })
    const create = vi.fn()
    const service = new TaskBoardHostService({ sessions: { create } } as unknown as ApiProxy, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => now,
    })
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    await (service as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(true)
    expect(create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].executions).toEqual([])
    expect(ledger.state().tasks[0].schedule?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 3, 0).getTime())
    service.dispose()
  })

  it('treats the first session snapshot after re-enable as unknown', () => {
    const service = new TaskBoardHostService({ sessions: {} } as unknown as ApiProxy, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    service.power.updateReasons({ runningSessions: 0, armedSchedules: 0, sessionStateKnown: true })
    service.setConfiguration(false, true)
    service.setConfiguration(true, true)
    expect(service.power.snapshot().sessionStateKnown).toBe(false)
    service.dispose()
  })

  it('returns the first ledger result for a duplicate request id', () => {
    const service = new TaskBoardHostService({ sessions: {} } as unknown as ApiProxy, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    const first = service.apply('request-a', {
      kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' },
    })
    service.apply('request-b', {
      kind: 'create', id: 'task-b', input: { title: 'B', description: '', prompt: '' },
    })
    const duplicate = service.apply('request-a', {
      kind: 'create', id: 'ignored', input: { title: 'ignored', description: '', prompt: '' },
    })
    expect(duplicate.revision).toBe(first.revision)
    expect(duplicate.tasks.map(task => task.id)).toEqual(['task-a'])
    service.dispose()
  })
})
