/**
 * One `document.body` MutationObserver per page, shared by every family
 * plugin bundle.
 *
 * Family plugins that inject at the DOM level must notice when the shell
 * re-renders around their injected node: the sidebar entry rows
 * (sidebar-entry-core), the center-column panel containers
 * (panel-mount-core), and the aggregate shell's column shims. Each consumer
 * used to install its OWN `MutationObserver` on `document.body` with
 * `{ childList: true, subtree: true }`, so a page carrying N family plugins
 * paid N native observers and N callback invocations for EVERY mutation batch
 * the app produced — chat token streaming alone produces many per second, and
 * the count grows with the number of installed plugins.
 *
 * This module keeps exactly ONE body observer per page. The registry lives on
 * `globalThis` under a `Symbol.for` key, so the per-package generated copies
 * of this file (scripts/sync-shared.mjs) and separately bundled plugins all
 * reach the same hub at runtime instead of one hub per module instance.
 * Record subscribers receive the mutations accumulated since the last flush.
 * Consumers that only re-check their DOM use subscribeBodyInvalidations:
 * when all subscribers use that path, the hub retains no mutation records
 * (or detached subtrees) while a background page's animation frames pause.
 * Both paths run at most once per frame. The last subscriber disconnects the
 * observer, cancels the pending frame and releases its records.
 *
 * Failure policy: without a DOM or `MutationObserver` the subscription is a
 * no-op disposer (the same silence the per-consumer observers had), and when
 * `requestAnimationFrame` is unavailable the flush runs synchronously so a
 * subscriber is never silently dropped. A throwing subscriber cannot stop the
 * others.
 */

/** The page-wide hub: one observer plus its subscribers and pending records. */
interface BodyMutationHub {
  observer: MutationObserver
  subscribers: Set<(records: MutationRecord[]) => void>
  pending: MutationRecord[]
  scheduled: boolean
  frame?: number
}

/** Cross-bundle registry key; `Symbol.for` so every module copy agrees. */
const HUB_KEY = Symbol.for('dsh-web.body-mutation-hub')
const INVALIDATION_ONLY = Symbol.for('dsh-web.body-mutation-invalidation')
type Subscriber = ((records: MutationRecord[]) => void) & { [INVALIDATION_ONLY]?: true }

function needsRecords(subscribers: Set<(records: MutationRecord[]) => void>): boolean {
  for (const listener of subscribers) {
    if (!(listener as Subscriber)[INVALIDATION_ONLY]) return true
  }
  return false
}

/**
 * Subscribe to a coalesced DOM re-check without retaining mutation records.
 * The marked wrapper also works with an older hub, which delivers records
 * that it simply ignores until a page reload picks up the updated hub.
 */
export function subscribeBodyInvalidations(subscriber: () => void): () => void {
  const listener: Subscriber = () => { subscriber() }
  listener[INVALIDATION_ONLY] = true
  return subscribeBodyMutations(listener)
}

/**
 * Subscribe to body-level childList mutations.
 * @param subscriber - called at most once per animation frame with the records
 *   collected since the previous flush; must be safe to run repeatedly.
 * @returns the disposer removing this subscriber (and the observer when it was
 *   the last one).
 */
export function subscribeBodyMutations(subscriber: (records: MutationRecord[]) => void): () => void {
  if (typeof globalThis === 'undefined' || typeof document === 'undefined') return () => {}
  if (typeof MutationObserver !== 'function') return () => {}
  const registry = globalThis as unknown as Record<symbol, unknown>
  let hub = registry[HUB_KEY] as BodyMutationHub | undefined
  if (hub === undefined) {
    const subscribers = new Set<(records: MutationRecord[]) => void>()
    const created: BodyMutationHub = {
      observer: undefined as unknown as MutationObserver,
      subscribers,
      pending: [],
      scheduled: false,
    }
    const flush = (): void => {
      created.frame = undefined
      created.scheduled = false
      const batch = created.pending
      created.pending = []
      for (const listener of [...subscribers]) {
        if (!subscribers.has(listener)) continue
        try {
          listener(batch)
        } catch {
          // One subscriber must never break the others; the next flush retries it.
        }
      }
    }
    const schedule = (): void => {
      if (created.scheduled) return
      created.scheduled = true
      if (typeof requestAnimationFrame === 'function') created.frame = requestAnimationFrame(flush)
      else flush()
    }
    created.observer = new MutationObserver((records) => {
      if (needsRecords(subscribers)) {
        for (const record of records) created.pending.push(record)
      }
      schedule()
    })
    created.observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
    registry[HUB_KEY] = created
    hub = created
  }
  const active = hub
  active.subscribers.add(subscriber)
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    active.subscribers.delete(subscriber)
    if (!needsRecords(active.subscribers)) active.pending = []
    if (active.subscribers.size === 0 && registry[HUB_KEY] === active) {
      active.observer.disconnect()
      if (active.frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(active.frame)
      active.frame = undefined
      active.pending = []
      active.scheduled = false
      delete registry[HUB_KEY]
    }
  }
}
