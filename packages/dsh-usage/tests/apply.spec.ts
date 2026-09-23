import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/**
 * Host apply wiring: config coercion, route registration gated on `enabled`,
 * the mountOnce single-instance guard, and the Host's row-reload path.
 *
 * Under the 0.1.7 settings model the plugin's own Config schema IS its
 * settings document: the Host hands the effective config to `apply` and
 * reloads the profile row (dispose + apply) when the user saves, so there is no
 * plugin-side settings registration and no in-place live re-arm left to test.
 * The UsageService runs against a temp DSH_HOME with no provider services.
 *
 * The plugin module is re-imported per case because the runtime keeps one
 * process-wide chain serializing a successor's first load behind the
 * predecessor's final ledger flush.
 */

type UsagePlugin = typeof import('../src/index.ts')

/** Fresh plugin module instance for one case. */
async function loadPlugin(): Promise<UsagePlugin> {
  vi.resetModules()
  return import('../src/index.ts')
}

/** Fiber disposers collected from the fake ctx; run after each case to reset mountOnce. */
const disposers: Array<() => void> = []

function makeCtx() {
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

/** Dispose every fiber the fake contexts collected, the way a row reload tears the old one down. */
function disposeAll(): void {
  while (disposers.length > 0) disposers.pop()!()
}

/** Let the serialized start land. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 20))
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-usage-apply-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  disposeAll()
})

describe('resolveConfig', () => {
  it('operator gets the documented defaults when no config is saved', async () => {
    // Given a plugin loaded without a saved config
    const { resolveConfig } = await loadPlugin()
    // When resolveConfig runs
    // Then the documented defaults are resolved
    expect(resolveConfig()).toEqual({ enabled: true, pollIntervalSec: 60, retainDays: 180 })
  })

  it('operator gets out-of-band values coerced into the enum and valid ones kept', async () => {
    // Given one config inside the documented ranges and one with a non-numeric poll interval
    const { resolveConfig } = await loadPlugin()
    // When resolveConfig runs on both
    // Then valid values pass through and the out-of-band interval falls back to the documented default
    expect(resolveConfig({ pollIntervalSec: 120, enabled: false, retainDays: 30 })).toEqual({
      enabled: false, pollIntervalSec: 120, retainDays: 30,
    })
    expect(resolveConfig({ pollIntervalSec: 'fast' as unknown as number }).pollIntervalSec).toBe(60)
  })
})

describe('host apply', () => {
  it('operator gets both routes registered and the service started when enabled', async () => {
    // Given an enabled plugin and a host context that records routes and listeners
    const { apply } = await loadPlugin()
    const { ctx, registered, listeners } = makeCtx()
    // When apply runs
    apply(ctx, {})
    // Then both usage routes are mounted and exactly one lifecycle listener is collecting
    expect([...registered.keys()].sort()).toEqual([
      '/api/dsh-usage/overview',
      '/api/dsh-usage/refresh',
    ])
    expect(listeners()).toBe(1)
  })

  it('mounts nothing when the plugin is disabled', async () => {
    const { apply } = await loadPlugin()
    const { ctx, registered, listeners } = makeCtx()
    apply(ctx, { enabled: false })
    expect(registered.size).toBe(0)
    expect(listeners()).toBe(0)
  })

  it('re-arms on a Host row reload with the newly saved config, including disable then enable', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    expect(first.registered.size).toBe(2)

    // The settings write reloads the profile row: the old fiber goes down and
    // the fresh activation carries the saved config.
    disposeAll()
    expect(first.registered.size).toBe(0)

    const disabled = makeCtx()
    apply(disabled.ctx, { enabled: false })
    await settle()
    expect(disabled.registered.size).toBe(0)
    expect(disabled.listeners()).toBe(0)

    disposeAll()
    const enabled = makeCtx()
    apply(enabled.ctx, { enabled: true })
    // The successor serializes behind the predecessor's final ledger flush.
    expect(enabled.registered.size).toBe(0)
    await settle()
    expect([...enabled.registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
    expect(enabled.listeners()).toBe(1)
  })

  it('does not start a successor whose fiber went down inside the flush window', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    disposeAll()

    const second = makeCtx()
    apply(second.ctx, {})
    expect(second.registered.size).toBe(0)
    // A row torn down before the predecessor's flush settled must leave no
    // live service behind.
    disposeAll()
    await settle()
    expect(second.registered.size).toBe(0)
    expect(second.listeners()).toBe(0)
  })

  it('keeps the flush chain for the reload after a row disposed before it started', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    disposeAll()

    // A reload landing inside the predecessor's flush window, torn down before
    // it starts, must not drop the pending write from the chain.
    const skipped = makeCtx()
    apply(skipped.ctx, {})
    disposeAll()

    const third = makeCtx()
    apply(third.ctx, {})
    expect(third.registered.size).toBe(0)
    await settle()
    expect([...third.registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
    expect(third.listeners()).toBe(1)
    expect(skipped.listeners()).toBe(0)
  })

  it('runs at most once per process (mountOnce)', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    const second = makeCtx()
    apply(second.ctx, {})
    expect(second.registered.size).toBe(0)
    expect(second.listeners()).toBe(0)
    expect(first.registered.size).toBe(2)
  })
})
