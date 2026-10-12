/**
 * Host apply tests: enabled=false registers nothing; enabled registers the
 * route family and disposes cleanly.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** The mountOnce registry key (mirrors shared/host/mount-once.ts) — reset between applies so each case starts fresh. */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

function resetMountOnce(): void {
  ;(globalThis as Record<symbol, unknown>)[MOUNTED] = undefined
}

beforeEach(resetMountOnce)

/** Fake cordis ctx capturing route registrations. */
function fakeCtx() {
  const state = { routes: [] as Array<{ path?: string }>, effects: [] as string[] }
  return {
    ...state,
    webServer: {
      register: (route: { path?: string }) => { state.routes.push(route); return () => {} },
    },
    skills: {
      snapshot: async () => ({ skills: [], complete: true }),
    },
    sessions: {
      list: () => [],
    },
    logger: { warn: () => {} },
    effect: (fn: () => unknown, label: string) => {
      state.effects.push(label)
      const disposer = fn()
      return () => { if (typeof disposer === 'function') (disposer as () => void)() }
    },
  }
}

describe('skill-explorer host apply', () => {
  it('is a no-op for a second mount of the same package (aggregate + standalone coexist)', () => {
    const first = fakeCtx()
    apply(first as never, {})
    expect(first.routes.length).toBe(8)
    const second = fakeCtx()
    apply(second as never, {})
    expect(second.routes.length).toBe(0)
  })

  it('registers nothing when enabled is false', () => {
    const ctx = fakeCtx()
    apply(ctx as never, { enabled: false })
    expect(ctx.routes.length).toBe(0)
  })

  it('registers the eight routes when enabled (default)', () => {
    const ctx = fakeCtx()
    apply(ctx as never, {})
    const paths = ctx.routes.map((route) => route.path)
    expect(paths).toEqual([
      '/api/dsh-skill-explorer/list',
      '/api/dsh-skill-explorer/read',
      '/api/dsh-skill-explorer/set-enabled',
      '/api/dsh-skill-explorer/set-provider-enabled',
      '/api/dsh-skill-explorer/create',
      '/api/dsh-skill-explorer/update',
      '/api/dsh-skill-explorer/delete',
      '/api/dsh-skill-explorer/health',
    ])
  })
})

describe('skill-explorer host apply: provider-row custom roots (#1801)', () => {
  it('operator sees the live skill-filesystem row customSkillDirs reach the list route', async () => {
    // Given a host whose loader carries a skill-filesystem row with a custom
    // root, and a skill file inside that root
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-apply-'))
    const customRoot = join(tmp, 'custom-root')
    const file = join(customRoot, 'apply-skill', 'SKILL.md')
    mkdirSync(join(customRoot, 'apply-skill'), { recursive: true })
    writeFileSync(file, '---\nname: apply-skill\ndescription: 行配置\n---\n', 'utf8')
    try {
      const state = { routes: [] as Array<{ path?: string; handler: (req: unknown, res: unknown) => Promise<void> }> }
      const ctx = {
        webServer: { register: (route: { path?: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { state.routes.push(route); return () => {} } },
        skills: { snapshot: async () => ({ skills: [], complete: true }) },
        sessions: { list: () => [] },
        logger: { warn: () => {} },
        get: (name: string) => name === 'loader'
          ? { entries: () => [{ options: { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { customSkillDirs: [customRoot] } } }] }
          : undefined,
        effect: (fn: () => unknown) => { const d = fn(); return () => { if (typeof d === 'function') (d as () => void)() } },
      }
      resetMountOnce()
      apply(ctx as never, {})

      // When the list route serves the panel
      const list = state.routes.find(route => route.path === '/api/dsh-skill-explorer/list')!
      const captured = { status: 0, body: '' }
      const res = {
        writeHead(status: number) { captured.status = status },
        end(body: string) { captured.body = body },
      }
      const req = {
        url: '/api/dsh-skill-explorer/list',
        method: 'GET',
        socket: { remoteAddress: '127.0.0.1' },
        headers: { host: 'localhost:3080' },
      }
      await list.handler(req, res)

      // Then the row-configured skill is listed with its editable path
      expect(captured.status).toBe(200)
      const payload = JSON.parse(captured.body)
      const custom = payload.groups.find((g: { key: string }) => g.key === 'custom')
      expect(custom.skills[0].name).toBe('apply-skill')
      expect(custom.skills[0].path).toBe(file)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

