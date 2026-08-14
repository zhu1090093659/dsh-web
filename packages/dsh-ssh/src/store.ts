/**
 * Host config store: one JSON file (`~/.dsh/dsh-ssh.json`) holding every
 * SSH host entry, written atomically (tmp + rename). Also parses the user's
 * standard `~/.ssh/config` for one-shot import. Secrets (passwords,
 * passphrases) live in this user-owned file in plaintext — same trust model
 * as ssh-skill's annotated ssh-config comments; document it, never log it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { HostPayload, ImportResult, SshHostEntry, SshHostSummary } from './protocol.ts'

/** File format version. */
const FORMAT_VERSION = 1

/** Store file location: <home>/.dsh/dsh-ssh.json. */
export function storePath(): string {
  return join(homedir(), '.dsh', 'dsh-ssh.json')
}

/** The user's standard OpenSSH config path. */
export function sshConfigPath(): string {
  return join(homedir(), '.ssh', 'config')
}

interface StoreFile {
  version: number
  hosts: SshHostEntry[]
}

/** Validate the wire shape of a host payload; returns a message or undefined. */
export function validateHostPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object'
  const p = payload as Record<string, unknown>
  if (typeof p.host !== 'string' || p.host.trim() === '') return 'host is required'
  if (typeof p.user !== 'string' || p.user.trim() === '') return 'user is required'
  const auth = p.auth as Record<string, unknown> | undefined
  if (auth !== undefined) {
    if (typeof auth !== 'object' || auth === null) return 'auth must be an object'
    if (auth.kind !== 'key' && auth.kind !== 'password') return 'auth.kind must be key or password'
    if (auth.kind === 'key' && (typeof auth.keyPath !== 'string' || auth.keyPath.trim() === '')) {
      return 'auth.keyPath is required for key auth'
    }
    if (auth.kind === 'password' && auth.password !== undefined && typeof auth.password !== 'string') {
      return 'auth.password must be a string when provided'
    }
  }
  if (p.port !== undefined && (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535)) {
    return 'port must be an integer in 1..65535'
  }
  if (p.proxyJump !== undefined && (!Array.isArray(p.proxyJump) || p.proxyJump.some(x => typeof x !== 'string' || x === ''))) {
    return 'proxyJump must be an array of alias strings'
  }
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some(x => typeof x !== 'string'))) {
    return 'tags must be an array of strings'
  }
  return undefined
}

/** Alias grammar: letters/digits plus dots, hyphens, underscores (IP/domain aliases included). */
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Validate an alias for creation. */
export function validateAlias(alias: string): string | undefined {
  if (!ALIAS_RE.test(alias)) return 'alias must be letters, digits, dots, hyphens or underscores'
  return undefined
}

/**
 * The host store. Pure file I/O — no cordis dependency, unit-testable.
 */
export class HostStore {
  /** The JSON file path. */
  readonly path: string
  /** Optional override of the ~/.ssh/config path (tests). */
  private readonly sshConfigOverride: string | undefined

  /**
   * @param path - store file path (defaults to the standard location).
   * @param sshConfigOverride - ssh config path override (tests only).
   */
  constructor(path?: string, sshConfigOverride?: string) {
    this.path = resolve(path ?? storePath())
    this.sshConfigOverride = sshConfigOverride
  }

  /** Load all entries (empty store when the file is absent). */
  list(): SshHostEntry[] {
    const file = this.load()
    return file.hosts
  }

  /** Find one entry by alias. */
  find(alias: string): SshHostEntry | undefined {
    return this.list().find(entry => entry.alias === alias)
  }

