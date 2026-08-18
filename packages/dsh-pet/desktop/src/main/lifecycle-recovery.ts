export interface RecoveryEventSource {
  on(event: string, listener: (...arguments_: unknown[]) => void): unknown
  off(event: string, listener: (...arguments_: unknown[]) => void): unknown
}

export interface DesktopRecoveryCallbacks {
  onResume(): void
  onGpuProcessGone(): void
}

/** Bind wake/GPU recovery without retaining Electron globals after shutdown. */
export function installDesktopRecoveryEvents(
  appEvents: RecoveryEventSource,
  powerEvents: RecoveryEventSource,
  callbacks: DesktopRecoveryCallbacks,
): () => void {
  const resume = (): void => callbacks.onResume()
  const childProcessGone = (_event: unknown, details: unknown): void => {
    if (typeof details !== 'object' || details === null) return
    const type = (details as { type?: unknown }).type
    if (typeof type === 'string' && type.toLowerCase() === 'gpu') callbacks.onGpuProcessGone()
  }
  powerEvents.on('resume', resume)
  appEvents.on('child-process-gone', childProcessGone)
  return () => {
    powerEvents.off('resume', resume)
    appEvents.off('child-process-gone', childProcessGone)
  }
}
