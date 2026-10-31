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
import { BoardController, TASK_BOARD_PANEL_ID, type ExecutionModelOption, type ExecutionPresetOption } from '../core/controller.ts'
import { modelOptionsFromCatalog, modelOptionsFromDiscoveredModels } from './board/model-options.ts'
import { presetOptionsFromRoster, readPresetRoster, type PresetRemote } from './board/preset-roster.ts'
import { mainViewSessionId } from './main-session.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { hasOpenExecution } from '../core/tasks.ts'
import { claimTaskboardApply, releaseTaskboardApply } from './apply-guard.ts'
import { registerTaskBoardPanel } from './native-panel.tsx'
import { createScheduleRowGuard } from './suppress-schedule-row.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, zh, setRuntimeTranslate, type TaskBoardKey } from './locales.ts'
import { HttpTaskBoardHostTransport } from './host-api.ts'
import { startPendingVerification } from './pending-verify.ts'
import { reportDailyHeartbeat } from './telemetry.ts'
import { installPluginCard } from './plugin-card-seat.ts'
import { createServedEntryForm } from './settings-entry-form.ts'
import { TaskBoardClientService } from './service.ts'
import {
  TASK_BOARD_SERVICE_NAME,
  type TaskBoardCardDecorationProps,
  type TaskBoardDetailSectionProps,
  type TaskBoardHostFace,
  type TaskBoardSettingsSectionProps,
} from '../core/extension.ts'

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

    /** Provider task-detail section; the board declares and renders it. */
    'task-board.detail.section': { kind: 'list'; scope: 'root'; owner: TaskBoardDetailSectionProps }
    /** Provider settings section; the board declares and renders it. */
    'task-board.settings.section': { kind: 'list'; scope: 'root'; owner: TaskBoardSettingsSectionProps }
    /** Provider card decoration; the board declares and renders it. */
    'task-board.card.decoration': { kind: 'list'; scope: 'root'; owner: TaskBoardCardDecorationProps }
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
 * The generated remote namespaces are not all hard injects: `remote.session`
 * is one, while `remote.agentPresets` is reached through a scoped inject at
 * use time (see mountUi), because the namespace mounts with the official
 * api-remotes assembly applied beside this entry rather than before it.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'configForms', 'locale', 'remote', 'remote.session', 'uiWorkspace', 'layout']

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
  // The board's browser-half extension service. It is provided before any
  // controller exists (the UI mounts only once the settings form settles), so
  // providers can subscribe and register visibility immediately.
  const clientService = new TaskBoardClientService()
  // A capture-only test context implements no service registry; the board's
  // own surfaces still mount.
  if (typeof (ctx as { provide?: unknown }).provide === 'function') {
    ;(ctx.provide as unknown as (name: string, value: unknown) => void)(TASK_BOARD_SERVICE_NAME, clientService as unknown as TaskBoardHostFace)
  }
  ctx.effect(() => () => { clientService.detach() }, 'task-board: extension service')

  const settingsCard = new TaskBoardSettingsCardController(settingsForm, request => clientService.dispatch(request))
  installPluginCard(ctx, {
    bundle: '@linxin666/dsh-client-ui-task-board',
    id: 'task-board',
    order: 110,
    locale: NS,
    // The board's own settings card declares the provider settings seat; the
    // provider registers into it and this card renders it.
    children: { 'task-board.settings.section': { kind: 'list', scope: 'root' } },
    inject: () => settingsCard.inject(),
    component: TaskBoardSettingsCard,
  })
  ctx.effect(() => () => { settingsCard.dispose() }, 'task-board: settings card')

  // The agent-preset roster is a runtime fact of the deployment, not ledger
  // state, and TWO surfaces read it: the board's mode pickers and the settings
  // card's new-card-defaults topic. It is wired here, outside the board view,
  // because the settings card stays reachable while the board itself is
  // disabled — that is where it is switched back on — and its default-preset
  // field must not lose the roster with the view. The namespace mounts with the
  // official api-remotes assembly, which the page applies beside this entry: at
  // mount time it is usually still absent, and reading it through
  // `remote.agentPresets` before it lands throws ("cannot get property ...
  // without inject"), so a one-shot probe would leave both pickers with nothing
  // but "inherit" for the page lifetime. A hard inject is no better — it would
  // pend the whole plugin on a deployment that never mounts the namespace. The
  // scoped inject runs the feed exactly when the namespace exists and re-runs it
  // if the namespace is replaced; the reconnect read inside covers a deployment
  // change behind the same namespace.
  let presetRoster: readonly ExecutionPresetOption[] | undefined
  let liveController: BoardController | undefined
  const pushPresetOptions = async (presetRemote: PresetRemote): Promise<void> => {
    try {
      const roster = await readPresetRoster(presetRemote)
      if (!roster.ok) return
      const presets = presetOptionsFromRoster(roster.presets)
      presetRoster = presets
      settingsCard.setPresetRoster(presets)
      liveController?.setExecutionOptions({ presets })
    } catch (error) {
      // A failed roster read leaves the previous options in place: the pickers
      // stay usable, the default-preset field keeps the inherit choice alone,
      // and the next reconnect retries the read.
      console.error('[dsh-task-board] agent preset roster read failed', error)
    }
  }
  const presetRosterFeed = ctx.inject(['remote.agentPresets'], (inner) => {
    const presetRemote = inner.get('remote.agentPresets') as PresetRemote | undefined
    if (presetRemote === undefined) return
    void pushPresetOptions(presetRemote)
    // Subscribed inside the injected scope, so a namespace that goes away takes
    // its listener with it instead of leaving one per remount.
    return inner.on('connection/reset', () => { void pushPresetOptions(presetRemote) })
  })
  ctx.effect(() => () => { void presetRosterFeed.dispose() }, 'task-board: agent preset roster')

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
      // Panel navigation belongs to the layout service: the board asks it to
      // select its own panel id (or the conversation) instead of taking over
      // the center column at the DOM level. The lookup stays lazy so a
      // selection issued before the service settles still lands once it does,
      // and the face throws by contract before the layout root entry mounts,
      // which the controller tolerates.
      panel: {
        select: panelId => {
          const layout = ctx.get('layout') as { selectPanel?: (id: string | null) => void } | undefined
          layout?.selectPanel?.(panelId)
        },
      },
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
    // The extension service follows the live controller: providers observe the
    // board mirror and dispatch through it while the board runs.
    clientService.attach(controller)

    const disposers: Array<() => void> = []
    // The board follows the live controller for the roster feed wired above,
    // which serves the settings card whether or not the view is mounted.
    liveController = controller
    if (presetRoster !== undefined) controller.setExecutionOptions({ presets: presetRoster })
    // While the mirror shows work in flight it verifies that state itself: the
    // pushed frame is unverifiable from the browser (a stream can stay open and
    // silent), and a settled card would otherwise keep rendering as running for
    // as long as the tab stays open. Nothing is read once nothing is in flight.
    disposers.push(startPendingVerification({
      pending: () => controller.getSnapshot().tasks.some(hasOpenExecution),
      refresh: () => { controller.refreshHostState() },
      subscribe: listener => controller.subscribe(listener),
    }))

    // The new-card defaults are written through the very settings form this
    // plugin binds (that is the card's save), and the Host republishes its
    // snapshot on that write. Its SSE frame carries the value as of BEFORE the
    // write, though, so a mirror that only followed frames would hand the create
    // dialog the previous defaults for the rest of the page session — the
    // "configure a default, create a card, get nothing" report. Follow the form
    // instead: when the four defaults it holds change, re-read the authoritative
    // snapshot. The signature keeps one write to one GET (the form announces a
    // settled document more than once) and keeps an unrelated settings write, or
    // any board action, from pulling the ledger again.
    let followedDefaults = cardDefaultSignature(settingsForm.getSnapshot().value)
    disposers.push(settingsForm.subscribe(() => {
      const next = cardDefaultSignature(settingsForm.getSnapshot().value)
      if (next === followedDefaults) return
      followedDefaults = next
      controller.refreshHostState()
    }))

    // Execution-target option feeds: the workspace list drives the workspace
    // picker, and the agent-preset roster drives the mode picker. Both are
    // runtime facts (not ledger state), so the wiring pushes them into the
    // controller on change; the preset roster feed itself lives beside the
    // settings card (see apply) because that card's new-card-defaults topic
    // reads the same roster while this view may not be mounted at all.
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
    const pushModelOptions = async (): Promise<void> => {
      try {
        let models: ExecutionModelOption[] = []
        let sessionRemote: ClientRemote['session'] | undefined
        try {
          sessionRemote = (remote as Partial<ClientRemote>).session
        } catch {
          sessionRemote = undefined
        }
        if (typeof sessionRemote?.modelCatalog === 'function') {
          const res = await sessionRemote.modelCatalog()
          if (res.ok) models = modelOptionsFromCatalog(res.value)
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
              const res = await conn.api.llm.discoverModels() as { result?: { value?: { models?: unknown } } }
              models = modelOptionsFromDiscoveredModels(res?.result?.value?.models)
            }
            const catalogFn = typeof conn.api.session?.modelCatalog === 'function'
              ? conn.api.session.modelCatalog
              : typeof conn.api.sessions?.modelCatalog === 'function'
                ? conn.api.sessions.modelCatalog
                : undefined
            if (models.length === 0 && catalogFn !== undefined) {
              const res = await catalogFn() as { result?: { value?: unknown } }
              models = modelOptionsFromCatalog(res?.result?.value)
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
    // Native panel surfaces: one sidebar row and one center-column page, both
    // through the official slot seats the shell itself renders. The layout's
    // panel selection is reconciled back into the controller so the board's own
    // view state follows the user clicking another panel row.
    try {
      disposers.push(registerTaskBoardPanel(ctx, controller))
      const layoutFace = ctx.get('layout') as { panelInfo?: { subscribe(listener: () => void): () => void; getSnapshot(): { activePanelId: unknown } } } | undefined
      if (layoutFace?.panelInfo !== undefined) {
        const sync = (): void => {
          const active = layoutFace.panelInfo!.getSnapshot().activePanelId
          controller.syncPanelSelection(active === TASK_BOARD_PANEL_ID ? TASK_BOARD_PANEL_ID : null)
        }
        sync()
        disposers.push(layoutFace.panelInfo.subscribe(sync))
      }
    } catch (error) {
      // A shell that cannot serve the seats degrades the board, never the GUI.
      console.error('[dsh-task-board] panel registration failed:', error)
    }

    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      clientService.detach()
      controller.dispose()
      liveController = undefined
      uiDisposer = undefined
    }
  }
  // The board's master switch owns the official automation-tasks entry as
  // well: while the board is on, the shell's duplicate "Automation tasks" row
  // is hidden, and with the board off the official row comes back. The same
  // switch already governs the board's own row, so both scheduling entries
  // appear and disappear together.
  const scheduleRowGuard = createScheduleRowGuard(ctx)
  const syncEnabled = (): void => {
    const snapshot = settingsForm.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) {
      mountUi()
      clientService.setEnabled(true)
      scheduleRowGuard.hide()
    } else {
      clientService.setEnabled(false)
      scheduleRowGuard.show()
      uiDisposer?.()
    }
  }
  const unsubscribeSettings = settingsForm.subscribe(syncEnabled)
  // The mounted surfaces and the settings subscription belong to this fiber.
  // The loader replaces a rebuilt bundle IN PLACE (fiber teardown and re-apply
  // without a page reload), and that same teardown removes the dictionaries
  // this row and board render through — a row left behind would stay visible
  // showing raw dictionary keys, and a surviving subscription could mount a
  // second one from a dead instance.
  ctx.effect(() => () => {
    unsubscribeSettings()
    uiDisposer?.()
    scheduleRowGuard.dispose()
  }, 'task-board: DOM surfaces')
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
  return createServedEntryForm<TaskBoardSettings>({
    forms: ctx.configForms,
    entryIds: TASK_BOARD_ENTRY_IDS,
  })
}

