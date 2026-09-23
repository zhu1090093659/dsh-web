/**
 * One-time pairing grants: the /pair-accept → /pair-app redirect carries a
 * short-lived, single-consume secret instead of the device session id, so a
 * leaked landing URL can never be re-run and a live credential never enters a
 * URL. The consume semantics mirror the reference one-time host capability
 * (delete on every attempt; valid only on a first use inside the TTL).
 */
import { describe, expect, it } from 'vitest'
import { createPairGrantStore, DEFAULT_PAIR_GRANT_TTL_MS, MAX_LIVE_GRANTS, type PairGrantStore } from '../src/pair-grant.ts'

/** A store over a controllable clock and a serial entropy source. */
function makeStore(ttlMs?: number): { store: PairGrantStore; advance: (ms: number) => void } {
  let now = 1_000_000
  let serial = 0
  const store = createPairGrantStore({
    ...(ttlMs === undefined ? {} : { ttlMs }),
    now: () => now,
    createGrant: () => `g-${String(++serial)}`,
  })
  return { store, advance: (ms: number) => { now += ms } }
}

describe('one-time pairing grants', () => {
  it('operator: a pairing grant is spent exactly once and resolves to its device', () => {
    // Given a grant the accept page minted for a fresh device session.
    const { store } = makeStore()
    const { grant, expiresAt } = store.issue('dev-1')
    expect(grant).toBe('g-1')
    expect(expiresAt).toBe(1_000_000 + DEFAULT_PAIR_GRANT_TTL_MS)
    // When the landing redeems the same grant twice.
    const first = store.consume(grant)
    const replay = store.consume(grant)
    // Then the first redemption resolves the device and the replay nothing:
    // the record is deleted before it is validated.
    expect(first).toBe('dev-1')
    expect(replay).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('guest: a grant whose TTL elapsed is refused and dropped from the table', () => {
    // Given a grant that was minted a full TTL ago.
    const { store, advance } = makeStore()
    const { grant } = store.issue('dev-1')
    advance(DEFAULT_PAIR_GRANT_TTL_MS)
    // When the landing redeems it.
    const device = store.consume(grant)
    // Then it resolves to nothing and no stale record is left behind.
    expect(device).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('guest: a grant one millisecond inside its TTL still resolves', () => {
    // Given a grant redeemed just inside its window.
    const { store, advance } = makeStore()
    const { grant } = store.issue('dev-1')
    advance(DEFAULT_PAIR_GRANT_TTL_MS - 1)
    // When the landing redeems it.
    const device = store.consume(grant)
    // Then the device is resolved.
    expect(device).toBe('dev-1')
  })

  it('guest: unknown and empty grants resolve to nothing', () => {
    // Given a store that never issued these values.
    const { store } = makeStore()
    // When the landing redeems them.
    const unknown = store.consume('never-issued')
    const empty = store.consume('')
    const missing = store.consume(undefined)
    // Then every shape is refused.
    expect(unknown).toBeUndefined()
    expect(empty).toBeUndefined()
    expect(missing).toBeUndefined()
  })

  it('operator: peeking at a grant reports it without spending it', () => {
    // Given a live grant the phone-facing fence inspects.
    const { store } = makeStore()
    const { grant } = store.issue('dev-1')
    // When the fence peeks twice and the landing then redeems it.
    const firstPeek = store.peek(grant)
    const secondPeek = store.peek(grant)
    const redeemed = store.consume(grant)
    const afterSpend = store.peek(grant)
    // Then the peeks never consumed the grant and the spend did.
    expect(firstPeek).toBe('dev-1')
    expect(secondPeek).toBe('dev-1')
    expect(redeemed).toBe('dev-1')
    expect(afterSpend).toBeUndefined()
  })

  it('operator: issuing a new grant purges the expired ones', () => {
    // Given one grant that has since expired.
    const { store, advance } = makeStore()
    store.issue('dev-1')
    expect(store.size).toBe(1)
    advance(DEFAULT_PAIR_GRANT_TTL_MS)
    // When the next pairing issues another grant.
    store.issue('dev-2')
    // Then only the live grant remains.
    expect(store.size).toBe(1)
    expect(store.consume('g-1')).toBeUndefined()
  })

  it('operator: the live grant table stays bounded, evicting the oldest first', () => {
    // Given more issued grants than the cap allows.
    const { store } = makeStore()
    for (let i = 0; i < MAX_LIVE_GRANTS + 1; i += 1) store.issue(`dev-${String(i)}`)
    // When the table is inspected at its cap.
    const size = store.size
    // Then the oldest grant is gone and the newest still resolves.
    expect(size).toBe(MAX_LIVE_GRANTS)
    expect(store.consume('g-1')).toBeUndefined()
    expect(store.consume(`g-${String(MAX_LIVE_GRANTS + 1)}`)).toBe(`dev-${String(MAX_LIVE_GRANTS)}`)
  })

  it('operator: a grant defaults to 256 bits of base64url entropy', () => {
    // Given a store built with the production entropy source.
    const store = createPairGrantStore()
    // When a grant is issued.
    const { grant } = store.issue('dev-1')
    // Then it carries 32 random bytes, base64url encoded without padding.
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
