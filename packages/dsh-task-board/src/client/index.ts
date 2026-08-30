/**
 * Task-board client plugin: wires the framework-free core (controller,
 * execution service, store) to the real client runtime and mounts the two
 * DOM surfaces — the sidebar entry row and the board view in the center
 * column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BoardController } from '../core/controller.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { claimTaskboardApply, releaseTaskboardApply } from './apply-guard.ts'
import { mountBoard } from './board-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, zh, type TaskBoardKey } from './locales.ts'
import { HttpTaskBoardHostTransport } from './host-api.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

/** Locale namespace this plugin owns. */
const NS = 'task-board'

/** Settings namespace the settings card edits (the Host plugin registers it). */
const TASK_BOARD_NS = 'task-board'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-board surface copy. */
    'task-board': TaskBoardKey
  }

  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}


/**
 * Required services (fiber inject waiting — the runtime must be up first).
 * The generated remote faces are probed at use time instead of injected:
 * `remote.agentPresets` only registers on 0.1.2-alpha.1 hosts (the
 * api-remotes contribution), so a hard wait would pend the entry forever
 * on hosts below that cohort, which serve the same roster through the
 * connection RPC face.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'locale', 'remote']

/** One agent-preset row the mode picker consumes (either face's wire shape). */
interface PresetRosterRow {
  id: string
  name?: string
  description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  broken?: string
  isDefault: boolean
}

/**
 * Read the agent-preset roster through whichever face the running host
 * serves: the generated api-remotes face (`remote.agentPresets`,
 * 0.1.2-alpha.1) or the connection RPC face
 * (`connection.api.agentPresets`, hosts below that cohort). Answers
 * undefined when the host serves neither, so the caller leaves the picker
 * options untouched instead of erroring.
 */
async function readPresetRoster(
  ctx: ClientContext,
  remote: ClientRemote,
): Promise<{ ok: boolean; presets: readonly PresetRosterRow[] } | undefined> {
  // The cordis `remote` proxy throws on a property that was never injected
  // ("cannot get property X without inject") rather than returning undefined,
  // so the probe must guard the access — a hard read would abort mounting on
  // hosts below the 0.1.2-alpha.1 cohort instead of degrading to the legacy
  // connection RPC face below.
  let remotes: ClientRemote['agentPresets'] | undefined
  try {
    remotes = (remote as Partial<ClientRemote>).agentPresets
  } catch {
    remotes = undefined
  }
  if (remotes !== undefined) {
    const response = await remotes.list()
    if (!response.ok) return { ok: false, presets: [] }
    return { ok: true, presets: response.value.presets }
  }
  const connection = ctx.get('connection') as unknown as {
    api?: { agentPresets?: { list(request: Record<string, never>): Promise<{ result: { ok: boolean; value?: { presets?: readonly PresetRosterRow[] } } }> } }
  }
  const legacy = connection.api?.agentPresets
  if (legacy === undefined) return undefined
  const response = await legacy.list({})
  if (!response.result.ok || response.result.value === undefined) return { ok: false, presets: [] }
  return { ok: true, presets: response.result.value.presets ?? [] }
}

/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-task-board' }])

  // A duplicated client injection (module factory executed twice in one page
  // lifetime) would otherwise mount a second sidebar entry and board view.
  // First application wins; later calls become no-ops (see apply-guard.ts).
  if (!claimTaskboardApply()) return

  // Release the claim when this fiber unloads (the loader supports plugin
  // unloads / hot-reloads), so a rebuilt bundle can claim again in the same
  // page instead of being silently dropped.
  ctx.effect(() => releaseTaskboardApply, 'task-board: apply claim')

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'task-board: dictionaries')

  // Plugin configuration card: one staged form over the `task-board` settings
  // namespace, contributed to the Web UI plugin group.
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<TaskBoardSettings>({ namespace: TASK_BOARD_NS })
  const settingsCard = new TaskBoardSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'web-ui.plugin.item',
        id: 'task-board',
        order: 110,
        locale: NS,
        inject: () => settingsCard.inject(),
      }, TaskBoardSettingsCard)
      return () => {
        settingsCard.dispose()
        unregister()
      }
    } catch {
      return () => {}
    }
  })

  // The sidebar entry and board view mount once the settings scope settles;
  // while the scope is still loading, the composition default is unknown, so
  // nothing mounts yet. Only an unavailable scope (no settings surface served)
  // falls back to the composition default (enabled).
  let uiDisposer: (() => void) | undefined
  const mountUi = (): void => {
    if (uiDisposer !== undefined) return
    // Host and browser SDK declarations share the Cordis Context name. Read
    // the browser faces explicitly so Host-side declaration merging cannot
    // narrow these two client services during a combined package build.
    const sessions = ctx.get('sessions') as unknown as ISessions
    const workspaces = ctx.get('workspaces') as unknown as IWorkspaces
    const remote = ctx.get('remote') as unknown as ClientRemote

    // Core wiring: real runtime faces into the framework-free services.
    const store = new LocalStorageTaskStore()
    const controller = new BoardController({
      store,
      transport: new HttpTaskBoardHostTransport(),
      sessions: {
        list: sessions.list,
        open: id => sessions.open(id as SessionId),
      },
    })
    controller.start()

    const disposers: Array<() => void> = []

    // Execution-target option feeds: the workspace list drives the workspace
    // picker, and the agent-preset roster drives the mode picker. Both are
    // runtime facts (not ledger state), so the wiring pushes them into the
    // controller on change; the preset roster is re-read after reconnects
    // because a reconnect may serve a different deployment.
    const pushWorkspaceOptions = (): void => {
      const snapshot = workspaces.list.getSnapshot()
      controller.setExecutionOptions({
        workspaces: snapshot.items.map(item => ({
          workspaceId: item.workspaceId,
          title: item.title !== '' ? item.title : item.path,
        })),
      })
    }
    pushWorkspaceOptions()
    disposers.push(workspaces.list.subscribe(pushWorkspaceOptions))
    const pushPresetOptions = async (): Promise<void> => {
      try {
        const roster = await readPresetRoster(ctx, remote)
        if (roster === undefined || !roster.ok) return
        controller.setExecutionOptions({
          presets: roster.presets.map(preset => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            broken: preset.broken,
            isDefault: preset.isDefault,
          })),
        })
      } catch (error) {
        // A failed roster read leaves the previous options in place; the
        // picker stays usable and the next reconnect retries the read.
        console.error('[dsh-task-board] agent preset roster read failed', error)
      }
    }
    void pushPresetOptions()
    disposers.push(ctx.on('connection/reset', () => { void pushPresetOptions() }))
    try {
      disposers.push(mountSidebarEntry(controller))
      disposers.push(mountBoard(controller))
    } catch (error) {
      // DOM failures degrade the board, never the GUI.
      console.error('[dsh-task-board] mount failed:', error)
    }

    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      controller.dispose()
      uiDisposer = undefined
    }
  }
  const syncEnabled = (): void => {
    const snapshot = settingsScope.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) mountUi()
    else uiDisposer?.()
  }
  settingsScope.subscribe(syncEnabled)
  syncEnabled()
}
