/**
 * Installed-skill ledger: which skill paths the manager installed, so
 * uninstall can refuse to delete anything it did not place.
 *
 * Stored at `<dshHome>/skill-manager.json` (0600, atomic write), the same
 * trust model as dsh-ssh.json: the file is machine-local user data, not a
 * secret. A corrupt or unreadable ledger falls back to an empty one and the
 * next write repairs it.
 * @module @linxin666/dsh-skill-manager/ledger
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** One installed skill record. */
export interface InstalledSkill {
  /** Skill name (kebab-case). */
  name: string
  /** Absolute path of the installed skill file or directory. */
  path: string
  /** Unix epoch milliseconds of the install. */
  installedAt: number
}

/** Ledger document shape; `version` guards future migrations. */
export interface LedgerDocument {
  version: 1
  installed: InstalledSkill[]
}

/** Parse a ledger document; undefined when the text is not a usable ledger. */
export function parseLedgerDocument(text: string): LedgerDocument | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.installed)) return undefined
  const installed: InstalledSkill[] = []
  for (const item of record.installed) {
    if (typeof item !== 'object' || item === null) return undefined
    const entry = item as Record<string, unknown>
    if (typeof entry.name !== 'string' || entry.name === '') return undefined
    if (typeof entry.path !== 'string' || entry.path === '') return undefined
    if (typeof entry.installedAt !== 'number') return undefined
    installed.push({ name: entry.name, path: resolve(entry.path), installedAt: entry.installedAt })
  }
  return { version: 1, installed }
}

/** File-system edge the ledger needs, injectable for tests. */
export interface LedgerIo {
  /** Read the ledger file; reject with ENOENT when absent. */
  readFile: (path: string) => Promise<string>
  /** Atomically write the ledger file (tmp file + rename). */
  writeFileAtomic: (path: string, text: string) => Promise<void>
}

/** Node-based ledger IO used by the host process. */
export const nodeLedgerIo: LedgerIo = {
  async readFile(path) {
    return await readFile(path, { encoding: 'utf8' })
  },
  async writeFileAtomic(path, text) {
    await mkdir(dirname(path), { recursive: true })
    const tmp = join(dirname(path), `.${resolve(path).split(/[\\/]/).pop() ?? 'ledger'}.tmp-${process.pid}-${Date.now()}`)
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 })
    try {
      await chmod(tmp, 0o600)
    } catch {
      // Windows has no meaningful chmod; the rename below still applies.
    }
    await rename(tmp, path)
  },
}

/** Ledger over one file path. */
export class SkillLedger {
  /** @param filePath - absolute ledger file path. */
  constructor(
    private readonly filePath: string,
    private readonly io: LedgerIo = nodeLedgerIo,
  ) {}

  /**
   * Read the ledger, falling back to an empty document when absent or corrupt.
   * @returns the current ledger document.
   */
  async load(): Promise<LedgerDocument> {
    let text: string
    try {
      text = await this.io.readFile(this.filePath)
    } catch {
      return { version: 1, installed: [] }
    }
    return parseLedgerDocument(text) ?? { version: 1, installed: [] }
  }

  /**
   * Find the recorded entry owning one skill file path: an exact recorded
   * path, or any recorded directory that is an ancestor of it (directory
   * bundles record the skill directory, while the registry reports the
   * SKILL.md file inside it).
   * @param path - the skill file path reported by the registry.
   * @returns the owning record, or undefined when none matches.
   */
  async find(path: string): Promise<InstalledSkill | undefined> {
    const doc = await this.load()
    const canonical = resolve(path)
    const separator = canonical.includes('/') ? '/' : '\\'
    return doc.installed.find(entry => {
      if (entry.path === canonical) return true
      return canonical.startsWith(entry.path + separator)
    })
  }

  /**
   * Whether the ledger records one path (exact or ancestor).
   * @param path - candidate installed path.
   * @returns whether the path is recorded.
   */
  async has(path: string): Promise<boolean> {
    return (await this.find(path)) !== undefined
  }

  /**
   * Append one install record and persist. A path already recorded is
   * replaced (re-install after uninstall).
   * @param entry - the record to store.
   * @returns the persisted document.
   */
  async record(entry: InstalledSkill): Promise<LedgerDocument> {
    const doc = await this.load()
    const canonical = resolve(entry.path)
    const next: LedgerDocument = {
      version: 1,
      installed: [
        ...doc.installed.filter(item => item.path !== canonical),
        { name: entry.name, path: canonical, installedAt: entry.installedAt },
      ],
    }
    await this.io.writeFileAtomic(this.filePath, JSON.stringify(next, null, 2) + '\n')
    return next
  }

  /**
   * Remove one recorded path and persist.
   * @param path - the recorded path to drop.
   * @returns the persisted document.
   */
  async remove(path: string): Promise<LedgerDocument> {
    const doc = await this.load()
    const canonical = resolve(path)
    const next: LedgerDocument = {
      version: 1,
      installed: doc.installed.filter(item => item.path !== canonical),
    }
    await this.io.writeFileAtomic(this.filePath, JSON.stringify(next, null, 2) + '\n')
    return next
  }
}