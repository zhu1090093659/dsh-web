/**
 * Native-image route tests (rc.8 feature): the state view reads the
 * agent-default route and the llm-deepseek catalog, the toggle rewrites the
 * catalog entry through the official settings seam with revision fencing,
 * and the HTTP guard rejects non-loopback peers and malformed bodies.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { readNativeImageState, registerNativeImageRoutes, setNativeImageEnabled, LLM_DEEPSEEK_SETTINGS_NAMESPACE } from '../src/native-images.ts'
import type { InvalidatableRouteResolver, RouteCapabilityResolver } from '../src/model-capability.ts'

/** Fake agentDefaultModel service. */
class FakeDefaultModel extends Service {
  private selection: { provider: string; model: string } | undefined

  constructor(ctx: Context, selection?: { provider: string; model: string }) {
    super(ctx, 'agentDefaultModel')
    this.selection = selection
  }

  currentSelection(): { provider?: string; model?: string } {
    return this.selection ?? {}
  }
}

/** In-memory settings seam that applies 'set' ops so reads observe writes. */
class FakeSettings extends Service {
  readonly mutations: Array<{ ns: string; ops: unknown[]; revision?: number }> = []
  readonly doc: Record<string, unknown>

  constructor(ctx: Context, doc: Record<string, unknown>) {
    super(ctx, 'settings')
    this.doc = doc
  }

  describe(): Array<{ ns: string; value: unknown; revision: number }> {
    return Object.entries(this.doc).map(([ns, value]) => ({ ns, value, revision: 7 }))
  }

  async mutate(ns: unknown, ops: readonly { op: string; path: readonly string[]; value?: unknown }[], revision?: number): Promise<void> {
    this.mutations.push({ ns: String(ns), ops: [...ops], revision })
    for (const op of ops) {
      if (op.op === 'set' && op.path[0] === 'models') this.doc[String(ns)] = { models: op.value }
    }
  }
}

const alwaysAccepts = (async () => ({ acceptsImages: true, known: true })) as unknown as InvalidatableRouteResolver
alwaysAccepts.invalidate = () => {}
const ALWAYS_ACCEPTS: RouteCapabilityResolver & { invalidate(route: { provider: string; model: string }): void } = alwaysAccepts

/** A minimal HTTP request face (async-iterable body for POST reads). */
function makeRequest(overrides: Record<string, unknown> = {}) {
  const chunks: Buffer[] = []
  return {
    method: 'GET',
    url: '/describe-image/native-images',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost:3080', 'sec-fetch-site': 'same-origin' },
    ...overrides,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
    push(chunk: string) { chunks.push(Buffer.from(chunk)) },
  }
}

/** A minimal HTTP response face recording the envelope. */
function makeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status: number, _headers?: unknown) { this.status = status },
    end(payload: string) { this.body = payload },
  }
}

describe('readNativeImageState', () => {
  it('answers unknown and unsupported without a default model', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel)
    const state = await readNativeImageState(ctx, ALWAYS_ACCEPTS)
    expect(state.supported).toBe(false)
    expect(state.capability).toEqual({ acceptsImages: false, known: false })
  })

  it('reports the catalogued modalities and the resolved verdict', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel, { provider: 'deepseek', model: 'v4-pro' })
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [{ id: 'v4-pro', inputModalities: ['text', 'image'] }] } })
    const state = await readNativeImageState(ctx, ALWAYS_ACCEPTS)
    expect(state.supported).toBe(true)
    expect(state.provider).toBe('deepseek')
    expect(state.model).toBe('v4-pro')
    expect(state.inputModalities).toEqual(['text', 'image'])
    expect(state.capability.acceptsImages).toBe(true)
  })
})

describe('setNativeImageEnabled', () => {
  it('adds a catalog entry with image input when enabled', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel, { provider: 'deepseek', model: 'v4-pro' })
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [] } })
    await setNativeImageEnabled(ctx, true)
    const settings = ctx.get('settings') as unknown as FakeSettings
    expect(settings.mutations).toHaveLength(1)
    expect(settings.mutations[0].revision).toBe(7)
    expect((settings.doc[String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)] as { models: unknown[] }).models)
      .toEqual([{ id: 'v4-pro', inputModalities: ['text', 'image'] }])
  })

  it('flips an existing entry back to text-only when disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel, { provider: 'deepseek', model: 'v4-pro' })
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [{ id: 'v4-pro', name: 'Pro', inputModalities: ['text', 'image'] }] } })
    await setNativeImageEnabled(ctx, false)
    const models = ((ctx.get('settings') as unknown as FakeSettings).doc[String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)] as { models: Array<Record<string, unknown>> }).models
    expect(models).toEqual([{ id: 'v4-pro', name: 'Pro', inputModalities: ['text'] }])
  })

  it('rejects the write when the adapter namespace is missing', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel, { provider: 'deepseek', model: 'v4-pro' })
    await ctx.plugin(FakeSettings, {})
    await expect(setNativeImageEnabled(ctx, true)).rejects.toThrow(/not available/)
  })
})

describe('registerNativeImageRoutes', () => {
  it('serves the state envelope on a loopback GET', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel)
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [] } })
    const [route] = registerNativeImageRoutes(ctx, ALWAYS_ACCEPTS)
    const res = makeResponse()
    await route.handler(makeRequest() as never, res as never)
    expect(res.status).toBe(200)
    const envelope = JSON.parse(res.body) as { ok: boolean; value: { supported: boolean } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.supported).toBe(false)
  })

  it('refuses a non-loopback peer with 403', async () => {
    const ctx = new Context()
    const [route] = registerNativeImageRoutes(ctx, ALWAYS_ACCEPTS)
    const res = makeResponse()
    await route.handler(makeRequest({ socket: { remoteAddress: '10.0.0.1' } }) as never, res as never)
    expect(res.status).toBe(403)
  })

  it('rejects a malformed toggle body with 400', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel)
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [] } })
    const [route] = registerNativeImageRoutes(ctx, ALWAYS_ACCEPTS)
    const req = makeRequest({ method: 'POST' })
    req.push('{"nope":true}')
    const res = makeResponse()
    await route.handler(req as never, res as never)
    expect(res.status).toBe(400)
  })

  it('toggles through the POST envelope and returns the refreshed state', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeDefaultModel, { provider: 'deepseek', model: 'v4-pro' })
    await ctx.plugin(FakeSettings, { [String(LLM_DEEPSEEK_SETTINGS_NAMESPACE)]: { models: [] } })
    const [route] = registerNativeImageRoutes(ctx, ALWAYS_ACCEPTS)
    const req = makeRequest({ method: 'POST' })
    req.push('{"enabled":true}')
    const res = makeResponse()
    await route.handler(req as never, res as never)
    expect(res.status).toBe(200)
    const envelope = JSON.parse(res.body) as { ok: boolean; value: { inputModalities: string[]; capability: { acceptsImages: boolean } } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.inputModalities).toEqual(['text', 'image'])
    expect(envelope.value.capability.acceptsImages).toBe(true)
  })
})