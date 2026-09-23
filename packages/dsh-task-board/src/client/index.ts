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
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the workspace plugin's Context merge (ctx.uiWorkspace), the
// multi-instance navigation face that replaced ISessions.open().
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BoardController } from '../core/controller.ts'
import { mainViewSessionId } from './main-session.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { claimTaskboardApply, releaseTaskboardApply } from './apply-guard.ts'
import { mountBoard } from './board-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, zh, setRuntimeTranslate, type TaskBoardKey } from './locales.ts'
import { HttpTaskBoardHostTransport } from './host-api.ts'
import { reportDailyHeartbeat } from './telemetry.ts'
import { installPluginCard } from './plugin-card-seat.ts'

/** Locale namespace this plugin owns. */
const NS = 'task-board'

/** Settings namespace this card edits (the family identity of the plugin's own settings form). */
const TASK_BOARD_NS = 'task-board'

/**
 * Profile entry id the family aggregate's generated row carries — the
 * deployment shape nearly every user runs. Under 0.1.7 a settings form is
 * addressed by profile entry id, so the shared-forms fallback below has to
 * name it; the family binder resolves the family namespace instead.
 */
const AGGREGATE_ENTRY_ID = 'web-ui-task-board'

/**
 * Profile entry ids this package's two patch rows carry: the aggregate's
 * generated row and the standalone bundle patch's row (`ui-task-board`), plus
 * the bare namespace as the last resort for a Host whose descriptor is keyed
 * by the family namespace itself.
 */
const TASK_BOARD_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, 'ui-task-board', TASK_BOARD_NS]

/** Domain-owned description of one settings namespace a family card binds. */
export interface SettingsFormSpec<T> {
  /** Settings namespace the card edits. */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the last accepted value. The
   * shared form already resolves the namespace's own serialized wire schema,
   * so a decoder exists only to narrow beyond that schema.
   */
  decode?: (section: unknown) => T | undefined
}

/**
 * The family settings binder published by dsh-web-settings. Its `bind` resolves
 * a family namespace to the profile entry id that owns it and hands back the
 * shared configuration form, so it is the only seat that can reach this card's
 * form on a Host whose row id is not the namespace.
 */
export interface SettingsFormBinder {
  /** Bind one family settings namespace. */
  bind<T>(spec: SettingsFormSpec<T>): ConfigForm<T>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-board surface copy. */
    'task-board': TaskBoardKey
  }

  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group's list seat rather than the official
     * bundle-configuration seat. Spelled here with the same shape so this
     * package can register without depending on the sibling UI package.
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
     * Optional family settings binder provided by dsh-web-settings; absent
     * when that group plugin is not installed, so callers fall back to the
     * shared configuration forms service.
     */
    webUiSettings?: SettingsFormBinder
  }
}


