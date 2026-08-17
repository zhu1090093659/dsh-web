/**
 * Capability-probe tests: the agent/request recorder learns each agent's
 * effective route, resolution falls back through agent options and the
 * default-model service, and every failure fails closed to the conservative
 * unknown answer that keeps the legacy send-hook rewrite.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createCapabilityProbe, UNKNOWN_CAPABILITY } from '../src/model-capability.ts'

/** A structural fake ctx: captures event listeners, serves named services. */
function makeCtx(services: Record<string, unknown> = {}) {
  const listeners = new Map<string, (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>>()
  const ctx = {
    on: (name: string, listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) => {
      listeners.set(name, listener)
      return () => {}
    },
    get: (name: string) => services[name],
  } as unknown as Context
  return { ctx, listeners }
}

/** Fake llm service with a stubbed exact-model resolution. */
function makeLlm(inputModalities: readonly string[] | undefined, fail = false) {
  return {
    resolveModelInfo: vi.fn(async (_provider: string, _model: string) => {
      if (fail) throw new Error('adapter down')
      return inputModalities === undefined ? {} : { inputModalities }
    }),
  }
}

/** Drive the recorded agent/request waterfall listener once. */
async function recordRequest(listeners: ReturnType<typeof makeCtx>['listeners'], sessionId: string, provider: string, model: string) {
  const listener = listeners.get('agent/request')
  expect(listener).toBeDefined()
  const config = { provider, model }
  const returned = await listener!({ agent: { id: sessionId } }, async () => config)
  return { config, returned }
}

describe('createCapabilityProbe', () => {
  it('reports image input for a recorded route whose adapter declares the image modality', async () => {
    const llm = makeLlm(['text', 'image'])
    const { ctx, listeners } = makeCtx({ llm })
    const probe = createCapabilityProbe(ctx)
    await recordRequest(listeners, 's1', 'deepseek', 'vl-model')
    await expect(probe('s1')).resolves.toEqual({ acceptsImages: true, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('deepseek', 'vl-model')
  })

  it('reports no image input when the adapter explicitly omits the image modality', async () => {
    const { ctx, listeners } = makeCtx({ llm: makeLlm(['text']) })
    const probe = createCapabilityProbe(ctx)
    await recordRequest(listeners, 's1', 'deepseek', 'text-model')
    await expect(probe('s1')).resolves.toEqual({ acceptsImages: false, known: true })
  })

  it('answers unknown when the adapter discloses no modalities', async () => {
    const { ctx, listeners } = makeCtx({ llm: makeLlm(undefined) })
    const probe = createCapabilityProbe(ctx)
    await recordRequest(listeners, 's1', 'deepseek', 'mystery')
    await expect(probe('s1')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('leaves the downstream request config untouched', async () => {
    const { ctx, listeners } = makeCtx({ llm: makeLlm(['image']) })
    createCapabilityProbe(ctx)
    const { config, returned } = await recordRequest(listeners, 's1', 'p', 'm')
    expect(returned).toBe(config)
  })

  it('falls back to the agent registry options when no request was recorded', async () => {
    const llm = makeLlm(['image'])
    const agents = { get: (id: string) => (id === 's2' ? { options: { provider: 'p', model: 'vision' } } : undefined) }
    const { ctx } = makeCtx({ llm, agents })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s2')).resolves.toEqual({ acceptsImages: true, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('p', 'vision')
  })

  it('falls back to the agentDefaultModel service when the agent carries no options', async () => {
    const llm = makeLlm(['image'])
    const agents = { get: () => ({ options: {} }) }
    const agentDefaultModel = { currentSelection: () => ({ provider: 'dp', model: 'default-vision' }) }
    const { ctx } = makeCtx({ llm, agents, agentDefaultModel })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s3')).resolves.toEqual({ acceptsImages: true, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('dp', 'default-vision')
  })

  it('answers unknown when no route can be resolved at all', async () => {
    const { ctx } = makeCtx({ llm: makeLlm(['image']) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('nobody')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('answers unknown when the llm service is absent', async () => {
    const agents = { get: () => ({ options: { provider: 'p', model: 'm' } }) }
    const { ctx } = makeCtx({ agents })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s4')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('answers unknown when exact-model resolution fails', async () => {
    const agents = { get: () => ({ options: { provider: 'p', model: 'm' } }) }
    const { ctx } = makeCtx({ llm: makeLlm(['image'], true), agents })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s5')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('caches exact-model resolutions per route', async () => {
    const llm = makeLlm(['image'])
    const agents = { get: () => ({ options: { provider: 'p', model: 'm' } }) }
    const { ctx } = makeCtx({ agents, llm })
    const probe = createCapabilityProbe(ctx)
    await probe('a')
    await probe('b')
    expect(llm.resolveModelInfo).toHaveBeenCalledTimes(1)
  })
})
