/**
 * The provider mounted on the real board, the way a Host mounts it.
 *
 * Everything the provider is given is either the production board or an
 * injectable seat a deployment really owns — the timer face, the settings
 * surface, the placement strategies — so a spec drives the real extension
 * factory, the real action routing, the real tools and the real engine.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DshSshService, TaskBoardExtension, TaskBoardExtensionHost } from '../../src/core/contract.ts'
import { readBoardActionSeat } from '../../src/host/board.ts'
import { createSshExtension } from '../../src/host/extension.ts'
import {
  DEFAULT_SSH_SETTINGS,
  SshSettingsWriter,
  type SettingsFace,
  type SshProviderSettings,
} from '../../src/host/settings.ts'
import type { SshWorkspaceStrategyResolver } from '../../src/host/workspace-seam.ts'
import type { BoardHarness } from './board.ts'
import { createManualTimers, flush, type ManualTimers } from './timers.ts'

/** How one spec mounts the provider. */
export interface MountOptions {
  /** The real board the provider registers with. */
  board: BoardHarness
  /** The `dshSsh` face the engine drives. */
  ssh: DshSshService
  /** Configuration overrides on top of the shipped defaults. */
  settings?: Partial<SshProviderSettings>
  /** Placement strategies; a spec always supplies one. */
  workspaces?: SshWorkspaceStrategyResolver
  /** Resolve a local workspace id to the repository root a git run bundles. */
  localRepository?: (workspaceId: string) => string | undefined
  /** Timer seat; a fresh manual one when absent. */
  timers?: ManualTimers
  /** The settings surface this deployment serves, when it serves one. */
  settingsFace?: SettingsFace
  /** Clock the engine reads. */
  now?: () => number
  /** Identifier source for request and run ids. */
  uuid?: () => string
  /** Poll cadence, in milliseconds. */
  pollIntervalMs?: number
  /** Subscribe a tool to the board's registry, to observe when it is released. */
  toolRegistry?: { names: Set<string> }
  /** Where the provider's own refusals are reported; silent by default. */
  log?: (message: string, detail?: unknown) => void
}

/** One mounted provider. */
export interface Mounted {
  /** The extension the board admitted. */
  extension: TaskBoardExtension
  /** The live settings object the extension reads (mutable, so a spec models a write). */
  settings: SshProviderSettings
  /** The timer seat behind the poll cadence. */
  timers: ManualTimers
  /** Tool definitions the extension registered, by name. */
  tools: Map<string, ToolDefinition>
  /** Tool names the deployment's registry currently holds. */
  registered: Set<string>
  /** The last summary the extension published. */
  published(): Record<string, unknown> | undefined
  /** Advance the poll clock by one cadence and let everything it woke settle. */
  tick(ms?: number): Promise<void>
  /** Release the extension from the board. */
  release(): void
}

/** Poll cadence a spec advances by one tick. */
export const TICK_MS = 1_000

/**
 * Run one registered tool the way the model runtime would.
 * @param mounted - the mounted provider.
 * @param name - tool to run.
 * @param args - its arguments.
 * @returns the value the tool answered.
 */
export async function runTool(mounted: Mounted, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = mounted.tools.get(name)
  if (tool === undefined) throw new Error('the extension registered no tool named ' + name)
  return await tool.execute(args as never, {} as never) as Record<string, unknown>
}

/**
 * Mount the provider on the board.
 * @param options - the board, the ssh face and the deployment's seats.
 * @returns the mounted provider.
 */
export function mountEngine(options: MountOptions): Mounted {
  const timers = options.timers ?? createManualTimers(0)
  const settings: SshProviderSettings = { ...DEFAULT_SSH_SETTINGS, ...options.settings }
  const settingsWriter = new SshSettingsWriter(() => options.settingsFace)
  const tools = new Map<string, ToolDefinition>()
  const registered = options.toolRegistry?.names ?? new Set<string>()
  let published: Record<string, unknown> | undefined
  let sequence = 0
  const extension = createSshExtension({
    ssh: options.ssh,
    settings: () => settings,
    settingsWriter,
    timers: timers.face,
    seat: () => readBoardActionSeat(options.board.board),
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
    ...(options.localRepository === undefined ? {} : { localRepository: options.localRepository }),
    ...(options.now === undefined ? {} : { now: options.now }),
    uuid: options.uuid ?? (() => { sequence += 1; return 'id-' + String(sequence) }),
    pollIntervalMs: options.pollIntervalMs ?? TICK_MS,
    log: options.log ?? (() => { /* a spec asserts on state, not on the provider's own chatter */ }),
  })
  const decorated: TaskBoardExtension = {
    ...extension,
    start(host: TaskBoardExtensionHost) {
      const face: TaskBoardExtensionHost = {
        ...host,
        registerTool: definition => {
          tools.set(definition.name, definition)
          const dispose = host.registerTool(definition)
          return () => {
            tools.delete(definition.name)
            dispose()
          }
        },
        publish: summary => {
          published = summary
          host.publish(summary)
        },
      }
      extension.start?.(face)
    },
  }
  if (options.toolRegistry !== undefined) {
    options.board.board.extensions.setToolRegistry(() => ({
      register: (definition: ToolDefinition) => {
        registered.add(definition.name)
        return () => { registered.delete(definition.name) }
      },
    }))
  }
  const release = options.board.board.registerExtension(decorated)
  return {
    extension,
    settings,
    timers,
    tools,
    registered,
    published: () => published,
    async tick(ms = TICK_MS) {
      timers.advance(ms)
      await flush()
      await flush()
    },
    release() {
      release()
      timers.dispose()
    },
  }
}
