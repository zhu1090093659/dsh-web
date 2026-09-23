/**
 * Core capability-declaration logic: view reads, drafts, validation, and the
 * save op. These mirror the pi-ai adapter's own acceptance rules (an invalid
 * write is refused host-side; the editor refuses it first).
 */

import { describe, expect, it } from 'vitest'
import {
  buildModelsOp,
  declaredLevelsOf,
  effortsModeOf,
  effortsSummaryOf,
  modelsArrayOf,
  readAt,
  sanitizeEntry,
  THINKING_LEVELS,
  validateEntry,
  withEffortsMode,
  levelsMapOf,
  COMMON_EFFORTS_PRESET,
  type ModelEntryDraft,
} from '../src/core/capabilities.ts'

describe('readAt', () => {
  const section = { providers: { acme: { models: [{ id: 'gpt-x' }] } } }

  it('walks plain objects', () => {
    expect(readAt(section, ['providers', 'acme'])).toEqual({ models: [{ id: 'gpt-x' }] })
    expect(readAt(section, ['providers', 'acme', 'models'])).toEqual([{ id: 'gpt-x' }])
  })

  it('returns undefined past a missing or non-object link', () => {
    expect(readAt(section, ['providers', 'nope'])).toBeUndefined()
    expect(readAt(section, ['providers', 'acme', 'models', 'id'])).toBeUndefined()
    expect(readAt(undefined, ['providers'])).toBeUndefined()
  })
})

describe('modelsArrayOf', () => {
  it('rejects non-arrays', () => {
    expect(modelsArrayOf(undefined)).toBeUndefined()
    expect(modelsArrayOf({ id: 'x' })).toBeUndefined()
  })

  it('keeps entries with a non-empty string id and preserves unknown fields', () => {
    const compat = { supportsReasoningEffort: true }
    const value = [
      { id: 'gpt-x', name: 'GPT X', compat },
      { name: 'no id' },
      'junk',
    ]
    const entries = modelsArrayOf(value)
    expect(entries).toHaveLength(1)
    expect(entries?.[0]?.name).toBe('GPT X')
    expect(entries?.[0]?.compat).toBe(compat)
  })
})

describe('effortsModeOf', () => {
  it('classifies inherit, none, and levels', () => {
    expect(effortsModeOf({ id: 'm' })).toBe('inherit')
    expect(effortsModeOf({ id: 'm', reasoningEfforts: false })).toBe('none')
    expect(effortsModeOf({ id: 'm', reasoningEfforts: { low: 'low' } })).toBe('levels')
  })

  it('reads malformed stored values as inherit', () => {
    expect(effortsModeOf({ id: 'm', reasoningEfforts: 3 } as unknown as ModelEntryDraft)).toBe('inherit')
    expect(effortsModeOf({ id: 'm', reasoningEfforts: ['low'] } as unknown as ModelEntryDraft)).toBe('inherit')
  })
})

describe('declaredLevelsOf', () => {
  it('normalizes to escalation order with empty wire for off', () => {
    const entry = { id: 'm', reasoningEfforts: { high: 'ultra', off: null, low: 'low' } }
    expect(declaredLevelsOf(entry)).toEqual([
      { level: 'off', wire: '' },
      { level: 'low', wire: 'low' },
      { level: 'high', wire: 'ultra' },
    ])
  })

  it('normalizes null wire on a non-off level to empty (validation reports it)', () => {
    const entry = { id: 'm', reasoningEfforts: { high: null } }
    expect(declaredLevelsOf(entry)).toEqual([{ level: 'high', wire: '' }])
  })

  it('is empty outside levels mode', () => {
    expect(declaredLevelsOf({ id: 'm' })).toEqual([])
    expect(declaredLevelsOf({ id: 'm', reasoningEfforts: false })).toEqual([])
  })
})

