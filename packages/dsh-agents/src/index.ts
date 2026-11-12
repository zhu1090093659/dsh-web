/**
 * Host entry of the dsh-agents plugin: one ledger, the seven squad routes, the
 * member-brief section, the squad context that tells a Lead who exists, the
 * model-facing squad tools with their announcement, and the forked Agent Teams
 * runtime that makes a squad run real.
 *
 * This file wires faces the Host already serves; every rule it depends on lives
 * beside it — the ledger in host/ledger.ts, the definition/run seam in
 * host/run-gateway.ts, the launch order in host/service.ts, the squad-run gate
 * and Lead context in host/squad.ts, the fence and the wire in host/routes.ts and
 * protocol.ts, the tool surface in host/agent-tools.ts, the injection decision in
 * host/member-prompt.ts (evidence in docs/member-prompt.md), and the fork itself
 * in team/ and tools/ (provenance in docs/fork-provenance.md).
 *
 * @module @linxin666/dsh-agents
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AGENTS_TOOL_GUIDANCE, AGENTS_TOOL_NAMES, buildAgentsTools } from './host/agent-tools.ts'
import { createLlmSquadDescriber } from './host/describe.ts'
import { agentsHomeDirectory } from './host/home.ts'
import { assembleIdentity, registerMemberPromptSeam, type MemberPromptRegistry } from './host/member-prompt.ts'
import { makeAgentsRoutes } from './host/routes.ts'
import { createHostRunGateway, createTeammatePins, type CommandDispatcherFace, type TypertGatewayFace, type WorkspaceRegistryFace } from './host/run-gateway.ts'
import { AgentsHostService } from './host/service.ts'
import { readService } from './host/services.ts'
import { TEAM_IDENTITY_CONTEXT_ORDER, TeamService, type TeamServiceContext } from './team/index.ts'
import { installTeamTools, type TeamToolInstallation } from './tools/index.ts'
import { PLUGIN_TOOL_SECTION_ORDERS, visibleToolText } from './tool-surface.ts'

/** Services this row needs before it mounts. The workspace registry, command dispatcher and agent registry are resolved optionally: a deployment that lacks one still mounts, and a run that needs the missing face fails closed with a named code. The Team runtime faces are optional for the same reason — M1's ledger, routes and member brief keep working without them. */
export const inject = ['systemPrompt', 'typertGateway', 'webServer']

/** Plugin row shape. */
export type ConfigInput = {
  /** Master switch: when off, no routes, no tools and no prompt section are registered. */
  enabled?: boolean
  /**
   * Announce the squad tool surface to every agent through one system-prompt
   * section. Off by default, so an agent learns about the surface when the user
   * asks for it rather than from every prompt.
   */
  announceToAgent?: boolean
}

/** One resolved config field: a live reference (a volatile field), or a plain value from a hand-built context. */
type ConfigField<T> = Volatile<T> | T

/** Resolved plugin configuration. */
export interface Config {
  enabled?: ConfigField<boolean>
  announceToAgent?: ConfigField<boolean>
}

/**
 * Schema of the row; the loader validates a profile patch against it.
 *
 * `enabled` stays an ordinary field on purpose: this row's mount and its ledger
 * lifetime are one decision, so switching it off reloads the row instead of
 * leaving routes registered over a disabled plugin. `announceToAgent` is
 * volatile, which is what puts it on the settings page and lets a commit reach
 * the running fiber.
 */
export const Config: z<ConfigInput, Config> = z.object({
  enabled: z.boolean().default(true).description('Mount the agent squad ledger, its routes, the member-brief section, the squad tools, and the forked Agent Teams runtime.'),
  announceToAgent: z.boolean().default(false).volatile().description('Announce the squad tool surface to every agent through one system-prompt section. The section names only the tools this session can really see.'),
})

/** Schema default, re-read for hand-built test contexts. */
export const DEFAULT_ENABLED = true

/** Schema default of the announcement switch, re-read for hand-built test contexts. */
export const DEFAULT_ANNOUNCE_TO_AGENT = false

/**
 * Read one config field's current value.
 *
 * A volatile field travels as a stable reference the Loader commits in place, so
 * a live value must be read at use time instead of captured when the plugin
 * activates; a plain value (a programmatic mount, or an ordinary field) is
 * returned as it stands.
 * @param field - the config field as the Host handed it.
 * @param fallback - value to use when the field is absent.
 * @returns the effective field value.
 */
function readConfigField<T>(field: ConfigField<T> | undefined, fallback: T): T {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof (field as { get?: unknown }).get === 'function') {
    return (field as Volatile<T>).get() as T
  }
  return field as T
}

