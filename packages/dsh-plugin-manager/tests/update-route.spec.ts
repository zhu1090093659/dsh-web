import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes, type RegistryVersionManifest } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

function profile(spec: string, name = 'dsh-memoir', version = '1.0.0'): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-update-route-'))
  const profileDir = join(dir, 'profiles', 'web')
  const moduleDir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: { [name]: spec }, dsh: { profile: { bundles: [] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name, version }))
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

/** Build a registry manifest: version plus optional compat metadata. */
function manifest(version: string, metadata: Pick<RegistryVersionManifest, 'dsh' | 'engines'> = {}): RegistryVersionManifest {
  return { version, ...metadata }
}

function updateHandler(
  facts: ProfileFacts,
  fetchManifest: (name: string) => Promise<RegistryVersionManifest | undefined>,
  dshVersion: () => Promise<string | undefined> = async () => undefined,
  update = vi.fn(() => ({ jobId: 'job-1' })),
  migrate = vi.fn(() => ({ jobId: 'job-1' })),
) {
  const gateway = { update, migrate, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
  const handler = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, fetchManifest, dshVersion })
    .find(route => route.path === '/api/plugin-manager/update')!.handler
  return { handler, update, migrate }
}

function checkUpdatesHandler(
  facts: ProfileFacts,
  fetchManifest: (name: string) => Promise<RegistryVersionManifest | undefined>,
  dshVersion: () => Promise<string | undefined> = async () => undefined,
) {
  const gateway = { update: vi.fn(() => ({ jobId: 'job-1' })), withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
  return makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, fetchManifest, dshVersion })
    .find(route => route.path === '/api/plugin-manager/check-updates')!.handler
}

describe('gateway update route', () => {
  it('resolves latest server-side and starts an exact npm update job', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, update } = updateHandler(facts, async name => name === 'dsh-memoir' ? manifest('1.1.0') : undefined)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ jobId: 'job-1' })
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
  })

  it('starts a migration job for the legacy aggregate', async () => {
    const { facts, dir } = profile('^0.3.2', '@linxin666/dsh-web-ui-all', '0.3.2')
    tempDirs.push(dir)
    const { handler, update, migrate } = updateHandler(
      facts,
      async name => name === '@linxin666/dsh-web-all' ? manifest('0.3.3') : undefined,
      async () => '0.1.1-rc.2',
    )
    const captured = response()
    await handler(request({ id: '@linxin666/dsh-web-ui-all' }), captured.res)
    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ jobId: 'job-1' })
    expect(update).not.toHaveBeenCalled()
    expect(migrate).toHaveBeenCalledWith(
      '@linxin666/dsh-web-ui-all',
      '@linxin666/dsh-web-all',
      '0.3.3',
      '@linxin666/dsh-web-all@0.3.3',
    )
  })

  it('rewrites a local repository link for the legacy migration route', async () => {
    const { facts, dir } = profile('link:/Users/zcl/code/dsh-web-ui/packages/dsh-web-ui-all', '@linxin666/dsh-web-ui-all', '0.3.2')
    tempDirs.push(dir)
    const { handler, migrate } = updateHandler(
      facts,
      async name => name === '@linxin666/dsh-web-all' ? manifest('0.3.3') : undefined,
      async () => '0.1.1-rc.2',
    )
    const captured = response()
    await handler(request({ id: '@linxin666/dsh-web-ui-all' }), captured.res)
    expect(captured.status()).toBe(200)
    expect(migrate).toHaveBeenCalledWith(
      '@linxin666/dsh-web-ui-all',
      '@linxin666/dsh-web-all',
      '0.3.3',
      'link:/Users/zcl/code/dsh-web-ui/packages/dsh-web-all',
    )
  })

  it('rejects a git source before requesting npm latest or starting a job', async () => {
    const { facts, dir } = profile('github:example/dsh-memoir')
    tempDirs.push(dir)
    const fetchManifest = vi.fn(async () => manifest('1.1.0'))
    const { handler, update } = updateHandler(facts, fetchManifest)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(400)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('not a direct npm registry plugin') })
    expect(fetchManifest).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a tarball source before requesting npm latest or starting a job', async () => {
    const { facts, dir } = profile('https://registry.example/dsh-memoir.tgz')
    tempDirs.push(dir)
    const fetchManifest = vi.fn(async () => manifest('1.1.0'))
    const { handler, update } = updateHandler(facts, fetchManifest)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(400)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('not a direct npm registry plugin') })
    expect(fetchManifest).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an unchanged or unresolved latest version without starting a job', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const same = updateHandler(facts, async () => manifest('1.0.0'))
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

  it('blocks an update whose latest version declares a newer DSH minimum', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const dshVersion = vi.fn(async () => '0.1.0-rc.7')
    const { handler, update } = updateHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }), dshVersion)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(412)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('requires DSH >=0.1.0-rc.8') })
    expect(dshVersion).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })

  it('allows an update when the host satisfies the declared minimum', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, update } = updateHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }),
      async () => '0.1.1-rc.2',
    )
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(200)
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
  })

  it('reads the top-level engines.dsh fallback for the requirement', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, update } = updateHandler(
      facts,
      async () => manifest('1.1.0', { engines: { dsh: '>=0.1.0-rc.8' } }),
      async () => '0.1.0-rc.7',
    )
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(412)
    expect(update).not.toHaveBeenCalled()
  })

  it('fails closed when a declared requirement cannot be verified', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)

    const unknownHost = updateHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }),
      async () => undefined,
    )
    const unknownResponse = response()
    await unknownHost.handler(request({ id: 'dsh-memoir' }), unknownResponse.res)
    expect(unknownResponse.status()).toBe(412)
    expect(unknownResponse.body()).toMatchObject({ error: expect.stringContaining('cannot verify the DSH version') })
    expect(unknownHost.update).not.toHaveBeenCalled()

    const unsupported = updateHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: '^0.1.0-rc.8' } } }),
      async () => '0.1.0-rc.7',
    )
    const unsupportedResponse = response()
    await unsupported.handler(request({ id: 'dsh-memoir' }), unsupportedResponse.res)
    expect(unsupportedResponse.status()).toBe(412)
    expect(unsupported.update).not.toHaveBeenCalled()
  })

  it('fails open only when the manifest declares no DSH requirement', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, update } = updateHandler(facts, async () => manifest('1.1.0'), async () => undefined)
    const captured = response()

    await handler(request({ id: 'dsh-memoir' }), captured.res)

    expect(captured.status()).toBe(200)
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
  })
})

