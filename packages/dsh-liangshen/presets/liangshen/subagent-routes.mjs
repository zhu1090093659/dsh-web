/**
 * subagent-routes — the LiangShen preset's authorization guard for delegated
 * child routes.
 *
 * The harness records a Session's authorized child routes as a durable
 * `subagent/model-selection-policy` event, but its own delegation tool only
 * rejects an EXPLICIT route outside that list: a call that names no
 * `provider`/`model` falls back to the configured child defaults or to the
 * parent's own route. A session whose allowlist authorizes only one family
 * would therefore still spawn children on the parent's route simply because
 * nobody named one — or, for `subagent_fork`, because the tool cannot name one
 * at all.
 *
 * This row closes that gap from the preset plane. Whenever the calling Session
 * (or the nearest ancestor that recorded one) carries an allowlist, every
 * delegation the row polices must resolve to an authorized route:
 *
 * - `explicit` tools publish `provider`/`model`; the call must name a complete
 *   pair, and that pair must be on the list;
 * - `inherit` tools publish neither and start the child on the caller's own
 *   route; the guard forbids a route override there and checks the inherited
 *   route against the same list, because "the tool cannot choose" is not the
 *   same as "the choice is authorized".
 *
 * The mode a tool is policed in is configuration, but its PARAMETERS are a
 * runtime fact: a composition written for an older cohort mounts the tool with
 * neither route field, and demanding a pair from it would be a denial no call
 * could satisfy. The guard therefore asks the registry which fields the tool
 * actually declares, and enforces such a tool through the route its child
 * would inherit.
 *
 * The guard is deliberately fail-open on every fact it cannot read (no policy
 * event, no session registry, no registry probe): a delegation the harness can
 * resolve is never blocked by a missing observation, and the row only ever
 * adds a denial it can justify from the durable log.
 */

// The session log is read through the preset's shared reader: an unreadable log
// reads as empty here exactly as it does in every other fold of this preset.
import { sessionEvents } from './paging.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-subagent-routes'

/**
 * Services this row reads.
 *
 * A preset row runs in its own fiber, where a service it does not declare is
 * not readable at all: `ctx.tools` against an undeclared `tools` throws
 * "cannot get property \"tools\" without inject" and fails the preset's load
 * audit. The guard reads the registry for its `guard` seam and its `definitions`
 * probe, so declaring it is what lets the row mount and stay mounted.
 */
export const inject = ['tools']

/** Durable event carrying a Session's authorized child routes. */
export const POLICY_EVENT = 'subagent/model-selection-policy'

/** Delegation tools whose calls must name an authorized route pair. */
export const DEFAULT_EXPLICIT_TOOLS = ['subagent']

/**
 * Delegation tools that start their child on the caller's own route.
 * `subagent_fork` is the only one: it publishes no route fields at all, so
 * policing it as an explicit tool would demand a pair no call could name and
 * deny every delegation.
 */
export const DEFAULT_INHERIT_TOOLS = ['subagent_fork']

/** How far the policy lookup follows the Session chain before giving up. */
export const MAX_ANCESTOR_DEPTH = 8

/** How many early events one Session is scanned for its policy event. */
export const MAX_POLICY_SCAN = 256

/** Read one value as a non-empty string. */
function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one value as a plain record. */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/**
 * Parse the `allowedModels` payload of one policy event.
 * @param data - Raw event payload.
 * @returns the authorized routes, or undefined when the payload is malformed.
 */
export function parseAllowedRoutes(data) {
  const record = asRecord(data)
  if (record === undefined) return undefined
  const entries = record['allowedModels']
  if (!Array.isArray(entries)) return undefined
  const routes = []
  for (const entry of entries) {
    const route = asRecord(entry)
    const provider = asString(route?.['provider'])
    const model = asString(route?.['model'])
    if (provider === undefined || model === undefined) return undefined
    routes.push({ provider, model })
  }
  return routes
}

