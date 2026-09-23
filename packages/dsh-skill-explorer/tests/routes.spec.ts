/**
 * Route-layer tests: the trust fence (loopback + live pairing), list/create/
 * set-enabled/delete dispatch (fake IncomingMessage + ServerResponse, temp
 * skill roots).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ROUTES, makeRoutes } from '../src/routes.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-explorer-routes-'))
const HOME = join(TMP, 'home')
const PROJ = join(TMP, 'proj')
const PROJECT_SKILL = join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md')
const USER_SKILL = join(HOME, 'skills', 'user-tool', 'SKILL.md')
mkdirSync(join(HOME, 'skills'), { recursive: true })
mkdirSync(join(PROJ, '.git'), { recursive: true })
mkdirSync(join(PROJ, '.dsh', 'skills', 'poc-first'), { recursive: true })
mkdirSync(join(HOME, 'skills', 'user-tool'), { recursive: true })
writeFileSync(PROJECT_SKILL, '---\nname: poc-first\ndescription: 快速 POC\n---\n# 正文\n', 'utf8')
writeFileSync(USER_SKILL, '---\nname: user-tool\ndescription: 用户级技能\n---\n', 'utf8')

// Symlink support is environment-dependent (Windows needs Developer Mode,
// some sandboxed Linux runners disallow it) — probe once and skip linked cases.
let CAN_SYMLINK = false
try {
  mkdirSync(join(TMP, 'probe', 'target'), { recursive: true })
  symlinkSync(join(TMP, 'probe', 'target'), join(TMP, 'probe', 'linked'), 'dir')
  CAN_SYMLINK = true
} catch {
  CAN_SYMLINK = false
}

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

const emptyCtx = {} as never
const routes = makeRoutes(emptyCtx, deps)
const find = (path: string) => routes.find((route) => route.path === path)

/** One fake IncomingMessage: loopback socket + Host by default. */
function request(url: string, method = 'GET', options: { remoteAddress?: string; host?: string; cookie?: string; body?: unknown } = {}): IncomingMessage {
  const req = {
    url,
    method,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? 'localhost:3080',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
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

/** Isolated project/user pair with the same skill name for stale identity tests. */
function staleIdentityFixture(): {
  root: string
  projectFile: string
  userFile: string
  find(path: string): ReturnType<typeof makeRoutes>[number] | undefined
} {
  const root = mkdtempSync(join(tmpdir(), 'skill-explorer-stale-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  const projectFile = join(project, '.dsh', 'skills', 'shared-skill', 'SKILL.md')
  const userFile = join(home, 'skills', 'shared-skill', 'SKILL.md')
  mkdirSync(join(project, '.git'), { recursive: true })
  mkdirSync(join(project, '.dsh', 'skills', 'shared-skill'), { recursive: true })
  mkdirSync(join(home, 'skills', 'shared-skill'), { recursive: true })
  writeFileSync(projectFile, '---\nname: shared-skill\ndescription: project copy\n---\n', 'utf8')
  writeFileSync(userFile, '---\nname: shared-skill\ndescription: user copy\n---\n', 'utf8')
  const isolatedRoutes = makeRoutes(emptyCtx, {
    ...deps,
    dshHome: home,
    agentsHome: join(root, 'agents'),
    activeSessionCwds: () => [project],
  })
  return {
    root,
    projectFile,
    userFile,
    find: path => isolatedRoutes.find(route => route.path === path),
  }
}

describe('/api/dsh-skill-explorer trust fence', () => {
  it('rejects non-loopback requests with 403 before touching the service', async () => {
    for (const route of routes) {
      const { res, status, body } = response()
      await route.handler(request(route.path, 'GET', { remoteAddress: '192.168.1.20' }), res)
      expect(status()).toBe(403)
      expect(JSON.parse(body())).toEqual({ error: 'forbidden: loopback-only' })
    }
  })

  it('allows a non-loopback client when pairing reports a live device', async () => {
    const isPairedDevice = vi.fn(() => true)
    const ctx = { get: () => ({ isPairedDevice }) }
    const pairedRoutes = makeRoutes(ctx as never, deps)
    const list = pairedRoutes.find((route) => route.path === ROUTES.list)!
    const { res, status } = response()
    await list.handler(request(ROUTES.list, 'GET', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
    }), res)
    expect(status()).toBe(200)
    expect(isPairedDevice).toHaveBeenCalled()
  })

  it('allows a non-loopback write when pairing reports a live device', async () => {
    const ctx = { get: () => ({ isPairedDevice: () => true }) }
    const pairedRoutes = makeRoutes(ctx as never, deps)
    const setEnabled = pairedRoutes.find((route) => route.path === ROUTES.setEnabled)!
    const { res, status } = response()
    await setEnabled.handler(request(ROUTES.setEnabled, 'POST', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
      body: { name: 'poc-first', path: PROJECT_SKILL, enabled: true },
    }), res)
    expect(status()).toBe(200)
  })

  it('still rejects a non-loopback client when pairing reports false', async () => {
    const ctx = { get: () => ({ isPairedDevice: () => false }) }
    const revokedRoutes = makeRoutes(ctx as never, deps)
    for (const route of revokedRoutes) {
      const { res, status, body } = response()
      await route.handler(request(route.path, 'GET', {
        remoteAddress: '192.168.1.20',
        host: 'dsh.example:443',
        cookie: 'dsh_pair=revoked',
      }), res)
      expect(status()).toBe(403)
      expect(JSON.parse(body())).toEqual({ error: 'forbidden: loopback-only' })
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

  it('uses activeSessionCwds when no explicit cwd query param is provided (#1139)', async () => {
    const activeCwd = '/virtual/active-project'
    const snapshotFn = vi.fn().mockResolvedValue({ skills: [{ name: 'project-skill', description: 'desc', source: 'other:project-config' }], complete: true })
    const activeRoutes = makeRoutes(emptyCtx, {
      ...deps,
      activeSessionCwds: () => [activeCwd],
      registry: { snapshot: snapshotFn },
    })
    const list = activeRoutes.find((r) => r.path === ROUTES.list)!
    const { res, status, body } = response()
    await list.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.cwd).toBe(activeCwd)
    expect(snapshotFn).toHaveBeenCalledWith(expect.objectContaining({ cwd: activeCwd }))
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
    const file = PROJECT_SKILL
    const { res, status, body } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', path: file, enabled: false } }), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body()).enabled).toBe(false)
    expect(readFileSync(file, 'utf8')).toContain('disable-model-invocation: true')
    // re-enable to restore the fixture
    const res2 = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', path: file, enabled: true } }), res2.res)
    expect(res2.status()).toBe(200)
  })

  it('rejects invalid payloads with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'bad name!', path: PROJECT_SKILL, enabled: true } }), res)
    expect(status()).toBe(400)
  })

  it('requires the displayed file path', async () => {
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', enabled: true } }), res)
    expect(status()).toBe(400)
  })

  it('rejects GET with 405 and never rewrites files', async () => {
    const file = PROJECT_SKILL
    const before = readFileSync(file, 'utf8')
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'GET'), res)
    expect(status()).toBe(405)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('returns 404 for skills without an editable file', async () => {
    const { res, status } = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'not-exist', path: join(TMP, 'missing', 'SKILL.md'), enabled: true } }), res)
    expect(status()).toBe(404)
  })

  it('does not rewrite a same-name fallback when the displayed file disappears', async () => {
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })
      const before = readFileSync(fixture.userFile, 'utf8')
      const { res, status, body } = response()
      await fixture.find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile, enabled: false },
      }), res)
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(readFileSync(fixture.userFile, 'utf8')).toBe(before)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('create', () => {
  it('creates a skill under the user root', async () => {
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'new-skill', description: '新技能', whenToUse: '测试', content: '正文', cwd: PROJ } }), res)
    expect(status()).toBe(200)
    const target = join(HOME, 'skills', 'new-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain("description: '新技能'")
  })

  it('creates a skill under the project root derived from cwd', async () => {
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'project', name: 'proj-skill', description: '项目技能', content: '正文', cwd: join(PROJ, 'nested', 'dir') } }), res)
    expect(status()).toBe(200)
    const target = join(PROJ, '.dsh', 'skills', 'proj-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(existsSync(target)).toBe(true)
  })

  it('rejects a missing cwd with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'project', name: 'no-cwd-skill', description: 'x', content: 'y' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects duplicates with 409', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'new-skill', description: 'x', content: 'y', cwd: PROJ } }), res)
    expect(status()).toBe(409)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'Bad_Name', description: 'x', content: 'y', cwd: PROJ } }), res)
    expect(status()).toBe(400)
  })

  it('rejects oversized content with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { root: 'user', name: 'big-skill', description: 'x', content: 'x'.repeat(64 * 1024 + 1), cwd: PROJ } }), res)
    expect(status()).toBe(400)
  })
})

