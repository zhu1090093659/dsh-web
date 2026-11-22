/**
 * The model-visible tools this extension contributes: `task_board_ssh` (one
 * surface: create, bind, read, run, status, log, followup) and the three older
 * tools, kept as a compatibility layer over the same engine calls.
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
import { TASK_BOARD_MESSAGE_MAX_LENGTH, type DshSshHost } from '../core/contract.ts'
import { SSH_AGENT_KINDS, parseSshTarget, type SshExecutionMode, type SshTarget } from '../core/target.ts'
import type { SshRunEngine } from './engine.ts'
import { SSH_PREFLIGHT_CODES } from './inspect.ts'

/** Tool names, in registration order; the first is the one surface, the rest are the compatibility layer. */
export const SSH_TOOL_NAMES = ['task_board_ssh', 'task_board_ssh_target', 'task_board_ssh_status', 'task_board_ssh_follow_up'] as const

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
  const mode = args.mode === undefined ? 'direct' : args.mode
  const agentKind = args.agent === undefined ? 'dsh' : args.agent
  const agentCommand = text(args.agentCommand)
  const agentResumeCommand = text(args.agentResumeCommand)
  const workspaceKind = args.workspaceKind === undefined ? 'in-place' : args.workspaceKind
  let workspace: unknown
  if (workspaceKind === 'git') {
    workspace = text(args.repositoryUrl) !== undefined
      ? {
          kind: 'git',
          source: {
            kind: 'url',
            url: text(args.repositoryUrl),
            ...(text(args.repositoryBase) === undefined ? {} : { base: text(args.repositoryBase) }),
          },
        }
      : { kind: 'git', source: { kind: 'workspace', workspaceId: text(args.workspaceId) ?? '' } }
  } else if (workspaceKind === 'in-place') {
    workspace = { kind: 'in-place', path: text(args.workspacePath) ?? '' }
  } else {
    workspace = { kind: workspaceKind }
  }
  const agent: Record<string, unknown> = { kind: agentKind }
  if (agentCommand !== undefined) agent.command = agentCommand
  if (agentResumeCommand !== undefined) agent.resumeCommand = agentResumeCommand
  return {
    mode,
    host,
    agent,
    workspace,
  }
}

/** What the error codes of this surface mean, shared by every tool description. */
const CODE_HELP = 'Stable refusal codes: host-unreachable (alias unknown to dsh-ssh or the host did not answer: fix the alias or the dsh-ssh credentials), agent-missing (the agent name is not one of dsh/claude/codex/custom, or its program is not on the host PATH), path-missing (an in-place directory does not exist; it is never created), permission-required (the directory exists but the ssh user cannot write it, or a human must confirm in the board UI), run-active (the card already has a run in flight: wait for it or cancel it), invalid-target (the other target fields are malformed; issues says which).'

/** The target parameters every binding entry shares. */
const TARGET_PARAMETERS = {
  host: { type: 'string', description: 'dsh-ssh host alias the card addresses (read the available aliases with action "read").' },
  mode: { type: 'string', enum: ['direct', 'proxy'], description: 'direct (default): a headless agent runs on the host, no local session, best for self-contained jobs; proxy: a local session drives the host through ssh_* tools, best when the work needs local context or tools.' },
  // Deliberately not an enum: a bad name must reach the handler and come back as the stable agent-missing code, not as a schema error.
  agent: { type: 'string', description: `Agent CLI the remote run starts: ${SSH_AGENT_KINDS.join(', ')} (default dsh; custom needs agentCommand). Its program must exist on the host; any other name is refused with agent-missing.` },
  workspaceKind: { type: 'string', enum: ['in-place', 'git'], description: 'in-place (default): work directly inside the existing remote directory workspacePath, nothing is copied or cleaned up; git: a per-run worktree on its own branch dsh-task/<runId>, from repositoryUrl or the local repository workspaceId.' },
  workspacePath: { type: 'string', description: 'Absolute remote directory of an in-place target. It must exist and be writable.' },
  repositoryUrl: { type: 'string', description: 'Clone URL a git target prepares its worktree from, when the host can reach it.' },
  repositoryBase: { type: 'string', description: 'Base branch that worktree starts from; the remote HEAD when absent.' },
  workspaceId: { type: 'string', description: 'Local workspace id a git target runs from, when its repository is not reachable from the host.' },
  agentCommand: { type: 'string', description: 'Start command template of a custom agent; must reference {prompt_file}.' },
  agentResumeCommand: { type: 'string', description: 'Resume command template of a custom agent; without one a follow-up runs fresh.' },
  preflight: { type: 'boolean', description: 'Check the host, the agent program and the directory before binding (default true).' },
} as const

