// @vitest-environment jsdom
/**
 * Client apply() registration tests: the browser half registers the branch
 * chip on the input selector row's context hole
 * (`conversation.input.selector.context`, session-maybe), NOT the composer
 * dock band — the hole the shipped ui-conversation shell renders right beside
 * the official workspace selector. This guards the acbcf80 regression where
 * the chip was moved to `conversation.input.dock` on the wrong premise that
 * the selector-context hole was undeclared.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { BranchChip } from '../src/client/chips/BranchChip.tsx'

describe('client apply()', () => {
  it('registers the branch chip on the selector-context hole (session-maybe)', () => {
    const register = vi.fn(() => () => undefined)
    const slotInject = vi.fn((_name: string, callback: () => () => void) => callback())

    const scope = {
      slots: { inject: slotInject, register },
      conversation: {},
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    }
    const ctx = {
      effect: vi.fn((fn: () => void) => { fn(); return () => {} }),
      locale: { register: vi.fn() },
      inject: vi.fn((_services: unknown, callback: (s: typeof scope) => void) => { callback(scope) }),
    }

    apply(ctx as never)

    // The registration waits on the conversation/sessions seam, then on the
    // selector-context declaration before registering the chip component.
    expect(ctx.inject).toHaveBeenCalledWith(['slots', 'conversation', 'sessions'], expect.any(Function))
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
})

