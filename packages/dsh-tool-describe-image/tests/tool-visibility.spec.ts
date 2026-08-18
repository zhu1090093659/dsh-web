/**
 * Tool-visibility tests: multimodal sessions get describe_image masked from
 * their toolset (restrict deny), text-only and unknown sessions keep it, the
 * verdict follows the shared route chain at agent/created and corrects on
 * every agent/request, and model-selection changes re-run the resting
 * evaluation for fresh sessions.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installToolVisibility } from '../src/tool-visibility.ts'
import { UNKNOWN_CAPABILITY, type RouteCapabilityResolver } from '../src/model-capability.ts'

/** A structural fake ctx: captures event listeners, serves named services. */
function makeCtx(services: Record<string, unknown> = {}) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    on: (name: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(name, listener)
      return () => {}
    },
    get: (name: string) => services[name],
  } as unknown as Context
  return { ctx, listeners }
}

/** Fake scoped tools service recording restrict calls and returning disposers. */
function makeTools() {
  const restricts: Array<{ deny: string[] }> = []
  const disposers: Array<() => void> = []
  const tools = {
    restrict: vi.fn((filter: { deny: string[] }) => {
      restricts.push(filter)
      const dispose = vi.fn(() => {})
      disposers.push(dispose)
      return dispose
    }),
    restricts,
    disposers,
  }
  return tools
}

/** Fake agent with a scoped ctx carrying the tools service. */
function makeAgent(id: string, route: { provider: string; model: string } | undefined, tools: ReturnType<typeof makeTools>) {
  return {
    id,
    ctx: { tools } as unknown as Context,
    session: route === undefined ? undefined : { requestHeader: () => ({ config: route }) },
  }
}

/** A resolver over a route table; vi.fn-wrapped for call assertions. */
function makeResolver(table: Record<string, { acceptsImages: boolean; known: boolean }>) {
  const resolveRoute = vi.fn(async (route: { provider: string; model: string }) => {
    return table[route.provider + '/' + route.model] ?? UNKNOWN_CAPABILITY
  })
  return resolveRoute as unknown as RouteCapabilityResolver & { mock: typeof resolveRoute.mock }
}

/** Emit one captured event with the stored listener. */
function emit(listeners: Map<string, (...args: unknown[]) => unknown>, name: string, ...args: unknown[]): unknown {
  const listener = listeners.get(name)
  expect(listener).toBeDefined()
  return listener!(...args)
}

describe('installToolVisibility', () => {
  it('masks describe_image for a session whose logged route is multimodal', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'p/vl': { acceptsImages: true, known: true } })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s1', { provider: 'p', model: 'vl' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledTimes(1)
    expect(tools.restrict).toHaveBeenCalledWith({ deny: ['describe_image'] })
  })

  it('keeps describe_image visible for a session whose logged route is text-only', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'p/text': { acceptsImages: false, known: true } })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s2', { provider: 'p', model: 'text' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).not.toHaveBeenCalled()
  })

  it('evaluates a fresh session from the default-model service', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'dp/default-vision': { acceptsImages: true, known: true } })
    const agentDefaultModel = { currentSelection: () => ({ provider: 'dp', model: 'default-vision' }) }
    const { ctx, listeners } = makeCtx({ agentDefaultModel })
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s3', undefined, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledWith({ deny: ['describe_image'] })
  })

  it('keeps describe_image visible when the session model is unknown', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({})
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s4', undefined, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).not.toHaveBeenCalled()
  })

  it('lifts the mask when the running request corrects a multimodal verdict to text', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({
      'p/vl': { acceptsImages: true, known: true },
      'p/text': { acceptsImages: false, known: true },
    })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s5', { provider: 'p', model: 'vl' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledTimes(1)
    // The next request runs a text model: the mask must be lifted.
    await emit(listeners, 'agent/request', { agent }, async () => ({ provider: 'p', model: 'text' }))
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledTimes(1)
    expect(tools.disposers[0]).toHaveBeenCalledTimes(1)
  })

  it('adds the mask when the running request corrects a text verdict to multimodal', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({
      'p/text': { acceptsImages: false, known: true },
      'p/vl': { acceptsImages: true, known: true },
    })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s6', { provider: 'p', model: 'text' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).not.toHaveBeenCalled()
    await emit(listeners, 'agent/request', { agent }, async () => ({ provider: 'p', model: 'vl' }))
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledWith({ deny: ['describe_image'] })
  })

  it('cleans up the mask when the agent disposes', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'p/vl': { acceptsImages: true, known: true } })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s7', { provider: 'p', model: 'vl' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    emit(listeners, 'agent/disposed', { agent })
    expect(tools.disposers[0]).toHaveBeenCalledTimes(1)
  })

  it('re-runs the resting evaluation for live agents when the default model selection changes', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'dp/default-vision': { acceptsImages: true, known: true } })
    let defaultSelection = { provider: 'dp', model: 'text-default' }
    const agentDefaultModel = { currentSelection: () => defaultSelection }
    const { ctx, listeners } = makeCtx({ agentDefaultModel })
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s8', undefined, tools)
    // The fresh session was evaluated under a text default: tool visible.
    const agents = { list: () => [agent] }
    ;(ctx as unknown as { get: (n: string) => unknown }).get = (name: string) =>
      name === 'agents' ? agents : name === 'agentDefaultModel' ? agentDefaultModel : undefined
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).not.toHaveBeenCalled()
    // A model selection change moves the default to a vision model: the
    // resting evaluation must re-run and mask the tool.
    defaultSelection = { provider: 'dp', model: 'default-vision' }
    await emit(listeners, 'settings/updated', 'agent-default-model')
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledWith({ deny: ['describe_image'] })
  })

  it('ignores settings changes for other namespaces', async () => {
    const tools = makeTools()
    const resolveRoute = makeResolver({ 'dp/text-default': { acceptsImages: false, known: true } })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s9', undefined, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    await emit(listeners, 'settings/updated', 'some-other-namespace')
    await Promise.resolve()
    expect(tools.restrict).not.toHaveBeenCalled()
  })

  it('contains a restrict failure when the tool is not in the global layer', async () => {
    const tools = makeTools()
    tools.restrict.mockImplementation(() => {
      throw new Error('unknown global tool')
    })
    const resolveRoute = makeResolver({ 'p/vl': { acceptsImages: true, known: true } })
    const { ctx, listeners } = makeCtx({})
    installToolVisibility(ctx, resolveRoute)
    const agent = makeAgent('s10', { provider: 'p', model: 'vl' }, tools)
    await emit(listeners, 'agent/created', { agent })
    await Promise.resolve()
    expect(tools.restrict).toHaveBeenCalledTimes(1)
  })
})
