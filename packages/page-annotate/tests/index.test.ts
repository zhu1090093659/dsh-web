// @vitest-environment jsdom
/**
 * Timing regression tests for the page-annotate client entry: the right-side
 * tab must register through ctx.inject so registration waits for the
 * dsh-better-sidebar provider, which boots concurrently with this entry in
 * the client loader. A synchronous ctx.get during apply races the provider
 * and silently loses the tab (the original symptom: no panel entry while the
 * entry itself applied cleanly).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import type { BetterSidebarServiceLike, TabDescriptorLike } from '../src/client/better-sidebar.ts'

function makeService(): { service: BetterSidebarServiceLike; tabs: TabDescriptorLike[]; active: Map<string, () => void> } {
  const tabs: TabDescriptorLike[] = []
  const active = new Map<string, () => void>()
  const service: BetterSidebarServiceLike = {
    registerTab: (descriptor) => {
      tabs.push(descriptor)
      const dispose = () => {
        active.delete(descriptor.id)
      }
      active.set(descriptor.id, dispose)
      return dispose
    },
    registerFileViewer: () => () => undefined,
  }
  return { service, tabs, active }
}

/** Flush the microtask-driven cordis fiber activation after provide(). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('page-annotate client apply', () => {
  it('registers the tab only after the betterSidebar service is provided', async () => {
    const ctx = new Context()
    ctx.provide('locale', { register: () => () => undefined })
    const { service, tabs } = makeService()

    apply(ctx)
    await flush()
    expect(tabs).toHaveLength(0)

    ctx.provide('betterSidebar', service)
    await flush()
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.id).toBe('page-annotate')
    expect(tabs[0]!.order).toBe(95)
    expect(tabs[0]!.single).toBe(true)
  })

  it('registers a rendered icon, not the raw SVG source text', async () => {
    const ctx = new Context()
    ctx.provide('locale', { register: () => () => undefined })
    const { service, tabs } = makeService()

    apply(ctx)
    ctx.provide('betterSidebar', service)
    await flush()
    expect(tabs).toHaveLength(1)

    const icon = tabs[0]!.icon
    expect(icon).toBeDefined()
    expect(typeof icon).not.toBe('string')
    const markup = renderToStaticMarkup(icon as never)
    expect(markup).toContain('<svg')
    expect(markup).toContain('viewBox')
    // The source must never leak as visible text.
    expect(markup).not.toContain('&lt;svg')
  })

  it('never registers or throws when better-sidebar is absent', async () => {
    const ctx = new Context()
    ctx.provide('locale', { register: () => () => undefined })
    const { tabs } = makeService()

    expect(() => apply(ctx)).not.toThrow()
    await flush()
    expect(tabs).toHaveLength(0)
  })

  it('unregisters the tab when the provider goes away', async () => {
    const ctx = new Context()
    ctx.provide('locale', { register: () => () => undefined })
    const { service, active } = makeService()

    apply(ctx)
    const disposeService = ctx.provide('betterSidebar', service)
    await flush()
    expect(active.size).toBe(1)

    disposeService()
    await flush()
    expect(active.size).toBe(0)
  })
})