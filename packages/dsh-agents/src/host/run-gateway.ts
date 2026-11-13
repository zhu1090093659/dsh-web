/**
 * The definition/run seam.
 *
 * One member session per run. Everything that touches the DSH host — the
 * agent-preset registry, session creation, the title, the pinned permission and
 * model, the first message — sits behind {@link MemberRunGateway}, so the squad
 * service owns definitions and launch ordering while a whole-squad run reuses the
 * same session faces without touching the ledger or the routes.
 *
 * @module @linxin666/dsh-agents/host/run-gateway
 */
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AgentsError, isAgentsError } from '../core/errors.ts'
import { parseModelPin, type ModelRoute } from '../core/model-pin.ts'
import type { AgentsPermission, AgentsWorkspaceOption } from '../protocol.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'

/** One agent preset as the host registry reports it. */
export interface PresetInfo {
  id: string
  /** Present when the host reports the preset unusable, carrying its reason. */
  broken?: string
}

/** What the host needs to compose one member session. */
export interface CreateSessionInput {
  /**
   * The validated workspace pin. Absent when the squad pins none: the request
   * then carries no workspace id at all and the Host composes the session in its
   * own default directory, which is the documented behaviour of an unbound squad.
   */
  workspaceId?: string
  /** Pinned agent preset, absent when the member pins none. */
  agentPreset?: string
}

/** One queued first user message. */
export interface SessionPromptInput {
  sessionId: string
  text: string
}

/** The host face a member run drives. */
export interface MemberRunGateway {
  /**
   * Read the host agent-preset registry.
   * @returns the presets, or undefined when this deployment serves no registry.
   */
  listPresets(): Promise<readonly PresetInfo[] | undefined>
  /**
   * Read the host model catalog — the same `session/modelCatalog` reply the task
   * board's runner reads, so a route the panel offers is a route this Host
   * itself publishes.
   *
   * Optional on purpose: a deployment that serves no catalog leaves the face
   * out, and the panel then offers no model picker at all instead of an empty
   * one. Normalization is `host/model-catalog.ts`'s job, not this seam's.
   * @returns the raw catalog reply, or undefined when this deployment serves none.
   */
  modelCatalog?(): Promise<unknown>
  /**
   * Create one session.
   * @throws AgentsError `session-create-failed` when the host refuses.
   */
  createSession(input: CreateSessionInput): Promise<{ sessionId: string }>
  /** Rename the session to the member title. */
  renameSession(sessionId: string, title: string): Promise<void>
  /** Apply the pinned permission through the host command dispatcher. */
  applyPermission(sessionId: string, permission: AgentsPermission): Promise<void>
  /** Select the pinned model route, with the reasoning effort pinned beside it. */
  selectModel(sessionId: string, route: ModelRoute, reasoningEffort: string | undefined): Promise<void>
  /** Queue the first user message. */
  prompt(input: SessionPromptInput): Promise<void>
}

/** The workspace registry face the run gate validates against. */
export interface WorkspaceRegistryFace {
  list(): readonly Workspace[]
}

/**
 * The workspaces this deployment offers as a squad pin, for the form's picker.
 *
 * Absence is a first-class answer, exactly like the preset list beside it: a
 * deployment that serves no registry, one whose read throws, or one whose list
 * carries no usable id answers undefined, and the state view then omits the
 * field so the form falls back to a typed id instead of an empty picker.
 * @param face - the workspace registry, when this deployment serves one.
 * @returns the offered workspaces, or undefined when none can be listed.
 */
export function listOfferedWorkspaces(face: WorkspaceRegistryFace | undefined): readonly AgentsWorkspaceOption[] | undefined {
  if (face === undefined) return undefined
  let rows: readonly Workspace[]
  try {
    rows = face.list()
  } catch {
    // A registry whose read throws is a registry this deployment does not serve.
    return undefined
  }
  const offered: AgentsWorkspaceOption[] = []
  for (const row of rows) {
    const id = String(row.id)
    if (id === '') continue
    offered.push({
      id,
      title: typeof row.title === 'string' && row.title !== '' ? row.title : id,
      ...(typeof row.path === 'string' && row.path !== '' ? { path: row.path } : {}),
    })
  }
  return offered.length === 0 ? undefined : offered
}

