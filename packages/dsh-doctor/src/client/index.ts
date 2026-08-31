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
 * missing service, a duplicate injection or a hostile scope degrades to an
 * empty-but-alive plugin instead of taking the GUI down.
 * @module @linxin666/dsh-doctor/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the settings-namespace scope contract types (the ctx.settingsScope
// merge itself comes from the ui-settings side-effect import below).
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
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
    /** Optional rc.6 compatibility binder provided by dsh-web-settings. */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** Services required by the browser half. */
export const inject = ['slots', 'locale', 'settingsScope']

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

  // Family settings card over the doctor namespace. Staged form owns the
  // enabled / fullProtection / autoRepair switches; the host mounts its
  // diagnostic endpoints only after the saved enabled lands.
  let cardController: DoctorSettingsCardController | undefined
  safe(() => {
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
    const scope = binder.bind<DoctorSettings>({ namespace: NS })
    cardController = new DoctorSettingsCardController(scope)
  })

  ctx.slots.inject('web-ui.plugin.item', () => {
    const dispose = controller === undefined || cardController === undefined ? undefined : safeRegister(ctx, controller, cardController)
    return () => { dispose?.() }
  })
}

/** Register the card; returns the disposer or undefined on failure. */
function safeRegister(
  ctx: Parameters<typeof apply>[0],
  controller: DoctorController,
  cardController: DoctorSettingsCardController,
): (() => void) | undefined {
  try {
    return ctx.slots.register({
      name: 'web-ui.plugin.item',
      id: NS,
      order: 140,
      label: () => {
        try {
          return ctx.locale.bind(NS)('settings.title')
        } catch {
          return 'Doctor'
        }
      },
      locale: NS,
      inject: () => ({ ...cardController.inject(), controller }) satisfies DoctorSettingsCardFace,
    }, DoctorSettingsCard)
  } catch {
    return undefined
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
