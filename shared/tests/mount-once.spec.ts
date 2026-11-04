/**
 * mountOnce tests: the first mount runs, a mount refused while that name is
 * held waits for the holder to release and is then replayed, a waiter whose
 * own fiber dies first is never replayed, several waiters still leave exactly
 * one live mount, different packages mount independently, and disposing the
 * holder (the disposer returned by its ctx.effect) frees the name again. The
 * registry is process-global and shared with independently built copies (the
 * satellite repositories), so the shared value keeps its published Set shape
 * and a foreign value there is repaired instead of breaking every mount. Every
 * test disposes its own mounts.
 */
import { describe, expect, it, vi } from 'vitest'
import { mountOnce } from '../host/mount-once.ts'

/** The cross-repository registry key this guard shares with sibling builds. */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

/** Flush the microtasks the release handover defers its replays to. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * Minimal ctx surface mountOnce touches. Mirrors cordis semantics: effect
 * runs its callback immediately and treats the returned function as the
 * fiber disposer, and a fiber disposal runs every collected disposer.
 */
function fakeCtx(): { effect: ReturnType<typeof vi.fn>; dispose: () => void } {
  const disposers: Array<() => void> = []
  const effect = vi.fn((fn: () => unknown) => {
    const returned = fn()
    if (typeof returned === 'function') disposers.push(returned as () => void)
  })
  return {
    effect,
    dispose: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
}

describe('mountOnce', () => {
  it('runs the first mount and releases the name on fiber disposal', () => {
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

  it('replays a mount refused while another fiber held the name', async () => {
    // Given a live mount of a package row
    const apply = vi.fn()
    const wrapped = mountOnce('@linxin666/dsh-task-board', apply)
    const holder = fakeCtx()
    const reloaded = fakeCtx()
    wrapped(holder, { plugin: 'previous-entry' })

    // When a reloaded entry requests the same package while the holder lives
    wrapped(reloaded, { plugin: 'reloaded-entry' })

    // Then it does not mount a second instance...
    expect(apply).toHaveBeenCalledTimes(1)

    // ...and it is replayed, with its own context and config, once the holder
    // releases the name - rather than being dropped for the rest of the process
    holder.dispose()
    await settle()
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith(reloaded, { plugin: 'reloaded-entry' })
    reloaded.dispose()
  })

  it('never replays a refused mount whose own fiber was disposed first', async () => {
    // Given a refused mount that is abandoned before the holder releases
    const apply = vi.fn()
    const wrapped = mountOnce('@linxin666/dsh-market', apply)
    const holder = fakeCtx()
    const abandoned = fakeCtx()
    wrapped(holder)
    wrapped(abandoned)
    abandoned.dispose()

    // When the holder releases
    holder.dispose()
    await settle()

    // Then no dead fiber is mounted into
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('keeps exactly one live mount when several waiters race the release', async () => {
    // Given two entries waiting on one holder
    const apply = vi.fn()
    const wrapped = mountOnce('@linxin666/dsh-usage', apply)
    const holder = fakeCtx()
    const first = fakeCtx()
    const second = fakeCtx()
    wrapped(holder)
    wrapped(first)
    wrapped(second)
    expect(apply).toHaveBeenCalledTimes(1)

    // When the holder releases, only one of the waiters takes the name
    holder.dispose()
    await settle()
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith(first)
    expect(apply).not.toHaveBeenCalledWith(second)

    // And the loser is replayed when that new holder releases in turn
    first.dispose()
    await settle()
    expect(apply).toHaveBeenCalledTimes(3)
    expect(apply).toHaveBeenLastCalledWith(second)
    second.dispose()
  })

  it('honors the shared Set a copy built from the older guard created', () => {
    // Given the shared registry a legacy copy created, holding one package
    const registry = globalThis as Record<symbol, unknown>
    const previous = registry[MOUNTED]
    registry[MOUNTED] = new Set(['@linxin666/dsh-legacy-holder'])
    try {
      // When a package the legacy copy does not hold mounts, it must not throw
      // on that Set and must mark itself beside the legacy name
      const ctx = fakeCtx()
      mountOnce('@linxin666/dsh-skills-satellite', (_ctx: unknown) => {})(ctx)

      // Then the shared value is still the Set every published copy reads
      const shared = registry[MOUNTED]
      expect(shared).toBeInstanceOf(Set)
      expect([...(shared as Set<string>)].sort()).toEqual([
        '@linxin666/dsh-legacy-holder',
        '@linxin666/dsh-skills-satellite',
      ])
      ctx.dispose()
    } finally {
      if (previous === undefined) delete registry[MOUNTED]
      else registry[MOUNTED] = previous
    }
  })

  it('repairs a foreign value left under the shared registry key', () => {
    // Given a shape no copy of this guard writes (an interim build, a hand-set global)
    const registry = globalThis as Record<symbol, unknown>
    const previous = registry[MOUNTED]
    registry[MOUNTED] = new Map([['@linxin666/dsh-stale', {}]])
    try {
      // When a family row mounts, it still registers instead of throwing
      const apply = vi.fn()
      const ctx = fakeCtx()
      mountOnce('@linxin666/dsh-repaired-row', apply)(ctx)
      expect(apply).toHaveBeenCalledTimes(1)
      expect((registry[MOUNTED] as Set<string>).has('@linxin666/dsh-repaired-row')).toBe(true)
      ctx.dispose()
    } finally {
      if (previous === undefined) delete registry[MOUNTED]
      else registry[MOUNTED] = previous
    }
  })

  it('lets different package names mount independently', () => {
    const applyA = vi.fn()
    const applyB = vi.fn()
    const ctxA = fakeCtx()
    const ctxB = fakeCtx()
    mountOnce('@linxin666/dsh-client-ui-usage', applyA)(ctxA)
    mountOnce('@linxin666/dsh-remote-web-ui', applyB)(ctxB)
    mountOnce('@linxin666/dsh-client-ui-usage', applyA)(fakeCtx())
    mountOnce('@linxin666/dsh-remote-web-ui', applyB)(fakeCtx())
    expect(applyA).toHaveBeenCalledTimes(1)
    expect(applyB).toHaveBeenCalledTimes(1)
    ctxA.dispose()
    ctxB.dispose()
  })
})
