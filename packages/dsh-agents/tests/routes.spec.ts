/**
 * Owns the HTTP surface: exactly the six contract routes, the loopback/browser
 * fence, and JSON refusals that carry a stable code and no stack trace.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberRunGateway } from '../src/host/run-gateway.ts'
import { makeAgentsRoutes, AGENTS_BODY_LIMIT } from '../src/host/routes.ts'
import { AgentsHostService } from '../src/host/service.ts'
import { DSH_AGENTS_ROUTE_PATHS } from '../src/protocol.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'

const NOW = 1_700_000_000_000

let server: Server
let base: string
let service: AgentsHostService
let dir: string

function gateway(): MemberRunGateway {
  return {
    listPresets: vi.fn(async () => [{ id: 'xundong' }]),
    createSession: vi.fn(async () => ({ sessionId: 'session-1' })),
    renameSession: vi.fn(async () => undefined),
    applyPermission: vi.fn(async () => undefined),
    selectModel: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
  }
}

const TRUSTED = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

async function post(path: string, body: unknown, headers: Record<string, string> = TRUSTED): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function get(path: string, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(base + path, { headers })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-agents-routes-'))
  let counter = 0
  service = new AgentsHostService({
    dir,
    gateway: gateway(),
    workspaces: () => ({ list: (): readonly Workspace[] => [{ id: 'ws-1', name: 'repo' } as unknown as Workspace] }),
    now: () => NOW + counter++,
    idFactory: () => 'id-' + (++counter),
  })
  const routes = makeAgentsRoutes(service)
  server = createServer((req, res) => {
    const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void Promise.resolve(route.handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the test server did not bind')
  base = 'http://127.0.0.1:' + address.port
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
  service.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('the route table', () => {
  it('operator registers exactly the frozen contract paths, in contract order', () => {
    // Given the contract, When the Host registers its routes, Then the table is those paths and no other.
    const routes = makeAgentsRoutes(service)
    expect(routes.map(route => route.path)).toEqual([...DSH_AGENTS_ROUTE_PATHS])
    expect(routes.every(route => route.auth === 'anonymous')).toBe(true)
  })
})

describe('the fence', () => {
  it('operator refuses a request that carries no browser marker at all', async () => {
    // Given a marker-less request, When it reaches the API, Then it is refused as forbidden in the JSON error shape.
    const response = await get('/dsh-agents/api/state', {})
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, code: 'forbidden', error: expect.any(String) })
  })

  it('operator refuses a cross-site request even over loopback', async () => {
    // Given a cross-site marker, When the request reaches the API, Then it is refused whatever else it carries.
    const response = await get('/dsh-agents/api/state', { 'sec-fetch-site': 'cross-site', origin: base })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('forbidden')
  })

  it('user opens the panel and the same-origin loopback request is admitted', async () => {
    // Given the browser on this machine, When it reads state, Then it is served.
    const response = await get('/dsh-agents/api/state')
    expect(response.status).toBe(200)
    expect(response.body.host).toEqual({ ownerPid: process.pid })
  })
})

describe('reading state', () => {
  it('user sees the teams, the runs and the owning pid', async () => {
    // Given one created team, When the panel polls state, Then the same team comes back with an empty run list.
    const created = await post('/dsh-agents/api/team', { team: { name: 'Squad' } })
    const state = await get('/dsh-agents/api/state')
    expect(state.status).toBe(200)
    expect(state.body.teams).toEqual([(created.body.team as Record<string, unknown>)])
    expect(state.body.runs).toEqual([])
  })

  it('user reads the preset list the host serves over the wire', async () => {
    // Given a registry serving one preset, When the panel polls state, Then the body carries that id as the Lead preset offer.
    const state = await get('/dsh-agents/api/state')
    expect(state.status).toBe(200)
    expect(state.body.presets).toEqual(['xundong'])
  })

  it('operator refuses the wrong method with its own code', async () => {
    // Given a POST to the read-only route, When it arrives, Then it is refused as method-not-allowed.
    const response = await post('/dsh-agents/api/state', {})
    expect(response.status).toBe(405)
    expect(response.body.code).toBe('method-not-allowed')
  })
})

describe('writing definitions', () => {
  it('user creates a team, adds a member, then deletes both', async () => {
    // Given the panel, When it writes a team, a member and then deletes them, Then every step answers with the changed definition.
    const team = await post('/dsh-agents/api/team', { team: { name: 'Squad', workspaceId: 'ws-1', order: 1 } })
    expect(team.status).toBe(200)
    const teamId = (team.body.team as { id: string }).id

    const withMember = await post('/dsh-agents/api/member', { teamId, member: { name: '寻冬', preset: 'xundong', brief: '你是寻冬。' } })
    expect(withMember.status).toBe(200)
    const members = (withMember.body.team as { members: { id: string; brief: string }[] }).members
    expect(members).toHaveLength(1)
    expect(members[0].brief).toBe('你是寻冬。')

    const withoutMember = await post('/dsh-agents/api/member/delete', { teamId, memberId: members[0].id })
    expect(withoutMember.status).toBe(200)
    expect((withoutMember.body.team as { members: unknown[] }).members).toEqual([])

    const deleted = await post('/dsh-agents/api/team/delete', { teamId })
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ ok: true })
    expect((await get('/dsh-agents/api/state')).body.teams).toEqual([])
  })

  it('operator refuses a body that is not JSON, or is not a definition', async () => {
    // Given a wrong content type, invalid JSON and an unknown field, When each arrives, Then each answers its own code.
    const wrongType = await post('/dsh-agents/api/team', { team: { name: 'Squad' } }, { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' })
    expect(wrongType.status).toBe(415)
    expect(wrongType.body.code).toBe('json-required')

    const notJson = await post('/dsh-agents/api/team', '{ oops')
    expect(notJson.status).toBe(400)
    expect(notJson.body.code).toBe('invalid-request')

    const unknownField = await post('/dsh-agents/api/team', { team: { name: 'Squad', id: 'x', createdAt: 1 } })
    expect(unknownField.status).toBe(400)
    expect(unknownField.body.code).toBe('invalid-request')
  })

  it('operator refuses a body past the byte cap', async () => {
    // Given a body larger than the cap, When it arrives, Then it is refused as too large before any parse.
    const huge = JSON.stringify({ team: { name: 'x'.repeat(AGENTS_BODY_LIMIT) } })
    const response = await post('/dsh-agents/api/team', huge)
    expect(response.status).toBe(413)
    expect(response.body.code).toBe('body-too-large')
  })

  it('user deletes a squad that is already gone and is told it is not found', async () => {
    // Given no such team, When the delete arrives, Then it answers 404 with the named code.
    const response = await post('/dsh-agents/api/team/delete', { teamId: 'ghost' })
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, code: 'team-not-found', error: expect.any(String) })
  })
})

describe('running a member', () => {
  it('user runs a member and the panel receives its run record', async () => {
    // Given a runnable squad, When the member is run, Then the reply carries the run naming the created session.
    const team = await post('/dsh-agents/api/team', { team: { name: 'Squad', workspaceId: 'ws-1' } })
    const teamId = (team.body.team as { id: string }).id
    const withMember = await post('/dsh-agents/api/member', { teamId, member: { name: '寻冬', preset: 'xundong' } })
    const memberId = (withMember.body.team as { members: { id: string }[] }).members[0].id

    const response = await post('/dsh-agents/api/run', { teamId, memberId, firstMessage: '开始' })
    expect(response.status).toBe(200)
    expect(response.body.run).toMatchObject({ teamId, memberId, sessionId: 'session-1', status: 'running' })
  })

  it('user runs a member of a team that pins no workspace and the session lands on the host default', async () => {
    // Given a team that pins no workspace, When its member runs, Then the reply carries the run and exactly one session was recorded.
    const team = await post('/dsh-agents/api/team', { team: { name: 'Squad' } })
    const teamId = (team.body.team as { id: string }).id
    const withMember = await post('/dsh-agents/api/member', { teamId, member: { name: 'M' } })
    const memberId = (withMember.body.team as { members: { id: string }[] }).members[0].id
    const response = await post('/dsh-agents/api/run', { teamId, memberId })
    expect(response.status).toBe(200)
    expect(response.body.run).toMatchObject({ teamId, memberId, sessionId: 'session-1', status: 'running' })
    expect((await get('/dsh-agents/api/state')).body.runs).toHaveLength(1)
  })

  it('operator serves the fail-closed code when the pinned workspace is not served', async () => {
    // Given a team pinned to a workspace the host does not list, When its member runs, Then the reply is 409 workspace-unknown and no session was created.
    const team = await post('/dsh-agents/api/team', { team: { name: 'Squad', workspaceId: 'ws-gone' } })
    const teamId = (team.body.team as { id: string }).id
    const withMember = await post('/dsh-agents/api/member', { teamId, member: { name: 'M' } })
    const memberId = (withMember.body.team as { members: { id: string }[] }).members[0].id
    const response = await post('/dsh-agents/api/run', { teamId, memberId })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('workspace-unknown')
    expect((await get('/dsh-agents/api/state')).body.runs).toEqual([])
  })
})

describe('refusals stay honest', () => {
  it('operator sees a stable code and one line of text, never a stack', async () => {
    // Given a refused request, When the body is read, Then it carries exactly the three contract keys and no stack.
    const response = await post('/dsh-agents/api/member', { teamId: 'ghost', member: { name: 'M' } })
    expect(response.status).toBe(404)
    expect(Object.keys(response.body).sort()).toEqual(['code', 'error', 'ok'])
    expect(String(response.body.error)).not.toContain('\n')
    expect(String(response.body.error)).not.toContain('at ')
    expect(response.body.stack).toBeUndefined()
  })
})
