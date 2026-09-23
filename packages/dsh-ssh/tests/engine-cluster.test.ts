/**
 * Cluster module unit test: filters, concurrency and per-host error
 * capture, with the execCommand dependency mocked so no SSH server is
 * needed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import type { PoolEngine } from '../src/engine/connection-pool.ts'
import { DEFAULTS } from '../src/engine/connection-pool.ts'
import { cluster } from '../src/engine/cluster.ts'
import { execCommand } from '../src/engine/connection-pool.ts'
import type { HostStore } from '../src/store.ts'

vi.mock('../src/engine/connection-pool.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/connection-pool.ts')>()
  return {
    ...actual,
    execCommand: vi.fn(),
  }
})

const execCommandMock = execCommand as unknown as Mock

function fakeEngine(entries: unknown[]): PoolEngine {
  return {
    store: { list: () => entries } as unknown as HostStore,
    opts: { ...DEFAULTS },
    pool: new Map() as never,
    acquireQueue: new Map() as never,
  }
}

describe('cluster', () => {
  beforeEach(() => {
    execCommandMock.mockReset()
    execCommandMock.mockResolvedValue({ success: true, exitCode: 0, timedOut: false, stdout: 'ok', stderr: '', durationMs: 1 })
  })

  it('filters by aliases, environment and ALL tags', async () => {
    const entries = [
      { alias: 'a', environment: 'prod', tags: ['web'] },
      { alias: 'b', environment: 'staging', tags: ['web', 'staging'] },
      { alias: 'c', environment: 'prod', tags: ['db'] },
    ]
    const engine = fakeEngine(entries)
    const byAlias = await cluster(engine, { command: 'true', aliases: ['a', 'b'] })
    expect(byAlias.map(r => r.alias).sort()).toEqual(['a', 'b'])
    const byEnv = await cluster(engine, { command: 'true', aliases: ['a', 'b', 'c'], environment: 'prod' })
    expect(byEnv.map(r => r.alias).sort()).toEqual(['a', 'c'])
    const byTags = await cluster(engine, { command: 'true', aliases: ['a', 'b', 'c'], tags: ['web', 'staging'] })
    expect(byTags.map(r => r.alias)).toEqual(['b'])
  })

  it('rejects cluster execution when no selectors are provided', async () => {
    const engine = fakeEngine([{ alias: 'x', tags: [] }])
    await expect(cluster(engine, { command: 'true' })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)
    await expect(cluster(engine, { command: 'true', aliases: [] })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)
    await expect(cluster(engine, { command: 'true', aliases: ['  '], environment: '   ', tags: [] })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)
  })

  it('runs once per matched host and rejects invalid maxWorkers', async () => {
    const engine = fakeEngine([{ alias: 'x', tags: [] }])
    const results = await cluster(engine, { command: 'true', aliases: ['x'] })
    expect(results).toHaveLength(1)
    expect(execCommandMock).toHaveBeenCalledTimes(1)
    await expect(cluster(engine, { command: 'true', aliases: ['x'], maxWorkers: 0 })).rejects.toThrow(/maxWorkers/)
    await expect(cluster(engine, { command: 'true', aliases: ['x'], maxWorkers: -1 })).rejects.toThrow(/maxWorkers/)
  })

  it('captures per-host failures as failed results', async () => {
    execCommandMock.mockRejectedValue(new Error('boom'))
    const engine = fakeEngine([{ alias: 'x', tags: [] }, { alias: 'y', tags: [] }])
    const results = await cluster(engine, { command: 'true', aliases: ['x', 'y'] })
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.error).toBe('boom')
    }
  })
})