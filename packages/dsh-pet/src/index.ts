/**
 * dsh-pet host half — mounts the pet service and its HTTP routes. The
 * browser half (the './client' entry) renders the selected pet and drives it
 * through the same-origin '/api/pet/*' JSON endpoints plus the '/pet/<id>/*'
 * media route. The host builds the multi-pet registry once at startup from
 * the package assets, the hatch-pet custom pets directory, and composed
 * config entries; adding a pet means dropping a manifest + atlas into one of
 * those sources, never touching host or client code. Install via
 * 'dsh plugin --profile web add link:<dsh-web-ui>/packages/dsh-pet'; the
 * cordis.patch.yml inserts this plugin row.
 * @module @linxin666/dsh-pet
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { join } from 'node:path'
import z from 'schemastery'
import {
  DEFAULT_PET_DESKTOP_SETTINGS,
  normalizePetDesktopSettings,
  PET_DESKTOP_SCALE_MAX,
  PET_DESKTOP_SCALE_MIN,
  PetService,
  PET_SETTINGS_NAMESPACE,
  type PetConfig,
  type PetSettingsSection,
} from './service.ts'
import { makePetRoutes, makePetRuntimeRoutes, makePetSettingsRoutes } from './routes.ts'
import { loadPetRegistry, petPackageRoot } from './registry.ts'
import { DISPLAY_INSET_MAX, DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from './persist.ts'
import { mountOnce } from './mount-once.ts'
import { createPetNativeToken } from './adapters/web/native-auth.ts'
import { StandaloneRuntimeManager } from './adapters/standalone/runtime-manager.ts'
import { dshHome } from './dsh-home.ts'
import { PetPresentationIntegration } from './presentation/integration.ts'

export { PetService, MAX_SESSION_BUBBLES } from './service.ts'
export type {
  PetConfig,
  PetDesktopSettings,
  PetInteractResult,
  PetSettingsSection,
  PetSessionView,
  PetStateView,
} from './service.ts'
export {
  AFFINITY_MAX,
  AFFINITY_RANKS,
  applyInteraction,
  applyTurnReward,
  emptyAffinity,
  rankOf,
} from './affinity.ts'
export type {
  AffinityConfig,
  AffinityState,
  InteractionOutcome,
  PetInteraction,
} from './affinity.ts'
export {
  animationForPhase,
  PetStateMachine,
  rowOf,
} from './state.ts'
export type {
  ActivityPhase,
  PetAnimation,
  PetStateConfig,
  PetStateInput,
  PetStateSnapshot,
} from './state.ts'
export {
  consumeTreat,
  defaultTreatConfig,
  emptyTreatLedger,
  settleTreatGrants,
} from './treats.ts'
export type { TreatConfig, TreatLedger, TreatSettlement } from './treats.ts'
export {
  BUILTIN_REMARKS,
  REMARK_KINDS,
  REMARK_LINE_MAX,
  REMARK_LINES_MAX,
  RemarkPicker,
  builtinRemark,
  normalizePetRemarks,
} from './remarks.ts'
export type { PetRemarks, PetRemarksManifest, RemarkKind } from './remarks.ts'
export {
  DEFAULT_PET_ID,
  DEFAULT_PET_NAME,
  PET_NAME_MAX_LENGTH,
  defaultDisplayConfig,
  emptyPersist,
  loadPetPersist,
  petHomeDir,
  savePetPersist,
} from './persist.ts'
export type { PetDisplayConfig, PetPersist } from './persist.ts'
export {
  DEFAULT_FRAME_COUNTS,
  DEFAULT_PET_CELL,
  DEFAULT_PET_COLUMNS,
  DEFAULT_PET_ROW_COUNT,
  DEFAULT_TRACK_PATTERNS,
  PET_ROW_ORDER,
  codexPetsDir,
  loadPetRegistry,
  petEntryView,
  petPackageRoot,
  resolvePetManifest,
} from './registry.ts'
export type {
  PetDefinition,
  PetEntry,
  PetManifest,
  PetRegistry,
  PetRegistryOptions,
  PetTrackDef,
  PetTrackOverride,
} from './registry.ts'

export {
  makePetRoutes,
  makePetRuntimeRoutes,
  makePetSettingsRoutes,
  PET_API_PREFIX,
  PET_ASSET_PREFIX,
  PET_NATIVE_API_PREFIX,
  PET_RUNTIME_API_PREFIX,
  PET_SETTINGS_API_PREFIX,
} from './routes.ts'

export {
  DEFAULT_PET_DESKTOP_SETTINGS,
  PET_DESKTOP_SCALE_MAX,
  PET_DESKTOP_SCALE_MIN,
} from './service.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'pet'

/** The core stays available even when no Web presentation Host is composed. */
export const inject = [] as const

/**
 * Settings section schema: pet selection and display fields the web settings
 * surface edits. petId is a plain string on purpose: the service clamps the
 * resolved value against the registry, so a stored selection that points at
 * a removed pet cannot invalidate the section (a strict union would refuse
 * the whole registration). The settings card renders the actual registry
 * choices itself from '/api/pet/pets'.
 */
