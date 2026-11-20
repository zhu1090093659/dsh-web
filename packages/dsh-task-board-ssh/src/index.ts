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
import { resolveBoardActionSeat } from './host/board.ts'
import { SSH_EXTENSION_ID, createSshExtension } from './host/extension.ts'
import { mountOnce } from './mount-once.ts'
import {
  parseSshSettings,
  readSettingsFace,
  SshSettingsWriter,
  type SettingsFace,
  type SshProviderSettings,
} from './host/settings.ts'
import { processTimers } from './host/timers.ts'
import { createSshWorkspaceStrategy } from './host/workspace/index.ts'
import {
  readWorkspaceDirectory,
  resolveWorkspaceRegistry,
  type SshWorkspaceStrategyResolver,
} from './host/workspace-seam.ts'

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

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only.
     * @param paths - the changed config paths, as key arrays.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
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
 *
 * The switch in that scope is this row's own volatile field, so it is re-derived
 * here rather than by the board: the Loader commits a settings write into the
 * running fiber and announces `loader/volatile-update` on this fiber, and this
 * row tears its provider down (engine stopped, tools and launch handler
 * withdrawn, published summary gone) or builds it again from that announcement.
 * No card data is touched on the way out, exactly as the board's own switch
 * semantics promise.
 * @param ctx - the plugin context.
 * @param config - resolved plugin config.
 */
function applyImpl(ctx: Context, config?: Config): void {
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

  let injection: ReturnType<Context['inject']> | undefined
  let notifySettings: (() => void) | undefined
  let disposed = false

  /**
   * Release the provider: its engine stops, its tools and launch handler are
   * withdrawn with the registration, and the summary it published leaves the
   * board snapshot with the entry. Every card keeps its data.
   */
  const teardownProvider = async (): Promise<void> => {
    const current = injection
    injection = undefined
    if (current !== undefined) await current.dispose()
  }

  /** Admit the provider again, once, against the services as they stand now. */
  const mountProvider = (): void => {
    if (disposed || injection !== undefined) return
    injection = ctx.inject(['taskBoard', 'dshSsh'], (scope: Context) => {
      scope.effect(() => {
        const board = resolveTaskBoardHostFace(scope)
        const ssh = resolveDshSshService(scope)
        if (board === undefined || ssh === undefined) return () => {}
        // The placement strategies are assembled behind one entry
        // (`src/host/workspace/index.ts`), which is the only thing this file knows
        // about them: the engine holds the frozen `SshWorkspaceStrategy` from
        // `src/core/workspace.ts` and never a strategy implementation.
        const workspaces: SshWorkspaceStrategyResolver = target => createSshWorkspaceStrategy(target)
        // A git run whose repository is the local workspace needs that
        // repository's directory, and the deployment's workspace registry is the
        // only thing that knows it. The same service the board resolves for its
        // own runs, read optionally: a deployment without it keeps mounting, and
        // a run pinned to a local workspace then fails with the strategy's own
        // "was not resolved".
        const localRepository = (workspaceId: string): string | undefined =>
          readWorkspaceDirectory(resolveWorkspaceRegistry(scope), workspaceId)
        const dispose = board.registerExtension(createSshExtension({
          ssh,
          settings,
          settingsWriter,
          timers: processTimers,
          // The applier belongs to the board service, not to the read face this
          // package restates, so it is resolved off the same service by name.
          seat: () => resolveBoardActionSeat(scope),
          workspaces,
          localRepository,
          onSettingsHook: hook => { notifySettings = hook },
        }))
        return () => { dispose() }
      }, 'task-board-ssh: provider registration')
    })
  }

  /** Bring the provider in line with the switch, waiting out any release first. */
  const sync = async (): Promise<void> => {
    if (disposed) return
    if (!settings().enabled) {
      await teardownProvider()
      return
    }
    if (injection === undefined) {
      mountProvider()
    } else {
      // Volatile setting edits (e.g. raising perHostCap or changing defaults)
      // wake queued runs and refresh the published summary immediately.
      notifySettings?.()
    }
  }

  // A settings write and a lifecycle step can arrive together, and a re-mount
  // must not race the unload of the scope it replaces: one step at a time.
  let chain: Promise<void> = Promise.resolve()
  const requestSync = (): void => {
    chain = chain.then(() => sync()).catch(error => {
      console.error('[dsh-task-board-ssh] the provider could not be re-derived from its settings', error)
    })
  }

  ctx.on('loader/volatile-update', () => { requestSync() })

  ctx.effect(() => {
    requestSync()
    return () => {
      disposed = true
      void teardownProvider()
    }
  }, 'task-board-ssh: provider lifecycle')
}

export const apply = mountOnce(PACKAGE_NAME, applyImpl)
