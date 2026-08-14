/**
 * Mobile chat display options: which auxiliary rows the chat view renders.
 * Like the theme, the choice persists in localStorage and a tiny module
 * store (subscribe/get) keeps the options sheet and the message list in
 * sync without threading props through the view levels.
 */

export interface MobileDisplayOptions {
  /** Render tool-call disclosures on assistant messages (default on). */
  readonly showTools: boolean
  /**
   * Render host-injected user-role messages — agent instructions, runtime
   * snapshots, skill catalogs (default off: they drown out the conversation
   * on a small screen).
   */
  readonly showSystemMessages: boolean
}

const STORAGE_KEY = 'dsh.remote.displayOptions'
const DEFAULT_OPTIONS: MobileDisplayOptions = { showTools: true, showSystemMessages: false }

let current: MobileDisplayOptions = readStored() ?? DEFAULT_OPTIONS
const listeners = new Set<() => void>()

function readStored(): MobileDisplayOptions | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    return {
      showTools: typeof record['showTools'] === 'boolean' ? record['showTools'] : DEFAULT_OPTIONS.showTools,
      showSystemMessages: typeof record['showSystemMessages'] === 'boolean' ? record['showSystemMessages'] : DEFAULT_OPTIONS.showSystemMessages,
    }
  } catch {
    // Private-mode storage failures are non-fatal; the session keeps the defaults.
    return undefined
  }
}

function persist(options: MobileDisplayOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Private-mode storage failures are non-fatal; the session keeps the choice.
  }
}

/** Current display options (defaults unless the user explicitly toggled). */
export function getDisplayOptions(): MobileDisplayOptions {
  return current
}

/** Subscribe to display-option changes; returns the unsubscribe function. */
export function subscribeDisplayOptions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Merge a partial update into the current options (persisted + broadcast). */
export function setDisplayOptions(patch: Partial<MobileDisplayOptions>): void {
  current = { ...current, ...patch }
  persist(current)
  for (const listener of [...listeners]) listener()
}
