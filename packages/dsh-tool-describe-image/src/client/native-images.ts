/**
 * Browser half of the native-image configuration seam (rc.8 feature): reads
 * the current agent-default route's image-input state from the host route
 * and toggles the DeepSeek adapter catalog entry. Every failure answers a
 * conservative envelope — the section renders an unsupported hint instead of
 * throwing, and a failed toggle never pretends the state changed.
 * @module @linxin666/dsh-tool-describe-image/client/native-images
 */

/** The host native-image endpoint, same-origin with the web shell. */
export const NATIVE_IMAGES_ENDPOINT = '/describe-image/native-images'

/** Wire state mirrored from the host route. */
export interface NativeImageClientState {
  provider?: string
  model?: string
  capability: { acceptsImages: boolean; known: boolean }
  inputModalities?: readonly string[]
  supported: boolean
}

/** Toggle result: the refreshed state on success, a message on failure. */
export interface NativeImageToggleResult {
  ok: boolean
  value?: NativeImageClientState
  message?: string
}

/** Default fetch timeouts: reads are quick, writes ride the settings seam. */
export const DEFAULT_NATIVE_STATE_TIMEOUT_MS = 4000
export const DEFAULT_NATIVE_TOGGLE_TIMEOUT_MS = 8000

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Read the current native-image state; null when the host route is unreachable. */
export async function fetchNativeImageState(timeoutMs: number = DEFAULT_NATIVE_STATE_TIMEOUT_MS): Promise<NativeImageClientState | null> {
  try {
    const response = await fetchWithTimeout(NATIVE_IMAGES_ENDPOINT, {}, timeoutMs)
    const envelope = (await response.json()) as { ok?: unknown; value?: unknown } | null
    if (envelope === null || typeof envelope !== 'object' || envelope.ok !== true) return null
    return envelope.value as NativeImageClientState | null
  } catch {
    return null
  }
}

/** Toggle native image input; the envelope carries the refreshed state or the refusal. */
export async function setNativeImageEnabled(enabled: boolean, timeoutMs: number = DEFAULT_NATIVE_TOGGLE_TIMEOUT_MS): Promise<NativeImageToggleResult> {
  try {
    const response = await fetchWithTimeout(NATIVE_IMAGES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }, timeoutMs)
    const envelope = (await response.json()) as { ok?: unknown; value?: unknown; message?: unknown } | null
    if (envelope === null || typeof envelope !== 'object') return { ok: false, message: 'bad envelope' }
    if (envelope.ok === true) return { ok: true, value: envelope.value as NativeImageClientState }
    return { ok: false, message: typeof envelope.message === 'string' ? envelope.message : 'request rejected' }
  } catch {
    return { ok: false, message: 'request failed' }
  }
}
