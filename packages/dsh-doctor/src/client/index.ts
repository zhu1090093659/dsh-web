/**
 * Browser-half entry for the dsh-doctor plugin.
 *
 * Registers the doctor card into the Web UI plugin group
 * (settings → Web UI plugins → Doctor), registers the doctor locale
 * namespace, wires the passive failure probe (window error and
 * unhandledrejection capture, React boundary reports, connection-rebuild boot
 * signals) into the card's recovery console, and starts the loopback
 * /api/doctor poll loop.
 *
 * Resilience contract: apply() never throws. Every mount step is guarded so a
 * missing service, a duplicate injection or a hostile settings form degrades to
 * an empty-but-alive plugin instead of taking the GUI down.
 * @module @linxin666/dsh-doctor/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the shared configuration-form contract types (the ctx.configForms
// merge itself comes from the ui-settings side-effect import below).
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotMap/LocaleNamespaceMap merge points (web-ui.plugin.item seat).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import { DoctorApi } from './doctor-api.ts'
import { DoctorController } from './doctor-controller.ts'
import { createHarnessPort } from './harness-send.ts'
import { createPluginRepairPort } from './plugin-repair.ts'
import type { PluginModulesSeam } from './plugin-failures.ts'
import { PassiveProbe } from './doctor-passive.ts'
import {
  DoctorSettingsCard,
  DoctorSettingsCardController,
  type DoctorSettings,
  type DoctorSettingsCardFace,
} from './DoctorSettingsCard.tsx'
import { en, zh, type DoctorKey } from './locales.ts'
import { reportDailyHeartbeat } from './telemetry.ts'
import { installPluginCard } from './plugin-card-seat.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'doctor'

/** Semantic plugin short name used on the console root container. */
export const PLUGIN_SHORT_NAME = 'doctor'

/** Owner share of a family plugin card (the group supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Doctor recovery console and settings card copy. */
    'doctor': DoctorKey
  }

  interface SlotMap {
    /** The child slot the Web UI plugin group declares; this card registers into the group. */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Family settings binder provided by dsh-web-settings. It resolves the
     * family namespace (`doctor`) to the profile entry id that owns it and
     * hands back that entry's shared configuration form, with the loopback
     * bridge as its fallback.
     */
    webUiSettings?: SettingsFormBinder
  }
}

/**
 * Description of one family settings namespace a card binds. The spec type is
 * private to ui-settings in the 0.1.7 cohort, and the family binder takes the
 * namespace plus an optional narrowing decoder, so the browser half declares
 * the shape it calls.
 */
interface FamilySettingsSpec<T> {
  /** Family settings namespace this card edits. */
  namespace: string
  /** Narrow a wire section; undefined hands the section over as the Host resolved it. */
  decode?: (section: unknown) => T | undefined
}

/** Optional family settings binder provided by dsh-web-settings. */
interface SettingsFormBinder {
  /** Bind the shared configuration form of the entry that owns one family namespace. */
  bind<T>(spec: FamilySettingsSpec<T>): ConfigForm<T>
}

/**
 * Profile entry id the family aggregate's generated row carries — the
 * deployment shape nearly every user runs. Under 0.1.7 a settings form is
 * addressed by profile entry id, so the shared-forms fallback below has to
 * name it; the family binder resolves the family namespace instead.
 */
const AGGREGATE_ENTRY_ID = 'web-ui-doctor'

/**
 * Entry ids this package's rows carry, most common deployment first: the
 * aggregate's generated row, then the bare family namespace — which is both
 * the standalone bundle patch row id and the descriptor key a Host that keys
 * rows by the plugin's own namespace reports.
 */
const DOCTOR_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, NS]

/** Services required by the browser half. */
export const inject = ['slots', 'locale', 'configForms']

/** Apply-guard: a duplicated client injection must not mount a second card. */
let claimed = false

