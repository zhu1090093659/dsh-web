import { randomUUID } from 'node:crypto'
import type { StandaloneRuntimeView } from '../adapters/standalone/runtime-manager.ts'
import { launchStandaloneRuntime } from '../adapters/standalone/launcher.ts'
import {
  StandalonePetHost,
  type StandalonePetReady,
  type StandalonePetReadyWaiter,
} from '../adapters/standalone/standalone-host.ts'
import type { PetReturnTarget } from '../contracts/desktop-host.ts'
import type { PetSettingsSection } from '../service.ts'
import type { PetPluginSettings } from './config.ts'
import {
  PetPresentationController,
  type PetPresentationAdapter,
} from './controller.ts'
import {
  readPetPresentationEnvironment,
  type ReadPetPresentationEnvironmentOptions,
} from './environment.ts'
import { NullPresentation } from './null-presentation.ts'
import type { PetResolvedPresentation } from './resolver.ts'
import type { PetPresentationState } from './status.ts'

/** Runtime surface used by the production coordinator and its tests. */
export interface PetStandaloneRuntime {
  state(): StandaloneRuntimeView
  executablePath(): string | undefined
  subscribe(listener: (state: StandaloneRuntimeView) => void): () => void
}

export interface PetPresentationIntegrationOptions {
  runtime: PetStandaloneRuntime
  settings(): PetSettingsSection
  moduleUrl: string
  bridgeOrigin: string
  nativeToken: string
  sourceId?: string
  retryDelayMs?: number
  readyTimeoutMs?: number
  maxAutoRetries?: number
  retryBackoffMaxMs?: number
  retryBudgetResetMs?: number
  onRetryExhausted?: () => void | Promise<void>
  livenessIntervalMs?: number
  isProcessAlive?: (pid: number) => boolean
  launch?: typeof launchStandaloneRuntime
  readEnvironment?: (
    options: ReadPetPresentationEnvironmentOptions,
  ) => ReturnType<typeof readPetPresentationEnvironment>
}

/** Map the flat settings-schema compatibility fields onto one policy source. */
export function petPresentationSettings(section: PetSettingsSection): PetPluginSettings {
  const enabled = section.enabled ?? true
  const desktopEnabled = section.desktopEnabled ?? false
  return {
    enabled,
    activity: { enabled },
    presentation: {
      mode: desktopEnabled ? 'auto' : 'none',
      standaloneAutoStart: desktopEnabled,
    },
  }
}

/**
 * Production coordinator joining settings, runtime availability, resolver and
 * the Standalone adapter. Runtime reads are passive: only the explicit HTTP
 * install route is allowed to call the manager's installer.
 */
export class PetPresentationIntegration {
  private readonly controller: PetPresentationController
  private readonly unsubscribeRuntime: () => void
  private readonly unsubscribeController: () => void
  private readonly retryDelayMs: number
  private readonly readyTimeoutMs: number
  private readonly maxAutoRetries: number
  private readonly retryBackoffMaxMs: number
  private readonly retryBudgetResetMs: number
  private readonly readyWaiters = new Map<string, {
    resolve(value: StandalonePetReady): void
    reject(error: Error): void
    timer: NodeJS.Timeout
  }>()
  private runtimeAvailable: boolean | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private retryBudgetResetTimer: NodeJS.Timeout | undefined
  private retryExhaustionTimer: NodeJS.Timeout | undefined
  private retryAttempts = 0
  private retryExhaustionNotified = false
  private disposed = false

  constructor(private readonly options: PetPresentationIntegrationOptions) {
    const launch = options.launch ?? launchStandaloneRuntime
    const sourceId = options.sourceId ?? `dsh-pet:web:${String(process.pid)}`
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    this.readyTimeoutMs = options.readyTimeoutMs ?? 30_000
    this.maxAutoRetries = options.maxAutoRetries ?? 3
    this.retryBackoffMaxMs = options.retryBackoffMaxMs ?? 60_000
    this.retryBudgetResetMs = options.retryBudgetResetMs ?? 60_000
    const returnTarget: PetReturnTarget = {
      kind: 'web',
      id: 'dsh-web',
      label: 'DSH Web',
      url: options.bridgeOrigin,
    }
    this.controller = new PetPresentationController({
      createAdapter: (resolution) => this.createAdapter(resolution, launch, sourceId),
      createContext: (settings, resolution, visible) => ({
        settings,
        resolution,
        visible,
        returnTarget,
        bridgeOrigin: options.bridgeOrigin,
        nativeToken: options.nativeToken,
      }),
      adapterKey: resolution => [
        resolution.kind,
        resolution.hostId ?? '',
        resolution.kind === 'standalone' ? options.runtime.executablePath() ?? '' : '',
      ].join(':'),
      retryDelayMs: this.retryDelayMs,
    })
    this.unsubscribeController = this.controller.subscribe((state) => {
      if (state.phase === 'failed') {
        this.clearRetryBudgetReset()
        this.scheduleRetry()
        return
      }
      this.clearRetry()
      if (state.phase === 'ready' || state.phase === 'hidden') this.scheduleRetryBudgetReset()
      else {
        this.clearRetryBudgetReset()
        if (state.phase === 'disabled' || state.phase === 'none' || state.phase === 'unavailable') {
          this.resetRetryBudget()
        }
      }
    })
    this.runtimeAvailable = options.runtime.executablePath() !== undefined
    this.unsubscribeRuntime = options.runtime.subscribe(() => {
      const available = options.runtime.executablePath() !== undefined
      if (this.runtimeAvailable === available) return
      this.runtimeAvailable = available
      void this.reconcile()
    })
  }

  state(): PetPresentationState {
    return this.controller.state()
  }

