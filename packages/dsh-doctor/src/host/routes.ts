import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DOCTOR_PROTOCOL_VERSION, type SupervisorRequest } from '../core/protocol.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { SupervisorClient } from './client.ts'
import type { DoctorLifecycle } from './ensure.ts'
import { readJsonBody, writeJson } from './http.ts'

const PREFIX = '/api/doctor'

export interface DoctorRouteOptions {
  /** Version of the host half (package.json), surfaced for console comparisons. */
  hostVersion: string
  /** Lifecycle verbs (service install/uninstall + capsule refresh). */
  lifecycle: DoctorLifecycle
  /** Whether the supervisor state is provisioned; drives the offline error code. */
  provisioned?: () => Promise<boolean>
}

export function makeDoctorRoutes(client: SupervisorClient, profileId: string, options: DoctorRouteOptions): WebRoute[] {
  const guard = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return }
    try { await handler(req, res) } catch (error) { writeJson(res, 500, { ok: false, error: { code: 'DOCTOR_ROUTE_FAILED', message: error instanceof Error ? error.message : String(error) } }, { 'cache-control': 'no-store' }) }
  }
  return [
    {
      kind: 'exact',
      path: PREFIX + '/status',
      handler: guard(async (_req, res) => {
        try {
          const response = await client.status()
          writeJson(res, 200, { ...response, hostVersion: options.hostVersion }, { 'cache-control': 'no-store' })
        } catch (error) {
          const provisioned = options.provisioned === undefined ? true : await options.provisioned().catch(() => false)
          writeJson(res, 503, { ok: false, error: { code: provisioned ? 'SUPERVISOR_DOWN' : 'SUPERVISOR_UNPROVISIONED', message: error instanceof Error ? error.message : String(error) } }, { 'cache-control': 'no-store' })
        }
      }),
    },
    {
      kind: 'exact',
      path: PREFIX + '/action',
      handler: guard(async (req, res) => {
        const value = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
        const allowed: readonly string[] = ['provision', 'exercise', 'diagnose', 'repair', 'confirm', 'rollback', 'pause', 'resume', 'uninstall']
        const action = value.action
        if (typeof action !== 'string' || !allowed.includes(action)) { writeJson(res, 400, { ok: false, error: { code: 'INVALID_ACTION', message: 'Unsupported action' } }, { 'cache-control': 'no-store' }); return }
        // Lifecycle verbs are orchestrated by the host half (service deploy and
        // capsule refresh) instead of relayed to the supervisor: they must work
        // even while the supervisor is absent.
        if (action === 'provision' || action === 'uninstall') {
          const report = action === 'provision' ? await options.lifecycle.ensure() : await options.lifecycle.uninstall()
          if (!report.ok) { writeJson(res, 500, { ok: false, error: { code: report.code, message: report.message } }, { 'cache-control': 'no-store' }); return }
          let snapshot
          try { snapshot = (await client.status()).snapshot } catch { /* supervisor may still be restarting */ }
          writeJson(res, 200, { ok: true, snapshot, hostVersion: options.hostVersion }, { 'cache-control': 'no-store' })
          return
        }
        const request: SupervisorRequest = {
          protocol: DOCTOR_PROTOCOL_VERSION,
          type: 'action',
          action: action as Extract<SupervisorRequest, { type: 'action' }>['action'],
          profileId: typeof value.profileId === 'string' ? value.profileId : profileId,
          incidentId: typeof value.incidentId === 'string' ? value.incidentId : undefined,
        }
        writeJson(res, 200, { ...await client.call(request), hostVersion: options.hostVersion }, { 'cache-control': 'no-store' })
      }),
    },
    {
      kind: 'exact',
      path: PREFIX + '/client-failure',
      handler: guard(async (req, res) => {
        const value = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
        if (typeof value.message !== 'string' || value.message.trim() === '') { writeJson(res, 400, { ok: false, error: { code: 'INVALID_FAILURE', message: 'message is required' } }, { 'cache-control': 'no-store' }); return }
        writeJson(res, 200, await client.call({ protocol: DOCTOR_PROTOCOL_VERSION, type: 'client-failure', profileId, runId: typeof value.runId === 'string' ? value.runId : process.env.DSH_DOCTOR_RUN_ID, at: new Date().toISOString(), message: value.message.slice(0, 4096), stack: typeof value.stack === 'string' ? value.stack.slice(0, 16_384) : undefined, phase: typeof value.phase === 'string' ? value.phase.slice(0, 128) : undefined }), { 'cache-control': 'no-store' })
      }),
    },
  ]
}
