import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isUsageAllowed } from './access.ts'
import { writeJson } from './http.ts'
import { isLedgerDateKey } from '../core/ledger.ts'
import type { UsageDayResponse } from '../core/types.ts'
import type { UsageService } from './usage-service.ts'

export const USAGE_API_PREFIX = '/api/dsh-usage'

type AuthAwareWebRoute = WebRoute & { readonly auth?: 'anonymous' | 'required' | 'deny' }

/**
 * Overview route: provider balances, plan quotas, and token usage totals.
 * Personal account data behind the family trust fence — loopback always
 * passes, and a live paired-device cookie passes too when remote-web-ui is
 * loaded (issue #1592: the sidebar usage panel reads this from a paired LAN
 * browser); every unpaired LAN request keeps its 403.
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param service - the usage service.
 * @returns the route.
 */
export function makeUsageOverviewRoute(ctx: Context, service: UsageService): WebRoute {
  const route: AuthAwareWebRoute = {
    kind: 'exact',
    path: USAGE_API_PREFIX + '/overview',
    // Self-fenced by isUsageAllowed (loopback or live remote-web-ui paired device).
    auth: 'anonymous',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isUsageAllowed(ctx, req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        return
      }
      writeJson(res, 200, service.overview(), { 'cache-control': 'no-store' })
    },
  }
  return route
}

/**
 * One retained day route: `GET /api/dsh-usage/day?date=YYYY-MM-DD` answers
 * that local day's per-provider and per-model totals, so the section's day
 * pickers can show a past day instead of only today. Same trust fence as the
 * overview route, and a key that is not a real local date is refused with 400
 * rather than folded into a bogus day.
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param service - the usage service.
 * @returns the route.
 */
export function makeUsageDayRoute(ctx: Context, service: UsageService): WebRoute {
  const route: AuthAwareWebRoute = {
    kind: 'exact',
    path: USAGE_API_PREFIX + '/day',
    auth: 'anonymous',
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!isUsageAllowed(ctx, req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        return
      }
      const date = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('date') ?? ''
      if (!isLedgerDateKey(date)) {
        writeJson(res, 400, { ok: false, error: 'date must be YYYY-MM-DD' })
        return
      }
      writeJson(res, 200, { ok: true, day: service.day(date) } satisfies UsageDayResponse, { 'cache-control': 'no-store' })
    },
  }
  return route
}

/**
 * Manual refresh: forces one probe cycle now and answers with the fresh
 * overview. Same trust fence as the overview route.
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param service - the usage service.
 * @returns the route.
 */
export function makeUsageRefreshRoute(ctx: Context, service: UsageService): WebRoute {
  const route: AuthAwareWebRoute = {
    kind: 'exact',
    path: USAGE_API_PREFIX + '/refresh',
    auth: 'anonymous',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isUsageAllowed(ctx, req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        await service.refresh()
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'refresh failed' })
        return
      }
      writeJson(res, 200, service.overview(), { 'cache-control': 'no-store' })
    },
  }
  return route
}
