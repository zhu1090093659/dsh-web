/**
 * The row's mount under a cordis context that enforces its inject list, and the
 * one native call this row makes into the Host's Agent Teams runtime.
 *
 * A cordis fiber may read only a service it injected; a read of any other service
 * name throws `cannot get property "<name>" without inject` from the cordis
 * resolve trap. This row injects three services and reads the Team service
 * optionally through `ctx.get`, so this suite models both deployments that have to
 * mount: one that serves no Team service at all, and one that serves it from a
 * sibling fiber after the row applied.
 *
 * The runtime itself is the Host's, so nothing here asserts a projection, a team
 * service or a tool surface of this package: the only Team behavior owned here is
 * switching Team mode on for a squad Lead, and only for that session.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject } from '../src/index.ts'
import { DSH_AGENTS_ROUTE_PATHS } from '../src/protocol.ts'

/** How the fake answers a property read of a service it serves. */
interface FakeHostOptions {
  /**
   * Answer property reads of served services with the cordis error instead.
   *
   * A sibling plugin's fiber can read no service it did not inject, which is
   * the shape under test; the default answers them, the way a context that
   * provides the service itself does.
   */
  readonly strictPropertyReads?: boolean
}

/** Everything a spec observes about the fake Host. */
interface FakeHost {
  readonly ctx: Context
  /** Path of every route the row registered with `ctx.webServer`. */
  readonly routes: string[]
  /** First argument of every `ctx.logger.warn` call. */
  readonly warnings: string[]
  /** Name of every `ctx.on` subscription the row made, in order. */
  readonly events: string[]
  /** Drop everything the row disposed through `ctx.effect`. */
  release(): void
}

/**
 * Build the fake Host context.
 *
 * Own properties are the row's inject list plus the context members every
 * plugin uses (`effect`, `on`, `get`, `logger`, and the `reflect`/`fiber` pair a
 * `Service` constructor registers itself through). Every other service name
 * throws cordis' own error unless this fake serves it and answers property
 * reads.
 * @param services - the services this fake deployment serves.
 * @param options - how served services answer a property read.
 * @returns the context and the observation log.
 */