/**
 * The authorized routes a session recorded, if any.
 *
 * The policy is appended before the Session's first model request, so the scan
 * stays short; the bound keeps a Session without one from walking its whole
 * log. Both the durable `eventAt(seq)` reader and a plain events array are
 * accepted, because the row may run against a Host that exposes only one. An
 * unreadable log reads as "no policy recorded", which is the fail-open answer.
 * @param session - Session-like record.
 * @returns the recorded routes, or undefined when this Session recorded none.
 */
export function policyRoutesOf(session) {
  if (session === undefined || session === null) return undefined
  if (typeof session.eventAt === 'function') {
    for (let seq = 0; seq < MAX_POLICY_SCAN; seq += 1) {
      let event
      try {
        event = session.eventAt(seq)
      } catch {
        return undefined
      }
      if (event === undefined) return undefined
      if (event?.type !== POLICY_EVENT) continue
      const routes = parseAllowedRoutes(event.data)
      if (routes !== undefined) return routes
    }
    return undefined
  }
  for (const event of sessionEvents(session).slice(0, MAX_POLICY_SCAN)) {
    if (event?.type !== POLICY_EVENT) continue
    const routes = parseAllowedRoutes(event.data)
    if (routes !== undefined) return routes
  }
  return undefined
}

/**
 * Resolve the allowlist a delegation from this agent must respect: the agent's
 * own recorded policy, else the nearest ancestor Session that recorded one.
 *
 * The walk only crosses parent links that the delegation seam itself created
 * (`origin: subagent`), so an unrelated parent Session cannot impose a list on
 * a delegation it does not own.
 * @param agent - Calling agent.
 * @param sessions - Session registry, when the Host exposes one.
 * @returns the authorized routes, or undefined when no Session recorded any.
 */