describe('delete', () => {
  it('moves a skill into .trash', async () => {
    const { res, status } = response()
    const path = join(HOME, 'skills', 'new-skill', 'SKILL.md')
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'new-skill', path } }), res)
    expect(status()).toBe(200)
    expect(existsSync(join(HOME, 'skills', 'new-skill', 'SKILL.md'))).toBe(false)
  })

  it('refuses to delete a linked skill (target is left in place)', async () => {
    if (!CAN_SYMLINK) return
    const shared = join(TMP, 'shared', 'linked-skill')
    mkdirSync(shared, { recursive: true })
    writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-skill\ndescription: 链接技能\n---\n', 'utf8')
    symlinkSync(shared, join(HOME, 'skills', 'linked-skill'), 'dir')
    try {
      const { res, status } = response()
      await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'linked-skill', path: join(HOME, 'skills', 'linked-skill', 'SKILL.md') } }), res)
      expect(status()).toBe(400)
      expect(existsSync(join(shared, 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(join(HOME, 'skills', 'linked-skill'), { recursive: true, force: true })
      rmSync(shared, { recursive: true, force: true })
    }
  })

  it('returns 404 for unknown skills', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'not-exist', path: join(TMP, 'missing', 'SKILL.md') } }), res)
    expect(status()).toBe(404)
  })

  it('requires the displayed file path', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'user-tool' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'Bad Name', path: USER_SKILL } }), res)
    expect(status()).toBe(400)
  })

  it('does not delete a same-name fallback when the displayed file disappears', async () => {
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })
      const { res, status, body } = response()
      await fixture.find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile },
      }), res)
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(existsSync(fixture.userFile)).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

