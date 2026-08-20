import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

function profile(spec: string): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-update-route-'))
  const profileDir = join(dir, 'profiles', 'web')
  const moduleDir = join(profileDir, 'node_modules', 'dsh-memoir')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: { 'dsh-memoir': spec }, dsh: { profile: { bundles: [] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name: 'dsh-memoir', version: '1.0.0' }))
  return { facts: { profileName: 'web', profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), packageJsonPath: join(profileDir, 'package.json') }, dir }
}

function request(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
  return stream
}

function response(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let code = 200
  let text = ''
  return {
    res: { writeHead(value: number) { code = value }, end(value: string) { text = value } } as unknown as ServerResponse,
    status: () => code,
    body: () => JSON.parse(text),
  }
}

const tempDirs: string[] = []
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function updateHandler(facts: ProfileFacts, fetchLatest: (name: string) => Promise<string | undefined>, update = vi.fn(() => ({ jobId: 'job-1' }))) {
  const gateway = { update, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
  const handler = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, fetchLatest })
    .find(route => route.path === '/api/plugin-manager/update')!.handler
  return { handler, update }
}

describe('gateway update route', () => {
  it('resolves latest server-side and starts an exact npm update job', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, update } = updateHandler(facts, async name => name === 'dsh-memoir' ? '1.1.0' : undefined)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ jobId: 'job-1' })
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
  })

  it('rejects a git source before requesting npm latest or starting a job', async () => {
    const { facts, dir } = profile('github:example/dsh-memoir')
    tempDirs.push(dir)
    const fetchLatest = vi.fn(async () => '1.1.0')
    const { handler, update } = updateHandler(facts, fetchLatest)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(400)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('not a direct npm registry plugin') })
    expect(fetchLatest).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a tarball source before requesting npm latest or starting a job', async () => {
    const { facts, dir } = profile('https://registry.example/dsh-memoir.tgz')
    tempDirs.push(dir)
    const fetchLatest = vi.fn(async () => '1.1.0')
    const { handler, update } = updateHandler(facts, fetchLatest)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(400)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('not a direct npm registry plugin') })
    expect(fetchLatest).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an unchanged or unresolved latest version without starting a job', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const same = updateHandler(facts, async () => '1.0.0')
    const sameResponse = response()
    await same.handler(request({ id: 'dsh-memoir' }), sameResponse.res)
    expect(sameResponse.status()).toBe(409)
    expect(same.update).not.toHaveBeenCalled()

    const missing = updateHandler(facts, async () => undefined)
    const missingResponse = response()
    await missing.handler(request({ id: 'dsh-memoir' }), missingResponse.res)
    expect(missingResponse.status()).toBe(502)
    expect(missing.update).not.toHaveBeenCalled()
  })
})
