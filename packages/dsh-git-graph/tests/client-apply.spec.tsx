// @vitest-environment jsdom
/**
 * Client apply() registration tests: the browser half registers the branch
 * chip with declaration awareness — on the input selector row's context hole
 * (`conversation.input.selector.context`, session-maybe) when the shell
 * declares it (shells after rc.6, beside the official workspace selector),
 * and on the composer dock band (`conversation.input.dock`) when the shell
 * never declares the preferred hole (the shipped rc.6 shell — the 0be6546
 * regression this guards). The inject wait is the registration-safe signal
 * for the preferred seat: a late declaration migrates the chip onto it.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { BranchChip } from '../src/client/chips/BranchChip.tsx'

/** Scripted slots face: inject runs or parks the wait, spec answers declaration state. */
function bench(preferredSpec: unknown, parkInject: boolean) {
  const register = vi.fn(() => () => undefined)
  const slotInject = vi.fn((_name: string, callback: () => () => void) => {
    if (!parkInject) callback()
    return () => undefined
  })
  // The fallback seat is always declared; only the preferred hole varies.
  const spec = vi.fn((key: string) =>
    key === 'conversation.input.selector.context' ? preferredSpec : { kind: 'list', scope: 'session' })

  const scope = {
    slots: { inject: slotInject, register, spec },
    conversation: {},
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
  }
  const ctx = {
    effect: vi.fn((fn: () => void) => { fn(); return () => {} }),
    locale: { register: vi.fn() },
    inject: vi.fn((_services: unknown, callback: (s: typeof scope) => void) => { callback(scope) }),
  }

  apply(ctx as never)
  return { register, slotInject, spec }
}

describe('client apply()', () => {
  it('registers the branch chip on the selector-context hole when declared', () => {
    const { register, slotInject } = bench(
      { kind: 'list', scope: 'session-maybe' },
      /* parkInject */ false,
    )

    // The registration waits on the conversation/sessions seam, then on the
    // selector-context declaration before registering the chip component.
    expect(slotInject).toHaveBeenCalledWith('conversation.input.selector.context', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation.input.selector.context',
        id: 'git-graph',
        order: 100,
      }),
      BranchChip,
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.dock' }),
      expect.anything(),
    )
  })

  it('falls back to the composer dock band when the selector-context hole is undeclared (rc.6)', () => {
    const { register, slotInject, spec } = bench(undefined, /* parkInject */ true)

    // rc.6 never declares the preferred hole: the inject wait parks, the
    // spec probe reports absent, and the chip registers on the dock band
    // (the 0.1.9 seat) instead of vanishing.
    expect(slotInject).toHaveBeenCalledWith('conversation.input.selector.context', expect.any(Function))
    expect(spec).toHaveBeenCalledWith('conversation.input.selector.context')
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation.input.dock',
        id: 'git-graph',
        order: 100,
      }),
      BranchChip,
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.selector.context' }),
      expect.anything(),
    )
  })
})