/**
 * Required services (fiber inject waiting — the runtime must be up first).
 * The generated remote faces are probed at use time instead of injected:
 * `remote.agentPresets` only registers on 0.1.2-alpha.2 hosts (the
 * api-remotes contribution), so a hard wait would pend the entry forever
 * on hosts below that cohort, which serve the same roster through the
 * connection RPC face.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'configForms', 'locale', 'remote', 'remote.session', 'uiWorkspace']

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
 * 0.1.2-alpha.2) or the connection RPC face
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
  // hosts below the 0.1.2-alpha.2 cohort instead of degrading to the legacy
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

  // Wire the SDK translate seat into the module-level t (sidebar row and
  // other plain-DOM callers): reads the active locale at call time, so they
  // follow the Language setting without a reload. The register effect above
  // guarantees the dictionaries exist before the first read.
  try { setRuntimeTranslate(ctx.locale.bind(NS)) } catch { /* locale missing: document-language fallback stays */ }

  // Plugin configuration card: one staged form over the `task-board` settings
  // namespace, contributed to whichever plugin-card seat this host declares
  // (the family group's list seat, or the official bundle-configuration seat).
  const settingsForm = bindSettingsForm(ctx)
  const settingsCard = new TaskBoardSettingsCardController(settingsForm)
  installPluginCard(ctx, {
    bundle: '@linxin666/dsh-client-ui-task-board',
    id: 'task-board',
    order: 110,
    locale: NS,
    inject: () => settingsCard.inject(),
    component: TaskBoardSettingsCard,
  })
  ctx.effect(() => () => { settingsCard.dispose() }, 'task-board: settings card')

  // The sidebar entry and board view mount once the settings form settles;
  // while the form is still loading, the composition default is unknown, so
  // nothing mounts yet. Only an unavailable form (no settings surface served)
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
        // The main-view Session comes from the catalog's per-source ownership
        // counts; navigation belongs to the workspace UI since the
        // multi-instance Client Session model.
        current: () => mainViewSessionId(sessions.list.getSnapshot().byId),
        open: id => ctx.uiWorkspace.openSession(id as never),
        subscribe: fn => sessions.list.subscribe(fn),
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
    // "New project" on the board is the GUI's own add-project call (#1536);
    // the runtime emits the created Workspace through workspaces.list, which
    // refreshes the filter above without a local re-read.
    controller.setWorkspaceCreator(async path => {
      const created = await workspaces.create({ path })
      return { workspaceId: created.workspaceId }
    })
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
    const pushModelOptions = async (): Promise<void> => {
      try {
        let models: Array<{ id: string; name?: string; provider?: string }> = []
        let sessionRemote: ClientRemote['session'] | undefined
        try {
          sessionRemote = (remote as Partial<ClientRemote>).session
        } catch {
          sessionRemote = undefined
        }
        if (typeof sessionRemote?.modelCatalog === 'function') {
          const res = await sessionRemote.modelCatalog()
          if (res.ok && Array.isArray(res.value?.groups)) {
            for (const g of res.value.groups) {
              const provider = (g as { id?: string; provider?: string }).id ?? (g as { id?: string; provider?: string }).provider
              for (const m of g.models ?? []) {
                const qualifiedId = provider ? `${provider}/${m.id}` : m.id
                models.push({ id: qualifiedId, name: m.name ?? m.id, provider })
              }
            }
          }
        }
        if (models.length === 0) {
          const conn = ctx.get('connection') as {
            api?: {
              llm?: { discoverModels?: () => Promise<unknown> }
              sessions?: { modelCatalog?: () => Promise<unknown> }
              session?: { modelCatalog?: () => Promise<unknown> }
            }
          } | undefined
          if (conn?.api) {
            if (typeof conn.api.llm?.discoverModels === 'function') {
              const res = await conn.api.llm.discoverModels() as { result?: { value?: { models?: Array<{ id: string; name?: string }> } } }
              const list = res?.result?.value?.models
              if (Array.isArray(list)) {
                models = list.map(m => ({ id: m.id, name: m.name }))
              }
            }
            const catalogFn = typeof conn.api.session?.modelCatalog === 'function'
              ? conn.api.session.modelCatalog
              : typeof conn.api.sessions?.modelCatalog === 'function'
                ? conn.api.sessions.modelCatalog
                : undefined
            if (models.length === 0 && catalogFn !== undefined) {
              const res = await catalogFn() as { result?: { value?: { groups?: Array<{ id?: string; provider?: string; models?: Array<{ id: string; name?: string }> }> } } }
              const groups = res?.result?.value?.groups
              if (Array.isArray(groups)) {
                for (const g of groups) {
                  const provider = g.id ?? g.provider
                  for (const m of g.models ?? []) {
                    const qualifiedId = provider ? `${provider}/${m.id}` : m.id
                    models.push({ id: qualifiedId, name: m.name ?? m.id, provider })
                  }
                }
              }
            }
          }
        }
        if (models.length > 0) {
          controller.setExecutionOptions({ models })
        }
      } catch (error) {
        console.error('[dsh-task-board] model options read failed', error)
      }
    }
    void pushModelOptions()
    disposers.push(ctx.on('connection/reset', () => { void pushModelOptions() }))
    try {
      disposers.push(mountSidebarEntry(controller, ctx.locale))
      disposers.push(mountBoard(controller, ctx.locale))
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
    const snapshot = settingsForm.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) mountUi()
    else uiDisposer?.()
  }
  settingsForm.subscribe(syncEnabled)
  syncEnabled()
}

/**
 * Bind the settings form this card stages over.
 *
 * The family binder (`ctx.get('webUiSettings')`, published by dsh-web-settings)
 * comes first: it is what traces this package's family namespace onto the
 * profile entry id the Host serves the form under, and it keeps the loopback
 * bridge as its own fallback. A page without that group falls back to the
 * shared configuration forms service bound directly at one of this package's
 * own profile entry ids.
 * @param ctx - client root context.
 * @returns the form the settings card reads and writes.
 */
export function bindSettingsForm(ctx: ClientContext): ConfigForm<TaskBoardSettings> {
  const binder = ctx.get('webUiSettings')
  if (binder !== undefined && typeof binder.bind === 'function') {
    return binder.bind<TaskBoardSettings>({ namespace: TASK_BOARD_NS })
  }
  return ctx.configForms.get<TaskBoardSettings>(servedEntryId(ctx.configForms))
}

/**
 * The profile entry id this package's own row carries.
 *
 * The shared describe mirror is the only local evidence of which row id this
 * profile actually serves, but it answers asynchronously: at plugin
 * activation it usually holds nothing yet. An unanswered mirror therefore
 * binds the aggregate row id rather than guessing among the candidates —
 * the form is bound once for the session, so a wrong guess would leave the
 * card reporting an unserved namespace even after the mirror settles.
 * @param forms - the shared configuration forms service.
 * @returns the entry id to bind.
 */
function servedEntryId(forms: ConfigForms): string {
  let served: readonly string[] | undefined
  try {
    served = forms.describe().getSnapshot().view?.namespaces.map(view => view.ns)
  } catch {
    served = undefined
  }
  if (served === undefined) return AGGREGATE_ENTRY_ID
  return TASK_BOARD_ENTRY_IDS.find(id => served.includes(id)) ?? TASK_BOARD_NS
}