/** Read a boolean argument; undefined when absent. */
function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Parse the flat target arguments, mapping parser issues onto the stable codes
 * the caller can act on: a bad host alias or agent name is a host/agent refusal,
 * anything else stays `invalid-target`.
 */
function parseTarget(args: Record<string, unknown>): { ok: true; target: SshTarget } | { ok: false; reply: Json } {
  const parsed = parseSshTarget(targetFromArgs(args))
  if (parsed.ok) return { ok: true, target: parsed.value }
  const first = parsed.errors[0]
  const issues = parsed.errors.map(issue => ({ path: issue.path, message: issue.message }))
  if (first !== undefined && first.path === 'host') {
    return { ok: false, reply: json({ ok: false, code: 'host-unreachable', message: `host ${JSON.stringify(text(args.host) ?? '')} is not a valid dsh-ssh alias. Read the configured aliases with task_board_ssh {action:"read"} and pass one of them.`, issues }) }
  }
  if (first !== undefined && first.path.startsWith('agent') && !(SSH_AGENT_KINDS as readonly string[]).includes(String(args.agent ?? 'dsh'))) {
    return { ok: false, reply: json({ ok: false, code: 'agent-missing', message: `agent ${JSON.stringify(args.agent)} is not supported. Use one of: ${SSH_AGENT_KINDS.join(', ')}.`, issues }) }
  }
  return { ok: false, reply: json({ ok: false, code: 'invalid-target', message: 'the target is malformed; issues lists each field.', issues }) }
}

/** Run the preflight and answer its refusal as a tool reply, or undefined when the target is usable. */
async function preflightReply(engine: SshRunEngine, target: SshTarget, args: Record<string, unknown>): Promise<Json | undefined> {
  if (flag(args.preflight) === false) return undefined
  const failure = await engine.preflight(target)
  return failure === undefined ? undefined : json({ ok: false, code: failure.code, message: failure.message, hint: failure.hint })
}

/** Bind a target to an existing card, after parsing and preflight. */
async function bindResult(engine: SshRunEngine, taskId: string, args: Record<string, unknown>): Promise<Json> {
  const parsed = parseTarget(args)
  if (!parsed.ok) return parsed.reply
  const refusal = await preflightReply(engine, parsed.target, args)
  if (refusal !== undefined) return refusal
  const reply = engine.setTarget(taskId, parsed.target)
  if (!reply.ok) return refused(reply.code, reply.error)
  return json({ ok: true, target: parsed.target, preflight: flag(args.preflight) === false ? 'skipped' : 'passed', hosts: hostViews(engine) })
}

/** One run in the uniform shape, optionally blocking until it settles. */
async function statusResult(engine: SshRunEngine, taskId: string, args: Record<string, unknown>): Promise<Json> {
  const wait = args.wait === true
  const waited = wait ? await engine.waitStatus(taskId, count(args.timeoutMs)) : undefined
  const view = waited?.view ?? engine.statusView(taskId)
  const running = !view.settled && view.phase !== 'none'
  const activity = running && flag(args.activity) !== false ? await engine.activityOf(taskId) : undefined
  return json({
    ok: true,
    ...view,
    ...(waited === undefined ? {} : { timedOut: waited.timedOut }),
    ...(activity === undefined ? {} : { lastActivity: activity }),
    ...(view.settled ? { next: 'The run settled; the verdict is on the card (task_board_get) and the log is still readable with action "log".' } : running ? { next: 'Still running: call status again with wait:true, or read progress with action "log".' } : {}),
  })
}

