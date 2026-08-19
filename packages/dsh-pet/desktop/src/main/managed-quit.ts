export interface ManagedQuitGate {
  /** Resolves true only when this gate actually invokes the quit callback. */
  schedule(): Promise<boolean>
  cancel(): void
  dispose(): void
}

/**
 * Delay the last-parent exit briefly so a rapid disable/re-enable can cancel
 * it before Electron starts tearing down the primary single-instance owner.
 */
export function createManagedQuitGate(
  quit: () => void,
  delayMs = 250,
  canQuit: () => boolean = () => true,
): ManagedQuitGate {
  let timer: NodeJS.Timeout | undefined
  let pending: { promise: Promise<boolean>; resolve(value: boolean): void } | undefined

  const settle = (value: boolean): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const current = pending
    pending = undefined
    current?.resolve(value)
  }

  const cancel = (): void => {
    settle(false)
  }

  return {
    schedule(): Promise<boolean> {
      if (pending !== undefined) return pending.promise
      let resolvePending!: (value: boolean) => void
      const promise = new Promise<boolean>((resolve) => { resolvePending = resolve })
      pending = { promise, resolve: resolvePending }
      timer = setTimeout(() => {
        timer = undefined
        if (!canQuit()) {
          settle(false)
          return
        }
        settle(true)
        quit()
      }, delayMs)
      timer.unref?.()
      return promise
    },
    cancel,
    dispose: cancel,
  }
}

export interface SingleInstanceApp {
  releaseSingleInstanceLock(): void
  quit(): void
}

/** Release the forwarding lock before beginning normal Electron teardown. */
export function quitSingleInstance(app: SingleInstanceApp): void {
  app.releaseSingleInstanceLock()
  app.quit()
}
