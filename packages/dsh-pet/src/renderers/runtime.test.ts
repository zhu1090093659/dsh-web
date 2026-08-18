import { describe, expect, it, vi } from 'vitest'

import { PET_INTENT_VERSION, type PetIntent } from '../core/intent.ts'
import {
  PET_MODEL_SCHEMA_VERSION,
  PET_RENDERER_API_VERSION,
  type PetAssetResolver,
  type PetModelDescriptor,
  type PetRenderer,
  type PetRendererCreateContext,
  type PetRendererDescriptor,
  type PetRendererProvider,
} from '../contracts/renderer.ts'
import { PetRendererRegistry } from './registry.ts'
import { PetRendererRuntime, type PetResolvedModel } from './runtime.ts'

const assets: PetAssetResolver = {
  fetch: async () => new ArrayBuffer(0),
}
const surface = {
  element: {} as HTMLElement,
  width: 192,
  height: 208,
  devicePixelRatio: 1,
}
const intent: PetIntent = {
  version: PET_INTENT_VERSION,
  id: 'activity:working',
  source: 'activity',
  createdAt: 10,
  priority: 40,
  interruptible: true,
  expression: 'focused',
  motion: 'working',
  playback: 'loop',
  speech: { id: 'speech:1', text: 'Working', createdAt: 10 },
  sourceTaskIds: ['task-1'],
}

function descriptor(id: string): PetRendererDescriptor {
  return {
    apiVersion: PET_RENDERER_API_VERSION,
    id,
    displayName: id,
    kind: 'sprite2d',
    version: '1.0.0',
    capabilities: {
      expressions: false, motions: true, lookAt: false, lipSync: false, hitAreas: true, transparentBackground: true,
    },
    supportedModelFormats: ['petdex-v1'],
  }
}

function model(id: string, rendererId: string): PetModelDescriptor {
  return {
    schemaVersion: PET_MODEL_SCHEMA_VERSION,
    id,
    displayName: id,
    rendererId,
    format: 'petdex-v1',
    entry: 'spritesheet.webp',
    source: { kind: 'builtin' },
    capabilities: { motions: ['idle', 'working'], expressions: [], lookAt: false, lipSync: false, hitAreas: ['body'] },
    bindings: { motions: { idle: 'idle', working: 'running-right' }, expressions: {} },
    fallback: { motion: 'idle', expression: 'neutral' },
  }
}

function mockProvider(
  id: string,
  log: string[],
  options: { failLoad?: boolean, onCreate?: (emit: PetRendererCreateContext['emit']) => void } = {},
): PetRendererProvider {
  const rendererDescriptor = descriptor(id)
  return {
    descriptor: rendererDescriptor,
    create: async (context) => {
      options.onCreate?.(context.emit)
      log.push(`${id}:create:${String(context.signal.aborted)}`)
      const renderer: PetRenderer = {
        descriptor: rendererDescriptor,
        mount: async () => { log.push(`${id}:mount`) },
        loadModel: async (next) => {
          log.push(`${id}:load:${next.id}`)
          if (options.failLoad === true) throw new Error(`${id} load failed`)
        },
        applyIntent: async next => { log.push(`${id}:intent:${next.id}`) },
        applySpeech: async speech => { log.push(`${id}:speech:${speech.id}`) },
        resize: () => { log.push(`${id}:resize`) },
        setVisible: visible => { log.push(`${id}:visible:${String(visible)}`) },
        setQuality: quality => { log.push(`${id}:quality:${quality}`) },
        dispose: async () => { log.push(`${id}:dispose:${String(context.signal.aborted)}`) },
      }
      return renderer
    },
  }
}

function resolved(descriptor: PetModelDescriptor): PetResolvedModel {
  return { descriptor, assets }
}

