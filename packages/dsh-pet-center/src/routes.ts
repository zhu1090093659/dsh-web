/**
 * Pet-center HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints: `state` reports which pet is active, `apply`
 * switches it. Switching writes the user's boot config (the managed pet
 * section of ~/.dsh/cordis.patch.yml), hot-reloaded by the DSH config
 * watcher within seconds — no restart. Unlike pets' behavioral endpoints,
 * `/apply` mutates the boot config, so every route also rejects cross-site
 * requests (Sec-Fetch-Site / Origin fence) — a malicious webpage must not be
 * able to switch the user's pet through a localhost CSRF post.
 * @module @linxin666/dsh-client-ui-pet-center/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { currentPet, usePet, PETS, type PetId } from './pet-switch.ts'

/** Browser-facing base path of the pet-center API. */
export const PET_CENTER_API_PREFIX = '/api/pet-center'

/** One JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Require the method or answer 405. */
function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/**
 * Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch: a
 * `cross-site` fetch is always rejected, and an `Origin` that does not match
 * the request `Host` is rejected. Requests without either header pass — this
 * is a local single-user tool, and the fence only targets the cross-site
 * browser vector.
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/** Reject cross-site requests with 403. */
function requireSameOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isSameOriginRequest(req)) return true
  json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
  return false
}

/** Read a JSON request body (bounded). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** A GET route wrapping one async call, fenced to same-origin requests. */
function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      if (!requireSameOrigin(req, res)) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** A POST JSON route wrapping one async call, fenced to same-origin requests. */
function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      if (!requireSameOrigin(req, res)) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = (typeof body === 'object' && body !== null) ? body as Record<string, unknown> : {}
        return run(record).then(
          (value) => json(res, 200, value),
          (error) => {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/**
 * Build the pet-center route family.
 * @param deps - optional overlay to read/write the patch against a custom
 *   HOME (tests use a throwaway HOME). Defaults to the real user HOME.
 */
export function makePetCenterRoutes(deps: { home?: string; profile?: string } = {}): WebRoute[] {
  const active = (): PetId => currentPet(undefined, deps)
  return [
    getRoute(`${PET_CENTER_API_PREFIX}/state`, async () => ({
      ok: true,
      active: active(),
      pets: PETS.map(pet => pet.id),
    })),
    postRoute(`${PET_CENTER_API_PREFIX}/apply`, async (body) => {
      const pet = body.pet
      if (typeof pet !== 'string' || (pet !== 'pet' && pet !== 'pet-maid')) {
        throw new Error('invalid-pet: pass pet: "pet" or "pet-maid"')
      }
      const out = usePet(pet, deps)
      return {
        ok: true,
        active: active(),
        message: out.trim(),
      }
    }),
  ]
}
