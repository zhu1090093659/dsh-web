/** Read-only Cloudflare inspection and pure HTTPS setup planning for Issue #731. */

import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir, platform as nodePlatform } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { isLoopbackHostname } from './loopback.ts'
import type {
  SetupErrorCode,
  SetupErrorField,
  SetupPlan,
  SetupPlanAction,
  SetupPlanRequest,
  SetupPlanResponse,
  SetupPreflightResponse,
  SetupServicePreview,
} from './setup-contract.ts'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const API_TIMEOUT_MS = 15_000
const PROCESS_TIMEOUT_MS = 10_000
const PROCESS_OUTPUT_LIMIT = 64 * 1024
const PAGE_SIZE = 100
const MAX_PAGES = 50
const OTP_IDP_NAME = 'DSH Remote One-time PIN'

/** Stable planner failures whose messages are safe for a loopback UI. */
export class SetupPlanError extends Error {
  constructor(
    readonly code: SetupErrorCode,
    message: string,
    readonly retryable = false,
    readonly field?: SetupErrorField,
  ) {
    super(message)
    this.name = 'SetupPlanError'
  }
}

export interface CloudflareZone { id: string; name: string; accountId: string }
export interface CloudflareTunnel { id: string; name: string; configSrc?: 'local' | 'cloudflare' }
export interface CloudflareDnsRecord { id: string; type: string; name: string; content: string; proxied: boolean }
export interface CloudflareIdentityProvider { id: string; name: string; type: string }
export interface CloudflareAccessApp {
  id: string
  name: string
  domain: string
  type: string
  destinations: Array<{ type?: string; uri?: string }>
  allowedIdps: string[]
  autoRedirectToIdentity: boolean
}
export interface CloudflareAccessPolicy {
  id: string
  name: string
  decision: string
  include: unknown[]
  exclude?: unknown[]
  require?: unknown[]
}

/** Cloudflare seam for PR1. It intentionally has no write method. */
export interface CloudflareReadApi {
  verifyToken(): Promise<void>
  listZones(): Promise<CloudflareZone[]>
  listTunnels(accountId: string, name: string): Promise<CloudflareTunnel[]>
  listDnsRecords(zoneId: string, hostname: string): Promise<CloudflareDnsRecord[]>
  listIdentityProviders(accountId: string): Promise<CloudflareIdentityProvider[]>
  listAccessApps(accountId: string): Promise<CloudflareAccessApp[]>
  listAccessPolicies(accountId: string, appId: string): Promise<CloudflareAccessPolicy[]>
}

interface ApiEnvelope<T> {
  success?: boolean
  result?: T
  result_info?: { page?: number; per_page?: number; count?: number; total_count?: number }
}

type FetchLike = typeof fetch

/** GET-only Cloudflare v4 client. The token is held only by this instance. */
export class CloudflareHttpReadApi implements CloudflareReadApi {
  constructor(private readonly token: string, private readonly fetchFn: FetchLike = fetch) {}

  private async get<T>(path: string): Promise<ApiEnvelope<T>> {
    let response: Response
    try {
      response = await this.fetchFn(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
    } catch {
      throw new SetupPlanError('cloudflare-unavailable', 'Cloudflare could not be reached for read-only inspection.', true)
    }
    if (response.status === 401) throw new SetupPlanError('cloudflare-auth-failed', 'Cloudflare rejected the API token.', false, 'credential')
    if (response.status === 403) throw new SetupPlanError('cloudflare-permission-denied', 'The credential cannot read the required Cloudflare resources.', false, 'credential')
    if (!response.ok) throw new SetupPlanError('cloudflare-unavailable', `Cloudflare read-only inspection returned HTTP ${String(response.status)}.`, response.status >= 500)
    let envelope: ApiEnvelope<T>
    try {
      envelope = await response.json() as ApiEnvelope<T>
    } catch {
      throw new SetupPlanError('cloudflare-unavailable', 'Cloudflare returned an invalid read response.', true)
    }
    if (envelope.success !== true || envelope.result === undefined) {
      throw new SetupPlanError('cloudflare-unavailable', 'Cloudflare did not return a usable read result.', true)
    }
    return envelope
  }

  private async listAll<T>(path: string): Promise<T[]> {
    const values: T[] = []
    const separator = path.includes('?') ? '&' : '?'
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const envelope = await this.get<T[]>(`${path}${separator}per_page=${String(PAGE_SIZE)}&page=${String(page)}`)
      const batch = envelope.result ?? []
      values.push(...batch)
      const info = envelope.result_info
      const perPage = info?.per_page ?? PAGE_SIZE
      const total = info?.total_count
      if (total !== undefined ? values.length >= total : batch.length < perPage) return values
    }
    throw new SetupPlanError('cloudflare-unavailable', 'Cloudflare read-only inspection exceeded its pagination safety limit.', true)
  }

