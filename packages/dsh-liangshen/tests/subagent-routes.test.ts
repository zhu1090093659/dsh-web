import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EXPLICIT_TOOLS,
  DEFAULT_INHERIT_TOOLS,
  POLICY_EVENT,
  apply,
  authorizedRoutesFor,
  delegationDenialReason,
  delegationModeOf,
  inheritedRouteOf,
  inject,
  installSubagentRoutes,
  name,
  namedRouteOf,
  parseAllowedRoutes,
  policyRoutesOf,
  routeParameterProbe,
  routesInclude,
} from '../presets/liangshen/subagent-routes.mjs'

const ROUTES = [{ provider: 'alpha', model: 'a1' }, { provider: 'beta', model: 'b1' }]
const PARENT_ROUTE = { provider: 'alpha', model: 'a1' }
const OFF_LIST_ROUTE = { provider: 'gamma', model: 'g1' }

/** A session whose durable log carries one policy event. */
function policedSession(routes = ROUTES) {
  return { events: [{ type: POLICY_EVENT, data: { allowedModels: routes } }] }
}

/** A session that recorded no policy at all. */
function unpolicedSession() {
  return { events: [{ type: 'plan/mode', data: { mode: 'off' } }] }
}

/** An agent running on one route, optionally with a request header. */
function agentAt(route, session = policedSession()) {
  return { session, options: route, headerRoute: undefined }
}

/** An agent whose latest request header owns the route. */
function agentWithHeader(route, session = policedSession()) {
  return {
    session: { ...session, requestHeader: () => ({ config: route }) },
    options: OFF_LIST_ROUTE,
  }
}

/** The argument bag a model sends to a delegation tool. */
function callArgs(route) {
  return route === undefined ? {} : { provider: route.provider, model: route.model }
}

