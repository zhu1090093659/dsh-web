/**
 * rc.6-compatible settings scope for the Web UI plugin group.
 *
 * The official settings scope answers "unavailable" for every third-party
 * namespace on rc.6 hosts (the apiproxy allowlist is hard-coded), which turns
 * every family plugin card into a read-only explanation. This binder wraps
 * the official scope: when it reports the namespace ready, the wrapper is a
 * pass-through; when it reports unavailable, a same-origin
 * bridge controller takes over and serves the same SettingsScope contract
 * from this package's host-side bridge routes (/api/dsh-web-ui-settings).
 * The Host keeps the bridge loopback-only by default and may explicitly admit
 * an authenticated same-host reverse proxy. Family plugins opt in through
 * ctx.get('webUiSettings') without a hard service dependency, so a deployment
 * without this package keeps the previous behavior.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope) and
// the forwarded settings invalidation face (ctx.remote).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../protocol.ts'
import type { BridgeDescribeResult, BridgeMutateRequest, BridgeMutateResult } from '../protocol.ts'

/** True when the value is a well-formed bridge RPC result (the inner result payload the route answers). */
function isBridgeResult(value: unknown): value is BridgeDescribeResult | BridgeMutateResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') return false
  if (record.ok) return typeof record.value === 'object' && record.value !== null
  return typeof record.code === 'string' && typeof record.message === 'string'
}

/** The settings wire face the bridge controller consumes. */
export interface BridgeSettingsFace {
  settings: {
    describe: (payload: Record<string, never>) => Promise<{ result: BridgeDescribeResult }>
    mutate: (payload: BridgeMutateRequest) => Promise<{ result: BridgeMutateResult }>
  }
}

/** One settled bridge POST, always shaped as an RPC result envelope. */
interface EnvelopedResult {
  result: BridgeDescribeResult | BridgeMutateResult
}

/** One durable write a batched scope mutation performs. */
export interface BridgeBatchOp {
  /** Field this entry writes. */
  field: string
  /** set stores a value; unset drops the leaf. */
  op: 'set' | 'unset'
  /** Value for op set (absent for unset). */
  value?: unknown
}

/** Per-field outcome of one batched scope mutation. */
export interface BridgeBatchFieldResult {
  /** Field this entry writes. */
  field: string
  /** Whether the Host accepted this field's write (per the read-back view). */
  landed: boolean
}

/**
 * Result of one batched scope mutation. The whole request either applies
 * (every op validated together, so cross-field hooks like baseURL+model pass)
 * or refuses; per-field success is still reported from the read-back view so
 * a field the Host silently failed to hold is not cleared on the card.
 */
export interface BridgeBatchResult {
  /** Whether the whole mutate was accepted. */
  ok: boolean
  /** Per-field success, in the request order (always present when ok). */
  fields: BridgeBatchFieldResult[]
  /** Host rejection code (mutate refused). */
  code?: string
  /** Host rejection message (mutate refused). */
  message?: string
}

/**
 * Build the fetch-backed settings face for the bridge routes. Network and
 * HTTP failures collapse into an ok:false envelope so the controller keeps
 * its unavailable state instead of throwing into plugin activation.
 * @param fetchFn - the same-origin fetch implementation.
 * @returns the settings face.
 */
export function createBridgeApi(fetchFn: typeof fetch): BridgeSettingsFace {
  const post = async (path: string, body: unknown): Promise<EnvelopedResult> => {
    try {
      const response = await fetchFn(WEB_UI_SETTINGS_BRIDGE_PREFIX + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) return { result: { ok: false, code: 'internal', message: 'bridge HTTP ' + response.status } }
      const parsed: unknown = await response.json()
      if (!isBridgeResult(parsed)) return { result: { ok: false, code: 'internal', message: 'bridge malformed response' } }
      return { result: parsed }
    } catch {
      return { result: { ok: false, code: 'internal', message: 'settings bridge unreachable' } }
    }
  }
  return {
    settings: {
      describe: async payload => post('/describe', payload) as Promise<{ result: BridgeDescribeResult }>,
      mutate: async payload => post('/mutate', payload) as Promise<{ result: BridgeMutateResult }>,
    },
  }
}