describe('PetRendererRuntime', () => {
  it('disposes before switching and restores the current intent and speech', async () => {
    const log: string[] = []
    const registry = new PetRendererRegistry()
    registry.register(mockProvider('builtin:sprite2d', log))
    registry.register(mockProvider('test:alternate', log))
    const first = model('model:first', 'builtin:sprite2d')
    const second = model('model:second', 'test:alternate')
    const models = new Map([
      [first.id, resolved(first)],
      [second.id, resolved(second)],
    ])
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: id => models.get(id),
    })

    await runtime.applyIntent(intent)
    await runtime.selectModel(first.id)
    const firstDisposeIndex = log.length
    await runtime.selectModel(second.id)

    expect(log.slice(firstDisposeIndex, firstDisposeIndex + 4)).toEqual([
      'builtin:sprite2d:dispose:true',
      'test:alternate:create:false',
      'test:alternate:mount',
      'test:alternate:load:model:second',
    ])
    expect(log).toContain('test:alternate:intent:activity:working')
    expect(log).toContain('test:alternate:speech:speech:1')
    await runtime.dispose()
    expect(log.at(-1)).toBe('test:alternate:dispose:true')
  })

  it('disposes a failed renderer and activates the explicit built-in fallback', async () => {
    const log: string[] = []
    const errors: string[] = []
    const registry = new PetRendererRegistry()
    registry.register(mockProvider('test:broken', log, { failLoad: true }))
    registry.register(mockProvider('builtin:sprite2d', log))
    const broken = model('model:broken', 'test:broken')
    const whale = model('builtin:whale', 'builtin:sprite2d')
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: id => id === broken.id ? resolved(broken) : undefined,
      fallbackSelections: () => [{ rendererId: 'builtin:sprite2d', ...resolved(whale) }],
      onEvent: (type, event) => {
        if (type === 'error' && 'message' in event) errors.push(event.message)
      },
    })

    await runtime.selectModel(broken.id)

    expect(log).toContain('test:broken:dispose:true')
    expect(log).toContain('builtin:sprite2d:load:builtin:whale')
    expect(runtime.descriptor?.id).toBe('builtin:sprite2d')
    expect(errors).toEqual(['test:broken load failed'])
  })

  it('rejects when no target or fallback can be mounted', async () => {
    const registry = new PetRendererRegistry()
    const broken = model('model:missing-renderer', 'test:missing')
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: () => resolved(broken),
    })

    await expect(runtime.selectModel(broken.id)).rejects.toThrow('No renderer could load model')
    expect(runtime.descriptor).toBeUndefined()
  })

  it('can recover with a later selection after a failed selection', async () => {
    const log: string[] = []
    const registry = new PetRendererRegistry()
    registry.register(mockProvider('builtin:sprite2d', log))
    const missing = model('model:missing', 'test:missing')
    const whale = model('builtin:whale', 'builtin:sprite2d')
    const models = new Map([
      [missing.id, resolved(missing)],
      [whale.id, resolved(whale)],
    ])
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: id => models.get(id),
    })

    await expect(runtime.selectModel(missing.id)).rejects.toThrow('No renderer could load model')
    await expect(runtime.selectModel(whale.id)).resolves.toBeUndefined()
    expect(runtime.descriptor?.id).toBe('builtin:sprite2d')
  })

  it('recreates once after context loss, then activates the explicit fallback', async () => {
    const log: string[] = []
    const emitters: PetRendererCreateContext['emit'][] = []
    const errors: string[] = []
    const registry = new PetRendererRegistry()
    registry.register(mockProvider('test:webgl', log, {
      onCreate: emit => { emitters.push(emit) },
    }))
    registry.register(mockProvider('builtin:sprite2d', log))
    const webgl = model('model:webgl', 'test:webgl')
    const whale = model('builtin:whale', 'builtin:sprite2d')
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: id => id === webgl.id ? resolved(webgl) : undefined,
      fallbackSelections: () => [{ rendererId: 'builtin:sprite2d', ...resolved(whale) }],
      onEvent: (type, event) => {
        if (type === 'error' && 'code' in event) errors.push(event.code)
      },
    })

    await runtime.selectModel(webgl.id)
    emitters[0]?.('contextLost', {})
    await vi.waitFor(() => expect(log.filter(entry => entry === 'test:webgl:create:false')).toHaveLength(2))
    expect(runtime.descriptor?.id).toBe('test:webgl')

    emitters[1]?.('contextLost', {})
    await vi.waitFor(() => expect(runtime.descriptor?.id).toBe('builtin:sprite2d'))
    expect(log).toContain('builtin:sprite2d:load:builtin:whale')
    expect(errors.filter(code => code === 'RENDERER_CONTEXT_LOST')).toHaveLength(2)
    await runtime.dispose()
  })

  it('disposes every superseded instance during 100 serialized model switches', async () => {
    const log: string[] = []
    const registry = new PetRendererRegistry()
    registry.register(mockProvider('builtin:sprite2d', log))
    const models = Array.from({ length: 100 }, (_, index) => model(`model:stress-${String(index)}`, 'builtin:sprite2d'))
    const catalog = new Map(models.map(candidate => [candidate.id, resolved(candidate)]))
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: id => catalog.get(id),
    })

    for (const candidate of models) await runtime.selectModel(candidate.id)
    expect(log.filter(entry => entry === 'builtin:sprite2d:create:false')).toHaveLength(100)
    expect(log.filter(entry => entry === 'builtin:sprite2d:dispose:true')).toHaveLength(99)
    await runtime.dispose()
    expect(log.filter(entry => entry === 'builtin:sprite2d:dispose:true')).toHaveLength(100)
  })
})