/** The command dispatcher face the permission pin drives. */
export interface CommandDispatcherFace {
  /**
   * Run one slash command against a live agent.
   *
   * The dispatcher answers the SETTLE record — the minted command id beside the
   * handler's own result — not the result itself. Reading `kind` off the record
   * makes every command look like a failure, which is how a successful
   * `/permission` switch was reported as "the permission command failed".
   */
  execute(agent: Agent, line: string, args: readonly string[], signal?: AbortSignal): Promise<CommandSettleRecord | undefined>
}

/** What the command dispatcher answers for one settled command. */
export interface CommandSettleRecord {
  /** The id minted for this run, pairing its lifecycle events. */
  commandId: string
  /** The handler's normalized outcome. */
  result: { kind: string; text?: string }
}

/** The gateway peer shape; derived from the public request type. */
type GatewayPeer = InvokeRemoteRequest['peer']

/** The invoke face of `ctx.typertGateway`, narrowed to what this package calls. */
export interface TypertGatewayFace {
  invoke(request: { namespace: string; method: string; args: Record<string, unknown>; peer: GatewayPeer; signal?: AbortSignal }): Promise<unknown>
}

/** The host services a run gateway drives; all optional so a deployment can lack any. */
export interface HostRunFaces {
  gateway?: TypertGatewayFace
  commands?: CommandDispatcherFace
  agents?: { get(sessionId: string): Agent | undefined }
  /** Aborts every in-flight call when the plugin fiber disposes. */
  signal?: AbortSignal
}

/**
 * Args shape per endpoint: `agentPresets/list` and `session/modelCatalog` both
 * declare no parameters, so their args must be `{}`; every other call this
 * package makes wraps its payload in `request`.
 */