/** One path-addressed op on the official settings wire (settings.mutate). */
interface OfficialWireOp {
  /** set stores a value; unset drops the leaf. */
  op: 'set' | 'unset'
  /** Path from the section root (one segment for a card field). */
  path: string[]
  /** Value for op set (absent for unset). */
  value?: unknown
}

/**
 * The official settings.mutate result envelope. Unlike the bridge's flat
 * refusal, the official RPC nests the refusal under error (code/message).
 */
type OfficialMutateResult =
  | { ok: true; value: { user?: unknown; secrets?: { path: string[]; set: boolean }[] } }
  | { ok: false; error: { code: string; message: string } }

/**
 * The official settings wire face the compat binder reads from the client
 * connection handle. rc.7+ apiproxy serves the family namespaces itself, so
 * the batched save must ride this face when the official scope is the active
 * transport — its per-field scope writes would otherwise deadlock on
 * cross-field validate hooks (baseURL+model).
 */
export interface OfficialSettingsFace {
  /** Apply every op in one Host mutation, answering with the new redacted view. */
  mutate: (request: { ns: string; ops: OfficialWireOp[]; expectedRevision?: number }) => Promise<{ result: OfficialMutateResult }>
}

/**
 * Judge each requested field against a redacted namespace view. A secret
 * field is redacted from the user layer, so it is judged by the view's
 * secret-set marker; every other field is judged by user-layer
 * presence/value. Shared by the bridge controller and the official batch
 * path (both answer the same redacted view shape).
 */
function judgeLandedFields(fields: BridgeBatchOp[], view: { user?: unknown; secrets?: { path: string[]; set: boolean }[] }): BridgeBatchFieldResult[] {
  const secretSet = new Map<string, boolean>()
  for (const secret of view.secrets ?? []) secretSet.set(secret.path.join('.'), secret.set)
  const user = view.user as Record<string, unknown> | undefined
  return fields.map(({ field, op, value }) => {
    const secretFlag = secretSet.get(field)
    if (secretFlag !== undefined) return { field, landed: secretFlag }
    if (op === 'set') {
      return { field, landed: user !== undefined && Object.hasOwn(user, field) && user[field] === value }
    }
    return { field, landed: user === undefined || !Object.hasOwn(user, field) }
  })
}

/**
 * A minimal SettingsScopeController over the bridge face. Mirrors the
 * official controller's ordering (serialized queue, revision-fenced writes,
 * recovery read after a refusal) but trusts the Host-seam value without
 * re-running the wire-schema validation: the seam already validated it, and
 * the family cards bind without a narrowing decoder.
 */