/** The directory the ledger and its owner lock live in. */
export { agentsHomeDirectory }

/** System-prompt context name that carries the squad roster and goal to a Lead. */
export const SQUAD_CONTEXT_NAME = 'team:squad'

/** System-prompt section that announces the squad tool surface to every agent. */
export const AGENTS_TOOL_SECTION_NAME = 'plugin:agents'

/** The system-prompt registry face the squad context needs. */
export interface SquadContextRegistry {
  /** Register one ordered dynamic context; the returned function disposes it. */
  context(context: {
    name: string
    order: number
    required?: boolean
    text: (context: never) => string
  }): () => void
}

/** The system-prompt registry face, narrowed to the one method this plugin calls. */
function resolveSystemPrompt(ctx: Context): MemberPromptRegistry | undefined {
  return (ctx as { systemPrompt?: MemberPromptRegistry }).systemPrompt
}

/**
 * Read the optional workspace registry. The Host serves it as a cordis service;
 * a capture-only test context or a stripped deployment simply has none.
 *
 * Read per call, like {@link resolveLlm}: the official registry's
 * `[Service.init]` is asynchronous and finishes after this row applies, so a
 * face captured at apply time is undefined for the life of the process.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment serves none yet.
 */
export function resolveWorkspaceRegistry(ctx: Context): WorkspaceRegistryFace | undefined {
  const registry = readService<WorkspaceRegistryFace>(ctx, 'workspaceRegistry')
  return registry !== undefined && typeof registry.list === 'function' ? registry : undefined
}

/**
 * Read the optional command dispatcher, which is how a permission pin reaches a
 * session (the same path the task board's runner uses).
 */
export function resolveCommandDispatcher(ctx: Context): CommandDispatcherFace | undefined {
  const commands = readService<CommandDispatcherFace>(ctx, 'commands', false)
  return commands !== undefined && typeof commands.execute === 'function' ? commands : undefined
}

/**
 * Read the optional model service the description button calls.
 *
 * Resolved per call rather than once: a model provider that activates after
 * this row still answers, and a deployment that serves none keeps mounting with
 * the description route answering `describe-unavailable`.
 * @param ctx - the plugin context.
 * @returns the llm runtime, or undefined when this deployment serves none.
 */
export function resolveLlm(ctx: Context): LlmRuntime | undefined {
  const llm = readService<{ stream?: unknown }>(ctx, 'llm', false)
  return llm !== undefined && typeof llm.stream === 'function' ? llm as unknown as LlmRuntime : undefined
}

/**
 * Read the optional live-agent registry; a permission pin needs the session's
 * live Agent to dispatch `/permission`.
 */
export function resolveAgents(ctx: Context): { get(sessionId: string): Agent | undefined } | undefined {
  const agents = readService<{ get?: unknown }>(ctx, 'agents', false)
  return agents !== undefined && typeof agents.get === 'function' ? agents as { get(sessionId: string): Agent | undefined } : undefined
}

/** The registry face the squad tools register into. */
interface AgentsToolRegistry {
  register(definition: ToolDefinition): () => void
  /** Scoped lookup; present on the real registry, absent on a stub that only registers. */
  get?(name: string, scope?: unknown): unknown
}

/**
 * Read the optional agent-tool registry. Like the workspace registry it is
 * resolved rather than injected: a runtime that serves no registry must still
 * mount the ledger, the routes and the briefs, losing only the tool surface.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment serves none.
 */
export function resolveToolRegistry(ctx: Context): AgentsToolRegistry | undefined {
  const registry = readService<AgentsToolRegistry>(ctx, 'tools')
  return registry !== undefined && typeof registry.register === 'function' ? registry : undefined
}

/**
 * The lookup half of a resolved registry, which is what a prompt section asks
 * before it names a tool. A stub that only registers exposes no lookup, and the
 * guidance then renders unconditionally.
 * @param registry - the resolved registry, when this deployment serves one.
 * @returns the scoped lookup, or undefined when the registry has none.
 */
function lookupOf(registry: AgentsToolRegistry | undefined): { get(name: string, scope?: unknown): unknown } | undefined {
  return registry !== undefined && typeof registry.get === 'function' ? { get: registry.get.bind(registry) } : undefined
}

/** Read the injected typert gateway (the Host's own service call surface). */
function resolveTypertGateway(ctx: Context): TypertGatewayFace | undefined {
  return (ctx as { typertGateway?: TypertGatewayFace }).typertGateway
}