/**
 * The four new-card defaults one settings document holds, as a change
 * signature.
 *
 * Deliberately nothing but those four keys: the settings form also carries the
 * board's own switches and the acceptance configuration, and an edit to one of
 * those says nothing about the defaults the create dialog prefills from. Not a
 * second normalization of Host state — the value never leaves this comparison.
 * @param value - the settings form's effective section, if it has one.
 * @returns a stable string that changes exactly when the defaults do.
 */
function cardDefaultSignature(value: unknown): string {
  const section = (value ?? {}) as Record<string, unknown>
  return JSON.stringify([
    section.cardDefaultMode,
    section.cardDefaultPermission,
    section.cardDefaultModel,
    section.cardDefaultReasoningEffort,
  ])
}

/**
 * The profile entry id this package's own row carries, for a page that serves
 * no family binder.
 *
 * The shared describe mirror is the only local evidence of which row id this
 * profile actually serves, but it answers asynchronously: at plugin activation
 * it usually holds nothing yet. An unanswered mirror therefore binds the
 * aggregate row id rather than guessing among the candidates, and the binding
 * is re-resolved once the mirror answers — see
 * {@link createServedEntryForm}, which owns that rebinding.
 * @param forms - the shared configuration forms service.
 * @returns the entry id to bind before the mirror answers.
 */
export function servedEntryId(forms: ConfigForms): string {
  let served: readonly string[] | undefined
  try {
    served = forms.describe().getSnapshot().view?.namespaces.map(view => view.ns)
  } catch {
    served = undefined
  }
  if (served === undefined) return AGGREGATE_ENTRY_ID
  return TASK_BOARD_ENTRY_IDS.find(id => served.includes(id)) ?? TASK_BOARD_NS
}
