/*
 * Forked from deepseek-harness dsh-v0.2.2-rc.1 (commit 66491b05) packages/experimental/tool-agent-team/src/index.ts
 * MIT licensed; every change this package made is listed in
 * packages/dsh-agents/docs/fork-provenance.md.
 */
/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamService, TeamServiceContext } from '../team/index.ts'
import { TEAM_IDENTITY_CONTEXT_ORDER } from '../team/index.ts'
import { readService } from '../host/services.ts'
import { AGENTS_PERMISSIONS } from '../protocol.ts'
import { TeamTaskId } from '../team/types.ts'
import type { TeamMemberView } from '../team/types.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Tool routing and installation policy. */
export interface TeamToolOptions {
  /** Register `interrupt_agent` and its policy guidance. Defaults to true; false leaves the domain API available. */
  readonly interrupt?: boolean
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
  /**
   * Whether this exact live Agent belongs to a squad run this Host started.
   *
   * M2 deviation from upstream: upstream installs the complete Team tool set
   * into every root Session, because `tryMembership` answers `{ role: 'lead' }`
   * for any Agent without a parent. That pollutes ordinary chat sessions, so
   * this fork asks the Host instead: a plain session keeps the native subagent
   * tools and sees no Team tool at all.
   */
  readonly isTeamSession: (agent: Agent) => boolean
}

/** Resolved tool configuration. */
interface ResolvedTeamToolOptions {
  readonly interrupt: boolean
  readonly freshProvider: string
  readonly forkProvider: string
  readonly isTeamSession: (agent: Agent) => boolean
}

/** Model-facing collaboration guidance shared by Lead and teammates. */
function teamPolicy(interrupt: boolean): string {
  return `Agent Teams is available in this session

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message${interrupt ? ' and interrupt_agent' : ''}, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`
}

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One model-facing roster row. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Expose the member name as its model-facing target. */
function modelMember(member: TeamMemberView): InferValue<typeof MEMBER_VIEW_SCHEMA> {
  const { id: _id, name, ...details } = member
  return { target: name, ...details }
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Spawn tool parameters: upstream's four fields plus this fork's member-definition pins. */
const SPAWN_PARAMETERS = {
  name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
  description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
  prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
  context: {
    type: 'string',
    enum: ['fresh', 'fork'],
    description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
  },
  preset: {
    type: 'string',
    description: 'Agent preset id this teammate must run as. The spawn fails when the deployment cannot honour it.',
  },
  permission: {
    type: 'string',
    enum: ['read-only', 'workspace-write', 'danger-full-access'],
    description: 'Permission preset the teammate starts with, applied before its first step.',
  },
  model: {
    type: 'string',
    description: 'Model route as provider/model or a bare model id; selected before the teammate first step.',
  },
  reasoning_effort: {
    type: 'string',
    description: 'Reasoning effort id for the pinned model; it travels only with a model pin.',
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sent: { type: 'boolean', required: true, const: true },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  // The rendered parameter and value are declared unknown on purpose: typing
  // them as InferValue<S> makes tsc compare two unresolved conditional types
  // when defineTool infers the output schema and overrun its stack depth, while
  // the canonical value is still validated against `schema` at runtime.
  render: (args: unknown, value: unknown) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: TeamServiceContext, agentTeams: TeamService, config: ResolvedTeamToolOptions): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: teamPolicy(config.interrupt),
    }))
    register(scoped.systemPrompt.context({
      name: 'team:identity',
      order: TEAM_IDENTITY_CONTEXT_ORDER,
      required: true,
      text: () => {
        const { role, name } = agentTeams.membership(agent)
        return `${role === 'lead'
          ? 'You are the Team Lead named "lead".'
          : `You are teammate "${name}".\nYour Team Lead is named "lead".\nTo message your Team Lead, use send_message({ target: "lead", message: "..." }).`}
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`
      },
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
      parameters: SPAWN_PARAMETERS,
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const result = await agentTeams.spawnTeammate(agent, {
          name: args.name,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          signal: exec.signal,
          ...args.preset === undefined ? {} : { preset: args.preset },
          ...args.permission === undefined ? {} : { permission: args.permission },
          ...args.model === undefined ? {} : { model: args.model },
          ...args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort },
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      async execute(args, exec) {
        await agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
        return { sent: true }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_args, exec) {
        return Promise.resolve(agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')).map(modelMember))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, message, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    if (config.interrupt) {
      register(scoped.tools.register(defineTool({
        name: 'interrupt_agent',
        description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
        parameters: {
          target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
        },
        output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
        execute(args, exec) {
          return Promise.resolve(agentTeams.interrupt(callingAgent(exec.agent, 'interrupt_agent'), args.target))
        },
      })))
    }

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** The installed Team tool surface: a re-scan for newly qualified sessions, and removal. */
export interface TeamToolInstallation {
  /** Install the Team tools into every live Agent that now belongs to a squad run. */
  refresh(): void
  /** Remove every installed Team tool set. */
  dispose(): void
}

/**
 * Install the Team tool set in every live or subsequently published squad-run
 * session of this Host.
 *
 * The gate is the Host's squad-run ledger, not `tryMembership` alone: a plain
 * root session (the user's everyday chat, an ordinary coordinator turn) keeps
 * the native subagent tools and receives no Team tool and no `team:policy`
 * section, because installation is the only place this module contributes one.
 * @param ctx - deployment context serving `agentTeams`, `agents`, `tools` and `systemPrompt`.
 * @param options - routing, interrupt policy, and the Host squad-run gate.
 * @returns the installation, whose dispose removes every installed tool set.
 */
export function installTeamTools(ctx: TeamServiceContext, options: TeamToolOptions): TeamToolInstallation {
  // Read through `ctx.get`: this context injects neither service, and a plain
  // property read of a service the fiber did not inject throws in cordis.
  const agentTeams = readService<TeamService>(ctx, 'agentTeams', false)
  const agents = readService<TeamServiceContext['agents']>(ctx, 'agents', false)
  if (agentTeams === undefined || agents === undefined) {
    throw new Error('Agent Teams tools require the agentTeams and agents services')
  }
  const resolved: ResolvedTeamToolOptions = {
    interrupt: options.interrupt ?? true,
    freshProvider: options.freshProvider ?? 'spawn',
    forkProvider: options.forkProvider ?? 'fork',
    isTeamSession: options.isTeamSession,
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent)) return
    if (agentTeams.tryMembership(agent) === undefined) return
    if (!resolved.isTeamSession(agent)) return
    installed.set(agent, install(agent, ctx, agentTeams, resolved))
  }
  for (const agent of agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => {
    maybeInstall(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
    return undefined
  })
  return {
    refresh: () => {
      for (const agent of agents.list()) maybeInstall(agent)
    },
    dispose: () => {
      for (const dispose of installed.values()) dispose()
      installed.clear()
    },
  }
}
