export const READY_ACK_RETRY_DELAYS_MS = [250, 750, 1_500] as const

export interface ReadyAcknowledgementRetry {
  dispose(): void
}

export interface ManagedReadyConnection {
  sourceId: string
  origin: string
  nativeToken: string
}

export interface ManagedReadyClient {
  verifyConnection(origin: string, nativeToken: string): Promise<unknown>
  announcePresentationReady(
    sourceId: string,
    desktopPid: number,
    origin: string,
    nativeToken: string,
  ): Promise<void>
}

/**
 * Bind an acknowledgement to the exact Host generation that was verified.
 * The second identity check closes a token/origin replacement race while the
 * state request is in flight.
 */
export async function verifyAndAcknowledgeManagedConnection(
  client: ManagedReadyClient,
  connection: ManagedReadyConnection,
  desktopPid: number,
  isCurrent: () => boolean,
): Promise<void> {
  await client.verifyConnection(connection.origin, connection.nativeToken)
  if (!isCurrent()) throw new Error('managed connection changed during verification')
  await client.announcePresentationReady(
    connection.sourceId,
    desktopPid,
    connection.origin,
    connection.nativeToken,
  )
}

/** Run immediately, then retry once after each configured short delay. */
export function startReadyAcknowledgementRetry(
  send: () => Promise<void>,
  isCurrent: () => boolean,
  onSettled: () => void = () => undefined,
  delays: readonly number[] = READY_ACK_RETRY_DELAYS_MS,
): ReadyAcknowledgementRetry {
  let timer: NodeJS.Timeout | undefined
  let failureCount = 0
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    onSettled()
  }
  const run = (): void => {
    if (disposed) return
    if (!isCurrent()) {
      dispose()
      return
    }
    void send().then(dispose, () => {
      if (disposed) return
      const delay = delays[failureCount]
      failureCount += 1
      if (delay === undefined) {
        dispose()
        return
      }
      timer = setTimeout(run, delay)
      timer.unref?.()
    })
  }
  run()
  return { dispose }
}
