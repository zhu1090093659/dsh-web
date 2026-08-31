/**
 * dsh-pet host half — mounts the pet service and its HTTP routes. The
 * browser half (the './client' entry) renders the selected pet and drives it
 * through the same-origin '/api/pet/*' JSON endpoints plus the '/pet/<id>/*'
 * media route. The host builds the multi-pet registry once at startup from
 * the package assets, the hatch-pet custom pets directory, and composed
 * config entries; adding a pet means dropping a manifest + atlas into one of
 * those sources, never touching host or client code. Install via
 * 'dsh plugin --profile web add link:<dsh-web>/packages/dsh-pet'; the
 * cordis.patch.yml inserts this plugin row.
 * @module @linxin666/dsh-pet
 */

import { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { PetService, PET_SETTINGS_NAMESPACE, type PetConfig, type PetSettingsSection } from './service.ts'
import { makePetRoutes } from './routes.ts'
import { loadPetRegistry, petPackageRoot } from './registry.ts'
import { DISPLAY_INSET_MAX, DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from './persist.ts'
import { mountOnce } from './mount-once.ts'

export { PetService, MAX_SESSION_BUBBLES } from './service.ts'
export type {
  PetConfig,
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
  PET_API_PREFIX,
  PET_ASSET_PREFIX,
} from './routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'pet'

/** Services required before the pet can mount its surfaces. */
export const inject = ['webServer']

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
    decorationEnabled: z.boolean().default(true),
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
  const service = new PetService(ctx, { ...config, registry })

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
    decorationEnabled: config.decorationEnabled ?? true,
  }
  // The browser half talks to the pet through same-origin JSON endpoints and
  // loads each pet's atlas from the registry's own media route (RPC domains
  // are platform-registered, so the pet serves its own API — the same
  // pattern as dsh-remote-web-ui's /api/pair family). The routes are
  // registered while the plugin is enabled; toggling the setting off makes
  // the pet API disappear until it is re-enabled.
  const routes = makePetRoutes({ service, ctx })
  let disposeRoutes: (() => void) | undefined
  const syncRoutes = (): void => {
    const enabled = current().enabled ?? true
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map((route) => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'pet: routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      PET_SETTINGS_NAMESPACE as SettingsNamespace,
      makePetSettingsSchema(service.selectedPetId()),
      base,
      {
        setSource: (source) => { current = source },
        onChange: () => {
          const section = current()
          service.applySettingsSection(section)
          service.setEnabled(section.enabled ?? true)
          syncRoutes()
        },
      },
    )
  })
  syncRoutes()
}
