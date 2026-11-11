/**
 * Test doubles for the board suites: a board capability face the suite scripts,
 * a bridge seat that records what was registered and published, and a fake host
 * context that runs `inject` and `effect` the way cordis does.
 *
 * Nothing here patches a module or spies on a service method — the package takes
 * all three as seams already (a structural face, and `ctx.inject` / `ctx.effect`),
 * so the suites drive exactly the code the Host drives.
 * @module tests/support/doubles
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BoardFace,
  BoardMethodHandler,
  BoardSnapshotFace,
  RemoteBridgeSeat,
} from '../../src/core/seam.ts'

/** One action the fake board was asked to apply. */
export interface AppliedAction {
  readonly requestId: string
  readonly action: Readonly<Record<string, unknown>>
  readonly initiator: string | undefined
}

/** A board capability face whose every answer the suite scripts. */
export class FakeBoard implements BoardFace {
  revision = 4
  /** Body `apply()` answers instead of a snapshot, for the malformed-answer paths. */
  applyAnswer: unknown = undefined
  snapshotError: Error | undefined
  optionsError: Error | undefined
  applyError: Error | undefined
  /** Set to make `snapshot()` answer a body past the frame cap. */
  oversize = false
  readonly applied: AppliedAction[] = []
  readonly listeners = new Set<() => void>()
  /** What the host publishes as board meta; `cardDefaults` stays unset on purpose. */
  readonly meta = {
    sessionDefaultPermission: 'read-only',
    maxSubtaskDepth: 1,
  }

  /**
   * The task table `snapshot()` publishes. A suite replaces it to script a
   * change between two reads; the default is the one card every other suite
   * already expects.
   */
  tasks: readonly Record<string, unknown>[] = [{ id: 't-1', title: 'Plan the trip' }]

  snapshot(): BoardSnapshotFace {
    if (this.snapshotError !== undefined) throw this.snapshotError
    return {
      schemaVersion: 6,
      revision: this.revision,
      tasks: this.oversize ? [{ id: 't-1', title: 'x'.repeat(10 * 1024 * 1024) }] : this.tasks,
      scheduler: { timeZone: 'Asia/Shanghai' },
      power: { platform: 'darwin', phase: 'idle' },
      ...this.meta,
    }
  }

  apply(requestId: string, action: Readonly<Record<string, unknown>>, initiator?: string): unknown {
    this.applied.push({ requestId, action, initiator })
    if (this.applyError !== undefined) throw this.applyError
    if (this.applyAnswer !== undefined) return this.applyAnswer
    this.revision += 1
    return this.snapshot()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async modelCatalogOptions(): Promise<unknown> {
    if (this.optionsError !== undefined) throw this.optionsError
    return { catalog: { groups: [] } }
  }

  /** Notify every subscriber once, the way the host does. */
  changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** A bridge seat that records the table it was given and every event published. */
export class FakeBridge implements RemoteBridgeSeat {
  readonly tables: { capability?: string; methods: Readonly<Record<string, BoardMethodHandler>> }[] = []
  readonly broadcasts: { topic: string; payload: unknown; capability: string | undefined }[] = []
  readonly withdrawn: string[] = []

  registerMethods(table: { capability?: string; methods: Readonly<Record<string, BoardMethodHandler>> }): () => void {
    this.tables.push(table)
    let live = true
    return () => {
      if (!live) return
      live = false
      this.withdrawn.push(...Object.keys(table.methods))
    }
  }

  broadcast(topic: string, payload: unknown, capability?: string): number {
    this.broadcasts.push({ topic, payload, capability })
    return 1
  }

  /** @returns the handler registered under one wire name. */
  handler(name: string): BoardMethodHandler {
    for (let index = this.tables.length - 1; index >= 0; index -= 1) {
      const handler = this.tables[index]?.methods[name]
      if (handler !== undefined) return handler
    }
    throw new Error(`no handler was registered for ${name}`)
  }
}

/** What a mounted row registered on its fake host. */
export interface FakeHost {
  readonly ctx: Context
  /** Run every effect body's disposer, newest first. */
  unmount(): void
  /** @returns how many effect bodies the row ran. */
  readonly effectCount: number
}

/**
 * Build a context whose `inject` fires only when every named service resolves.
 * @param services - the services this host serves, by cordis name.
 */
export function makeHost(services: Record<string, unknown>): FakeHost {
  const teardowns: (() => void)[] = []
  let effects = 0
  const ctx = {
    get: (name: string) => services[name],
    inject: (names: readonly string[], callback: (scope: Context) => void) => {
      if (!names.every(name => services[name] !== undefined)) return { dispose: async () => undefined }
      const scope = {
        get: (name: string) => services[name],
        effect: (body: () => (() => void) | undefined) => {
          effects += 1
          const dispose = body()
          if (typeof dispose === 'function') teardowns.push(dispose)
          return { dispose: async () => undefined }
        },
      } as unknown as Context
      callback(scope)
      return { dispose: async () => undefined }
    },
  } as unknown as Context
  return {
    ctx,
    get effectCount() { return effects },
    unmount() {
      for (const teardown of teardowns.splice(0).reverse()) teardown()
    },
  }
}

/** Let the microtask queue deliver whatever a wave scheduled. */
export async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
