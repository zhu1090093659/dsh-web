import { describe, expect, it, vi } from 'vitest'
import { apply, RU_LANGUAGE } from '../src/client/index.ts'
import { ruDictionaries } from '../src/client/ru/index.ts'

/** Minimal client-context mock: effect runs its factory immediately and forwards the returned disposer. */
function makeCtx(addLanguage: () => () => void = () => () => {}) {
  const disposers: Array<() => void> = []
  const ctx = {
    effect: (factory: () => () => void) => {
      const dispose = factory()
      return () => dispose()
    },
    locale: {
      addLanguage: vi.fn(addLanguage),
      register: vi.fn((_ns: string, _locale: string, _dict: Record<string, string>) => () => {}),
    },
  } as unknown as Parameters<typeof apply>[0]
  return { ctx, addLanguage: ctx.locale.addLanguage as ReturnType<typeof vi.fn>, register: ctx.locale.register as ReturnType<typeof vi.fn> }
}

describe('dsh-i18n client apply', () => {
  it('declares the ru language with the Cyrillic label and the en fallback', () => {
    const { ctx, addLanguage } = makeCtx()
    apply(ctx)
    expect(addLanguage).toHaveBeenCalledTimes(1)
    expect(addLanguage).toHaveBeenCalledWith(RU_LANGUAGE)
    expect(RU_LANGUAGE).toEqual({ id: 'ru', label: 'Русский', fallback: 'en' })
  })

  it('registers one ru dictionary per covered namespace', () => {
    const { ctx, register } = makeCtx()
    apply(ctx)
    expect(register).toHaveBeenCalledTimes(Object.keys(ruDictionaries).length)
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      expect(register).toHaveBeenCalledWith(ns, 'ru', dict)
    }
  })

  it('tears down every registration through the combined disposer', () => {
    const seen: string[] = []
    const addLanguage = vi.fn(() => () => seen.push('language'))
    const register = vi.fn((_ns: string) => () => seen.push('dict'))
    let teardown: (() => void) | undefined
    const ctx = {
      effect: (factory: () => () => void) => {
        teardown = factory()
        return teardown
      },
      locale: { addLanguage, register },
    } as unknown as Parameters<typeof apply>[0]
    apply(ctx)
    teardown?.()
    expect(seen[0]).toBe('language')
    expect(seen).toHaveLength(1 + Object.keys(ruDictionaries).length)
  })

  it('still registers dictionaries when addLanguage throws (id occupied)', () => {
    const { ctx, register } = makeCtx(() => { throw new Error('id occupied') })
    apply(ctx)
    expect(register).toHaveBeenCalledTimes(Object.keys(ruDictionaries).length)
  })

  it('skips only the throwing namespace when register throws (duplicate owner)', () => {
    const { ctx, register } = makeCtx()
    register.mockImplementation((ns: string) => {
      if (ns === 'task-board') throw new Error('duplicate (ns, locale)')
      return () => {}
    })
    apply(ctx)
    expect(register).toHaveBeenCalledTimes(Object.keys(ruDictionaries).length)
  })

  it('covers every audited namespace exactly once', () => {
    const namespaces = Object.keys(ruDictionaries)
    expect(new Set(namespaces).size).toBe(namespaces.length)
    expect(namespaces).toContain('task-board')
    expect(namespaces).toContain('dsh-perf')
    expect(namespaces).toContain('settings.pluginManager')
    expect(namespaces).toContain('web-ui-plugins')
  })
})
