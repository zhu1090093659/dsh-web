import { describe, expect, it } from 'vitest'
import { ruDictionaries } from '../src/client/ru/index.ts'

/** CJK + fullwidth punctuation range; ru values must never carry it. */
const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

describe('ru dictionaries internal consistency', () => {
  it('covers fifteen non-empty namespaces with string values', () => {
    const namespaces = Object.keys(ruDictionaries)
    expect(namespaces).toHaveLength(15)
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      const keys = Object.keys(dict)
      expect(keys.length, ns).toBeGreaterThan(0)
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `${ns}:${key}`).toBe('string')
        expect(value.trim().length, `${ns}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('never carries CJK or fullwidth punctuation inside a ru value', () => {
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(CJK_RE.test(value), `${ns}:${key} -> ${value}`).toBe(false)
      }
    }
  })

  it('never carries emoji inside a ru value', () => {
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(/\p{Extended_Pictographic}/u.test(value), `${ns}:${key} -> ${value}`).toBe(false)
      }
    }
  })

  it('only carries well-formed {placeholder} references', () => {
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        // Reject empty "{}" and malformed braces; named placeholders stay.
        expect(/\{\s*\}/.test(value), `${ns}:${key} -> ${value}`).toBe(false)
        const open = (value.match(/\{/g) ?? []).length
        const close = (value.match(/\}/g) ?? []).length
        expect(open, `${ns}:${key} -> ${value}`).toBe(close)
      }
    }
  })
})
