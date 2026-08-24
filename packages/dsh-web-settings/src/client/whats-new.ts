/**
 * Upgrade-detection helper for the Web UI version-notes card.
 *
 * The card shows the changes that shipped since the version the user last
 * acknowledged. A tiny persistence key records the last-seen version, and the
 * card surfaces a "new" affordance only when a newer release exists. A second
 * key tracks whether the release page was auto-shown so the client pops the
 * modal exactly once after each version upgrade (方案 D). The storage face is
 * injectable so tests can exercise every state without a real localStorage, and
 * the helper stays dependency-free (no cordis services).
 */

/** Storage key holding the last version the user acknowledged. */
export const WHATS_NEW_LAST_SEEN_KEY = 'dsh-web-ui:whats-new:last-seen'

/** Storage key holding the version for which the modal was auto-shown. */
export const WHATS_NEW_AUTO_SHOWN_KEY = 'dsh-web-ui:whats-new:auto-shown'

/** Storage key holding the user's "don't auto-popup" preference. */
export const WHATS_NEW_SUPPRESS_KEY = 'dsh-web-ui:whats-new:suppress'

/** Minimal synchronous string storage (localStorage / an in-memory stand-in). */
export interface StringStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Version string comparison that understands dotted numeric versions. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)
  const av = parse(a)
  const bv = parse(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** True when `candidate` is a newer version than `lastSeen` (absent lastSeen ⇒ new). */
export function isNewerVersion(candidate: string, lastSeen: string | undefined): boolean {
  if (lastSeen === undefined || lastSeen === '') return true
  return compareVersions(candidate, lastSeen) > 0
}

/** The last version the user acknowledged, or undefined when never seen. */
export function readLastSeen(storage: StringStorage, key = WHATS_NEW_LAST_SEEN_KEY): string | undefined {
  const value = storage.getItem(key)
  return value === null || value === '' ? undefined : value
}

/**
 * Decide whether the version-notes card should advertise a fresh release.
 * @param storage - the persistence face.
 * @param current - the currently installed version (CURRENT_VERSION).
 * @param key - storage key (defaults to WHATS_NEW_LAST_SEEN_KEY).
 * @returns true when a release newer than the acknowledged one exists.
 */
export function hasNewRelease(storage: StringStorage, current: string, key = WHATS_NEW_LAST_SEEN_KEY): boolean {
  return isNewerVersion(current, readLastSeen(storage, key))
}

/** Record that the user acknowledged the current version. */
export function acknowledgeVersion(storage: StringStorage, current: string, key = WHATS_NEW_LAST_SEEN_KEY): void {
  storage.setItem(key, current)
}

// ---------- Auto-shown tracking (方案 D: one-time modal popup) ----------

/** The version for which the modal was auto-shown, or undefined when never auto-shown. */
export function readAutoShown(storage: StringStorage, key = WHATS_NEW_AUTO_SHOWN_KEY): string | undefined {
  const value = storage.getItem(key)
  return value === null || value === '' ? undefined : value
}

/** Record that the modal was auto-shown for the given version. */
export function setAutoShown(storage: StringStorage, current: string, key = WHATS_NEW_AUTO_SHOWN_KEY): void {
  storage.setItem(key, current)
}

/**
 * Decide whether the release page should auto-popup on mount (方案 D).
 *
 * Auto-popup fires exactly once per version: the first time the client
 * mounts after an upgrade. Once the modal was auto-shown for a version,
 * subsequent mounts suppress the popup until the next upgrade. The user's
 * "don't auto-popup" preference is also checked.
 *
 * @returns true when a new release exists AND the modal was not yet auto-shown
 *   for this version AND the user has not suppressed auto-popup.
 */
export function shouldAutoPopup(storage: StringStorage, current: string): boolean {
  return hasNewRelease(storage, current)
    && readAutoShown(storage) !== current
    && !readSuppress(storage)
}

// ---------- Suppress preference (don't auto-popup checkbox) ----------

/** True when the user has chosen to suppress auto-popup. */
export function readSuppress(storage: StringStorage, key = WHATS_NEW_SUPPRESS_KEY): boolean {
  return storage.getItem(key) === '1'
}

/** Persist the user's auto-popup suppression preference. */
export function setSuppress(storage: StringStorage, suppressed: boolean, key = WHATS_NEW_SUPPRESS_KEY): void {
  if (suppressed) {
    storage.setItem(key, '1')
  } else {
    storage.setItem(key, '')
  }
}