  /** Complete the one pending, generation-scoped native readiness waiter. */
  acknowledgeReady(sourceId: string, desktopPid: number): boolean {
    if (this.disposed) return false
    const pending = this.readyWaiters.get(sourceId)
    if (pending === undefined) return false
    this.readyWaiters.delete(sourceId)
    clearTimeout(pending.timer)
    pending.resolve({ sourceId, desktopPid })
    return true
  }

  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const section = this.options.settings()
    const readEnvironment = this.options.readEnvironment ?? readPetPresentationEnvironment
    const environment = readEnvironment({
      standaloneRuntimeAvailable: this.options.runtime.executablePath() !== undefined,
      webBridgeAvailable: true,
      embeddedHostAvailable: false,
    })
    return this.controller.reconcile(
      petPresentationSettings(section),
      environment,
      section.desktopVisible ?? true,
    )
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearRetry()
    this.clearRetryBudgetReset()
    this.clearRetryExhaustionTimer()
    this.unsubscribeRuntime()
    this.unsubscribeController()
    for (const [sourceId, pending] of this.readyWaiters) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`standalone-ready-cancelled:${sourceId}`))
    }
    this.readyWaiters.clear()
    await this.controller.dispose()
  }

  private createAdapter(
    resolution: PetResolvedPresentation,
    launch: typeof launchStandaloneRuntime,
    sourceId: string,
  ): PetPresentationAdapter | undefined {
    if (resolution.kind === 'none') return new NullPresentation()
    if (resolution.kind !== 'standalone') return undefined
    // Every adapter generation owns a distinct parent registration. The
    // previous generation's asynchronous remove process can therefore never
    // delete a freshly re-enabled registration from this Host.
    const generationSourceId = `${sourceId.slice(0, 90)}:${randomUUID()}`
    return new StandalonePetHost({
      launch: (origin, nativeToken) => launch({
        moduleUrl: this.options.moduleUrl,
        runtimeExecutable: this.options.runtime.executablePath(),
        origin,
        nativeToken,
        sourceId: generationSourceId,
      }),
      waitForReady: () => this.createReadyWaiter(generationSourceId),
      ...(this.options.isProcessAlive === undefined ? {} : { isProcessAlive: this.options.isProcessAlive }),
      ...(this.options.livenessIntervalMs === undefined
        ? {}
        : { livenessIntervalMs: this.options.livenessIntervalMs }),
    })
  }

  private createReadyWaiter(sourceId: string): StandalonePetReadyWaiter {
    let resolveReady!: (value: StandalonePetReady) => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<StandalonePetReady>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A synchronous launch failure cancels the waiter before StandalonePetHost
    // can await it; keep that cancellation from becoming an unhandled rejection.
    void ready.catch(() => undefined)
    const timer = setTimeout(() => {
      const pending = this.readyWaiters.get(sourceId)
      if (pending === undefined) return
      this.readyWaiters.delete(sourceId)
      pending.reject(new Error('standalone-ready-timeout'))
    }, this.readyTimeoutMs)
    timer.unref?.()
    const pending = { resolve: resolveReady, reject: rejectReady, timer }
    this.readyWaiters.set(sourceId, pending)
    return {
      ready,
      dispose: () => {
        if (this.readyWaiters.get(sourceId) !== pending) return
        this.readyWaiters.delete(sourceId)
        clearTimeout(timer)
        rejectReady(new Error('standalone-ready-cancelled'))
      },
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== undefined) return
    if (this.retryAttempts >= this.maxAutoRetries) {
      this.notifyRetryExhausted()
      return
    }
    const delay = Math.min(
      this.retryDelayMs * (2 ** this.retryAttempts),
      this.retryBackoffMaxMs,
    )
    this.retryAttempts += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.reconcile()
    }, delay)
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private scheduleRetryBudgetReset(): void {
    if (this.retryAttempts === 0 || this.retryBudgetResetTimer !== undefined) return
    this.retryBudgetResetTimer = setTimeout(() => {
      this.retryBudgetResetTimer = undefined
      this.resetRetryBudget()
    }, this.retryBudgetResetMs)
    this.retryBudgetResetTimer.unref?.()
  }

  private clearRetryBudgetReset(): void {
    if (this.retryBudgetResetTimer === undefined) return
    clearTimeout(this.retryBudgetResetTimer)
    this.retryBudgetResetTimer = undefined
  }

  private resetRetryBudget(): void {
    this.clearRetryExhaustionTimer()
    this.retryAttempts = 0
    this.retryExhaustionNotified = false
  }

  private notifyRetryExhausted(): void {
    if (this.disposed || this.retryExhaustionNotified) return
    this.retryExhaustionNotified = true
    let notification: Promise<void>
    try {
      notification = Promise.resolve(this.options.onRetryExhausted?.())
    } catch {
      this.scheduleRetryExhaustionNotification()
      return
    }
    void notification.catch(() => { this.scheduleRetryExhaustionNotification() })
  }

  private scheduleRetryExhaustionNotification(): void {
    if (this.disposed || this.retryExhaustionTimer !== undefined) return
    if (this.retryAttempts < this.maxAutoRetries || this.controller.state().phase !== 'failed') {
      this.retryExhaustionNotified = false
      return
    }
    this.retryExhaustionTimer = setTimeout(() => {
      this.retryExhaustionTimer = undefined
      this.retryExhaustionNotified = false
      if (this.disposed
        || this.retryAttempts < this.maxAutoRetries
        || this.controller.state().phase !== 'failed') return
      this.notifyRetryExhausted()
    }, this.retryDelayMs)
    this.retryExhaustionTimer.unref?.()
  }

  private clearRetryExhaustionTimer(): void {
    if (this.retryExhaustionTimer !== undefined) clearTimeout(this.retryExhaustionTimer)
    this.retryExhaustionTimer = undefined
  }
}
