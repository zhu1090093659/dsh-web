/**
 * HostStore unit tests: CRUD, validation, ssh-config import. No network.
 */

import { mkdtempSync, writeFileSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostStore, validateAlias, validateHostPayload } from '../src/store.ts'
import type { HostPayload } from '../src/protocol.ts'

const dirs: string[] = []

function makeStore(sshConfig?: string): HostStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-store-'))
  dirs.push(dir)
  const storePath = join(dir, 'hosts.json')
  // Always pin the config path into the sandbox so the real ~/.ssh/config is
  // never touched, even when no fixture is provided (missing-file case).
  const configPath = join(dir, 'config')
  if (sshConfig !== undefined) writeFileSync(configPath, sshConfig, 'utf8')
  return new HostStore(storePath, configPath)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const basePayload: HostPayload = {
  alias: 'web-01',
  host: '192.168.1.10',
  port: 22,
  user: 'root',
  auth: { kind: 'password', password: 'pw' },
  description: 'web server',
  environment: 'production',
  tags: ['web', 'nginx'],
  location: 'dc-a',
}

describe('validation', () => {
  it('accepts a valid alias', () => {
    expect(validateAlias('web-01')).toBeUndefined()
    expect(validateAlias('a')).toBeUndefined()
    // IP / domain / uppercase aliases are accepted (imported from ~/.ssh/config)
    expect(validateAlias('192.168.40.90')).toBeUndefined()
    expect(validateAlias('Web_01')).toBeUndefined()
    expect(validateAlias('c2.hpcmaster.com')).toBeUndefined()
  })

  it('rejects invalid aliases', () => {
    expect(validateAlias('a b')).toBeDefined()
    expect(validateAlias('-abc')).toBeDefined()
    expect(validateAlias('abc!')).toBeDefined()
  })

  it('rejects malformed payloads', () => {
    expect(validateHostPayload({})).toBeDefined()
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'key' } })).toContain('keyPath')
    // A missing/empty password is accepted (filled later in the GUI after import)
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'password' } })).toBeUndefined()
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'password', password: 123 } })).toContain('password')
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'bogus' } })).toContain('kind')
  })
})

describe('CRUD', () => {
  it('creates, lists, finds and summarizes', () => {
    const store = makeStore()
    expect(store.list()).toHaveLength(0)
    const entry = store.create(basePayload)
    expect(entry.createdAt).toBeGreaterThan(0)
    expect(store.list()).toHaveLength(1)
    expect(store.find('web-01')?.host).toBe('192.168.1.10')
    const summary = store.summarize(entry)
    expect(summary.auth).toBe('password')
    expect('password' in summary).toBe(false)
  })

  it('rejects duplicate and invalid aliases', () => {
    const store = makeStore()
    store.create(basePayload)
    expect(() => store.create(basePayload)).toThrow(/already exists/)
    expect(() => store.create({ ...basePayload, alias: 'Bad Alias' })).toThrow(/alias/)
  })

  it('updates fields and timestamps', () => {
    const store = makeStore()
    store.create(basePayload)
    const updated = store.update('web-01', { ...basePayload, description: 'renewed', port: 2222 })
    expect(updated.description).toBe('renewed')
    expect(updated.port).toBe(2222)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt)
    expect(store.find('web-01')?.description).toBe('renewed')
  })

  it('deletes entries', () => {
    const store = makeStore()
    store.create(basePayload)
    store.delete('web-01')
    expect(store.find('web-01')).toBeUndefined()
    expect(() => store.delete('web-01')).toThrow(/not found/)
  })

  it('expands ~ in key paths', () => {
    const store = makeStore()
    const entry = store.create({ ...basePayload, auth: { kind: 'key', keyPath: '~/keys/id' } })
    expect(entry.auth.keyPath).not.toContain('~')
    expect(entry.auth.keyPath).toContain('keys/id')
  })
})

