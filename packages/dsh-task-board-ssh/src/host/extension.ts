/**
 * The SSH provider assembled as one task-board extension.
 *
 * Everything SSH-specific lives behind this factory: the board admits it through
 * the cordis `taskBoard` service, hands it the capability face, and never learns
 * what the provider does with it. The factory imports no board internals — only
 * the same-shape contract in `../core/contract.ts` — and it probes the two seams
 * a board revision may or may not serve (`launch.intercept` and the in-process
 * action seat) instead of assuming them, so a board that serves neither still
 * mounts this extension: its tools answer, its polls stop, and the reason is
 * logged rather than thrown at the board.
 *
 * @module dsh-task-board-ssh/host/extension
 */
import { parseSshActionRequest, type SshActionReply } from '../core/action.ts'
import {
  TASK_BOARD_API_VERSION,
  type DshSshService,
  type TaskBoardExtension,
  type TaskBoardExtensionActionRequest,
  type TaskBoardExtensionHost,
} from '../core/contract.ts'
import { SSH_AGENT_KINDS, type SshAgentKind, type SshExecutionMode } from '../core/target.ts'
import type { BoardActionSeat } from './board.ts'
import { SshRunEngine, type SshEngineReply, type SshLogPage } from './engine.ts'
import {
  SshSettingsError,
  type SshProviderSettings,
  type SshSettingsPatch,
  type SshSettingsWriter,
} from './settings.ts'
import type { HostTimerFace } from './timers.ts'
import { buildSshTools } from './tools.ts'
import type { SshWorkspaceStrategyResolver } from './workspace-seam.ts'

/** Extension id this provider registers under, and the key of its ledger payload. */
export const SSH_EXTENSION_ID = 'ssh'

/**
 * Actions this package handles on top of the frozen card protocol.
 *
 * The six card actions are the board's own vocabulary and are parsed by
 * `src/core/action.ts`. These three are host-half additions a settings card or a
 * log viewer drives: the log pager (a remote file read by offset, never a new
 * HTTP route) and the configuration read/write pair, whose write goes through the
 * extension's single write path and therefore through `ctx.settings.mutate`.
 */
export const SSH_HOST_ACTIONS = {
  /** Read one page of a run's log by byte offset. */
  readLog: 'read-log',
  /** Read the extension's effective settings. */
  setupStatus: 'setup-status',
  /** Write the extension's settings through the one write path. */
  setupSave: 'setup-save',
} as const

/** Everything the extension needs from its mount. */
export interface SshExtensionOptions {
  /** The `dshSsh` forwarder every remote operation goes through. */
  ssh: DshSshService
  /** Live configuration, read at use time. */
  settings: () => SshProviderSettings
  /** The one configuration write path. */
  settingsWriter: SshSettingsWriter
  /** Timer seat the poll cadence runs on. */
  timers: HostTimerFace
  /** The board's in-process action seat, resolved per call so a late one is honoured. */
  seat?: () => BoardActionSeat | undefined
  /** Placement strategies, when this deployment serves any. */
  workspaces?: SshWorkspaceStrategyResolver
  /** Resolve a local workspace id to the repository root a git run bundles. */
  localRepository?: (workspaceId: string) => string | undefined
  /** Clock (ms epoch). */
  now?: () => number
  /** Identifier source for request ids and run ids. */
  uuid?: () => string
  /** Poll cadence, in milliseconds. */
  pollIntervalMs?: number
  /** Ceiling for one remote command, in milliseconds. */
  commandTimeoutMs?: number
  /** Where a refusal or a failed remote call is reported. */
  log?: (message: string, detail?: unknown) => void
}

/** The message of anything thrown below. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read one plain object off an untyped payload. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Read one bounded non-negative integer option. */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

/** Read the log pager's options out of an action payload. */
function readLogOptions(payload: Record<string, unknown>): { runId?: string; offset?: number; limit?: number } {
  const options: { runId?: string; offset?: number; limit?: number } = {}
  if (typeof payload.runId === 'string' && payload.runId !== '') options.runId = payload.runId
  const offset = optionalNumber(payload.offset)
  if (offset !== undefined) options.offset = offset
  const limit = optionalNumber(payload.limit)
  if (limit !== undefined) options.limit = limit
  return options
}

/** One validated settings patch, or the reason it was refused. */
type SettingsPatchResult = { ok: true; patch: SshSettingsPatch } | { ok: false; error: string }

/** Read one settings patch out of an action payload, refusing a malformed field. */
function readSettingsPatch(payload: Record<string, unknown>): SettingsPatchResult {
  const patch: SshSettingsPatch = {}
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' }
    patch.enabled = payload.enabled
  }
  if (payload.defaultHost !== undefined) {
    if (typeof payload.defaultHost !== 'string') return { ok: false, error: 'defaultHost must be a string' }
    patch.defaultHost = payload.defaultHost
  }
  if (payload.defaultAgent !== undefined) {
    if (!(SSH_AGENT_KINDS as readonly string[]).includes(String(payload.defaultAgent))) {
      return { ok: false, error: `defaultAgent must be one of: ${SSH_AGENT_KINDS.join(', ')}` }
    }
    patch.defaultAgent = String(payload.defaultAgent) as SshAgentKind
  }
  if (payload.defaultMode !== undefined) {
    if (payload.defaultMode !== 'direct' && payload.defaultMode !== 'proxy') {
      return { ok: false, error: 'defaultMode must be "direct" or "proxy"' }
    }
    patch.defaultMode = payload.defaultMode as SshExecutionMode
  }
  if (payload.perHostCap !== undefined) {
    if (typeof payload.perHostCap !== 'number' || !Number.isFinite(payload.perHostCap)) {
      return { ok: false, error: 'perHostCap must be a number' }
    }
    patch.perHostCap = payload.perHostCap
  }
  if (payload.agentCommands !== undefined) {
    if (!Array.isArray(payload.agentCommands)) return { ok: false, error: 'agentCommands must be an array' }
    const rows: Array<{ kind: SshAgentKind; command: string; resumeCommand?: string }> = []
    for (const entry of payload.agentCommands) {
      const row = recordOf(entry)
      const kind = (SSH_AGENT_KINDS as readonly string[]).includes(String(row.kind)) ? String(row.kind) as SshAgentKind : undefined
      if (kind === undefined) return { ok: false, error: `an agentCommands row names an unknown agent: ${String(row.kind)}` }
      if (typeof row.command !== 'string') return { ok: false, error: 'an agentCommands row needs a command template' }
      rows.push({
        kind,
        command: row.command,
        ...(typeof row.resumeCommand === 'string' ? { resumeCommand: row.resumeCommand } : {}),
      })
    }
    patch.agentCommands = rows
  }
  return { ok: true, patch }
}

