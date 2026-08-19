import { describe, expect, it } from 'vitest'
import type { PluginControlItem } from '../src/core/protocol.ts'
import { classifyChange, diffControls } from '../src/core/conflict.ts'

const control = (id: string, state: PluginControlItem['state']): PluginControlItem => ({
  id, name: id, repository: `https://example.com/${id}`, state,
})

describe('diffControls', () => {
  it('reports a changed state, skips unchanged and added/removed ids', () => {
    const before = [control('web-ui', 'enabled'), control('genui', 'enabled'), control('gone', 'disabled')]
    const after = [control('web-ui', 'disabled'), control('genui', 'enabled'), control('fresh', 'enabled')]
    const changes = diffControls(before, after)
    expect(changes).toEqual([{ id: 'web-ui', name: 'web-ui', from: 'enabled', to: 'disabled' }])
  })

  it('reports multiple independent changes in id order', () => {
    const before = [control('a', 'enabled'), control('b', 'enabled'), control('c', 'disabled')]
    const after = [control('a', 'enabled'), control('b', 'disabled'), control('c', 'enabled')]
    const changes = diffControls(before, after)
    expect(changes.map(c => c.id)).toEqual(['b', 'c'])
  })

  it('returns no changes when the before snapshot is empty (degraded preflight)', () => {
    const after = [control('web-ui', 'disabled')]
    expect(diffControls([], after)).toEqual([])
  })

  it('returns no changes when the after snapshot is empty', () => {
    const before = [control('web-ui', 'enabled')]
    expect(diffControls(before, [])).toEqual([])
  })
})

describe('classifyChange', () => {
  it('classifies into disabled as the rule action', () => {
    expect(classifyChange({ id: 'a', name: 'a', from: 'enabled', to: 'disabled' })).toBe('rule-disabled')
    expect(classifyChange({ id: 'a', name: 'a', from: 'mixed', to: 'disabled' })).toBe('rule-disabled')
  })

  it('classifies out of disabled as the manual undo', () => {
    expect(classifyChange({ id: 'a', name: 'a', from: 'disabled', to: 'enabled' })).toBe('rule-enabled')
  })

  it('classifies everything else neutrally', () => {
    expect(classifyChange({ id: 'a', name: 'a', from: 'uninstalled', to: 'enabled' })).toBe('state-change')
  })
})
