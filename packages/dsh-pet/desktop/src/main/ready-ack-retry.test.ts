import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  startReadyAcknowledgementRetry,
  verifyAndAcknowledgeManagedConnection,
} from './ready-ack-retry.ts'

afterEach(() => { vi.useRealTimers() })

describe('desktop readiness acknowledgement retry', () => {
  it('makes one immediate attempt plus one attempt for each configured delay', async () => {
    vi.useFakeTimers()
    const send = vi.fn(async () => { throw new Error('host temporarily unavailable') })
    const settled = vi.fn()

    startReadyAcknowledgementRetry(send, () => true, settled, [10, 20, 40])
    await vi.runAllTimersAsync()

    expect(send).toHaveBeenCalledTimes(4)
    expect(settled).toHaveBeenCalledOnce()
  })

  it('stops as soon as an acknowledgement succeeds or the source is stale', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    startReadyAcknowledgementRetry(send, () => true, undefined, [10, 20, 40])
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenCalledTimes(2)

    const staleSend = vi.fn(async () => undefined)
    startReadyAcknowledgementRetry(staleSend, () => false)
    expect(staleSend).not.toHaveBeenCalled()
  })

  it('does not acknowledge an old generation after origin and token rotate', async () => {
    let finishOldVerification!: () => void
    const oldVerification = new Promise<void>((resolve) => { finishOldVerification = resolve })
    const client = {
      verifyConnection: vi.fn()
        .mockReturnValueOnce(oldVerification)
        .mockResolvedValueOnce(undefined),
      announcePresentationReady: vi.fn(async () => undefined),
    }
    const oldConnection = {
      sourceId: 'dsh-pet:web:42:old',
      origin: 'http://127.0.0.1:3080',
      nativeToken: 'o'.repeat(43),
    }
    const nextConnection = {
      sourceId: 'dsh-pet:web:42:new',
      origin: 'http://127.0.0.1:4080',
      nativeToken: 'n'.repeat(43),
    }
    let current = oldConnection

    const stale = verifyAndAcknowledgeManagedConnection(
      client,
      oldConnection,
      6_300,
      () => current === oldConnection,
    )
    current = nextConnection
    finishOldVerification()
    await expect(stale).rejects.toThrow('managed connection changed')
    expect(client.announcePresentationReady).not.toHaveBeenCalled()

    await expect(verifyAndAcknowledgeManagedConnection(
      client,
      nextConnection,
      6_300,
      () => current === nextConnection,
    )).resolves.toBeUndefined()
    expect(client.verifyConnection).toHaveBeenLastCalledWith(
      nextConnection.origin,
      nextConnection.nativeToken,
    )
    expect(client.announcePresentationReady).toHaveBeenCalledWith(
      nextConnection.sourceId,
      6_300,
      nextConnection.origin,
      nextConnection.nativeToken,
    )
  })
})
