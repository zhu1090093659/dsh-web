import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, resolveConfig, type Config } from '../src/index.ts'

/**
 * Host apply wiring: config coercion, route registration gated on `enabled`,
 * live re-arm on settings change, and the mountOnce single-instance guard.
 * Modeled on dsh-desktop-launcher's apply spec: the settings scope is faked,
 * the UsageService runs against a temp DSH_HOME with no provider services.
 */

interface ScopeHandle {
  scope: { get: () => Record<string, unknown>; watch: (cb: () => void) => () => void }
  set: (next: Record<string, unknown>) => void
}

function makeScope(value: Record<string, unknown>): ScopeHandle {
  let current = value
  const watchers: Array<() => void> = []
  return {
    scope: {
      get: () => current,
      watch: (cb) => {
        watchers.push(cb)
        return () => {}
      },
    },
    set: (next) => {
      current = next
      for (const cb of watchers) cb()
    },
  }
}

/** Fiber disposers collected from the fake ctx; run after each case to reset mountOnce. */
const disposers: Array<() => void> = []

function makeCtx(scope: ScopeHandle) {
  const registered = new Map<string, WebRoute>()
  let sessionListenerCount = 0
  const effect = (fn: () => unknown) => {
    const disposer = fn()
    disposers.push(disposer as () => void)
    return disposer
  }
  const ctx = {
    effect,
    on: (event: string) => {
      if (event === 'session/event') sessionListenerCount += 1
      return () => {}
    },
    get: () => undefined,
    // dsh-settings checks ctx.fiber.state when a registration tears down.
    fiber: { state: 0 },
    inject: (_deps: string[], fn: (sctx: { settings: { installSection: (owner: unknown, ns: unknown, schema: unknown, entry: unknown, hooks: { setSource: (current: () => unknown) => void; onChange: () => void }) => void }; effect: typeof effect }) => void) => {
      fn({
        settings: {
          installSection: (_owner, _ns, _schema, _entry, hooks) => {
            hooks.setSource(() => scope.scope.get())
            hooks.onChange()
            scope.scope.watch(() => hooks.onChange())
          },
        },
        effect,
      })
      return () => {}
    },
    webServer: {
      register: (route: WebRoute) => {
        registered.set(route.path, route)
        return () => {
          registered.delete(route.path)
        }
      },
    },
  }
  return { ctx: ctx as never, registered, listeners: () => sessionListenerCount }
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-usage-apply-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  while (disposers.length > 0) disposers.pop()!()
})

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    expect(resolveConfig()).toEqual({ enabled: true, pollIntervalSec: 60, bubbleMode: 'always', retainDays: 180 })
  })

  it('coerces out-of-band values into the enum and keeps valid ones', () => {
    expect(resolveConfig({ bubbleMode: 'off', pollIntervalSec: 120, enabled: false, retainDays: 30 })).toEqual({
      enabled: false, pollIntervalSec: 120, bubbleMode: 'off', retainDays: 30,
    })
    expect(resolveConfig({ bubbleMode: 'yolo' }).bubbleMode).toBe('always')
    expect(resolveConfig({ pollIntervalSec: 'fast' as unknown as Config['pollIntervalSec'] }).pollIntervalSec).toBe(60)
  })
})

describe('host apply', () => {
  it('registers both routes and starts the service when enabled', () => {
    const scope = makeScope({})
    const { ctx, registered, listeners } = makeCtx(scope)
    apply(ctx, {})
    expect([...registered.keys()].sort()).toEqual([
      '/api/dsh-usage/overview',
      '/api/dsh-usage/refresh',
    ])
    expect(listeners()).toBe(1)
  })

  it('mounts nothing when the plugin is disabled', () => {
    const scope = makeScope({ enabled: false })
    const { ctx, registered, listeners } = makeCtx(scope)
    apply(ctx, { enabled: false })
    expect(registered.size).toBe(0)
    expect(listeners()).toBe(0)
  })

  it('re-arms live when the settings scope changes, including disable → enable', async () => {
    const scope = makeScope({})
    const { ctx, registered, listeners } = makeCtx(scope)
    apply(ctx, {})
    expect(registered.size).toBe(2)

    scope.set({ enabled: false })
    expect(registered.size).toBe(0)
    expect(listeners()).toBe(1)

    scope.set({ enabled: true })
    // The successor serializes behind the predecessor's final flush.
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect([...registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
    expect(listeners()).toBe(2)
  })

  it('runs at most once per process (mountOnce)', () => {
    const scope = makeScope({})
    const first = makeCtx(scope)
    apply(first.ctx, {})
    const second = makeCtx(scope)
    apply(second.ctx, {})
    expect(second.registered.size).toBe(0)
    expect(second.listeners()).toBe(0)
    expect(first.registered.size).toBe(2)
  })
})
