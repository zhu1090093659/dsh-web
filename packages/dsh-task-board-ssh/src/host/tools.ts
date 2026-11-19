/**
 * The three model-visible tools this extension contributes.
 *
 * They live with the provider — the board's own agent-tools module never learns
 * SSH vocabulary — and they register through the extension capability face, so
 * they follow the same board-enabled x extension-enabled gate as every other
 * provider surface: switching either off withdraws all three.
 *
 * What a tool returns is a projection, never a host entry: an alias, an address,
 * a port and a user are what a card needs to name its host, and a credential is
 * not part of this surface at all (the `dshSsh` face carries none, and the
 * projection here would drop one that appeared anyway).
 *
 * @module dsh-task-board-ssh/host/tools
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DshSshHost } from '../core/contract.ts'
import { SSH_AGENT_KINDS, parseSshTarget, type SshAgentKind, type SshExecutionMode } from '../core/target.ts'
import type { SshRunEngine } from './engine.ts'

/** Tool names, in registration order. */
export const SSH_TOOL_NAMES = ['task_board_ssh_target', 'task_board_ssh_status', 'task_board_ssh_follow_up'] as const

/** One tool name. */
export type SshToolName = (typeof SSH_TOOL_NAMES)[number]

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Model-facing JSON rendering shared by the three tools. */
function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

/** Mark an already JSON-safe projection as the tool's canonical value. */
function json(value: unknown): Json {
  return value as Json
}

/** A domain refusal the model is expected to read and act on. */
function refused(code: string, message: string): Json {
  return json({ ok: false, code, message })
}

/** The message of anything thrown by a caller below. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Project one host as a tool may report it.
 *
 * Written field by field on purpose: a deployment's host summary may grow a
 * member tomorrow, and the model-facing surface must not grow it too by
 * accident.
 * @param host - the secret-free host the `dshSsh` face reports.
 * @returns the projection.
 */
function hostView(host: DshSshHost): Record<string, unknown> {
  return {
    alias: host.alias,
    host: host.host,
    port: host.port,
    user: host.user,
    tags: [...host.tags],
    proxyJump: [...host.proxyJump],
    forwardAgent: host.forwardAgent,
    keyReady: host.keyReady,
    ...(host.description === undefined ? {} : { description: host.description }),
    ...(host.environment === undefined ? {} : { environment: host.environment }),
    ...(host.location === undefined ? {} : { location: host.location }),
  }
}

/** Every host this deployment can pin a card to, in the same projection. */
function hostViews(engine: SshRunEngine): Record<string, unknown>[] {
  return engine.hosts().slice(0, 50).map(hostView)
}

/** Read one string parameter, or undefined when it is absent or blank. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Read one number parameter, or undefined when it is absent or unusable. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined
}

/**
 * Assemble a target out of the flat parameters a tool call carries.
 * @param args - the tool arguments.
 * @returns the candidate target, still to be validated by the parser.
 */
function targetFromArgs(args: Record<string, unknown>): unknown {
  const host = text(args.host) ?? ''
  const mode = text(args.mode) ?? 'direct'
  const agentKind = (SSH_AGENT_KINDS as readonly string[]).includes(String(args.agent)) ? String(args.agent) as SshAgentKind : 'dsh'
  const agentCommand = text(args.agentCommand)
  const agentResumeCommand = text(args.agentResumeCommand)
  const workspace = text(args.workspaceKind) === 'git'
    ? text(args.repositoryUrl) !== undefined
      ? {
          kind: 'git',
          source: {
            kind: 'url',
            url: text(args.repositoryUrl),
            ...(text(args.repositoryBase) === undefined ? {} : { base: text(args.repositoryBase) }),
          },
        }
      : { kind: 'git', source: { kind: 'workspace', workspaceId: text(args.workspaceId) ?? '' } }
    : { kind: 'in-place', path: text(args.workspacePath) ?? '' }
  return {
    mode,
    host,
    agent: {
      kind: agentKind,
      ...(agentKind === 'custom' && agentCommand !== undefined ? { command: agentCommand } : {}),
      ...(agentKind === 'custom' && agentResumeCommand !== undefined ? { resumeCommand: agentResumeCommand } : {}),
    },
    workspace,
  }
}