  async verifyToken(): Promise<void> {
    const response = await this.get<{ status?: string }>('/user/tokens/verify')
    if (response.result?.status !== 'active') throw new SetupPlanError('cloudflare-auth-failed', 'The Cloudflare API token is not active.', false, 'credential')
  }

  async listZones(): Promise<CloudflareZone[]> {
    const values = await this.listAll<{ id?: string; name?: string; account?: { id?: string } }>('/zones?status=active')
    return values.flatMap(value => value.id !== undefined && value.name !== undefined && value.account?.id !== undefined
      ? [{ id: value.id, name: value.name.toLowerCase(), accountId: value.account.id }]
      : [])
  }

  async listTunnels(accountId: string, name: string): Promise<CloudflareTunnel[]> {
    const values = await this.listAll<{ id?: string; name?: string; config_src?: 'local' | 'cloudflare' }>(
      `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(name)}`,
    )
    return values.flatMap(value => value.id !== undefined && value.name !== undefined
      ? [{ id: value.id, name: value.name, configSrc: value.config_src }]
      : [])
  }

  async listDnsRecords(zoneId: string, hostname: string): Promise<CloudflareDnsRecord[]> {
    const values = await this.listAll<{ id?: string; type?: string; name?: string; content?: string; proxied?: boolean }>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(hostname)}`,
    )
    return values.flatMap(value => value.id !== undefined && value.type !== undefined && value.name !== undefined && value.content !== undefined
      ? [{ id: value.id, type: value.type, name: value.name.toLowerCase(), content: value.content.toLowerCase(), proxied: value.proxied === true }]
      : [])
  }

  async listIdentityProviders(accountId: string): Promise<CloudflareIdentityProvider[]> {
    const values = await this.listAll<{ id?: string; name?: string; type?: string }>(`/accounts/${encodeURIComponent(accountId)}/access/identity_providers`)
    return values.flatMap(value => value.id !== undefined && value.type !== undefined
      ? [{ id: value.id, name: value.name?.trim() || (value.type === 'onetimepin' ? OTP_IDP_NAME : `Cloudflare ${value.type} identity provider`), type: value.type }]
      : [])
  }

  async listAccessApps(accountId: string): Promise<CloudflareAccessApp[]> {
    const values = await this.listAll<{
      id?: string; name?: string; domain?: string; type?: string
      destinations?: Array<{ type?: string; uri?: string }>
      allowed_idps?: string[]; auto_redirect_to_identity?: boolean
    }>(`/accounts/${encodeURIComponent(accountId)}/access/apps`)
    return values.flatMap(value => value.id !== undefined && value.type !== undefined
      ? [{
          id: value.id, name: value.name ?? '', domain: (value.domain ?? '').toLowerCase(), type: value.type,
          destinations: value.destinations ?? [], allowedIdps: value.allowed_idps ?? [],
          autoRedirectToIdentity: value.auto_redirect_to_identity === true,
        }]
      : [])
  }

  async listAccessPolicies(accountId: string, appId: string): Promise<CloudflareAccessPolicy[]> {
    const values = await this.listAll<{
      id?: string; name?: string; decision?: string; include?: unknown[]; exclude?: unknown[]; require?: unknown[]
    }>(`/accounts/${encodeURIComponent(accountId)}/access/apps/${encodeURIComponent(appId)}/policies`)
    return values.flatMap(value => value.id !== undefined && value.decision !== undefined
      ? [{ id: value.id, name: value.name ?? '', decision: value.decision, include: value.include ?? [], exclude: value.exclude, require: value.require }]
      : [])
  }
}

export interface ProcessResult { code: number; stdout: string; stderr: string }
export type ReadOnlyProcessRunner = (executable: string, args: readonly string[], timeoutMs?: number) => Promise<ProcessResult>

const defaultProcessRunner: ReadOnlyProcessRunner = async (executable, args, timeoutMs = PROCESS_TIMEOUT_MS) => await new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(executable, [...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let size = 0
  let settled = false
  const finish = (value: ProcessResult | Error): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (value instanceof Error) rejectPromise(value)
    else resolvePromise(value)
  }
  const collect = (target: Buffer[], chunk: Buffer): void => {
    if (size >= PROCESS_OUTPUT_LIMIT) return
    const value = chunk.subarray(0, PROCESS_OUTPUT_LIMIT - size)
    size += value.length
    target.push(value)
  }
  child.stdout.on('data', chunk => { collect(stdout, chunk as Buffer) })
  child.stderr.on('data', chunk => { collect(stderr, chunk as Buffer) })
  child.on('error', finish)
  child.on('close', code => { finish({ code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }) })
  const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('process timed out')) }, timeoutMs)
  timer.unref()
})

export interface CloudflaredProbeResult { found: boolean; path?: string; version?: string }
export type CloudflaredProbe = () => Promise<CloudflaredProbeResult>
export type KeychainReader = (reference: { service: string; account?: string }) => Promise<string>

export interface CloudflareSetupPlannerOptions {
  host: string
  port: number
  config: () => { autoTunnel?: boolean; publicBaseUrl?: string }
  platform?: NodeJS.Platform
  homeDir?: string
  processRunner?: ReadOnlyProcessRunner
  cloudflaredProbe?: CloudflaredProbe
  keychainReader?: KeychainReader
  readApiFactory?: (token: string) => CloudflareReadApi
  fetch?: FetchLike
}

export interface CloudflareSetupPlanner {
  readonly localOrigin: string
  preflight(): Promise<SetupPreflightResponse>
  plan(input: SetupPlanRequest): Promise<SetupPlanResponse>
}

/** Factory consumed by the additive host integration. */
export function createCloudflareSetupPlanner(options: CloudflareSetupPlannerOptions): CloudflareSetupPlanner {
  const platform = options.platform ?? nodePlatform()
  const runner = options.processRunner ?? defaultProcessRunner
  const probe = options.cloudflaredProbe ?? (() => defaultCloudflaredProbe(platform, options.homeDir ?? homedir(), runner))
  const readKeychain = options.keychainReader ?? (reference => defaultKeychainReader(platform, reference, runner))
  const makeApi = options.readApiFactory ?? (token => new CloudflareHttpReadApi(token, options.fetch ?? fetch))
  const normalizedHost = options.host.toLowerCase()
  const loopbackHost = normalizedHost === '::1' || normalizedHost === '[::1]'
    ? '[::1]'
    : isLoopbackHostname(normalizedHost) ? normalizedHost : '127.0.0.1'
  const localOrigin = new URL(`http://${loopbackHost}:${String(options.port)}`).origin