describe('validateEntry', () => {
  it('accepts inherit and none modes', () => {
    expect(validateEntry({ id: 'm' })).toBeUndefined()
    expect(validateEntry({ id: 'm', reasoningEfforts: false })).toBeUndefined()
  })

  it('accepts a dict with a non-off level and wire spellings', () => {
    expect(validateEntry({ id: 'm', reasoningEfforts: { off: null, low: 'low' } })).toBeUndefined()
  })

  it('refuses a dict without any level beyond off', () => {
    expect(validateEntry({ id: 'm', reasoningEfforts: { off: null } })).toEqual({ kind: 'effortsOffOnly' })
    expect(validateEntry({ id: 'm', reasoningEfforts: {} })).toEqual({ kind: 'effortsOffOnly' })
  })

  it('refuses an empty wire on a non-off level', () => {
    expect(validateEntry({ id: 'm', reasoningEfforts: { low: 'low', high: '' } })).toEqual({ kind: 'effortsWireMissing', level: 'high' })
    expect(validateEntry({ id: 'm', reasoningEfforts: { high: null } })).toEqual({ kind: 'effortsWireMissing', level: 'high' })
  })
})

describe('draft updates', () => {
  it('withEffortsMode inherit drops the field', () => {
    expect(withEffortsMode({ id: 'm', reasoningEfforts: false }, 'inherit')).toEqual({ id: 'm' })
  })

  it('withEffortsMode none writes false', () => {
    expect(withEffortsMode({ id: 'm' }, 'none')).toEqual({ id: 'm', reasoningEfforts: false })
  })

  it('withEffortsMode levels writes the given map', () => {
    const levels = levelsMapOf({ id: 'm', reasoningEfforts: { off: null, high: 'ultra' } })
    expect(levels.get('off')).toBe('')
    expect(levels.get('high')).toBe('ultra')
    const next = withEffortsMode({ id: 'm' }, 'levels', levels)
    expect(next.reasoningEfforts).toEqual({ off: '', high: 'ultra' })
  })

  it('the common preset identities every level', () => {
    for (const [level, wire] of COMMON_EFFORTS_PRESET) expect(wire).toBe(level)
    expect(COMMON_EFFORTS_PRESET.map(([level]) => level)).toEqual(['low', 'medium', 'high'])
  })
})

describe('sanitizeEntry', () => {
  it('drops undefined values and preserves unknown fields', () => {
    const entry = { id: 'm', name: undefined, reasoningEfforts: false, extra: { a: 1 } } as unknown as ModelEntryDraft
    const clean = sanitizeEntry(entry)
    expect(clean).toEqual({ id: 'm', reasoningEfforts: false, extra: { a: 1 } })
    expect('name' in clean).toBe(false)
  })

  it('clones nested values so later edits never alias stored state', () => {
    const extra = { a: 1 }
    const clean = sanitizeEntry({ id: 'm', extra })
    expect(clean['extra']).not.toBe(extra)
  })
})

describe('buildModelsOp', () => {
  it('replaces the whole models array below the provider path', () => {
    const op = buildModelsOp(['providers', 'acme'], [
      { id: 'gpt-x', input: ['text', 'image'], reasoningEfforts: { low: 'low' } },
    ])
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'acme', 'models'])
    expect(op.value).toEqual([
      { id: 'gpt-x', input: ['text', 'image'], reasoningEfforts: { low: 'low' } },
    ])
  })
})

describe('effortsSummaryOf', () => {
  it('summarizes mode and declared levels in escalation order', () => {
    expect(effortsSummaryOf({ id: 'm' })).toEqual({ mode: 'inherit', levels: [] })
    expect(effortsSummaryOf({ id: 'm', reasoningEfforts: false })).toEqual({ mode: 'none', levels: [] })
    const summary = effortsSummaryOf({ id: 'm', reasoningEfforts: { high: 'high', off: null } })
    expect(summary.mode).toBe('levels')
    expect(summary.levels).toEqual(['off', 'high'])
  })

  it('keeps THINKING_LEVELS in escalation order', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})
