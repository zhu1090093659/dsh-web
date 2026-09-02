/**
 * Boot-failure attribution: map a dsh boot error trace to the plugin row id
 * that caused it.
 *
 * The dsh boot reports failures in three message shapes (verified against
 * @deepseek-ai/dsh-app-boot 0.1.2-alpha.3):
 *
 * 1. mount/apply failure — the loader entry apply rejected:
 *    `<bin>: plugin tree failed to load: failed to apply loader entry include
 *    (cordis:include): failed to apply loader entry <id> (<name>): <cause>`
 * 2. import failure — the module could not be resolved:
 *    `... failed to import loader entry <id> (<name>): <cause>`
 * 3. activation audit — assertEntriesActivated lists entries that failed or
 *    never became active:
 *    `<bin>: plugin(s) failed to load: <id>, <id>, ...` or
 *    `<bin>: N entries did not activate\n<name>: <detail>` (audit lines use
 *    the row NAME; callers resolve names back to rows via the composed tree)
 *
 * Pure over its inputs: callers hand in the captured stderr tail and the
 * known row ids; the result says which row (if any) to quarantine. A wrong
 * guess would disable a healthy plugin, so attribution is conservative:
 * only positive matches count, and every match carries its evidence line.
 * @module dsh-doctor/core/boot-attribution
 */

export interface AttributionCandidate {
  /** The failing loader entry id, as printed by the host. */
  rowId: string
  /** Where the match came from (message shape), for incident evidence. */
  source: 'apply-message' | 'import-message' | 'failed-to-load-list' | 'activation-line'
  /** The matching line from the trace. */
  evidence: string
}

export interface AttributionInput {
  /** Captured stderr tail (last bytes of the failed boot). */
  stderrTail: string
  /** Composed patch row ids this profile owns (from the dump or patch parse). */
  rowIds: readonly string[]
  /** Patch row names (package specifiers) keyed by row id, for audit lines. */
  namesByRowId?: Readonly<Record<string, string>>
}

/**
 * Attribute one boot failure to a plugin row. Returns undefined when the
 * trace names no known row — the caller must not disable anything.
 */
export function attributeBootFailure(input: AttributionInput): AttributionCandidate | undefined {
  const rowIdSet = new Set(input.rowIds)
  const lines = input.stderrTail.split(/\r?\n/).filter(line => line.trim() !== '')
  for (const line of lines) {
    const byMessage = matchLoaderMessage(line, rowIdSet)
    if (byMessage !== undefined) return byMessage
  }
  // Audit lines list bare ids (`plugin(s) failed to load: a, b`) or spell
  // `name: <stack>` per failing entry — match both against the known rows.
  for (const line of lines) {
    const listMatch = /plugin\(s\) failed to load: (.+?);/.exec(line)
    if (listMatch !== null) {
      for (const id of listMatch[1].split(',').map(part => part.trim())) {
        if (rowIdSet.has(id)) return { rowId: id, source: 'failed-to-load-list', evidence: line }
      }
    }
    const auditMatch = /^(.+?): (?:pending \(waiting for|fiber state|)/.exec(line)
    if (auditMatch !== null && auditMatch[1] !== undefined) {
      const name = auditMatch[1]
      for (const [rowId, rowName] of Object.entries(input.namesByRowId ?? {})) {
        if (rowId === name || rowName === name) return { rowId, source: 'activation-line', evidence: line }
      }
    }
  }
  return undefined
}

/** Match one trace line against the two loader message shapes. */
function matchLoaderMessage(line: string, rowIdSet: Set<string>): AttributionCandidate | undefined {
  // The host nests one failure inside another on the SAME line (the include
  // entry wraps the failing child row), so every occurrence must be
  // considered — the first capture can be the wrapper, not the culprit.
  const pattern = /failed to (?:apply|import) loader entry ([^\s()]+)/g
  const isImport = line.includes('failed to import')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    const rowId = match[1]
    if (!rowIdSet.has(rowId)) continue
    return { rowId, source: isImport ? 'import-message' : 'apply-message', evidence: line }
  }
  return undefined
}