  const preflight = async (): Promise<SetupPreflightResponse> => {
    const cloudflared = await probe().catch((): CloudflaredProbeResult => ({ found: false }))
    const config = safeConfig(options.config)
    return {
      ok: true,
      readOnly: true,
      executionAvailable: false,
      preflight: {
        platform,
        dsh: {
          host: options.host,
          port: options.port,
          localOrigin,
          loopbackOnly: normalizedHost === '::1' || isLoopbackHostname(normalizedHost),
        },
        cloudflared: { found: cloudflared.found, version: cloudflared.version },
        serviceMode: platform === 'darwin' ? 'launchd-preview' : 'manual-preview',
        autoTunnelEnabled: config.autoTunnel === true,
        configuredPublicBaseUrl: normalizedHttpsOrigin(config.publicBaseUrl),
      },
    }
  }

  return {
    localOrigin,
    preflight,
    plan: async (input): Promise<SetupPlanResponse> => {
      const status = await preflight()
      const token = await resolveCredential(input, platform, readKeychain)
      const api = makeApi(token)
      const collected = await collectInspection(api, input)
      const target = {
        hostname: input.hostname,
        tunnelName: input.tunnelName ?? defaultTunnelName(input.hostname),
        accessAppName: input.accessAppName ?? defaultAccessAppName(input.hostname),
        includeRemote: input.includeRemote,
        emailHash: sha256(input.email),
      }
      return { ok: true, readOnly: true, executionAvailable: false, plan: buildCloudflareSetupPlan({ preflight: status.preflight, target, inspection: collected }) }
    },
  }
}

