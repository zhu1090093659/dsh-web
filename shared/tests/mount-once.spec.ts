/**
 * mountOnce tests: first mount runs, a second mount of the same package
 * name is a no-op, different packages mount independently, and disposing
 * the first mount (the disposer returned by its ctx.effect) unmarks so a
 * later mount runs again. The registry is process-global, so every test
 * disposes its own mounts.
 */
import { describe, expect, it, vi } from 'vitest'
import { mountOnce } from '../host/mount-once.ts'

/**
 * Minimal ctx surface mountOnce touches. Mirrors cordis semantics: effect
 * runs its callback immediately and treats the returned function as the
 * fiber disposer.
 */
function fakeCtx(): { effect: ReturnType<typeof vi.fn>; dispose: () => void } {
  let disposer: (() => void) | undefined
  const effect = vi.fn((fn: () => unknown) => {
    const returned = fn()
    if (typeof returned === 'function') disposer = returned as () => void
  })
  return { effect, dispose: () => disposer?.() }
}

describe('mountOnce', () => {
  it('runs the first mount and unmarks on fiber disposal', () => {
    const apply = vi.fn()
    const wrapped = mountOnce('@linxin666/dsh-pet', apply)
    const ctx = fakeCtx()
    wrapped(ctx, { enabled: true })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(ctx, { enabled: true })
    expect(ctx.effect).toHaveBeenCalledTimes(1)
    ctx.dispose()
    wrapped(fakeCtx())
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('skips a second mount of the same package name until disposed', () => {
    const apply = vi.fn()
    const wrapped = mountOnce('@linxin666/dsh-ssh', apply)
    const ctx = fakeCtx()
    wrapped(ctx)
    wrapped(fakeCtx())
    wrapped(fakeCtx())
    expect(apply).toHaveBeenCalledTimes(1)
    ctx.dispose()
    wrapped(fakeCtx())
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('lets different package names mount independently', () => {
    const applyA = vi.fn()
    const applyB = vi.fn()
    const ctxA = fakeCtx()
    const ctxB = fakeCtx()
    mountOnce('@linxin666/dsh-task-board', applyA)(ctxA)
    mountOnce('@linxin666/dsh-remote-web-ui', applyB)(ctxB)
    mountOnce('@linxin666/dsh-task-board', applyA)(fakeCtx())
    mountOnce('@linxin666/dsh-remote-web-ui', applyB)(fakeCtx())
    expect(applyA).toHaveBeenCalledTimes(1)
    expect(applyB).toHaveBeenCalledTimes(1)
    ctxA.dispose()
    ctxB.dispose()
  })
})