/** The target tool: read or pin where one card runs. */
function buildTargetTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_target',
    description: 'Read or pin the SSH execution target of one task board card: whether it runs remotely at all (direct) or through a local session that drives the host (proxy), which dsh-ssh host alias it addresses, which agent CLI runs there and where the work happens. Pinning a target makes the card run on that host the next time it is started; a direct card gets no local session at all. Read the current pin and the available hosts first when the user has not named an alias.',
    parameters: {
      action: { type: 'string', required: true, enum: ['read', 'set'], description: 'read reports the current pin and the hosts available; set stores a new pin.' },
      taskId: { type: 'string', required: true, description: 'Card to read or retarget.' },
      mode: { type: 'string', enum: ['direct', 'proxy'], description: 'direct starts a headless agent on the host and keeps no local session; proxy runs a local session told to drive the host through the ssh_* tools. Defaults to direct.' },
      host: { type: 'string', description: 'dsh-ssh host alias the card addresses. Required by set.' },
      agent: { type: 'string', enum: [...SSH_AGENT_KINDS], description: 'Agent CLI the remote run starts (default dsh).' },
      workspaceKind: { type: 'string', enum: ['in-place', 'git'], description: 'in-place works in an existing remote directory; git creates a per-run worktree. Defaults to in-place.' },
      workspacePath: { type: 'string', description: 'Absolute remote directory of an in-place target.' },
      repositoryUrl: { type: 'string', description: 'Clone URL a git target prepares its worktree from, when the host can reach it.' },
      repositoryBase: { type: 'string', description: 'Base branch that worktree starts from; the remote HEAD when absent.' },
      workspaceId: { type: 'string', description: 'Local workspace id a git target runs from, when its repository is not reachable from the host.' },
      agentCommand: { type: 'string', description: 'Start command template of a custom agent; must reference {prompt_file}.' },
      agentResumeCommand: { type: 'string', description: 'Resume command template of a custom agent; without one a follow-up runs fresh.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const taskId = text(args.taskId)
      if (taskId === undefined) return refused('task-required', 'taskId is required')
      const action = text(args.action) ?? 'read'
      if (action === 'read') {
        const target = engine.targetOf(taskId)
        return json({ ok: true, target: target ?? null, hosts: hostViews(engine) })
      }
      if (action !== 'set') return refused('unknown-action', 'action must be read or set')
      const parsed = parseSshTarget(targetFromArgs(args as Record<string, unknown>))
      if (!parsed.ok) {
        return json({ ok: false, code: 'invalid-target', issues: parsed.errors.map(issue => ({ path: issue.path, message: issue.message })) })
      }
      const reply = engine.setTarget(taskId, parsed.value)
      if (!reply.ok) return refused(reply.code, reply.error)
      return json({ ok: true, target: parsed.value, hosts: hostViews(engine) })
    },
  })
}

/** The status tool: one card's remote run, and optionally a page of its log. */
function buildStatusTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_status',
    description: 'Read the remote run state of one task board card: the phase of the run in flight (queued, running, succeeded, failed, cancelled, lost), its remote exit code, how many log bytes the host reported, the session it reported and the recent run history. Pass logOffset and logLimit to read one page of the run log by byte offset; the log is a file on the host, never part of the card, so page it instead of asking for everything.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Card whose remote run to inspect.' },
      runId: { type: 'string', description: 'One specific run to read the log of; the active run when absent.' },
      logOffset: { type: 'number', description: 'Byte offset the log page starts at (default 0).' },
      logLimit: { type: 'number', description: 'Largest page to return, in bytes (default 65536, at most 131072).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const taskId = text(args.taskId)
      if (taskId === undefined) return refused('task-required', 'taskId is required')
      const status = engine.status(taskId)
      const runId = text(args.runId)
      const offset = count(args.logOffset)
      const limit = count(args.logLimit)
      if (runId === undefined && offset === undefined && limit === undefined) return json({ ok: true, status })
      const page = await engine.readLog(taskId, {
        ...(runId === undefined ? {} : { runId }),
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
      })
      if (!page.ok) return json({ ok: false, status, code: page.code, message: page.error })
      return json({
        ok: true,
        status,
        log: { runId: page.runId, offset: page.offset, nextOffset: page.nextOffset, bytes: page.bytes, eof: page.eof, text: page.text },
      })
    },
  })
}

/** The follow-up tool: one more instruction for the card's remote session. */
function buildFollowUpTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_follow_up',
    description: 'Send one more instruction to the remote agent session of a task board card. On a card whose run is still going the instruction waits for that run to finish and then continues the same remote session; on a settled card it re-enters the card run with the earlier session resumed. An agent that cannot resume degrades to a fresh run that carries the previous summary, which the execution record says.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Card whose remote session receives the instruction.' },
      text: { type: 'string', required: true, description: 'The instruction itself.' },
      kind: { type: 'string', enum: ['follow-up', 'rework'], description: 'follow-up adds work; rework asks again for work the previous run got wrong. Defaults to follow-up.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const taskId = text(args.taskId)
      const instruction = typeof args.text === 'string' ? args.text.trim() : ''
      if (taskId === undefined) return refused('task-required', 'taskId is required')
      if (instruction === '') return refused('text-required', 'text must be a non-blank instruction')
      const kind = text(args.kind) === 'rework' ? 'rework' : 'follow-up'
      try {
        const reply = await engine.instruct(taskId, instruction, kind)
        if (!reply.ok) return refused(reply.code, reply.error)
        return json({
          ok: true,
          taskId: reply.taskId,
          ...(reply.runId === undefined ? {} : { runId: reply.runId }),
          ...(reply.phase === undefined ? {} : { phase: reply.phase }),
          message: reply.message ?? '',
        })
      } catch (error) {
        return refused('follow-up-failed', messageOf(error))
      }
    },
  })
}

/**
 * Build every tool this extension registers.
 * @param engine - the live run engine behind them.
 * @returns the tool definitions, in registration order.
 */
export function buildSshTools(engine: SshRunEngine): ToolDefinition[] {
  return [buildTargetTool(engine), buildStatusTool(engine), buildFollowUpTool(engine)]
}

/** Re-exported for the specs: the modes a target may pin. */
export type { SshExecutionMode }