/**
 * Why the forked Agent Teams runtime is, or is not, mounted in this deployment.
 *
 * Neither `host-teams` value is a degradation a cleverer probe could avoid: one
 * service name has one owner, and cordis refuses a second registration with
 * `service "agentTeams" has been registered at <fiber>`. Whichever side loses
 * that race loses its own mount, which is exactly the install/update failure the
 * official Agent Teams bundle exposes - so this row yields in BOTH directions
 * instead of depending on which entry the Loader starts first.
 */
export type TeamRuntimeGate = 'ready' | 'host-teams' | 'host-teams-declared' | 'missing-faces'

/**
 * Published activation units of the official Agent Teams runtime: enabling one
 * of these in a profile is what inserts the rows that provide `agentTeams`.
 *
 * Both generations are listed because both own the same service name. The
 * legacy generation ships as the experimental profile bundle; the current one
 * moved to `packages/team/` upstream and ships the `@deepseek-ai/dsh-agent-team`
 * package (with `@deepseek-ai/dsh-tool-agent-team` for the model-facing tools).
 * The newer names are the forward-compatible half: while the current runtime is
 * composed into the base bundle rather than published as a profile bundle, a
 * profile cannot list it, and the service probe is what catches it.
 */
export const OFFICIAL_TEAMS_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  '@deepseek-ai/dsh-agent-team',
] as const

/** The launcher's profile facts, narrowed to the one field this gate reads. */
interface ProfileBundlesFace {
  readonly startedBundles?: readonly string[]
}

/**
 * Whether this profile mounts the official Agent Teams bundle.
 *
 * The startup bundle list is the only fact that exists before the official row
 * applies, and it is the one that decides the race: entries are composed in
 * `dsh.profile.bundles` order, and a bundle enabled later is appended after
 * this family's, so the official row would be the side that loses the
 * registration. A deployment that cannot answer (no launcher-provided profile
 * context, a bare cordis tree) falls through to the service probe.
 * @param ctx - the plugin context.
 * @returns true when the launcher reports the official bundle among its startup bundles.
 */
export function profileMountsOfficialTeams(ctx: Context): boolean {
  const profile = readService<ProfileBundlesFace>(ctx, 'profileContext', false)
  if (!Array.isArray(profile?.startedBundles)) return false
  if (OFFICIAL_TEAMS_BUNDLES.some(bundle => profile.startedBundles?.includes(bundle) === true)) {
    return true
  }
  // Starting in 0.2.2-rc.2 `@deepseek-ai/dsh-base` embeds `id: agent-team`
  // (`@deepseek-ai/dsh-agent-team`) directly in its own `cordis.patch.yml` and
  // `@deepseek-ai/dsh-subagent` exposes `rootOf(caller)`. Detecting that pair
  // yields even when `dsh-agents` initializes before the base bundle's own
  // `agent-team` row finishes registering `agentTeams`.
  if (profile.startedBundles.includes('@deepseek-ai/dsh-base')) {
    const subagents = readService<{ rootOf?: unknown }>(ctx, 'subagents', false)
    if (typeof subagents?.rootOf === 'function') return true
  }
  return false
}

/**
 * Decide what this deployment gets from the forked runtime.
 * @param ctx - the plugin context.
 * @returns `ready` when this row must mount the fork; `host-teams` when the
 *   deployment already serves an Agent Teams runtime of its own;
 *   `host-teams-declared` when its profile mounts the official bundle that will
 *   provide that service; `missing-faces` when one of the five faces the fork
 *   drives is absent.
 */
export function teamRuntimeGate(ctx: Context): TeamRuntimeGate {
  // Read before the face probe so the operator is told the real reason. The
  // official runtime publishes the same projection key and stateVersion as the
  // fork (agentTeam / 4), so the browser half keeps reading live state either
  // way; what must not happen is a second service registration for one name.
  if (readService<unknown>(ctx, 'agentTeams', false) !== undefined) return 'host-teams'
  if (profileMountsOfficialTeams(ctx)) return 'host-teams-declared'
  // Every face is read through `ctx.get`: this fiber injects three services, so
  // a property read of any other service throws "cannot get property ... without
  // inject" and the whole row would fail to mount instead of skipping the
  // optional runtime.
  const agents = readService<{ get?: unknown; list?: unknown }>(ctx, 'agents', false)
  const sessions = readService<{ get?: unknown; flush?: unknown }>(ctx, 'sessions', false)
  const sessionPersistence = readService<unknown>(ctx, 'sessionPersistence', false)
  const sessionProjections = readService<{ register?: unknown }>(ctx, 'sessionProjections', false)
  const subagents = readService<{ startActivation?: unknown }>(ctx, 'subagents', false)
  const servesFaces = typeof agents?.get === 'function'
    && typeof agents?.list === 'function'
    && typeof sessions?.get === 'function'
    && typeof sessions?.flush === 'function'
    && sessionPersistence !== undefined
    && typeof sessionProjections?.register === 'function'
    && typeof subagents?.startActivation === 'function'
  return servesFaces ? 'ready' : 'missing-faces'
}