/** One filtered page of the log, with its cost stated first. */
async function logResult(engine: SshRunEngine, taskId: string, args: Record<string, unknown>): Promise<Json> {
  const runId = text(args.runId)
  const tail = count(args.tail)
  const since = count(args.since)
  const maxBytes = count(args.maxBytes)
  const page = await engine.queryLog(taskId, {
    ...(runId === undefined ? {} : { runId }),
    ...(tail === undefined ? {} : { tail }),
    ...(since === undefined ? {} : { since }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(args.raw === true ? { raw: true } : {}),
    ...(args.statsOnly === true ? { statsOnly: true } : {}),
  })
  if (!page.ok) return json({ ok: false, code: page.code, message: page.error })
  return json({
    ok: true,
    runId: page.runId,
    filtered: page.filtered,
    stats: { rawBytes: page.stats.rawBytes, filteredLines: page.stats.lines, filteredBytes: page.stats.bytes },
    from: page.from,
    lines: page.lines,
    nextSince: page.nextSince,
    more: page.more,
    text: page.text,
  })
}

/** Queue one instruction for the card's remote session. */
async function followUpResult(engine: SshRunEngine, args: Record<string, unknown>): Promise<Json> {
  const taskId = text(args.taskId)
  const rawText = typeof args.text === 'string' ? args.text : ''
  const instruction = rawText.trim()
  if (taskId === undefined) return refused('task-required', 'taskId is required')
  if (instruction === '') return refused('text-required', 'text must be a non-blank instruction')
  if (rawText.length > TASK_BOARD_MESSAGE_MAX_LENGTH) {
    return refused('text-too-long', `text must be at most ${TASK_BOARD_MESSAGE_MAX_LENGTH} characters`)
  }
  const rawKind = args.kind
  if (rawKind !== undefined && rawKind !== 'follow-up' && rawKind !== 'rework') {
    return refused('invalid-kind', 'kind must be "follow-up" or "rework"')
  }
  const kind = rawKind ?? 'follow-up'
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
}

/** The run handle plus, when asked, the settled status: what one `run` answers. */
async function runResult(engine: SshRunEngine, taskId: string, args: Record<string, unknown>): Promise<Json> {
  const reply = await engine.runCard(taskId)
  if (!reply.ok) return refused(reply.code, reply.error)
  const handle = engine.describeRun(taskId)
  const status = args.wait === true ? await statusResult(engine, taskId, args) : undefined
  return json({ ok: true, taskId, ...handle, ...(status === undefined ? {} : { status }) })
}

/** The one surface: every action an agent needs against a remote card. */
function buildUnifiedTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh',
    description: [
      'Run a task board card on a remote host over SSH, end to end, with the fewest calls: task_board_ssh {action:"create", title, prompt, host, workspacePath, run:true, wait:true} creates the card WITH its target, checks the host/agent/directory first, starts the run and blocks until it settles - one call.',
      'Actions: create (new card bound to a target; run:true starts it, wait:true blocks for the verdict), bind (set or replace the target of an existing card), read (current target plus the host aliases), run (start a bound direct card and get its handle: executionId, runId, logPath, target, estimatedDurationMs), status (one uniform shape whether running or settled: phase, exitCode, result, summary, error{code,message,retryHint}, durationMs, remoteSessionId, lastActivityAt, plus lastActivity = the agent\'s last tool call while running; wait:true with timeoutMs blocks until it settles), log (the run log with thinking_tokens/system noise removed; tail N lines or since a cursor, at most 64 KB per reply, stats.filteredLines/filteredBytes tell the cost first; statsOnly:true returns only the counts; raw:true skips the filter), followup (one more instruction for the remote session; kind rework asks again for wrong work).',
      'Choosing a target: direct mode is for self-contained jobs and keeps no local session; proxy mode runs a local session that drives the host and fits work needing local context. in-place edits an existing remote directory; git makes a per-run worktree on branch dsh-task/<runId>. Agents: dsh, claude, codex, custom.',
      'A succeeded run records its conclusion as the execution summary; error carries failures only. ' + CODE_HELP,
    ].join(' '),
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'bind', 'read', 'run', 'status', 'log', 'followup'], description: 'What to do; see the tool description.' },
      taskId: { type: 'string', description: 'Card to act on. Required by every action except create.' },
      title: { type: 'string', description: 'create: card title (one line).' },
      prompt: { type: 'string', description: 'create: the instruction the remote agent runs; the title when blank.' },
      description: { type: 'string', description: 'create: longer human description.' },
      parentId: { type: 'string', description: 'create: parent card id, to make a subtask.' },
      run: { type: 'boolean', description: 'create: start the run right after creating the card.' },
      wait: { type: 'boolean', description: 'create (with run), run and status: block until the run settles or timeoutMs passes.' },
      timeoutMs: { type: 'number', description: 'Longest a wait blocks, in milliseconds (default 120000, at most 600000). A timeout is not a failure: the run keeps going, call status with wait again.' },
      activity: { type: 'boolean', description: 'status: include lastActivity while running (default true).' },
      tail: { type: 'number', description: 'log: last N filtered lines (default 40).' },
      since: { type: 'number', description: 'log: first filtered line to return, the nextSince of an earlier reply.' },
      raw: { type: 'boolean', description: 'log: skip the noise filter.' },
      statsOnly: { type: 'boolean', description: 'log: return only the filtered line count and size.' },
      maxBytes: { type: 'number', description: 'log: cap on the returned text in bytes (default 65536, at most 131072).' },
      runId: { type: 'string', description: 'log: a specific earlier run; the latest when absent.' },
      text: { type: 'string', description: 'followup: the instruction itself.' },
      kind: { type: 'string', enum: ['follow-up', 'rework'], description: 'followup: follow-up adds work; rework asks again for work the previous run got wrong.' },
      ...TARGET_PARAMETERS,
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(rawArgs) {
      const args = rawArgs as Record<string, unknown>
      const action = text(args.action)
      const taskId = text(args.taskId)
      if (action === 'create') {
        const prompt = text(args.prompt) ?? text(args.title)
        const title = text(args.title) ?? (prompt === undefined ? undefined : prompt.split('\n')[0]?.slice(0, 80))
        if (title === undefined || prompt === undefined) return refused('title-required', 'create needs a title or a prompt')
        const parsed = parseTarget(args)
        if (!parsed.ok) return parsed.reply
        const target = parsed.target
        if (flag(args.preflight) !== false) {
          const refusal = await preflightReply(engine, target, args)
          if (refusal !== undefined) return refusal
        }
        const created = await engine.createBound({
          title,
          prompt,
          ...(text(args.description) === undefined ? {} : { description: text(args.description) as string }),
          ...(text(args.parentId) === undefined ? {} : { parentId: text(args.parentId) as string }),
        }, target, { preflight: false })
        if (!created.ok) return refused(created.code, created.error)
        if (args.run !== true) return json({ ok: true, taskId: created.taskId, target, next: 'Start it with task_board_ssh {action:"run"} or task_board_run.' })
        return json({ created: true, ...(await runResult(engine, created.taskId, args) as Record<string, Json>) })
      }
      if (action === 'read' && taskId === undefined) return json({ ok: true, target: null, hosts: hostViews(engine) })
      if (taskId === undefined) return refused('task-required', 'taskId is required')
      switch (action) {
        case 'read': return json({ ok: true, target: engine.targetOf(taskId) ?? null, hosts: hostViews(engine) })
        case 'bind': return await bindResult(engine, taskId, args)
        case 'run': return await runResult(engine, taskId, args)
        case 'status': return await statusResult(engine, taskId, args)
        case 'log': return await logResult(engine, taskId, args)
        case 'followup': return await followUpResult(engine, args)
        default: return refused('unknown-action', 'action must be create, bind, read, run, status, log or followup')
      }
    },
  })
}

