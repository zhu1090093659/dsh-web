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

import { Context, type Volatile } from '@deepseek-ai/cordis'
// Type-only: pulls the settings service's Context merge (ctx.settings).
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { PetService, type PetConfig, type PetSettingsSection } from './service.ts'
import { makePetRoutes } from './routes.ts'
import { loadPetRegistry, petPackageRoot } from './registry.ts'
import { BUBBLE_SCALE_MAX, BUBBLE_SCALE_MIN, DEFAULT_PET_ID, DISPLAY_INSET_MAX, DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from './persist.ts'
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
 * Defaults of the fields the pet's settings page edits. They are the schema
 * defaults of the pet row's own config, i.e. what a field the profile entry
 * never set resolves to.
 */
export const PET_FORM_DEFAULTS = {
  visible: true,
  size: 160,
  right: 24,
  bottom: 20,
  bubbleScale: 1,
  petId: DEFAULT_PET_ID,
  enabled: true,
  decorationEnabled: true,
} as const

/**
 * One settings field as the config carries it. The Host commits an edit into
 * the running config through a live reference rather than remounting the row,
 * so a field usually arrives as that reference; a plain value appears when the
 * plugin runs outside a Loader (tests, direct mounts).
 */
export type LiveField<T> = Volatile<T> | T

/** The pet's settings fields, as a profile entry's config declares them. */
export interface PetFormConfig {
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: LiveField<boolean>
  /** Status-decoration master switch (pet-center M5, #567); defaults to on. */
  decorationEnabled?: LiveField<boolean>
  /** Master switch for the pet surface. */
  visible?: LiveField<boolean>
  /** Scale of the rendered pet in px (sprite cell height). */
  size?: LiveField<number>
  /** Horizontal inset from the viewport right edge, px. */
  right?: LiveField<number>
  /** Vertical inset from the viewport bottom edge, px. */
  bottom?: LiveField<number>
  /** Bubble typography multiplier on the automatic size following (#1549). */
  bubbleScale?: LiveField<number>
  /** Selected pet id (a registry entry; the service clamps stale values). */
  petId?: LiveField<string | undefined>
}

/**
 * Plugin configuration. Under the 0.1.7 settings model a plugin's own Cordis
 * Config IS its settings page: the Host derives one form per profile entry
 * from this schema, so the fields the pet card edits live here with the
 * defaults the card inherits, next to the tuning block a profile may still
 * declare.
 *
 * Every page field is `volatile()` on purpose. The Host serves exactly the
 * volatile fields of a Config and refuses writes to any other path, and a
 * volatile field is the one it can commit into the RUNNING config: the pet
 * reads the edited value from the live reference instead of being remounted
 * for each edit (see `syncSettings` in `apply`). petId stays a plain string
 * because the service clamps the value against the registry, so a stored
 * selection naming a removed pet cannot invalidate the entry.
 */
export const Config = z.object({
  visible: z.boolean().default(PET_FORM_DEFAULTS.visible).volatile(),
  size: z.number().step(1).min(DISPLAY_SIZE_MIN).max(DISPLAY_SIZE_MAX).default(PET_FORM_DEFAULTS.size).volatile(),
  right: z.number().step(1).min(0).max(DISPLAY_INSET_MAX).default(PET_FORM_DEFAULTS.right).volatile(),
  bottom: z.number().step(1).min(0).max(DISPLAY_INSET_MAX).default(PET_FORM_DEFAULTS.bottom).volatile(),
  bubbleScale: z.number().step(0.05).min(BUBBLE_SCALE_MIN).max(BUBBLE_SCALE_MAX).default(PET_FORM_DEFAULTS.bubbleScale).volatile(),
  // An absent profile choice must leave the selection persisted in pet.json
  // intact across restarts (aggregate rows have no served Host pet form).
  petId: z.string().volatile(),
  enabled: z.boolean().default(PET_FORM_DEFAULTS.enabled).volatile(),
  decorationEnabled: z.boolean().default(PET_FORM_DEFAULTS.decorationEnabled).volatile(),
})

/**
 * Read one live config field.
 * @param field - the field's live reference, plain value, or nothing at all.
 * @param fallback - value used when the field is absent.
 * @returns the current field value.
 */
function readLive<T>(field: LiveField<T> | undefined, fallback: T): T {
  if (field === undefined) return fallback
  const ref = field as { get?: () => T | undefined }
  return typeof ref.get === 'function' ? ref.get() ?? fallback : field as T
}

/**
 * The settings section the pet runs with: the effective values of the row's
 * own config. `fallbackPetId` covers a mount whose config names no pet at all
 * (a direct mount outside a Loader) — under a Loader the schema default is
 * always present, so the persisted selection stands whenever the config
 * carries it.
 * @param config - the effective config of the pet row.
 * @param fallbackPetId - pet id to use when the config names none.
 * @returns the resolved settings section.
 */
export function petSettingsSection(config: PetFormConfig, fallbackPetId: string): PetSettingsSection {
  return {
    visible: readLive(config.visible, PET_FORM_DEFAULTS.visible),
    size: readLive(config.size, PET_FORM_DEFAULTS.size),
    right: readLive(config.right, PET_FORM_DEFAULTS.right),
    bottom: readLive(config.bottom, PET_FORM_DEFAULTS.bottom),
    bubbleScale: readLive(config.bubbleScale, PET_FORM_DEFAULTS.bubbleScale),
    petId: readLive(config.petId, fallbackPetId),
    enabled: readLive(config.enabled, PET_FORM_DEFAULTS.enabled),
    decorationEnabled: readLive(config.decorationEnabled, PET_FORM_DEFAULTS.decorationEnabled),
  }
}

/** Register the pet service and its API + asset routes on the context. */
export const apply = mountOnce('@linxin666/dsh-pet', applyImpl)

/** Plugin config: the tuning block a profile may declare plus the pet's settings fields. */
export type PetPluginConfig = Omit<PetConfig, 'enabled' | 'decorationEnabled'> & PetFormConfig

function applyImpl(ctx: Context, config: PetPluginConfig = {}): void {
  const registry = config.registry
    ?? loadPetRegistry({
      packageRoot: petPackageRoot(import.meta.url),
      ...(config.pets === undefined ? {} : { extra: config.pets }),
    })
  const service = new PetService(ctx, {
    ...config,
    enabled: readLive(config.enabled, PET_FORM_DEFAULTS.enabled),
    decorationEnabled: readLive(config.decorationEnabled, PET_FORM_DEFAULTS.decorationEnabled),
    registry,
  })

  // The effective settings ARE this row's own config: the Host serves one form
  // per profile entry from `Config` above, and every edit is committed into the
  // running config, so the plugin re-reads the section here instead of holding
  // a separate settings document (0.1.6 registered one through
  // settings.installSection/register and re-resolved it on every change).
  const current = (): PetSettingsSection => petSettingsSection(config, service.selectedPetId())
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
  // Apply the row's config to the running service: pet.json mirrors the live
  // display the drag / hide / summon interactions write (see
  // syncSettingsFromPet), so a section the settings surface never touched
  // resolves back to exactly what the pet already shows (the composition
  // 'base' of the pre-0.1.7 section).
  const syncSettings = (): void => {
    const section = current()
    service.applySettingsSection(section)
    service.setEnabled(section.enabled ?? true)
    syncRoutes()
  }
  // A settings edit lands in this row's live config reference and is announced
  // here; the entry is NOT remounted for it, so the pet applies the new section
  // itself (the pre-0.1.7 host ran the section's onChange hook for this).
  ctx.on('loader/volatile-update', () => { syncSettings() })
  ctx.inject(['settings'], (settingsCtx) => {
    // The pet ships its own settings card (the browser half's
    // 'settings.section' page), so the Host must not also generate a page for
    // this entry from Config.
    settingsCtx.effect(() => {
      try {
        return settingsCtx.settings.configure({ auto: false }, ctx.fiber)
      } catch {
        return () => {}
      }
    }, 'pet: settings page policy')
  })
  syncSettings()
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. Declared by the Loader and
     * restated here because this package carries no dependency on its types.
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}