function safeConfig(read: CloudflareSetupPlannerOptions['config']): { autoTunnel?: boolean; publicBaseUrl?: string } {
  try { return read() } catch { return {} }
}

function normalizedHttpsOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      && url.pathname === '/' && url.search === '' && url.hash === '' ? url.origin : undefined
  } catch { return undefined }
}

async function defaultCloudflaredProbe(platform: NodeJS.Platform, homeDir: string, runner: ReadOnlyProcessRunner): Promise<CloudflaredProbeResult> {
  const executable = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const candidates = new Set<string>()
  if (platform === 'darwin') { candidates.add('/opt/homebrew/bin/cloudflared'); candidates.add('/usr/local/bin/cloudflared') }
  if (platform === 'linux') { candidates.add('/usr/local/bin/cloudflared'); candidates.add('/usr/bin/cloudflared') }
  if (platform === 'win32') candidates.add(join(homeDir, 'AppData', 'Local', 'cloudflared', executable))
  for (const directory of (process.env.PATH ?? '').split(delimiter)) if (directory !== '') candidates.add(resolve(directory, executable))
  for (const candidate of candidates) {
    try { await access(candidate, fsConstants.X_OK) } catch { continue }
    const result = await runner(candidate, ['version']).catch(() => undefined)
    return { found: true, path: candidate, version: result?.code === 0 ? (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0]?.replace(/^cloudflared version\s+/i, '').slice(0, 256) : undefined }
  }
  return { found: false }
}

async function defaultKeychainReader(platform: NodeJS.Platform, reference: { service: string; account?: string }, runner: ReadOnlyProcessRunner): Promise<string> {
  if (platform !== 'darwin') throw new SetupPlanError('keychain-unavailable', 'Keychain credential references are supported only on macOS.', false, 'credential')
  const args = ['find-generic-password', '-s', reference.service, ...(reference.account === undefined ? [] : ['-a', reference.account]), '-w']
  const result = await runner('/usr/bin/security', args, 5_000).catch(() => undefined)
  const token = result?.code === 0 ? result.stdout.trim() : ''
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) throw new SetupPlanError('keychain-unavailable', 'The referenced Keychain credential could not be read.', false, 'credential')
  return token
}

async function resolveCredential(input: SetupPlanRequest, platform: NodeJS.Platform, readKeychain: KeychainReader): Promise<string> {
  if (input.credential.source === 'request') return input.credential.token
  if (platform !== 'darwin') throw new SetupPlanError('keychain-unavailable', 'Keychain credential references are supported only on macOS.', false, 'credential')
  return await readKeychain({ service: input.credential.service, account: input.credential.account })
}

export interface CloudflarePlanTarget {
  hostname: string
  tunnelName: string
  accessAppName: string
  includeRemote: boolean
  emailHash: string
}

export interface CloudflareInspectionSnapshot {
  zone: CloudflareZone
  tunnels: CloudflareTunnel[]
  dnsRecords: CloudflareDnsRecord[]
  identityProviders: CloudflareIdentityProvider[]
  accessApps: CloudflareAccessApp[]
  policies: Array<{ appId: string; id: string; name: string; fingerprint: string; exactEmailOtpId?: string }>
}

async function collectInspection(api: CloudflareReadApi, input: SetupPlanRequest): Promise<CloudflareInspectionSnapshot> {
  await api.verifyToken()
  const zones = await api.listZones()
  const zone = zones.filter(candidate => input.hostname === candidate.name || input.hostname.endsWith(`.${candidate.name}`)).sort((a, b) => b.name.length - a.name.length)[0]
  if (zone === undefined) throw new SetupPlanError('zone-not-found', 'No active Cloudflare zone matching this hostname is visible.', false, 'hostname')
  const tunnelName = input.tunnelName ?? defaultTunnelName(input.hostname)
  const [tunnels, dnsRecords, identityProviders, accessApps] = await Promise.all([
    api.listTunnels(zone.accountId, tunnelName), api.listDnsRecords(zone.id, input.hostname),
    api.listIdentityProviders(zone.accountId), api.listAccessApps(zone.accountId),
  ])
  const targetApps = accessApps.filter(app => app.domain === input.hostname || app.destinations.some(destination => destination.uri?.toLowerCase() === input.hostname))
  const policyRows = await Promise.all(targetApps.map(async app => {
    const values = await api.listAccessPolicies(zone.accountId, app.id)
    return values.map(policy => ({
      appId: app.id, id: policy.id, name: policy.name,
      fingerprint: sha256(canonicalJson(policy)),
      exactEmailOtpId: exactPolicyOtpId(policy, input.email),
    }))
  }))
  return normalizeInspection({ zone, tunnels, dnsRecords, identityProviders, accessApps: targetApps, policies: policyRows.flat() })
}

