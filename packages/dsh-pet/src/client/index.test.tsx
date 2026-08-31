// @vitest-environment jsdom
/**
 * The global pet entry container opts into the L2 semantic attributes
 * (issue #506): the apply body mounts [data-dsh-pet-root] with
 * data-dsh-plugin="pet" so skins can target the pet subtree. The same
 * tests pin the fiber-lifecycle contract (issue #785): a hot-reloaded or
 * re-injected bundle instance must never leave the previous React root,
 * container, or settings subscription behind, so the page always holds
 * exactly one [data-dsh-pet-root].
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide defineStore /
// createSnapshotStore (same fake-store pattern as the settings-card tests).
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: {
    init: () => unknown
    actions: Record<string, (draft: never, ...args: never[]) => void>
  }) => ({
    create: () => {
      let value = spec.init()
      const listeners = new Set<() => void>()
      const actions: Record<string, (...args: unknown[]) => void> = {}
      for (const [name, fn] of Object.entries(spec.actions)) {
        actions[name] = (...args: unknown[]) => {
          fn(value as never, ...(args as never[]))
          for (const listener of listeners) listener()
        }
      }
      return {
        getSnapshot: () => value,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        actions,
      }
    },
  }),
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from './index.ts'

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

/** A client root context with observable fiber disposal. */
interface FakeClientLifecycle {
  ctx: ClientContext
  dispose(): void
  settingsListenerCount(): number
  emitSettings(): void
}

const activeLifecycles: FakeClientLifecycle[] = []

afterEach(() => {
  for (const lifecycle of activeLifecycles.splice(0).reverse()) lifecycle.dispose()
  document.body.replaceChildren()
})

function fakeContext(): FakeClientLifecycle {
  const disposers: (() => void)[] = []
  const settingsListeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      writable: true,
      value: undefined,
      base: undefined,
      user: {},
      revision: 1,
      mode: 'host',
    }),
    subscribe: (listener: () => void) => {
      settingsListeners.add(listener)
      return () => { settingsListeners.delete(listener) }
    },
  }
  const ctx = {
    effect: (fn: () => unknown, _label?: string) => {
      const dispose = fn()
      if (typeof dispose !== 'function') return () => {}
      const cleanup = dispose as () => void
      disposers.push(cleanup)
      return cleanup
    },
    locale: { register: () => () => {} },
    get: () => undefined,
    settingsScope: { bind: () => scope },
    slots: {
      // Cordis runs the factory when the slot mounts and its returned
      // disposer when the fiber disposes; mirror that so slot content
      // (settings card subscription) is cleaned with the fiber.
      inject: (_name: string, callback: () => () => void) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      },
      register: () => () => {},
    },
    sessions: {
      list: {
        getSnapshot: () => ({ current: undefined, byId: {} }),
        subscribe: (listener: () => void) => {
          const set = new Set<() => void>([listener])
          return () => { set.delete(listener) }
        },
      },
      open: () => {},
    },
  } as unknown as ClientContext
  let disposed = false
  const lifecycle: FakeClientLifecycle = {
    ctx,
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
    settingsListenerCount: () => settingsListeners.size,
    emitSettings: () => {
      for (const listener of settingsListeners) listener()
    },
  }
  activeLifecycles.push(lifecycle)
  return lifecycle
}

describe('pet client apply', () => {
  it('mounts the pet root container with the L2 data-dsh-plugin attribute (#506)', () => {
    apply(fakeContext().ctx)
    const root = document.body.querySelector('[data-dsh-pet-root]')
    expect(root).not.toBeNull()
    expect(root!.getAttribute('data-dsh-plugin')).toBe('pet')
  })

  it('keeps one global pet root when two client factories overlap (#785)', () => {
    const first = fakeContext()
    apply(first.ctx)
    const firstContainer = document.body.querySelector('[data-dsh-pet-root]')
    expect(firstContainer).not.toBeNull()

    // A rebuilt bundle re-applies while the first fiber is still draining.
    const second = fakeContext()
    apply(second.ctx)

    const roots = document.body.querySelectorAll('[data-dsh-pet-root]')
    expect(roots).toHaveLength(1)
    expect(roots[0]).not.toBe(firstContainer)
    expect(firstContainer!.isConnected).toBe(false)

    // The first instance must not resurrect its own root.
    first.emitSettings()
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)

    // The first fiber draining later stays a no-op.
    first.dispose()
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
  })

  it('tears down root, container, and settings subscription on fiber disposal (#785)', () => {
    const lifecycle = fakeContext()
    apply(lifecycle.ctx)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
    // The settings card controller subscribes to the same scope as the UI
    // sync, so at least the sync listener is present while the fiber lives.
    expect(lifecycle.settingsListenerCount()).toBeGreaterThan(0)

    lifecycle.dispose()

    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(0)
    expect(lifecycle.settingsListenerCount()).toBe(0)
  })

  it('re-applies cleanly after disposal so a hot reload keeps one pet (#785)', () => {
    const first = fakeContext()
    apply(first.ctx)
    first.dispose()
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(0)

    const second = fakeContext()
    apply(second.ctx)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
  })

  it('sweeps stale containers left behind by instances without a teardown slot (#785)', () => {
    // A container from a bundle build that predates the teardown registry:
    // nothing registered a teardown, so only the mount-path sweep can clear it.
    const stale = document.createElement('div')
    stale.dataset.dshPetRoot = ''
    document.body.appendChild(stale)

    apply(fakeContext().ctx)

    const roots = document.body.querySelectorAll('[data-dsh-pet-root]')
    expect(roots).toHaveLength(1)
    expect(stale.isConnected).toBe(false)
  })
})
