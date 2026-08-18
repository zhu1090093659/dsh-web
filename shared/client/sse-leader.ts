/**
 * Cross-tab SSE leader relay (issue #383).
 *
 * Chrome/Edge cap HTTP/1.1 connections per origin at 6, and the pool is
 * SHARED across same-origin tabs: every DSH tab already holds the core
 * /plugins/events stream, so each plugin EventSource a tab opens brings two
 * tabs to the pool limit and every plain fetch (list/read/git-status POSTs)
 * queues forever. There is no per-tab fix inside the fetch layer — the
 * streams themselves must be shared.
 *
 * This module keeps exactly ONE EventSource per URL across the whole
 * browser: tabs elect a leader through the Web Locks API (the lock releases
 * automatically when the leader's tab closes or navigates), the leader
 * relays every event over a BroadcastChannel, and followers receive the
 * broadcast instead of opening their own stream. Within one tab, callers
 * sharing a URL also share the single relay. When Web Locks or
 * BroadcastChannel is unavailable the module degrades to the old behavior
 * (one plain EventSource per subscription) — never worse than today.
 */

/** Constructor/namespace seams so tests can drive the relay without a browser. */
export interface SseRelaySeams {
  eventSource?: typeof EventSource
  broadcastChannel?: typeof BroadcastChannel
  locks?: LockManager
}

interface Relay {
  listeners: Set<(data: string) => void>
  destroy(): void
}

/** Live relays keyed by event name + URL (one per tab, ref-counted by listeners). */
const relays = new Map<string, Relay>()

/**
 * Subscribe to an SSE endpoint shared across every tab of the browser.
 * @param url - same-origin EventSource URL (including its query string).
 * @param eventName - the SSE event field to listen for (e.g. 'change').
 * @param onEvent - fired with the raw event data string on every push.
 * @param seams - constructor overrides (tests).
 * @returns the disposer; destroying the LAST local listener tears the relay down.
 */
export function subscribeSharedEvents(
  url: string,
  eventName: string,
  onEvent: (data: string) => void,
  seams: SseRelaySeams = {},
): () => void {
  const key = eventName + ' ' + url
  let relay = relays.get(key)
  if (relay === undefined) {
    relay = createRelay(key, url, eventName, seams)
    relays.set(key, relay)
  }
  relay.listeners.add(onEvent)
  return () => {
    const current = relays.get(key)
    if (current === undefined) return
    current.listeners.delete(onEvent)
    if (current.listeners.size === 0) {
      current.destroy()
      relays.delete(key)
    }
  }
}

function createRelay(key: string, url: string, eventName: string, seams: SseRelaySeams): Relay {
  const listeners = new Set<(data: string) => void>()
  const dispatch = (data: string): void => {
    for (const listener of [...listeners]) listener(data)
  }

  const EventSourceImpl = seams.eventSource ?? EventSource
  const ChannelImpl = seams.broadcastChannel
    ?? (typeof BroadcastChannel === 'undefined' ? undefined : BroadcastChannel)
  const locks = seams.locks
    ?? (typeof navigator === 'undefined' || navigator.locks === undefined ? undefined : navigator.locks)

  // Degraded path: without cross-tab machinery, behave exactly like a plain
  // per-subscription EventSource (the pre-relay behavior).
  if (ChannelImpl === undefined || locks === undefined) {
    const source = new EventSourceImpl(url)
    source.addEventListener(eventName, (raw) => { dispatch((raw as MessageEvent).data as string) })
    return { listeners, destroy: () => { source.close() } }
  }

  const channel = new ChannelImpl('dsh-sse:' + key)
  channel.addEventListener('message', (raw) => { dispatch((raw as MessageEvent).data as string) })

  // Leadership candidacy: queued requests wait until the incumbent's lock
  // releases (tab close, or a voluntary teardown below); the grant then
  // promotes this tab and opens the browser-wide stream.
  const abort = new AbortController()
  let release: (() => void) | undefined
  let source: EventSource | undefined
  void locks.request('dsh-sse:' + key, { signal: abort.signal }, () => {
    source = new EventSourceImpl(url)
    source.addEventListener(eventName, (raw) => {
      const data = (raw as MessageEvent).data as string
      channel.postMessage(data)
      dispatch(data)
    })
    // The lock is held until this promise settles; destroy() resolves it.
    return new Promise<void>(resolve => { release = resolve })
  }).catch(() => {
    // An aborted candidacy rejects with an AbortError — expected teardown.
  })

  return {
    listeners,
    destroy() {
      channel.close()
      // Queued follower: cancel the candidacy. Leader: end the lock
      // callback, which releases the lock so a waiting tab takes over.
      abort.abort()
      release?.()
      source?.close()
    },
  }
}
