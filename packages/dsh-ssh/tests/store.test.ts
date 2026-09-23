/**
 * HostStore unit tests: CRUD, validation, ssh-config import. No network.
 */

import { mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostStore, sshConfigPath, storePath, validateAlias, validateHostPayload } from '../src/store.ts'
import type { HostPayload } from '../src/protocol.ts'

const dirs: string[] = []

function makeStoreIn(sshConfig?: string): { store: HostStore; dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-store-'))
  dirs.push(dir)
  // Always pin the config path into the sandbox so the real ~/.ssh/config is
  // never touched, even when no fixture is provided (missing-file case).
  const configPath = join(dir, 'config')
  if (sshConfig !== undefined) writeFileSync(configPath, sshConfig, 'utf8')
  return { store: new HostStore(join(dir, 'hosts.json'), configPath), dir, configPath }
}

function makeStore(sshConfig?: string): HostStore {
  return makeStoreIn(sshConfig).store
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
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'agent', agentPath: 123 } })).toContain('agentPath')
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'agent' } })).toBeUndefined()
    expect(validateHostPayload({ host: 'h', user: 'u', auth: { kind: 'bogus' } })).toContain('kind')
  })

  it('rejects a payload carrying both transports but accepts none as a clear', () => {
    const base = { host: 'h', user: 'u', auth: { kind: 'password', password: 'p' } }
    expect(validateHostPayload({ ...base, proxyCommand: 42 })).toContain('proxyCommand')
    expect(validateHostPayload({ ...base, proxyCommand: 'nc %h %p', proxyJump: ['bastion'] }))
      .toContain('cannot be combined')
    expect(validateHostPayload({ ...base, proxyCommand: 'none', proxyJump: ['bastion'] })).toBeUndefined()
    expect(validateHostPayload({ ...base, proxyCommand: 'nc %h %p' })).toBeUndefined()
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

  it('creates and summarizes an agent-auth entry without leaking the agent path', () => {
    const store = makeStore()
    const entry = store.create({ ...basePayload, auth: { kind: 'agent', agentPath: 'pageant' } })
    expect(entry.auth.kind).toBe('agent')
    expect(entry.auth.agentPath).toBe('pageant')
    const summary = store.summarize(entry)
    expect(summary.auth).toBe('agent')
    expect('agentPath' in summary).toBe(false)
    expect(summary.keyReady).toBe(false)
  })

  it('normalizes ~ and SSH_AUTH_SOCK for agent paths', () => {
    const store = makeStore()
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = '/tmp/from-env.sock'
    try {
      const tilde = store.create({ ...basePayload, auth: { kind: 'agent', agentPath: '~/.ssh/agent.sock' } })
      expect(tilde.auth.agentPath).toBe(join(homedir(), '.ssh', 'agent.sock'))
      const envAgent = store.create({ ...basePayload, alias: 'env-agent', auth: { kind: 'agent', agentPath: 'SSH_AUTH_SOCK' } })
      expect(envAgent.auth.agentPath).toBe('/tmp/from-env.sock')
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
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
    expect(entry.auth.keyPath).toMatch(/[\\/]keys[\\/]id/)
  })

  it('serves repeated reads consistently and notices external rewrites', () => {
    const store = makeStore()
    store.create(basePayload)
    // Cached reads stay consistent.
    expect(store.list()).toHaveLength(1)
    expect(store.list()).toHaveLength(1)
    // An external rewrite (another dsh process editing the same file) must
    // not be hidden by the cache.
    const onDisk = JSON.parse(readFileSync(store.path, 'utf8')) as { hosts: Array<{ alias: string; host: string }> }
    onDisk.hosts[0]!.host = '10.9.8.7'
    writeFileSync(store.path, JSON.stringify(onDisk, null, 2) + '\n')
    expect(store.find('web-01')?.host).toBe('10.9.8.7')
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

  it('imports usable blocks, falls back to the pattern as host, and skips wildcards with a reason', () => {
    const store = makeStore(config)
    const result = store.importFromSshConfig()
    expect(result.parsed).toBe(4)
    expect(result.added).toBe(3)
    expect(result.skipped).toBe(1)
    expect(result.skippedBlocks).toEqual([{ name: '*.cluster', reason: 'wildcard' }])
    expect(store.find('prod-web-01')?.host).toBe('10.0.0.1')
    expect(store.find('prod-web-01')?.user).toBe('deploy')
    expect(store.find('prod-web-01')?.port).toBe(2222)
    expect(store.find('prod-web-01')?.auth.kind).toBe('key')
    expect(store.find('prod-web-01')?.proxyJump).toEqual(['bastion'])
    expect(store.find('dev-db')?.auth.kind).toBe('key')
    // No HostName: OpenSSH uses the Host pattern itself as the hostname.
    expect(store.find('nohost')?.host).toBe('nohost')
    expect(store.find('nohost')?.user).toBe('root')
  })

  it('skips existing aliases on re-import and reports why', () => {
    const store = makeStore(config)
    store.importFromSshConfig()
    const again = store.importFromSshConfig()
    expect(again.added).toBe(0)
    // 1 wildcard block + 3 aliases that already exist.
    expect(again.skipped).toBe(4)
    expect(again.skippedBlocks).toContainEqual({ name: 'prod-web-01', reason: 'existing' })
    expect(again.skippedBlocks).toContainEqual({ name: '*.cluster', reason: 'wildcard' })
  })

  it('handles a missing config file', () => {
    const store = makeStore()
    expect(store.importFromSshConfig()).toEqual({ parsed: 0, added: 0, skipped: 0, skippedBlocks: [] })
  })

  it('keeps ProxyCommand verbatim and drops the OpenSSH none keyword', () => {
    const store = makeStore([
      'Host bastion-host',
      '    HostName target.internal',
      '    User deploy',
      '    ProxyCommand corp-vpn proxy %h %p %r',
      '',
      'Host direct-host',
      '    HostName 10.1.1.1',
      '    User root',
      '    ProxyCommand none',
    ].join('\n'))
    const result = store.importFromSshConfig()
    expect(result.added).toBe(2)
    expect(store.find('bastion-host')?.proxyCommand).toBe('corp-vpn proxy %h %p %r')
    expect(store.find('direct-host')?.proxyCommand).toBeUndefined()
  })

  it('keeps an address-form ProxyJump spec verbatim', () => {
    const store = makeStore([
      'Host through-address',
      '    HostName 10.2.2.2',
      '    User root',
      '    ProxyJump ops@bastion.example.com:2222',
    ].join('\n'))
    expect(store.importFromSshConfig().added).toBe(1)
    expect(store.find('through-address')?.proxyJump).toEqual(['ops@bastion.example.com:2222'])
  })

  it('expands Include files (glob, nested, relative to the config directory) and ignores missing paths', () => {
    const { store, dir } = makeStoreIn([
      'Include config.d/*.conf',
      'Include missing/*.conf',
      '',
      'Host from-main',
      '    HostName 10.3.3.3',
      '    User root',
      '    Include nested.conf',
    ].join('\n'))
    mkdirSync(join(dir, 'config.d'), { recursive: true })
    writeFileSync(join(dir, 'config.d', '10-work.conf'), [
      'Host from-include',
      '    HostName 10.4.4.4',
      '    User deploy',
    ].join('\n'), 'utf8')
    // A relative nested Include resolves against the imported config's
    // directory (OpenSSH: ~/.ssh); the trailing Include back into the top file
    // is the cycle case and must stay a no-op.
    writeFileSync(join(dir, 'nested.conf'), [
      'Host from-nested',
      '    HostName 10.5.5.5',
      '    User nested',
      'Include config',
    ].join('\n'), 'utf8')
    const result = store.importFromSshConfig()
    expect(result.added).toBe(3)
    expect(store.find('from-include')?.host).toBe('10.4.4.4')
    expect(store.find('from-include')?.user).toBe('deploy')
    expect(store.find('from-nested')?.host).toBe('10.5.5.5')
    expect(store.find('from-main')?.host).toBe('10.3.3.3')
  })

  it('never attributes a Match block to the Host block above it', () => {
    const store = makeStore([
      'Host conditional',
      '    HostName 10.6.6.6',
      '    User root',
      'Match host *.internal',
      '    ProxyCommand corp-vpn proxy %h %p',
      '    User ops',
      '',
      'Host plain',
      '    HostName 10.6.6.7',
      '    User root',
    ].join('\n'))
    const result = store.importFromSshConfig()
    expect(result.added).toBe(2)
    expect(store.find('conditional')?.user).toBe('root')
    expect(store.find('conditional')?.proxyCommand).toBeUndefined()
    expect(result.skippedBlocks.some(block => block.reason === 'match')).toBe(true)
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

  it('imports IdentityAgent as agent auth and treats IdentityAgent none as password', () => {
    const store = makeStore([
      'Host agent-host',
      '    Hostname 10.7.7.7',
      '    User root',
      '    IdentityAgent ~/.ssh/agent.sock',
      '',
      'Host no-agent',
      '    Hostname 10.7.7.8',
      '    User root',
      '    IdentityAgent none',
    ].join('\n'))
    const result = store.importFromSshConfig()
    expect(result.added).toBe(2)
    expect(store.find('agent-host')?.auth.kind).toBe('agent')
    expect(store.find('agent-host')?.auth.agentPath).toBe(join(homedir(), '.ssh', 'agent.sock'))
    expect(store.find('no-agent')?.auth.kind).toBe('password')
  })
})

describe('file safety', () => {
  it('writes the store with owner-only permissions', () => {
    const store = makeStore()
    store.create(basePayload)
    const mode = statSync(store.path).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o600)
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

  it('stores a ProxyCommand, clears it explicitly, and keeps the transports mutually exclusive', () => {
    const store = makeStore()
    store.create({ ...basePayload, alias: 'proxy-host', proxyCommand: '  corp-vpn proxy %h %p  ' })
    expect(store.find('proxy-host')?.proxyCommand).toBe('corp-vpn proxy %h %p')
    expect(store.summarize(store.find('proxy-host')!).proxyCommand).toBe('corp-vpn proxy %h %p')
    // An empty value (and OpenSSH's `none`) is an explicit clear.
    expect(store.update('proxy-host', { proxyCommand: '' }).proxyCommand).toBeUndefined()
    store.update('proxy-host', { proxyCommand: 'nc %h %p' })
    // Adding the other transport later must fail on the merged view, not slip in.
    expect(() => store.update('proxy-host', { proxyJump: ['bastion'] })).toThrow(/cannot be combined/)
    expect(store.find('proxy-host')?.proxyCommand).toBe('nc %h %p')
    expect(store.find('proxy-host')?.proxyJump).toEqual([])
    expect(store.update('proxy-host', { proxyCommand: 'none' }).proxyCommand).toBeUndefined()
    store.update('proxy-host', { proxyJump: ['bastion'] })
    expect(() => store.update('proxy-host', { proxyCommand: 'nc %h %p' })).toThrow(/cannot be combined/)
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

  it('updates agent auth and keeps the stored agent path when omitted', () => {
    const store = makeStore()
    store.create({ ...basePayload, auth: { kind: 'agent', agentPath: 'pageant' } })
    const updated = store.update('web-01', { auth: { kind: 'agent' } })
    expect(updated.auth.kind).toBe('agent')
    expect(updated.auth.agentPath).toBe('pageant')
    const switched = store.update('web-01', { auth: { kind: 'agent', agentPath: '\\\\.\\pipe\\openssh-ssh-agent' } })
    expect(switched.auth.agentPath).toBe('\\\\.\\pipe\\openssh-ssh-agent')
  })

  it('drops the stored passphrase when the key path changes without one', () => {
    const store = makeStore()
    store.create({ ...basePayload, auth: { kind: 'key', keyPath: '~/keys/old', passphrase: 'secret' } })
    const switched = store.update('web-01', { auth: { kind: 'key', keyPath: '~/keys/new' } })
    expect(switched.auth.keyPath).toMatch(/[\\/]keys[\\/]new/)
    expect(switched.auth.passphrase).toBeUndefined()
  })

  it('keeps the stored passphrase when the key path is unchanged', () => {
    const store = makeStore()
    store.create({ ...basePayload, auth: { kind: 'key', keyPath: '~/keys/same', passphrase: 'secret' } })
    const touched = store.update('web-01', { auth: { kind: 'key', keyPath: '~/keys/same' } })
    expect(touched.auth.passphrase).toBe('secret')
  })
})

describe('DSH_HOME wiring', () => {
  const prior = process.env.DSH_HOME
  afterEach(() => {
    if (prior === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prior
  })

  it('resolves the store under DSH_HOME when configured', () => {
    const dir = join(tmpdir(), 'dsh-home-store')
    process.env.DSH_HOME = dir
    expect(storePath()).toBe(join(dir, 'dsh-ssh.json'))
  })

  it('expands a leading tilde in DSH_HOME', () => {
    process.env.DSH_HOME = '~/dsh-data'
    expect(storePath()).toBe(join(homedir(), 'dsh-data', 'dsh-ssh.json'))
  })

  it('falls back to ~/.dsh when DSH_HOME is unset or blank', () => {
    delete process.env.DSH_HOME
    expect(storePath()).toBe(join(homedir(), '.dsh', 'dsh-ssh.json'))
    process.env.DSH_HOME = '   '
    expect(storePath()).toBe(join(homedir(), '.dsh', 'dsh-ssh.json'))
  })

  it('keeps the OpenSSH config under ~/.ssh regardless of DSH_HOME', () => {
    process.env.DSH_HOME = join(tmpdir(), 'dsh-home-store')
    expect(sshConfigPath()).toBe(join(homedir(), '.ssh', 'config'))
  })
})
