// @vitest-environment jsdom
/**
 * The global pet entry container opts into the L2 semantic attributes
 * (issue #506): the apply body mounts [data-dsh-pet-root] with
 * data-dsh-plugin="pet" so skins can target the pet subtree.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide defineStore /
// createSnapshotStore (same fake-store pattern as the settings-card tests).
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { releasePetClientApply } from './apply-guard.ts'
import { apply } from './index.ts'

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

interface FakeClientLifecycle {
  ctx: ClientContext
  dispose(): void
  settingsListenerCount(): number
}

const activeClients: FakeClientLifecycle[] = []

afterEach(() => {
  for (const client of activeClients.splice(0).reverse()) client.dispose()
  releasePetClientApply()
  document.body.replaceChildren()
})

/** A minimal client root context with observable fiber disposal. */
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
    effect: (fn: () => unknown) => {
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
      inject: (_name: string, callback: () => () => void) => {
        const dispose = callback()
        disposers.push(dispose)
        return dispose
      },
      register: () => () => {},
    },
    sessions: undefined,
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
  }
  activeClients.push(lifecycle)
  return lifecycle
}

describe('pet client apply', () => {
  it('mounts the pet root container with the L2 data-dsh-plugin attribute (#506)', () => {
    apply(fakeContext().ctx)
    const root = document.body.querySelector('[data-dsh-pet-root]')
    expect(root).not.toBeNull()
    expect(root!.getAttribute('data-dsh-plugin')).toBe('pet')
  })

  it('keeps one global pet root when two client factories overlap', () => {
    apply(fakeContext().ctx)
    apply(fakeContext().ctx)

    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
  })

  it('cleans the root and settings subscriptions before a client re-apply', () => {
    const first = fakeContext()
    apply(first.ctx)
    expect(first.settingsListenerCount()).toBeGreaterThan(0)

    first.dispose()
    expect(first.settingsListenerCount()).toBe(0)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(0)

    apply(fakeContext().ctx)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
  })
})
