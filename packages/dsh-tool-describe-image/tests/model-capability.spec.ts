/**
 * Capability-probe tests: the session's own logged request route decides the
 * verdict, the default-model service covers fresh sessions, and every failure
 * fails closed to the conservative unknown answer that keeps the legacy
 * send-hook rewrite.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createCapabilityProbe, UNKNOWN_CAPABILITY } from '../src/model-capability.ts'

/** A structural fake ctx: serves named services. */
function makeCtx(services: Record<string, unknown> = {}) {
  const ctx = {
    get: (name: string) => services[name],
  } as unknown as Context
  return { ctx }
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

/** Fake agents registry: one agent per id with a logged request route. */
function makeAgents(routes: Record<string, { provider: string; model: string } | undefined>) {
  return {
    get: (id: string) => {
      const route = routes[id]
      return route === undefined
        ? undefined
        : { session: { requestHeader: () => ({ config: { provider: route.provider, model: route.model } }) } }
    },
  }
}

describe('createCapabilityProbe', () => {
  it('reports image input from the logged request route when the adapter declares the image modality', async () => {
    const llm = makeLlm(['text', 'image'])
    const { ctx } = makeCtx({ llm, agents: makeAgents({ s1: { provider: 'deepseek', model: 'vl-model' } }) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s1')).resolves.toEqual({ acceptsImages: true, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('deepseek', 'vl-model')
  })

  it('reports no image input when the logged route adapter explicitly omits the image modality', async () => {
    const { ctx } = makeCtx({ llm: makeLlm(['text']), agents: makeAgents({ s1: { provider: 'deepseek', model: 'text-model' } }) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s1')).resolves.toEqual({ acceptsImages: false, known: true })
  })

  it('answers unknown when the adapter discloses no modalities', async () => {
    const { ctx } = makeCtx({ llm: makeLlm(undefined), agents: makeAgents({ s1: { provider: 'deepseek', model: 'mystery' } }) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s1')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('falls back to the default-model service for a session with no logged request', async () => {
    const llm = makeLlm(['image'])
    const agentDefaultModel = { currentSelection: () => ({ provider: 'dp', model: 'default-vision' }) }
    const { ctx } = makeCtx({ llm, agentDefaultModel, agents: makeAgents({}) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('fresh')).resolves.toEqual({ acceptsImages: true, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('dp', 'default-vision')
  })

  it('prefers the logged request route over the default-model service', async () => {
    const llm = makeLlm(['text'])
    const agentDefaultModel = { currentSelection: () => ({ provider: 'dp', model: 'default-vision' }) }
    const { ctx } = makeCtx({
      llm,
      agentDefaultModel,
      agents: makeAgents({ s1: { provider: 'deepseek', model: 'text-model' } }),
    })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s1')).resolves.toEqual({ acceptsImages: false, known: true })
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('deepseek', 'text-model')
  })

  it('answers unknown when no route can be resolved at all', async () => {
    const { ctx } = makeCtx({ llm: makeLlm(['image']) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('nobody')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('answers unknown when the llm service is absent', async () => {
    const { ctx } = makeCtx({ agents: makeAgents({ s4: { provider: 'p', model: 'm' } }) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s4')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('answers unknown when exact-model resolution fails', async () => {
    const { ctx } = makeCtx({ llm: makeLlm(['image'], true), agents: makeAgents({ s5: { provider: 'p', model: 'm' } }) })
    const probe = createCapabilityProbe(ctx)
    await expect(probe('s5')).resolves.toEqual(UNKNOWN_CAPABILITY)
  })

  it('caches exact-model resolutions per route', async () => {
    const llm = makeLlm(['image'])
    const { ctx } = makeCtx({ llm, agents: makeAgents({ a: { provider: 'p', model: 'm' }, b: { provider: 'p', model: 'm' } }) })
    const probe = createCapabilityProbe(ctx)
    await probe('a')
    await probe('b')
    expect(llm.resolveModelInfo).toHaveBeenCalledTimes(1)
  })
})