function exactPolicyOtpId(policy: CloudflareAccessPolicy, email: string): string | undefined {
  if (policy.decision !== 'allow' || policy.include.length !== 1 || (policy.exclude?.length ?? 0) !== 0 || policy.require?.length !== 1) return undefined
  const include = policy.include[0] as { email?: { email?: unknown } } | undefined
  const require = policy.require[0] as { login_method?: { id?: unknown } } | undefined
  return typeof include?.email?.email === 'string' && include.email.email.toLowerCase() === email
    && typeof require?.login_method?.id === 'string' ? require.login_method.id : undefined
}

function normalizeInspection(value: CloudflareInspectionSnapshot): CloudflareInspectionSnapshot {
  const byId = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id.localeCompare(b.id))
  return { ...value, tunnels: byId(value.tunnels), dnsRecords: byId(value.dnsRecords), identityProviders: byId(value.identityProviders), accessApps: byId(value.accessApps), policies: [...value.policies].sort((a, b) => `${a.appId}:${a.id}`.localeCompare(`${b.appId}:${b.id}`)) }
}

export interface BuildCloudflareSetupPlanInput {
  preflight: SetupPreflightResponse['preflight']
  target: CloudflarePlanTarget
  inspection: CloudflareInspectionSnapshot
}

/** Pure, token-free planner. The input contains only normalized inspection facts. */
export function buildCloudflareSetupPlan(input: BuildCloudflareSetupPlanInput): SetupPlan {
  const { preflight, target } = input
  const inspection = normalizeInspection(input.inspection)
  const blockers: SetupPlan['blockers'] = [
    { code: 'execution-unavailable', message: 'PR1 provides a read-only preview and has no execution endpoint.' },
    { code: 'mobile-ingress-not-ready', message: 'The current mobile page posts pairing acceptance to /api/pair/accept, which is outside the planned /m ingress and would fail until a future compatibility change is implemented.' },
  ]
  const warnings: string[] = ['Cloudflare read access was verified; write permission remains unverified.']
  if (!preflight.dsh.loopbackOnly) blockers.push({ code: 'dsh-not-loopback', message: 'DSH must bind to a loopback interface before a public ingress can be executed.' })
  if (!preflight.cloudflared.found) blockers.push({ code: 'cloudflared-not-found', message: 'No user-installed cloudflared executable was found.' })
  if (preflight.autoTunnelEnabled) {
    blockers.push({ code: 'auto-tunnel-active', message: 'The existing autoTunnel remains active and owns the advertised public URL.' })
    warnings.push('This planner does not stop or reconfigure autoTunnel.')
  }
  if (target.includeRemote) {
    blockers.push({ code: 'remote-transport-only', message: '/remote is only the paired desktop transport; publishing it does not publish the desktop boot page, assets, or pairing acceptance.' })
    warnings.push('The /remote opt-in is transport-only and is not a complete remote desktop ingress.')
  }
  if (target.hostname === inspection.zone.name) blockers.push({ code: 'zone-apex-not-supported', message: 'Use a dedicated subdomain instead of the zone apex.' })

  const actions: SetupPlanAction[] = []
  const tunnels = inspection.tunnels.filter(tunnel => tunnel.name === target.tunnelName)
  const tunnel = tunnels.length === 1 ? tunnels[0] : undefined
  const reusableTunnel = tunnel?.configSrc === 'local' ? tunnel : undefined
  const tunnelConflict = tunnels.length > 1 || (tunnel !== undefined && reusableTunnel === undefined)
  if (tunnels.length > 1) blockers.push({ code: 'resource-conflict', message: 'Multiple tunnels use the requested name.' })
  if (tunnel !== undefined && reusableTunnel === undefined) blockers.push({ code: 'resource-conflict', message: 'The matching tunnel is not proven to be locally managed.' })
  actions.push({
    id: 'tunnel',
    resource: 'tunnel',
    operation: tunnelConflict ? 'manual' : reusableTunnel === undefined ? 'create' : 'reuse',
    target: target.tunnelName,
    detail: tunnelConflict
      ? 'Would stop for manual resolution because the existing tunnel set is not one proven locally managed resource.'
      : reusableTunnel === undefined
        ? 'Would create one locally managed named tunnel.'
        : 'Would reuse the exact locally managed named tunnel after a future confirmed re-inspection.',
  })
  actions.push({
    id: 'credentials',
    resource: 'credentials',
    operation: tunnels.length === 0 ? 'write' : 'manual',
    target: 'private tunnel credential file',
    detail: tunnels.length === 0
      ? 'Would write mode-0400 credentials only in a future execution PR.'
      : 'A future execution PR must verify an existing private credential file before this tunnel can be reused.',
  })

  const expectedDns = reusableTunnel === undefined ? undefined : `${reusableTunnel.id}.cfargotunnel.com`
  const exactDns = expectedDns === undefined ? undefined : inspection.dnsRecords.find(record => record.type === 'CNAME'
    && record.name === target.hostname && record.content.replace(/\.$/, '') === expectedDns && record.proxied)
  const dnsConflict = inspection.dnsRecords.length > 1 || (inspection.dnsRecords.length === 1 && exactDns === undefined)
  if (dnsConflict) blockers.push({ code: 'resource-conflict', message: 'Existing DNS does not match one exact proxied tunnel CNAME.' })
  const dnsNeedsManualResolution = tunnelConflict || dnsConflict
  actions.push({
    id: 'dns',
    resource: 'dns',
    operation: dnsNeedsManualResolution ? 'manual' : exactDns === undefined ? 'create' : 'reuse',
    target: target.hostname,
    detail: dnsNeedsManualResolution
      ? 'Would stop for manual resolution until both the named tunnel and existing DNS are unambiguous.'
      : exactDns === undefined ? 'Would create one proxied CNAME for the named tunnel.' : 'Would reuse the exact proxied tunnel CNAME.',
  })

  const otpCandidates = inspection.identityProviders.filter(provider => provider.type === 'onetimepin')
  const otp = otpCandidates.length === 1 ? otpCandidates[0] : undefined
  const otpConflict = otpCandidates.length > 1
  if (otpConflict) blockers.push({ code: 'resource-conflict', message: 'Multiple One-time PIN identity providers exist; no unique provider can be selected.' })
  actions.push({
    id: 'otp-idp',
    resource: 'otp-idp',
    operation: otpConflict ? 'manual' : otp === undefined ? 'create' : 'reuse',
    target: otp?.name ?? OTP_IDP_NAME,
    detail: otpConflict
      ? 'Would stop for manual selection because the One-time PIN provider is ambiguous.'
      : otp === undefined ? 'Would create an account One-time PIN provider.' : 'Would reuse the unique account One-time PIN provider.',
  })

  const apps = inspection.accessApps
  const app = apps.length === 1 ? apps[0] : undefined
  const multipleApps = apps.length > 1
  if (multipleApps) blockers.push({ code: 'resource-conflict', message: 'Multiple Access apps target this hostname.' })
  const exactApp = app !== undefined && otp !== undefined && app.type === 'self_hosted' && app.domain === target.hostname
    && app.destinations.length === 1 && app.destinations[0]?.type === 'public' && app.destinations[0]?.uri?.toLowerCase() === target.hostname
    && app.allowedIdps.length === 1 && app.allowedIdps[0] === otp.id && app.autoRedirectToIdentity
  const appConflict = multipleApps || (app !== undefined && !exactApp)
  if (app !== undefined && !exactApp) blockers.push({ code: 'resource-conflict', message: 'The existing Access app is not restricted to the exact hostname and One-time PIN provider.' })
  const appNeedsManualResolution = otpConflict || appConflict
  actions.push({
    id: 'access-app',
    resource: 'access-app',
    operation: appNeedsManualResolution ? 'manual' : exactApp ? 'reuse' : 'create',
    target: target.accessAppName,
    detail: appNeedsManualResolution
      ? 'Would stop for manual resolution until the One-time PIN provider and existing Access apps are unambiguous.'
      : exactApp ? 'Would reuse the exact self-hosted Access app.' : 'Would create a self-hosted Access app restricted to One-time PIN.',
  })

  const policies = app === undefined ? [] : inspection.policies.filter(policy => policy.appId === app.id)
  const exactPolicy = otp === undefined ? undefined : policies.find(policy => policy.exactEmailOtpId === otp.id)
  const policyConflict = app !== undefined && (policies.length > 1 || (policies.length === 1 && exactPolicy === undefined))
  if (policyConflict) blockers.push({ code: 'resource-conflict', message: 'The existing Access policy is not one exact-email One-time PIN allow policy.' })
  const policyNeedsManualResolution = appNeedsManualResolution || policyConflict
  actions.push({
    id: 'access-policy',
    resource: 'access-policy',
    operation: policyNeedsManualResolution ? 'manual' : exactPolicy === undefined ? 'create' : 'reuse',
    target: `${target.accessAppName} OTP`.slice(0, 128),
    detail: policyNeedsManualResolution
      ? 'Would stop for manual resolution until the Access app, identity provider, and existing policies are unambiguous.'
      : exactPolicy === undefined ? 'Would create one exact-email One-time PIN allow policy.' : 'Would reuse the exact email-only allow policy.',
  })

  actions.push({ id: 'config', resource: 'config', operation: 'write', target: 'dedicated cloudflared ingress config', detail: `Would route ${target.includeRemote ? '/m and /remote' : '/m only'} and finish with an HTTP 404 catch-all without Host rewriting.` })
  const service = servicePreview(preflight.platform)
  actions.push({ id: 'service', resource: 'service', operation: service.mode === 'launchd-preview' ? 'install' : 'manual', target: service.mode === 'launchd-preview' ? 'dedicated user launchd service' : `${preflight.platform} manual service`, detail: service.summary })

  const publishedPaths: ['/m'] | ['/m', '/remote'] = target.includeRemote ? ['/m', '/remote'] : ['/m']
  const ingress: SetupPlan['ingress'] = {
    rules: [
      { hostname: target.hostname, path: '^/m($|/.*)', service: preflight.dsh.localOrigin, purpose: 'mobile-pairing' },
      ...(target.includeRemote ? [{ hostname: target.hostname, path: '^/remote($|/.*)', service: preflight.dsh.localOrigin, purpose: 'remote-transport-only' as const }] : []),
      { service: 'http_status:404', purpose: 'deny-all-other-paths' },
    ],
    finalCatchAll: 'http_status:404',
  }
  const draft = {
    readOnly: true as const, executionAvailable: false as const, canApply: false as const,
    hostname: target.hostname, publicBaseUrl: `https://${target.hostname}`, localOrigin: preflight.dsh.localOrigin,
    zoneName: inspection.zone.name, tunnelName: target.tunnelName, accessAppName: target.accessAppName,
    includeRemote: target.includeRemote, publishedPaths, preservesExternalHost: true as const,
    cloudflarePermissions: { read: 'verified' as const, write: 'unverified' as const },
    ingress, service, actions, blockers, warnings,
  }
  const inspectionFingerprint = sha256(canonicalJson(inspection))
  const planId = sha256(canonicalJson({ version: 1, draft, inspectionFingerprint, emailHash: target.emailHash }))
  return { planId, ...draft }
}

