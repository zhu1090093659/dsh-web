// @vitest-environment jsdom
/**
 * Client apply() registration tests: the browser half registers the branch
 * chip on the composer's floating overlay anchor
 * (`conversation.input.overlay`, session-scoped), NOT the composer dock band
 * above the card nor the tool row. This guards the regressions where the chip
 * was moved to `conversation.input.dock` (a line of its own in the flow above
 * the card), to `conversation.input.selector.context` (a hole no published
 * shell declares, so the chip never mounted) and to `conversation.input.left`
 * (the tool row beside access mode / model).
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { BranchChip } from '../src/client/chips/BranchChip.tsx'

describe('client apply()', () => {
  it('registers the branch chip on the floating overlay anchor (session-scoped)', () => {
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
    // overlay declaration before registering the chip component.
    expect(ctx.inject).toHaveBeenCalledWith(['slots', 'conversation', 'sessions'], expect.any(Function))
    expect(slotInject).toHaveBeenCalledWith('conversation.input.overlay', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation.input.overlay',
        id: 'git-graph',
        order: 100,
      }),
      BranchChip,
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.dock' }),
      expect.anything(),
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.left' }),
      expect.anything(),
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.selector.context' }),
      expect.anything(),
    )
  })
})