  /** Secret-free projection for the browser and agent surfaces. */
  summarize(entry: SshHostEntry): SshHostSummary {
    let keyReady = true
    if (entry.auth.kind === 'key' && entry.auth.keyPath) {
      keyReady = existsSync(expandHome(entry.auth.keyPath))
    }
    return {
      alias: entry.alias,
      host: entry.host,
      port: entry.port,
      user: entry.user,
      auth: entry.auth.kind,
      keyReady,
      proxyJump: [...entry.proxyJump],
      // Optional fields are spread conditionally: the tool bridge rejects
      // undefined-valued properties as non-lossless JSON.
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.environment !== undefined ? { environment: entry.environment } : {}),
      tags: [...entry.tags],
      ...(entry.location !== undefined ? { location: entry.location } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  /** Create one entry. Throws on alias collision or invalid payload. */
  create(payload: HostPayload): SshHostEntry {
    const alias = payload.alias?.trim()
    if (!alias) throw new Error('alias is required')
    const aliasError = validateAlias(alias)
    if (aliasError !== undefined) throw new Error(aliasError)
    const bodyError = validateHostPayload(payload)
    if (bodyError !== undefined) throw new Error(bodyError)
    if (payload.auth === undefined) throw new Error('auth is required')
    const file = this.load()
    if (file.hosts.some(entry => entry.alias === alias)) throw new Error(`alias '${alias}' already exists`)
    const now = Date.now()
    const entry: SshHostEntry = {
      alias,
      host: payload.host.trim(),
      port: payload.port ?? 22,
      user: payload.user.trim(),
      auth: {
        kind: payload.auth.kind,
        keyPath: payload.auth.kind === 'key' ? expandHome(payload.auth.keyPath?.trim() ?? '') : undefined,
        passphrase: payload.auth.kind === 'key' ? payload.auth.passphrase ?? undefined : undefined,
        password: payload.auth.kind === 'password' ? payload.auth.password : undefined,
      },
      proxyJump: [...(payload.proxyJump ?? [])],
      description: payload.description?.trim() || undefined,
      environment: payload.environment?.trim() || undefined,
      tags: [...(payload.tags ?? [])].map(tag => tag.trim()).filter(tag => tag !== ''),
      location: payload.location?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    file.hosts.push(entry)
    this.save(file)
    return entry
  }

  /** Update the fields present in `patch`; unknown aliases throw. */
  update(alias: string, patch: Partial<HostPayload>): SshHostEntry {
    const file = this.load()
    const entry = file.hosts.find(candidate => candidate.alias === alias)
    if (entry === undefined) throw new Error(`alias '${alias}' not found`)
    // Partial-patch validation: only the present fields are checked (a
    // caller may update just tags without resending host/user).
    if (patch.host !== undefined && (typeof patch.host !== 'string' || patch.host.trim() === '')) {
      throw new Error('host is required')
    }
    if (patch.user !== undefined && (typeof patch.user !== 'string' || patch.user.trim() === '')) {
      throw new Error('user is required')
    }
    if (patch.port !== undefined && (typeof patch.port !== 'number' || !Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) {
      throw new Error('port must be an integer in 1..65535')
    }
    if (patch.proxyJump !== undefined && (!Array.isArray(patch.proxyJump) || patch.proxyJump.some(x => typeof x !== 'string' || x === ''))) {
      throw new Error('proxyJump must be an array of alias strings')
    }
    if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.some(x => typeof x !== 'string'))) {
      throw new Error('tags must be an array of strings')
    }
    if (patch.host !== undefined) entry.host = patch.host.trim()
    if (patch.port !== undefined) entry.port = patch.port
    if (patch.user !== undefined) entry.user = patch.user.trim()
    if (patch.auth !== undefined) {
      const auth = patch.auth
      if (auth.kind !== 'key' && auth.kind !== 'password') throw new Error('auth.kind must be key or password')
      if (auth.kind === 'key' && (typeof auth.keyPath !== 'string' || auth.keyPath.trim() === '')) {
        throw new Error('auth.keyPath is required for key auth')
      }
      if (auth.kind === 'password' && auth.password !== undefined && typeof auth.password !== 'string') {
        throw new Error('auth.password must be a string when provided')
      }
      // A changed key path with no passphrase means the new key has none;
      // only keep the old passphrase when the key path is unchanged.
      const keyChanged = auth.kind === 'key'
        && auth.keyPath !== undefined
        && expandHome(auth.keyPath.trim()) !== entry.auth.keyPath
      entry.auth = {
        kind: auth.kind,
        keyPath: auth.kind === 'key' ? expandHome(auth.keyPath?.trim() ?? '') : undefined,
        passphrase: auth.kind === 'key'
          ? (auth.passphrase !== undefined ? auth.passphrase : (keyChanged ? undefined : entry.auth.passphrase))
          : undefined,
        password: auth.kind === 'password' ? auth.password : undefined,
      }
    }
    if (patch.proxyJump !== undefined) entry.proxyJump = [...patch.proxyJump]
    if (patch.description !== undefined) entry.description = patch.description.trim() || undefined
    if (patch.environment !== undefined) entry.environment = patch.environment.trim() || undefined
    if (patch.tags !== undefined) entry.tags = [...patch.tags].map(tag => tag.trim()).filter(tag => tag !== '')
    if (patch.location !== undefined) entry.location = patch.location.trim() || undefined
    entry.updatedAt = Date.now()
    this.save(file)
    return entry
  }

  /** Remove one entry. */
  delete(alias: string): void {
    const file = this.load()
    const index = file.hosts.findIndex(candidate => candidate.alias === alias)
    if (index < 0) throw new Error(`alias '${alias}' not found`)
    file.hosts.splice(index, 1)
    this.save(file)
  }

  /**
   * Import hosts from `~/.ssh/config`: Host blocks with a single non-wildcard
   * pattern and a HostName become entries (key auth via IdentityFile, jump
   * hosts via ProxyJump). Existing aliases are skipped.
   * @returns import statistics.
   */
  importFromSshConfig(): ImportResult {
    // Per-run statistics: a later import must not report earlier runs' skips.
    this.skippedNames = new Set<string>()
    const configPath = this.sshConfigOverride ?? sshConfigPath()
    if (!existsSync(configPath)) return { parsed: 0, added: 0, skipped: 0, skippedNames: [] }
    const lines = readFileSync(configPath, 'utf8').split(/\r?\n/)
    const blocks: { pattern: string; props: Record<string, string> }[] = []
    let current: { pattern: string; props: Record<string, string> } | undefined
    const skip = (name: string, seen: Set<string>): void => {
      if (name !== '' && !seen.has(name)) {
        seen.add(name)
        this.skippedNames.add(name)
      }
    }
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      const match = /^([A-Za-z0-9_\-]+)\s+(.+)$/.exec(line)
      if (match === null) continue
      const key = match[1].toLowerCase()
      const value = match[2].trim()
      if (key === 'host') {
        current = { pattern: value, props: {} }
        blocks.push(current)
      } else if (current !== undefined) {
        current.props[key] = value
      }
    }
    let added = 0
    for (const block of blocks) {
      const pattern = block.pattern.split(/\s+/)[0]
      if (pattern.includes('*') || pattern.includes('?')) {
        skip(pattern, this.skippedNames)
        continue
      }
      const hostName = block.props.hostname
      if (hostName === undefined || hostName === '') {
        skip(pattern, this.skippedNames)
        continue
      }
      const existing = this.list().some(entry => entry.alias === pattern)
      if (existing) {
        skip(pattern, this.skippedNames)
        continue
      }
      const payload: HostPayload = {
        alias: pattern,
        host: hostName,
        port: block.props.port !== undefined ? Number.parseInt(block.props.port, 10) : 22,
        user: block.props.user ?? process.env.USER ?? 'root',
        auth: {
          kind: block.props.identityfile !== undefined ? 'key' : 'password',
          keyPath: block.props.identityfile,
          password: block.props.password,
        },
        proxyJump: block.props.proxyjump !== undefined
          ? block.props.proxyjump.split(',').map(hop => hop.trim()).filter(hop => hop !== '')
          : [],
        description: block.props.description,
        environment: block.props.environment,
        tags: (block.props.tags ?? '').split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
        location: block.props.location,
      }
      try {
        this.create(payload)
        added += 1
      } catch {
        // Unusable entry (bad alias grammar etc.) — count as skipped.
        skip(pattern, this.skippedNames)
      }
    }
    return { parsed: blocks.length, added, skipped: this.skippedNames.size, skippedNames: [...this.skippedNames] }
  }

  private skippedNames = new Set<string>()

  private load(): StoreFile {
    if (!existsSync(this.path)) return { version: FORMAT_VERSION, hosts: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.hosts)) {
        throw new Error('store file shape invalid')
      }
      return parsed
    } catch {
      // A corrupt store must not brick the plugin — and must not be silently
      // overwritten by the next save: rename it aside for manual recovery
      // (the plugin then starts from an empty list).
      try {
        renameSync(this.path, `${this.path}.corrupt-${Date.now()}`)
      } catch { /* best effort */ }
      return { version: FORMAT_VERSION, hosts: [] }
    }
  }

  private save(file: StoreFile): void {
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = this.path + '.tmp'
    // Secrets live in this file: keep it readable by the owner only. The
    // tmp file carries the 0600 mode through the rename.
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
  }
}

/** Expand a leading `~` in a filesystem path. */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
