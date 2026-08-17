/**
 * Browser half of the capability seam: asks the host whether one session's
 * effective model accepts image input, so the send hook can hand raw image
 * blocks to vision-capable models instead of rewriting every image-bearing
 * send into describe-image references. Answers are cached briefly per session
 * (a mid-session model switch settles within the TTL), in-flight fetches are
 * deduped, and every failure answers false — the conservative value that
 * keeps the legacy rewrite for the text-only models this plugin serves.
 * @module @linxin666/dsh-tool-describe-image/client/capability
 */

/** The host capability endpoint, same-origin with the web shell. */
export const CAPABILITY_ENDPOINT = '/describe-image/capability'

/** Default per-session answer cache lifetime, in milliseconds. */
export const DEFAULT_CAPABILITY_TTL_MS = 30 * 1000

/** Default probe fetch timeout, in milliseconds; a stalled host must not stall a send. */
export const DEFAULT_CAPABILITY_TIMEOUT_MS = 1500

/** Tuning knobs for {@link createImageCapabilityChecker}. */
export interface ImageCapabilityCheckerOptions {
  /** Per-session cache lifetime (default {@link DEFAULT_CAPABILITY_TTL_MS}). */
  ttlMs?: number
  /** Fetch timeout (default {@link DEFAULT_CAPABILITY_TIMEOUT_MS}). */
  timeoutMs?: number
}

/** Read the session id off the structural session face the send hook wraps. */
function sessionIdOf(session: unknown): string | undefined {
  if (session === null || typeof session !== 'object') return undefined
  const id = (session as { sessionId?: unknown }).sessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Fetch one session's verdict from the host route. True only on an explicit
 * acceptsImages-true envelope; network failures, bad envelopes, and unknowns
 * all answer false (keep the legacy rewrite).
 * @param sessionId - the session whose model is probed.
 * @param timeoutMs - fetch timeout in milliseconds.
 * @returns whether the model accepts raw image blocks.
 */
export async function fetchSessionAcceptsImages(sessionId: string, timeoutMs: number = DEFAULT_CAPABILITY_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(CAPABILITY_ENDPOINT + '?session=' + encodeURIComponent(sessionId), { signal: controller.signal })
    const envelope = (await response.json()) as { ok?: unknown; value?: unknown } | null
    if (envelope === null || typeof envelope !== 'object' || envelope.ok !== true) return false
    const value = envelope.value as { acceptsImages?: unknown } | null
    return value !== null && typeof value === 'object' && value.acceptsImages === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create the send-hook's capability checker: per-session cached, in-flight
 * deduped, fail-closed. Sessions without a readable id answer false.
 * @param options - cache and timeout tuning.
 * @returns an async predicate over the structural session face.
 */
export function createImageCapabilityChecker(options: ImageCapabilityCheckerOptions = {}): (session: unknown) => Promise<boolean> {
  const ttl = options.ttlMs ?? DEFAULT_CAPABILITY_TTL_MS
  const timeout = options.timeoutMs ?? DEFAULT_CAPABILITY_TIMEOUT_MS
  const cache = new Map<string, { at: number; value: boolean }>()
  const inflight = new Map<string, Promise<boolean>>()
  return (session: unknown): Promise<boolean> => {
    const id = sessionIdOf(session)
    if (id === undefined) return Promise.resolve(false)
    const hit = cache.get(id)
    if (hit !== undefined && Date.now() - hit.at < ttl) return Promise.resolve(hit.value)
    const pending = inflight.get(id)
    if (pending !== undefined) return pending
    const task = fetchSessionAcceptsImages(id, timeout)
    inflight.set(id, task)
    return task.then((value) => {
      cache.set(id, { at: Date.now(), value })
      inflight.delete(id)
      return value
    }, () => {
      inflight.delete(id)
      return false
    })
  }
}