/** Apply the browser half; never throws. */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-doctor' }])

  if (claimed) return
  claimed = true

  // Dictionaries.
  safe(() => {
    ctx.effect(() => {
      try {
        return ctx.locale.register(NS, { zh, en })
      } catch {
        return () => {}
      }
    }, 'doctor: dictionaries')
  })

  // Controller: passive probe + poll loop, both fail-open. Feeds the card's
  // embedded recovery console.
  let controller: DoctorController | undefined
  safe(() => {
    const passive = new PassiveProbe({
      notify: () => { controller?.syncProbe() },
    })
    // Optional seams: a shell without the modules service or the sessions
    // service degrades the console instead of failing apply.
    const modules = ctx.get('modules') as unknown as PluginModulesSeam | undefined
    const harness = createHarnessPort(ctx.get('sessions'))
    const pluginRepair = createPluginRepairPort(ctx.get('pluginManager'))
    controller = new DoctorController({ api: new DoctorApi(), passive, modules, harness, pluginRepair })
    passive.start()
    ctx.effect(() => {
      controller?.start()
      return () => { controller?.dispose() }
    }, 'doctor: poll loop')
    // Boot-phase signal: a rebuilt connection refreshes the snapshot.
    ctx.effect(() => ctx.on('connection/reset', () => { controller?.noteConnectionReset() }), 'doctor: connection signals')
    // Plugin startup failures: the renderer module host emits
    // loader/partial-dispose (loader, options, failed) when an entry fails to
    // apply. The shared event registry delivers it to every plugin context, so
    // a sibling's failure is recorded here; the boot-graph reconciliation in
    // refresh() covers bundles that never even materialized. The event name is
    // not part of the typed client Events surface, so the listener is attached
    // through a narrow structural cast.
    const events = ctx as unknown as { on(name: string, listener: (...args: unknown[]) => void): () => void }
    ctx.effect(() => events.on('loader/partial-dispose', (_loader: unknown, options: unknown, failed: unknown) => {
      try {
        if (failed !== true) return
        const row = (options ?? {}) as { id?: unknown; name?: unknown }
        const id = typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : undefined
        if (id !== undefined && id !== '') controller?.notePluginStartupFailure(id)
      } catch {
        // Failure observation must never take the GUI down.
      }
    }), 'doctor: plugin failure events')
  })

  // Family settings card over the doctor settings entry. Staged form owns the
  // enabled / fullProtection / autoRepair switches; the host mounts its
  // diagnostic endpoints only after the saved enabled lands. The family binder
  // (dsh-web-settings) resolves the family namespace to the profile entry id
  // that owns it; without the group loaded, the entry id is resolved against
  // the shared describe mirror instead.
  let cardController: DoctorSettingsCardController | undefined
  safe(() => {
    const binder = ctx.get('webUiSettings')
    const scope = binder === undefined || typeof binder.bind !== 'function'
      ? ctx.configForms.get<DoctorSettings>(doctorEntryId(ctx.configForms))
      : binder.bind<DoctorSettings>({ namespace: NS })
    cardController = new DoctorSettingsCardController(scope)
  })

  // Locale label of the family list seat; the official keyed seat dispatches
  // by settings namespace and carries no label (issue #1589).
  const label = (): string => {
    try {
      return ctx.locale.bind(NS)('settings.title')
    } catch {
      return 'Doctor'
    }
  }
  const card = cardController
  const doctor = controller
  if (doctor !== undefined && card !== undefined) {
    installPluginCard(ctx, {
      bundle: '@linxin666/dsh-doctor',
      id: NS,
      order: 140,
      label,
      locale: NS,
      inject: () => ({ ...card.inject(), controller: doctor }) satisfies DoctorSettingsCardFace,
      component: DoctorSettingsCard,
    })
  }
}

/** Run one guarded step; never rethrows. */
function safe(step: () => void): void {
  try {
    step()
  } catch {
    // fail-open: a broken optional step must not break apply.
  }
}

/**
 * The profile entry id this page serves the doctor config under.
 *
 * The shared describe mirror is the only local evidence of which row id this
 * profile actually carries, but it answers asynchronously: at plugin
 * activation it usually holds nothing yet. An unanswered mirror therefore
 * binds the aggregate row id rather than guessing among the candidates — the
 * form is bound once for the session, so a wrong guess would leave the card
 * reporting an unserved namespace even after the mirror settles.
 * @param forms - the shared configuration forms service.
 * @returns the entry id to bind.
 */
function doctorEntryId(forms: ConfigForms): string {
  let served: readonly string[] | undefined
  try {
    served = forms.describe().getSnapshot().view?.namespaces.map(view => view.ns)
  } catch {
    served = undefined
  }
  if (served === undefined) return AGGREGATE_ENTRY_ID
  return DOCTOR_ENTRY_IDS.find(id => served.includes(id)) ?? NS
}