function wireArgs(namespace: string, method: string, request: Record<string, unknown>): Record<string, unknown> {
  if (namespace === 'agentPresets' && method === 'list') return {}
  if (namespace === 'session' && method === 'modelCatalog') return {}
  return { request }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the production gateway over the host's own services.
 *
 * Session composition speaks for the local owner: this is the Host creating a
 * session on behalf of the user driving it, exactly the position the task
 * board's runner claims, and no wire field can set a principal.
 * @param faces - the resolved host services.
 * @returns the gateway the squad service runs members through.
 */
export function createHostRunGateway(faces: HostRunFaces): MemberRunGateway {
  const call = async (namespace: string, method: string, request: Record<string, unknown>): Promise<unknown> => {
    const gateway = faces.gateway
    if (gateway === undefined) throw new Error('the host typert gateway is unavailable')
    return await gateway.invoke({
      namespace,
      method,
      args: wireArgs(namespace, method, request),
      peer: ownerPeer(faces.signal),
      ...(faces.signal === undefined ? {} : { signal: faces.signal }),
    })
  }
  return {
    async listPresets() {
      if (faces.gateway === undefined) return undefined
      try {
        const value = await call('agentPresets', 'list', {}) as { presets?: readonly { id?: unknown; broken?: unknown }[] } | null
        if (value === null || !Array.isArray(value.presets)) return undefined
        return value.presets.flatMap((preset) => {
          if (typeof preset?.id !== 'string' || preset.id === '') return []
          return [{ id: preset.id, ...(typeof preset.broken === 'string' ? { broken: preset.broken } : {}) }]
        })
      } catch {
        // A deployment without the preset registry answers with an unmatched
        // namespace; that is "no registry", not "unknown preset".
        return undefined
      }
    },
    async modelCatalog() {
      return await call('session', 'modelCatalog', {})
    },
    async createSession(input) {
      const created = await call('session', 'create', {
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
      }) as { sessionId?: unknown }
      if (typeof created?.sessionId !== 'string' || created.sessionId === '') {
        throw new Error('the host returned no session id')
      }
      return { sessionId: created.sessionId }
    },
    async renameSession(sessionId, title) {
      await call('session', 'rename', { sessionId, title })
    },
    async applyPermission(sessionId, permission) {
      const commands = faces.commands
      if (commands === undefined) throw new Error('the host command dispatcher is unavailable')
      const agent = faces.agents?.get(sessionId)
      if (agent === undefined) throw new Error('session ' + sessionId + ' has no live agent')
      const settled = await commands.execute(agent, '/permission ' + permission, [], AbortSignal.timeout(30_000))
      const result = settled?.result
      if (result === undefined) throw new Error('the permission command was not acknowledged')
      if (result.kind !== 'success') throw new Error(result.text ?? 'the permission command failed')
    },
    async selectModel(sessionId, route, reasoningEffort) {
      await call('session', 'selectModel', {
        sessionId,
        ...(route.provider === undefined ? {} : { provider: route.provider }),
        model: route.model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
    },
    async prompt(input) {
      await call('session', 'prompt', {
        sessionId: input.sessionId,
        requestId: 'dsh-agents-' + crypto.randomUUID(),
        mode: 'queue',
        content: [{ type: 'text', text: input.text }],
      })
    },
  }
}

/**
 * The in-process owner peer these calls speak for. Interaction level is
 * `none`: this package only invokes methods and never receives forwarded events.
 * @param signal - the plugin fiber's abort signal, when there is one.
 */
function ownerPeer(signal?: AbortSignal): GatewayPeer {
  return {
    id: ('dsh-agents-owner:' + crypto.randomUUID()) as GatewayPeer['id'],
    principal: { kind: 'owner' },
    ...(signal === undefined ? {} : { signal }),
    interactions: 'none',
    dispose: () => Promise.resolve(),
  } as GatewayPeer
}

/**
 * Resolve one pinned agent preset against the host registry.
 *
 * One rule for every launch this package starts: a pin this Host cannot honour
 * is refused with a named failure before any session exists.
 * @param gateway - the preset-registry face.
 * @param preset - the pinned preset id, or undefined when nothing is pinned.
 * @returns the preset id to compose the session from, or undefined for no pin.
 * @throws AgentsError `preset-registry-unavailable`, `preset-unknown` or
 *   `preset-unavailable`.
 */
export async function resolvePinnedPreset(
  gateway: Pick<MemberRunGateway, 'listPresets'>,
  preset: string | undefined,
): Promise<string | undefined> {
  if (preset === undefined) return undefined
  const presets = await gateway.listPresets()
  if (presets === undefined) {
    throw new AgentsError('preset-registry-unavailable', 'this deployment serves no host agent-preset registry, so preset "' + preset + '" cannot be resolved')
  }
  const found = presets.find(candidate => candidate.id === preset)
  if (found === undefined) {
    throw new AgentsError('preset-unknown', 'the host agent-preset registry has no preset "' + preset + '"')
  }
  if (found.broken !== undefined) {
    throw new AgentsError('preset-unavailable', 'the host agent-preset registry reports preset "' + found.id + '" unusable: ' + found.broken)
  }
  return found.id
}

/**
 * The agent presets this deployment can compose a session from.
 *
 * One registry read through the same `listPresets` face every pin resolution
 * uses, and one filter: a preset the registry reports unusable is left out,
 * because a Lead pinned to it would be refused the moment the squad run starts.
 * @param gateway - the preset-registry face.
 * @returns the offered preset ids, or undefined when this deployment has none to
 *   offer - no readable registry, or nothing usable in it. The caller then omits
 *   the field, because an empty list would read as "no presets exist".
 */
export async function listOfferedPresets(gateway: Pick<MemberRunGateway, 'listPresets'>): Promise<readonly string[] | undefined> {
  let presets: readonly PresetInfo[] | undefined
  try {
    presets = await gateway.listPresets()
  } catch {
    // A registry that throws is a registry this deployment does not serve.
    return undefined
  }
  if (presets === undefined) return undefined
  const offered = presets.filter(preset => preset.broken === undefined).map(preset => preset.id)
  return offered.length === 0 ? undefined : offered
}
