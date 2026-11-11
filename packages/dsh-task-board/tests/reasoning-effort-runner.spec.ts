/**
 * The request data one card's execution effort produces.
 *
 * Every case launches through the real `HostExecutionRunner` against a
 * contract-checked gateway fake (the 0.1.2-alpha.2 wire layout: `session/*`
 * carries its request under `request`, `agentPresets/list` declares no
 * parameter, and `session/selectModel` requires `provider` + `model` with an
 * optional `reasoningEffort`). Payloads are captured and asserted AFTER the
 * launch resolves, so a swallowed in-flight failure can never make a case pass
 * vacuously.
 */
import { describe, expect, it } from 'vitest'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { ModelCatalogView } from '../src/core/model-catalog.ts'
import { HostExecutionRunner } from '../src/host-runner.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

interface GatewayRequest {
  namespace: string
  method: string
  args: Record<string, unknown>
  signal?: AbortSignal
}

/** The wire-argument layout asserted by the real gateway's assertExactArguments. */
const wireArgsKeys: Record<string, Record<string, readonly string[]>> = {
  agentPresets: { list: [] },
  session: {
    create: ['request'],
    rename: ['request'],
    prompt: ['request'],
    selectModel: ['request'],
    projections: ['request'],
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

/** One catalog: a plain chat model, a reasoner with two efforts, and a second provider. */
const catalog: ModelCatalogView = {
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  groups: [
    {
      id: 'deepseek',
      models: [
        { id: 'deepseek-chat' },
        { id: 'deepseek-reasoner', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }], defaultEffort: 'low' } },
      ],
    },
    { id: 'other', models: [{ id: 'plain-model' }] },
  ],
}

interface Harness {
  runner: HostExecutionRunner
  selectModel: Array<Record<string, unknown>>
  prompt: Array<Record<string, unknown>>
  projections: () => number
}

/**
 * A runner wired to a gateway fake that answers exactly the calls one launch
 * makes. `projections` is either the recorded model-selection reply or the
 * string 'unreadable', which makes the read fail. `rejectSelectModel` makes the
 * model-selection call itself fail, the way a gateway refuses a route.
 */
function harness(modelSelection: unknown = null, options: { rejectSelectModel?: boolean } = {}): Harness {
  const selectModel: Array<Record<string, unknown>> = []
  const prompt: Array<Record<string, unknown>> = []
  let projectionReads = 0
  const gateway = {
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
    invoke: async (request: GatewayRequest) => {
      assertWireArgs(request)
      if (request.namespace === 'agentPresets') return { presets: [] }
      const payload = (request.args.request ?? {}) as Record<string, unknown>
      if (request.method === 'create') return { sessionId: 'session-new' }
      if (request.method === 'rename') return { title: payload.title, seq: 1 }
      if (request.method === 'selectModel') {
        selectModel.push(payload)
        if (options.rejectSelectModel === true) throw new Error('session/selectModel refused the route')
        return { selected: { provider: payload.provider, model: payload.model } }
      }
      if (request.method === 'prompt') {
        prompt.push(payload)
        return { accepted: true }
      }
      if (request.method === 'projections') {
        projectionReads += 1
        if (modelSelection === 'unreadable') throw new Error('session/projections is unavailable')
        return { values: { modelSelection } }
      }
      throw new Error('unexpected gateway call: ' + request.method)
    },
  }
  return {
    runner: new HostExecutionRunner(gateway as never, undefined, fixtureWorkspaces()),
    selectModel,
    prompt,
    projections: () => projectionReads,
  }
}

/** One card with the given execution targets. */
function card(targets: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: 'Card', description: '', prompt: 'do work' }, 1, 'task-a'), ...targets }
}

