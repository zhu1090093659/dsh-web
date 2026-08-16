/** Browser-side Store API loader with last-good-data retention. */

import { fetchStoreCatalog, type StoreCatalog } from '../core/store-catalog.ts'

export interface CatalogSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  catalog: StoreCatalog | null
  error: string | null
}

export class CatalogStore {
  private readonly fetcher: typeof fetch
  private readonly listeners = new Set<() => void>()
  private pending: Promise<void> | null = null
  private snapshot: CatalogSnapshot = Object.freeze({ status: 'idle', catalog: null, error: null })

  constructor(options: { fetcher?: typeof fetch } = {}) {
    const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
    if (typeof fetcher !== 'function') throw new Error('This browser cannot request the Store catalog')
    this.fetcher = fetcher
  }

  getSnapshot = (): CatalogSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  load(options: { force?: boolean } = {}): Promise<void> {
    if (options.force !== true && this.snapshot.status === 'ready') return Promise.resolve()
    if (this.pending !== null) return this.pending
    this.publish({ status: 'loading', catalog: this.snapshot.catalog, error: null })
    this.pending = fetchStoreCatalog(this.fetcher, undefined, options.force === true ? 'no-store' : 'default')
      .then(catalog => { this.publish({ status: 'ready', catalog, error: null }) })
      .catch((error: unknown) => {
        this.publish({
          status: 'error',
          catalog: this.snapshot.catalog,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => { this.pending = null })
    return this.pending
  }

  private publish(snapshot: CatalogSnapshot): void {
    this.snapshot = Object.freeze(snapshot)
    for (const listener of this.listeners) listener()
  }
}
