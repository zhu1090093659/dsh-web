/** Loopback-only, read-only HTTP routes for Cloudflare setup planning. */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ZodType } from 'zod'
import { SetupPlanError } from './cloudflare-plan.ts'
import { readBoundedJson, writeJson } from './http.ts'
import { isTrustedLocalControlRequest } from './local-control.ts'
import {
  SETUP_MAX_BODY_BYTES,
  SETUP_PATHS,
  setupPlanRequestSchema,
  type SetupApiError,
  type SetupPlanRequest,
  type SetupPlanResponse,
  type SetupPreflightResponse,
} from './setup-contract.ts'

/** Structural seam between the HTTP control plane and the read-only planner. */
export interface SetupReadService {
  readonly localOrigin: string
  preflight(): Promise<SetupPreflightResponse>
  plan(input: SetupPlanRequest): Promise<SetupPlanResponse>
}

/** Route-family dependencies (also the test seam). */
export interface SetupRoutesDeps {
  service: SetupReadService
}

const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

function writeSetupJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  writeJson(response, status, body, { ...NO_STORE_HEADERS, ...headers })
}

function apiError(error: unknown): { status: number; body: SetupApiError } {
  if (error instanceof SetupPlanError) {
    const status = (() => {
      switch (error.code) {
        case 'bad-payload': return 400
        case 'cloudflare-auth-failed': return 401
        case 'forbidden':
        case 'cloudflare-permission-denied': return 403
        case 'zone-not-found': return 404
        case 'unsupported-platform':
        case 'dsh-not-loopback':
        case 'cloudflared-not-found':
        case 'keychain-unavailable': return 412
        case 'cloudflare-unavailable': return 502
        default: return 500
      }
    })()
    return {
      status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.field === undefined ? {} : { field: error.field }),
        },
      },
    }
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'internal-error',
        message: 'The setup planner failed unexpectedly.',
        retryable: true,
      },
    },
  }
}

function routeError(code: 'forbidden' | 'bad-payload', message: string): SetupApiError {
  return { ok: false, error: { code, message, retryable: false } }
}

async function parseBody<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T | undefined> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') return undefined
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined) {
    const bytes = Number(contentLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > SETUP_MAX_BODY_BYTES) return undefined
  }

  let body: unknown
  try {
    body = await readBoundedJson(request, SETUP_MAX_BODY_BYTES)
  } catch {
    return undefined
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? parsed.data : undefined
}

/** Build the two exact, read-only setup routes. */
export function makeSetupRoutes({ service }: SetupRoutesDeps): WebRoute[] {
  const fence = (request: IncomingMessage, requireOrigin: boolean): boolean => isTrustedLocalControlRequest(request, {
    expectedOrigin: service.localOrigin,
    requireOrigin,
  })

  const requireMethod = (
    request: IncomingMessage,
    response: ServerResponse,
    method: 'GET' | 'POST',
  ): boolean => {
    if (request.method === method) return true
    request.resume()
    writeSetupJson(response, 405, routeError('bad-payload', `Expected ${method}.`), { allow: method })
    return false
  }

  const handlePreflight = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!requireMethod(request, response, 'GET')) return
    if (!fence(request, false)) {
      request.resume()
      writeSetupJson(response, 403, routeError('forbidden', 'Local setup access was refused.'))
      return
    }
    try {
      writeSetupJson(response, 200, await service.preflight())
    } catch (error) {
      const failure = apiError(error)
      writeSetupJson(response, failure.status, failure.body)
    }
  }

  const handlePlan = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!requireMethod(request, response, 'POST')) return
    // Fence before Content-Type, body buffering, schema parsing, or service
    // dispatch so an untrusted request cannot make us inspect its token.
    if (!fence(request, true)) {
      request.resume()
      writeSetupJson(response, 403, routeError('forbidden', 'Local setup access was refused.'))
      return
    }

    const payload = await parseBody(request, setupPlanRequestSchema)
    if (payload === undefined) {
      request.resume()
      writeSetupJson(response, 400, routeError('bad-payload', 'Expected a valid bounded application/json request body.'))
      return
    }
    try {
      writeSetupJson(response, 200, await service.plan(payload))
    } catch (error) {
      const failure = apiError(error)
      writeSetupJson(response, failure.status, failure.body)
    }
  }

  return [
    { kind: 'exact', path: SETUP_PATHS.preflight, handler: handlePreflight },
    { kind: 'exact', path: SETUP_PATHS.plan, handler: handlePlan },
  ]
}
