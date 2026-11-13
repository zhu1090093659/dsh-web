/**
 * Host entry of the dsh-agents plugin: one ledger, the eight squad routes, the
 * member-brief section, the squad context that tells a Lead who exists, the
 * model-facing squad tools with their announcement, and the Team-mode switch that
 * turns the native Agent Teams runtime on for one squad Lead.
 *
 * The runtime is the Host's: `@deepseek-ai/dsh-agent-team` owns team state, the
 * task board and its tools, and `@deepseek-ai/dsh-subagent` owns members. This
 * file therefore adapts, never re-implements. Every rule it depends on lives
 * beside it — the ledger in host/ledger.ts, the definition/run seam in
 * host/run-gateway.ts, the launch order in host/service.ts, the squad-run gate
 * and Lead context in host/squad.ts, the fence and the wire in host/routes.ts and
 * protocol.ts, the tool surface in host/agent-tools.ts, and the injection
 * decision in host/member-prompt.ts (evidence in docs/member-prompt.md).
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
import { createHostRunGateway, type CommandDispatcherFace, type TypertGatewayFace, type WorkspaceRegistryFace } from './host/run-gateway.ts'
import { AgentsHostService } from './host/service.ts'
import { readService } from './host/services.ts'
import { PLUGIN_TOOL_SECTION_ORDERS, visibleToolText } from './tool-surface.ts'

/** Services this row needs before it mounts. The workspace registry, command dispatcher, agent registry and Team service are resolved optionally: a deployment that lacks one still mounts, and the feature that needs the missing face degrades by name instead of failing the row. */
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
  enabled: z.boolean().default(true).description('Mount the agent squad ledger, its routes, the member-brief section, the squad tools, and the Team-mode switch a squad Lead needs.'),
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

/**
 * Position of that context in the assembled prompt.
 *
 * Held here instead of read from the Host's central table: 0.2.2-rc.2 dropped the
 * Team identity entry the number used to name, and the official `context()`
 * rejects an undefined order. 125 sits between the subagent delegation context
 * (120) and HARNESS_SOURCE (200), where a Lead reads its roster before it plans.
 */
export const SQUAD_CONTEXT_ORDER = 125

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

/** The native Agent Teams face this row switches on for one squad Lead. */
export interface TeamModeFace {
  /** Whether this caller's tree already has Team mode on. */
  isEnabled(caller: Agent): boolean
  /** Turn Team mode on for one root Session. */
  setEnabled(agent: Agent, enabled: boolean, signal?: AbortSignal): Promise<void>
}

/**
 * Read the native Team service, if this deployment serves one.
 *
 * Resolved per use rather than injected: the official row mounts on its own
 * fiber and owns the service name, so an injected dependency would make this row
 * wait for it (or fail to mount where a deployment disables it). A deployment
 * without the service keeps the ledger, the routes, member runs and the roster
 * context, and loses only the automatic Team mode.
 * @param ctx - the plugin context.
 * @returns the two methods this row calls, or undefined when none is served.
 */
export function resolveTeamMode(ctx: Context): TeamModeFace | undefined {
  const teams = readService<Partial<TeamModeFace>>(ctx, 'agentTeams', false)
  return teams !== undefined && typeof teams.setEnabled === 'function' && typeof teams.isEnabled === 'function'
    ? teams as TeamModeFace
    : undefined
}

/** Read the injected typert gateway (the Host's own service call surface). */
function resolveTypertGateway(ctx: Context): TypertGatewayFace | undefined {
  return (ctx as { typertGateway?: TypertGatewayFace }).typertGateway
}

/**
 * Register the `team:squad` context with the host system-prompt registry.
 *
 * A CONTEXT, not a section: a member preset that registers a `complete` section
 * restores itself as the only section, which drops every untagged section
 * (docs/member-prompt.md). Contexts are rendered beside the sections, so the
 * Lead's roster survives any preset composition. The position is held here
 * (see {@link SQUAD_CONTEXT_ORDER}): the host's central context table stopped
 * naming a Team context in 0.2.2-rc.2.
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
    order: SQUAD_CONTEXT_ORDER,
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
  /**
   * Switch one squad Lead into the native Team mode.
   *
   * Called with the run record the moment it is durable, which is the ONLY
   * moment this can work: the Host announces `agent/created` inside session
   * creation, before this package has a run record to match it against. The
   * agent is therefore looked up live, and a deployment that serves no
   * `agentTeams` service keeps everything else and loses only this switch.
   * @param sessionId - the Lead session id the run record names.
   */
  const enableTeamMode = (sessionId: string): void => {
    try {
      const agent = resolveAgents(ctx)?.get(sessionId)
      if (agent === undefined) {
        warn(ctx, '[dsh-agents] squad Lead session ' + sessionId + ' has no live agent; the native task board stays off for this run')
        return
      }
      const teams = resolveTeamMode(ctx)
      if (teams === undefined) {
        warn(ctx, '[dsh-agents] this deployment serves no agentTeams service; squad Lead session ' + sessionId + ' opens without the native task board')
        return
      }
      if (teams.isEnabled(agent)) return
      void teams.setEnabled(agent, true).catch((error: unknown) => {
        warn(ctx, '[dsh-agents] the native Team service refused to enable Team mode for squad Lead session ' + sessionId, error)
      })
    } catch (error) {
      warn(ctx, '[dsh-agents] the Team-mode switch failed for squad Lead session ' + sessionId, error)
    }
  }
  const service = new AgentsHostService({
    dir: agentsHomeDirectory(),
    gateway,
    workspaces,
    describer: createLlmSquadDescriber(() => resolveLlm(ctx)),
    onSquadRun: run => { enableTeamMode(run.sessionId) },
  })

  ctx.effect(() => {
    const disposers: Array<() => void> = []
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

    } catch (error) {
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
      throw error
    }
    return () => {
      abort.abort()
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
    }
  }, 'dsh-agents: host ledger, routes, member brief and squad context')

  // A Lead announced AFTER its run record exists — a resumed session, or a host
  // that announces again — is switched the same way. This is a fallback, not the
  // main path: the first creation announces before the record is written, so the
  // launch itself depends on the callback above.
  ctx.effect(() => {
    const dispose = ctx.on('agent/created', ({ agent }) => {
      try {
        if (agent.session.header.parentSession !== undefined) return undefined
        if (!service.leadsSquadRun(agent.id)) return undefined
        enableTeamMode(agent.id)
      } catch (error) {
        warn(ctx, '[dsh-agents] the Team-mode switch failed while this session was being announced', error)
      }
      return undefined
    })
    return () => { dispose() }
  }, 'dsh-agents: native team mode for an announced squad Lead')

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