describe('execution reasoning effort on a new session', () => {
  it('user running a card whose model declares the chosen effort sends it with the model', async () => {
    // Given a card pinning a reasoning model and one of its declared efforts
    const live = harness()
    const task = card({ model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' })

    // When the board launches the execution
    await live.runner.launch(task, { catalog })

    // Then the session receives that model route AND that exact effort, then the prompt
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.prompt).toHaveLength(1)
  })

  it('user switching a card to a model that does not declare the effort never sends it', async () => {
    // Given a card whose pinned model declares no reasoning levels at all
    const live = harness()
    const task = card({ model: 'deepseek/deepseek-chat', reasoningEffort: 'high' })

    // When the board launches the execution
    await live.runner.launch(task, { catalog })

    // Then only the model is selected: no invalid effort is ever sent, and the prompt still runs
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-chat' }])
    expect(live.prompt).toHaveLength(1)
  })

  it('user running a card that never chose an effort leaves the model selection as it was', async () => {
    // Given one card pinning a model with no effort, and one pinning nothing at all
    const pinned = harness()
    const plain = harness()

    // When both are launched
    await pinned.runner.launch(card({ model: 'deepseek/deepseek-reasoner' }), { catalog })
    await plain.runner.launch(card(), { catalog })

    // Then the pinned card selects its model with no effort key, and the plain card selects nothing
    expect(pinned.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner' }])
    expect(plain.selectModel).toEqual([])
    expect([pinned.prompt.length, plain.prompt.length]).toEqual([1, 1])
  })

  it('user pinning a bare model id gets its provider and effort resolved from the catalog', async () => {
    // Given a card whose model pin names no provider
    const live = harness()
    const task = card({ model: 'deepseek-reasoner', reasoningEffort: 'low' })

    // When the board launches the execution
    await live.runner.launch(task, { catalog })

    // Then the request is completed with the catalog's provider and the declared effort
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'low' }])
  })

  it('user running a card that pins no model applies the effort at the host default route', async () => {
    // Given a card with an effort and no model pin, and a host default that declares it
    const live = harness()
    const task = card({ reasoningEffort: 'high' })
    const reasonerDefault: ModelCatalogView = { ...catalog, default: { provider: 'deepseek', model: 'deepseek-reasoner' } }

    // When the board launches the execution
    await live.runner.launch(task, { catalog: reasonerDefault })

    // Then the host default route carries the effort
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.prompt).toHaveLength(1)
  })

  it('user running a card with an effort at a host default that declares none sends no effort', async () => {
    // Given a card with an effort and no model pin while the host default is a plain model
    const live = harness()

    // When the board launches the execution
    await live.runner.launch(card({ reasoningEffort: 'high' }), { catalog })

    // Then only the host default model is selected
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-chat' }])
  })
})

describe('execution reasoning effort on a reused session', () => {
  it('user running a card that pins no model reuses the session own route for the effort', async () => {
    // Given a reused session whose recorded route differs from the host default
    const live = harness({ lastUsed: { provider: 'other', model: 'plain-model' }, next: { provider: 'deepseek', model: 'deepseek-reasoner' } })

    // When the board launches a card that pins only an effort
    await live.runner.launch(card({ reasoningEffort: 'high' }), { reuseSessionId: 'session-old', catalog })

    // Then the session's own pending route is kept and carries the effort
    expect(live.selectModel).toEqual([{ sessionId: 'session-old', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.prompt).toHaveLength(1)
  })

  it('user running an effort-only card whose session route cannot be read sends no effort', async () => {
    // Given a reused session whose model selection cannot be read
    const live = harness('unreadable')

    // When the board launches a card that pins an effort but no model
    await live.runner.launch(card({ reasoningEffort: 'high' }), { reuseSessionId: 'session-old', catalog })

    // Then no model is switched and no effort is sent, while the prompt is still queued
    expect(live.selectModel).toEqual([])
    expect(live.prompt).toHaveLength(1)
  })

  it('user re-running a card on a reused session sends the pinned model and effort again', async () => {
    // Given a reused session and a card pinning a declared model + effort
    const live = harness({ lastUsed: { provider: 'deepseek', model: 'deepseek-chat' }, next: null })

    // When the board launches the execution
    await live.runner.launch(card({ model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' }), { reuseSessionId: 'session-old', catalog })

    // Then the pin is re-asserted on the existing session together with the effort
    expect(live.selectModel).toEqual([{ sessionId: 'session-old', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.projections()).toBe(0)
  })
})

describe('a session refusing the model selection', () => {
  it('user whose confirmed effort is refused sees the launch fail with nothing queued', async () => {
    // Given a card pinning a declared model and effort, and a gateway that refuses the route
    const live = harness(null, { rejectSelectModel: true })

    // When the board launches the execution
    const launch = live.runner.launch(card({ model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' }), { catalog })

    // Then the run fails before the prompt: an effort the catalog confirmed is
    // a contract, so the user must not silently get the model default instead
    await expect(launch).rejects.toThrow('refused the route')
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.prompt).toEqual([])
  })

  it('user whose model selection carries no effort keeps the best-effort launch', async () => {
    // Given a card that pins a model and never chose an effort, with the same refusing gateway
    const live = harness(null, { rejectSelectModel: true })

    // When the board launches the execution
    await live.runner.launch(card({ model: 'deepseek/deepseek-reasoner' }), { catalog })

    // Then the model switch is still attempted and reported only as a warning:
    // the task was asked to run, and no effort promise is broken by running it
    expect(live.selectModel).toEqual([{ sessionId: 'session-new', provider: 'deepseek', model: 'deepseek-reasoner' }])
    expect(live.prompt).toHaveLength(1)
  })
})