describe('import from ssh config', () => {
  const config = [
    '# comments are ignored',
    '',
    'Host prod-web-01',
    '    HostName 10.0.0.1',
    '    User deploy',
    '    Port 2222',
    '    IdentityFile ~/.ssh/id_ed25519',
    '    ProxyJump bastion',
    '    # description: prod web',
    '    # environment: production',
    '    # tags: web,nginx',
    '',
    'Host dev-db',
    '    HostName 10.0.0.2',
    '    User root',
    '    IdentityFile ~/.ssh/dev_key',
    '',
    'Host *.cluster',
    '    HostName 10.0.0.99',
    '',
    'Host nohost',
    '    User root',
    '',
  ].join('\n')

  it('imports usable blocks and skips wildcards/missing HostName', () => {
    const store = makeStore(config)
    const result = store.importFromSshConfig()
    expect(result.parsed).toBe(4)
    expect(result.added).toBe(2)
    expect(result.skipped).toBe(2)
    expect(store.find('prod-web-01')?.host).toBe('10.0.0.1')
    expect(store.find('prod-web-01')?.user).toBe('deploy')
    expect(store.find('prod-web-01')?.port).toBe(2222)
    expect(store.find('prod-web-01')?.auth.kind).toBe('key')
    expect(store.find('prod-web-01')?.proxyJump).toEqual(['bastion'])
    expect(store.find('dev-db')?.auth.kind).toBe('key')
  })

  it('skips existing aliases on re-import', () => {
    const store = makeStore(config)
    store.importFromSshConfig()
    const again = store.importFromSshConfig()
    expect(again.added).toBe(0)
    // 2 unimportable blocks + 2 existing aliases, all counted as skipped.
    expect(again.skipped).toBe(4)
    expect(again.skippedNames).toContain('prod-web-01')
  })

  it('handles a missing config file', () => {
    const store = makeStore()
    expect(store.importFromSshConfig()).toEqual({ parsed: 0, added: 0, skipped: 0, skippedNames: [] })
  })

  it('imports a lowercase `Hostname` keyword (case-insensitive ssh_config)', () => {
    const store = makeStore([
      'Host lower-host',
      '    Hostname 10.9.9.9',
      '    User root',
      '    IdentityFile ~/.ssh/id_ed25519',
    ].join('\n'))
    const result = store.importFromSshConfig()
    expect(result.added).toBe(1)
    expect(store.find('lower-host')?.host).toBe('10.9.9.9')
  })
})

describe('file safety', () => {
  it('writes the store with owner-only permissions', () => {
    const store = makeStore()
    store.create(basePayload)
    const mode = statSync(store.path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('renames a corrupt store aside instead of silently overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-corrupt-'))
    dirs.push(dir)
    const storePath = join(dir, 'hosts.json')
    writeFileSync(storePath, '{not json!!', 'utf8')
    const store = new HostStore(storePath, join(dir, 'config'))
    expect(store.list()).toHaveLength(0)
    // The damaged bytes must survive the next mutation.
    store.create(basePayload)
    const backups = readdirSync(dir).filter(name => name.startsWith('hosts.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe('{not json!!')
    expect(store.list()).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
    const index = dirs.indexOf(dir)
    if (index >= 0) dirs.splice(index, 1)
  })
})

describe('partial updates', () => {
  it('updates only the present fields and keeps auth when omitted', () => {
    const store = makeStore()
    store.create(basePayload)
    const updated = store.update('web-01', { tags: ['web', 'nginx', 'new'] })
    expect(updated.tags).toEqual(['web', 'nginx', 'new'])
    expect(updated.host).toBe('192.168.1.10')
    expect(updated.auth.password).toBe('pw')
  })

  it('rejects an empty host on update but accepts other fields', () => {
    const store = makeStore()
    store.create(basePayload)
    expect(() => store.update('web-01', { host: '  ' })).toThrow(/host/)
    expect(() => store.update('web-01', { port: 0 })).toThrow(/port/)
  })

  it('accepts updating a password-auth entry with an empty password (filled later)', () => {
    const store = makeStore()
    store.create(basePayload)
    // Mirrors create/import: an empty/omitted password is a to-be-filled
    // credential, not a validation error (kept in sync with validateHostPayload).
    const updated = store.update('web-01', { auth: { kind: 'password', password: '' } })
    expect(updated.auth.kind).toBe('password')
    expect(updated.auth.password).toBe('')
    expect(() => store.update('web-01', { auth: { kind: 'password', password: 123 as unknown as string } }))
      .toThrow(/password/)
  })

  it('drops the stored passphrase when the key path changes without one', () => {
    const store = makeStore()
    store.create({ ...basePayload, auth: { kind: 'key', keyPath: '~/keys/old', passphrase: 'secret' } })
    const switched = store.update('web-01', { auth: { kind: 'key', keyPath: '~/keys/new' } })
    expect(switched.auth.keyPath).toContain('keys/new')
    expect(switched.auth.passphrase).toBeUndefined()
  })

  it('keeps the stored passphrase when the key path is unchanged', () => {
    const store = makeStore()
    store.create({ ...basePayload, auth: { kind: 'key', keyPath: '~/keys/same', passphrase: 'secret' } })
    const touched = store.update('web-01', { auth: { kind: 'key', keyPath: '~/keys/same' } })
    expect(touched.auth.passphrase).toBe('secret')
  })
})
