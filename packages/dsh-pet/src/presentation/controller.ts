import type { PetReturnTarget } from '../contracts/desktop-host.ts'
import { PET_ERROR_CODES } from '../errors.ts'
import type { PetPluginSettings } from './config.ts'
import type { PetPresentationEnvironment } from './environment.ts'
import {
  resolvePetPresentation,
  type PetResolvedPresentation,
  type PetResolvedPresentationKind,
} from './resolver.ts'
import {
  presentationStateFromResolution,
  type PetPresentationState,
} from './status.ts'

export interface PetPresentationContext {
  settings: PetPluginSettings
  resolution: PetResolvedPresentation
  visible: boolean
  returnTarget: PetReturnTarget
  bridgeOrigin?: string
  nativeToken?: string
}

export interface PetPresentationHostView {
  id: string
  name: string
  embedded: boolean
  ownsTray: boolean
}

export interface PetPresentationAdapter {
  readonly kind: PetResolvedPresentationKind
  readonly host?: PetPresentationHostView
  start(context: PetPresentationContext): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  update(snapshot: unknown): void
  stop(reason?: string): Promise<void>
  /** Synchronously interrupt a pending `start()` when policy changes. */
  cancelStart?(reason?: string): void
  /** Report a failure after `start()` completed; explicit `stop()` is silent. */
  onTerminated?(listener: (reason: string) => void): () => void
}

export interface PetPresentationControllerOptions {
  createAdapter(resolution: PetResolvedPresentation): PetPresentationAdapter | undefined
  createContext(
    settings: PetPluginSettings,
    resolution: PetResolvedPresentation,
    visible: boolean,
  ): PetPresentationContext
  /** Optional runtime identity, used when one logical Host id is rebound. */
  adapterKey?(resolution: PetResolvedPresentation): string
  retryDelayMs?: number
  now?: () => number
}

type PetPresentationListener = (state: PetPresentationState) => void

/** Serializes adapter switches and owns the externally visible presentation state. */
export class PetPresentationController {
  private readonly retryDelayMs: number
  private readonly now: () => number
  private currentAdapter: PetPresentationAdapter | undefined
  private currentKey: string | undefined
  private unsubscribeTermination: (() => void) | undefined
  private pendingAdapter: PetPresentationAdapter | undefined
  private pendingRevision: number | undefined
  private currentState: PetPresentationState = {
    mode: 'auto',
    resolved: 'none',
    phase: 'resolving',
    available: false,
    visible: false,
  }
  private readonly listeners = new Set<PetPresentationListener>()
  private readonly retryAfter = new Map<string, number>()
  private queue: Promise<void> = Promise.resolve()
  private revision = 0
  private disposed = false

  constructor(private readonly options: PetPresentationControllerOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    this.now = options.now ?? Date.now
  }

  state(): PetPresentationState {
    return {
      ...this.currentState,
      ...(this.currentState.host === undefined ? {} : { host: { ...this.currentState.host } }),
      ...(this.currentState.returnTarget === undefined
        ? {}
        : { returnTarget: structuredClone(this.currentState.returnTarget) }),
    }
  }