describe('gateway check-updates route', () => {
  it('carries the declared minimum and compatibility verdict per row', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }), async () => '0.1.0-rc.7')
    const captured = response()

    await handler(request({}), captured.res)

    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({
      updates: [{
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: false,
      }],
    })
  })

  it('reports a migration update for the legacy aggregate', async () => {
    const { facts, dir } = profile('^0.3.2', '@linxin666/dsh-web-ui-all', '0.3.2')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(
      facts,
      async name => name === '@linxin666/dsh-web-all' ? manifest('0.3.3', { dsh: { engines: { dsh: '>=0.1.1-rc.1' } } }) : undefined,
      async () => '0.1.1-rc.2',
    )
    const captured = response()
    await handler(request({}), captured.res)
    expect(captured.body()).toEqual({
      updates: [{
        id: '@linxin666/dsh-web-ui-all', current: '0.3.2', latest: '0.3.3',
        kind: 'migrate', target: '@linxin666/dsh-web-all', targetVersion: '0.3.3',
        requiresDsh: '>=0.1.1-rc.1', compatible: true,
      }],
    })
  })

  it('reports compatible when the host satisfies the declared minimum', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }), async () => '0.1.1-rc.2')
    const captured = response()

    await handler(request({}), captured.res)

    expect((captured.body() as { updates: Array<{ compatible?: boolean }> }).updates[0]).toMatchObject({ compatible: true })
  })

  it('omits compat fields when the manifest declares no minimum', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(facts, async () => manifest('1.1.0'))
    const captured = response()

    await handler(request({}), captured.res)

    expect(captured.body()).toEqual({ updates: [{ id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0' }] })
  })

  it('marks a declared requirement incompatible when the host version is unknown', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.1.0-rc.8' } } }), async () => undefined)
    const captured = response()

    await handler(request({}), captured.res)

    expect(captured.body()).toEqual({
      updates: [{ id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: false }],
    })
  })

  it('skips plugins without a registry manifest or without a newer version', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)

    const missing = checkUpdatesHandler(facts, async () => undefined)
    const missingResponse = response()
    await missing(request({}), missingResponse.res)
    expect(missingResponse.body()).toEqual({ updates: [] })

    const unchanged = checkUpdatesHandler(facts, async () => manifest('1.0.0'))
    const unchangedResponse = response()
    await unchanged(request({}), unchangedResponse.res)
    expect(unchangedResponse.body()).toEqual({ updates: [] })
  })
})
