import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HostExecutionRunner, SessionLaunchError } from '../src/host-runner.ts'

type GatewayRequest = {
  namespace: string
  method: string
  args: Record<string, unknown>
  signal?: AbortSignal
}

type FakeWorkspace = { id: string }

// Real 0.1.2-alpha.2 gateway wire contract, encoded from assertExactArguments
// in @deepseek-ai/dsh-api-gateway/lib/index.js plus the descriptor tables in
// each package's lib/typert.host.js: session/list carries its request under
// the '_request' wire key; session create/rename/prompt/page/follow (and the
// follow stream) carry it under 'request'; agentPresets/list declares no
// parameters. The fakes below throw on a wrong shape exactly like the real
// gateway, so a drifted invoke wrapper cannot pass silently.
const wireArgsKeys: Record<string, Record<string, readonly string[]>> = {
  agentPresets: { list: [] },
  session: {
    create: ['request'],
    rename: ['request'],
    prompt: ['request'],
    list: ['_request'],
    page: ['request'],
    follow: ['request'],
  },
}

function assertWireArgs(request: GatewayRequest): void {
  const expected = wireArgsKeys[request.namespace]?.[request.method]
  if (expected === undefined) throw new Error('unexpected endpoint ' + request.namespace + '/' + request.method)
  const actual = Object.keys(request.args)
  const missing = expected.filter(key => !actual.includes(key))
  const extra = actual.filter(key => !expected.includes(key))
  if (missing.length !== 0 || extra.length !== 0) {
    throw new Error('arguments-invalid for ' + request.namespace + '/' + request.method + ' (missing ' + JSON.stringify(missing) + ', unexpected ' + JSON.stringify(extra) + ')')
  }
}

function fakeInvoke(handle: (request: GatewayRequest) => Promise<unknown>) {
  return vi.fn(async (request: GatewayRequest) => {
    assertWireArgs(request)
    return handle(request)
  })
}

function fakeStream(handle: (request: GatewayRequest) => Promise<AsyncIterable<unknown>>) {
  return vi.fn(async (request: GatewayRequest) => {
    assertWireArgs(request)
    return handle(request)
  })
}

function workspaceRegistry(items: readonly FakeWorkspace[] = [{ id: 'workspace-a' }]) {
  return { list: vi.fn(() => items) } as unknown as { list(): readonly Workspace[] }
}

function sessionEvent(type: string, seq: number, time: number, data: unknown) {
  return { type: 'event' as const, event: { type, seq, time, data } }
}

function snapshot(records: readonly unknown[], cursor = Math.max(0, ...records.map(record => (record as { event?: { seq?: number } }).event?.seq ?? 0)), hasMore = false) {
  return { type: 'snapshot' as const, header: {}, cursor, records, hasMore, projections: {} }
}

function configuredTask(): TaskRecord {
  return {
    ...createTask({ title: 'Run me', description: '', prompt: 'do work' }, 1, 'task-a'),
    workspaceId: 'workspace-a',
    mode: 'preset-a',
    permission: 'workspace-write',
  }
}

