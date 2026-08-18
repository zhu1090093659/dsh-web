/** Stable, log-safe error codes. UI surfaces localized copy instead. */
export const PET_ERROR_CODES = Object.freeze({
  disabled: 'PET_DISABLED',
  presentationHeadless: 'PRESENTATION_HEADLESS',
  presentationRuntimeMissing: 'PRESENTATION_RUNTIME_MISSING',
  presentationHostUnavailable: 'PRESENTATION_HOST_UNAVAILABLE',
  presentationBridgeUnavailable: 'PRESENTATION_BRIDGE_UNAVAILABLE',
  presentationStartFailed: 'PRESENTATION_START_FAILED',
  nativeAuthRequired: 'NATIVE_AUTH_REQUIRED',
  nativeAuthInvalid: 'NATIVE_AUTH_INVALID',
  nativeLoopbackRequired: 'NATIVE_LOOPBACK_REQUIRED',
  rendererNotFound: 'RENDERER_NOT_FOUND',
  rendererIncompatible: 'RENDERER_INCOMPATIBLE',
  rendererLoadFailed: 'RENDERER_LOAD_FAILED',
  rendererContextLost: 'RENDERER_CONTEXT_LOST',
  modelNotFound: 'MODEL_NOT_FOUND',
  modelInvalid: 'MODEL_INVALID',
  modelImportFailed: 'MODEL_IMPORT_FAILED',
  returnTargetUnavailable: 'RETURN_TARGET_UNAVAILABLE',
} as const)

export type PetErrorCode = typeof PET_ERROR_CODES[keyof typeof PET_ERROR_CODES]
