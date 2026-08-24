/** Paired-only model discovery and adoption routes; generic privileged RPCs stay loopback-only. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxy, ModelProviderGroup, RpcId, RpcResponse, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import type { PairingService } from './pairing.ts'
import { readCookie } from './gate.ts'
import { readBoundedJson, writeJson } from './http.ts'
import { isTrustedApiRequest, publicHostOf } from './routes.ts'

const MAX_BODY_BYTES = 16 * 1024
const MAX_IDENTIFIER_LENGTH = 160
const MAX_DISPLAY_NAME_LENGTH = 240
const MAX_TOKEN_LIMIT = 10_000_000
const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ReasoningEffort = typeof REASONING_EFFORTS[number]
const stringField = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\r\n\0]/.test(value), 'must not contain a newline or NUL')
const providerSchema = z.object({ provider: stringField(MAX_IDENTIFIER_LENGTH) }).strict()
const modelSchema = z.object({
  id: stringField(MAX_IDENTIFIER_LENGTH),
  name: stringField(MAX_DISPLAY_NAME_LENGTH).optional(),
  contextWindow: z.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
  maxTokens: z.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
  reasoningEfforts: z.array(z.enum(REASONING_EFFORTS)).min(1).refine(
    efforts => efforts.every((effort, index) => index === 0 || REASONING_EFFORTS.indexOf(efforts[index - 1]!) < REASONING_EFFORTS.indexOf(effort)),
    'reasoning efforts must be unique and in canonical order',
  ).optional(),
}).strict()
const upsertSchema = z.object({ provider: stringField(MAX_IDENTIFIER_LENGTH), model: modelSchema }).strict()

interface ModelProfile { id: string, name?: string, contextWindow?: number, maxTokens?: number, reasoningEfforts?: ReasoningEffort[] }
interface EligibleProvider { provider: string, displayName: string, namespace: SettingsNamespaceView, profile: Record<string, unknown> }
interface CatalogValue { groups: ModelProviderGroup[], failures: Array<{ id: string, name: string, message: string }> }

export const PAIRED_MODEL_CATALOG_PATHS = {
  catalog: '/api/pair/model-catalog',
  discover: '/api/pair/model-catalog/discover',
  upsert: '/api/pair/model-catalog/upsert',
} as const

export interface PairedModelCatalogDeps {
  service: PairingService
  apiProxy: ApiProxy
  /** The LAN IP literals the host fence accepts, mirroring the /api/pair fence. */
  lanAddresses: readonly string[]
}

let rpcSequence = 0
function request<T>(payload: T): { rpcId: RpcId, payload: T } {
  rpcSequence += 1
  return { rpcId: `paired-model-catalog-${Date.now().toString(36)}-${rpcSequence.toString(36)}` as RpcId, payload }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function valueOf<T>(response: RpcResponse<T>): T | undefined { return response.result.ok ? response.result.value : undefined }
function errorCode(response: RpcResponse<unknown>): string | undefined { return response.result.ok ? undefined : response.result.error.code }
function reject(res: ServerResponse, status: number, error: string): void { writeJson(res, status, { error }) }
function publicProviderId(value: string): string {
  const normalized = value.replace(/[\r\n\0]/g, ' ').trim().slice(0, MAX_IDENTIFIER_LENGTH)
  return normalized === '' ? 'unknown' : normalized
}

function publicCatalog(value: CatalogValue): CatalogValue {
  return {
    groups: value.groups.map(group => ({ id: group.id, name: group.name, models: group.models.map(model => ({
      id: model.id, name: model.name,
      ...model.description === undefined ? {} : { description: model.description },
      ...model.reasoning === undefined ? {} : { reasoning: model.reasoning },
    })) })),
    failures: value.failures.map(failure => ({
      id: failure.id,
      name: failure.name,
      message: `model catalog unavailable for provider ${publicProviderId(failure.id)}`,
    })),
  }
}
function publicCandidates(models: Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }>): unknown[] {
  return models.map(model => ({ id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }))
}
function fieldsOf(model: ModelProfile, includeId: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    ...includeId ? { id: model.id } : {},
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }
  if (model.reasoningEfforts !== undefined) fields.reasoningEfforts = Object.fromEntries(model.reasoningEfforts.map(effort => [effort, effort === 'off' ? null : effort]))
  return fields
}
function groupFor(catalog: CatalogValue, provider: string): ModelProviderGroup | undefined {
  if (catalog.failures.some(failure => failure.id === provider)) return undefined
  return catalog.groups.find(group => group.id === provider)
}
async function readCatalog(apiProxy: ApiProxy): Promise<CatalogValue | undefined> {
  try { return valueOf(await apiProxy.llm.models(request({}))) } catch { return undefined }
}