class BridgeScopeController<T> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly api: BridgeSettingsFace,
    private readonly spec: SettingsScopeSpec<T>,
  ) {
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

  /** Queue a Host refresh through the bridge. */
  load(): Promise<void> {
    return this.enqueue(() => this.read())
  }

  set(field: string, value: unknown): Promise<void> {
    return this.enqueue(() => this.write({ op: 'set', path: [field], value }))
  }

  unset(field: string): Promise<void> {
    return this.enqueue(() => this.write({ op: 'unset', path: [field] }))
  }

  /**
   * Write every staged op in one bridge /mutate so the Host validate hook
   * judges the whole batch (baseURL+model together) instead of each field in
   * isolation. Reports per-field success from the returned view.
   * @param fields - the operations to apply, in order.
   * @returns the batch outcome and per-field landed flags.
   */
  mutate(fields: readonly SettingsPathOpView[], expectedRevision?: number): Promise<void> {
    const bridgeFields: BridgeBatchOp[] = fields.map(field => 'value' in field
      ? { field: field.path.join('.'), op: field.op, value: field.value }
      : { field: field.path.join('.'), op: field.op })
    return this.enqueue(async () => {
      const result = await this.writeBatch(bridgeFields, expectedRevision)
      if (!result.ok) throw new Error(result.message ?? result.code ?? 'settings mutation rejected')
    })
  }

  /** Compatibility batch result used by generated settings forms. */
  mutateBatch(fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> {
    return this.enqueue(() => this.writeBatch(fields, expectedRevision))
  }

  /** Stop queued operations and wait for the current bridge call to settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.tail
  }

  private enqueue<U>(operation: () => Promise<U>): Promise<U> {
    if (this.disposed) return Promise.resolve(undefined as U)
    const task = this.tail.then(async () => {
      if (this.disposed) return undefined as U
      return operation()
    })
    this.tail = task.catch(() => {})
    return task
  }

  private async read(): Promise<void> {
    let response: { result: BridgeDescribeResult }
    try {
      response = await this.api.settings.describe({})
    } catch {
      // A dropped bridge call must not strand the card in a permanent
      // loading state: report the namespace unavailable, which the card
      // renders as its explanation instead of a form.
      if (!this.disposed) {
        this.store.update((draft) => { draft.status = 'unavailable' })
      }
      return
    }
    if (!response.result.ok || this.disposed) {
      if (!this.disposed) {
        this.store.update((draft) => { draft.status = 'unavailable' })
      }
      return
    }
    const { namespaces, writable } = response.result.value
    const view = namespaces.find(candidate => candidate.ns === this.spec.namespace)
    if (view === undefined) {
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = writable
      })
      return
    }
    this.accept(view.value, view, writable)
  }

  private async write(op: { op: 'set' | 'unset'; path: string[]; value?: unknown }): Promise<void> {
    const revision = this.getSnapshot().revision
    let response: { result: BridgeMutateResult }
    try {
      response = await this.api.settings.mutate({
        ns: this.spec.namespace,
        ops: [op],
        ...revision === undefined ? {} : { expectedRevision: revision },
      })
    } catch {
      await this.read()
      return
    }
    if (!response.result.ok || this.disposed) {
      await this.read()
      return
    }
    this.accept(response.result.value.value, response.result.value, undefined)
  }

  private async writeBatch(fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> {
    const revision = expectedRevision ?? this.getSnapshot().revision
    const ops = fields.map(({ field, op, value }) => op === 'set'
      ? { op, path: [field], value }
      : { op, path: [field] })
    let response: { result: BridgeMutateResult }
    try {
      response = await this.api.settings.mutate({
        ns: this.spec.namespace,
        ops,
        ...revision === undefined ? {} : { expectedRevision: revision },
      })
    } catch {
      await this.read()
      return { ok: false, fields: [], code: 'internal', message: 'settings bridge unreachable' }
    }
    if (!response.result.ok || this.disposed) {
      const refusal = response.result.ok === false ? response.result : { code: 'internal', message: 'settings bridge unreachable' }
      await this.read()
      return { ok: false, fields: [], code: refusal.code, message: refusal.message }
    }
    this.accept(response.result.value.value, response.result.value, undefined)
    return { ok: true, fields: this.landedFields(fields, response.result.value) }
  }

  /** Judge each requested field against the read-back view. */
  private landedFields(fields: BridgeBatchOp[], view: { user?: unknown; secrets?: { path: string[]; set: boolean }[] }): BridgeBatchFieldResult[] {
    return judgeLandedFields(fields, view)
  }

  /** Publish one accepted Host view (value narrowed by the optional decoder). */
  private accept(section: unknown, view: { base?: unknown; user?: unknown; revision: number }, writable: boolean | undefined): void {
    const decoded = this.spec.decode === undefined ? section as T : this.spec.decode(section)
    this.store.update((draft) => {
      draft.revision = view.revision
      draft.base = view.base
      draft.user = view.user
      if (writable !== undefined) draft.writable = writable
      if (decoded === undefined) return
      draft.status = 'ready'
      draft.value = decoded
    })
  }
}

/** Options of the compatibility scope wrapper. */
export interface CompatScopeOptions<T> {
  /** Settings namespace the scope serves. */
  namespace: string
  /** The official settings scope (already bound by the official binder). */
  primary: SettingsScope<T>
  /** The fetch implementation; absent on remote browsers (no bridge). */
  fetchFn?: typeof fetch
  /**
   * The official settings wire face (ctx.connection.api.settings), when the
   * page is loopback. Present on rc.7+ hosts, where the apiproxy serves the
   * family namespaces itself: the batch save then rides one official
   * settings.mutate, because the official scope's per-field writes deadlock
   * on cross-field validate hooks. Absent on remote browsers (the official
   * settings RPCs are loopback-only) and the batch surface stays hidden.
   */
  official?: OfficialSettingsFace
}

/**
 * Wrap the official settings scope with the bridge fallback. The official
 * scope stays authoritative whenever it serves the namespace; the bridge
 * controller answers only its unavailable state on a loopback connection.
 * @param options - the official scope, the namespace, and the loopback fetch.
 * @returns the compatibility scope implementing the SettingsScope contract.
 */
export function createCompatScope<T>(options: CompatScopeOptions<T>): SettingsScope<T> & { load(): Promise<void>; mutateBatch?: (fields: BridgeBatchOp[], expectedRevision?: number) => Promise<BridgeBatchResult> } & { dispose(): void } {
  const { namespace, primary } = options
  const fallback = options.fetchFn === undefined
    ? undefined
    : new BridgeScopeController<T>(createBridgeApi(options.fetchFn), { namespace })
  // Recovery/resync read through the official scope after a batch settles;
  // the SettingsScope contract does not declare load(), so duck-type it.
  const reloadPrimary = async (): Promise<void> => {
    await (primary as unknown as { load?: () => Promise<void> }).load?.()
  }
  // The batched write over the official wire: every op rides one
  // settings.mutate so the Host validate hook judges the batch as a unit,
  // then the primary scope re-reads so the wrapper snapshot follows.
  const officialBatch = options.official === undefined ? undefined : async (fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> => {
    const official = options.official!
    const revision = expectedRevision ?? primary.getSnapshot().revision
    const ops: OfficialWireOp[] = fields.map(({ field, op, value }) => op === 'set'
      ? { op, path: [field], value }
      : { op, path: [field] })
    let response: { result: OfficialMutateResult }
    try {
      response = await official.mutate({
        ns: namespace,
        ops,
        ...revision === undefined ? {} : { expectedRevision: revision },
      })
    } catch {
      await reloadPrimary()
      return { ok: false, fields: [], code: 'internal', message: 'settings transport unreachable' }
    }
    const result = response.result
    if (!result.ok) {
      await reloadPrimary()
      return { ok: false, fields: [], code: result.error.code, message: result.error.message }
    }
    await reloadPrimary()
    return { ok: true, fields: judgeLandedFields(fields, result.value) }
  }
  const store = createSnapshotStore<SettingsScopeSnapshot<T>>(project())
  let fallbackStarted = false
  const publish = (): void => { store.set(project()) }
  const startFallback = (): void => {
    if (fallback === undefined || fallbackStarted) return
    fallbackStarted = true
    void fallback.load()
  }
  function project(): SettingsScopeSnapshot<T> {
    const primarySnapshot = primary.getSnapshot()
    if (primarySnapshot.status === 'ready' || fallback === undefined) return primarySnapshot
    if (primarySnapshot.status === 'loading') return primarySnapshot
    const bridgeSnapshot = fallback.getSnapshot()
    if (bridgeSnapshot.status === 'ready') return bridgeSnapshot
    if (bridgeSnapshot.status === 'loading') return { ...primarySnapshot, status: 'loading' }
    return primarySnapshot
  }
  // The wrapper lives behind bind()'s effect disposer: subscriptions must
  // be released on plugin unload/HMR, not pinned to the singleton primary
  // scope store forever.
  const unsubscribes: Array<() => void> = []
  unsubscribes.push(primary.subscribe(() => {
    publish()
    if (primary.getSnapshot().status === 'unavailable') startFallback()
  }))
  if (fallback !== undefined) unsubscribes.push(fallback.subscribe(publish))
  if (primary.getSnapshot().status === 'unavailable') startFallback()
  const result = {
    dispose: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
      void fallback?.dispose()
    },
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    mutate: (ops: readonly SettingsPathOpView[], expectedRevision?: number) => {
      const backend = active()
      return backend.mutate(ops, expectedRevision)
    },
    set: (field: string, value: unknown) => active().set(field, value),
    unset: (field: string) => active().unset(field),
    load: async () => {
      fallbackStarted = true
      await fallback?.load()
    },
    // Resolve the compatibility batch capability against the active transport
    // at call time. The official scope may still be loading when this wrapper
    // is created and later become ready, in which case the legacy result
    // surface must disappear instead of returning an unsupported result.
    get mutateBatch() {
      const backend = active()
      if (backend === fallback && fallback !== undefined) return fallback.mutateBatch.bind(fallback)
      if (backend === primary && officialBatch !== undefined) return officialBatch
      return undefined
    },
  } as SettingsScope<T> & { load(): Promise<void>; mutateBatch?: (fields: BridgeBatchOp[], expectedRevision?: number) => Promise<BridgeBatchResult>; dispose(): void }
  return result
  function active(): SettingsScope<T> {
    return primary.getSnapshot().status === 'ready' ? primary : fallback ?? primary
  }
}

/** The optional compat binder surface family plugins read from ctx. */
export interface WebUiSettingsBinderFace {
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
}

/**
 * The rc.6 compatibility binder, provided as the webUiSettings service. Its
 * bind() rides the official binder first and hands the bridge controller in
 * only when the official scope settles as unavailable, so official behavior
 * stays untouched wherever it works and the Host remains the authority for
 * loopback or explicitly configured authenticated-proxy access.
 */
export class WebUiSettingsBinder extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webUiSettings')
  }

  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T> {
    const ctx = this.ctx
    const official = ctx.get('settingsScope')
    if (!isBinderFace(official)) {
      // The official binder is a product seam every dsh web host carries;
      // when it is absent the bind must not crash the card's activation.
      throw new Error('webUiSettings: the official settingsScope binder is unavailable')
    }
    const primary = official.bind(spec)
    // rc.7+ hosts serve the family namespaces through the official apiproxy;
    // hand the batch save the official wire face so it does not fall back to
    // the official scope's per-field writes. Remote browsers get no batch
    // surface: the official settings RPCs are loopback-only.
    const connection = ctx.get('connection')
    const officialFace = isOfficialConnectionFace(connection) && connection.isLoopback !== false
      ? connection.api.settings
      : undefined
    const scope = createCompatScope<T>({
      namespace: spec.namespace,
      primary,
      fetchFn: (input, init) => fetch(input, init),
      ...officialFace === undefined ? {} : { official: officialFace },
    })
    // Bridge refreshes ride the same invalidation edges as the official
    // scope: forwarded settings-document updates and connection resets.
    ctx.effect(() => {
      const remoteValue = ctx.get('remote')
      const remote = isRemoteFace(remoteValue) ? remoteValue : undefined
      const disposers: Array<() => void> = []
      if (remote !== undefined) {
        disposers.push(remote.$on('settings/document-updated', (namespace) => {
          if (namespace !== undefined && namespace !== spec.namespace) return
          void scope.load()
        }))
      }
      disposers.push(ctx.on('connection/reset', () => { void scope.load() }))
      return () => {
        for (const dispose of disposers) dispose()
        // Release the scope's own subscriptions (primary + fallback) so an
        // unloaded plugin stops republishing into the singleton stores.
        scope.dispose()
      }
    }, 'web-ui-settings: compat scope invalidation')
    return scope
  }
}

