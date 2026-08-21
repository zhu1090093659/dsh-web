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
import { apply } from './index.ts'

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

afterEach(() => {
  document.body.replaceChildren()
})

interface FakeContextHandle {
  ctx: ClientContext
  disposeAll: () => void
}

/** A minimal client root context: ready settings scope, no-op slot system. */
function fakeContext(): FakeContextHandle {
  const disposers: Array<() => void> = []
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
    subscribe: () => () => {},
  }
  const ctx = {
    effect: (fn: () => unknown) => {
      const dispose = fn()
      const normalized = typeof dispose === 'function' ? dispose as () => void : () => {}
      disposers.push(normalized)
      return normalized
    },
    locale: { register: () => () => {} },
    get: () => undefined,
    settingsScope: { bind: () => scope },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: () => () => {},
    },
    sessions: undefined,
  } as unknown as ClientContext
  return {
    ctx,
    disposeAll: () => {
      for (const dispose of disposers.toReversed()) dispose()
    },
  }
}

describe('pet client apply L2 semantic attributes (#506)', () => {
  it('mounts the pet root container with data-dsh-plugin="pet"', () => {
    const { ctx } = fakeContext()
    apply(ctx)
    const root = document.body.querySelector('[data-dsh-pet-root]')
    expect(root).not.toBeNull()
    expect(root!.getAttribute('data-dsh-plugin')).toBe('pet')
  })

  it('keeps a single global pet root across repeated client applies', () => {
    apply(fakeContext().ctx)
    apply(fakeContext().ctx)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
  })

  it('removes the pet root when the client fiber is disposed', () => {
    const handle = fakeContext()
    apply(handle.ctx)
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
    handle.disposeAll()
    expect(document.body.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(0)
  })
})
