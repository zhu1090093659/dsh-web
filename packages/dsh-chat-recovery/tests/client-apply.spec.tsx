import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('chat-recovery client apply', () => {
  it('registers the turn actions and the retry dock without throwing', () => {
    const injected: string[] = []
    const registered: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      locale: { register: () => () => {} },
      slots: {
        inject: (key: string, cb: () => unknown) => {
          injected.push(key)
          cb()
          return () => {}
        },
        register: (opts: { name: string }, _component: unknown) => {
          registered.push(opts.name)
          return () => {}
        },
      },
      sessions: {
        list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
        binding: () => undefined,
        fork: async () => 'x',
        open: () => {},
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [] }) },
        create: async () => {
          throw new Error('unused')
        },
        connectWorkspace: async () => 'x',
      },
    }
    apply(ctx as never)
    expect(injected).toEqual(['conversation.chat.turnTail', 'conversation.input.dock'])
    expect(registered).toEqual(['conversation.chat.turnTail', 'conversation.input.dock'])
  })

  it('a duplicated client injection is a no-op (apply guard)', () => {
    // The first test already claimed the global apply slot and this fake ctx
    // never runs the fiber cleanup, so a second apply must register nothing.
    const injected: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      locale: { register: () => () => {} },
      slots: {
        inject: (key: string) => {
          injected.push(key)
          return () => {}
        },
        register: () => () => {},
      },
      sessions: {
        list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
        binding: () => undefined,
        fork: async () => 'x',
        open: () => {},
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [] }) },
        create: async () => {
          throw new Error('unused')
        },
        connectWorkspace: async () => 'x',
      },
    }
    apply(ctx as never)
    expect(injected).toEqual([])
  })
})