function servicePreview(platform: NodeJS.Platform): SetupServicePreview {
  if (platform === 'darwin') return {
    mode: 'launchd-preview', platform,
    summary: 'Would install a dedicated per-user launchd service after a future explicit confirmation.',
    steps: [
      { id: 'write-config', detail: 'Write a dedicated cloudflared ingress file.' },
      { id: 'write-plist', detail: 'Write a dedicated user LaunchAgent plist.' },
      { id: 'bootstrap', detail: 'Bootstrap that exact label with launchctl.' },
    ],
  }
  return {
    mode: 'manual-preview', platform,
    summary: platform === 'win32' ? 'Windows remains a structured manual-service path in PR1.' : `${platform} remains a structured manual-service path in PR1.`,
    steps: [
      { id: 'write-config-manually', detail: 'Review and write the generated ingress config manually.' },
      { id: 'install-service-manually', detail: 'Install and operate cloudflared with the platform service manager.' },
      { id: 'verify-manually', detail: 'Verify /m, the optional /remote transport, and the final 404 rule.' },
    ],
  }
}

function defaultTunnelName(hostname: string): string {
  const safe = hostname.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `dsh-remote-${safe}`.slice(0, 64).replace(/[-.]$/, '')
}

function defaultAccessAppName(hostname: string): string { return `DSH Remote - ${hostname}`.slice(0, 128) }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }

/** Deterministic JSON used only for secret-free fingerprints and plan IDs. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
