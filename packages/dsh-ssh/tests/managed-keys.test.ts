import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostStore } from '../src/store.ts'
import type { HostPayload } from '../src/protocol.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-managed-keys-'))
  dirs.push(dir)
  const store = new HostStore(join(dir, 'dsh-ssh.json'), join(dir, 'ssh-config'))
  const keyPath = join(dir, 'id_ed25519')
  writeFileSync(keyPath, 'fixture-not-a-private-key')
  return { dir, store, keyPath }
}

function hostPayload(keyPath: string, passphrase?: string): HostPayload {
  return {
    alias: 'web-01',
    host: '192.168.1.10',
    user: 'root',
    auth: { kind: 'key', keyPath, passphrase },
  }
}

describe('managed SSH keys (#2069)', () => {
  it('operator sees file status and host usage without any passphrase or service-path leak', () => {
    // Given a stored host and a managed reference to the same local key path
    const { store, keyPath } = setup()
    const host = store.create(hostPayload(keyPath, 'host-secret'))
    const created = store.createKey({ name: 'Work key', path: keyPath, passphrase: 'managed-secret', note: 'shared' })
    // When the store projects host and key summaries
    const summary = store.listKeys()[0]!
    // Then metadata is visible while both secret material and the agent host path stay hidden
    expect(created.id).toBe(summary.id)
    expect(summary).toMatchObject({ name: 'Work key', path: keyPath, hasPassphrase: true, exists: true, usedBy: ['web-01'] })
    expect(JSON.stringify(summary)).not.toContain('managed-secret')
    expect('keyPath' in store.summarize(host)).toBe(false)
    expect(store.summarizePanel(host).keyPath).toBe(keyPath)
    // And deleting only the managed record leaves the host's own path untouched
    store.deleteKey(created.id)
    expect(store.find('web-01')?.auth.keyPath).toBe(keyPath)
  })

  it('operator preserves or explicitly clears a managed passphrase during edits', () => {
    // Given a managed key with a saved passphrase
    const { store, keyPath } = setup()
    const key = store.createKey({ name: 'Work key', path: keyPath, passphrase: 'secret' })
    // When an edit omits passphrase and then explicitly clears it
    store.updateKey(key.id, { name: 'Renamed' })
    const preserved = store.listKeys()[0]!
    store.updateKey(key.id, { passphrase: null })
    const cleared = store.listKeys()[0]!
    // Then omission preserves the secret state and null clears it
    expect(preserved.hasPassphrase).toBe(true)
    expect(preserved.name).toBe('Renamed')
    expect(cleared.hasPassphrase).toBe(false)
  })

  it('operator resolves a managed selection Host-side into the unchanged host auth shape', () => {
    // Given a managed key and a host payload carrying only its transient id
    const { store, keyPath } = setup()
    const key = store.createKey({ name: 'Work key', path: keyPath, passphrase: 'managed-secret' })
    const payload = hostPayload('/ignored')
    const resolved = store.resolveManagedKey({ ...payload, managedKeyId: key.id })
    // When the Host creates that host
    const entry = store.create(resolved)
    // Then only auth.keyPath/passphrase are persisted, never managedKeyId
    expect(entry.auth).toMatchObject({ kind: 'key', keyPath, passphrase: 'managed-secret' })
    expect('managedKeyId' in resolved).toBe(false)
    expect('managedKeyId' in entry).toBe(false)
    // And an unprotected managed key explicitly clears an old host passphrase
    store.updateKey(key.id, { passphrase: null })
    const updated = store.update('web-01', store.resolveManagedKey({ auth: { kind: 'key', keyPath }, managedKeyId: key.id }))
    expect(updated.auth.passphrase).toBeUndefined()
  })

  it('operator gets validation for missing names, relative paths and unknown managed ids', () => {
    // Given a store and invalid managed-key inputs
    const { store, keyPath } = setup()
    // When each input is validated
    // Then no unusable reference or silent credential fallback is accepted
    expect(() => store.createKey({ name: '', path: keyPath })).toThrow(/name/)
    expect(() => store.createKey({ name: 'relative', path: 'id_ed25519' })).toThrow(/absolute/)
    expect(() => store.resolveManagedKey({ ...hostPayload(keyPath), managedKeyId: 'missing' })).toThrow(/not found/)
    expect(() => store.resolveManagedKey({ ...hostPayload(keyPath), auth: { kind: 'password' }, managedKeyId: 'id' })).toThrow(/key auth/)
  })

  it('operator opening a pre-feature store keeps its shape until keys are added', () => {
    // Given a legacy dsh-ssh.json with no keys collection
    const { dir, store, keyPath } = setup()
    const file = join(dir, 'dsh-ssh.json')
    writeFileSync(file, JSON.stringify({ version: 1, hosts: [] }))
    // When hosts are listed and created without using managed keys
    expect(store.listKeys()).toEqual([])
    store.create(hostPayload(keyPath))
    // Then ordinary host writes do not invent the new top-level field
    expect('keys' in JSON.parse(readFileSync(file, 'utf8'))).toBe(false)
  })

  it('operator keeps cached managed-key fields unchanged when an update fails path validation', () => {
    // Given an existing managed key in the cached store
    const { store, keyPath } = setup()
    const created = store.createKey({ name: 'Original key', path: keyPath })

    // When an update includes a valid name change alongside an invalid relative path
    expect(() => store.updateKey(created.id, { name: 'Renamed key', path: 'relative/key' })).toThrow(/absolute/)

    // Then the cached managed key retains its original name and path
    expect(store.listKeys()[0]?.name).toBe('Original key')
    expect(store.listKeys()[0]?.path).toBe(keyPath)
  })
})
