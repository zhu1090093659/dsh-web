/**
 * Pet-owned SettingsScope fallback for standalone installs.
 *
 * The aggregate Web UI and newer official hosts may already expose the pet
 * namespace through their settings binder. Keep that scope authoritative and
 * use the pet's narrow loopback route only after the primary reports the
 * namespace unavailable.
 */

import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { BatchResult, BatchedWrite } from './settings-form.ts'

const PET_SETTINGS_PATH = '/api/pet/settings'

interface PetSettingsWireView<T> {
  value: T
  base?: Partial<T>
  user?: Partial<T>
  revision: number
  writable: boolean
}

interface PetSettingsMutation {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export type PetSettingsScope<T> = SettingsScope<T> & {
  load(): Promise<void>
  /** Refresh only the direct route when the primary scope owns its own invalidation. */
  reloadFallback(): Promise<void>
  mutate?: (fields: BatchedWrite[]) => Promise<BatchResult>
  dispose(): void
}

async function fetchJson<T>(fetchFn: typeof fetch, path: string, body?: unknown): Promise<T> {
  const response = await fetchFn(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
  if (!response.ok) throw new Error(`pet settings ${path} failed: ${String(response.status)}`)
  return (await response.json()) as T
}

/** Direct loopback scope used only when the primary namespace is unavailable. */
class DirectPetSettingsScope<T> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly fetchFn: typeof fetch) {
    this.store = createSnapshotStore<SettingsScopeSnapshot<T>>({
      status: 'loading',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: 'host',
    })
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  load(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.accept(await fetchJson<PetSettingsWireView<T>>(this.fetchFn, PET_SETTINGS_PATH))
      } catch {
        this.markUnavailable()
      }
    })
  }

  set(field: string, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.write([{ op: 'set', path: [field], value }])
    })
  }

  unset(field: string): Promise<void> {
    return this.enqueue(async () => {
      await this.write([{ op: 'unset', path: [field] }])
    })
  }

  mutate(fields: BatchedWrite[]): Promise<BatchResult> {
    return this.enqueue(async () => {
      const ops: PetSettingsMutation[] = fields.map(field => field.op === 'set'
        ? { op: 'set', path: [field.field], value: field.value }
        : { op: 'unset', path: [field.field] })
      const accepted = await this.write(ops)
      if (!accepted) {
        return {
          ok: false,
          fields: [],
          code: 'settings-rejected',
          message: 'pet settings write was rejected',
        }
      }
      const user = this.getSnapshot().user as Record<string, unknown> | undefined
      return {
        ok: true,
        fields: fields.map(field => ({
          field: field.field,
          landed: field.op === 'set'
            ? user !== undefined && Object.hasOwn(user, field.field) && user[field.field] === field.value
            : user === undefined || !Object.hasOwn(user, field.field),
        })),
      }
    })
  }

  private enqueue<U>(operation: () => Promise<U>): Promise<U> {
    const task = this.tail.then(operation)
    this.tail = task.catch(() => undefined)
    return task
  }

  private async write(ops: PetSettingsMutation[]): Promise<boolean> {
    const revision = this.getSnapshot().revision
    try {
      const view = await fetchJson<PetSettingsWireView<T>>(
        this.fetchFn,
        `${PET_SETTINGS_PATH}/mutate`,
        { ops, ...(revision === undefined ? {} : { expectedRevision: revision }) },
      )
      this.accept(view)
      return true
    } catch {
      await this.loadDirect()
      return false
    }
  }

  /** Refresh without re-entering the serialized queue from a queued write. */
  private async loadDirect(): Promise<void> {
    try {
      this.accept(await fetchJson<PetSettingsWireView<T>>(this.fetchFn, PET_SETTINGS_PATH))
    } catch {
      this.markUnavailable()
    }
  }

  private accept(view: PetSettingsWireView<T>): void {
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.value = view.value
      draft.base = view.base
      draft.user = view.user
      draft.revision = view.revision
      draft.writable = view.writable
    })
  }

  private markUnavailable(): void {
    this.store.update((draft) => {
      draft.status = 'unavailable'
      draft.writable = false
    })
  }
}

/**
 * Prefer an already-served official/family scope and fall back to the pet's
 * private loopback route only after that scope reports `unavailable`.
 */
export function createPetSettingsScope<T>(
  primary: SettingsScope<T>,
  fetchFn: typeof fetch,
): PetSettingsScope<T> {
  const fallback = new DirectPetSettingsScope<T>(fetchFn)
  const store = createSnapshotStore<SettingsScopeSnapshot<T>>(primary.getSnapshot())
  let primaryStatus = primary.getSnapshot().status

  const project = (): SettingsScopeSnapshot<T> => {
    const primarySnapshot = primary.getSnapshot()
    if (primarySnapshot.status === 'ready' || primarySnapshot.status === 'loading') return primarySnapshot
    const fallbackSnapshot = fallback.getSnapshot()
    return fallbackSnapshot.status === 'loading'
      ? { ...primarySnapshot, status: 'loading' }
      : fallbackSnapshot
  }
  const publish = (): void => { store.set(project()) }
  const startFallback = (): void => { void fallback.load() }

  const unsubscribes: Array<() => void> = []
  unsubscribes.push(primary.subscribe(() => {
    const nextStatus = primary.getSnapshot().status
    if (nextStatus === 'unavailable' && primaryStatus !== 'unavailable') startFallback()
    primaryStatus = nextStatus
    publish()
  }))
  unsubscribes.push(fallback.subscribe(publish))
  if (primaryStatus === 'unavailable') startFallback()

  const active = (): SettingsScope<T> => primary.getSnapshot().status === 'ready' ? primary : fallback
  const reloadPrimary = async (): Promise<void> => {
    await (primary as unknown as { load?: () => Promise<void> }).load?.()
  }

  return {
    dispose: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
    },
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    set: (field, value) => active().set(field, value),
    unset: field => active().unset(field),
    load: async () => {
      // Give a served official/family scope the first chance to refresh after
      // reconnect. If it remains unavailable, refresh the private fallback.
      await reloadPrimary()
      if (primary.getSnapshot().status === 'ready') {
        publish()
        return
      }
      await fallback.load()
    },
    reloadFallback: async () => {
      // Official/family scopes already subscribe to Host invalidation. Only
      // the direct loopback fallback needs this extra refresh.
      if (primary.getSnapshot().status === 'ready') return
      await fallback.load()
    },
    get mutate() {
      if (primary.getSnapshot().status === 'ready') return undefined
      return fallback.mutate.bind(fallback)
    },
  }
}
