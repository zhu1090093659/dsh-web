/**
 * Persistence helpers for panel preferences: range-validated reads (invalid
 * stored values fall back to defaults — a broken or hand-edited value must
 * never produce a 0px or NaN panel), debounced writes, and the LRU registry
 * for preview scopes (at most 12 scopes; the oldest savedAt evicts).
 *
 * Keys follow the AionUi contract verbatim:
 *   chat-workspace-width-px, chat-preview-width-px, preview-panel-split-ratio,
 *   project-panel-collapse:<root>, explorer-ui:<root>, scm-ui:<root>,
 *   preview-ui:<root>.
 * @module dsh-aionui-panel/client/persist
 */

/** Read a stored number, validating it against [min, max]; fallback otherwise. */
export function readStoredNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    if (value < min || value > max) return fallback
    return value
  } catch {
    return fallback
  }
}

/** Write a number if it differs from the stored value (avoids churn). */
export function writeStoredNumber(key: string, value: number): void {
  try {
    const raw = String(Math.round(value))
    if (localStorage.getItem(key) === raw) return
    localStorage.setItem(key, raw)
  } catch {
    // persistence is best-effort; the panel still works
  }
}

/**
 * A single debounce pipeline used by the stores for its search and persist
 * timers: coalesces rapid schedules into one trailing run (the latest fn wins).
 * `flush` runs the pending fn immediately (pagehide/beforeunload), `dispose`
 * cancels a pending schedule. Behavior is equivalent to the stores' previous
 * hand-rolled setTimeout + clearTimeout pairs, just centralized.
 */
export interface Debounced {
  /** Queue a fn; repeated calls before the delay replaces the pending fn. */
  schedule: (fn: () => void) => void
  /** Run the pending fn now and clear the timer. */
  flush: () => void
  /** Cancel the pending fn and timer. */
  dispose: () => void
}

/** Create one debounced scheduler (default 150ms). */
export function createDebounced(delayMs = 150): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: (() => void) | null = null
  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const fn = pending
    pending = null
    if (fn !== null) fn()
  }
  return {
    schedule(fn: () => void) {
      pending = fn
      // Reset on every schedule so the run trails the LAST change (the same
      // trailing-edge semantics the stores' former clear+setTimeout had).
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush,
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending = null
    },
  }
}

/** The preview-ui scope registry: keys, savedAt values, eviction. */
export const PREVIEW_SCOPE_PREFIX = 'preview-ui:'
/** LRU cap on distinct preview scopes. */
export const PREVIEW_SCOPE_CAP = 12

/**
 * Collect every stored key under a prefix. localStorage has no prefix index,
 * so the whole store is swept once, then filtered to the package's own keys
 * — enumeration is never interleaved with removal (removals would shift the
 * indices mid-loop and skip entries).
 */
function listStoredKeysByPrefix(prefix: string): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null && key.startsWith(prefix)) keys.push(key)
    }
  } catch {
    return []
  }
  return keys
}

/**
 * Precisely delete every stored key under a prefix. Only this package's own
 * prefixed keys are removed — foreign-application keys are never touched,
 * replacing the former all-at-once `localStorage.clear()` sweep.
 */
export function removeStoredByPrefix(prefix: string): number {
  const keys = listStoredKeysByPrefix(prefix)
  let removed = 0
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
      removed += 1
    } catch {
      // best-effort; a storage failure does not abort the rest
    }
  }
  return removed
}

/** All stored preview scopes with their savedAt timestamps, oldest first. */
export function listPreviewScopes(): Array<{ root: string; savedAt: number }> {
  const out: Array<{ root: string; savedAt: number }> = []
  for (const key of listStoredKeysByPrefix(PREVIEW_SCOPE_PREFIX)) {
    const root = key.slice(PREVIEW_SCOPE_PREFIX.length)
    let savedAt = 0
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { savedAt?: unknown }
        if (typeof parsed.savedAt === 'number') savedAt = parsed.savedAt
      }
    } catch {
      savedAt = 0
    }
    out.push({ root, savedAt })
  }
  out.sort((a, b) => a.savedAt - b.savedAt)
  return out
}

/** Evict the oldest scopes beyond the cap. */
export function evictPreviewScopes(keep: string): void {
  // Cheap pre-check first: enumerate keys only (no JSON.parse, no sort).
  // Writes far below the cap — the common case — return here instead of
  // parsing and sorting every stored preview scope on each persist.
  if (listStoredKeysByPrefix(PREVIEW_SCOPE_PREFIX).length <= PREVIEW_SCOPE_CAP) return
  const scopes = listPreviewScopes().filter((scope) => scope.root !== keep)
  let excess = scopes.length - (PREVIEW_SCOPE_CAP - 1)
  for (const scope of scopes) {
    if (excess <= 0) break
    try {
      localStorage.removeItem(`${PREVIEW_SCOPE_PREFIX}${scope.root}`)
    } catch {
      // best-effort
    }
    excess -= 1
  }
}

/** Serialize a JSON value with a size guard (quota failures degrade silently). */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    try {
      localStorage.removeItem(key)
    } catch {
      // storage unavailable entirely
    }
    return false
  }
}

/** Parse a stored JSON value; fallback on any failure. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    // JSON.parse('null') yields null without throwing; descending callers
    // expect an object and would throw on null/primitive, killing their effect.
    if (parsed === null || typeof parsed !== 'object') return fallback
    return parsed as T
  } catch {
    return fallback
  }
}
