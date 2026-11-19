/**
 * Host half of the task-board SSH provider extension.
 *
 * The row registers one provider with the task board: a card that pins a
 * `dsh-ssh` host runs on that host instead of in a local session. Both services
 * it needs are taken through one cordis dependency scope, so a deployment that
 * serves neither — or mounts them later — keeps starting normally and gains the
 * provider the moment both are there, with nothing registered before then.
 *
 * What this file owns and nothing else does: the Config schema (every field
 * `volatile()`, so a settings edit binds the next run without a restart), the
 * scope wiring, and the single configuration write path. The engine, its remote
 * operations, its tools and its action routing live in `src/host/`.
 *
 * @module dsh-task-board-ssh
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshSshService, resolveTaskBoardHostFace } from './core/contract.ts'
import { SSH_AGENT_KINDS, type SshAgentKind, type SshExecutionMode } from './core/target.ts'
import { readBoardActionSeat } from './host/board.ts'
import { SSH_EXTENSION_ID, createSshExtension } from './host/extension.ts'
import {
  parseSshSettings,
  readSettingsFace,
  SshSettingsWriter,
  type SettingsFace,
  type SshProviderSettings,
} from './host/settings.ts'
import { processTimers } from './host/timers.ts'
import { createSshWorkspaceStrategy } from './host/workspace/index.ts'
import type { SshWorkspaceStrategyResolver } from './host/workspace-seam.ts'

export { SSH_EXTENSION_ID }

/**
 * npm identity of this package. The host single-instance guard keys on it, so an
 * aggregate install and a standalone install do not double-register.
 */
export const PACKAGE_NAME = '@linxin666/dsh-client-ui-task-board-ssh'

/** One configured agent command override. */
export interface SshAgentCommandInput {
  /** Agent CLI the override applies to. */
  kind: SshAgentKind
  /** Start template; must reference `{prompt_file}`. */
  command: string
  /** Resume template; without one a follow-up runs fresh. */
  resumeCommand?: string
}

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch of the extension. */
  enabled?: Volatile<boolean>
  /** Host alias a card opens with. */
  defaultHost?: Volatile<string>
  /** Agent CLI a card opens with. */
  defaultAgent?: Volatile<SshAgentKind>
  /** Execution mode a card opens with. */
  defaultMode?: Volatile<SshExecutionMode>
  /** How many runs one host executes at once. */
  perHostCap?: Volatile<number>
  /** Per-agent command templates that replace the built-in command line. */
  agentCommands?: Volatile<SshAgentCommandInput[]>
}

/** Profile-patch shape of {@link Config}. */
export interface ConfigInput {
  enabled?: boolean
  defaultHost?: string
  defaultAgent?: SshAgentKind
  defaultMode?: SshExecutionMode
  perHostCap?: number
  agentCommands?: SshAgentCommandInput[]
}

/** Schema of one configured agent command override. */
const AgentCommandSchema = z.object({
  kind: z.union(SSH_AGENT_KINDS).default('dsh'),
  command: z.string().default(''),
  resumeCommand: z.string().default(''),
})

/**
 * Every configuration field is volatile: a write is committed into the running
 * fiber, and every consumer here reads it at use time, so the next admission,
 * the next run and the next tool call all see the new value without a remount.
 */
export const Config: z<ConfigInput, Config> = z.object({
  enabled: z.boolean().default(true).volatile(),
  defaultHost: z.string().default('').volatile(),
  defaultAgent: z.union(SSH_AGENT_KINDS).default('dsh').volatile(),
  defaultMode: z.union(['direct', 'proxy'] as const).default('direct').volatile(),
  perHostCap: z.number().min(1).max(16).default(2).volatile(),
  agentCommands: z.array(AgentCommandSchema).default([]).volatile(),
})

/**
 * Activate the extension's host half.
 *
 * Registration lives behind one cordis dependency scope over both services the
 * provider needs, because the Host loads plugin rows in an order this package
 * does not own: either service may genuinely not exist yet when this row
 * activates, and the scope mounts when both appear and unloads when either is
 * withdrawn. Nothing is registered while it is down.
 * @param ctx - the plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config?: Config): void {
  const settings = (): SshProviderSettings => parseSshSettings(config)

  // The settings surface is optional: a deployment that serves none keeps the
  // extension running, and only configuration writes are refused, by name.
  let settingsFace: SettingsFace | undefined
  ctx.inject(['settings'], (scope: Context) => {
    scope.effect(() => {
      const face = readSettingsFace((scope as unknown as { settings?: unknown }).settings)
      if (face === undefined) return () => {}
      settingsFace = face
      return () => { settingsFace = undefined }
    }, 'task-board-ssh: settings surface')
  })

  // The one configuration write path: every caller composes a patch and hands it
  // here, and here is the only place that reaches `ctx.settings.mutate`.
  const settingsWriter = new SshSettingsWriter(() => settingsFace)

  ctx.inject(['taskBoard', 'dshSsh'], (scope: Context) => {
    scope.effect(() => {
      const board = resolveTaskBoardHostFace(scope)
      const ssh = resolveDshSshService(scope)
      if (board === undefined || ssh === undefined) return () => {}
      // The placement strategies are assembled behind one entry
      // (`src/host/workspace/index.ts`), which is the only thing this file knows
      // about them: the engine holds the frozen `SshWorkspaceStrategy` from
      // `src/core/workspace.ts` and never a strategy implementation.
      const workspaces: SshWorkspaceStrategyResolver = target => createSshWorkspaceStrategy(target)
      const dispose = board.registerExtension(createSshExtension({
        ssh,
        settings,
        settingsWriter,
        timers: processTimers,
        seat: () => readBoardActionSeat(board),
        workspaces,
      }))
      return () => { dispose() }
    }, 'task-board-ssh: provider registration')
  })
}