/** True when the value exposes the official settings binder's bind() seam. */
function isBinderFace(value: unknown): value is WebUiSettingsBinderFace {
  return typeof value === 'object' && value !== null && typeof (value as { bind?: unknown }).bind === 'function'
}

/** The slice of the client connection handle the official batch write needs. */
interface OfficialConnectionFace {
  /** Shared api client carrying the settings domain. */
  api: { settings: OfficialSettingsFace }
  /** Whether the page authority is loopback; non-loopback keeps preferences process-local. */
  isLoopback?: boolean
}

/** True when the value is the client connection handle with a settings wire face. */
function isOfficialConnectionFace(value: unknown): value is OfficialConnectionFace {
  if (typeof value !== 'object' || value === null) return false
  const api = (value as { api?: unknown }).api
  if (typeof api !== 'object' || api === null) return false
  const settings = (api as { settings?: unknown }).settings
  return typeof settings === 'object' && settings !== null && typeof (settings as { mutate?: unknown }).mutate === 'function'
}

/** True when the value exposes the settings invalidation face the wrapper listens to. */
function isRemoteFace(value: unknown): value is { $on: (event: string, callback: (namespace?: unknown) => void) => () => void } {
  return typeof value === 'object' && value !== null && typeof (value as { $on?: unknown }).$on === 'function'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** rc.6-compatible settings binder (bridge fallback over the official scope). */
    webUiSettings: WebUiSettingsBinder
  }
}
