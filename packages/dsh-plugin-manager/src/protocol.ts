/**
 * Wire contract between the host half (routes.ts) and the browser half
 * (client/api.ts). Pure types plus path literals — imported by both halves,
 * bundled into each, no runtime identity to share.
 * @module @linxin666/dsh-plugin-manager/protocol
 */

/** One plugin row the Settings tab renders. */
export interface PluginRow {
  /** The Loader entry id (stable per composition row). */
  entryId: string
  /** The module name of the plugin entry. */
  moduleName: string
  /** Whether the entry is effectively enabled (not disabled by composition). */
  enabled: boolean
  /** The live Cordis fiber phase of the entry. */
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  /** Whether the entry is protected and cannot be toggled. */
  protected: boolean
  /** Whether the entry ships with the official @deepseek-ai SDK. */
  official: boolean
}

/** plugin.list response value. */
export interface ListResponse {
  /** The loaded plugin entries in Loader order. */
  entries: PluginRow[]
}

/** plugin.setEnabled request payload. */
export interface SetEnabledRequest {
  /** The Loader entry id to toggle. */
  entryId: string
  /** True enables the entry; false disables it. */
  enabled: boolean
}

/** plugin.setEnabled response value. */
export interface SetEnabledResponse {
  /** The toggled entry id. */
  entryId: string
  /** The requested enablement. */
  enabled: boolean
  /** Whether the live fiber switch succeeded (no restart needed). */
  applied: boolean
  /** Whether the switch is durable across restarts (patch layer or ledger). */
  persisted: boolean
  /** Whether the switch takes effect only after a restart. */
  deferred: boolean
}

/** JSON error body used by every route. */
export interface ApiErrorBody {
  error: string
  /** Stable machine code surfaced to the UI. */
  code?: string
}

/** Route paths the client calls (shared literals). */
export const API_BASE = '/api/dsh-plugin-manager' as const

export const API = {
  list: API_BASE + '/list',
  setEnabled: API_BASE + '/set-enabled',
} as const
