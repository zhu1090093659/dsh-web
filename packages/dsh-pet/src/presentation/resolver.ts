import type { PetPluginSettings } from './config.ts'
import type { PetPresentationEnvironment } from './environment.ts'

export type PetResolvedPresentationKind = 'none' | 'standalone' | 'embedded'

export type PetPresentationReason =
  | 'disabled'
  | 'configured-none'
  | 'embedded-host'
  | 'embedded-host-pending'
  | 'forced-standalone'
  | 'auto-standalone'
  | 'headless'
  | 'container'
  | 'ci'
  | 'runtime-missing'
  | 'web-bridge-missing'
  | 'unsupported-platform'

export interface PetResolvedPresentation {
  kind: PetResolvedPresentationKind
  reason: PetPresentationReason
  hostId?: string
}

const SUPPORTED_STANDALONE_PLATFORMS = new Set<NodeJS.Platform>(['win32', 'darwin', 'linux'])

function none(reason: PetPresentationReason, hostId?: string): PetResolvedPresentation {
  return { kind: 'none', reason, ...(hostId === undefined ? {} : { hostId }) }
}

function standalonePrerequisiteFailure(
  environment: PetPresentationEnvironment,
): PetResolvedPresentation | undefined {
  if (!environment.standaloneRuntimeAvailable) return none('runtime-missing')
  if (!environment.webBridgeAvailable) return none('web-bridge-missing')
  return undefined
}

/** Resolve presentation from settings and captured environment facts only. */
export function resolvePetPresentation(
  settings: PetPluginSettings,
  environment: PetPresentationEnvironment,
): PetResolvedPresentation {
  if (!settings.enabled || environment.disabledByEnvironment) return none('disabled')
  const mode = environment.presentationOverride ?? settings.presentation.mode
  if (mode === 'none') return none('configured-none')

  if (environment.embeddedHostAvailable) {
    return {
      kind: 'embedded',
      reason: 'embedded-host',
      ...(environment.embeddedHostHint === undefined ? {} : { hostId: environment.embeddedHostHint }),
    }
  }
  if (mode === 'embedded' || environment.embeddedHostHint !== undefined) {
    return none('embedded-host-pending', environment.embeddedHostHint)
  }

  if (mode === 'standalone') {
    return standalonePrerequisiteFailure(environment)
      ?? { kind: 'standalone', reason: 'forced-standalone', hostId: 'standalone' }
  }

  if (!settings.presentation.standaloneAutoStart) return none('configured-none')
  if (environment.isCi) return none('ci')
  if (environment.isContainer) return none('container')
  if (!SUPPORTED_STANDALONE_PLATFORMS.has(environment.platform)) return none('unsupported-platform')
  if (environment.isTest || !environment.hasDisplayServer || !environment.appearsInteractive) return none('headless')
  return standalonePrerequisiteFailure(environment)
    ?? { kind: 'standalone', reason: 'auto-standalone', hostId: 'standalone' }
}
