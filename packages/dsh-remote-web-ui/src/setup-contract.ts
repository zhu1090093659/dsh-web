/**
 * Wire contract for the loopback-only HTTPS setup preflight and plan.
 *
 * PR1 is deliberately read-only: credentials exist only in plan requests,
 * while every response describes inspection results and a preview that cannot
 * be executed. Apply, rollback, persistence, and mutation contracts do not
 * belong in this module.
 */

import { z } from 'zod'

/** Exact local control-plane endpoints. Neither endpoint is public ingress. */
export const SETUP_PATHS = {
  preflight: '/api/remote-setup/preflight',
  plan: '/api/remote-setup/plan',
} as const

/** Tokens may be long, but the complete strict request remains small. */
export const SETUP_MAX_BODY_BYTES = 16 * 1024

const hostnameSchema = z.string().trim().toLowerCase().min(4).max(253).superRefine((value, context) => {
  const reservedSuffixes = new Set(['local', 'localhost', 'localdomain', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion'])
  if (!value.includes('.') || value.endsWith('.') || value === 'localhost') {
    context.addIssue({ code: 'custom', message: 'expected a complete public hostname' })
    return
  }
  const labels = value.split('.')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || reservedSuffixes.has(labels.at(-1) ?? '')) {
    context.addIssue({ code: 'custom', message: 'expected a public DNS hostname, not an IP or local name' })
    return
  }
  if (labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    context.addIssue({ code: 'custom', message: 'expected an ASCII DNS hostname' })
  }
})

const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email()
const tokenSchema = z.string().min(20).max(4096).regex(/^\S+$/, 'token must not contain whitespace')
const configuredNameSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]*$/)
const tunnelNameSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/)
const accessAppNameSchema = z.string().trim().min(1).max(128)
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'access app name must not contain control characters')

export const setupCredentialSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('request'), token: tokenSchema }).strict(),
  z.object({ source: z.literal('keychain'), service: configuredNameSchema, account: configuredNameSchema.optional() }).strict(),
])

/** Strict request for one read-only Cloudflare inspection and pure plan. */
export const setupPlanRequestSchema = z.object({
  hostname: hostnameSchema,
  email: emailSchema,
  credential: setupCredentialSchema,
  tunnelName: tunnelNameSchema.optional(),
  accessAppName: accessAppNameSchema.optional(),
  /** `/m` is always planned; `/remote` is an explicit transport-only opt-in. */
  includeRemote: z.boolean().default(false),
}).strict()

export type SetupCredential = z.infer<typeof setupCredentialSchema>
export type SetupPlanRequest = z.infer<typeof setupPlanRequestSchema>

export type SetupErrorCode =
  | 'forbidden'
  | 'bad-payload'
  | 'unsupported-platform'
  | 'dsh-not-loopback'
  | 'cloudflared-not-found'
  | 'cloudflare-auth-failed'
  | 'cloudflare-permission-denied'
  | 'cloudflare-unavailable'
  | 'keychain-unavailable'
  | 'zone-not-found'
  | 'internal-error'

export type SetupErrorField =
  | 'hostname'
  | 'email'
  | 'credential'
  | 'tunnelName'
  | 'accessAppName'
  | 'includeRemote'

export interface SetupApiError {
  ok: false
  error: {
    code: SetupErrorCode
    message: string
    retryable: boolean
    field?: SetupErrorField
  }
}

export interface SetupPreflightResponse {
  ok: true
  readOnly: true
  executionAvailable: false
  preflight: {
    platform: NodeJS.Platform
    dsh: {
      host: string
      port: number
      localOrigin: string
      loopbackOnly: boolean
    }
    cloudflared: {
      found: boolean
      version?: string
    }
    serviceMode: 'launchd-preview' | 'manual-preview'
    autoTunnelEnabled: boolean
    configuredPublicBaseUrl?: string
  }
}

export type SetupResourceKind =
  | 'tunnel'
  | 'dns'
  | 'otp-idp'
  | 'access-app'
  | 'access-policy'
  | 'credentials'
  | 'config'
  | 'service'

export type SetupPlanOperation = 'create' | 'reuse' | 'write' | 'install' | 'manual'

/** One non-secret preview line. It cannot be submitted for execution in PR1. */
export interface SetupPlanAction {
  id: string
  resource: SetupResourceKind
  operation: SetupPlanOperation
  target: string
  detail: string
}

export type SetupBlockerCode =
  | 'execution-unavailable'
  | 'mobile-ingress-not-ready'
  | 'dsh-not-loopback'
  | 'cloudflared-not-found'
  | 'auto-tunnel-active'
  | 'zone-apex-not-supported'
  | 'resource-conflict'
  | 'remote-transport-only'

export interface SetupBlocker {
  code: SetupBlockerCode
  message: string
}

export interface SetupIngressRulePreview {
  hostname?: string
  path?: string
  service: string
  purpose: 'mobile-pairing' | 'remote-transport-only' | 'deny-all-other-paths'
}

export interface SetupServicePreview {
  mode: 'launchd-preview' | 'manual-preview'
  platform: NodeJS.Platform
  summary: string
  steps: Array<{ id: string; detail: string }>
}

export interface SetupPlan {
  planId: string
  readOnly: true
  executionAvailable: false
  canApply: false
  hostname: string
  publicBaseUrl: string
  localOrigin: string
  zoneName: string
  tunnelName: string
  accessAppName: string
  includeRemote: boolean
  publishedPaths: ['/m'] | ['/m', '/remote']
  preservesExternalHost: true
  cloudflarePermissions: {
    read: 'verified'
    write: 'unverified'
  }
  ingress: {
    rules: SetupIngressRulePreview[]
    finalCatchAll: 'http_status:404'
  }
  service: SetupServicePreview
  actions: SetupPlanAction[]
  blockers: SetupBlocker[]
  warnings: string[]
}

export interface SetupPlanResponse {
  ok: true
  readOnly: true
  executionAvailable: false
  plan: SetupPlan
}

export type SetupPreflightApiResponse = SetupPreflightResponse | SetupApiError
export type SetupPlanApiResponse = SetupPlanResponse | SetupApiError
