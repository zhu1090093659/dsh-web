/**
 * The board's browser-half extension service (`taskBoard`).
 *
 * It gives a provider's browser half the client capability face from the
 * contract: dispatch over the board's same-origin action channel, card
 * visibility predicates, and a subscription to the board mirror. The board
 * controller is attached and detached as the master switch mounts and unmounts
 * the UI, so the service can be provided before any controller exists.
 *
 * @module dsh-task-board/client/service
 */
import type { BoardController } from '../core/controller.ts'
import type {
  TaskBoardClientFace,
  TaskBoardClientMirror,
  TaskBoardExtensionActionRequest,
  TaskBoardGroupingSelector,
  TaskBoardVisibilityPredicate,
} from '../core/extension.ts'
import type { TaskRecord } from '../core/tasks.ts'

interface PendingGroupingRegistration {
  selector: TaskBoardGroupingSelector
  active: boolean
  dispose?: () => void
}

export class TaskBoardClientService implements TaskBoardClientFace {
  private controller: BoardController | undefined
  private enabled = false
  private unsubscribeController: (() => void) | undefined
  /** Predicates registered before the controller exists, replayed on attach. */
  private readonly pendingVisibility: TaskBoardVisibilityPredicate[] = []
  /** Source selectors registered before the controller exists, replayed on attach. */
  private readonly pendingGrouping: PendingGroupingRegistration[] = []
  private readonly listeners = new Set<(mirror: TaskBoardClientMirror) => void>()

  /** Bind the live board controller (called when the UI mounts). */
  attach(controller: BoardController): void {
    if (this.controller === controller) return
    this.detach()
    this.controller = controller
    this.unsubscribeController = controller.subscribe(() => { this.notify() })
    for (const predicate of this.pendingVisibility.splice(0)) controller.registerVisibility(predicate)
    for (const registration of this.pendingGrouping.splice(0)) {
      if (registration.active) registration.dispose = controller.registerGrouping(registration.selector)
    }
    this.notify()
  }

  /** Release the current controller (called when the UI unmounts). */
  detach(): void {
    if (this.controller === undefined) return
    this.unsubscribeController?.()
    this.unsubscribeController = undefined
    this.controller = undefined
    this.notify()
  }

  /** Apply the board's master switch. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.notify()
  }

  dispatch(request: TaskBoardExtensionActionRequest): Promise<boolean> {
    if (this.controller === undefined) return Promise.resolve(false)
    return this.controller.dispatchExtension(request)
  }

  registerVisibility(predicate: TaskBoardVisibilityPredicate): () => void {
    if (this.controller !== undefined) return this.controller.registerVisibility(predicate)
    this.pendingVisibility.push(predicate)
    return () => {
      const index = this.pendingVisibility.indexOf(predicate)
      if (index !== -1) this.pendingVisibility.splice(index, 1)
    }
  }

  registerGrouping(selector: TaskBoardGroupingSelector): () => void {
    if (this.controller !== undefined) return this.controller.registerGrouping(selector)
    const registration: PendingGroupingRegistration = { selector, active: true }
    this.pendingGrouping.push(registration)
    return () => {
      registration.active = false
      registration.dispose?.()
      const index = this.pendingGrouping.indexOf(registration)
      if (index !== -1) this.pendingGrouping.splice(index, 1)
    }
  }

  subscribe(callback: (mirror: TaskBoardClientMirror) => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  snapshot(): TaskBoardClientMirror {
    const state = this.controller?.getSnapshot()
    return {
      enabled: this.enabled,
      tasks: (state?.tasks ?? []) as readonly TaskRecord[],
      extensions: state?.extensions ?? {},
    }
  }

  private notify(): void {
    const mirror = this.snapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener(mirror)
      } catch (error) {
        // A provider's mirror callback must never break the board.
        console.error('[dsh-task-board] extension mirror callback failed', error)
      }
    }
  }
}