/**
 * Whether this deployment serves every face the forked Agent Teams runtime
 * needs, and serves no Agent Teams runtime of its own. TeamService declares the
 * faces as its own inject list; a deployment missing one keeps M1's ledger,
 * routes and member brief and loses only the team runtime.
 * @param ctx - the plugin context.
 * @returns true only when this row must mount the forked runtime.
 */
export function servesTeamRuntime(ctx: Context): boolean {
  return teamRuntimeGate(ctx) === 'ready'
}

/**
 * Register the `team:squad` context with the host system-prompt registry.
 *
 * A CONTEXT, not a section: a member preset that registers a `complete` section
 * restores itself as the only section, which drops every untagged section
 * (docs/member-prompt.md). Contexts are rendered beside the sections, so the
 * Lead's roster survives any preset composition. The position is the Team
 * runtime's own (see {@link TEAM_IDENTITY_CONTEXT_ORDER}): the host's central
 * context table stopped naming it in 0.2.2-rc.2.
 * @param registry - `ctx.systemPrompt`.
 * @param readText - reads the squad roster and goal for one assembling session.
 * @returns the exact disposer the registry returned.
 */
export function registerSquadPromptContext(
  registry: SquadContextRegistry,
  readText: (sessionId: string | undefined) => string,
): () => void {
  return registry.context({
    name: SQUAD_CONTEXT_NAME,
    order: TEAM_IDENTITY_CONTEXT_ORDER,
    required: true,
    text: (context: never) => readText(assembleIdentity(context).sessionId),
  })
}

