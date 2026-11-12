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
  // The gateway's own record of the plugin's newest update. False is "nothing
  // says it failed", which is the up-to-date profile a 409 belongs to.
  const lastUpdateFailed = vi.fn((_id: string, _version: string) => false)
  const gateway = { update, migrate, lastUpdateFailed, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
  const handler = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, fetchManifest, dshVersion })
    .find(route => route.path === '/api/plugin-manager/update')!.handler
  return { handler, update, migrate, lastUpdateFailed }
}

/**
 * Write a `@deepseek-ai/dsh` package.json declaring `version` and return its
 * absolute path — the running installation's own manifest, which is what the
 * launcher publishes as the profile's install anchor.
 * @param version - the version the manifest declares.
 * @returns the manifest path.
 */
function installedDshManifest(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-installed-dsh-'))
  tempDirs.push(dir)
  const manifest = join(dir, 'package.json')
  writeFileSync(manifest, JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  return manifest
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

  it('user update check asks npm for an uncompressed registry manifest', async () => {
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    // Given the alpha.2 host fetch cannot decode a compressed body, so the
    // default registry probe (no injected fetchManifest) must ask for identity.
    const calls: Array<RequestInit | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify({ version: '1.1.0' }), { status: 200 })
    }))
    try {
      const gateway = { update: vi.fn(() => ({ jobId: 'job-1' })), migrate: vi.fn(() => ({ jobId: 'job-1' })), withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
      const handler = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, dshVersion: async () => undefined })
        .find(route => route.path === '/api/plugin-manager/update')!.handler
      const captured = response()
      // When the update route resolves the latest version.
      await handler(request({ id: 'dsh-memoir' }), captured.res)
      // Then the probe requested identity encoding and the update proceeded.
      expect(new Headers(calls[0]?.headers).get('accept-encoding')).toBe('identity')
      expect(captured.status()).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }
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
    const { facts, dir } = profile('link:/Users/zcl/code/dsh-web/packages/dsh-web-ui-all', '@linxin666/dsh-web-ui-all', '0.3.2')
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
      'link:/Users/zcl/code/dsh-web/packages/dsh-web-all',
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

  it('operator: gets a 409 and no install for a plugin that really is at the latest version', async () => {
    // Given a plugin the profile carries at the version the registry serves,
    // with nothing on record saying its update failed
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const same = updateHandler(facts, async () => manifest('1.0.0'))
    const sameResponse = response()

    // When the update route is asked for it
    await same.handler(request({ id: 'dsh-memoir' }), sameResponse.res)

    // Then it is refused as already up to date: the record was consulted and
    // said nothing failed, so no install job may start over a healthy profile
    expect(sameResponse.status()).toBe(409)
    expect(sameResponse.body()).toEqual({ error: expect.stringContaining('already at 1.0.0') })
    expect(same.lastUpdateFailed).toHaveBeenCalledWith('dsh-memoir', '1.0.0')
    expect(same.update).not.toHaveBeenCalled()

    // And a latest version that cannot be resolved at all is still a 502
    const missing = updateHandler(facts, async () => undefined)
    const missingResponse = response()
    await missing.handler(request({ id: 'dsh-memoir' }), missingResponse.res)
    expect(missingResponse.status()).toBe(502)
    expect(missing.update).not.toHaveBeenCalled()
  })

  it('operator: retries the version already installed when the newest update of it failed', async () => {
    // Given a profile already carrying the latest version because an update
    // wrote it and then failed its boot preflight, which the gateway still
    // records as a failed update at that exact version
    const { facts, dir } = profile('^1.0.0', 'dsh-memoir', '1.1.0')
    tempDirs.push(dir)
    const update = vi.fn(() => ({ jobId: 'job-2' }))
    const { handler, lastUpdateFailed } = updateHandler(facts, async () => manifest('1.1.0'), async () => undefined, update)
    lastUpdateFailed.mockReturnValue(true)
    const captured = response()

    // When the user retries the same update
    await handler(request({ id: 'dsh-memoir' }), captured.res)

    // Then the retry re-runs the install — the same job, preflight included —
    // instead of refusing with a 409 the panel has no way past
    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ jobId: 'job-2' })
    expect(lastUpdateFailed).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
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
    // The copy must not blame a CLI the host may not even have: an unreadable
    // host version is "we could not check", not "your DSH is too old" (#1819).
    expect(unknownResponse.body()).toMatchObject({ error: expect.stringContaining('cannot verify the running DSH version') })
    expect(unknownHost.update).not.toHaveBeenCalled()

    // A readable host version does not make an unparsable declaration a
    // "too old" verdict: nothing was compared, so the copy names the
    // declaration instead of sending the user to upgrade a DSH that may
    // already satisfy it (issue #1899).
    const unparsable = updateHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: 'not-a-range' } } }),
      async () => '0.1.0-rc.7',
    )
    const unparsableResponse = response()
    await unparsable.handler(request({ id: 'dsh-memoir' }), unparsableResponse.res)
    expect(unparsableResponse.status()).toBe(412)
    expect(unparsableResponse.body()).toMatchObject({ error: expect.stringContaining('cannot verify the running DSH version') })
    expect(unparsableResponse.body()).toMatchObject({ error: expect.stringContaining('not-a-range') })
    expect(unparsable.update).not.toHaveBeenCalled()
  })

  it('operator gets an update gated by a multi-form range the way the official boot gate decides it', async () => {
    // Given a release declaring dsh-context's two-alternative engines range
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const declared = '>=0.1.7-rc.2 || >=0.2.0-rc.2'

    // When the host sits on the newer rc line
    const allowed = updateHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: declared } } }), async () => '0.2.1-rc.3')
    const allowedResponse = response()
    await allowed.handler(request({ id: 'dsh-memoir' }), allowedResponse.res)

    // Then the update runs instead of being rejected as unverifiable
    expect(allowedResponse.status()).toBe(200)
    expect(allowed.update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')

    // When the host predates every alternative that range offers
    const blocked = updateHandler(facts, async () => manifest('1.1.0', { dsh: { engines: { dsh: declared } } }), async () => '0.1.0-rc.8')
    const blockedResponse = response()
    await blocked.handler(request({ id: 'dsh-memoir' }), blockedResponse.res)

    // Then the gate blocks it and names the declaration and the running version
    expect(blockedResponse.status()).toBe(412)
    expect(blockedResponse.body()).toMatchObject({ error: expect.stringContaining('requires DSH ' + declared) })
    expect(blockedResponse.body()).toMatchObject({ error: expect.stringContaining('current DSH 0.1.0-rc.8') })
    expect(blocked.update).not.toHaveBeenCalled()
  })

  it('operator gets an update allowed from the running installation manifest with no CLI at all (issue #1819)', async () => {
    // Given a packaged-Desktop-shaped host: no dsh anywhere on PATH and no
    // CLI probe that could ever answer, but a published install anchor whose
    // manifest declares the running DSH version
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const installAnchor = installedDshManifest('0.2.0-rc.2')
    const update = vi.fn(() => ({ jobId: 'job-1' }))
    const gateway = { update, usesNativeWriter: () => true, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
    // No dshVersion seam: this case must be answered by the install anchor, and
    // the CLI probe that would otherwise run cannot succeed on this host.
    const handler = makeGatewayRoutes({
      facts,
      gateway,
      cliAvailable: () => false,
      fetchManifest: async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.2.0-rc.2' } } }),
      installAnchor,
    }).find(route => route.path === '/api/plugin-manager/update')!.handler
    const captured = response()

    // When the user applies the update
    await handler(request({ id: 'dsh-memoir' }), captured.res)

    // Then the requirement is satisfied by the in-process fact alone: the
    // update is not blocked even though no CLI exists to ask
    expect(captured.status()).toBe(200)
    expect(update).toHaveBeenCalledWith('dsh-memoir', '1.1.0')
  })

  it('operator gets the update still blocked when the running installation manifest is genuinely too old', async () => {
    // Given the same no-CLI host whose install anchor declares an older DSH
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const gateway = { update: vi.fn(() => ({ jobId: 'job-1' })), usesNativeWriter: () => true, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
    const handler = makeGatewayRoutes({
      facts,
      gateway,
      cliAvailable: () => false,
      fetchManifest: async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.3.0' } } }),
      installAnchor: installedDshManifest('0.2.0-rc.2'),
    }).find(route => route.path === '/api/plugin-manager/update')!.handler
    const captured = response()

    // When the user applies the update
    await handler(request({ id: 'dsh-memoir' }), captured.res)

    // Then the gate still fails closed, and now names the version it read
    expect(captured.status()).toBe(412)
    expect(captured.body()).toMatchObject({ error: expect.stringContaining('current DSH 0.2.0-rc.2') })
  })

  it('operator gets the running installation version reported on the update row when no CLI exists', async () => {
    // Given the same no-CLI host with a satisfying install anchor
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const gateway = { update: vi.fn(() => ({ jobId: 'job-1' })), withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
    const handler = makeGatewayRoutes({
      facts,
      gateway,
      cliAvailable: () => false,
      fetchManifest: async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.2.0-rc.2' } } }),
      installAnchor: installedDshManifest('0.2.0-rc.2'),
    }).find(route => route.path === '/api/plugin-manager/check-updates')!.handler
    const captured = response()

    // When the user checks for updates
    await handler(request({}), captured.res)

    // Then the row is compatible and carries the version the verdict used, so
    // the browser can tell "too old" apart from "could not be checked"
    expect(captured.body()).toEqual({
      updates: [{
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0',
        requiresDsh: '>=0.2.0-rc.2', compatible: true, hostVersion: '0.2.0-rc.2',
      }],
    })
  })

  it('operator gets no host version when neither the installation manifest nor the CLI can answer', async () => {
    // Given a host that publishes an unreadable anchor and has no CLI
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const gateway = { update: vi.fn(() => ({ jobId: 'job-1' })), withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
    const handler = makeGatewayRoutes({
      facts,
      gateway,
      cliAvailable: () => false,
      fetchManifest: async () => manifest('1.1.0', { dsh: { engines: { dsh: '>=0.2.0-rc.2' } } }),
      installAnchor: join(dir, 'absent', 'package.json'),
    }).find(route => route.path === '/api/plugin-manager/check-updates')!.handler
    const captured = response()

    // When the user checks for updates
    await handler(request({}), captured.res)

    // Then the row is blocked but carries no hostVersion, which is exactly the
    // signal the browser renders as "cannot confirm the local DSH version"
    expect(captured.body()).toEqual({
      updates: [{
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0',
        requiresDsh: '>=0.2.0-rc.2', compatible: false,
      }],
    })
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
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0',
        requiresDsh: '>=0.1.0-rc.8', compatible: false, hostVersion: '0.1.0-rc.7',
      }],
    })
  })

  it('operator gets a blocked row without a host version when the declaration cannot be parsed', async () => {
    // Given a host that reads its own version fine and a release whose
    // engines.dsh is not a node-semver range
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const handler = checkUpdatesHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: 'nonsense' } } }),
      async () => '0.2.1-rc.3',
    )
    const captured = response()

    // When the user checks for updates
    await handler(request({}), captured.res)

    // Then the row is blocked by the declaration it cannot read, and carries
    // no hostVersion: that absence is exactly the signal the browser renders as
    // "cannot verify", so the user is not told to upgrade a DSH the host never
    // found to be too old (issue #1899)
    expect(captured.body()).toEqual({
      updates: [{
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0',
        requiresDsh: 'nonsense', compatible: false,
      }],
    })
  })

  it('operator gets a blocked row without a host version when only part of a declaration parses', async () => {
    // Given the same readable host and a declaration whose second alternative
    // is garbage, so the whole range is unparsable
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const declared = '>=0.1.0-rc.8 || garbage'
    const handler = checkUpdatesHandler(
      facts,
      async () => manifest('1.1.0', { dsh: { engines: { dsh: declared } } }),
      async () => '0.2.1-rc.3',
    )
    const captured = response()

    // When the user checks for updates
    await handler(request({}), captured.res)

    // Then the raw declaration is passed through for display and the row is
    // blocked without a hostVersion, exactly as for a wholly unparsable one
    expect(captured.body()).toEqual({
      updates: [{
        id: 'dsh-memoir', current: '1.0.0', latest: '1.1.0',
        requiresDsh: declared, compatible: false,
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
        requiresDsh: '>=0.1.1-rc.1', compatible: true, hostVersion: '0.1.1-rc.2',
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

  it('operator gets no host version on a blocked row when the running host cannot be read', async () => {
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

/**
 * The batch route: one request for a whole page's worth of updates, resolved
 * per plugin with exactly the rules the single update route applies.
 */
function updatesHandler(
  facts: ProfileFacts,
  fetchManifest: (name: string) => Promise<RegistryVersionManifest | undefined>,
  options: { cliAvailable?: boolean, lastUpdateFailed?: (id: string, version: string) => boolean } = {},
) {
  const updateAll = vi.fn((_entries: unknown[]) => ({ jobId: 'job-batch' }))
  const lastUpdateFailed = options.lastUpdateFailed ?? (() => false)
  const gateway = {
    updateAll,
    lastUpdateFailed,
    usesNativeWriter: () => false,
    withMutationLock: async <T>(task: () => Promise<T>) => await task(),
  } as unknown as CliGateway
  const handler = makeGatewayRoutes({
    facts,
    gateway,
    cliAvailable: () => options.cliAvailable ?? true,
    fetchManifest,
    dshVersion: async () => undefined,
  }).find(route => route.path === '/api/plugin-manager/updates')!.handler
  return { handler, updateAll }
}

describe('gateway batch update route', () => {
  it('operator: resolves every id and starts one batch job with its rows', async () => {
    // Given two installed third-party plugins, both behind the registry
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, updateAll } = updatesHandler(facts, async name =>
      name === 'dsh-memoir' ? manifest('1.1.0') : undefined)
    const captured = response()

    // When the batch runs
    await handler(request({ ids: ['dsh-memoir'] }), captured.res)

    // Then one job was started with the resolved target, and no per-row refusal
    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ jobId: 'job-batch' })
    expect(updateAll).toHaveBeenCalledWith([{ kind: 'apply', id: 'dsh-memoir', version: '1.1.0' }])
  })

  it('operator: answers a row that is already current as that row, not as a failed request', async () => {
    // Given the installed version is the newest the registry serves
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, updateAll } = updatesHandler(facts, async () => manifest('1.0.0'))
    const captured = response()

    // When the batch runs
    await handler(request({ ids: ['dsh-memoir'] }), captured.res)

    // Then the run started anyway and carries the refusal as that row's answer:
    // one up-to-date plugin must not stop the eight behind it
    expect(captured.status()).toBe(200)
    const entries = updateAll.mock.calls[0]?.[0] as Array<{ kind: string, id: string, error?: string }>
    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe('refused')
    expect(entries[0]?.id).toBe('dsh-memoir')
    expect(entries[0]?.error).toContain('is already at 1.0.0')
  })

  it('operator: answers an uninstalled id as that row instead of refusing the batch', async () => {
    // Given one id that is not part of the profile
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, updateAll } = updatesHandler(facts, async () => manifest('1.1.0'))
    const captured = response()

    // When the batch runs
    await handler(request({ ids: ['dsh-ghost'] }), captured.res)

    // Then the row says why it could not run
    expect(captured.status()).toBe(200)
    const entries = updateAll.mock.calls[0]?.[0] as Array<{ kind: string, error?: string }>
    expect(entries[0]?.kind).toBe('refused')
    expect(entries[0]?.error).toContain('not installed')
  })

  it('operator: asks for each plugin once when the caller repeats an id', async () => {
    // Given the same plugin listed twice
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, updateAll } = updatesHandler(facts, async () => manifest('1.1.0'))
    const captured = response()

    // When the batch runs
    await handler(request({ ids: ['dsh-memoir', 'dsh-memoir'] }), captured.res)

    // Then it is resolved and applied once
    expect(captured.status()).toBe(200)
    expect(updateAll).toHaveBeenCalledWith([{ kind: 'apply', id: 'dsh-memoir', version: '1.1.0' }])
  })

  it('operator: refuses a batch with no ids, a non-string id, or more ids than the cap', async () => {
    // Given a gateway that could start a job
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler, updateAll } = updatesHandler(facts, async () => manifest('1.1.0'))
    const tooMany = Array.from({ length: 51 }, (_, index) => `dsh-plugin-${String(index)}`)

    for (const body of [{}, { ids: [] }, { ids: [42] }, { ids: tooMany }, { ids: ['dsh-memoir@1.0.0 > /etc/passwd'] }]) {
      const captured = response()
      // When an unusable batch body arrives
      await handler(request(body), captured.res)
      // Then the request is refused before any job exists
      expect(captured.status()).toBe(400)
    }
    expect(updateAll).not.toHaveBeenCalled()
  })

  it('operator: refuses the batch when no writer can serve this runtime', async () => {
    // Given no CLI and no in-process manager
    const { facts, dir } = profile('^1.0.0')
    tempDirs.push(dir)
    const { handler } = updatesHandler(facts, async () => manifest('1.1.0'), { cliAvailable: false })
    const captured = response()

    // When the batch runs
    await handler(request({ ids: ['dsh-memoir'] }), captured.res)

    // Then it is refused with the same explanation the single route gives
    expect(captured.status()).toBe(500)
    expect((captured.body() as { error: string }).error).toContain('CLI not found')
  })
})
