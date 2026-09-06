/**
 * Same-origin client for the sign-in relay. Every method resolves; transport
 * failures become typed results the card renders as a banner.
 * @module @linxin666/dsh-provider-signin/client/api
 */

import type { AttemptView, FlowView, RecordView } from '../core/types.ts'

/** Hard ceiling for one relay call; a stalled host must not pile up requests. */
const FETCH_TIMEOUT_MS = 15_000

/** Result of one relay call: never a rejected promise. */
export type ApiResult<T> = { ok: true, value: T } | { ok: false, error: string }

async function call<T>(path: string, init?: { method?: 'POST', body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init?.method === 'POST' ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(init.body ?? {}),
      } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const json = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${String(response.status)}` }
    return { ok: true, value: json as T }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'transport failure' }
  }
}

/** The flow + record state for one provider route key. */
export interface FlowState {
  flow: FlowView | undefined
  record: RecordView | undefined
}

/** Browser-facing relay API. */
export interface SigninApi {
  flow(key: string): Promise<ApiResult<FlowState>>
  begin(key: string, method?: string): Promise<ApiResult<{ attemptId: string }>>
  attempt(id: string, since: number): Promise<ApiResult<AttemptView>>
  answer(id: string, pendingId: string, value: string): Promise<ApiResult<{ ok: true }>>
  cancel(id: string): Promise<ApiResult<{ ok: true }>>
}

export function createSigninApi(): SigninApi {
  return {
    flow: key => call<FlowState>(`/api/provider-signin/flow?key=${encodeURIComponent(key)}`),
    begin: (key, method) => call<{ attemptId: string }>('/api/provider-signin/begin', {
      method: 'POST',
      body: { key, ...(method === undefined ? {} : { method }) },
    }),
    attempt: (id, since) => call<AttemptView>(`/api/provider-signin/attempt/${id}?since=${String(since)}`),
    answer: (id, pendingId, value) => call<{ ok: true }>(`/api/provider-signin/attempt/${id}/answer`, {
      method: 'POST',
      body: { pendingId, value },
    }),
    cancel: id => call<{ ok: true }>(`/api/provider-signin/attempt/${id}/cancel`, { method: 'POST' }),
  }
}
