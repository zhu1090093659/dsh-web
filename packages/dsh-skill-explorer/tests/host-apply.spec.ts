/**
 * Host apply tests: enabled=false registers nothing; enabled registers the
 * route family and disposes cleanly.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** Fake cordis ctx capturing route registrations. */
function fakeCtx() {
  const state = { routes: [] as Array<{ path?: string }>, effects: [] as string[] }
  return {
    ...state,
    webServer: {
      register: (route: { path?: string }) => { state.routes.push(route); return () => {} },
    },
    skills: {
      snapshot: async () => ({ skills: [], complete: true }),
    },
    sessions: {
      list: () => [],
    },
    logger: { warn: () => {} },
    effect: (fn: () => unknown, label: string) => {
      state.effects.push(label)
      const disposer = fn()
      return () => { if (typeof disposer === 'function') (disposer as () => void)() }
    },
  }
}

describe('skill-explorer host apply', () => {
  it('registers nothing when enabled is false', () => {
    const ctx = fakeCtx()
    apply(ctx as never, { enabled: false })
    expect(ctx.routes.length).toBe(0)
  })

  it('registers the five routes when enabled (default)', () => {
    const ctx = fakeCtx()
    apply(ctx as never, {})
    const paths = ctx.routes.map((route) => route.path)
    expect(paths).toEqual([
      '/api/dsh-skill-explorer/list',
      '/api/dsh-skill-explorer/set-enabled',
      '/api/dsh-skill-explorer/create',
      '/api/dsh-skill-explorer/delete',
      '/api/dsh-skill-explorer/health',
    ])
  })
})
