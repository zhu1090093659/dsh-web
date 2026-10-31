import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PENDING_VERIFICATION_MS, startPendingVerification } from '../src/client/pending-verify.ts'

/**
 * The mirror's own verification of work in flight. The board learns that the
 * Host moved from a pushed frame, and the browser cannot tell a quiet stream
 * from one that stopped delivering; these cases pin the bound that turns that
 * silence into a state read, and the gate that keeps an idle board silent.
 */
describe('pending verification', () => {
  /** One mirror stand-in: a pending flag plus the notify set it drives. */
  function mirror(initial: boolean): {
    readonly listeners: Set<() => void>
    reads: number
    pending: boolean
    subscribe: (listener: () => void) => () => void
    refresh: () => void
    notify: () => void
  } {
    const face = {
      listeners: new Set<() => void>(),
      reads: 0,
      pending: initial,
      subscribe(listener: () => void): () => void {
        face.listeners.add(listener)
        return () => { face.listeners.delete(listener) }
      },
      refresh(): void { face.reads += 1 },
      notify(): void { for (const listener of [...face.listeners]) listener() },
    }
    return face
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("operator's board re-reads the Host while an execution is open and stops once it settles", () => {
    // Given a mirror that shows one execution the Host has not settled,
    const face = mirror(true)
    const dispose = startPendingVerification({ pending: () => face.pending, refresh: face.refresh, subscribe: face.subscribe })
    // When the stream stays silent for a full interval,
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS - 1)
    expect(face.reads).toBe(0)
    vi.advanceTimersByTime(1)
    // Then the snapshot is read without any frame arriving,
    expect(face.reads).toBe(1)
    // and the read settles it, so the loop disarms itself.
    face.pending = false
    face.notify()
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS * 5)
    expect(face.reads).toBe(1)
    dispose()
  })

  it("operator's idle board spends no state read while nothing is in flight", () => {
    // Given an idle board,
    const face = mirror(false)
    const dispose = startPendingVerification({ pending: () => face.pending, refresh: face.refresh, subscribe: face.subscribe })
    // When unrelated mirror changes notify and time passes,
    face.notify()
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS * 20)
    // Then no state read is spent on it.
    expect(face.reads).toBe(0)
    dispose()
  })

  it("operator's board arms the verification when an execution appears after an idle stretch", () => {
    // Given a board that was idle long enough to have no read in flight,
    const face = mirror(false)
    const dispose = startPendingVerification({ pending: () => face.pending, refresh: face.refresh, subscribe: face.subscribe })
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS * 3)
    expect(face.reads).toBe(0)
    // When a card starts running and the mirror announces it,
    face.pending = true
    face.notify()
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS)
    // Then the verification is armed and reads once.
    expect(face.reads).toBe(1)
    dispose()
  })

  it("operator's board defers its read while the page is hidden and resumes when it is looked at", () => {
    // Given a board with work in flight on a page nobody is looking at,
    const face = mirror(true)
    let visible = false
    const dispose = startPendingVerification({
      pending: () => face.pending,
      refresh: face.refresh,
      subscribe: face.subscribe,
      visible: () => visible,
    })
    // When several intervals pass unseen,
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS * 3)
    // Then nothing is read until the page is looked at again.
    expect(face.reads).toBe(0)
    visible = true
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS)
    expect(face.reads).toBe(1)
    dispose()
  })

  it("operator's board releases its verification timer and subscription when disposed", () => {
    // Given a mounted board that verified work in flight,
    const face = mirror(true)
    const dispose = startPendingVerification({ pending: () => face.pending, refresh: face.refresh, subscribe: face.subscribe })
    // When the board is torn down,
    dispose()
    vi.advanceTimersByTime(PENDING_VERIFICATION_MS * 5)
    face.notify()
    // Then neither the timer nor the subscription survives.
    expect(face.reads).toBe(0)
    expect(face.listeners.size).toBe(0)
  })
})