/** Route one action to the engine and the settings writer. */
async function routeAction(
  request: TaskBoardExtensionActionRequest,
  engine: SshRunEngine | undefined,
  writer: SshSettingsWriter,
): Promise<unknown> {
  const payload = recordOf(request.payload)
  switch (request.action) {
    case SSH_HOST_ACTIONS.readLog: {
      if (engine === undefined) return { ok: false, error: 'the SSH extension is not running' }
      if (typeof request.taskId !== 'string' || request.taskId === '') return { ok: false, error: 'read-log needs a taskId' }
      const page: SshLogPage = await engine.readLog(request.taskId, readLogOptions(payload))
      return page
    }
    case SSH_HOST_ACTIONS.setupStatus: {
      return {
        ok: true,
        writable: writer.available(),
        settings: engine === undefined ? null : engine.summary().defaults,
      }
    }
    case SSH_HOST_ACTIONS.setupSave: {
      const parsed = readSettingsPatch(payload)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      try {
        const result = await writer.save(parsed.patch)
        return { ok: true, entry: result.entry, fields: result.fields }
      } catch (error) {
        return {
          ok: false,
          code: error instanceof SshSettingsError ? error.code : 'settings-write-failed',
          error: messageOf(error),
        }
      }
    }
    default:
      break
  }
  if (engine === undefined) return { ok: false, error: 'the SSH extension is not running' }
  const parsed = parseSshActionRequest(request)
  if (!parsed.ok) {
    const reply: SshActionReply = { ok: false, error: 'the request was refused', issues: parsed.errors }
    return reply
  }
  const action = parsed.value
  let reply: SshEngineReply
  switch (action.action) {
    case 'run':
      reply = engine.runNow(action.taskId)
      break
    case 'cancel':
      reply = engine.cancel(action.taskId)
      break
    case 'follow-up':
      reply = await engine.instruct(action.taskId, action.text, 'follow-up')
      break
    case 'rework':
      reply = await engine.instruct(action.taskId, action.instructions, 'rework')
      break
    case 'set-target':
      reply = engine.setTarget(action.taskId, action.target)
      break
    default:
      reply = await engine.refresh(action.taskId)
      break
  }
  const answer: SshActionReply = reply.ok
    ? {
        ok: true,
        taskId: reply.taskId,
        ...(reply.runId === undefined ? {} : { runId: reply.runId }),
        ...(reply.message === undefined ? {} : { message: reply.message }),
      }
    : { ok: false, error: reply.error }
  return answer
}

/**
 * Build the SSH provider extension.
 * @param options - the mount's faces, settings and clock.
 * @returns the extension the board registers.
 */
export function createSshExtension(options: SshExtensionOptions): TaskBoardExtension {
  let engine: SshRunEngine | undefined
  const toolDisposers: Array<() => void> = []
  const log = options.log ?? ((message: string, detail?: unknown) => {
    if (detail === undefined) console.error('[dsh-task-board-ssh] ' + message)
    else console.error('[dsh-task-board-ssh] ' + message, detail)
  })

  return {
    id: SSH_EXTENSION_ID,
    apiVersion: TASK_BOARD_API_VERSION,
    enabled: () => options.settings().enabled,
    start(host: TaskBoardExtensionHost): void {
      const live = new SshRunEngine({
        host,
        ssh: options.ssh,
        timers: options.timers,
        settings: options.settings,
        ...(options.seat === undefined ? {} : { seat: options.seat }),
        ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
        ...(options.localRepository === undefined ? {} : { localRepository: options.localRepository }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
        ...(options.commandTimeoutMs === undefined ? {} : { commandTimeoutMs: options.commandTimeoutMs }),
        log,
      })
      engine = live
      live.start()
      for (const tool of buildSshTools(live)) {
        try {
          toolDisposers.push(host.registerTool(tool))
        } catch (error) {
          // A missing tool registry costs the three tools, not the provider.
          log(`the tool ${tool.name} could not register`, error)
        }
      }
      try {
        host.publish(live.summary())
      } catch (error) {
        log('the initial summary was refused', error)
      }
    },
    stop(): void {
      for (const dispose of toolDisposers.splice(0)) {
        try { dispose() } catch { /* best-effort */ }
      }
      engine?.stop()
      engine = undefined
    },
    async handleAction(request: TaskBoardExtensionActionRequest): Promise<unknown> {
      return await routeAction(request, engine, options.settingsWriter)
    },
  }
}
