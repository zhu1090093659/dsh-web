/**
 * Browser client for the host /branch/* routes (typed JSON envelopes).
 */
import type {
  ApplyResponse, BranchEnvelope, BranchError, PreviewEntry, WriteTarget,
} from '../core/types.ts'

export type ApiResult<T> = BranchEnvelope<T>

const TRANSPORT_ERROR: BranchError = { code: 'internal', message: 'branch route unavailable' }

async function post<T>(path: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, error: TRANSPORT_ERROR }
  }
  try {
    const envelope = await response.json() as unknown
    if (typeof envelope !== 'object' || envelope === null) return { ok: false, error: TRANSPORT_ERROR }
    const record = envelope as Record<string, unknown>
    if (record.ok === true) return { ok: true, value: record.value as T }
    return { ok: false, error: (record.error as BranchError | undefined) ?? TRANSPORT_ERROR }
  } catch {
    return { ok: false, error: TRANSPORT_ERROR }
  }
}

export class BranchApi {
  preview(cwd: string, writes: readonly WriteTarget[], deletes: readonly string[]): Promise<ApiResult<readonly PreviewEntry[]>> {
    return post('/branch/preview', { cwd, writes, deletes })
  }

  apply(cwd: string, writes: readonly WriteTarget[], deletes: readonly string[]): Promise<ApiResult<ApplyResponse>> {
    return post('/branch/apply', { cwd, writes, deletes })
  }
}
