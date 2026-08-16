// @vitest-environment jsdom
/**
 * Settings-card protocol guard: every apiStyle the card offers (API_STYLE_CHOICES,
 * the single source for the rendered dropdown and the form's choiceField spec)
 * must be accepted by the form, otherwise selecting it in the UI leaves the
 * draft invalid and blocks the Save button (regression: the anthropic-messages
 * option was rendered but missing from the controller's choiceField list).
 *
 * The card component itself is excluded from the vitest program by design
 * ("tests never import them"), so the form is driven directly with the same
 * choiceField construction the controller uses; the client-runtime is mocked
 * (a ModuleLoader closure Vite cannot introspect) with the primitive
 * settings-form imports.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const fn of listeners) fn() },
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
  },
}))

import { API_STYLE_CHOICES } from '../src/client/api-styles.ts'
import { CardForm, choiceField, secretField, textField } from '../src/client/settings-form.ts'

/** A SettingsScope stub: ready, writable, empty section — the default state after a reset. */
function emptyScope() {
  return {
    getSnapshot: () => ({ status: 'ready' as const, writable: true, value: {}, base: {}, user: {} }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
}

/** The apiStyle choiceField exactly as DescribeImageSettingsCardController builds it. */
function apiStyleField() {
  return choiceField('apiStyle', [...API_STYLE_CHOICES])
}

describe('describe-image settings card apiStyle choices', () => {
  it('accepts every offered protocol, so Save is never blocked by the apiStyle field', () => {
    const form = new CardForm(emptyScope() as never, [
      textField('baseURL'),
      textField('model'),
      apiStyleField(),
      secretField('apiKey'),
    ])
    for (const style of API_STYLE_CHOICES) {
      form.actions().edit('apiStyle', style)
      const shell = form.shell()
      expect(shell.invalid, `form must not be invalid for ${style}`).toBe(false)
      expect(shell.dirty, `draft for ${style} must be a planned write`).toBe(true)
      expect(form.field('apiStyle')).toMatchObject({ text: style, overridden: true, invalid: false })
    }
  })

  it('rejects a protocol the card never offers, keeping Save blocked', () => {
    const form = new CardForm(emptyScope() as never, [
      textField('baseURL'),
      textField('model'),
      apiStyleField(),
      secretField('apiKey'),
    ])
    form.actions().edit('apiStyle', 'legacy')
    expect(form.shell().invalid).toBe(true)
    expect(form.field('apiStyle').invalid).toBe(true)
  })
})