describe('liangshen-subagent-routes', () => {
  it('operator sees the plugin register under its loader name', () => {
    // Given the preset row, When the plugin loads, Then it carries the name the
    // loader reports and polices the shipped tool names.
    expect(name).toBe('liangshen-subagent-routes')
    // The row reads `ctx.tools`, so it must declare that service: an undeclared
    // read throws "cannot get property \"tools\" without inject" and fails the
    // preset's own load audit instead of installing the guard.
    expect(inject).toEqual(['tools'])
    expect(DEFAULT_EXPLICIT_TOOLS).toEqual(['subagent'])
    // The harness dropped the legacy Agent Teams tool, so the fork is the only
    // inherit-mode row this guard polices.
    expect(DEFAULT_INHERIT_TOOLS).toEqual(['subagent_fork'])
  })

  it('operator parses only a well-formed allowedModels payload', () => {
    // Given policy payloads, When they are parsed, Then a complete route list
    // survives, an empty list is a recorded list, and any malformed entry
    // invalidates the payload instead of authorizing half of it.
    expect(parseAllowedRoutes({ allowedModels: ROUTES })).toEqual(ROUTES)
    expect(parseAllowedRoutes({ allowedModels: [] })).toEqual([])
    expect(parseAllowedRoutes({ allowedModels: [{ provider: 'alpha' }] })).toBeUndefined()
    expect(parseAllowedRoutes({ allowedModels: [null] })).toBeUndefined()
    expect(parseAllowedRoutes(undefined)).toBeUndefined()
  })

  it('operator reads the policy from either durable log shape', () => {
    // Given a policy event, When the log is read through the events array and
    // through the seq reader, Then both report the same routes.
    expect(policyRoutesOf(policedSession())).toEqual(ROUTES)
    const bySeq = {
      eventAt: (seq: number) => [{ type: 'turn/start', data: {} }, { type: POLICY_EVENT, data: { allowedModels: ROUTES } }][seq],
    }
    expect(policyRoutesOf(bySeq)).toEqual(ROUTES)
    // Then: a session without the event recorded no policy.
    expect(policyRoutesOf(unpolicedSession())).toBeUndefined()
    expect(policyRoutesOf({})).toBeUndefined()
  })

  it('operator inherits the nearest ancestor allowlist through the delegation chain', () => {
    // Given a child session created by a delegation, When the guard resolves its
    // policy, Then it walks to the parent that recorded one.
    const parent = policedSession()
    const child = { events: [], header: { origin: 'subagent', parentSession: 'parent-1' } }
    const sessions = { get: (id: string) => (id === 'parent-1' ? parent : undefined) }
    expect(authorizedRoutesFor({ session: child }, sessions)).toEqual(ROUTES)
    // Then: a session recorded without a delegation origin ends the walk.
    const unrelated = { events: [], header: { origin: 'user', parentSession: 'parent-1' } }
    expect(authorizedRoutesFor({ session: unrelated }, sessions)).toBeUndefined()
    // Then: without a session registry the guard cannot answer, so it does not guess.
    expect(authorizedRoutesFor({ session: child }, undefined)).toBeUndefined()
  })

  it('operator reads the inherited route from the header before the creation options', () => {
    // Given a mid-session model switch, When the inherited route is read, Then
    // the request header owns it and the stale creation options do not.
    expect(inheritedRouteOf(agentWithHeader(OFF_LIST_ROUTE))).toEqual({ ...OFF_LIST_ROUTE, reasoningEffort: undefined })
    // Then: before the first request the creation options decide.
    expect(inheritedRouteOf(agentAt(PARENT_ROUTE))).toEqual({ ...PARENT_ROUTE, reasoningEffort: undefined })
    // Then: a header naming no route says nothing, so the options still decide.
    const headerless = { session: { requestHeader: () => ({ config: {} }) }, options: PARENT_ROUTE }
    expect(inheritedRouteOf(headerless).provider).toBe(PARENT_ROUTE.provider)
  })

  it('operator leaves every delegation alone while no policy was recorded', () => {
    // Given an unpoliced session, When each delegation shape is checked, Then
    // nothing is denied: an unrecorded policy is not an empty allowlist.
    const agent = agentAt(OFF_LIST_ROUTE, unpolicedSession())
    for (const toolName of ['subagent', 'subagent_fork']) {
      expect(delegationDenialReason({ agent, toolName, args: {}, sessions: undefined })).toBeUndefined()
    }
    expect(delegationDenialReason({ agent, toolName: 'read', args: {}, sessions: undefined })).toBeUndefined()
  })

  it('operator forks on the inherited route while it is authorized', () => {
    // Given a policy that authorizes the caller's own route, When a fork names
    // no route, Then it runs: the guard polices the route, not the tool.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent_fork', args: {}, sessions: undefined,
    })).toBeUndefined()
  })

  it('operator cannot fork away from an unauthorized inherited route', () => {
    // Given a policy that excludes the caller's route, When a fork names no
    // route, Then it is refused with the routes that would work, because its
    // child cannot be re-routed by any argument.
    const denial = delegationDenialReason({
      agent: agentAt(OFF_LIST_ROUTE), toolName: 'subagent_fork', args: {}, sessions: undefined,
    })
    expect(denial).toContain('"gamma/g1"')
    expect(denial).toContain('cannot be re-routed')
    expect(denial).toContain('"alpha/a1"')
  })

  it('operator cannot name a route on a fork', () => {
    // Given an authorized inherited route, When a fork call tries to name a
    // route anyway, Then the override attempt is refused: the tool exists to
    // keep the child on the caller's route.
    const denial = delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent_fork', args: callArgs(ROUTES[1]), sessions: undefined,
    })
    expect(denial).toContain('cannot be selected through it')
    expect(denial).toContain('"beta/b1"')
  })

  it('operator must name an authorized pair on an explicit delegation tool', () => {
    // Given a policy, When the explicit tool is called bare, Then the child
    // would inherit the caller's route and the denial says which pair to send.
    const bare = delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: {}, sessions: undefined,
    })
    expect(bare).toContain('names no provider or model')
    expect(bare).toContain('"alpha/a1"')
    // Then: a half pair is diagnosed as such instead of being completed silently.
    const half = delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: { provider: 'alpha' }, sessions: undefined,
    })
    expect(half).toContain('names only provider')
    // Then: an off-list pair is refused, and an on-list pair runs.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: callArgs(OFF_LIST_ROUTE), sessions: undefined,
    })).toContain('is not on the Session allowlist')
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: callArgs(ROUTES[1]), sessions: undefined,
    })).toBeUndefined()
  })

  it('operator sees a tool mounted without route fields policed through the inherited route', () => {
    // Given a composition that mounted the delegation tool with neither route
    // field, When it is called, Then the guard polices the inherited route
    // instead of demanding a pair the tool cannot accept.
    const denial = delegationDenialReason({
      agent: agentAt(OFF_LIST_ROUTE), toolName: 'subagent', args: {}, sessions: undefined,
      probe: () => false,
    })
    expect(denial).toContain('cannot be re-routed')
    // Then: an authorized inherited route passes through the same branch.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: {}, sessions: undefined, probe: () => false,
    })).toBeUndefined()
    // Then: an unreadable probe keeps the configured mode, which asks for a pair.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: {}, sessions: undefined, probe: () => undefined,
    })).toContain('names no provider or model')
  })

  it('operator keeps a complete authorized pair even when the probe reports no route fields', () => {
    // Given a registry view that cannot see this preset's delegation registration
    // (the probe answers false), When the call names an authorized pair, Then the
    // pair still runs — a denial there is one no call could satisfy.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: callArgs(PARENT_ROUTE), sessions: undefined,
      probe: () => false,
    })).toBeUndefined()
    // Then: an off-list pair is refused for being off-list, not for its shape.
    expect(delegationDenialReason({
      agent: agentAt(PARENT_ROUTE), toolName: 'subagent', args: callArgs(OFF_LIST_ROUTE), sessions: undefined,
      probe: () => false,
    })).toContain('is not on the Session allowlist')
  })

  it('operator sees an empty recorded allowlist refuse every delegation', () => {
    // Given a recorded but empty list, When a delegation runs, Then nothing is
    // authorized and the denial says so rather than reading as "no policy".
    const agent = agentAt(PARENT_ROUTE, policedSession([]))
    const denial = delegationDenialReason({ agent, toolName: 'subagent', args: callArgs(PARENT_ROUTE), sessions: undefined })
    expect(denial).toContain('the Session allowlist is empty')
    expect(delegationDenialReason({ agent, toolName: 'subagent_fork', args: {}, sessions: undefined }))
      .toContain('the Session allowlist is empty')
  })

  it('operator gets the tool name, route pair and mode read off the shipped shapes', () => {
    // Given the shipped defaults, When the helpers are exercised, Then the mode
    // map, the named route and the membership test agree with them.
    expect(delegationModeOf('subagent', DEFAULT_EXPLICIT_TOOLS, DEFAULT_INHERIT_TOOLS)).toBe('explicit')
    expect(delegationModeOf('subagent_fork', DEFAULT_EXPLICIT_TOOLS, DEFAULT_INHERIT_TOOLS)).toBe('inherit')
    expect(delegationModeOf('read', DEFAULT_EXPLICIT_TOOLS, DEFAULT_INHERIT_TOOLS)).toBeUndefined()
    // Then: a name the roster no longer carries is policed in no mode at all,
    // so a tool the harness removed cannot revive an inherit-mode denial.
    expect(delegationModeOf('spawn_teammate', DEFAULT_EXPLICIT_TOOLS, DEFAULT_INHERIT_TOOLS)).toBeUndefined()
    expect(namedRouteOf({ provider: 'alpha', model: 'a1' })).toEqual({ provider: 'alpha', model: 'a1' })
    expect(namedRouteOf(undefined)).toEqual({ provider: undefined, model: undefined })
    expect(routesInclude(ROUTES, 'alpha', 'a1')).toBe(true)
    expect(routesInclude(ROUTES, 'alpha', 'a2')).toBe(false)
  })

  it('operator gets the guard registered only where the registry exposes the seam', () => {
    // Given a context with the guard seam, When the row mounts, Then one guard
    // is registered and it denies an unauthorized delegation.
    const registered: ((exec: unknown) => string | undefined)[] = []
    const tools = {
      guard: (fn: (exec: unknown) => string | undefined) => { registered.push(fn); return () => { registered.pop() } },
      definitions: () => [{ name: 'subagent', parameters: { provider: {}, model: {}, prompt: {} } }],
    }
    const ctx = {
      tools, get: (key: string) => (key === 'sessions' ? { get: () => undefined } : undefined),
      effect: (fn: () => () => void) => { fn() },
    }
    apply(ctx, {})
    expect(registered).toHaveLength(1)
    expect(registered[0]({ name: 'read', arguments: {} })).toBeUndefined()
    expect(registered[0]({ name: 'subagent', arguments: {}, agent: agentAt(OFF_LIST_ROUTE) }))
      .toContain('names no provider or model')
    // Then: a context without the seam keeps the harness behavior instead of throwing.
    expect(installSubagentRoutes({})).toBeUndefined()
    expect(routeParameterProbe({ definitions: () => [] }, undefined, 'subagent')).toBeUndefined()
  })

  /** A real cordis tree whose `tools` service a SIBLING fiber provides, as the host does. */
  function treeWithSiblingRegistry(): { root: Context; registered: unknown[] } {
    const root = new Context()
    const registered: unknown[] = []
    root.plugin({
      name: 'host-tools',
      apply(provider) {
        provider.provide('tools' as never, {
          guard: (fn: unknown) => { registered.push(fn); return () => undefined },
        } as never)
      },
    })
    return { root, registered }
  }

  it('operator gets the guard installed on a real cordis tree, and no guard from a row without the declaration', async () => {
    // Given a real cordis tree whose `tools` service is provided by a sibling
    // fiber, When the row mounts with its declared `inject`, Then it reads the
    // registry and installs the guard.
    const declared = treeWithSiblingRegistry()
    declared.root.plugin({ name, inject, apply })
    await vi.waitFor(() => { expect(declared.registered).toHaveLength(1) })

    // Then the very same row WITHOUT the declaration never installs a guard:
    // cordis refuses the read at the fiber boundary, which is the exact error
    // the preset's load audit reported before the declaration existed
    // (2026-10-26).
    const undeclared = treeWithSiblingRegistry()
    const errors: unknown[] = []
    ;(undeclared.root as unknown as { logger: unknown }).logger = {
      error: (error: unknown) => { errors.push(error) },
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    }
    undeclared.root.plugin({ name: `${name}-undeclared`, apply })
    await vi.waitFor(() => {
      expect(errors.map(String).join('\n')).toContain('cannot get property "tools" without inject')
    })
    expect(undeclared.registered).toHaveLength(0)
  })

  it('operator can switch the guard off from the row configuration', () => {
    // Given the row switched off, When the preset mounts it, Then no guard is
    // registered at all.
    let calls = 0
    const ctx = {
      tools: { guard: () => { calls += 1; return () => undefined } },
      effect: (fn: () => () => void) => { fn() },
    }
    apply(ctx, { enabled: false })
    expect(calls).toBe(0)
  })
})
