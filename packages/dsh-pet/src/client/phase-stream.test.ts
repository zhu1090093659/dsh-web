// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createPhaseStream } from './phase-stream.ts'
import { RendererRegistry } from './renderers/registry.ts'
import { PET_RENDERER_API_VERSION, type PetRenderer, type PetRendererContext } from '../contracts/renderer.ts'
import type { ActivityPhase } from '../state.ts'

describe('createPhaseStream', () => {
  it('dispatches on change only and supports unsubscribe', () => {
    const stream = createPhaseStream()
    const seen: ActivityPhase[] = []
    const off = stream.subscribe(phase => seen.push(phase))
    stream.push('idle')       // unchanged: no dispatch
    stream.push('thinking')
    stream.push('thinking')   // unchanged: no dispatch
    stream.push('done')
    expect(seen).toEqual(['thinking', 'done'])
    expect(stream.get()).toBe('done')
    off()
    stream.push('idle')
    expect(seen).toHaveLength(2) // no dispatch after unsubscribe
  })
})

function fakeContext(): PetRendererContext & { cleanups: Array<() => void> } {
  const cleanups: Array<() => void> = []
  return {
    petId: 'test',
    assetBase: '/pet/test',
    container: document.createElement('div'),
    phase: { get: () => 'idle', subscribe: () => () => {} },
    interact: () => {},
    onCleanup: fn => cleanups.push(fn),
    cleanups,
  }
}

describe('RendererRegistry', () => {
  it('mounts a registered renderer with its validated config', () => {
    const registry = new RendererRegistry()
    const calls: unknown[] = []
    const renderer: PetRenderer<{ tag: string }> = {
      id: 'sprite2d',
      apiVersion: PET_RENDERER_API_VERSION,
      validateConfig: config => ({ tag: String((config as { tag: string }).tag) }),
      mount: (ctx, config) => {
        calls.push(config.tag)
        return { dispose: () => calls.push('disposed') }
      },
    }
    registry.register(renderer)
    expect(registry.kinds()).toEqual(['sprite2d'])
    const handle = registry.mount('sprite2d', fakeContext(), { tag: 'hello' })
    expect(calls).toEqual(['hello'])
    handle.dispose()
    expect(calls).toEqual(['hello', 'disposed'])
  })

  it('renders a diagnostic card for an unknown renderer instead of blanking', () => {
    const registry = new RendererRegistry()
    const ctx = fakeContext()
    const handle = registry.mount('live2d', ctx, {})
    const note = ctx.container.querySelector('[data-dsh-pet-renderer-fallback]')
    expect(note?.textContent).toContain('live2d')
    expect(note?.textContent).toContain('supported')
    handle.dispose()
    handle.dispose() // idempotent
    expect(ctx.container.querySelector('[data-dsh-pet-renderer-fallback]')).toBeNull()
  })
})

describe('contract constants', () => {
  it('locks the renderer apiVersion', () => {
    expect(PET_RENDERER_API_VERSION).toBe('x-org.linxin666.pet-center/v1alpha1')
  })
})