/** Isolated user-root skill for the read/update routes. */
function editFixture(name = 'edit-target'): {
  root: string
  file: string
  find(path: string): ReturnType<typeof makeRoutes>[number] | undefined
} {
  const root = mkdtempSync(join(tmpdir(), 'skill-explorer-edit-'))
  const home = join(root, 'home')
  const file = join(home, 'skills', name, 'SKILL.md')
  mkdirSync(join(home, 'skills', name), { recursive: true })
  writeFileSync(file, `---\nname: ${name}\ndescription: 原始描述\nwhenToUse: 原始场景\ndisable-model-invocation: true\n---\n\n# 原始正文\n`, 'utf8')
  const isolatedRoutes = makeRoutes(emptyCtx, { ...deps, dshHome: home, agentsHome: join(root, 'agents') })
  return { root, file, find: path => isolatedRoutes.find(route => route.path === path) }
}

describe('read', () => {
  it('user reading a skill gets the editable fields and the body without frontmatter', async () => {
    // Given a skill whose file carries frontmatter and a body
    const fixture = editFixture()
    try {
      // When the client reads it through the read route
      const { res, status, body } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(fixture.file)}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'GET'), res)

      // Then the editable fields come back parsed and the body comes back bare
      expect(status()).toBe(200)
      expect(JSON.parse(body())).toEqual({
        name: 'edit-target',
        path: fixture.file,
        description: '原始描述',
        whenToUse: '原始场景',
        content: '# 原始正文',
      })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user reading a path the fresh scan does not resolve gets 409', async () => {
    // Given a skill file that has moved away since the panel rendered
    const fixture = editFixture()
    try {
      // When the read route is asked for the stale path
      const { res, status } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(join(fixture.root, 'elsewhere', 'SKILL.md'))}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'GET'), res)

      // Then the stale identity is refused instead of served
      expect(status()).toBe(409)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user omitting name and path gets 400', async () => {
    // Given a read request without the identity query parameters
    const { res, status } = response()

    // When the read route handles it
    await find(ROUTES.read)!.handler(request(ROUTES.read, 'GET'), res)

    // Then the request is rejected as invalid
    expect(status()).toBe(400)
  })

  it('user posting to the read route gets 405', async () => {
    // Given a read route hit with a write method
    const fixture = editFixture()
    try {
      // When a POST is sent to it
      const { res, status } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(fixture.file)}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'POST'), res)

      // Then the method is refused
      expect(status()).toBe(405)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('update', () => {
  it('user editing a disabled skill rewrites the file and keeps it disabled', async () => {
    // Given a skill file whose frontmatter carries the disabled switch
    const fixture = editFixture()
    try {
      // When the client saves new fields through the update route
      const { res, status, body } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'edit-target', path: fixture.file, description: '新描述', whenToUse: '新场景', content: '# 新正文' },
      }), res)

      // Then the file is rewritten in place and the switch state is preserved
      expect(status()).toBe(200)
      expect(JSON.parse(body())).toEqual({ ok: true, name: 'edit-target', path: fixture.file, disabled: true })
      const written = readFileSync(fixture.file, 'utf8')
      expect(written).toContain("description: '新描述'")
      expect(written).toContain('whenToUse: ' + "'" + '新场景' + "'")
      expect(written).toContain('# 新正文')
      // The edit form does not expose the switch: a disabled skill stays disabled.
      expect(written).toContain('disable-model-invocation: true')
      expect(existsSync(join(fixture.root, 'home', 'skills', 'edit-target', 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user editing a linked skill gets 400 and the link target stays untouched', async () => {
    if (!CAN_SYMLINK) return
    // Given a skill directory that is a symlink to a shared target
    const root = mkdtempSync(join(tmpdir(), 'skill-explorer-linked-edit-'))
    const home = join(root, 'home')
    const shared = join(root, 'shared', 'linked-edit')
    mkdirSync(shared, { recursive: true })
    mkdirSync(join(home, 'skills'), { recursive: true })
    writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-edit\ndescription: 链接技能\n---\n', 'utf8')
    symlinkSync(shared, join(home, 'skills', 'linked-edit'), 'dir')
    try {
      const isolatedRoutes = makeRoutes(emptyCtx, { ...deps, dshHome: home, agentsHome: join(root, 'agents') })

      // When the client edits it through the update route
      const { res, status } = response()
      await isolatedRoutes.find(route => route.path === ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'linked-edit', path: join(home, 'skills', 'linked-edit', 'SKILL.md'), description: '改', content: '改' },
      }), res)

      // Then the edit is refused and the shared target keeps its content
      expect(status()).toBe(400)
      expect(readFileSync(join(shared, 'SKILL.md'), 'utf8')).toContain('链接技能')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('user editing without the displayed file path gets 400', async () => {
    // Given an update request that carries a name but no path
    const { res, status } = response()

    // When the update route handles it
    await find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', { body: { name: 'user-tool', description: '改', content: '改' } }), res)

    // Then the missing identity is rejected
    expect(status()).toBe(400)
  })

  it('user saving whitespace-only content gets 400', async () => {
    // Given an edit whose body is only whitespace
    const fixture = editFixture()
    try {
      // When the update route handles it
      const { res, status } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'edit-target', path: fixture.file, description: '改', content: '   ' },
      }), res)

      // Then the empty content is rejected
      expect(status()).toBe(400)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user saving an edit whose displayed file disappeared gets 409 without a fallback rewrite', async () => {
    // Given a skill whose displayed project file disappears after the panel rendered
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })

      // When the update route handles the stale path
      const { res, status, body } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile, description: '改', content: '改' },
      }), res)

      // Then the same-name fallback is refused and the user copy keeps its content
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(readFileSync(fixture.userFile, 'utf8')).toContain('user copy')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('sessions degradation', () => {
  it('still serves list when sessions throw (empty project roots)', async () => {
    const brokenDeps = {
      ...deps,
      activeSessionCwds: () => { throw new Error('sessions boom') },
    }
    const brokenRoutes = makeRoutes(emptyCtx, brokenDeps)
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
    const brokenRoutes = makeRoutes(emptyCtx, brokenDeps)
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
