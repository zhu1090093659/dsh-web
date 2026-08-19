export interface RendererLoadEventSource {
  on(event: string, listener: (...arguments_: unknown[]) => void): unknown
  off(event: string, listener: (...arguments_: unknown[]) => void): unknown
}

export type RendererReloadOutcome = 'loaded' | 'failed' | 'timed-out'

export interface RendererReloadWatchdog {
  dispose(): void
}

/** Observe exactly one renderer reload and release all listeners when it settles. */
export function watchRendererReload(
  events: RendererLoadEventSource,
  timeoutMs: number,
  onSettled: (outcome: RendererReloadOutcome) => void,
): RendererReloadWatchdog {
  let settled = false
  let timer: NodeJS.Timeout | undefined

  const cleanup = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    events.off('did-finish-load', didFinishLoad)
    events.off('did-fail-load', didFailLoad)
  }
  const settle = (outcome: RendererReloadOutcome): void => {
    if (settled) return
    settled = true
    cleanup()
    onSettled(outcome)
  }
  const didFinishLoad = (): void => settle('loaded')
  const didFailLoad = (...arguments_: unknown[]): void => {
    const isMainFrame = arguments_[4]
    if (isMainFrame === true) settle('failed')
  }

  events.on('did-finish-load', didFinishLoad)
  events.on('did-fail-load', didFailLoad)
  timer = setTimeout(() => settle('timed-out'), timeoutMs)
  timer.unref?.()

  return {
    dispose(): void {
      if (settled) return
      settled = true
      cleanup()
    },
  }
}
