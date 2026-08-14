/**
 * Host-half integration tests for dsh-taskboard-agent.
 *
 * Exercises the plugin through a minimal mock ctx (the same surface the
 * standalone verification script used): tool registration with the host
 * schema validator, the mutation queue, GET /pending / POST /sync, file
 * persistence, list filtering and update/delete known flags.
 *
 * 17 assertions total — keep the count in sync with README.md /
 * README.zh.md when extending this suite.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

const BOARD_FILE = join(tmpdir(), `dsh-taskboard-agent-test-${process.pid}.json`)

/** Minimal ctx surface: captures tool registrations, prompt sections and routes. */
function makeHarness() {
  const registrations: any[] = []
  const sections: any[] = []
  const routes: any[] = []
  const captured: Record<string, (arg: any) => void> = {}
  const ctx: any = {
    inject(services: string[], cb: (arg: any) => void) {
      for (const s of services) captured[s] = cb
      return () => {}
    },
    webServer: {
      register(route: any) {
        routes.push(route)
        return () => {}
      },
    },
  }
  apply(ctx, { filePath: BOARD_FILE })
  captured.tools({ tools: { register(def: any) { registrations.push(def); return () => {} } } })
  captured.systemPrompt({ systemPrompt: { section(s: any) { sections.push(s) } } })
  return { registrations, sections, routes }
}

const byName = (regs: any[], name: string) => regs.find((d: any) => d.name === name)
const routeByPath = (routes: any[], path: string) => routes.find((r: any) => r.path === path)

function mockGet(route: any, url: string) {
  const res: any = {
    writeHead(code: number) {
      this.code = code
    },
    end(body: string) {
      this.body = body
    },
  }
  route.handler({ method: 'GET', url }, res)
  return { code: res.code, body: JSON.parse(res.body) }
}

async function mockPost(route: any, payload: unknown) {
  const req: any = Readable.from([JSON.stringify(payload)])
  req.method = 'POST'
  req.url = '/api/dsh-taskboard-agent/sync'
  const res: any = {
    writeHead(code: number) {
      this.code = code
    },
    end(body: string) {
      this.body = body
    },
  }
  await route.handler(req, res)
  return { code: res.code, body: JSON.parse(res.body) }
}

describe('dsh-taskboard-agent host half', () => {
  const { registrations, sections, routes } = makeHarness()

  it('registers the four tools with valid output contracts', () => {
    expect(registrations.map((d) => d.name)).toEqual([
      'task_board_create',
      'task_board_list',
      'task_board_update',
      'task_board_delete',
    ])
    expect(registrations.every((d) => d.output && typeof d.output.render === 'function')).toBe(true)
    expect(() => registrations.forEach((d) => assertSupportedJsonSchema(d.output.schema))).not.toThrow()
    expect(byName(registrations, 'task_board_create').parameters.required).toContain('title')
  })

  it('announces the bridge through the system prompt', () => {
    expect(sections.length).toBeGreaterThan(0)
  })

  it('queues create ops and serves them via GET /pending', async () => {
    const create = byName(registrations, 'task_board_create')
    const a = await create.execute({ title: 'card A', description: 'descA' })
    expect(a).toMatchObject({ ok: true, pending: 1 })
    const b = await create.execute({ title: 'card B', prompt: 'promptB' })
    expect(b).toMatchObject({ ok: true, pending: 2 })

    const pending = mockGet(routeByPath(routes, '/api/dsh-taskboard-agent/pending'), '/api/dsh-taskboard-agent/pending?max=50')
    expect(pending).toMatchObject({ code: 200, body: { tasks: [{}, {}], ops: [{}, {}] } })
    expect(pending.body.ops.every((o: any) => o.op === 'create')).toBe(true)
  })

  it('replaces the snapshot and persists to disk on POST /sync', async () => {
    const fakeLedger = [
      { id: 'c1', title: 'real 1', description: 'd1', prompt: 'p1', status: 'todo', createdAt: 1000, updatedAt: 1000, executions: [] },
      { id: 'c2', title: 'real 2', description: 'd2', prompt: 'p2', status: 'done', createdAt: 2000, updatedAt: 2000, executions: [] },
      { id: 'bad', title: 123 }, // invalid row, must be filtered out
    ]
    const sync = await mockPost(routeByPath(routes, '/api/dsh-taskboard-agent/sync'), fakeLedger)
    expect(sync).toMatchObject({ code: 200, body: { ok: true, received: 2 } })

    const onDisk = JSON.parse(readFileSync(BOARD_FILE, 'utf8'))
    expect(onDisk.map((c: any) => c.id)).toEqual(['c1', 'c2'])
  })

  it('lists the snapshot with optional status filtering', async () => {
    const list = byName(registrations, 'task_board_list')
    expect(await list.execute({})).toMatchObject({ ok: true, total: 2, cards: [{ id: 'c1' }, { id: 'c2' }] })
    expect(await list.execute({ status: 'done' })).toMatchObject({ ok: true, total: 1, cards: [{ id: 'c2' }] })
  })

  it('queues update/delete with correct known flags and drains them', async () => {
    const update = byName(registrations, 'task_board_update')
    const del = byName(registrations, 'task_board_delete')

    expect(await update.execute({ id: 'c1', status: 'in_progress' })).toMatchObject({ ok: true, id: 'c1', queued: true, known: true })
    expect(await update.execute({ id: 'nope', status: 'done' })).toMatchObject({ ok: true, id: 'nope', queued: true, known: false })
    expect(await del.execute({ id: 'c2' })).toMatchObject({ ok: true, id: 'c2', queued: true, known: true })

    const drained = mockGet(routeByPath(routes, '/api/dsh-taskboard-agent/pending'), '/api/dsh-taskboard-agent/pending?max=50')
    expect(drained.body.ops).toMatchObject([
      { op: 'update', id: 'c1', patch: { status: 'in_progress' } },
      { op: 'update', id: 'nope' },
      { op: 'delete', id: 'c2' },
    ])
  })

  afterAll(() => {
    rmSync(BOARD_FILE, { force: true })
  })
})
