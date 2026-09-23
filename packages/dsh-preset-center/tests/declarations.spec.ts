/**
 * Preset declaration contract: the disposer bookkeeping that turns a registry
 * registration into the plugin's own "enabled" state, and its refusals.
 */

import { describe, expect, it } from 'vitest'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { DeclarationError, PresetDeclarations, type PresetRegistry } from '../src/host/declarations.ts'

interface FakePreset {
  id: string
  name?: string
  broken?: string
}

/** A map-backed registry stand-in that reports activation failures like the real one. */
function fakeRegistry(): PresetRegistry & { presets: Map<string, FakePreset>; brokenIds: Set<string>; unregisters: number } {
  const presets = new Map<string, FakePreset>()
  const brokenIds = new Set<string>()
  const state = {
    presets,
    brokenIds,
    unregisters: 0,
    defaultId: 'standard',
    async register(definition: PresetDefinition): Promise<() => Promise<void>> {
      if (presets.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
      presets.set(definition.id, {
        id: definition.id,
        ...(definition.name === undefined ? {} : { name: definition.name }),
        ...(brokenIds.has(definition.id) ? { broken: 'row names a missing module' } : {}),
      })
      return async () => {
        state.unregisters += 1
        presets.delete(definition.id)
      }
    },
    async list(): Promise<FakePreset[]> {
      return [...presets.values()]
    },
  }
  return state
}

const definition = (id: string, name?: string): PresetDefinition => ({
  id,
  ...(name === undefined ? {} : { name }),
  plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona' }],
})

describe('preset declarations', () => {
  it('operator declares a preset and the registry reports it live', async () => {
    // Given an empty registry, When the operator declares a preset, Then the
    // declarations hold the id and the registry lists the definition.
    const registry = fakeRegistry()
    const declarations = new PresetDeclarations(() => registry)

    await declarations.declare(definition('demo', 'Demo'))

    expect(declarations.has('demo')).toBe(true)
    expect([...declarations.declared()]).toEqual(['demo'])
    expect(await registry.list()).toEqual([{ id: 'demo', name: 'Demo' }])
  })

  it('operator declaring the same preset twice keeps one registration', async () => {
    // Given a declared preset, When the operator declares it again, Then no
    // second registration happens and undeclaring releases exactly once.
    const registry = fakeRegistry()
    const declarations = new PresetDeclarations(() => registry)
    await declarations.declare(definition('demo'))

    await declarations.declare(definition('demo'))
    expect(registry.presets.size).toBe(1)

    await declarations.undeclare('demo')
    expect(registry.unregisters).toBe(1)
    expect(declarations.has('demo')).toBe(false)
    expect(registry.presets.size).toBe(0)
  })

  it('operator un-declaring a preset that was never declared changes nothing', async () => {
    // Given a registry with no live declaration, When the operator undeclares
    // an id, Then nothing is released and the answer reports no work.
    const registry = fakeRegistry()
    const declarations = new PresetDeclarations(() => registry)
    expect(await declarations.undeclare('ghost')).toBe(false)
    expect(registry.unregisters).toBe(0)
  })

  it('operator releasing the plugin drops every declaration', async () => {
    // Given two declared presets, When the plugin unloads, Then both are
    // unregistered and the registry is empty.
    const registry = fakeRegistry()
    const declarations = new PresetDeclarations(() => registry)
    await declarations.declare(definition('alpha'))
    await declarations.declare(definition('beta'))

    await declarations.release()

    expect(registry.presets.size).toBe(0)
    expect(declarations.declared().size).toBe(0)
    expect(registry.unregisters).toBe(2)
  })

  it('operator is refused when the deployment supplies no registry', async () => {
    // Given a deployment that exposes no preset registry, When the operator
    // declares a preset, Then the refusal is reported as unavailable.
    const declarations = new PresetDeclarations(() => undefined)
    try {
      await declarations.declare(definition('demo'))
      throw new Error('expected a refusal')
    } catch (err) {
      expect(err).toBeInstanceOf(DeclarationError)
      expect((err as DeclarationError).code).toBe('unavailable')
    }
  })

  it('operator is refused an id another declaration already owns', async () => {
    // Given a registry that already holds the id, When the operator declares
    // it, Then the refusal is reported as a shadowed id, not a write failure.
    const registry = fakeRegistry()
    registry.presets.set('demo', { id: 'demo' })
    const declarations = new PresetDeclarations(() => registry)

    try {
      await declarations.declare(definition('demo'))
      throw new Error('expected a refusal')
    } catch (err) {
      expect((err as DeclarationError).code).toBe('shadowed')
    }
    expect(declarations.has('demo')).toBe(false)
  })

  it('operator is refused a definition the registry cannot install', async () => {
    // Given a registry that rejects the definition outright, When the operator
    // declares it, Then the refusal is reported as an invalid definition and
    // nothing stays declared.
    const registry = fakeRegistry()
    registry.register = async () => { throw new Error('row 1 names no plugin') }
    const declarations = new PresetDeclarations(() => registry)

    try {
      await declarations.declare(definition('demo'))
      throw new Error('expected a refusal')
    } catch (err) {
      expect((err as DeclarationError).code).toBe('invalid')
    }
    expect(declarations.has('demo')).toBe(false)
  })
})
