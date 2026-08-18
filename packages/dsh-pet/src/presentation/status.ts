import type { PetPresentationMode, PetPluginSettings } from './config.ts'
import type { PetResolvedPresentation, PetResolvedPresentationKind } from './resolver.ts'
import type { PetReturnTarget } from '../contracts/desktop-host.ts'
import { PET_ERROR_CODES, type PetErrorCode } from '../errors.ts'

export type PetPresentationPhase =
  | 'disabled'
  | 'resolving'
  | 'none'
  | 'starting'
  | 'ready'
  | 'hidden'
  | 'unavailable'
  | 'failed'

export interface PetPresentationState {
  mode: PetPresentationMode
  resolved: PetResolvedPresentationKind
  phase: PetPresentationPhase
  available: boolean
  visible: boolean
  reason?: string
  errorCode?: PetErrorCode
  host?: {
    id: string
    name: string
    embedded: boolean
    ownsTray: boolean
  }
  returnTarget?: PetReturnTarget
}

const UNAVAILABLE_REASONS = new Set([
  'embedded-host-pending',
  'runtime-missing',
  'web-bridge-missing',
  'unsupported-platform',
])

function errorCodeForResolution(resolution: PetResolvedPresentation): PetErrorCode | undefined {
  switch (resolution.reason) {
    case 'disabled': return PET_ERROR_CODES.disabled
    case 'headless':
    case 'container':
    case 'ci':
    case 'unsupported-platform': return PET_ERROR_CODES.presentationHeadless
    case 'runtime-missing': return PET_ERROR_CODES.presentationRuntimeMissing
    case 'embedded-host-pending': return PET_ERROR_CODES.presentationHostUnavailable
    case 'web-bridge-missing': return PET_ERROR_CODES.presentationBridgeUnavailable
    default: return undefined
  }
}

/** Project one resolved decision onto the diagnostic state consumed by UI and tests. */
export function presentationStateFromResolution(
  settings: PetPluginSettings,
  resolution: PetResolvedPresentation,
  visible: boolean,
): PetPresentationState {
  if (resolution.kind === 'none') {
    const errorCode = errorCodeForResolution(resolution)
    return {
      mode: settings.presentation.mode,
      resolved: 'none',
      phase: resolution.reason === 'disabled'
        ? 'disabled'
        : UNAVAILABLE_REASONS.has(resolution.reason) ? 'unavailable' : 'none',
      available: false,
      visible: false,
      reason: resolution.reason,
      ...(errorCode === undefined ? {} : { errorCode }),
    }
  }
  const embedded = resolution.kind === 'embedded'
  return {
    mode: settings.presentation.mode,
    resolved: resolution.kind,
    phase: visible ? 'ready' : 'hidden',
    available: true,
    visible,
    reason: resolution.reason,
    host: {
      id: resolution.hostId ?? resolution.kind,
      name: embedded ? 'Embedded DSH Host' : 'Standalone dsh-pet',
      embedded,
      ownsTray: !embedded,
    },
  }
}