/** The target tool (compatibility): read or pin where one card runs. */
function buildTargetTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_target',
    description: 'Compatibility entry of task_board_ssh (actions read and bind). Read or pin the SSH execution target of one task board card; pinning now checks the host, the agent program and the directory first and refuses with a stable code before anything is saved. direct mode starts a headless agent on the host and keeps no local session; proxy mode runs a local session that drives the host. ' + CODE_HELP,
    parameters: {
      action: { type: 'string', required: true, enum: ['read', 'set'], description: 'read reports the current pin and the hosts available; set stores a new pin.' },
      taskId: { type: 'string', required: true, description: 'Card to read or retarget.' },
      ...TARGET_PARAMETERS,
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
      return await bindResult(engine, taskId, args as Record<string, unknown>)
    },
  })
}

/** The status tool (compatibility): one card's remote run, and optionally a page of its log. */
function buildStatusTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_status',
    description: 'Compatibility entry of task_board_ssh (actions status and log). Read the remote run state of one card. `state` is the uniform shape (phase, exitCode, result, summary, error, durationMs, remoteSessionId, lastActivityAt) for a running and a settled run alike; wait:true with timeoutMs blocks until it settles. `status` keeps the older shape with the run history. Pass logOffset/logLimit for one raw byte page of the log, or tail/since for the filtered log (at most 64 KB by default).',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Card whose remote run to inspect.' },
      wait: { type: 'boolean', description: 'Block until the run settles or timeoutMs passes.' },
      timeoutMs: { type: 'number', description: 'Longest a wait blocks, in milliseconds (default 120000, at most 600000).' },
      runId: { type: 'string', description: 'One specific run to read the log of; the active run when absent.' },
      tail: { type: 'number', description: 'Filtered log: last N lines.' },
      since: { type: 'number', description: 'Filtered log: first line to return (nextSince of an earlier reply).' },
      raw: { type: 'boolean', description: 'Filtered log: skip the noise filter.' },
      logOffset: { type: 'number', description: 'Raw byte offset the log page starts at (default 0).' },
      logLimit: { type: 'number', description: 'Largest raw page to return, in bytes (default 65536, at most 131072).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(rawArgs) {
      const args = rawArgs as Record<string, unknown>
      const taskId = text(args.taskId)
      if (taskId === undefined) return refused('task-required', 'taskId is required')
      const state = await statusResult(engine, taskId, args)
      const status = engine.status(taskId)
      const runId = text(args.runId)
      const offset = count(args.logOffset)
      const limit = count(args.logLimit)
      const filtered = count(args.tail) !== undefined || count(args.since) !== undefined
      if (filtered) return json({ ok: true, status, state, log: await logResult(engine, taskId, args) })
      if (runId === undefined && offset === undefined && limit === undefined) return json({ ok: true, status, state })
      const page = await engine.readLog(taskId, {
        ...(runId === undefined ? {} : { runId }),
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
      })
      if (!page.ok) return json({ ok: false, status, state, code: page.code, message: page.error })
      return json({
        ok: true,
        status,
        state,
        log: { runId: page.runId, offset: page.offset, nextOffset: page.nextOffset, bytes: page.bytes, eof: page.eof, text: page.text },
      })
    },
  })
}

