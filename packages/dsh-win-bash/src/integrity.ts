/**
 * Windows mandatory-integrity-label inspection for the published payload cache.
 *
 * A cache under a data tree that carries an inheritable Low Mandatory Level ACE
 * produces a bash.exe that inherits that label. Windows then starts a
 * Low-integrity process even from a Medium-integrity runner
 * (TOKEN_MANDATORY_POLICY_NEW_PROCESS_MIN takes the LOWER of parent token and
 * executable image), and a Low process cannot write an ordinary Medium
 * workspace or temp directory. The bytes and SHA256 manifest are identical, so
 * a checksum-only cache check cannot see this: the defect is in the security
 * descriptor, not the file content.
 *
 * Node's fs API cannot read a SACL. The Windows built-in `icacls <path> /save`
 * writes a security descriptor as language-independent SDDL in UTF-16LE;
 * `S:...` carries the mandatory label ACEs, e.g. `(ML;OICI;NW;;;LW)` for an
 * inheritable Low label or `(ML;ID;NW;;;LW)` for an inherited one. `LW` is
 * the SDDL abbreviation of S-1-16-4096 (Low); Untrusted is S-1-16-0. Anything
 * below Medium (S-1-16-8192) can downgrade the spawned shell.
 *
 * The binary is addressed by absolute path under SystemRoot, never through
 * PATH. This module only reads; it never changes a label, a DACL, a token or a
 * user's data directory.
 * @module @linxin666/dsh-win-bash/integrity
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Integrity RID of Medium; a label below it downgrades a spawned process. */
export const MEDIUM_INTEGRITY_RID = 8192

/** Wall-clock bound on one icacls query for a security descriptor. */
export const READ_LABEL_TIMEOUT_MS = 5000

/** What one mandatory-integrity-label inspection established. */
export type IntegrityLabel = 'medium-or-higher' | 'low-or-untrusted' | 'unknown'

/**
 * A reader for one path's mandatory integrity label. The seam exists so tests
 * can drive Low/Unknown verdicts without touching the host's ACLs.
 */
export type LabelReader = (target: string) => IntegrityLabel

/** One mandatory-label ACE inside an SDDL SACL: (ML;flags;rights;;;SID). */
const MANDATORY_LABEL_ACE = /\(ML;[^)]*;([^;)]+)\)/gi

/**
 * Classify the mandatory label ACEs of one icacls /save SDDL blob.
 *
 * A missing SACL means the object has no explicit label and inherits Medium by
 * default. High/System/Medium labels are harmless here; only Low or Untrusted
 * can turn a Medium runner's child into a Low process.
 * @param sddl - the UTF-16LE-decoded contents of an icacls /save file.
 * @returns the label verdict. `unknown` is reserved for the reader that could
 * not obtain or trust a descriptor at all; a parsed blob always decides.
 */
export function parseIntegritySddl(sddl: string): IntegrityLabel {
  // ML (SYSTEM_MANDATORY_LABEL_ACE_TYPE) only ever appears in the SACL. Taking
  // everything after the S: marker keeps control flags such as AI/P/AR out of
  // the match while still scanning every ACE in that section.
  const sacl = /S:([^\r\n]*)/.exec(sddl)?.[1] ?? ''
  for (const match of sacl.matchAll(MANDATORY_LABEL_ACE)) {
    const sid = (match[1] ?? '').trim().toUpperCase()
    if (sid === 'LW') return 'low-or-untrusted'
    const numeric = /^S-1-16-(\d+)$/.exec(sid)
    if (numeric !== null && Number(numeric[1]) < MEDIUM_INTEGRITY_RID) return 'low-or-untrusted'
  }
  return 'medium-or-higher'
}

/** Absolute path of the Windows icacls binary, never resolved through PATH. */
function icaclsPath(env: NodeJS.ProcessEnv): string {
  return join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'icacls.exe')
}

/**
 * Read one existing path's mandatory integrity label.
 *
 * On a POSIX host there is no Windows mandatory integrity control (and this
 * package does not mount there), so the label cannot downgrade anything. A
 * missing icacls, a failed query or an unreadable descriptor is reported as
 * `unknown` rather than guessed: the caller decides whether to fall back.
 * @param target - an existing file or directory to inspect.
 * @param env - environment supplying SystemRoot; the live one by default.
 * @returns the label verdict.
 */
export function readMandatoryLabel(target: string, env: NodeJS.ProcessEnv = process.env): IntegrityLabel {
  if (process.platform !== 'win32') return 'medium-or-higher'
  const exe = icaclsPath(env)
  if (!existsSync(exe)) return 'unknown'
  let scratch: string | undefined
  let aclFile: string | undefined
  try {
    scratch = mkdtempSync(join(tmpdir(), 'dsh-win-bash-acl-'))
    aclFile = join(scratch, 'acl-' + randomUUID().slice(0, 8) + '.txt')
    const run = spawnSync(exe, [target, '/save', aclFile], {
      windowsHide: true,
      timeout: READ_LABEL_TIMEOUT_MS,
      stdio: 'ignore',
    })
    if (run.error !== undefined || run.status !== 0 || !existsSync(aclFile)) return 'unknown'
    return parseIntegritySddl(readFileSync(aclFile).toString('utf16le'))
  } catch {
    return 'unknown'
  } finally {
    // Delete the two specific paths this call created; never a recursive delete.
    if (aclFile !== undefined) {
      try { unlinkSync(aclFile) } catch { /* already gone */ }
    }
    if (scratch !== undefined) {
      try { rmdirSync(scratch) } catch { /* already gone */ }
    }
  }
}

/**
 * The nearest existing path at or above `path`.
 *
 * A directory that does not exist yet has no descriptor of its own; a new file
 * created below it inherits the label of the closest existing ancestor. That
 * ancestor is what a pre-publication check has to inspect.
 * @param path - the prospective path.
 * @returns itself when it exists, otherwise its closest existing ancestor.
 */
export function nearestExistingAncestor(path: string): string {
  let current = resolve(path)
  for (;;) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/** Bound on the directory chain walked, so a pathological path cannot spin. */
export const MAX_ANCESTOR_DEPTH = 32

/**
 * Every existing path from `path` up to the volume root.
 *
 * A cache root can sit several levels below the data tree that a workspace
 * sandbox labelled Low, and an inheritable ACE on ANY of those ancestors can
 * still be propagated onto existing children later. Checking only the nearest
 * existing ancestor would miss that, so the whole chain is inspected.
 * @param path - the prospective path (it need not exist yet).
 * @returns the existing ancestors, nearest first.
 */
export function existingAncestors(path: string): string[] {
  const found: string[] = []
  let current = resolve(path)
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (existsSync(current)) found.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}