describe('HostExecutionRunner', () => {
  it('validates and applies workspace, preset, and permission before the task prompt', async () => {
    const order: string[] = []
    const promptPayloads: unknown[] = []
    const commands = {
      execute: vi.fn(async (_sessionId: string, line: string) => {
        order.push('permission')
        expect(line).toBe('/permission workspace-write')
        return { kind: 'success' as const }
      }),
    }
    const gateway = {
      stream: fakeStream(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: fakeInvoke(async (request: GatewayRequest) => {
        if (request.namespace === 'agentPresets') {
          expect(request.args).toEqual({})
          order.push('preset')
          return { presets: [{ id: 'preset-a', isDefault: false }] }
        }
        const payload = request.args.request as Record<string, unknown>
        if (request.method === 'create') {
          order.push('create')
          return { sessionId: 'session-a', agentPreset: payload.agentPreset }
        }
        if (request.method === 'rename') {
          order.push('rename')
          return { title: payload.title, seq: 1 }
        }
        if (request.method === 'prompt') {
          promptPayloads.push(payload)
          order.push('prompt')
          return { accepted: true }
        }
        throw new Error('unexpected gateway call')
      }),
    }
    await expect(new HostExecutionRunner(gateway, commands, workspaceRegistry()).launch(configuredTask())).resolves.toBe('session-a')
    expect(order).toEqual(['preset', 'create', 'rename', 'permission', 'prompt'])
    expect(gateway.invoke.mock.calls[1]?.[0].args).toEqual({ request: { workspaceId: 'workspace-a', agentPreset: 'preset-a' } })
    expect(promptPayloads).toEqual([{ sessionId: 'session-a', requestId: expect.any(String), mode: 'queue', content: [{ type: 'text', text: 'do work' }] }])
  })

  it('fails closed on a stale workspace or unacknowledged permission command', async () => {
    const create = vi.fn()
    const gateway = {
      stream: fakeStream(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: fakeInvoke(async (request: GatewayRequest) => {
        if (request.method === 'create') return create()
        return { presets: [{ id: 'preset-a' }] }
      }),
    }
    await expect(new HostExecutionRunner(gateway, undefined, workspaceRegistry([])).launch(configuredTask())).rejects.toThrow('workspace not found')
    expect(create).not.toHaveBeenCalled()

    const prompt = vi.fn()
    const permissionRejected = {
      stream: fakeStream(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: fakeInvoke(async (request: GatewayRequest) => {
        if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
        if (request.method === 'create') return { sessionId: 'session-a' }
        if (request.method === 'rename') return { title: 'Run me', seq: 1 }
        if (request.method === 'prompt') return prompt()
        throw new Error('unexpected gateway call')
      }),
    }
    const unavailable = new HostExecutionRunner(permissionRejected, undefined, workspaceRegistry()).launch(configuredTask())
    await expect(unavailable).rejects.toThrow('permission command dispatcher is unavailable')
    await expect(unavailable).rejects.toMatchObject({ sessionId: 'session-a' })
    expect(prompt).not.toHaveBeenCalled()

    const rejected = new HostExecutionRunner(permissionRejected, {
      execute: async () => undefined,
    }, workspaceRegistry()).launch(configuredTask())
    await expect(rejected).rejects.toBeInstanceOf(SessionLaunchError)
    await expect(rejected).rejects.toMatchObject({ sessionId: 'session-a' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('fails closed when the permission command reports an error', async () => {
    const prompt = vi.fn()
    const gateway = {
      stream: fakeStream(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: fakeInvoke(async (request: GatewayRequest) => {
        if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
        if (request.method === 'create') return { sessionId: 'session-a' }
        if (request.method === 'rename') return { title: 'Run me', seq: 1 }
        if (request.method === 'prompt') return prompt()
        throw new Error('unexpected gateway call')
      }),
    }
    const launch = new HostExecutionRunner(gateway, {
      execute: async () => ({ kind: 'error', text: 'permission denied' }),
    }, workspaceRegistry()).launch(configuredTask())
    await expect(launch).rejects.toThrow('permission denied')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('bounds permission dispatch and fails closed when the command throws', async () => {
    const timeoutSignal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    try {
      const prompt = vi.fn()
      const execute = vi.fn(async (_sessionId: string, _line: string, signal: AbortSignal) => {
        expect(signal).toBe(timeoutSignal)
        throw new Error('permission command timed out')
      })
      const gateway = {
        stream: fakeStream(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
        invoke: fakeInvoke(async (request: GatewayRequest) => {
          if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
          if (request.method === 'create') return { sessionId: 'session-a' }
          if (request.method === 'rename') return { title: 'Run me', seq: 1 }
          if (request.method === 'prompt') return prompt()
          throw new Error('unexpected gateway call')
        }),
      }
      const launch = new HostExecutionRunner(gateway, { execute }, workspaceRegistry()).launch(configuredTask())
      await expect(launch).rejects.toMatchObject({
        name: 'SessionLaunchError',
        sessionId: 'session-a',
        message: expect.stringContaining('permission command timed out'),
      })
      expect(timeout).toHaveBeenCalledOnce()
      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(prompt).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
    }
  })

  it('settles from session list plus the newest turn end and waits on read failures', async () => {
    let running = true
    let historyOk = true
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gateway = {
      invoke: fakeInvoke(async (request: GatewayRequest) => {
        if (request.method === 'list') return { items: [{ sessionId: 'session-a', running }] }
        if (request.method === 'page') {
          if (!historyOk) throw new Error('offline')
          return { records: [sessionEvent('turn/end', 10, 1_100, { reason: { kind: 'error' } })], hasMore: false }
        }
        throw new Error('unexpected gateway call')
      }),
      stream: fakeStream(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([], 10, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    try {
      await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
      running = false
      await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'failed', error: 'agent turn ended with an error' })
      historyOk = false
      await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
      expect(warnSpy).toHaveBeenCalledWith('[dsh-task-board] session/page failed during execution inspection; keeping the outcome pending', expect.any(Error))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('pages backward to the execution turn and ignores later user turns in the same session', async () => {
    const page = vi.fn(async (request: GatewayRequest) => {
      const payload = request.args.request as { beforeSeq?: number }
      return payload.beforeSeq === undefined
        ? { records: [sessionEvent('turn/end', 300, 3_000, { reason: { kind: 'error' } })], hasMore: true }
        : { records: [sessionEvent('turn/end', 100, 1_100, { reason: { kind: 'complete' } }), sessionEvent('session/start', 90, 900, {})], hasMore: false }
    })
    const gateway = {
      invoke: fakeInvoke(async (request: GatewayRequest) => request.method === 'list'
        ? { items: [{ sessionId: 'session-a', running: false }] }
        : page(request)),
      stream: fakeStream(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('user/message', 400, 4_000, {})], 400, true)
        },
      })),
    }
    await expect(new HostExecutionRunner(gateway).inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    expect(page).toHaveBeenCalledTimes(2)
    expect((page.mock.calls[1]?.[0].args.request as { beforeSeq?: number }).beforeSeq).toBe(300)
  })

  it('carries the session list in listRunning and reuses it in inspect without another list RPC', async () => {
    const items = [{ sessionId: 'session-a', running: false }]
    const list = vi.fn(async () => ({ items }))
    const page = vi.fn(async () => ({ records: [sessionEvent('turn/end', 10, 1_100, { reason: { kind: 'complete' } })], hasMore: false }))
    const gateway = {
      invoke: fakeInvoke(async (request: GatewayRequest) => request.method === 'list' ? list() : page()),
      stream: fakeStream(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([], 10, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    const running = await runner.listRunning()
    expect(running).toEqual({ known: true, count: 0, items })
    if (!running.known) throw new Error('expected known')
    await expect(runner.inspect('session-a', 1_000, running.items)).resolves.toEqual({ outcome: 'succeeded' })
    expect(list).toHaveBeenCalledOnce()
    expect(page).toHaveBeenCalledOnce()
  })

  it('requests the host roster under the descriptor _request wire key and reports it known', async () => {
    const items = [{ sessionId: 'session-a', running: true }, { sessionId: 'session-b', running: false }]
    const gateway = {
      invoke: fakeInvoke(async () => ({ items })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.listRunning()).resolves.toEqual({ known: true, count: 1, items })
    expect(gateway.invoke).toHaveBeenCalledTimes(1)
    expect(gateway.invoke.mock.calls[0]?.[0]).toMatchObject({ namespace: 'session', method: 'list' })
    expect(gateway.invoke.mock.calls[0]?.[0].args).toEqual({ _request: {} })
  })

  it('logs swallowed gateway failures while keeping the roster unknown and the outcome pending', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const gateway = {
        invoke: fakeInvoke(async (request: GatewayRequest) => {
          if (request.namespace === 'session' && request.method === 'list') throw new Error('args fields do not match the descriptor: missing "_request"')
          throw new Error('unexpected gateway call')
        }),
      }
      const runner = new HostExecutionRunner(gateway)
      await expect(runner.listRunning()).resolves.toEqual({ known: false })
      expect(errorSpy).toHaveBeenCalledWith('[dsh-task-board] session/list failed; treating the host session roster as unknown', expect.any(Error))
      await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
      expect(warnSpy).toHaveBeenCalledWith('[dsh-task-board] session/list failed during execution inspection; keeping the outcome pending', expect.any(Error))
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('warns once and does not error on invocation-unavailable (DSH < 0.1.2-alpha.2) (#1313)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const gateway = {
        invoke: fakeInvoke(async () => {
          throw Object.assign(new Error('typert gateway: session/list: no active Remote method exports this endpoint'), { code: 'invocation-unavailable' })
        }),
      }
      const runner = new HostExecutionRunner(gateway)
      await expect(runner.listRunning()).resolves.toEqual({ known: false })
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DSH runtime session endpoint unavailable (requires DSH >= 0.1.2-alpha.2)'),
        expect.any(Error),
      )
      // Second call should not warn again
      await expect(runner.listRunning()).resolves.toEqual({ known: false })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('retries a boot-race service-unavailable roster error until the controller activates', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const items = [{ sessionId: 'session-a', running: false }]
      let calls = 0
      const gateway = {
        invoke: fakeInvoke(async () => {
          calls++
          if (calls === 1) {
            throw Object.assign(new Error('typert gateway: session/list: active Service "sessionController" is unavailable'), { code: 'service-unavailable' })
          }
          return { items }
        }),
      }
      const runner = new HostExecutionRunner(gateway, undefined, undefined, { attempts: 5, backoffMs: 0 })
      await expect(runner.listRunning()).resolves.toEqual({ known: true, count: 0, items })
      expect(calls).toBe(2)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('stops retrying after the unavailable window and reports the roster unknown once', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const gateway = {
        invoke: fakeInvoke(async () => {
          throw Object.assign(new Error('typert gateway: session/list: active Service "sessionController" is unavailable'), { code: 'service-unavailable' })
        }),
      }
      const runner = new HostExecutionRunner(gateway, undefined, undefined, { attempts: 3, backoffMs: 0 })
      await expect(runner.listRunning()).resolves.toEqual({ known: false })
      expect(gateway.invoke).toHaveBeenCalledTimes(3)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith('[dsh-task-board] session/list failed; treating the host session roster as unknown', expect.any(Error))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('probes the history head instead of re-scanning a wedged session whose newest seq is unchanged', async () => {
    let headSeq = 40
    const page = vi.fn(async (request: GatewayRequest) => ({
      records: [sessionEvent('assistant/message', headSeq, 4_000, {})],
      hasMore: false,
    }))
    const gateway = {
      invoke: fakeInvoke(async (request: GatewayRequest) => request.method === 'list' ? { items: [{ sessionId: 'session-a', running: false }] } : page(request)),
      stream: fakeStream(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('assistant/message', headSeq, 4_000, {})], headSeq, false)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    const afterFirst = page.mock.calls.length
    expect(afterFirst).toBe(0)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    expect(page.mock.calls.length).toBe(afterFirst)
    headSeq = 41
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    expect(page.mock.calls.length).toBe(afterFirst)
  })

  it('drops the scan memo once the execution settles or the session vanishes', async () => {
    let headSeq = 40
    let found = false
    const page = vi.fn(async (_request: GatewayRequest) => ({
      records: [found ? sessionEvent('turn/end', headSeq, 4_000, { reason: { kind: 'complete' } }) : sessionEvent('assistant/message', headSeq, 4_000, {})],
      hasMore: false,
    }))
    const gateway = {
      invoke: fakeInvoke(async (request: GatewayRequest) => request.method === 'list' ? { items: [{ sessionId: 'session-a', running: false }] } : page(request)),
      stream: fakeStream(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('assistant/message', headSeq, 4_000, {})], headSeq, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    found = true
    headSeq = 41
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    const callsBefore = page.mock.calls.length
    gateway.invoke.mockImplementation(async (request: GatewayRequest) => request.method === 'list' ? { items: [] } : page(request))
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'cancelled', error: 'execution session no longer exists' })
    expect(page.mock.calls.length).toBe(callsBefore)
  })
})
