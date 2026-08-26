/**
 * v2 route tests: real HTTP server over a fixture skin directory, covering
 * catalog, scoped stylesheet serving, patches/hooks 404s, asset containment,
 * and the active-skin selection roundtrip with the same-origin fence.
 */

import { createHash } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { makeSkinCenterV2Routes, SKIN_CENTER_V2_PREFIX } from '../src/routes-v2.ts'
import { loadSkinCatalog } from '../src/skin-repo.ts'

let root: string
let builtin: string
let statePath: string

function writeFixtureSkin(id: string, options: { patches?: boolean; hooks?: boolean; css?: string } = {}): void {
  const dir = join(builtin, id)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  const manifest: Record<string, unknown> = {
    skinManifestVersion: 2,
    id,
    name: id,
    nameEn: id,
    version: '1.0.0',
    author: 'tester',
    contributes: { stylesheet: 'skin.css' },
  }
  if (options.patches) (manifest.contributes as Record<string, unknown>).patches = 'patches.css'
  if (options.hooks) manifest.facets = { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } }
  writeFileSync(join(dir, 'skin.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'skin.css'), options.css ?? ':root { --dsw-alias-bg-base: #112233; }\n.panel { color: red; }\n')
  if (options.patches) writeFileSync(join(dir, 'patches.css'), '.x { color: blue !important; }\n')
  if (options.hooks) writeFileSync(join(dir, 'hooks.mjs'), 'export default function defineSkinHooks() { return { apply() {} } }\n')
  writeFileSync(join(dir, 'assets', 'bg.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
}

interface TestServer { port: number; close: () => Promise<void> }

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find((r) => (r.kind === 'exact'
      ? r.path === pathname
      : pathname === r.path || pathname.startsWith(`${r.path}/`)))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error == null ? resolveClose() : reject(error)))
    }),
  }
}

