/**
 * Attempt-store lifecycle: notice accumulation, prompt answer/withdraw,
 * cancel, settle-once, and bounded retention.
 * @module dsh-provider-signin/tests/attempts.spec
 */

import { describe, expect, it } from 'vitest'
import { AttemptStore } from '../src/host/attempts.ts'

describe('AttemptStore', () => {
  it('accumulates notices with monotonic sequence numbers and caps retention', () => {
    const store = new AttemptStore()
    const relay = store.create('llm-pi-ai/xai')
    for (let index = 0; index < 260; index += 1) relay.notify({ message: `n${String(index)}` })
    const view = store.view(relay.id, 0)
    expect(view?.status).toBe('running')
    expect(view?.notices).toHaveLength(200)
    expect(view?.notices.at(-1)?.message).toBe('n259')
    expect(view?.notices.at(-1)?.seq).toBe(260)
    // Resume from a cursor: only newer notices come back.
    const tail = store.view(relay.id, 258)
    expect(tail?.notices.map(notice => notice.seq)).toEqual([259, 260])
  })

  it('delivers a prompt answer to the waiting flow and clears pending', async () => {
    const store = new AttemptStore()
    const relay = store.create('llm-pi-ai/openai-codex')
    const pendingPromise = relay.prompt({ kind: 'text', message: 'paste the code' })
    let view = store.view(relay.id, 0)
    expect(view?.pending?.kind).toBe('text')
    const pendingId = view?.pending?.id ?? ''
    const answered = store.answer(relay.id, pendingId, 'the-code')
    expect(answered).toBe(true)
    await expect(pendingPromise).resolves.toBe('the-code')
    view = store.view(relay.id, 0)
    expect(view?.pending).toBeUndefined()
    // A second answer for the same pending id is stale.
    expect(store.answer(relay.id, pendingId, 'again')).toBe(false)
  })

  it('rejects a pending prompt with a decline when the attempt is cancelled', async () => {
    const store = new AttemptStore()
    const relay = store.create('llm-pi-ai/xai')
    const pendingPromise = relay.prompt({ kind: 'secret', message: 'token' })
    store.cancel(relay.id)
    await expect(pendingPromise).rejects.toThrow(/declined/)
    expect(store.view(relay.id, 0)?.status).toBe('cancelled')
    // Settling twice is a no-op.
    relay.settled('authorized')
    expect(store.view(relay.id, 0)?.status).toBe('cancelled')
  })

  it('marks a failed attempt with its error and retires the previous terminal attempt for the key', () => {
    const store = new AttemptStore()
    const first = store.create('llm-pi-ai/xai')
    store.fail(first.id, 'network unreachable')
    expect(store.view(first.id, 0)?.status).toBe('failed')
    expect(store.view(first.id, 0)?.error).toBe('network unreachable')
    // A new attempt for the same key reclaims the terminal predecessor.
    const second = store.create('llm-pi-ai/xai')
    expect(store.view(first.id, 0)).toBeUndefined()
    expect(store.view(second.id, 0)?.status).toBe('running')
  })

  it('dispose cancels running attempts and clears the store', () => {
    const store = new AttemptStore()
    const relay = store.create('llm-pi-ai/xai')
    const pending = relay.prompt({ kind: 'select', message: 'pick', options: [{ id: 'a', label: 'A' }] })
    store.dispose()
    void expect(pending).rejects.toThrow()
    expect(store.view(relay.id, 0)).toBeUndefined()
  })
})
