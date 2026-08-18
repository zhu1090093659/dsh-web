/** Stable Host-side settings that decide whether pet activity and presentation run. */

export type PetPresentationMode = 'auto' | 'standalone' | 'embedded' | 'none'

export interface PetPluginSettings {
  /** Master switch for the pet domain. */
  enabled: boolean
  /** Session activity projection can be disabled without disabling interactions. */
  activity: {
    enabled: boolean
  }
  /** Presentation policy is independent from activity and surface visibility. */
  presentation: {
    mode: PetPresentationMode
    standaloneAutoStart: boolean
  }
}

export const DEFAULT_PET_PLUGIN_SETTINGS: PetPluginSettings = {
  enabled: true,
  activity: { enabled: true },
  presentation: {
    mode: 'auto',
    standaloneAutoStart: true,
  },
}

/** Parse only the documented environment override vocabulary. */
export function parsePresentationMode(value: unknown): PetPresentationMode | undefined {
  return value === 'auto' || value === 'standalone' || value === 'embedded' || value === 'none'
    ? value
    : undefined
}
