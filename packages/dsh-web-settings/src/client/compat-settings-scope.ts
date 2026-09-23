/**
 * Family settings transport for the Web UI plugin group.
 *
 * The 0.1.7 settings surface addresses ONE form per active profile entry id
 * (`ctx.configForms.get(entryId)`) and carries no package identity at all, so
 * a family plugin that only knows its own settings namespace cannot reach its
 * form directly. This binder bridges the gap: it asks the host bridge which
 * profile entry id owns the requested namespace, binds the native
 * `ctx.configForms` form for that id, and keeps the loopback bridge controller
 * as the fallback for pages the entry id never reaches (a deployment whose
 * profile row the bridge cannot trace). Family plugins opt in through
 * `ctx.get('webUiSettings')` without a hard service dependency, so a
 * deployment without this package keeps the previous behavior.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
// Type-only: pulls the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigForm, ConfigFormSnapshot, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../protocol.ts'
import type { BridgeDescribeResult, BridgeMutateRequest, BridgeMutateResult } from '../protocol.ts'

/** The JSON value the settings wire admits for one field write. */
type WireValue = Extract<SettingsPathOpView, { op: 'set' }>['value']

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

/** Domain-owned description of one settings namespace a card binds. */
export interface ConfigFormSpec<T> {
  /** Settings namespace the card edits. */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the last accepted value. The
   * native form already resolves the namespace's own serialized wire schema,
   * so a decoder exists only to narrow beyond that schema.
   */
  decode?: (section: unknown) => T | undefined
}

/** One durable write a batched form mutation performs. */
export interface BridgeBatchOp {
  /** Field this entry writes. */
  field: string
  /** set stores a value; unset drops the leaf. */
  op: 'set' | 'unset'
  /** Value for op set (absent for unset). */
  value?: unknown
  /** Preserved ordered path segments for nested sections. */
  path?: string[]
}

/** Per-field outcome of one batched form mutation. */
export interface BridgeBatchFieldResult {
  /** Field this entry writes. */
  field: string
  /** Whether the Host accepted this field's write (per the read-back view). */
  landed: boolean
}

/**
 * Result of one batched form mutation. The whole request either applies
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

function readPathInLayer(target: unknown, path: readonly string[]): { found: boolean; value?: unknown } {
  let curr: unknown = target
  for (const seg of path) {
    if (typeof curr !== 'object' || curr === null || !Object.hasOwn(curr, seg)) {
      return { found: false }
    }
    curr = (curr as Record<string, unknown>)[seg]
  }
  return { found: true, value: curr }
}

/**
 * Judge each requested field against a redacted namespace view. A secret
 * field is redacted from the user layer, so it is judged by the view's
 * secret-set marker; every other field is judged by user-layer
 * presence/value. Shared by the bridge controller and the native batch
 * surface (both answer the same redacted view shape).
 */
function judgeLandedFields(fields: BridgeBatchOp[], view: { user?: unknown; secrets?: { path: string[]; set: boolean }[] }): BridgeBatchFieldResult[] {
  const secretSet = new Map<string, boolean>()
  for (const secret of view.secrets ?? []) secretSet.set(secret.path.join('.'), secret.set)
  const user = view.user
  return fields.map(({ field, op, value, path }) => {
    const keyPath = path ?? [field]
    const secretKey = path ? path.join('.') : field
    const secretFlag = secretSet.get(secretKey)
    if (secretFlag !== undefined) return { field, landed: secretFlag }
    const read = readPathInLayer(user, keyPath)
    if (op === 'set') {
      return { field, landed: read.found && read.value === value }
    }
    return { field, landed: !read.found }
  })
}

/** The snapshots a form publishes before any Host answer, stable per status. */
const PENDING_SNAPSHOTS = new Map<'loading' | 'unavailable', ConfigFormSnapshot<never>>()