function warn(ctx: Context, message: string, error?: unknown): void {
  const logger = (ctx as { logger?: { warn?: (...args: unknown[]) => void } }).logger
  if (typeof logger?.warn === 'function') logger.warn(message, error)
  else console.warn(message, error)
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount (cordis-plugin-loader); dispatched to the owning fiber only.
     * Spelled here because the Loader package is not a dependency of this
     * plugin, with the Loader's own shape so the two declarations merge when a
     * Host program carries both.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Activate the host half.
 * @param ctx - the plugin context (systemPrompt, typertGateway and webServer injected).
 * @param config - resolved row config.
 */
export function apply(ctx: Context, config?: Config): void {
  if (readConfigField(config?.enabled, DEFAULT_ENABLED) !== true) return
  const abort = new AbortController()
  // The face is resolved on every use instead of once here: the official
  // workspace registry initializes asynchronously, after this row applies, so a
  // captured face would stay undefined and the panel would offer no workspace to
  // pin while every pinned run answered workspace-unavailable.
  const workspaces = (): WorkspaceRegistryFace | undefined => resolveWorkspaceRegistry(ctx)
  const gateway = createHostRunGateway({
    ...(resolveTypertGateway(ctx) === undefined ? {} : { gateway: resolveTypertGateway(ctx) }),
    ...(resolveCommandDispatcher(ctx) === undefined ? {} : { commands: resolveCommandDispatcher(ctx) }),
    ...(resolveAgents(ctx) === undefined ? {} : { agents: resolveAgents(ctx) }),
    signal: abort.signal,
  })
  // Published once the forked runtime has installed it; a squad run recorded
  // after its Lead session existed asks it to re-scan for that session.
  let teamTools: TeamToolInstallation | undefined
  const service = new AgentsHostService({
    dir: agentsHomeDirectory(),
    gateway,
    workspaces,
    describer: createLlmSquadDescriber(() => resolveLlm(ctx)),
    onSquadRun: () => { teamTools?.refresh() },
  })

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    let cancelled = false
    try {
      // A ledger this process cannot own or read still mounts: the routes answer
      // with the named failure instead of the panel finding no host at all, and
      // nothing on disk is touched.
      try {
        void service.state
      } catch (error) {
        warn(ctx, '[dsh-agents] the squad ledger is unusable; every route answers with its named failure and the file is left untouched', error)
      }
      for (const route of makeAgentsRoutes(service)) disposers.push(ctx.webServer.register(route))
      const systemPrompt = resolveSystemPrompt(ctx)
      if (systemPrompt !== undefined) {
        // The section reads the ledger AT ASSEMBLE TIME, so a definition edited
        // between turns is the one the next turn's prompt carries.
        disposers.push(registerMemberPromptSeam(systemPrompt, () => service.promptView()))
        const squadRegistry = systemPrompt as unknown as SquadContextRegistry
        if (typeof squadRegistry.context === 'function') {
          disposers.push(registerSquadPromptContext(squadRegistry, sessionId => service.squadContext(sessionId)))
        } else {
          warn(ctx, '[dsh-agents] this deployment serves no systemPrompt.context; a squad Lead stays unaware of its roster')
        }
      } else {
        warn(ctx, '[dsh-agents] this deployment serves no systemPrompt service; member briefs and the squad context stay un-injected')
      }

      const gate = teamRuntimeGate(ctx)
      if (gate === 'host-teams' || gate === 'host-teams-declared') {
        // Whole block, not just the constructor: the fork's tools resolve
        // `agentTeams` through the service accessor and would then drive the
        // official runtime with this package's gate and member pins, which is a
        // second owner of one service rather than a coexistence.
        warn(ctx, gate === 'host-teams'
          ? '[dsh-agents] this deployment already serves the official Agent Teams runtime (agentTeams); the forked Agent Teams runtime and its Team tools stay unmounted so one service keeps one owner, and squads keep member runs, the ledger and the routes'
          : `[dsh-agents] this deployment mounts an official Agent Teams runtime bundle (${OFFICIAL_TEAMS_BUNDLES.join(' or ')}); the forked Agent Teams runtime and its Team tools stay unmounted so that row keeps the agentTeams service, and squads keep member runs, the ledger and the routes`)
      } else if (gate === 'missing-faces') {
        warn(ctx, '[dsh-agents] this deployment does not serve the agents/sessions/sessionPersistence/sessionProjections/subagents set; the forked Agent Teams runtime stays unmounted and only member runs are available')
      } else {
        // Manual construction does not invoke the class-plugin init hook, so the
        // asynchronous projection handle arrives through the explicit factory.
        void TeamService.create(ctx, {}, { pins: createTeammatePins(gateway) }).then(() => {
          if (cancelled) return
          teamTools = installTeamTools(ctx as unknown as TeamServiceContext, {
            isTeamSession: agent => service.isSquadSession(agent.id, agent.session.header.parentSession),
          })
          teamTools.refresh()
        }).catch((error: unknown) => {
          warn(ctx, '[dsh-agents] the forked Agent Teams runtime failed to initialize; only member runs are available', error)
        })
        disposers.push(() => teamTools?.dispose())
      }
    } catch (error) {
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
      throw error
    }
    return () => {
      cancelled = true
      abort.abort()
      for (const dispose of disposers.splice(0)) dispose()
      teamTools = undefined
      service.dispose()
    }
  }, 'dsh-agents: host ledger, routes, member brief, squad context, and team runtime')

  // The agent tools and their announcement. One effect owns both, so unloading
  // the row releases the registrations and the section whatever a later sync
  // did; the sync below rebuilds only the section, and only on a real change.
  let disposeSection: (() => void) | undefined
  ctx.effect(() => {
    const registry = resolveToolRegistry(ctx)
    const disposers = registry === undefined ? [] : buildAgentsTools(service).map(tool => registry.register(tool))
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
      disposeSection?.()
      disposeSection = undefined
    }
  }, 'dsh-agents: squad tools')

  let announced: boolean | undefined
  /** Match the announcement to the committed switch, rebuilding only when it moved. */
  const sync = (): void => {
    const announceToAgent = readConfigField(config?.announceToAgent, DEFAULT_ANNOUNCE_TO_AGENT)
    if (announced === announceToAgent) return
    announced = announceToAgent
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    const systemPrompt = resolveSystemPrompt(ctx)
    if (!announceToAgent || systemPrompt === undefined) return
    disposeSection = systemPrompt.section({
      name: AGENTS_TOOL_SECTION_NAME,
      order: PLUGIN_TOOL_SECTION_ORDERS.agents,
      // The announcement names the squad tools, so it renders only while at
      // least one of them is reachable: a restriction, a preset composition or a
      // missing registry must not leave guidance telling the model to call a
      // tool this session cannot see.
      text: visibleToolText(lookupOf(resolveToolRegistry(ctx)), AGENTS_TOOL_NAMES, AGENTS_TOOL_GUIDANCE),
    })
  }
  // A settings commit of the volatile switch lands in the reference this fiber
  // already holds and is announced here: no remount, no second apply.
  ctx.on('loader/volatile-update', () => { sync() })
  sync()
}

/** Workspace registry type re-exported for the client half's own typings. */
export type { Workspace, WorkspaceRegistryFace }