/** Resolve one exact active llm-pi-ai provider address, never an input-supplied path. */
async function eligibleProvider(apiProxy: ApiProxy, requested: string): Promise<{ provider?: EligibleProvider, status?: number, error?: string }> {
  let providersResponse: Awaited<ReturnType<ApiProxy['llm']['providers']>>
  let settingsResponse: Awaited<ReturnType<ApiProxy['settings']['describe']>>
  try {
    providersResponse = await apiProxy.llm.providers(request({}))
    settingsResponse = await apiProxy.settings.describe(request({}))
  } catch { return { status: 502, error: 'model catalog capability is unavailable' } }
  const providers = valueOf(providersResponse)
  const settings = valueOf(settingsResponse)
  if (providers === undefined || settings === undefined) return { status: 502, error: 'model catalog capability is unavailable' }
  const route = providers.providers.find(candidate => candidate.provider === requested)
  if (route === undefined) return { status: 404, error: `unknown provider ${requested}` }
  if (!settings.writable || !route.active || route.settingsNs !== 'llm-pi-ai' || route.settingsPath.length !== 2
    || route.settingsPath[0] !== 'providers' || route.settingsPath[1] !== requested) return { status: 403, error: `provider ${requested} is not eligible for the paired model catalog` }
  const namespace = settings.namespaces.find(candidate => candidate.ns === 'llm-pi-ai')
  const root = namespace !== undefined && isRecord(namespace.value) ? namespace.value : undefined
  const providersValue = root !== undefined && isRecord(root.providers) ? root.providers : undefined
  const profile = providersValue !== undefined && isRecord(providersValue[requested]) ? providersValue[requested] : undefined
  if (namespace === undefined || profile === undefined) return { status: 403, error: `provider ${requested} is not eligible for the paired model catalog` }
  return { provider: { provider: requested, displayName: route.displayName, namespace, profile } }
}
function validIdentifier(value: unknown): value is string {
  const parsed = stringField(MAX_IDENTIFIER_LENGTH).safeParse(value)
  return parsed.success && parsed.data === value
}
function configuredModels(profile: Record<string, unknown>): { inherited: true } | { inherited: false, values: Record<string, unknown>[] } | undefined {
  if (!Object.hasOwn(profile, 'models')) return { inherited: true }
  if (!Array.isArray(profile.models)) return undefined
  if (profile.models.length === 0) return { inherited: true }
  const values: Record<string, unknown>[] = []
  for (const entry of profile.models) {
    if (!isRecord(entry) || !validIdentifier(entry.id)) return undefined
    values.push({ ...entry })
  }
  return { inherited: false, values }
}
function configuredOverrides(profile: Record<string, unknown>): { present: boolean, values: Map<string, Record<string, unknown>> } | undefined {
  if (!Object.hasOwn(profile, 'modelOverrides')) return { present: false, values: new Map() }
  if (!isRecord(profile.modelOverrides)) return undefined
  const values = new Map<string, Record<string, unknown>>()
  for (const [id, value] of Object.entries(profile.modelOverrides)) {
    if (!validIdentifier(id) || !isRecord(value)) return undefined
    values.set(id, { ...value })
  }
  return { present: true, values }
}
function updatedModels(existing: Record<string, unknown>[], model: ModelProfile): Record<string, unknown>[] {
  const next = existing.map(entry => ({ ...entry }))
  const index = next.findIndex(entry => entry.id === model.id)
  const patch = fieldsOf(model, true)
  if (index >= 0) next[index] = { ...next[index], ...patch }
  else next.push(patch)
  return next
}
function mutationPlan(profile: Record<string, unknown>, provider: string, model: ModelProfile, catalog: CatalogValue): { ops: SettingsPathOpView[] } | undefined {
  const configured = configuredModels(profile)
  const overrides = configuredOverrides(profile)
  if (configured === undefined || overrides === undefined) return undefined
  const modelsPath = ['providers', provider, 'models']
  const overridesPath = ['providers', provider, 'modelOverrides']
  if (!configured.inherited) {
    if (overrides.values.size > 0) return undefined
    const ops: SettingsPathOpView[] = [{ op: 'set', path: modelsPath, value: updatedModels(configured.values, model) }]
    if (overrides.present) ops.push({ op: 'unset', path: overridesPath })
    return { ops }
  }

  const group = groupFor(catalog, provider)
  if (group?.models.some(entry => entry.id === model.id) === true) {
    const existing = overrides.values.get(model.id) ?? {}
    return { ops: [{ op: 'set', path: [...overridesPath, model.id], value: { ...existing, ...fieldsOf(model, false) } }] }
  }
  if (group === undefined) return undefined
  const materialized: Record<string, unknown>[] = []
  const materializedIds = new Set<string>()
  for (const installed of group.models) {
    materialized.push({ ...overrides.values.get(installed.id), id: installed.id })
    materializedIds.add(installed.id)
  }
  for (const [id, override] of overrides.values) {
    if (!materializedIds.has(id)) materialized.push({ ...override, id })
  }
  const ops: SettingsPathOpView[] = [{ op: 'set', path: modelsPath, value: updatedModels(materialized, model) }]
  if (overrides.present) ops.push({ op: 'unset', path: overridesPath })
  return { ops }
}
function paired(req: IncomingMessage, service: PairingService): boolean {
  const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
  return deviceId !== undefined && service.touchDevice(deviceId)
}
async function bodyOf<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T | undefined> {
  try { return schema.parse(await readBoundedJson(req, MAX_BODY_BYTES)) } catch { return undefined }
}

