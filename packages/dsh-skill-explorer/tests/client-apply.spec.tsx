/**
 * Browser-half apply smoke: registers the locale dictionary and mounts the
 * sidebar entry without throwing (jsdom). The panel itself mounts lazily on
 * entry toggle; the entry row waits for the real sidebar root, so in jsdom
 * (no sidebar) apply must still complete cleanly and dispose without residue.
 */
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

describe('skill-explorer client apply', () => {
  it('operator: declares the layout service in inject for panel navigation', () => {
    // Given the skill-explorer client entry
    // When inspecting the required services
    // Then layout is declared alongside slots and locale
    expect(inject).toEqual(['slots', 'locale', 'layout'])
  })

  it('operator: registers the locale namespace and disposes cleanly', () => {
    // Given an application context with a locale service
    // When applying the client plugin
    // Then the skill-explorer namespace is registered
    const registered: string[] = []
    const disposers: Array<() => void> = []
    const ctx = {
      effect: (fn: () => unknown) => {
        const disposer = fn()
        disposers.push(() => {
          if (typeof disposer === 'function') (disposer as () => void)()
        })
      },
      locale: {
        register: (ns: string) => { registered.push(ns); return () => {} },
      },
    }
    // Must not throw even though jsdom has no sidebar root and no locale
    // service beyond the stub above.
    expect(() => apply(ctx as never)).not.toThrow()
    expect(registered).toEqual(['dsh-skill-explorer'])
    for (const dispose of disposers) dispose()
  })
})
