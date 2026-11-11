/**
 * The row's mount under a cordis context that enforces its inject list.
 *
 * A cordis fiber may read only a service it injected; a read of any other
 * service name throws `cannot get property "<name>" without inject` from the
 * cordis resolve trap. This row injects three services and READS five optional
 * Team-runtime services, so this suite models the deployments that have to
 * mount: one that serves none of the five, one that serves all five, and a
 * context whose services are reachable through `ctx.get` only. The first case
 * is the regression: a plain property read of `agents` turned the optional
 * probe into a fatal apply error, and the page then reported that the Host API
 * was not mounted at all.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, OFFICIAL_TEAMS_BUNDLES, profileMountsOfficialTeams, servesTeamRuntime, teamRuntimeGate } from '../src/index.ts'
import { DSH_AGENTS_ROUTE_PATHS } from '../src/protocol.ts'
import { TeamService, type TeamServiceContext } from '../src/team/index.ts'
import { installTeamTools } from '../src/tools/index.ts'

/** One registered projection definition. */
type Projection = { key: string; stateVersion: number }

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

/** The five Team-runtime services a deployment can serve. */
function servedTeamServices(projections: Projection[]): Record<string, unknown> {
  return {
    agents: { get: () => undefined, list: () => [] },
    sessions: { get: () => undefined, flush: async () => undefined },
    sessionPersistence: { open: async () => undefined },
    sessionProjections: {
      register: async (definition: Projection) => {
        projections.push({ key: definition.key, stateVersion: definition.stateVersion })
        return { stateOf: () => ({}) }
      },
    },
    subagents: {
      startActivation: async () => undefined,
      drainChildren: async () => undefined,
      interrupt: () => undefined,
    },
  }
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
  it('operator mounts the ledger routes and skips the forked team runtime when a deployment serves none of its five services', () => {
    // Given a Host that serves none of the five Team-runtime services, When the row applies, Then every ledger route registers, the Team runtime stays unmounted with one warning, and no property read can fail the mount.
    const host = createFakeHost()

    // The exact production failure: a service the fiber did not inject.
    expect(() => Reflect.get(host.ctx as object, 'agents')).toThrow('cannot get property "agents" without inject')
    expect(servesTeamRuntime(host.ctx)).toBe(false)

    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(host.routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    expect(host.warnings.some(message => message.includes('forked Agent Teams runtime stays unmounted'))).toBe(true)
    host.release()
  })

  it('operator mounts the forked team runtime exactly once when the deployment serves all five services', () => {
    // Given a Host that serves all five while its profile mounts no official Agent Teams bundle, When the row applies, Then the same routes register and the Team service registers its one agentTeam projection.
    const projections: Projection[] = []
    const host = createFakeHost({
      ...servedTeamServices(projections),
      profileContext: { startedBundles: ['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all'] },
    })

    expect(teamRuntimeGate(host.ctx)).toBe('ready')
    expect(servesTeamRuntime(host.ctx)).toBe(true)
    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(host.routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    expect(projections).toEqual([{ key: 'agentTeam', stateVersion: 4 }])
    expect(host.warnings.some(message => message.includes('forked Agent Teams runtime stays unmounted'))).toBe(false)
    host.release()
  })

  it('operator keeps the official Team runtime when the profile mounts its bundle before that row applies', () => {
    // Given a profile whose startup bundles include the official Agent Teams bundle while its service does not exist yet, When the row applies, Then the forked runtime stays out for the same reason the registered service gives - the later official row keeps the name instead of failing its own mount.
    const projections: Projection[] = []
    const host = createFakeHost({
      ...servedTeamServices(projections),
      profileContext: { startedBundles: ['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all', OFFICIAL_TEAMS_BUNDLES[0]] },
    })

    expect(teamRuntimeGate(host.ctx)).toBe('host-teams-declared')
    expect(servesTeamRuntime(host.ctx)).toBe(false)

    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(host.routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    // Nothing of the fork may claim agentTeams before the official row applies.
    expect(projections).toEqual([])
    expect(host.events.filter(name => name.startsWith('agent/'))).toEqual([])
    expect((host.ctx as unknown as { get(name: string): unknown }).get('agentTeams')).toBeUndefined()
    expect(host.warnings.some(message => message.includes('mounts an official Agent Teams runtime bundle'))).toBe(true)
    expect(host.warnings.some(message => message.includes('already serves the official Agent Teams runtime'))).toBe(false)
    host.release()
  })

  it('operator yields to the current Agent Teams bundle name as well as the legacy one', () => {
    // Given a profile that lists the CURRENT upstream team package (the runtime
    // that moved to packages/team and publishes @deepseek-ai/dsh-agent-team),
    // When the row applies, Then it yields exactly as it does for the legacy
    // experimental bundle: one service name, one owner, whatever generation
    // provides it, and the warning names both names it recognizes.
    const projections: Projection[] = []
    const host = createFakeHost({
      ...servedTeamServices(projections),
      profileContext: { startedBundles: ['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all', '@deepseek-ai/dsh-agent-team'] },
    })

    expect(OFFICIAL_TEAMS_BUNDLES).toContain('@deepseek-ai/dsh-agent-team')
    expect(teamRuntimeGate(host.ctx)).toBe('host-teams-declared')
    expect(servesTeamRuntime(host.ctx)).toBe(false)

    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(projections).toEqual([])
    expect(host.warnings.some(message => message.includes('@deepseek-ai/dsh-agent-team'))).toBe(true)
    host.release()
  })

  it('operator yields to the 0.2.2-rc.2+ base bundle when dsh-base is started alongside subagents.rootOf', () => {
    // Given a 0.2.2-rc.2+ Host where @deepseek-ai/dsh-base embeds agent-team and subagents exposes rootOf, When the gate runs before agentTeams finishes registering, Then profileMountsOfficialTeams returns true and the fork stays unmounted.
    const projections: Projection[] = []
    const services = servedTeamServices(projections)
    const host = createFakeHost({
      ...services,
      subagents: {
        ...(services.subagents as object),
        rootOf: (caller: unknown) => caller,
      },
      profileContext: {
        startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    })

    expect(profileMountsOfficialTeams(host.ctx)).toBe(true)
    expect(teamRuntimeGate(host.ctx)).toBe('host-teams-declared')
    expect(servesTeamRuntime(host.ctx)).toBe(false)

    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(projections).toEqual([])
    host.release()
  })

  it('operator keeps the official Team runtime when the deployment already serves agentTeams', () => {
    // Given a Host that serves all five team-runtime services and an agentTeams service of its own, When the row applies, Then it mounts the ledger routes, neither service nor tool surface is registered a second time, and the warning names the official runtime as the reason.
    const projections: Projection[] = []
    const official = { tryMembership: () => undefined, listMembers: () => [] }
    const host = createFakeHost({ ...servedTeamServices(projections), agentTeams: official })

    expect(teamRuntimeGate(host.ctx)).toBe('host-teams')
    expect(servesTeamRuntime(host.ctx)).toBe(false)

    expect(() => apply(host.ctx, { enabled: true })).not.toThrow()
    expect(host.routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    // The official runtime owns agentTeam/4, so the fork registers no projection.
    expect(projections).toEqual([])
    // Neither the forked TeamService nor installTeamTools subscribes to these
    // events, so their absence is the mount's own evidence that the whole fork
    // block stayed out - not merely its constructor.
    expect(host.events.filter(name => name.startsWith('agent/'))).toEqual([])
    // The service the deployment published is still the object it published.
    expect((host.ctx as unknown as { get(name: string): unknown }).get('agentTeams')).toBe(official)
    expect(host.warnings.some(message => message.includes('already serves the official Agent Teams runtime'))).toBe(true)
    expect(host.warnings.some(message => message.includes('forked Agent Teams runtime stays unmounted'))).toBe(false)
    host.release()
  })

  it('operator installs the Team tool surface through the service accessor when served services are not readable as properties', () => {
    // Given a context that reaches agentTeams and agents only through ctx.get, When the installer runs, Then it scans the live agents instead of throwing on a property read.
    const projections: Projection[] = []
    const host = createFakeHost(
      { ...servedTeamServices(projections), agentTeams: { tryMembership: () => undefined } },
      { strictPropertyReads: true },
    )
    expect(() => Reflect.get(host.ctx as object, 'agentTeams')).toThrow('cannot get property "agentTeams" without inject')

    const installation = installTeamTools(host.ctx as unknown as TeamServiceContext, { isTeamSession: () => false })
    expect(() => installation.refresh()).not.toThrow()
    installation.dispose()
    host.release()
  })
})

describe('team runtime mount on a real cordis tree', () => {
  it('operator mounts the Team service on the row fiber when a sibling fiber provides the five services', async () => {
    // Given a real cordis tree whose five Team services are provided by a sibling fiber, When the Team service is constructed on a fiber that injects only the row's three services, Then it constructs, registers its one projection, and answers Lead membership.
    const root = new Context()
    const projections: Projection[] = []
    const lead = {
      id: 'lead-session',
      session: {
        header: { id: 'lead-session' },
        inheritedEventCount: 0,
        snapshotEvents: () => [],
      },
      options: {},
    } as unknown as Agent

    root.plugin({
      name: 'fake-host-services',
      apply(provider: Context) {
        provider.provide('systemPrompt', {
          section: () => () => undefined,
          context: () => () => undefined,
          getSectionOrder: () => 0,
          getContextOrder: () => 0,
        })
        provider.provide('typertGateway', {})
        provider.provide('webServer', { register: () => () => undefined })
        provider.provide('agents', {
          get: (id: string) => (id === lead.id ? lead : undefined),
          list: () => [lead],
        })
        provider.provide('sessions', { get: () => undefined, flush: async () => undefined })
        provider.provide('sessionPersistence', { open: async () => undefined })
        provider.provide('sessionProjections', {
          register: async (definition: Projection) => {
            projections.push({ key: definition.key, stateVersion: definition.stateVersion })
            return { stateOf: () => ({}) }
          },
        })
        provider.provide('subagents', {
          startActivation: async () => undefined,
          drainChildren: async () => undefined,
          interrupt: () => undefined,
        })
      },
    })

    let team: TeamService | undefined
    let failure: unknown
    root.plugin({
      name: 'dsh-agents-row',
      inject: [...inject],
      apply(row: Context) {
        try {
          void TeamService.create(row).then((service) => { team = service }, (error: unknown) => { failure = error })
        } catch (error) {
          failure = error
        }
      },
    })

    // The mount's own output is the projection registration, so wait on that
    // condition - bounded, so a regressed mount fails here instead of hanging -
    // rather than on a fixed wall-clock delay.
    await vi.waitFor(() => {
      expect(projections).toHaveLength(1)
    })

    expect(failure).toBeUndefined()
    const instance = team
    if (instance === undefined) throw new Error('the row fiber never constructed the Team service')
    // The constructor's real output is asserted, not merely its existence.
    expect(instance).toBeInstanceOf(TeamService)
    expect(projections).toEqual([{ key: 'agentTeam', stateVersion: 4 }])
    expect(instance.membership(lead).role).toBe('lead')
  })

  it('operator applies the row without a second registration when a real cordis sibling already provided agentTeams', async () => {
    // Given a real cordis tree whose sibling fiber registered agentTeams before this row, When the row's apply runs, Then it completes instead of throwing cordis' duplicate-service error, registers no fork projection, and leaves the sibling's service in place.
    const root = new Context()
    const projections: Projection[] = []
    const routes: string[] = []
    const official = { tryMembership: () => undefined, listMembers: () => [] }

    root.plugin({
      name: 'fake-official-agent-teams',
      apply(provider: Context) {
        provider.provide('agentTeams', official)
      },
    })
    root.plugin({
      name: 'fake-host-services',
      apply(provider: Context) {
        provider.provide('systemPrompt', {
          section: () => () => undefined,
          context: () => () => undefined,
          getSectionOrder: () => 0,
          getContextOrder: () => 0,
        })
        provider.provide('typertGateway', {})
        provider.provide('webServer', {
          register: (route: { path: string }): (() => void) => {
            routes.push(route.path)
            return () => undefined
          },
        })
        provider.provide('agents', { get: () => undefined, list: () => [] })
        provider.provide('sessions', { get: () => undefined, flush: async () => undefined })
        provider.provide('sessionPersistence', { open: async () => undefined })
        provider.provide('sessionProjections', {
          register: async (definition: Projection) => {
            projections.push({ key: definition.key, stateVersion: definition.stateVersion })
            return { stateOf: () => ({}) }
          },
        })
        provider.provide('subagents', {
          startActivation: async () => undefined,
          drainChildren: async () => undefined,
          interrupt: () => undefined,
        })
      },
    })

    let applied = false
    let failure: unknown
    root.plugin({
      name: 'dsh-agents-row',
      inject: [...inject],
      apply(row: Context) {
        try {
          apply(row, { enabled: true })
          applied = true
        } catch (error) {
          failure = error
        }
      },
    })

    // The routes are the row's own output, so wait on them rather than on a
    // fixed delay; a row that never applied fails here instead of hanging.
    await vi.waitFor(() => {
      expect(routes).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    })

    expect(failure).toBeUndefined()
    expect(applied).toBe(true)
    // cordis would have rejected the fork's own provide() of this name, so an
    // empty projection list and the untouched identity are the coexistence.
    expect(projections).toEqual([])
    expect(root.get('agentTeams')).toBe(official)
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
