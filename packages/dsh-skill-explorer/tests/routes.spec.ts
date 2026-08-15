/**
 * Route-layer tests: the loopback fence, list/create/set-enabled/delete
 * dispatch (fake IncomingMessage + ServerResponse, temp skill roots).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ROUTES, makeRoutes } from '../src/routes.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-explorer-routes-'))
const HOME = join(TMP, 'home')
const PROJ = join(TMP, 'proj')
mkdirSync(join(HOME, 'skills'), { recursive: true })
mkdirSync(join(PROJ, '.git'), { recursive: true })
mkdirSync(join(PROJ, '.dsh', 'skills', 'poc-first'), { recursive: true })
mkdirSync(join(HOME, 'skills', 'user-tool'), { recursive: true })
writeFileSync(join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md'), '---\nname: poc-first\ndescription: 快速 POC\n---\n# 正文\n', 'utf8')
writeFileSync(join(HOME, 'skills', 'user-tool', 'SKILL.md'), '---\nname: user-tool\ndescription: 用户级技能\n---\n', 'utf8')

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

const registry = {
  snapshot: async () => ({ skills: [], complete: true }),
}

const deps = {
  dshHome: HOME,
  agentsHome: join(TMP, 'agents'),
  customSkillDirs: [],
  registry,
  activeSessionCwds: () => [PROJ],
  logger: { warn: () => {} },
}

const routes = makeRoutes(deps)
const find = (path: string) => routes.find((route) => route.path === path)

/** One fake IncomingMessage: loopback socket + Host by default. */
function request(url: string, method = 'GET', options: { remoteAddress?: string; host?: string; body?: unknown } = {}): IncomingMessage {
  const req = {
    url,
    method,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? 'localhost:3080',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    async *[Symbol.asyncIterator]() {
      if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
    },
  }
  return req as unknown as IncomingMessage
}

/** One fake ServerResponse capturing status/body. */
function response(): { res: ServerResponse; status: () => number; body: () => string } {
  const state = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { state.status = status },
    end(body: string) { state.body = body },
  } as unknown as ServerResponse
  return { res, status: () => state.status, body: () => state.body }
}

describe('/api/dsh-skill-explorer loopback fence', () => {
  it('rejects non-loopback requests with 403 before touching the service', async () => {
    for (const route of routes) {
      const { res, status } = response()
      await route.handler(request(route.path, 'GET', { remoteAddress: '192.168.1.20' }), res)
      expect(status()).toBe(403)
    }
  })

  it('rejects wrong methods with 405', async () => {
    const { res, status } = response()
    await find(ROUTES.list)!.handler(request(ROUTES.list, 'POST'), res)
    expect(status()).toBe(405)
  })

  it('serves list for loopback clients', async () => {
    const { res, status, body } = response()
    await find(ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.complete).toBe(true)
    const names = payload.groups.flatMap((g: { skills: Array<{ name: string }> }) => g.skills.map((s) => s.name))
    expect(names).toContain('poc-first')
    expect(names).toContain('user-tool')
  })

  it('serves health with a skill count', async () => {
    const { res, status, body } = response()
    await find(ROUTES.health)!.handler(request(ROUTES.health, 'GET'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body()).plugin).toBe('skill-explorer')
    expect(JSON.parse(body()).skills).toBeGreaterThan(0)
  })
})

describe('set-enabled', () => {
  it('disables a skill by rewriting frontmatter', async () => {
    const file = join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md')
    const { res, status, body } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', enabled: false } }), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body()).enabled).toBe(false)
    expect(readFileSync(file, 'utf8')).toContain('disable-model-invocation: true')
    // re-enable to restore the fixture
    const res2 = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', enabled: true } }), res2.res)
    expect(res2.status()).toBe(200)
  })

  it('rejects invalid payloads with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'bad name!', enabled: true } }), res)
    expect(status()).toBe(400)
  })

  it('rejects GET with 405 and never rewrites files', async () => {
    const file = join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md')
    const before = readFileSync(file, 'utf8')
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'GET'), res)
    expect(status()).toBe(405)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('returns 404 for skills without an editable file', async () => {
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'not-exist', enabled: true } }), res)
    expect(status()).toBe(404)
  })
})

describe('create', () => {
  it('creates a skill under the user root', async () => {
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'new-skill', description: '新技能', whenToUse: '测试', content: '正文' } }), res)
    expect(status()).toBe(200)
    const target = join(HOME, 'skills', 'new-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('description: 新技能')
  })

  it('rejects duplicates with 409', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'new-skill', description: 'x', content: 'y' } }), res)
    expect(status()).toBe(409)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'Bad_Name', description: 'x', content: 'y' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects oversized content with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'big-skill', description: 'x', content: 'x'.repeat(64 * 1024 + 1) } }), res)
    expect(status()).toBe(400)
  })
})

describe('delete', () => {
  it('moves a skill into .trash', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'new-skill' } }), res)
    expect(status()).toBe(200)
    expect(existsSync(join(HOME, 'skills', 'new-skill', 'SKILL.md'))).toBe(false)
  })

  it('returns 404 for unknown skills', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'not-exist' } }), res)
    expect(status()).toBe(404)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'Bad Name' } }), res)
    expect(status()).toBe(400)
  })
})

describe('sessions degradation', () => {
  it('still serves list when sessions throw (empty project roots)', async () => {
    const brokenDeps = {
      ...deps,
      activeSessionCwds: () => { throw new Error('sessions boom') },
    }
    const brokenRoutes = makeRoutes(brokenDeps)
    const { res, status, body } = response()
    await brokenRoutes.find((route) => route.path === ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    // The filesystem scan still works; project skills fall back to the process cwd.
    expect(JSON.parse(body()).complete).toBe(true)
  })
})

describe('registry degradation', () => {
  it('still serves list with complete=false when the registry snapshot throws', async () => {
    const brokenRegistry = { snapshot: async () => { throw new Error('registry boom') } }
    const brokenDeps = { ...deps, registry: brokenRegistry }
    const brokenRoutes = makeRoutes(brokenDeps)
    const { res, status, body } = response()
    await brokenRoutes.find((route) => route.path === ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.complete).toBe(false)
    // Filesystem entries still present.
    const names = payload.groups.flatMap((g: { skills: Array<{ name: string }> }) => g.skills.map((s) => s.name))
    expect(names).toContain('poc-first')
  })
})
