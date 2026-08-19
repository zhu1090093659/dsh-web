import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import type { CliGateway } from '../src/host/gateway.ts'
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
  const gateway = {} as CliGateway
  const routes = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true })
  return routes.find(route => route.path === '/api/plugin-manager/set-enabled')!.handler
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('set-enabled id space', () => {
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