/** The snapshot a page with no Host answer yet reports. */
function pendingSnapshot<T>(status: 'loading' | 'unavailable'): ConfigFormSnapshot<T> {
  const held = PENDING_SNAPSHOTS.get(status)
  if (held !== undefined) return held as unknown as ConfigFormSnapshot<T>
  const snapshot: ConfigFormSnapshot<never> = {
    status,
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  }
  PENDING_SNAPSHOTS.set(status, snapshot)
  return snapshot as unknown as ConfigFormSnapshot<T>
}

/** The snapshot a page with no settings transport at all reports. */
function unavailableSnapshot<T>(): ConfigFormSnapshot<T> {
  return pendingSnapshot<T>('unavailable')
}

/** One path-addressed op on the bridge wire. */
type BridgeWriteOp = { op: 'set'; path: string[]; value?: unknown } | { op: 'unset'; path: string[] }

/**
 * A ConfigForm over the bridge face. Mirrors the native controller's ordering
 * (serialized queue, revision-fenced writes, recovery read after a refusal)
 * but trusts the Host-answered view without re-running the wire-schema
 * validation: the Host already validated it, and the family cards bind
 * without a narrowing decoder.
 */
class BridgeScopeController<T> implements ConfigForm<T> {
  private readonly store: SnapshotStore<ConfigFormSnapshot<T>>
  private readonly spec: ConfigFormSpec<T>
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false
  /** Profile entry id the last accepted view carried; undefined until the Host answers one. */
  private entryId: string | undefined

  constructor(
    private readonly api: BridgeSettingsFace,
    spec: ConfigFormSpec<T>,
  ) {
    this.spec = spec
    this.store = createSnapshotStore<ConfigFormSnapshot<T>>(pendingSnapshot<T>('loading'))
  }

  getSnapshot(): ConfigFormSnapshot<T> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** Queue a Host refresh through the bridge. */
  load(): Promise<void> {
    return this.enqueue(() => this.read())
  }

  set(field: string, value: unknown): Promise<boolean> {
    return this.enqueue(() => this.write({ op: 'set', path: [field], value }))
  }

  unset(field: string): Promise<boolean> {
    return this.enqueue(() => this.write({ op: 'unset', path: [field] }))
  }

