import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

/** One temp profile with a dsh-memoir-shaped dependency (bundle patch claims id=memoir). */
function makeProfile(): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-set-enabled-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-memoir'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: { 'dsh-memoir': 'link:/memoir' },
    dsh: { profile: { bundles: ['dsh-memoir'] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# layer\n[]\n')
  writeFileSync(join(profileDir, 'node_modules', 'dsh-memoir', 'package.json'), JSON.stringify({ name: 'dsh-memoir', version: '0.4.3' }))
  writeFileSync(join(profileDir, 'node_modules', 'dsh-memoir', 'cordis.patch.yml'), '- insert:\n    - id: memoir\n      name: dsh-memoir\n')
  const facts: ProfileFacts = {
    profileName: 'web',
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
  }
  return { facts, dir }
}

/** One aggregate package whose bundle contains the plugin manager escape hatch. */
function makeAggregateProfile(): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-set-enabled-aggregate-'))
  const profileDir = join(dir, 'profiles', 'web')
  const packageName = '@linxin666/dsh-web-all'
  const moduleDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-all')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: { [packageName]: '0.3.2' },
    dsh: { profile: { bundles: [packageName] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# layer\n[]\n')
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name: packageName, version: '0.3.2' }))
  writeFileSync(join(moduleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: web-ui-compat',
    "      name: '@linxin666/dsh-web-all'",
    '- insert:',
    '    - id: web-ui-plugin-manager',
    "      name: '@linxin666/dsh-client-ui-plugin-manager'",
    '- insert:',
    '    - id: web-ui-task-board',
    "      name: '@linxin666/dsh-client-ui-task-board'",
    '',
  ].join('\n'))
  const facts: ProfileFacts = {
    profileName: 'web',
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
  }
  return { facts, dir }
}