function createFakeHost(services: Record<string, unknown> = {}, options: FakeHostOptions = {}): FakeHost {
  const routes: string[] = []
  const warnings: string[] = []
  const events: string[] = []
  const disposers: Array<() => unknown> = []
  const available = new Map<string, unknown>(Object.entries(services))

  const systemPrompt = {
    section: () => () => undefined,
    context: () => () => undefined,
    getSectionOrder: () => 0,
    getContextOrder: () => 0,
  }
  const webServer = {
    register: (route: { path: string }): (() => void) => {
      routes.push(route.path)
      return () => undefined
    },
  }
  const target: Record<string, unknown> = {
    effect: (callback: () => unknown): (() => void) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose as () => unknown)
      return () => undefined
    },
    on: (name: string) => {
      events.push(name)
      return () => undefined
    },
    get: (name: string) => available.get(name),
    logger: { warn: (message: unknown) => { warnings.push(String(message)) } },
    fiber: { effect: (callback: () => unknown) => callback() },
    reflect: {
      provide: (name: string, value: unknown): (() => void) => {
        available.set(name, value)
        return () => { available.delete(name) }
      },
    },
  }
  // The injectable surface is the row's own declared list, so this fake cannot
  // drift from the services the row promises to inject.
  for (const name of inject) {
    target[name] = name === 'webServer' ? webServer : name === 'systemPrompt' ? systemPrompt : undefined
  }

  let ctx: Context
  const proxy = new Proxy(target, {
    get(inner, property) {
      if (typeof property === 'symbol' || property === 'then' || property.startsWith('_')) {
        return Reflect.get(inner, property)
      }
      if (Reflect.has(inner, property)) return Reflect.get(inner, property)
      if (property === 'root') return proxy
      if (available.has(property) && options.strictPropertyReads !== true) return available.get(property)
      throw new Error(`cannot get property "${property}" without inject`)
    },
  })
  ctx = proxy as unknown as Context
  // `ctx.root` is the context a `Service` registers its root projection on.
  target.root = proxy

  return {
    ctx,
    routes,
    warnings,
    events,
    release: () => {
      for (const dispose of disposers.splice(0)) {
        try {
          void Promise.resolve(dispose()).catch(() => undefined)
        } catch {
          // Disposing the fake Host is best-effort; the assertions already ran.
        }
      }
    },
  }
}

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-agents-inject-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe('row mount under an inject-enforcing context', () => {
  it('operator mounts the ledger routes and subscribes to agent/created with no Team service served', () => {
    // Given a deployment that serves no agentTeams service, When the row applies, Then the eight ledger routes mount, nothing fails, and the row is listening for the agents whose Team mode it may switch on.
    const host = createFakeHost({}, { strictPropertyReads: true })
    try {
      expect(() => { apply(host.ctx, { enabled: true }) }).not.toThrow()
      expect(host.routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
      expect(host.events).toContain('agent/created')
      expect(host.warnings.filter(message => message.includes('Team'))).toEqual([])
    } finally {
      host.release()
    }
  })

  it('operator registers no session projection of its own', () => {
    // Given a deployment that serves the projection registry, When the row applies, Then it registers no projection at all: agentTeam and subagentCatalog both belong to the Host's runtime, and a second registration of one key is the failure this row must never cause.
    const projections: Array<{ key: string; stateVersion: number }> = []
    const host = createFakeHost({
      sessionProjections: {
        register: (definition: { key: string; stateVersion: number }) => {
          projections.push({ key: definition.key, stateVersion: definition.stateVersion })
          return { stateOf: () => ({}) }
        },
      },
    }, { strictPropertyReads: true })
    try {
      apply(host.ctx, { enabled: true })
      expect(projections).toEqual([])
    } finally {
      host.release()
    }
  })
})

/** One live Agent as the row reads it: its session id and its parent, nothing else. */
function fakeAgent(id: string, parentSession?: string): unknown {
  return { id, session: { header: { parentSession } } }
}

/**
 * Announce one created Agent to every listener in the tree.
 *
 * The payload is the Host's own event; this suite only needs the two fields the
 * row reads, so the emit is reached through the one signature cordis offers.
 * @param root - the tree root.
 * @param agent - the Agent the Host would have published.
 */
function announceAgent(root: Context, agent: unknown): void {
  (root as unknown as { emit(name: string, payload: unknown): void }).emit('agent/created', { agent, source: 'startup' })
}

/**
 * The Team switch is the only Team behavior this package owns.
 *
 * The native service is off by default and belongs to a ROOT Session, so a squad
 * Lead would open with no task board. The switch therefore has to happen on the
 * run record, not on `agent/created`: the Host announces that event INSIDE
 * session creation, which happens before this package has a record to match. The
 * announce listener stays as the fallback for a Lead announced later (a resumed
 * session), and no session the user opened has its Team mode touched.
 */
describe('native Team mode for a squad Lead', () => {
  it('operator enables Team mode on the run record and leaves every other session alone', async () => {
    // Given a real cordis Host that serves the Team service and the live agent registry, When a squad run is launched and its record is written, Then setEnabled(lead, true) is called for that Lead without waiting for any announce, an ordinary session and a teammate never reach it, and a later announce of an already-enabled Lead is a no-op.
    const root = new Context()
    const routes: WebRoute[] = []
    const enabled: string[] = []
    let leadEnabled = false

    root.plugin({
      name: 'fake-host-services',
      apply(provider: Context) {
        provider.provide('systemPrompt', {
          section: () => () => undefined,
          context: () => () => undefined,
          getSectionOrder: () => 0,
          getContextOrder: () => 0,
        })
        provider.provide('typertGateway', {
          invoke: async (request: { namespace: string; method: string }): Promise<unknown> => {
            return request.namespace === 'session' && request.method === 'create' ? { sessionId: 'lead-session' } : {}
          },
        })
        provider.provide('agents', {
          get: (sessionId: string) => sessionId === 'lead-session' ? fakeAgent('lead-session') : undefined,
        })
        provider.provide('agentTeams', {
          isEnabled: () => leadEnabled,
          setEnabled: async (agent: { id: string }) => {
            enabled.push(agent.id)
            leadEnabled = true
          },
        })
        provider.provide('webServer', {
          register: (route: WebRoute): (() => void) => {
            routes.push(route)
            return () => undefined
          },
        })
      },
    })

    let failure: unknown
    root.plugin({
      name: 'dsh-agents-row',
      inject: [...inject],
      apply(row: Context) {
        try {
          apply(row, { enabled: true })
        } catch (error) {
          failure = error
        }
      },
    })

    await vi.waitFor(() => {
      expect(routes.map(route => route.path)).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    })
    expect(failure).toBeUndefined()

    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://local').pathname
      const route = routes.find(candidate => candidate.path === path)
      if (route === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      void Promise.resolve(route.handler(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('the test server did not bind')
    const base = 'http://127.0.0.1:' + String(address.port)
    const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(200)
      return await response.json() as Record<string, unknown>
    }

    try {
      // Nothing is enabled before a run exists.
      announceAgent(root, fakeAgent('lead-session'))
      expect(enabled).toEqual([])

      const created = await post('/dsh-agents/api/team', { team: { name: 'Squad' } })
      const teamId = (created.team as { id: string }).id
      const run = await post('/dsh-agents/api/squad/run', { teamId })
      expect(run.run).toMatchObject({ sessionId: 'lead-session', kind: 'squad', status: 'running' })

      // The run record itself switched the Lead, with no announce involved.
      await vi.waitFor(() => { expect(enabled).toEqual(['lead-session']) })

      // An ordinary session and a teammate under the Lead: untouched. A later
      // announce of the already-enabled Lead has nothing to do.
      announceAgent(root, fakeAgent('ordinary-session'))
      announceAgent(root, fakeAgent('teammate-session', 'lead-session'))
      announceAgent(root, fakeAgent('lead-session'))
      expect(enabled).toEqual(['lead-session'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
    }
  })
})

/**
 * The workspace registry is resolved per use, never once at apply.
 *
 * The official registry initializes asynchronously, after this row applies, so a
 * face captured at apply time stays undefined for the life of the process: the
 * panel then offers no workspace to pin and every pinned run answers
 * workspace-unavailable. Only a real cordis tree whose sibling fiber provides the
 * service AFTER the row applied can tell per-use resolution from a cached face.
 */
describe('a workspace registry that activates after the row applied', () => {
  it('operator offers the registry to the picker and to a pinned run once it activates', async () => {
    // Given a real cordis Host that serves no workspaceRegistry when the row applies, When a sibling fiber provides one and the panel then reads state and runs a member pinned to ws-1, Then the state view carries the offered workspaces and createSession is handed the pinned workspace id.
    const root = new Context()
    const routes: WebRoute[] = []
    const calls: Array<{ namespace: string; method: string; args: Record<string, unknown> }> = []

    root.plugin({
      name: 'fake-host-services',
      apply(provider: Context) {
        provider.provide('systemPrompt', {
          section: () => () => undefined,
          context: () => () => undefined,
          getSectionOrder: () => 0,
          getContextOrder: () => 0,
        })
        provider.provide('typertGateway', {
          invoke: async (request: { namespace: string; method: string; args: Record<string, unknown> }): Promise<unknown> => {
            calls.push({ namespace: request.namespace, method: request.method, args: request.args })
            return request.namespace === 'session' && request.method === 'create' ? { sessionId: 'session-1' } : {}
          },
        })
        provider.provide('webServer', {
          register: (route: WebRoute): (() => void) => {
            routes.push(route)
            return () => undefined
          },
        })
      },
    })

    let failure: unknown
    root.plugin({
      name: 'dsh-agents-row',
      inject: [...inject],
      apply(row: Context) {
        try {
          apply(row, { enabled: true })
        } catch (error) {
          failure = error
        }
      },
    })

    // The registered route table is the row's own output, so wait on it rather
    // than on a fixed delay; a row that never applied fails here.
    await vi.waitFor(() => {
      expect(routes.map(route => route.path)).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    })
    expect(failure).toBeUndefined()

    // Serve the captured table the way the host would: one exact route per path.
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://local').pathname
      const route = routes.find(candidate => candidate.path === path)
      if (route === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      void Promise.resolve(route.handler(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('the test server did not bind')
    const base = 'http://127.0.0.1:' + String(address.port)
    const get = async (path: string): Promise<Record<string, unknown>> => {
      const response = await fetch(base + path, { headers: { 'sec-fetch-site': 'same-origin' } })
      expect(response.status).toBe(200)
      return await response.json() as Record<string, unknown>
    }
    const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(200)
      return await response.json() as Record<string, unknown>
    }

    try {
      // The registry is genuinely absent where the row applied.
      expect('workspaces' in await get('/dsh-agents/api/state')).toBe(false)

      root.plugin({
        name: 'late-workspace-registry',
        apply(provider: Context) {
          provider.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', title: 'repo' }] })
        },
      })
      await vi.waitFor(() => {
        const registry = root.get('workspaceRegistry') as { list: () => unknown } | undefined
        expect(registry?.list()).toEqual([{ id: 'ws-1', title: 'repo' }])
      })

      // The SAME running row now serves the picker out of the live registry.
      expect((await get('/dsh-agents/api/state')).workspaces).toEqual([{ id: 'ws-1', title: 'repo' }])

      const created = await post('/dsh-agents/api/team', { team: { name: 'Squad', workspaceId: 'ws-1' } })
      const team = created.team as { id: string }
      const added = await post('/dsh-agents/api/member', { teamId: team.id, member: { name: 'M' } })
      const memberId = (added.team as { members: Array<{ id: string }> }).members[0].id
      const run = await post('/dsh-agents/api/run', { teamId: team.id, memberId })

      expect(run.run).toMatchObject({ sessionId: 'session-1', status: 'running' })
      // createSession received the pin the live registry validated.
      expect(calls).toContainEqual({ namespace: 'session', method: 'create', args: { request: { workspaceId: 'ws-1' } } })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
    }
  })
})
