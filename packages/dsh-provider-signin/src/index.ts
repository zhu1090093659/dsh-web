/**
 * dsh-provider-signin host half — relays the authorization flows other
 * plugins registered (llm-pi-ai's ChatGPT, SuperGrok, and every other
 * provider sign-in) to the browser Models settings page over
 * loopback-fenced HTTP routes:
 *
 *   GET  /api/provider-signin/flow?key=…        flow + stored record kind
 *   POST /api/provider-signin/begin             start one attempt
 *   GET  /api/provider-signin/attempt/<id>      attempt snapshot (?since=)
 *   POST /api/provider-signin/attempt/<id>/answer   reply to the pending prompt
 *   POST /api/provider-signin/attempt/<id>/cancel   withdraw the attempt
 *
 * The seam owns the conversation; this half only carries notices and prompts
 * between it and the browser. Only keys under `llm-pi-ai/` are addressable.
 * @module @linxin666/dsh-provider-signin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { mountOnce } from './mount-once.ts'
import { AttemptStore } from './host/attempts.ts'
import {
  makeAttemptRoute, makeBeginRoute, makeFlowRoute,
} from './host/routes.ts'

export const name = 'dsh-provider-signin'

/** Services the relay needs: route registration plus the two seams. */
export const inject = ['webServer', 'authorization', 'credentials']

export const apply = mountOnce('@linxin666/dsh-provider-signin', (ctx: Context): void => {
  const authorization = ctx.authorization
  const credentials = ctx.credentials
  const store = new AttemptStore()

  // The stored credential state for one flow key, secrets excluded: the card
  // needs "is this provider already signed in, and as what kind", never the
  // grant itself.
  const describeRecord = async (key: string): Promise<{ configured: boolean, kind?: 'api-key' | 'grant' } | undefined> => {
    try {
      const info = await credentials.describeRecord(parseCredentialKey(key))
      return { configured: info.configured, ...info.kind === undefined ? {} : { kind: info.kind } }
    } catch {
      return undefined
    }
  }

  const disposers = [
    makeFlowRoute(authorization, describeRecord),
    makeBeginRoute(authorization, store, async (relay, key, method) =>
      authorization.begin({
        key: parseCredentialKey(key),
        ...(method === undefined ? {} : { method }),
        interaction: {
          notify: (notice) => { relay.notify(notice) },
          prompt: (prompt) => relay.prompt(prompt),
        },
        signal: relay.signal,
      })),
    makeAttemptRoute(authorization, store),
  ].map((route) => ctx.webServer.register(route))

  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // The webserver fiber may already be gone during shutdown.
        }
      }
      store.dispose()
    }
  })
})
