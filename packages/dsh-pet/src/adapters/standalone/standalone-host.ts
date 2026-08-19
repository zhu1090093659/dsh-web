import type {
  PetPresentationAdapter,
  PetPresentationContext,
  PetPresentationHostView,
} from '../../presentation/controller.ts'
import type { StandaloneRuntimeLaunchHandle } from './launcher.ts'

export interface StandalonePetHostOptions {
  launch(origin: string, nativeToken: string): StandaloneRuntimeLaunchHandle
  waitForReady?: () => StandalonePetReadyWaiter
  isProcessAlive?: (pid: number) => boolean
  livenessIntervalMs?: number
}

export interface StandalonePetReady {
  sourceId: string
  desktopPid: number
}

export interface StandalonePetReadyWaiter {
  readonly ready: Promise<StandalonePetReady>
  dispose(): void
}

type TerminationListener = (reason: string) => void

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Controller adapter around the current managed standalone Electron runtime. */
export class StandalonePetHost implements PetPresentationAdapter {
  readonly kind = 'standalone' as const
  readonly host: PetPresentationHostView = {
    id: 'standalone',
    name: 'Standalone dsh-pet',
    embedded: false,
    ownsTray: true,
  }
  private launchHandle: StandaloneRuntimeLaunchHandle | undefined
  private readyWaiter: StandalonePetReadyWaiter | undefined
  private livenessTimer: NodeJS.Timeout | undefined
  private terminationSignalled = false
  private readonly terminationListeners = new Set<TerminationListener>()

  constructor(private readonly options: StandalonePetHostOptions) {}

  async start(context: PetPresentationContext): Promise<void> {
    if (this.launchHandle !== undefined) return
    if (context.bridgeOrigin === undefined || context.nativeToken === undefined) {
      throw new Error('standalone bridge is unavailable')
    }
    // Register the waiter before spawning. A fast existing primary instance
    // can acknowledge the new source as soon as Electron forwards the
    // second-instance payload.
    const readiness = this.options.waitForReady?.()
    if (readiness !== undefined) this.readyWaiter = readiness
    let handle: StandaloneRuntimeLaunchHandle
    try {
      handle = this.options.launch(context.bridgeOrigin, context.nativeToken)
    } catch (error) {
      if (readiness !== undefined && this.readyWaiter === readiness) this.readyWaiter = undefined
      readiness?.dispose()
      throw error
    }
    this.launchHandle = handle
    this.terminationSignalled = false
    try {
      let acknowledged: StandalonePetReady | undefined
      if (readiness === undefined) await handle.ready
      else [, acknowledged] = await Promise.all([handle.ready, readiness.ready])
      if (this.launchHandle !== handle) throw new Error('standalone-launch-cancelled')
      if (acknowledged !== undefined) this.monitor(handle, acknowledged.desktopPid)
    } catch (error) {
      if (this.launchHandle === handle) this.launchHandle = undefined
      this.clearLivenessTimer()
      handle.dispose()
      throw error
    } finally {
      if (readiness !== undefined && this.readyWaiter === readiness) this.readyWaiter = undefined
      readiness?.dispose()
    }
  }

  cancelStart(_reason?: string): void {
    this.stopLaunch()
  }

  onTerminated(listener: TerminationListener): () => void {
    this.terminationListeners.add(listener)
    return () => { this.terminationListeners.delete(listener) }
  }

  async show(): Promise<void> {
    // Visibility is mirrored through Host settings and the native state stream.
  }

  async hide(): Promise<void> {
    // Visibility is mirrored through Host settings and the native state stream.
  }

  update(_snapshot: unknown): void {
    // Standalone consumes the authenticated SSE stream directly.
  }

  async stop(_reason?: string): Promise<void> {
    this.stopLaunch()
  }

  private stopLaunch(): void {
    const readiness = this.readyWaiter
    this.readyWaiter = undefined
    readiness?.dispose()
    const handle = this.launchHandle
    this.launchHandle = undefined
    this.terminationSignalled = false
    this.clearLivenessTimer()
    handle?.dispose()
  }

  private monitor(handle: StandaloneRuntimeLaunchHandle, desktopPid: number): void {
    const isAlive = this.options.isProcessAlive ?? processIsAlive
    const check = (): void => {
      if (this.launchHandle !== handle || this.terminationSignalled) return
      if (!isAlive(desktopPid)) this.signalTermination(handle, 'standalone-process-exited')
    }
    this.clearLivenessTimer()
    this.livenessTimer = setInterval(check, this.options.livenessIntervalMs ?? 1_000)
    this.livenessTimer.unref?.()

    // Only the process identified by the authenticated ready acknowledgement
    // is authoritative. A different spawned PID is the normal single-instance
    // proxy and its exit must be ignored.
    if (handle.pid === desktopPid && handle.exited !== undefined) {
      void handle.exited.then(() => {
        this.signalTermination(handle, 'standalone-process-exited')
      })
    }
  }

  private signalTermination(handle: StandaloneRuntimeLaunchHandle, reason: string): void {
    if (this.launchHandle !== handle || this.terminationSignalled) return
    this.terminationSignalled = true
    this.clearLivenessTimer()
    for (const listener of this.terminationListeners) {
      try {
        listener(reason)
      } catch {
        // One diagnostic consumer cannot suppress the remaining lifecycle
        // listeners or crash the Host from a timer/child-process callback.
      }
    }
  }

  private clearLivenessTimer(): void {
    if (this.livenessTimer !== undefined) clearInterval(this.livenessTimer)
    this.livenessTimer = undefined
  }
}