async function call(
  port: number,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; jsonBody: any; text: string; headers: Record<string, unknown> }> {
  return await new Promise((resolveCall, reject) => {
    const headers: Record<string, string> = { ...opts.headers }
    let rawBody: string | undefined
    if (opts.body !== undefined) {
      rawBody = JSON.stringify(opts.body)
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(rawBody))
    }
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let jsonBody: any = null
        try { jsonBody = JSON.parse(text) } catch { /* css/js bodies */ }
        resolveCall({ status: res.statusCode ?? 0, jsonBody, text, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (rawBody !== undefined) req.write(rawBody)
    req.end()
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skin-routes-v2-'))
  builtin = join(root, 'builtin')
  mkdirSync(builtin)
  statePath = join(root, 'state', 'active.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeRoutes() {
  return makeSkinCenterV2Routes({
    loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir: join(root, 'user') }),
    activeStatePath: statePath,
    shippedSkinIds: () => new Set(['harbor', 'plain', 'patched', 'hooked', 'evil']),
  })
}

describe('v2 catalog route', () => {
  it('serves the catalog snapshot with manifests and diagnostics', async () => {
    writeFixtureSkin('harbor')
    writeFixtureSkin('broken', { css: 'x' })
    writeFileSync(join(builtin, 'broken', 'skin.json'), '{bad')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/catalog`)
    expect(res.status).toBe(200)
    expect(res.jsonBody.skins).toHaveLength(1)
    expect(res.jsonBody.skins[0].manifest.id).toBe('harbor')
    expect(res.jsonBody.diagnostics).toHaveLength(1)
    await server.close()
  })

  it('writes family JSON headers through the shared writer', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/catalog`)
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toBe('application/json; charset=utf-8')
    expect(String(res.headers['referrer-policy'])).toBe('no-referrer')
    await server.close()
  })
})

describe('v2 catalog installed-only filter', () => {
  it('lists shipped builtins and user skins, hiding catalog-only builtins', async () => {
    writeFixtureSkin('stock')
    writeFixtureSkin('pool')
    const userDir = join(root, 'user')
    mkdirSync(join(userDir, 'hatch'), { recursive: true })
    writeFileSync(join(userDir, 'hatch', 'skin.json'), JSON.stringify({
      skinManifestVersion: 2,
      id: 'hatch',
      name: 'hatch',
      nameEn: 'hatch',
      version: '1.0.0',
      author: 'tester',
      contributes: { stylesheet: 'skin.css' },
    }))
    writeFileSync(join(userDir, 'hatch', 'skin.css'), '.a { color: red; }')
    const routes = makeSkinCenterV2Routes({
      loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir }),
      activeStatePath: statePath,
      shippedSkinIds: () => new Set(['stock']),
    })
    const server = await serve(routes)
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/catalog`)
    expect(res.status).toBe(200)
    expect(res.jsonBody.skins.map((s: { manifest: { id: string } }) => s.manifest.id)).toEqual(['hatch', 'stock'])
    await server.close()
  })
})

describe('v2 stylesheet / patches / hooks routes', () => {
  it('serves the transformed, scoped stylesheet', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/harbor/stylesheet`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/css')
    expect(res.text).toContain('html[data-dsh-skin="harbor"]')
    expect(res.text).toContain('--dsw-alias-bg-base: #112233')
    expect(res.text).not.toContain(':root')
    await server.close()
  })

  it('404s patches when undeclared and serves them when declared', async () => {
    writeFixtureSkin('plain')
    writeFixtureSkin('patched', { patches: true })
    const server = await serve(makeRoutes())
    const missing = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/plain/patches`)
    expect(missing.status).toBe(404)
    const present = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/patched/patches`)
    expect(present.status).toBe(200)
    expect(present.text).toContain('html[data-dsh-skin="patched"] .x')
    await server.close()
  })

  it('serves hooks.mjs verbatim only when the facet is declared', async () => {
    writeFixtureSkin('hooked', { hooks: true })
    writeFixtureSkin('plain')
    const server = await serve(makeRoutes())
    const hooked = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/hooked/hooks.mjs`)
    expect(hooked.status).toBe(200)
    expect(hooked.text).toContain('defineSkinHooks')
    const plain = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/plain/hooks.mjs`)
    expect(plain.status).toBe(404)
    await server.close()
  })

  it('fails closed with 422 on whitelist violations', async () => {
    writeFixtureSkin('evil', { css: '.a { background: url(https://evil.example/x.png); }\n' })
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/evil/stylesheet`)
    expect(res.status).toBe(422)
    expect(res.jsonBody.error).toBe('css-whitelist-violation')
    await server.close()
  })
})

describe('v2 hooks trust gate', () => {
  it('refuses hooks for user-directory skins even when declared', async () => {
    const userDir = join(root, 'user')
    mkdirSync(join(userDir, 'shady'), { recursive: true })
    writeFileSync(join(userDir, 'shady', 'skin.json'), JSON.stringify({
      skinManifestVersion: 2,
      id: 'shady',
      name: 's',
      nameEn: 's',
      version: '1.0.0',
      author: 'ext',
      contributes: { stylesheet: 'skin.css' },
      facets: { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
    }))
    writeFileSync(join(userDir, 'shady', 'skin.css'), '.a { color: red; }')
    writeFileSync(join(userDir, 'shady', 'hooks.mjs'), 'export default () => ({ apply() {} })')
    const routes = makeSkinCenterV2Routes({
      loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir }),
      activeStatePath: statePath,
    })
    const server = await serve(routes)
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/shady/hooks.mjs`)
    expect(res.status).toBe(403)
    expect(res.jsonBody.error).toBe('hooks-require-review')
    // Its declarative parts still load.
    const css = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/shady/stylesheet`)
    expect(css.status).toBe(200)
    await server.close()
  })

  function writeMarketInstalledSkin(id: string): string {
    const dir = join(root, 'user', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'skin.json'), JSON.stringify({
      skinManifestVersion: 2,
      id,
      name: id,
      nameEn: id,
      version: '1.0.0',
      author: 'contributed',
      contributes: { stylesheet: 'skin.css' },
      facets: { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
    }, null, 2))
    writeFileSync(join(dir, 'skin.css'), '.a { color: red; }')
    writeFileSync(join(dir, 'hooks.mjs'), 'export default function defineSkinHooks() { return { apply() {} } }\n')
    const files: Record<string, string> = {}
    for (const rel of ['skin.json', 'skin.css', 'hooks.mjs']) {
      files[rel] = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
    }
    writeFileSync(join(dir, 'dsh-market.provenance.json'), JSON.stringify({
      version: 1,
      source: 'https://dsh-market.com',
      kind: 'skin',
      id,
      installedAt: new Date().toISOString(),
      files,
    }))
    return dir
  }

  it('serves hooks for user skins whose bytes hash-match official-market provenance (issue #1073)', async () => {
    writeMarketInstalledSkin('matrix')
    const routes = makeSkinCenterV2Routes({
      loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir: join(root, 'user') }),
      activeStatePath: statePath,
    })
    const server = await serve(routes)
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/matrix/hooks.mjs`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('defineSkinHooks')
    const catalog = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/catalog`)
    const row = catalog.jsonBody.skins.find((s: any) => s.manifest.id === 'matrix')
    expect(row.warnings.join(' ')).not.toContain('refused')
    await server.close()
  })

  it('serves hooks for an exact reviewed legacy Workshop install without provenance', async () => {
    const userDir = join(root, 'user')
    const reviewed = join(import.meta.dirname, '..', 'skins', 'matrix')
    const dir = join(userDir, 'matrix')
    mkdirSync(dir, { recursive: true })
    for (const rel of ['skin.json', 'skin.css', 'hooks.mjs']) {
      writeFileSync(join(dir, rel), readFileSync(join(reviewed, rel)))
    }
    const routes = makeSkinCenterV2Routes({
      loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir }),
      activeStatePath: statePath,
    })
    const server = await serve(routes)
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/matrix/hooks.mjs`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('mountRain')
    await server.close()
  })

  it('refuses hooks again when the on-disk bytes no longer match the provenance', async () => {
    const dir = writeMarketInstalledSkin('matrix')
    writeFileSync(join(dir, 'hooks.mjs'), 'export default () => ({ apply() {} }) // tampered\n')
    const routes = makeSkinCenterV2Routes({
      loadCatalog: () => loadSkinCatalog({ builtinDir: builtin, userDir: join(root, 'user') }),
      activeStatePath: statePath,
    })
    const server = await serve(routes)
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/matrix/hooks.mjs`)
    expect(res.status).toBe(403)
    expect(res.jsonBody.error).toBe('hooks-require-review')
    await server.close()
  })

  it('re-verifies hook bytes on every serve even when the catalog snapshot is cached', async () => {
    const userDir = join(root, 'user')
    const reviewed = join(import.meta.dirname, '..', 'skins', 'matrix')
    const dir = join(userDir, 'matrix')
    mkdirSync(dir, { recursive: true })
    for (const rel of ['skin.json', 'skin.css', 'hooks.mjs']) {
      writeFileSync(join(dir, rel), readFileSync(join(reviewed, rel)))
    }
    const snapshot = loadSkinCatalog({ builtinDir: builtin, userDir })
    const routes = makeSkinCenterV2Routes({ loadCatalog: () => snapshot, activeStatePath: statePath })
    const server = await serve(routes)
    expect((await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/matrix/hooks.mjs`)).status).toBe(200)

    writeFileSync(join(dir, 'hooks.mjs'), 'export default () => ({ apply() {} }) // tampered after scan\n')
    const refused = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/matrix/hooks.mjs`)
    expect(refused.status).toBe(403)
    expect(refused.jsonBody.error).toBe('hooks-require-review')
    await server.close()
  })
})

describe('v2 asset route', () => {
  it('serves in-directory assets with mime types', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/harbor/assets/bg.png`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    await server.close()
  })

  it('refuses path escapes', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/skins/harbor/assets/..%2f..%2fharbor%2fskin.json`)
    expect([404, 400]).toContain(res.status)
    await server.close()
  })
})

describe('v2 active selection', () => {
  it('roundtrips the active id and rejects unknown skins', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const initial = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(initial.jsonBody.active).toBeNull()
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 'harbor' } })
    expect(set.status).toBe(200)
    const after = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(after.jsonBody.active).toBe('harbor')
    const unknown = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 'nope' } })
    expect(unknown.status).toBe(404)
    const bad = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 5 } })
    expect(bad.status).toBe(400)
    await server.close()
  })

  it('roundtrips background preferences with merge semantics (issue #996)', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    // The v2 state starts without a background section.
    const initial = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(initial.jsonBody.background).toBeNull()
    // A remote client persists background values without naming a skin.
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: 100, backgroundBlurEmpty: 4, backgroundBlurContent: 5 } },
    })
    expect(set.status).toBe(200)
    expect(set.jsonBody.background).toEqual({ backgroundOpacity: 100, backgroundBlurEmpty: 4, backgroundBlurContent: 5 })
    // A skin switch must not wipe the background section, and vice versa.
    const skin = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 'harbor' } })
    expect(skin.status).toBe(200)
    expect(skin.jsonBody.background).toEqual({ backgroundOpacity: 100, backgroundBlurEmpty: 4, backgroundBlurContent: 5 })
    const after = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(after.jsonBody.active).toBe('harbor')
    expect(after.jsonBody.background.backgroundOpacity).toBe(100)
    await server.close()
  })

  it('clamps out-of-range background values and rejects wrongly typed ones', async () => {
    const server = await serve(makeRoutes())
    const clamped = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: 250, backgroundBlurEmpty: -2 } },
    })
    expect(clamped.status).toBe(200)
    expect(clamped.jsonBody.background).toEqual({ backgroundOpacity: 100, backgroundBlurEmpty: 0 })
    const wrongType = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: '100' } },
    })
    expect(wrongType.status).toBe(400)
    expect(wrongType.jsonBody.error).toBe('invalid-background')
    const notObject = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: 5 },
    })
    expect(notObject.status).toBe(400)
    const empty = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: {} })
    expect(empty.status).toBe(400)
    expect(empty.jsonBody.error).toBe('nothing-to-update')
    await server.close()
  })

  it('fences cross-site background writes', async () => {
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: 90 } },
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    await server.close()
  })

  it('fences cross-site writes', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { active: 'harbor' },
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    await server.close()
  })
})
/** Raw-string POST for body-contract cases (call() serializes JSON objects). */
async function postRaw(
  port: number,
  path: string,
  payload: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: Record<string, unknown> = {}
          try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* non-JSON */ }
          resolve({ status: response.statusCode ?? 0, body })
        })
      },
    )
    req.on('error', reject)
    if (payload !== '') req.write(payload)
    req.end()
  })
}

describe('v2 active POST body contract (shared readJsonBody migration)', () => {
  it('answers 400 invalid-body when the POST body is not JSON', async () => {
    const server = await serve(makeRoutes())
    const res = await postRaw(server.port, SKIN_CENTER_V2_PREFIX + '/active', 'not-json')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'invalid-body' })
    await server.close()
  })

  it('answers 400 invalid-body to an empty POST body (was nothing-to-update)', async () => {
    const server = await serve(makeRoutes())
    const res = await postRaw(server.port, SKIN_CENTER_V2_PREFIX + '/active', '')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'invalid-body' })
    await server.close()
  })

  it('destroys the connection on an over-limit body instead of answering JSON', async () => {
    const server = await serve(makeRoutes())
    await expect(
      postRaw(server.port, SKIN_CENTER_V2_PREFIX + '/active', '{"p":"' + 'x'.repeat(16 * 1024) + '"}'),
    ).rejects.toThrow()
    await server.close()
  })
})