export function makePetSettingsSchema(fallbackPetId: string) {
  return z.object({
    visible: z.boolean().default(true),
    size: z.number().step(1).min(DISPLAY_SIZE_MIN).max(DISPLAY_SIZE_MAX).default(160),
    right: z.number().step(1).min(0).max(DISPLAY_INSET_MAX).default(24),
    bottom: z.number().step(1).min(0).max(DISPLAY_INSET_MAX).default(20),
    petId: z.string().default(fallbackPetId),
    enabled: z.boolean().default(true),
    desktopEnabled: z.boolean().default(DEFAULT_PET_DESKTOP_SETTINGS.enabled),
    desktopVisible: z.boolean().default(DEFAULT_PET_DESKTOP_SETTINGS.visible),
    desktopAlwaysOnTop: z.boolean().default(DEFAULT_PET_DESKTOP_SETTINGS.alwaysOnTop),
    desktopLocked: z.boolean().default(DEFAULT_PET_DESKTOP_SETTINGS.locked),
    desktopScale: z.number().min(PET_DESKTOP_SCALE_MIN).max(PET_DESKTOP_SCALE_MAX)
      .default(DEFAULT_PET_DESKTOP_SETTINGS.scale),
  })
}

/** Register the pet service and its API + asset routes on the context. */
export const apply = mountOnce('@linxin666/dsh-pet', applyImpl)

function applyImpl(ctx: Context, config: PetConfig = {}): void {
  const registry = config.registry
    ?? loadPetRegistry({
      packageRoot: petPackageRoot(import.meta.url),
      ...(config.pets === undefined ? {} : { extra: config.pets }),
    })
  const desktopBase = normalizePetDesktopSettings(config.desktop)
  const service = new PetService(ctx, { ...config, registry, desktop: desktopBase })
  const runtime = new StandaloneRuntimeManager({
    root: join(dshHome(), 'cache', 'dsh-pet', 'electron'),
  })
  ctx.effect(() => async () => { await runtime.dispose() }, 'pet: standalone runtime')

  // The settings surface edits the pet selection + display config through
  // the 'pet' namespace. The composition 'base' starts as the persisted
  // pet.json values (clamped to schema bounds), so an empty user layer
  // resolves to exactly what the pet already shows — a fresh deployment
  // never overwrites a customized layout, and reset re-inherits it. Runtime
  // drag interactions mirror back into the settings document through the
  // service (see syncSettingsFromPet), keeping both views consistent.
  let current: () => PetSettingsSection = () => base
  const base: PetSettingsSection = {
    visible: service.display().visible,
    size: service.display().size,
    right: service.display().right,
    bottom: service.display().bottom,
    petId: service.selectedPetId(),
    enabled: config.enabled ?? true,
    desktopEnabled: desktopBase.enabled,
    desktopVisible: desktopBase.visible,
    desktopAlwaysOnTop: desktopBase.alwaysOnTop,
    desktopLocked: desktopBase.locked,
    desktopScale: desktopBase.scale,
  }
  // WebServer is optional: without it the core and activity projection still
  // run, while routes and native presentation stay dormant. When a WebServer
  // appears, control routes remain mounted even with the master switch off so
  // the settings page can re-enable the plugin and explicitly install runtime.
  let syncWeb = (): void => undefined
  ctx.inject(['webServer'], (webCtx) => {
    const nativeToken = createPetNativeToken()
    const bridgeOrigin = `http://127.0.0.1:${String(webCtx.webServer.port)}`
    const controlRoutes = [
      ...makePetSettingsRoutes(service),
      ...makePetRuntimeRoutes(runtime),
    ]
    webCtx.effect(() => {
      const disposers = controlRoutes.map(route => webCtx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'pet: control routes')

    let retryExhaustionUpdate: Promise<void> | undefined
    const presentation = new PetPresentationIntegration({
      runtime,
      settings: () => current(),
      moduleUrl: import.meta.url,
      bridgeOrigin,
      nativeToken,
      onRetryExhausted: () => {
        if (!(current().desktopEnabled ?? false)) return
        if (retryExhaustionUpdate !== undefined) return retryExhaustionUpdate
        const update = service.setDesktopSettings({ enabled: false })
          .then(() => undefined)
        retryExhaustionUpdate = update
        void update.finally(() => {
          if (retryExhaustionUpdate === update) retryExhaustionUpdate = undefined
        }).catch(() => undefined)
        return update
      },
    })
    const routes = makePetRoutes({
      service,
      nativeToken,
      onNativeReady: ack => presentation.acknowledgeReady(ack.sourceId, ack.desktopPid),
    })
    let disposeRoutes: (() => void) | undefined
    const sync = (): void => {
      const enabled = current().enabled ?? true
      if (disposeRoutes === undefined && enabled) {
        disposeRoutes = webCtx.effect(() => {
          const disposers = routes.map(route => webCtx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        }, 'pet: routes')
      } else if (disposeRoutes !== undefined && !enabled) {
        disposeRoutes()
        disposeRoutes = undefined
      }
      void presentation.reconcile()
    }
    syncWeb = sync
    webCtx.effect(() => async () => {
      if (syncWeb === sync) syncWeb = () => undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      await presentation.dispose()
    }, 'pet: presentation integration')
    sync()
  })
  installSettingsSection(
    ctx,
    settingsNamespace(PET_SETTINGS_NAMESPACE),
    makePetSettingsSchema(service.selectedPetId()),
    base,
    {
      setSource: (source) => { current = source },
      onChange: () => {
        const section = current()
        service.applySettingsSection(section)
        service.setEnabled(section.enabled ?? true)
        syncWeb()
      },
    },
  )
  const section = current()
  service.applySettingsSection(section)
  service.setEnabled(section.enabled ?? true)
  syncWeb()
}
