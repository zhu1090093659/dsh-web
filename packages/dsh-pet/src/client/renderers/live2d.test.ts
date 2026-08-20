// @vitest-environment jsdom
/**
 * Live2D renderer unit tests (pet-center M3, issue #623) — the vendor stack
 * is faked structurally (no pixi, no WebGL in jsdom); the runtime loader is
 * module-mocked so script injection never happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  core: true as boolean,
  vendor: undefined as unknown,
}))
vi.mock('./live2d/runtime.ts', () => ({
  ensureCubismCore: () => Promise.resolve(runtime.core),
  ensureLive2dVendor: () => Promise.resolve(runtime.vendor),
}))

import { live2dRenderer, resetLive2dRenderer, type Live2dRendererHandle } from './live2d.ts'
import { createPhaseStream, type PhaseStream } from '../phase-stream.ts'
import type { PetRendererContext } from '../../contracts/renderer.ts'

interface FakeModel {
  automator: { autoUpdate: boolean }
  calls: unknown[][]
  destroyCalls: Record<string, unknown>[]
  destroyed: number
  listeners: Record<string, () => void>
  width: number
  height: number
  anchor: { set(x: number, y?: number): void }
  position: { set(x: number, y: number): void }
  scale: { set(x: number, y?: number): void }
  internalModel: { settings: { motions: Record<string, unknown[]>; hitAreas: { Name: string }[] } }
  motion(group: string, index?: number): Promise<boolean>
  expression(name?: string): void
  hitTest(x: number, y: number): string[]
  on(event: string, fn: () => void): void
  destroy(options?: Record<string, unknown>): void
}

interface FakeApp {
  canvas: HTMLCanvasElement
  stage: { addChild(child: unknown): void }
  renderer: { width: number; height: number }
  init(options: Record<string, unknown>): Promise<void>
  destroy(rendererOptions?: boolean | { removeView?: boolean; releaseGlobalResources?: boolean }, options?: Record<string, unknown>): void
  destroyed: number
  destroyCalls: unknown[][]
  added: unknown
}

function fakeModel(motions: Record<string, unknown[]> = { Idle: [{}, {}], TapBody: [{}] }): FakeModel {
  const model: FakeModel = {
    automator: { autoUpdate: false },
    calls: [],
    destroyCalls: [],
    destroyed: 0,
    listeners: {},
    width: 1000,
    height: 1200,
    anchor: { set: (...args) => { model.calls.push(['anchor', ...args]) } },
    position: { set: (...args) => { model.calls.push(['position', ...args]) } },
    scale: { set: (...args) => { model.calls.push(['scale', ...args]) } },
    internalModel: { settings: { motions, hitAreas: [{ Name: 'Body' }] } },
    motion: (group, index) => { model.calls.push(['motion', group, index]); return Promise.resolve(true) },
    expression: (name) => { model.calls.push(['expression', name]) },
    hitTest: (x, y) => { model.calls.push(['hitTest', x, y]); return ['Body'] },
    on: (event, fn) => { model.listeners[event] = fn },
    destroy: (options = {}) => {
      model.destroyed += 1
      model.destroyCalls.push(options)
      model.automator.autoUpdate = false
    },
  }
  return model
}

function fakeApp(): FakeApp {
  const app: FakeApp = {
    canvas: document.createElement('canvas'),
    stage: { addChild: (child) => { app.added = child } },
    renderer: { width: 160, height: 174 },
    init: () => Promise.resolve(),
    destroy: (rendererOptions, options) => {
      app.destroyed += 1
      app.destroyCalls.push([rendererOptions, options])
      if (rendererOptions === true || (typeof rendererOptions === 'object' && rendererOptions.removeView === true)) app.canvas.remove()
      if (options?.children === true && typeof (app.added as { destroy?: unknown } | undefined)?.destroy === 'function') {
        ;(app.added as { destroy(options?: Record<string, unknown>): void }).destroy(options)
      }
    },
    destroyed: 0,
    destroyCalls: [],
    added: undefined,
  }
  return app
}

function fakeVendor(
  model: FakeModel,
  app: FakeApp,
  from: (source: string, options?: Record<string, unknown>) => Promise<FakeModel> = (_source, options) => {
    model.calls.push(['from', options])
    return Promise.resolve(model)
  },
): unknown {
  return {
    Application: class { constructor() { return app } },
    extensions: { add: () => {} },
    Live2DPlugin: {},
    configureCubismSDK: () => {},
    Live2DModel: { from },
  }
}

const CONFIG = { modelUrl: '/pet/haru/haru.model3.json', motions: { idle: 'Idle', thinking: 'TapBody' } }

function makeCtx(): { ctx: PetRendererContext; stream: PhaseStream; container: HTMLDivElement } {
  const container = document.createElement('div')
  const stream = createPhaseStream('idle')
  return {
    container,
    stream,
    ctx: {
      petId: 'haru',
      assetBase: '/pet/haru',
      container,
      phase: stream,
      interact: () => {},
      onCleanup: () => {},
    },
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('live2dRenderer', () => {
  beforeEach(() => {
    runtime.core = true
    resetLive2dRenderer()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('boots the model and maps phases onto motion groups with idle fallback', async () => {
    const model = fakeModel()
    const app = fakeApp()
    runtime.vendor = fakeVendor(model, app)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const { ctx, stream, container } = makeCtx()
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG))
    await flush()
    expect(container.querySelector('canvas')).toBeTruthy()
    expect(app.added).toBe(model)
    expect(model.calls).toContainEqual(['from', expect.objectContaining({ autoUpdate: false, autoHitTest: false, autoFocus: false })])
    expect(model.automator.autoUpdate).toBe(true)
    // idle plays on boot: group 'Idle', random index floor(0.99 * 2) = 1.
    expect(model.calls).toContainEqual(['motion', 'Idle', 1])
    // auto-fit: min(160/1000, 174/1200) * 0.92 = 0.1334
    const scaleCall = model.calls.find(call => call[0] === 'scale')
    expect(scaleCall?.[1]).toBeCloseTo(0.145 * 0.92, 4)
    stream.push('thinking')
    expect(model.calls).toContainEqual(['motion', 'TapBody', 0])
    stream.push('tool') // unmapped phase falls back to idle
    expect(model.calls.filter(call => call[0] === 'motion').at(-1)).toEqual(['motion', 'Idle', 1])
    handle.dispose()
    expect(app.destroyed).toBe(1)
    expect(app.destroyCalls[0]?.[0]).toEqual({ removeView: true })
    expect(model.destroyed).toBe(1)
    expect(model.destroyCalls).toContainEqual({ children: true })
    expect(model.automator.autoUpdate).toBe(false)
    handle.dispose() // idempotent
    expect(app.destroyed).toBe(1)
    expect(app.destroyCalls[0]?.[0]).toEqual({ removeView: true })
    expect(model.destroyed).toBe(1)
  })

  it('uses one automatic texture LOD instead of the default full mip chain', async () => {
    const model = fakeModel()
    const app = fakeApp()
    const from = vi.fn(async () => model)
    runtime.vendor = fakeVendor(model, app, from)
    const { ctx } = makeCtx()

    live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG))
    await flush()

    expect(from).toHaveBeenCalledWith(CONFIG.modelUrl, {
      autoUpdate: false,
      autoHitTest: false,
      autoFocus: false,
      textureOptions: { lod: 'single-auto' },
    })
  })

  it('falls back to the idle group when a mapped group is absent from the model', async () => {
    const model = fakeModel({ Idle: [{}] })
    runtime.vendor = fakeVendor(model, fakeApp())
    const { ctx, stream } = makeCtx()
    live2dRenderer.mount(ctx, live2dRenderer.validateConfig({ ...CONFIG, motions: { idle: 'Idle', done: 'Nope' } }))
    await flush()
    model.calls.length = 0
    stream.push('done')
    expect(model.calls).toContainEqual(['motion', 'Idle', 0])
  })

  it('layers the phase expression when the manifest declares one', async () => {
    const model = fakeModel()
    runtime.vendor = fakeVendor(model, fakeApp())
    const { ctx, stream } = makeCtx()
    live2dRenderer.mount(ctx, live2dRenderer.validateConfig({ ...CONFIG, expressions: { thinking: 'F01' } }))
    await flush()
    stream.push('thinking')
    expect(model.calls).toContainEqual(['expression', 'F01'])
  })

  it('plays the tap group on a declared hit area and resumes the phase group on finish', async () => {
    const model = fakeModel()
    runtime.vendor = fakeVendor(model, fakeApp())
    const { ctx } = makeCtx()
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig({ ...CONFIG, hitAreas: ['Body'] })) as Live2dRendererHandle
    await flush()
    model.calls.length = 0
    handle.tap(40, 60)
    expect(model.calls).toContainEqual(['hitTest', 40, 60])
    expect(model.calls).toContainEqual(['motion', 'TapBody', 0])
    model.calls.length = 0
    model.listeners.motionFinish?.()
    expect(model.calls).toContainEqual(['motion', 'Idle', expect.any(Number)])
  })

  it('ignores taps outside the declared hit areas', async () => {
    const model = fakeModel()
    runtime.vendor = fakeVendor(model, fakeApp())
    const { ctx } = makeCtx()
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig({ ...CONFIG, hitAreas: ['Head'] })) as Live2dRendererHandle
    await flush()
    model.calls.length = 0
    handle.tap(10, 10)
    expect(model.calls).toContainEqual(['hitTest', 10, 10])
    expect(model.calls.some(call => call[0] === 'motion')).toBe(false)
  })

  it('reports core-missing when the user has not installed the Cubism Core', async () => {
    runtime.core = false
    runtime.vendor = fakeVendor(fakeModel(), fakeApp())
    const { ctx } = makeCtx()
    let code: string | undefined
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG)) as Live2dRendererHandle
    handle.onError((next) => { code = next })
    await flush()
    expect(code).toBe('core-missing')
    handle.dispose()
  })

  it('reports load-failed when the model fetch rejects', async () => {
    const model = fakeModel()
    const app = fakeApp()
    runtime.vendor = {
      Application: class { constructor() { return app } },
      extensions: { add: () => {} },
      Live2DPlugin: {},
      configureCubismSDK: () => {},
      Live2DModel: { from: () => Promise.reject(new Error('404')) },
    }
    const { ctx } = makeCtx()
    let code: string | undefined
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG)) as Live2dRendererHandle
    handle.onError((next) => { code = next })
    await flush()
    expect(code).toBe('load-failed')
    expect(app.destroyed).toBe(1)
    expect(ctx.container.querySelector('canvas')).toBeNull()
    handle.dispose()
    expect(app.destroyed).toBe(1)
  })

  it('destroys both sides exactly once when disposed while model loading is pending', async () => {
    const model = fakeModel()
    const app = fakeApp()
    let resolveModel!: (value: FakeModel) => void
    const pendingModel = new Promise<FakeModel>((resolve) => { resolveModel = resolve })
    const from = vi.fn(() => pendingModel)
    runtime.vendor = {
      Application: class { constructor() { return app } },
      extensions: { add: () => {} },
      Live2DPlugin: {},
      configureCubismSDK: () => {},
      Live2DModel: { from },
    }
    const { ctx, container } = makeCtx()
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG))
    let error: string | undefined
    ;(handle as Live2dRendererHandle).onError((code) => { error = code })
    await flush()
    expect(from).toHaveBeenCalledTimes(1)
    expect(container.querySelector('canvas')).toBeTruthy()
    handle.dispose()
    expect(app.destroyed).toBe(1)
    expect(container.querySelector('canvas')).toBeNull()
    resolveModel(model)
    await flush()
    expect(app.destroyed).toBe(1)
    expect(model.destroyed).toBe(1)
    expect(model.destroyCalls).toContainEqual({ children: true })
    expect(model.automator.autoUpdate).toBe(false)
    expect(app.added).toBeUndefined()
    expect(error).toBeUndefined()
  })

  it('never appends a canvas when disposed mid-boot', async () => {
    const model = fakeModel()
    const app = fakeApp()
    runtime.vendor = fakeVendor(model, app)
    const { ctx, container } = makeCtx()
    const handle = live2dRenderer.mount(ctx, live2dRenderer.validateConfig(CONFIG))
    handle.dispose()
    await flush()
    expect(container.querySelector('canvas')).toBeNull()
    // The app created mid-boot is destroyed exactly once (no leak), never twice.
    expect(app.destroyed).toBe(1)
  })

  it('validateConfig is fail-closed', () => {
    expect(() => live2dRenderer.validateConfig({})).toThrow('modelUrl')
    expect(() => live2dRenderer.validateConfig({ modelUrl: '/x' })).toThrow('motions.idle')
    expect(live2dRenderer.validateConfig(CONFIG)).toBe(CONFIG)
  })
})