  subscribe(listener: PetPresentationListener): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => { this.listeners.delete(listener) }
  }

  reconcile(
    settings: PetPluginSettings,
    environment: PetPresentationEnvironment,
    visible = true,
  ): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const revision = ++this.revision
    this.cancelPendingStart('stale-reconcile')
    const resolution = resolvePetPresentation(settings, environment)
    const next = this.queue.then(async () => {
      if (revision !== this.revision || this.disposed) return
      await this.performReconcile(settings, resolution, visible, revision)
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  update(snapshot: unknown): void {
    try {
      this.currentAdapter?.update(snapshot)
    } catch {
      // Renderer update failures must not unwind Host session projection.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return this.queue
    this.disposed = true
    this.revision += 1
    this.cancelPendingStart('controller-disposed')
    await this.queue
    const adapter = this.currentAdapter
    this.currentAdapter = undefined
    this.currentKey = undefined
    this.clearTerminationSubscription()
    if (adapter !== undefined) await adapter.stop('controller-disposed').catch(() => undefined)
    this.listeners.clear()
  }

  private async performReconcile(
    settings: PetPluginSettings,
    resolution: PetResolvedPresentation,
    visible: boolean,
    revision: number,
  ): Promise<void> {
    const key = this.options.adapterKey?.(resolution)
      ?? `${resolution.kind}:${resolution.hostId ?? ''}`
    const baseState = presentationStateFromResolution(settings, resolution, visible)
    const context = this.options.createContext(settings, resolution, visible)

    if (this.currentAdapter !== undefined && this.currentKey === key) {
      try {
        if (visible) await this.currentAdapter.show()
        else await this.currentAdapter.hide()
        if (revision !== this.revision || this.disposed) return
        this.publish(this.withAdapterState(baseState, this.currentAdapter, context.returnTarget))
      } catch {
        const failed = this.currentAdapter
        this.currentAdapter = undefined
        this.currentKey = undefined
        this.clearTerminationSubscription()
        await failed.stop('visibility-failed').catch(() => undefined)
        if (revision !== this.revision || this.disposed) return
        this.retryAfter.set(key, this.now() + this.retryDelayMs)
        this.publishFailure(baseState, context.returnTarget)
      }
      return
    }

    const previous = this.currentAdapter
    this.currentAdapter = undefined
    this.currentKey = undefined
    this.clearTerminationSubscription()
    if (previous !== undefined) await previous.stop('presentation-switched').catch(() => undefined)
    if (revision !== this.revision || this.disposed) return

    const retryAfter = this.retryAfter.get(key) ?? 0
    if (retryAfter > this.now()) {
      this.publishFailure(baseState, context.returnTarget)
      return
    }

    const adapter = this.options.createAdapter(resolution)
    if (adapter === undefined) {
      this.publish({
        ...baseState,
        phase: 'unavailable',
        available: false,
        visible: false,
        errorCode: PET_ERROR_CODES.presentationHostUnavailable,
        returnTarget: context.returnTarget,
      })
      return
    }

    if (resolution.kind !== 'none') {
      this.publish({
        ...baseState,
        phase: 'starting',
        available: false,
        visible: false,
        returnTarget: context.returnTarget,
      })
    }
    let terminatedReason: string | undefined
    const unsubscribeTermination = adapter.onTerminated?.((reason) => {
      terminatedReason = reason
      this.handleUnexpectedTermination(adapter, key, baseState, context.returnTarget)
    })
    this.pendingAdapter = adapter
    this.pendingRevision = revision
    try {
      await adapter.start(context)
      if (this.pendingAdapter === adapter && this.pendingRevision === revision) {
        this.pendingAdapter = undefined
        this.pendingRevision = undefined
      }
      if (terminatedReason !== undefined) throw new Error(terminatedReason)
      if (revision !== this.revision || this.disposed) {
        unsubscribeTermination?.()
        await adapter.stop('stale-reconcile').catch(() => undefined)
        return
      }
      if (visible) await adapter.show()
      else await adapter.hide()
      if (terminatedReason !== undefined) throw new Error(terminatedReason)
      if (revision !== this.revision || this.disposed) {
        unsubscribeTermination?.()
        await adapter.stop('stale-reconcile').catch(() => undefined)
        return
      }
      this.retryAfter.delete(key)
      this.currentAdapter = adapter
      this.currentKey = key
      this.unsubscribeTermination = unsubscribeTermination
      this.publish(this.withAdapterState(baseState, adapter, context.returnTarget))
    } catch {
      unsubscribeTermination?.()
      await adapter.stop('start-failed').catch(() => undefined)
      if (revision !== this.revision || this.disposed) return
      this.retryAfter.set(key, this.now() + this.retryDelayMs)
      this.publishFailure(baseState, context.returnTarget)
    } finally {
      if (this.pendingAdapter === adapter && this.pendingRevision === revision) {
        this.pendingAdapter = undefined
        this.pendingRevision = undefined
      }
    }
  }

  private withAdapterState(
    state: PetPresentationState,
    adapter: PetPresentationAdapter,
    returnTarget: PetReturnTarget,
  ): PetPresentationState {
    return {
      ...state,
      ...(adapter.host === undefined ? {} : { host: { ...adapter.host } }),
      returnTarget: structuredClone(returnTarget),
    }
  }

  private publishFailure(state: PetPresentationState, returnTarget: PetReturnTarget): void {
    this.publish({
      ...state,
      phase: 'failed',
      available: false,
      visible: false,
      errorCode: PET_ERROR_CODES.presentationStartFailed,
      returnTarget,
    })
  }

  private handleUnexpectedTermination(
    adapter: PetPresentationAdapter,
    key: string,
    state: PetPresentationState,
    returnTarget: PetReturnTarget,
  ): void {
    const next = this.queue.then(async () => {
      if (this.disposed || this.currentAdapter !== adapter || this.currentKey !== key) return
      this.currentAdapter = undefined
      this.currentKey = undefined
      this.clearTerminationSubscription()
      await adapter.stop('unexpected-termination').catch(() => undefined)
      this.retryAfter.set(key, this.now() + this.retryDelayMs)
      this.publishFailure(state, returnTarget)
    })
    this.queue = next.catch(() => undefined)
  }

  private clearTerminationSubscription(): void {
    this.unsubscribeTermination?.()
    this.unsubscribeTermination = undefined
  }

  private cancelPendingStart(reason: string): void {
    const adapter = this.pendingAdapter
    this.pendingAdapter = undefined
    this.pendingRevision = undefined
    if (adapter === undefined) return
    try {
      adapter.cancelStart?.(reason)
    } catch {
      // The queued start path still owns final cleanup and stale-revision
      // suppression; cancellation must remain synchronous and best-effort.
    }
  }

  private publish(state: PetPresentationState): void {
    this.currentState = state
    const snapshot = this.state()
    for (const listener of this.listeners) listener(snapshot)
  }
}
