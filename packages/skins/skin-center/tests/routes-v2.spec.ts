/**
 * v2 route tests: real HTTP server over a fixture skin directory, covering
 * catalog, scoped stylesheet serving, patches/hooks 404s, asset containment,
 * and the active-skin selection roundtrip with the same-origin fence.
 */

import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  const BACKGROUND = {
    enabled: true,
    backgroundOpacity: 100,
    backgroundBlurEmpty: 4,
    backgroundBlurContent: 5,
    inputCardBlur: 10,
    bubbleOpacity: 50,
  }

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

  it('GET returns the background section and POST persists it', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const initial = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(initial.jsonBody).toMatchObject({ ok: true, active: null, background: null })
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: BACKGROUND } })
    expect(set.status).toBe(200)
    expect(set.jsonBody).toMatchObject({ ok: true, active: null, background: BACKGROUND })
    const after = await call(server.port, 'GET', `${SKIN_CENTER_V2_PREFIX}/active`)
    expect(after.jsonBody.background).toEqual(BACKGROUND)
    await server.close()
  })

  it('POST with only background preserves the active id (merge)', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 'harbor' } })
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: BACKGROUND } })
    expect(set.status).toBe(200)
    expect(set.jsonBody.active).toBe('harbor')
    await server.close()
  })

  it('POST with only active preserves the background (merge)', async () => {
    writeFixtureSkin('harbor')
    writeFixtureSkin('whale-song')
    const server = await serve(makeRoutes())
    await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: BACKGROUND } })
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { active: 'whale-song' } })
    expect(set.status).toBe(200)
    expect(set.jsonBody).toMatchObject({ ok: true, active: 'whale-song', background: BACKGROUND })
    await server.close()
  })

  it('POST with both fields updates the whole document', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const set = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { active: 'harbor', background: BACKGROUND },
    })
    expect(set.status).toBe(200)
    expect(set.jsonBody).toMatchObject({ ok: true, active: 'harbor', background: BACKGROUND })
    await server.close()
  })

  it('POST with explicit background null clears the stored background', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: BACKGROUND } })
    const clear = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: null } })
    expect(clear.status).toBe(200)
    expect(clear.jsonBody.background).toBeNull()
    await server.close()
  })

  it('rejects an invalid background with 400 and clamps out-of-range numbers', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const badType = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: 'x' } },
    })
    expect(badType.status).toBe(400)
    expect(badType.jsonBody.error).toBe('invalid-background')
    const badShape = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: { background: 'nope' } })
    expect(badShape.status).toBe(400)
    expect(badShape.jsonBody.error).toBe('invalid-background')
    const clamped = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { background: { backgroundOpacity: 250, backgroundBlurEmpty: 99 } },
    })
    expect(clamped.status).toBe(200)
    expect(clamped.jsonBody.background).toMatchObject({ backgroundOpacity: 100, backgroundBlurEmpty: 20 })
    await server.close()
  })

  it('rejects a body with neither active nor background', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const empty = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, { body: {} })
    expect(empty.status).toBe(400)
    expect(empty.jsonBody.error).toBe('invalid-body')
    await server.close()
  })

  it('fences cross-site writes', async () => {
    writeFixtureSkin('harbor')
    const server = await serve(makeRoutes())
    const res = await call(server.port, 'POST', `${SKIN_CENTER_V2_PREFIX}/active`, {
      body: { active: 'harbor', background: BACKGROUND },
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    await server.close()
  })
})
