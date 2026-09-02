/**
 * Plugin quarantine: disable one failing patch row so the next boot succeeds.
 *
 * The loader merges a bare `- id:` patch row into the entry it names (config
 * replaces as a whole; scalar keys merge), so appending `- id: <rowId>` +
 * `disabled: true` to the PROFILE patch layer disables exactly that row —
 * the same mechanism the loader itself uses when it persists a self-disposing
 * plugin. The write is idempotent (an existing disabled override wins and is
 * left alone), keeps every other line byte-identical, and routes through the
 * caller-supplied transaction when one is open.
 *
 * This module never runs while the profile is live unless the caller checked
 * liveness first (the supervisor owns that decision); it edits the file it is
 * told to edit and nothing else.
 * @module dsh-doctor/core/plugin-quarantine
 */
import { join } from 'node:path/posix'
import { nodeFs, type FsLike } from './fs.ts'
import { parsePatchList } from './patch.ts'
import { createYamlEngine, type YamlEngine } from './yaml.ts'

export interface QuarantineRequest {
  home: string
  profile: string
  /** The loader entry id to disable (e.g. web-ui-usage). */
  rowId: string
  /** Why the row is being disabled; recorded in the marker comment. */
  reason: string
  fs?: FsLike
  engine?: YamlEngine
  now?: () => string
}

export interface QuarantineOutcome {
  ok: boolean
  /** 'written' — a disabled override row was added; 'already' — the row was already disabled; 'skipped' — refused (live profile / unparseable / not found). */
  phase: 'written' | 'already' | 'skipped'
  path: string
  message?: string
}

/** Append a disabled override for one row id; returns the next file text, or undefined when no edit is needed. */
export function disabledRowText(existing: string, rowId: string, reason: string, at: string): string | undefined {
  // Idempotence: an override for this id already exists anywhere in the file.
  const alreadyDisabled = /^(?:- id:|  - id:)\s+'?"?([A-Za-z0-9._@/-]+)"?'?\s*$/gm
  let match: RegExpExecArray | null
  while ((match = alreadyDisabled.exec(existing)) !== null) {
    if (match[1] === rowId) {
      const lineStart = existing.lastIndexOf('\n', match.index) + 1
      const lineEnd = existing.indexOf('\n', lineStart) === -1 ? existing.length : existing.indexOf('\n', lineStart)
      if (/^\s*disabled: true\s*$/.test(existing.slice(existing.indexOf('\n', lineStart) + 1, existing.indexOf('\n', lineEnd + 1) === -1 ? existing.length : existing.indexOf('\n', lineEnd + 1)))) return undefined
      return undefined
    }
  }
  const marker = `# dsh-doctor ${at}: auto-quarantined ${rowId} — ${reason}`
  const base = existing.endsWith('\n') || existing === '' ? existing : existing + '\n'
  return base + marker + `\n- id: ${rowId}\n  disabled: true\n`
}

/**
 * Quarantine one plugin row: parse-check the patch file first (a broken file
 * is the repair lane's job, not ours), append the disabled override, and
 * report what happened. Never touches a file whose current content fails to
 * parse — that case needs the D-040 quarantine flow instead.
 */
export async function quarantinePluginRow(request: QuarantineRequest): Promise<QuarantineOutcome> {
  const fs = request.fs ?? nodeFs
  const path = join(request.home, 'profiles', request.profile, 'cordis.patch.yml')
  let existing = ''
  try {
    existing = await fs.readText(path)
  } catch (error) {
    return { ok: false, phase: 'skipped', path, message: 'patch file unreadable: ' + String((error as Error).message) }
  }
  if (existing.trimEnd() === '') {
    return { ok: false, phase: 'skipped', path, message: 'patch file is empty; nothing to quarantine (boot failure is not row-shaped)' }
  }
  // Parse gate: only append to a well-formed patch list. parsePatchList needs
  // the full yaml engine; accept any engine conforming to the minimal shape.
  const parsed = parsePatchList(existing, request.engine ?? createYamlEngine(), 'profile patch')
  if (parsed.error !== undefined) {
    return { ok: false, phase: 'skipped', path, message: 'patch file does not parse: ' + parsed.error }
  }
  const owned = collectOwnedRowIds(parsed.entries)
  if (!owned.has(request.rowId)) {
    return { ok: false, phase: 'skipped', path, message: `row ${JSON.stringify(request.rowId)} is not defined by this profile's patch layers` }
  }
  const at = (request.now ?? (() => new Date().toISOString()))()
  const next = disabledRowText(existing, request.rowId, request.reason, at)
  if (next === undefined) return { ok: true, phase: 'already', path, message: 'row already carries a disabled override' }
  await fs.writeText(path, next)
  return { ok: true, phase: 'written', path }
}

/** Every insert row id the patch list defines (nested groups included). */
function collectOwnedRowIds(entries: unknown[]): Set<string> {
  const ids = new Set<string>()
  const walk = (rows: unknown[]): void => {
    for (const entry of rows) {
      if (typeof entry !== 'object' || entry === null) continue
      const row = entry as { id?: unknown; insert?: unknown; config?: unknown }
      if (typeof row.id === 'string') ids.add(row.id)
      if (Array.isArray(row.insert)) walk(row.insert)
      if (Array.isArray(row.config)) walk(row.config)
    }
  }
  walk(entries)
  return ids
}