  /**
   * Write every staged op in one bridge /mutate so the Host validate hook
   * judges the whole batch (baseURL+model together) instead of each field in
   * isolation.
   * @param fields - the operations to apply, in order.
   * @param expectedRevision - revision the caller read, when it holds one.
   * @returns whether the Host accepted the whole batch; a refusal recovers
   *   with a fresh view and answers false.
   */
  mutate(fields: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean> {
    const bridgeFields: BridgeBatchOp[] = fields.map(field => 'value' in field
      ? { field: field.path.join('.'), op: field.op, value: field.value, path: [...field.path] }
      : { field: field.path.join('.'), op: field.op, path: [...field.path] })
    return this.enqueue(async () => (await this.writeBatch(bridgeFields, expectedRevision)).ok)
  }

  /** Compatibility batch result used by generated settings forms. */
  mutateBatch(fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> {
    return this.enqueue(() => this.writeBatch(fields, expectedRevision))
  }

  /** The profile entry id the Host's last answer reported, when it reported one. */
  resolvedEntryId(): string | undefined {
    return this.entryId
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
      this.entryId = undefined
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = writable
      })
      return
    }
    this.accept(view.value, view, writable)
  }

  private async write(op: BridgeWriteOp): Promise<boolean> {
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
      return false
    }
    if (!response.result.ok || this.disposed) {
      await this.read()
      return false
    }
    this.accept(response.result.value.value, response.result.value, undefined)
    return true
  }

  private async writeBatch(fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> {
    const revision = expectedRevision ?? this.getSnapshot().revision
    const ops = fields.map(({ field, op, value, path }) => op === 'set'
      ? { op, path: path ?? [field], value }
      : { op, path: path ?? [field] })
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
    return { ok: true, fields: judgeLandedFields(fields, response.result.value) }
  }

  /** Publish one accepted Host view (value narrowed by the optional decoder). */
  private accept(section: unknown, view: { base?: unknown; user?: unknown; revision: number; entryId?: string }, writable: boolean | undefined): void {
    const decoded = this.spec.decode === undefined ? section as T : this.spec.decode(section)
    this.entryId = view.entryId
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

/** The compatibility form: the new ConfigForm contract plus the family extras. */
export interface CompatScope<T> extends ConfigForm<T> {
  /** Re-read the bridge controller's Host view (a no-op once the native form is bound). */
  load(): Promise<void>
  /** Profile entry id this scope resolved, when one is known. */
  entryId(): string | undefined
  /** The legacy per-field batch surface generated settings forms call. */
  mutateBatch?: (fields: BridgeBatchOp[], expectedRevision?: number) => Promise<BridgeBatchResult>
  /** Release every subscription and the pending bridge call. */
  dispose(): void
}

/** One native form snapshot projected through the scope's decoder, with a stable reference. */
interface DecodedSnapshot<T> {
  source: ConfigFormSnapshot<T>
  projected: ConfigFormSnapshot<T>
}

/** Options of the compatibility form wrapper. */
export interface CompatScopeOptions<T> {
  /** Settings namespace the form serves. */
  namespace: string
  /** Narrow one wire section; undefined keeps the section as the Host resolved it. */
  decode?: (section: unknown) => T | undefined
  /**
   * The shared configuration forms service (ctx.configForms). Present on every
   * 0.1.7 host: the wrapper then binds the native form of the profile entry
   * that owns this namespace as soon as the bridge resolves its entry id —
   * the transport that also works off loopback.
   */
  configForms?: ConfigForms
  /** The fetch implementation; absent on a page with no fetch seat (no bridge). */
  fetchFn?: typeof fetch
}

/**
 * Narrow one ready native snapshot's section, keeping the value a previous
 * decode accepted when the decoder refuses the section.
 */
function projectDecoded<T>(
  source: ConfigFormSnapshot<T>,
  decode: (section: unknown) => T | undefined,
  previous: ConfigFormSnapshot<T> | undefined,
): ConfigFormSnapshot<T> {
  const value = decode(source.value)
  if (value !== undefined) return { ...source, value }
  if (previous === undefined) return { ...source, status: 'loading', value: undefined }
  return { ...source, status: previous.status, value: previous.value }
}

/**
 * Wrap the family transport: the native per-entry form when the Host serves
 * one for this namespace, the loopback bridge controller otherwise.
 * @param options - the namespace, the shared forms service, and the fetch seat.
 * @returns the compatibility form implementing the ConfigForm contract.
 */
export function createCompatScope<T>(options: CompatScopeOptions<T>): CompatScope<T> {
  const { namespace, configForms, decode } = options
  const fallback = options.fetchFn === undefined
    ? undefined
    : new BridgeScopeController<T>(createBridgeApi(options.fetchFn), { namespace, ...decode === undefined ? {} : { decode } })
  /** The native per-entry form, bound the moment its profile entry id is known. */
  let native: ConfigForm<T> | undefined
  let nativeEntryId: string | undefined
  let nativeUnsubscribe: (() => void) | undefined
  let decoded: DecodedSnapshot<T> | undefined

  /** Project one native form's snapshot through this scope's decoder (stable references). */
  const projectNative = (form: ConfigForm<T>): ConfigFormSnapshot<T> => {
    const source = form.getSnapshot()
    if (decode === undefined) return source
    if (decoded !== undefined && decoded.source === source) return decoded.projected
    const projected = source.status === 'ready' ? projectDecoded(source, decode, decoded?.projected) : source
    decoded = { source, projected }
    return projected
  }

  function project(): ConfigFormSnapshot<T> {
    if (native !== undefined) return projectNative(native)
    return fallback?.getSnapshot() ?? unavailableSnapshot<T>()
  }

  const store = createSnapshotStore<ConfigFormSnapshot<T>>(project())
  const publish = (): void => { store.set(project()) }

  /**
   * The profile entry ids the shared mirror serves, or undefined while it has
   * no answer yet: an unanswered mirror is not evidence of absence.
   */
  const servedEntryIds = (): readonly string[] | undefined => {
    try {
      return configForms?.describe().getSnapshot().view?.namespaces.map(view => view.ns)
    } catch {
      // A mirror that refuses the read leaves the bridge as the only resolver.
      return []
    }
  }

  /** Bind the native form of one profile entry id, if this page serves one. */
  const bindNative = (entryId: string): void => {
    if (configForms === undefined || native !== undefined) return
    let form: ConfigForm<T>
    try {
      form = configForms.get<T>(entryId)
    } catch {
      // The shared forms service only hands out forms for entries it serves;
      // a refused id leaves the bridge controller in place.
      return
    }
    native = form
    nativeEntryId = entryId
    nativeUnsubscribe = form.subscribe(() => { if (native !== undefined) publish() })
    publish()
  }

  /**
   * Promote the transport to the native form the moment its profile entry id
   * is known: through the bridge, which is the only place the namespace to
   * entry-id mapping lives, or — for a caller that already binds by entry id —
   * by the namespace itself being one of the served entry ids. A mirror that
   * explicitly lacks the resolved id keeps the bridge: the native form would
   * only report the namespace unavailable.
   */
  const promote = (): void => {
    if (native !== undefined) return
    const served = servedEntryIds()
    const resolved = fallback?.resolvedEntryId()
    if (resolved !== undefined && (served === undefined || served.includes(resolved))) {
      bindNative(resolved)
      return
    }
    if (native === undefined && served?.includes(namespace) === true) bindNative(namespace)
  }

  const unsubscribes: Array<() => void> = []
  if (fallback !== undefined) {
    unsubscribes.push(fallback.subscribe(() => {
      promote()
      if (native === undefined) publish()
    }))
  }
  if (configForms !== undefined) {
    try {
      unsubscribes.push(configForms.describe().subscribe(() => {
        promote()
        if (native === undefined) publish()
      }))
    } catch {
      // A mirror without a subscription seat: the bridge read still promotes.
    }
  }
  promote()
  if (native === undefined) {
    // No entry id yet: the bridge read is what resolves it, and a page with
    // no bridge seat publishes its terminal unavailable state instead.
    if (fallback !== undefined) void fallback.load()
    else publish()
  }

  /** The native batch surface: one atomic mutate, per-field landed flags read back. */
  const nativeBatch = (form: ConfigForm<T>) => async (fields: BridgeBatchOp[], expectedRevision?: number): Promise<BridgeBatchResult> => {
    const ops: SettingsPathOpView[] = fields.map(({ field, op, value, path }) => op === 'set'
      ? { op, path: (path ?? [field]) as unknown as string[], value: value as WireValue }
      : { op, path: (path ?? [field]) as unknown as string[] })
    const accepted = await form.mutate(ops, expectedRevision ?? form.getSnapshot().revision)
    if (!accepted) {
      return { ok: false, fields: [], code: 'settings-rejected', message: 'the Host refused the settings mutation' }
    }
    // A redacted secret never appears in the user layer; the shared mirror
    // exposes it as a declared secret slot instead, which is what the landed
    // check reads.
    const view = configForms?.describe().getSnapshot().view?.namespaces.find(candidate => candidate.ns === nativeEntryId)
    return {
      ok: true,
      fields: judgeLandedFields(fields, {
        user: form.getSnapshot().user,
        ...view?.secrets === undefined ? {} : { secrets: [...view.secrets] },
      }),
    }
  }

  return {
    dispose: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
      nativeUnsubscribe?.()
      nativeUnsubscribe = undefined
      native = undefined
      void fallback?.dispose()
    },
    entryId: () => nativeEntryId ?? fallback?.resolvedEntryId(),
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    mutate: (ops: readonly SettingsPathOpView[], expectedRevision?: number) =>
      native?.mutate(ops, expectedRevision) ?? fallback?.mutate(ops, expectedRevision) ?? Promise.resolve(false),
    set: (field: string, value: unknown) =>
      native?.set(field, value) ?? fallback?.set(field, value) ?? Promise.resolve(false),
    unset: (field: string) =>
      native?.unset(field) ?? fallback?.unset(field) ?? Promise.resolve(false),
    load: async () => {
      // The native form derives from the shared mirror, which refreshes
      // itself; only the bridge controller needs an explicit re-read.
      if (native !== undefined) return
      await fallback?.load()
    },
    // Resolve the compatibility batch capability against the active transport
    // at call time: the bridge controller may still be the transport when this
    // wrapper is created and be replaced by the native form later.
    get mutateBatch() {
      if (native !== undefined) return nativeBatch(native)
      return fallback?.mutateBatch.bind(fallback)
    },
  }
}

/** True when the value is the shared configuration forms service. */
function isConfigFormsFace(value: unknown): value is ConfigForms {
  if (typeof value !== 'object' || value === null) return false
  const face = value as { get?: unknown; describe?: unknown }
  return typeof face.get === 'function' && typeof face.describe === 'function'
}

/** True when the value exposes the settings invalidation face the wrapper listens to. */
function isRemoteFace(value: unknown): value is { $on: (event: string, callback: (namespace?: unknown) => void) => () => void } {
  return typeof value === 'object' && value !== null && typeof (value as { $on?: unknown }).$on === 'function'
}

/** The optional compat binder surface family plugins read from ctx. */
export interface WebUiSettingsBinderFace {
  bind<T>(spec: ConfigFormSpec<T>): ConfigForm<T>
}

/**
 * The family settings binder, provided as the webUiSettings service. Its
 * bind() resolves the profile entry id through the bridge and hands back the
 * native shared form, falling back to the loopback bridge controller for a
 * page the entry id never reaches.
 */
export class WebUiSettingsBinder extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webUiSettings')
  }

  /**
   * The binder itself under the previous cohort's seat name.
   * @deprecated The 0.1.7 client serves no `ctx.settingsScope` service; this
   * alias only keeps call sites written as
   * `ctx.get('webUiSettings') ?? ctx.settingsScope` compiling while they are
   * migrated to `ctx.get('webUiSettings')`.
   */
  get settingsScope(): WebUiSettingsBinder {
    return this
  }

  /**
   * Bind one family settings namespace.
   * @param spec - the namespace and an optional narrowing decoder.
   * @returns the form the caller stages and saves through.
   */
  bind<T>(spec: ConfigFormSpec<T>): ConfigForm<T> {
    const ctx = this.ctx
    // The shared forms service is read through the service lookup instead of a
    // hard inject: a deployment that serves no settings provider still loads
    // this plugin, and the bridge controller then carries the whole form.
    const forms = ctx.get('configForms')
    const scope = createCompatScope<T>({
      namespace: spec.namespace,
      ...spec.decode === undefined ? {} : { decode: spec.decode },
      ...isConfigFormsFace(forms) ? { configForms: forms } : {},
      ...typeof fetch === 'function' ? { fetchFn: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) } : {},
    })
    // Bridge refreshes ride the same invalidation edges as the settings
    // document: forwarded entry updates and connection resets. The forwarded
    // namespace is a profile entry id, so the resolved entry id is accepted
    // alongside the family namespace the caller bound.
    ctx.effect(() => {
      const disposers: Array<() => void> = []
      const remote = ctx.get('remote')
      if (isRemoteFace(remote)) {
        disposers.push(remote.$on('settings/document-updated', (namespace) => {
          if (namespace !== undefined && String(namespace) !== spec.namespace && String(namespace) !== scope.entryId()) return
          void scope.load()
        }))
      }
      disposers.push(ctx.on('connection/reset', () => { void scope.load() }))
      return () => {
        for (const dispose of disposers) dispose()
        // Release the scope's own subscriptions (bridge + native + mirror) so
        // an unloaded plugin stops republishing into the shared stores.
        scope.dispose()
      }
    }, 'web-ui-settings: compat form invalidation')
    return scope
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Family settings binder (native shared forms over the bridge fallback). */
    webUiSettings: WebUiSettingsBinder
    /**
     * @deprecated The previous cohort's settings binder seat. This package
     * provides no service under this name; the property stays declared so
     * family call sites written against 0.1.6 keep compiling until they are
     * migrated to {@link Context.webUiSettings}.
     */
    settingsScope?: WebUiSettingsBinder
  }
}