export function authorizedRoutesFor(agent, sessions) {
  let session = agent?.session
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && session !== undefined; depth += 1) {
    const recorded = policyRoutesOf(session)
    if (recorded !== undefined) return recorded
    const header = asRecord(session?.header)
    if (header?.['origin'] !== 'subagent') return undefined
    const parentId = asString(header['parentSession'])
    if (parentId === undefined || typeof sessions?.get !== 'function') return undefined
    try {
      session = sessions.get(parentId)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * The route an inherit-mode child would run on: the caller's own effective
 * request route. The latest request header owns it after a mid-session model
 * switch, with the creation options as the fallback before the first request.
 * @param agent - Calling agent.
 * @returns the inherited route fields, each absent when its source omitted it.
 */
export function inheritedRouteOf(agent) {
  let header
  try {
    header = typeof agent?.session?.requestHeader === 'function' ? agent.session.requestHeader() : undefined
  } catch {
    header = undefined
  }
  const config = asRecord(header?.config)
  const provider = asString(config?.['provider'])
  const model = asString(config?.['model'])
  if (provider !== undefined || model !== undefined) {
    return { provider, model, reasoningEffort: asString(config?.['reasoningEffort']) }
  }
  return { provider: asString(agent?.options?.provider), model: asString(agent?.options?.model) }
}

/** Whether one route is on an allowlist. */
export function routesInclude(routes, provider, model) {
  return (Array.isArray(routes) ? routes : [])
    .some(route => route.provider === provider && route.model === model)
}

/** Render an allowlist for a denial reason. */
export function authorizedRoutesText(routes) {
  const list = Array.isArray(routes) ? routes : []
  if (list.length === 0) return 'no route is authorized (the Session allowlist is empty)'
  return list.map(route => `"${route.provider}/${route.model}"`).join(', ')
}

/** The route pair one delegation call named, each half possibly absent. */
export function namedRouteOf(args) {
  const record = asRecord(args) ?? {}
  return { provider: asString(record['provider']), model: asString(record['model']) }
}

/** How one delegation tool resolves the child route this guard authorizes. */
export function delegationModeOf(toolName, explicitToolNames, inheritToolNames) {
  if ((Array.isArray(inheritToolNames) ? inheritToolNames : []).includes(toolName)) return 'inherit'
  if ((Array.isArray(explicitToolNames) ? explicitToolNames : DEFAULT_EXPLICIT_TOOLS).includes(toolName)) return 'explicit'
  return undefined
}

/**
 * Ask the tool registry whether one delegation tool currently declares the
 * route fields. The answer is read per call: an HMR replacement or a preset
 * change can remount the tool, and a stale answer would put the guard back on
 * the branch no call can satisfy.
 * @param tools - Tool registry from the Host context.
 * @param agent - Calling agent, whose scope selects the visible definitions.
 * @param toolName - Tool being dispatched.
 * @returns whether the tool declares a route field, or undefined when the
 *   registry cannot answer (which keeps the configured mode in charge).
 */
export function routeParameterProbe(tools, agent, toolName) {
  if (typeof tools?.definitions !== 'function') return undefined
  let definitions
  try {
    definitions = tools.definitions(agent)
  } catch {
    return undefined
  }
  const definition = (Array.isArray(definitions) ? definitions : []).find(entry => entry?.name === toolName)
  const parameters = asRecord(definition?.parameters)
  if (parameters === undefined) return undefined
  return parameters['provider'] !== undefined || parameters['model'] !== undefined
}

/** Denial reason for a delegation that named a route on an inherit-only tool. */
export function overrideReason(toolName, provider, model, allowed) {
  return `subagent model selection: "${toolName}" keeps its child on the calling agent's route and has no provider/model fields, `
    + `so the route "${provider}/${model}" cannot be selected through it. Use a delegation tool that exposes `
    + `provider and model and pass one of ${authorizedRoutesText(allowed)}.`
}

/** Denial reason for a delegation whose inherited route is unauthorized. */
export function inheritedReason(toolName, inherited, allowed) {
  const route = inherited.provider === undefined || inherited.model === undefined
    ? 'the calling agent\'s route'
    : `"${inherited.provider}/${inherited.model}"`
  return `subagent model selection: "${toolName}" keeps its child on ${route}, which this Session's allowlist `
    + `does not authorize, so it is unavailable for now. Its child cannot be re-routed, so either delegate through a `
    + `tool that exposes provider and model — passing one of ${authorizedRoutesText(allowed)} — or continue on an `
    + `authorized model for this Session, after which "${toolName}" works again.`
}

/**
 * The denial for a delegation that would inherit the caller's route, or
 * undefined when that route is authorized (or cannot be read at all — a route
 * the guard cannot resolve is left to the harness rather than guessed).
 * @param agent - Calling agent whose route the child inherits.
 * @param toolName - Tool being dispatched.
 * @param allowed - Routes the calling Session authorizes.
 * @returns a denial reason, or undefined when the inherited route is allowed.
 */
export function inheritedRouteDenial(agent, toolName, allowed) {
  const inherited = inheritedRouteOf(agent)
  if (inherited.provider !== undefined && inherited.model !== undefined
    && routesInclude(allowed, inherited.provider, inherited.model)) return undefined
  return inheritedReason(toolName, inherited, allowed)
}

/** Denial reason for an explicit tool whose call named no complete pair. */
export function missingPairReason(toolName, named, inherited, allowed) {
  const half = named.provider === undefined && named.model === undefined
    ? 'names no provider or model'
    : `names only ${named.provider === undefined ? 'model' : 'provider'}`
  return `subagent model selection: the call to "${toolName}" ${half}, so the child would run on `
    + `${inherited.provider === undefined || inherited.model === undefined ? 'the parent route' : `"${inherited.provider}/${inherited.model}"`}, `
    + `which this Session's allowlist does not authorize. Pass an authorized provider and model — ${authorizedRoutesText(allowed)} — `
    + `with an optional reasoning_effort.`
}

/** Denial reason for a call that named a route outside the allowlist. */
export function unauthorizedReason(toolName, provider, model, allowed) {
  return `subagent model selection: the model this call to "${toolName}" selected ("${provider}/${model}") is not on the `
    + `Session allowlist. Pass an authorized provider and model — ${authorizedRoutesText(allowed)} — with an optional reasoning_effort.`
}

/**
 * Decide whether one delegation call must be refused.
 *
 * Every unreadable fact resolves to "no opinion": an absent policy event, an
 * absent session registry, or a registry that cannot name the tool's fields all
 * leave the call to the harness.
 * @param input - Calling agent, tool name, arguments, and policy sources.
 * @returns a denial reason, or undefined to leave the call untouched.
 */
export function delegationDenialReason(input) {
  const {
    agent, toolName, args, sessions,
    explicitToolNames = DEFAULT_EXPLICIT_TOOLS,
    inheritToolNames = DEFAULT_INHERIT_TOOLS,
    probe,
  } = input ?? {}
  const mode = delegationModeOf(toolName, explicitToolNames, inheritToolNames)
  if (mode === undefined) return undefined
  const allowed = authorizedRoutesFor(agent, sessions)
  if (allowed === undefined) return undefined
  const named = namedRouteOf(args)
  const complete = named.provider !== undefined && named.model !== undefined
  if (mode === 'inherit') {
    // A named pair can only be an attempt to re-route the child away from the
    // route the tool exists to preserve: the more precise diagnostic comes first.
    if (complete) return overrideReason(toolName, named.provider, named.model, allowed)
    return inheritedRouteDenial(agent, toolName, allowed)
  }
  // A tool mounted without route fields cannot be handed the pair a policy
  // expects, so it is policed through the route its child would inherit.
  //
  // A COMPLETE pair is never reclassified here. The probe resolves the registry
  // view from the call, which can be a scope that does not carry this preset's
  // delegation registration, so it can answer "no route fields" for a tool the
  // model was in fact shown WITH them. Denying the pair there produced a denial
  // no call could satisfy and made every routed dispatch impossible. The pair
  // still faces the allowlist check below, so this branch can only soften an
  // impossible denial — never an authorization.
  const declares = probe?.(agent, toolName)
  if (declares === false) {
    // A bare or half-named call keeps the old behaviour: police the route the
    // child would inherit. Only the COMPLETE pair falls through.
    if (!complete) return inheritedRouteDenial(agent, toolName, allowed)
  }
  if (!complete) return missingPairReason(toolName, named, inheritedRouteOf(agent), allowed)
  if (!routesInclude(allowed, named.provider, named.model)) {
    return unauthorizedReason(toolName, named.provider, named.model, allowed)
  }
  return undefined
}

/**
 * Install the guard for the calling scope.
 * @param ctx - Host context carrying the tool registry (and optionally sessions).
 * @param config - Row configuration.
 * @returns a disposer that removes the guard, or undefined when the scope has
 *   no tool registry to guard.
 */
export function installSubagentRoutes(ctx, config = {}) {
  const tools = ctx?.tools
  if (typeof tools?.guard !== 'function') return undefined
  const explicitToolNames = Array.isArray(config.explicitTools) ? config.explicitTools : DEFAULT_EXPLICIT_TOOLS
  const inheritToolNames = Array.isArray(config.inheritTools) ? config.inheritTools : DEFAULT_INHERIT_TOOLS
  const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
  return tools.guard(execution => delegationDenialReason({
    agent: execution?.agent,
    toolName: execution?.name,
    args: execution?.arguments,
    sessions,
    explicitToolNames,
    inheritToolNames,
    probe: (agent, toolName) => routeParameterProbe(tools, agent, toolName),
  }))
}

/**
 * Mount the row: register the guard for this scope, with an off switch.
 * @param ctx - Cordis context of the composing scope.
 * @param config - Row configuration; omitted fields select the shipped names.
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  ctx.effect(() => {
    const dispose = installSubagentRoutes(ctx, config)
    // A Host without the guard seam keeps the harness's own delegation behavior
    // instead of failing the preset's load.
    return dispose ?? (() => undefined)
  }, 'liangshen: subagent route guard')
}