/** The follow-up tool (compatibility): one more instruction for the card's remote session. */
function buildFollowUpTool(engine: SshRunEngine): ToolDefinition {
  return defineTool({
    name: 'task_board_ssh_follow_up',
    description: 'Compatibility entry of task_board_ssh (action followup). Send one more instruction to the remote agent session of a task board card. On a card whose run is still going the instruction waits for that run to finish and then continues the same remote session; on a settled card it re-enters the card run with the earlier session resumed. An agent that cannot resume degrades to a fresh run that carries the previous summary, which the execution record says.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Card whose remote session receives the instruction.' },
      text: { type: 'string', required: true, description: 'The instruction itself.' },
      kind: { type: 'string', enum: ['follow-up', 'rework'], description: 'follow-up adds work; rework asks again for work the previous run got wrong. Defaults to follow-up.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      return await followUpResult(engine, args as Record<string, unknown>)
    },
  })
}

/**
 * Build every tool this extension registers.
 * @param engine - the live run engine behind them.
 * @returns the tool definitions, in registration order.
 */
export function buildSshTools(engine: SshRunEngine): ToolDefinition[] {
  return [buildUnifiedTool(engine), buildTargetTool(engine), buildStatusTool(engine), buildFollowUpTool(engine)]
}

/** Re-exported for the specs: the modes a target may pin and the stable preflight codes. */
export type { SshExecutionMode }
export { SSH_PREFLIGHT_CODES }
