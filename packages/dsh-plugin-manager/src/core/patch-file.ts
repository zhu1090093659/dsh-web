/**
 * User patch-layer persistence for enable/disable switches.
 *
 * dsh web hot-watches the user patch layer `<dshHome>/cordis.patch.yml`
 * (apps/cli/profile-boot.ts watchUserPatches) and transactionally reapplies
 * it, so writing an id-targeted `disabled` override both persists across
 * restarts and applies live without one. Disabling appends or updates
 * `- id: <entryId>` + `  disabled: true`; enabling removes that override.
 * The file is edited with the yaml document API so comments and untouched
 * rows survive.
 * @module @linxin666/dsh-plugin-manager/patch-file
 */

import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'

/**
 * Merge one enable/disable override into a patch-layer document.
 * @param text - the current file text (undefined when the file is absent).
 * @param entryId - the loader entry id the override targets.
 * @param disabled - true writes the disable override, false removes it.
 * @returns the new file text, or undefined when the file already reflects
 * the requested state.
 * @throws when the document is present but not a top-level YAML array
 * (the same malformed shape dsh web fails loud on at boot).
 */
export function mergeDisabledOverride(
  text: string | undefined,
  entryId: string,
  disabled: boolean,
): string | undefined {
  if (text === undefined) {
    if (!disabled) return undefined
    return `- id: ${entryId}\n  disabled: true\n`
  }
  const doc = parseDocument(text)
  const contents = doc.contents
  if (contents === null || contents === undefined) {
    // An empty or comment-only file: no nodes to preserve, emit the override.
    if (!disabled) return undefined
    return `- id: ${entryId}\n  disabled: true\n`
  }
  if (!isSeq(contents)) {
    throw new Error('patch file must be a top-level YAML array')
  }
  for (let index = 0; index < contents.items.length; index++) {
    const item = contents.items[index]
    if (!isMap(item)) continue
    const idNode = item.get('id', true)
    const id = idNode === undefined ? undefined : String((idNode as { value?: unknown }).value)
    if (id !== entryId) continue
    if (disabled) {
      if (doc.getIn([index, 'disabled'], false) === true) return undefined
      doc.setIn([index, 'disabled'], true)
      return doc.toString()
    }
    doc.deleteIn([index, 'disabled'])
    const onlyId = item.items.every(pair => {
      const key = pair.key
      return key !== null && key !== undefined && String((key as { value?: unknown }).value) === 'id'
    })
    if (onlyId) contents.items.splice(index, 1)
    return doc.toString()
  }
  if (!disabled) return undefined
  doc.add({ id: entryId, disabled: true })
  return doc.toString()
}
/** File-system edge the patch editor needs, injectable for tests. */
export interface PatchFileIo {
  /** Read the patch file; reject with ENOENT when absent. */
  readFile: (path: string) => Promise<string>
  /** Atomically write the patch file (tmp file + rename, mode preserved). */
  writeFileAtomic: (path: string, text: string) => Promise<void>
}

/** Node-based patch IO used by the host process. */
export const nodePatchFileIo: PatchFileIo = {
  async readFile(path) {
    return await readFile(path, { encoding: 'utf8' })
  },
  async writeFileAtomic(path, text) {
    await mkdir(dirname(path), { recursive: true })
    let mode = 0o600
    try {
      mode = (await stat(path)).mode & 0o777
    } catch {
      // A new file starts at the private default; Windows ignores the mode anyway.
    }
    const tmp = join(dirname(path), `.${resolve(path).split(/[\\/]/).pop() ?? 'patch'}.tmp-${process.pid}-${Date.now()}`)
    await writeFile(tmp, text, { encoding: 'utf8', mode })
    try {
      await chmod(tmp, mode)
    } catch {
      // Windows has no meaningful chmod; the rename below still applies.
    }
    await rename(tmp, path)
  },
}

/** Editor over one user patch-layer file. */
export class PatchFileEditor {
  /** @param filePath - absolute patch file path. */
  constructor(
    private readonly filePath: string,
    private readonly io: PatchFileIo = nodePatchFileIo,
  ) {}

  /**
   * Make the patch layer reflect one enable/disable switch.
   * @param entryId - the loader entry id.
   * @param enabled - true removes the disable override, false writes it.
   * @returns true when the file was written, false when it already matched.
   * @throws on read or write failure (callers decide the fallback).
   */
  async setEnabled(entryId: string, enabled: boolean): Promise<boolean> {
    let text: string | undefined
    try {
      text = await this.io.readFile(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    }
    const next = mergeDisabledOverride(text, entryId, !enabled)
    if (next === undefined) return false
    await this.io.writeFileAtomic(this.filePath, next)
    return true
  }
}