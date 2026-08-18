import { describe, expect, it } from 'vitest'

import {
  PET_MODEL_SCHEMA_VERSION,
  PET_RENDERER_API_VERSION,
  type PetModelDescriptor,
  type PetRendererProvider,
} from '../contracts/renderer.ts'
import { PetRendererRegistry } from './registry.ts'

const model: PetModelDescriptor = {
  schemaVersion: PET_MODEL_SCHEMA_VERSION,
  id: 'builtin:whale',
  displayName: 'Whale',
  rendererId: 'builtin:sprite2d',
  format: 'petdex-v1',
  entry: 'spritesheet.webp',
  source: { kind: 'builtin' },
  capabilities: { motions: ['idle'], expressions: [], lookAt: false, lipSync: false, hitAreas: ['body'] },
  bindings: { motions: { idle: 'idle' }, expressions: {} },
  fallback: { motion: 'idle', expression: 'neutral' },
}

function provider(id = 'builtin:sprite2d'): PetRendererProvider {
  const descriptor = {
    apiVersion: PET_RENDERER_API_VERSION,
    id,
    displayName: 'Sprite 2D',
    kind: 'sprite2d' as const,
    version: '1.0.0',
    capabilities: {
      expressions: false,
      motions: true,
      lookAt: false,
      lipSync: false,
      hitAreas: true,
      transparentBackground: true,
    },
    supportedModelFormats: ['petdex-v1'],
  }
  return {
    descriptor,
    create: async () => { throw new Error('not used') },
  }
}

describe('PetRendererRegistry', () => {
  it('registers only explicit providers and removes them through the registration', () => {
    const registry = new PetRendererRegistry()
    const registration = registry.register(provider())

    expect(registry.get('builtin:sprite2d')?.descriptor.displayName).toBe('Sprite 2D')
    expect(registry.list().map(descriptor => descriptor.id)).toEqual(['builtin:sprite2d'])
    expect(registry.supports('builtin:sprite2d', model)).toBe(true)

    registration.dispose()
    registration.dispose()
    expect(registry.list()).toEqual([])
  })

  it('rejects duplicate, malformed, and incompatible registrations', () => {
    const registry = new PetRendererRegistry()
    registry.register(provider())

    expect(() => registry.register(provider())).toThrow('already registered')
    expect(() => registry.register(provider('sprite2d'))).toThrow('Invalid renderer id')
    expect(registry.supports('builtin:sprite2d', { ...model, format: 'live2d-v3' })).toBe(false)
    expect(registry.supports('builtin:sprite2d', { ...model, rendererId: 'extension:other' })).toBe(false)
  })
})
