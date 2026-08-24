import { describe, expect, it } from 'vitest'
import { drainObserverBatch } from '../src/client/chat/mermaid-chat.tsx'

describe('drainObserverBatch', () => {
  it('drains the buffer and discards the batch while the panel is absent', () => {
    const pendingRecords = [record(), record(), record()]
    const batch = drainObserverBatch(pendingRecords, false)
    expect(batch).toEqual([])
    expect(pendingRecords).toEqual([])
  })

  it('drains the buffer and returns the batch while the panel is mounted', () => {
    const first = record()
    const second = record()
    const pendingRecords = [first, second]
    const batch = drainObserverBatch(pendingRecords, true)
    expect(batch).toEqual([first, second])
    expect(pendingRecords).toEqual([])
  })

  it('does not accumulate records when streaming mutations keep arriving with the panel absent', () => {
    // Regression guard: the run loop drains the buffer before the
    // panel-absence bail, so a stream of MutationObserver batches must never
    // grow pendingRecords (each batch would pin DOM nodes indefinitely).
    const pendingRecords: MutationRecord[] = []
    pendingRecords.push(record(), record())
    drainObserverBatch(pendingRecords, false)
    pendingRecords.push(record())
    drainObserverBatch(pendingRecords, false)
    expect(pendingRecords).toEqual([])
  })
})

function record(): MutationRecord {
  return { type: 'childList' } as unknown as MutationRecord
}
