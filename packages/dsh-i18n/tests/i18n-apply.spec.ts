import { describe, expect, it, vi } from 'vitest'
import { apply, RU_LOCALE } from '../src/client/index.ts'
import { ruDictionaries } from '../src/client/ru/index.ts'

function makeCtx() {
  const ctx = {
    effect: (factory: () => () => void) => factory(),
    locale: {
      addLanguage: vi.fn(),
      register: vi.fn((_ns: string, _locale: string, _dict: Record<string, string>) => () => {}),
    },
  } as unknown as Parameters<typeof apply>[0]
  return { ctx, addLanguage: ctx.locale.addLanguage as ReturnType<typeof vi.fn>, register: ctx.locale.register as ReturnType<typeof vi.fn> }
}

describe('dsh-i18n client apply', () => {
  it('leaves the language definition to DSH and registers one ru dictionary per family namespace', () => {
    const { ctx, addLanguage, register } = makeCtx()
    apply(ctx)
    expect(RU_LOCALE).toBe('ru')
    expect(addLanguage).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledTimes(Object.keys(ruDictionaries).length)
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      expect(register).toHaveBeenCalledWith(ns, 'ru', dict)
    }
  })

  it('tears down every dictionary registration through the combined disposer', () => {
    const seen: string[] = []
    let teardown: (() => void) | undefined
    const ctx = {
      effect: (factory: () => () => void) => {
        teardown = factory()
        return teardown
      },
      locale: {
        register: vi.fn((_ns: string) => () => seen.push('dict')),
      },
    } as unknown as Parameters<typeof apply>[0]
    apply(ctx)
    teardown?.()
    expect(seen).toHaveLength(Object.keys(ruDictionaries).length)
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
    expect(namespaces).toContain('settings.pluginManager')
    expect(namespaces).toContain('web-ui-plugins')
  })
})
