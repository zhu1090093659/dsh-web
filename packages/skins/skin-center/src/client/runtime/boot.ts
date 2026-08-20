/**
 * Browser boot wiring for the v2 skin runtime (issue #506): one store per
 * document that owns the effect ledger, the skin controller, the semantic
 * adapter and the catalog snapshot. The settings card consumes the store;
 * the store outlives the card (settings panels unmount on close), so a
 * try-on preview survives closing and reopening the panel.
 *
 * Boot sequence: fetch the catalog snapshot once, read the persisted active
 * selection, and activate it (the tapIndex adapter already stamped the
 * attribute and preloaded the stylesheet for first paint; the controller
 * re-installs under ledger ownership so later switches stay atomic).
 * @module @linxin666/dsh-client-ui-skin-center/runtime/boot
 */

import { createEffectLedger } from './effect-ledger.ts'
import { createSemanticAdapter } from './semantic-adapter.ts'
import type { SemanticAdapter } from './semantic-adapter.ts'
import { createSkinController } from './skin-controller.ts'
import type { ControllerSkinEntry, SkinController } from './skin-controller.ts'

/** Display-ready catalog entry (manifest + origin), as served by /v2/catalog. */
export interface CatalogSkin {
  origin: 'builtin' | 'user'
  warnings: string[]
  manifest: ControllerSkinEntry['manifest'] & {
    name: string
    nameEn: string
    tagline?: string
    description?: string
    accent?: string
    order?: number
    author?: string
    license?: string
    attribution?: string
    preview?: { light: string; dark: string }
    tags?: string[]
  }
}

export interface CatalogDiagnostic {
  subject: string
  origin: string
  errors: string[]
}

export interface SkinRuntimeStore {
  readonly controller: SkinController
  readonly adapter: SemanticAdapter
  /** Loaded catalog snapshot (null until the first fetch resolves). */
  catalog(): CatalogSkin[] | null
  diagnostics(): CatalogDiagnostic[]
  /** Re-fetch the catalog (e.g. after the user drops a new skin directory). */
  refreshCatalog(): Promise<void>
  /** Find one entry in the current snapshot by id. */
  find(id: string): CatalogSkin | null
  /** Fires on catalog loads AND controller state transitions. */
  subscribe(listener: () => void): () => void
  /** Stop the semantic adapter and dispose the current activation. */
  shutdown(): void
}

export interface BootOptions {
  doc?: Document
  apiBase?: string
  fetchImpl?: typeof fetch
  /** Background-media priority: true suppresses skin manifest media (WE wallpaper wins). */
  suppressBackgroundMedia?: () => boolean
}

export function bootSkinRuntime(options: BootOptions = {}): SkinRuntimeStore {
  const doc = options.doc ?? document
  const apiBase = options.apiBase ?? '/api/skin-center/v2'
  const fetchImpl = options.fetchImpl ?? fetch.bind(doc.defaultView)

  const ledger = createEffectLedger()
  const controller = createSkinController({
    doc,
    ledger,
    apiBase,
    fetchImpl,
    suppressBackgroundMedia: options.suppressBackgroundMedia,
    // Switches fail closed to the previous skin; failures must still be
    // observable in the console (they are never thrown to the card).
    onError: (message, error) => {
      console.error(`[skin-center] ${message}`, error)
    },
  })
  const adapter = createSemanticAdapter(doc)
  adapter.start()

  let catalog: CatalogSkin[] | null = null
  let diagnostics: CatalogDiagnostic[] = []
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  async function refreshCatalog(): Promise<void> {
    const res = await fetchImpl(`${apiBase}/catalog`)
    if (!res.ok) throw new Error(`catalog fetch -> ${res.status}`)
    const payload = (await res.json()) as {
      ok: boolean
      skins?: CatalogSkin[]
      diagnostics?: CatalogDiagnostic[]
    }
    catalog = payload.skins ?? []
    diagnostics = payload.diagnostics ?? []
    emit()
  }

  const store: SkinRuntimeStore = {
    controller,
    adapter,
    catalog: () => catalog,
    diagnostics: () => diagnostics,
    refreshCatalog,
    find(id) {
      return catalog?.find((s) => s.manifest.id === id) ?? null
    },
    subscribe(listener) {
      const off = controller.subscribe(listener)
      listeners.add(listener)
      return () => {
        off()
        listeners.delete(listener)
      }
    },
    shutdown() {
      adapter.stop()
      controller.shutdown()
    },
  }

  // E2e/acceptance handle: exposes the boot store on the window for
  // scripted probes (see tests and the acceptance checklist).
  {
    const root = doc.defaultView as { __skinRuntime?: SkinRuntimeStore } & Window
    root.__skinRuntime = store
  }

  // Initial activation: apply the persisted selection from the snapshot.
  void (async () => {
    try {
      await refreshCatalog()
      let active = doc.documentElement?.getAttribute('data-dsh-skin') || null
      if (!active) {
        const res = await fetchImpl(`${apiBase}/active`)
        const payload = (await res.json()) as { ok: boolean; active?: string | null }
        active = payload.ok && typeof payload.active === 'string' ? payload.active : null
      }
      if (active === null) return
      const entry = store.find(active)
      if (entry === null) {
        await controller.switchTo(null, null)
        return
      }
      await controller.switchTo(active, entry as ControllerSkinEntry)
    } catch {
      // Fail-closed: boot into the stock look; the card surfaces catalog
      // errors through diagnostics().
      await controller.switchTo(null, null).catch(() => {})
    }
  })()

  return store
}
