/**
 * Fallback ledger for plugin enable/disable intents that could not be
 * written into the user patch layer: `<dshHome>/plugin-manager.json`
 * (0600, atomic write). The host half replays recorded disable intents
 * after the loader settles on the next boot.
 *
 * Only DISABLE intents are recorded: enabling is never deferred, because a
 * plugin that failed to start live would fail the whole boot if re-enabled
 * from a ledger.
 * @module @linxin666/dsh-plugin-manager/ledger
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** One recorded disable intent. */
export interface PluginLedgerEntry {
  /** The loader entry id to disable. */
  entryId: string
  /** Always true: the ledger only records disable intents. */
  disabled: boolean
  /** Unix epoch milliseconds of the record. */
  updatedAt: number
}

/** Ledger document shape; `version` guards future migrations. */
export interface PluginLedgerDocument {
  version: 1
  entries: PluginLedgerEntry[]
}

/** Parse a ledger document; undefined when the text is not a usable ledger. */
export function parsePluginLedgerDocument(text: string): PluginLedgerDocument | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.entries)) return undefined
  const entries: PluginLedgerEntry[] = []
  for (const item of record.entries) {
    if (typeof item !== 'object' || item === null) return undefined
    const entry = item as Record<string, unknown>
    if (typeof entry.entryId !== 'string' || entry.entryId === '') return undefined
    if (typeof entry.disabled !== 'boolean' || entry.disabled !== true) return undefined
    if (typeof entry.updatedAt !== 'number') return undefined
    entries.push({ entryId: entry.entryId, disabled: true, updatedAt: entry.updatedAt })
  }
  return { version: 1, entries }
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
export class PluginLedger {
  /** @param filePath - absolute ledger file path. */
  constructor(
    private readonly filePath: string,
    private readonly io: LedgerIo = nodeLedgerIo,
  ) {}

  /**
   * Read the ledger, falling back to an empty document when absent or corrupt.
   * @returns the current ledger document.
   */
  async load(): Promise<PluginLedgerDocument> {
    let text: string
    try {
      text = await this.io.readFile(this.filePath)
    } catch {
      return { version: 1, entries: [] }
    }
    return parsePluginLedgerDocument(text) ?? { version: 1, entries: [] }
  }

  /**
   * The recorded disable intents.
   * @returns the recorded entries.
   */
  async disableIntents(): Promise<PluginLedgerEntry[]> {
    return (await this.load()).entries
  }

  /**
   * Record or clear one intent and persist. Disable intents are upserted;
   * recording an enable clears the entry (enables are never deferred).
   * @param entryId - the loader entry id.
   * @param disabled - whether the entry should stay disabled.
   * @returns the persisted document.
   */
  async set(entryId: string, disabled: boolean): Promise<PluginLedgerDocument> {
    const doc = await this.load()
    const next: PluginLedgerDocument = disabled
      ? {
        version: 1,
        entries: [
          ...doc.entries.filter(item => item.entryId !== entryId),
          { entryId, disabled: true, updatedAt: Date.now() },
        ],
      }
      : {
        version: 1,
        entries: doc.entries.filter(item => item.entryId !== entryId),
      }
    await this.io.writeFileAtomic(this.filePath, JSON.stringify(next, null, 2) + '\n')
    return next
  }

  /**
   * Drop one intent and persist.
   * @param entryId - the loader entry id.
   * @returns the persisted document.
   */
  async remove(entryId: string): Promise<PluginLedgerDocument> {
    return await this.set(entryId, false)
  }
}
