import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'

/**
 * The host half gates every surface on the resolved `enabled`: with the
 * plugin off (the default) nothing registers; turning it on mounts the
 * create/shutdown routes and the system-prompt announcement. The settings
 * service is faked to feed one resolved value per case.
 */

/** The fake settings service feeds installSection one static scope. */
interface FakeScope {
  get: () => Record<string, unknown>
  watch: () => () => void
}

function makeScope(value: Record<string, unknown>): FakeScope {
  return {
    get: () => value,
    watch: () => () => {},
  }
}

/** Fiber disposers collected from the fake ctx; run after each case to reset mountOnce. */
const disposers: Array<() => void> = []

function makeCtx(scope: FakeScope, appExit?: (code: number) => void) {
  const registered = new Map<string, WebRoute>()
  const announced = new Set<string>()
  const effect = (fn: () => unknown) => {
    const disposer = fn()
    disposers.push(disposer as () => void)
    return disposer
  }
  const ctx = {
    effect,
    get: (name: string) => name === 'appExit' ? appExit : undefined,
    // dsh-settings checks ctx.fiber.state when a registration tears down.
    fiber: { state: 0 },
    inject: (_deps: string[], fn: (sctx: { settings: { installSection: (owner: unknown, ns: unknown, schema: unknown, entry: unknown, hooks: { setSource: (current: () => unknown) => void; onChange: () => void }) => void }; effect: typeof effect }) => void) => {
      fn({
        settings: {
          installSection: (_owner, _ns, _schema, _entry, hooks) => {
            hooks.setSource(() => scope.get())
            hooks.onChange()
          },
        },
        effect,
      })
      return () => {}
    },
    webServer: {
      register: (route: WebRoute) => {
        registered.set(route.path, route)
        return () => {}
      },
    },
    systemPrompt: {
      section: (section: { name: string }) => {
        announced.add(section.name)
        return () => {}
      },
    },
  }
  return { ctx: ctx as never, registered, announced }
}

afterEach(() => {
  vi.useRealTimers()
  while (disposers.length > 0) disposers.pop()!()
})

describe('desktop-launcher host apply', () => {
  it('mounts nothing while the plugin is off', () => {
    const { ctx, registered, announced } = makeCtx(makeScope({ enabled: false }))
    apply(ctx, {})
    expect(registered.size).toBe(0)
    expect(announced.size).toBe(0)
  })

  it('mounts the routes and an explicitly enabled announcement', () => {
    const { ctx, registered, announced } = makeCtx(makeScope({ enabled: true, announceToAgent: true }))
    apply(ctx, {})
    expect(new Set(registered.keys())).toEqual(new Set([
      '/api/dsh-desktop-launcher/create',
      '/api/dsh-desktop-launcher/shutdown',
    ]))
    expect(announced).toEqual(new Set(['plugin:dsh-desktop-launcher']))
  })

  it('acknowledges shutdown before requesting one bounded host exit', async () => {
    vi.useFakeTimers()
    const exits: number[] = []
    const { ctx, registered } = makeCtx(makeScope({ enabled: true }), code => { exits.push(code) })
    apply(ctx, {})
    const route = registered.get('/api/dsh-desktop-launcher/shutdown')!
    const req = {
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080' },
    } as unknown as IncomingMessage
    const state = { status: 0, body: '' }
    const res = {
      writeHead: (status: number) => { state.status = status },
      end: (body?: string) => { state.body = body ?? '' },
    } as unknown as ServerResponse
    await route.handler(req, res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ ok: true })
    expect(exits).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(exits).toEqual([0])

    await route.handler(req, res)
    await vi.advanceTimersByTimeAsync(500)
    expect(exits).toEqual([0])
  })
})