/** Build the narrow paired-device model catalog routes. */
export function makePairedModelCatalogRoutes(deps: PairedModelCatalogDeps): WebRoute[] {
  const { service, apiProxy, lanAddresses } = deps
  /** Same fence as the /api/pair family: loopback, the advertised LAN literals, or the configured public host. */
  const fence = (req: IncomingMessage): boolean => {
    const publicHost = publicHostOf(service.publicBaseUrl)
    return isTrustedApiRequest(req, publicHost === undefined ? lanAddresses : [...lanAddresses, publicHost])
  }
  const gate = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!fence(req)) {
      req.resume()
      reject(res, 403, 'paired model catalog is not reachable for this origin')
      return false
    }
    if (!paired(req, service)) {
      req.resume()
      reject(res, 403, 'paired model catalog requires a live paired device')
      return false
    }
    return true
  }
  const catalog = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'GET') return reject(res, 405, 'method not allowed')
    let providersResponse: Awaited<ReturnType<ApiProxy['llm']['providers']>>
    let settingsResponse: Awaited<ReturnType<ApiProxy['settings']['describe']>>
    try { providersResponse = await apiProxy.llm.providers(request({})); settingsResponse = await apiProxy.settings.describe(request({})) } catch { return reject(res, 502, 'model catalog capability is unavailable') }
    const providers = valueOf(providersResponse)
    const settings = valueOf(settingsResponse)
    if (providers === undefined || settings === undefined) return reject(res, 502, 'model catalog capability is unavailable')
    const namespace = settings.namespaces.find(candidate => candidate.ns === 'llm-pi-ai')
    const providerMap = namespace !== undefined && isRecord(namespace.value) && isRecord(namespace.value.providers) ? namespace.value.providers : undefined
    const eligible = settings.writable && providerMap !== undefined ? providers.providers.filter(candidate => candidate.active && candidate.settingsNs === 'llm-pi-ai'
      && candidate.settingsPath.length === 2 && candidate.settingsPath[0] === 'providers' && candidate.settingsPath[1] === candidate.provider && isRecord(providerMap[candidate.provider]))
      .map(candidate => ({ provider: candidate.provider, displayName: candidate.displayName })) : []
    writeJson(res, 200, { capability: 'paired-model-catalog', providers: eligible })
  }
  const discover = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'POST') return reject(res, 405, 'method not allowed')
    const body = await bodyOf(req, providerSchema)
    if (body === undefined) return reject(res, 400, 'invalid model catalog request')
    const eligible = await eligibleProvider(apiProxy, body.provider)
    if (eligible.provider === undefined) return reject(res, eligible.status ?? 502, eligible.error ?? 'model catalog capability is unavailable')
    try {
      const result = valueOf(await apiProxy.llm.discoverModels(request({ settingsNs: 'llm-pi-ai', provider: eligible.provider.provider })))
      if (result === undefined) return reject(res, 502, `model discovery failed for provider ${eligible.provider.provider}`)
      writeJson(res, 200, { models: publicCandidates(result.models) })
    } catch { reject(res, 502, `model discovery failed for provider ${eligible.provider.provider}`) }
  }
  const upsert = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'POST') return reject(res, 405, 'method not allowed')
    const body = await bodyOf(req, upsertSchema)
    if (body === undefined) return reject(res, 400, 'invalid model catalog request')
    const eligible = await eligibleProvider(apiProxy, body.provider)
    if (eligible.provider === undefined) return reject(res, eligible.status ?? 502, eligible.error ?? 'model catalog capability is unavailable')
    const before = await readCatalog(apiProxy)
    if (before === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    const plan = mutationPlan(eligible.provider.profile, body.provider, body.model, before)
    if (plan === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    let mutation: Awaited<ReturnType<ApiProxy['settings']['mutate']>>
    try { mutation = await apiProxy.settings.mutate(request({ ns: 'llm-pi-ai', expectedRevision: eligible.provider.namespace.revision, ops: plan.ops })) } catch { return reject(res, 502, `model update failed for provider ${body.provider}`) }
    const code = errorCode(mutation)
    if (code === 'settings-conflict') return reject(res, 409, `model update conflicted for provider ${body.provider}`)
    if (code === 'settings-rejected') return reject(res, 422, `model update was rejected for provider ${body.provider}`)
    if (code !== undefined) return reject(res, 502, `model update failed for provider ${body.provider}`)
    const after = await readCatalog(apiProxy)
    if (after === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    writeJson(res, 200, publicCatalog(after))
  }
  return [
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.catalog, handler: catalog },
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.discover, handler: discover },
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.upsert, handler: upsert },
  ]
}