/** One temp profile with several plain plugins for concurrent row mutations. */
function makePlainProfile(ids: readonly string[]): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-set-enabled-concurrent-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: Object.fromEntries(ids.map(id => [id, `link:/${id}`])),
    dsh: { profile: { bundles: [] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# layer\n[]\n')
  const facts: ProfileFacts = {
    profileName: 'web',
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
  }
  return { facts, dir }
}

/** A loopback IncomingMessage carrying a JSON body. */
function loopbackRequest(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
  return stream
}

/** A capture-everything ServerResponse. */
function captureResponse(): { res: ServerResponse; body: () => string; status: () => number } {
  let status = 200
  let text = ''
  const res = {
    writeHead(code: number) { status = code },
    end(chunk: string) { text = chunk },
  } as unknown as ServerResponse
  return { res, body: () => text, status: () => status }
}

/** The set-enabled route handler of a gateway route set. */
function setEnabledHandler(facts: ProfileFacts) {
  const gateway = new CliGateway(facts)
  const routes = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true })
  return routes.find(route => route.path === '/api/plugin-manager/set-enabled')!.handler
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('set-enabled id space', () => {
  it('rejects a stale toggle after the plugin disappears without writing an orphan row', async () => {
    const { facts, dir } = makePlainProfile(['dsh-removed'])
    tempDirs.push(dir)
    // The panel can still hold this row after another writer removes the
    // dependency. A stale toggle must not manufacture a patch override for a
    // plugin that the fresh profile manifest no longer contains.
    writeFileSync(facts.packageJsonPath, JSON.stringify({
      name: 'dsh-profile-web', private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }))
    const before = readFileSync(facts.patchPath, 'utf8')
    const { res, body, status } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: 'dsh-removed', enabled: false }), res)
    expect(status()).toBe(404)
    expect(JSON.parse(body()).error).toContain('not installed')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(before)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })

  it('serializes concurrent toggles so every acknowledged row persists', async () => {
    const ids = Array.from({ length: 16 }, (_, index) => `dsh-concurrent-${String(index)}`)
    const { facts, dir } = makePlainProfile(ids)
    tempDirs.push(dir)
    const handler = setEnabledHandler(facts)
    const responses = await Promise.all(ids.map(async id => {
      const response = captureResponse()
      await handler(loopbackRequest({ id, enabled: false }), response.res)
      return response
    }))
    expect(responses.map(response => response.status())).toEqual(ids.map(() => 200))
    const patch = readFileSync(facts.patchPath, 'utf8')
    for (const id of ids) expect(patch).toContain(`id: ${id}`)
  })

  it('writes the claimed entry id (memoir), not the package name, and the row reports disabled', async () => {
    const { facts, dir } = makeProfile()
    tempDirs.push(dir)
    const { res, body, status } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: 'dsh-memoir', enabled: false }), res)
    expect(status()).toBe(200)
    const patch = readFileSync(facts.patchPath, 'utf8')
    expect(patch).toContain('id: memoir')
    expect(patch).not.toContain('id: dsh-memoir')
    const parsed = JSON.parse(body()) as { plugin: { enabled: boolean } }
    expect(parsed.plugin.enabled).toBe(false)
  })

  it('writes the entry own name when it differs from the package name', async () => {
    const { facts, dir } = makeProfile()
    tempDirs.push(dir)
    // The include patch semantics skip a bare row whose name mismatches the
    // inserted entry's name, so the row must carry the entry name verbatim.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(facts.profileDir, 'node_modules', 'dsh-memoir', 'cordis.patch.yml'), '- insert:\n    - id: memoir\n      name: memoir-display\n')
    const { res, status } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: 'dsh-memoir', enabled: false }), res)
    expect(status()).toBe(200)
    const patch = readFileSync(facts.patchPath, 'utf8')
    expect(patch).toContain('id: memoir')
    expect(patch).toContain('name: memoir-display')
    expect(patch).not.toContain('name: dsh-memoir')
  })

  it('keeps the plugin manager mounted when disabling an aggregate package', async () => {
    const { facts, dir } = makeAggregateProfile()
    tempDirs.push(dir)
    const { res, body, status } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: '@linxin666/dsh-web-all', enabled: false }), res)
    expect(status()).toBe(200)
    const patch = readFileSync(facts.patchPath, 'utf8')
    expect(patch).toContain('id: web-ui-compat')
    expect(patch).toContain('id: web-ui-task-board')
    expect(patch).not.toContain('id: web-ui-plugin-manager')
    const parsed = JSON.parse(body()) as { plugin: { enabled: boolean } }
    expect(parsed.plugin.enabled).toBe(false)
  })

  it('refuses to disable the standalone plugin manager entry', async () => {
    const { facts, dir } = makePlainProfile(['@linxin666/dsh-client-ui-plugin-manager'])
    tempDirs.push(dir)
    const moduleDir = join(facts.profileDir, 'node_modules', '@linxin666', 'dsh-client-ui-plugin-manager')
    mkdirSync(moduleDir, { recursive: true })
    writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({
      name: '@linxin666/dsh-client-ui-plugin-manager', version: '0.3.2',
    }))
    writeFileSync(join(moduleDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: ui-plugin-manager',
      "      name: '@linxin666/dsh-client-ui-plugin-manager'",
      '',
    ].join('\n'))
    const { res, body, status } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: '@linxin666/dsh-client-ui-plugin-manager', enabled: false }), res)
    expect(status()).toBe(200)
    expect(readFileSync(facts.patchPath, 'utf8')).toBe('# layer\n[]\n')
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
    const parsed = JSON.parse(body()) as { plugin: { enabled: boolean } }
    expect(parsed.plugin.enabled).toBe(true)
  })

  it('re-enabling removes the override and reports enabled', async () => {
    const { facts, dir } = makeProfile()
    tempDirs.push(dir)
    const { res, body } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: 'dsh-memoir', enabled: false }), res)
    const { res: res2, body: body2 } = captureResponse()
    await setEnabledHandler(facts)(loopbackRequest({ id: 'dsh-memoir', enabled: true }), res2)
    const patch = readFileSync(facts.patchPath, 'utf8')
    expect(patch).not.toContain('disabled')
    const parsed = JSON.parse(body2()) as { plugin: { enabled: boolean } }
    expect(parsed.plugin.enabled).toBe(true)
  })
})
