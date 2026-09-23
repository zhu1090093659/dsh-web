/**
 * Boot-failure attribution: map a dsh boot error trace to the plugin row id
 * that caused it.
 *
 * The dsh boot reports failures in four message shapes (re-verified against
 * @deepseek-ai/dsh-app-boot and @deepseek-ai/cordis-plugin-loader
 * 0.1.6-alpha.2):
 *
 * 1. loader entry failure — the loader's `updateError` wraps one row:
 *    `failed to <apply|import> loader entry <id> (<name>): <cause>`, nested in
 *    the include row's `<bin>: plugin tree failed to load: ...`.
 * 2. activation audit — `activationDiagnostic` lists entries that failed or
 *    never became active, one per line, under
 *    `<bin>: warning: N entry|entries did not activate`:
 *    `<id> (<name>): failed: <cause>` or
 *    `<id> (<name>): pending (waiting for services: <missing>)`.
 * 3. startup report — `startupDiagnostic` names each failing row in a block
 *    under `<bin>: startup failed: N required plugin(s) did not activate`:
 *    the row label, then ` Package: <name>`, then the failure detail lines.
 * 4. legacy activation lines (pre-alpha.2 hosts): `plugin(s) failed to load:
 *    <id>, ...` or `<name>: pending (waiting for ...)` / `<name>: fiber
 *    state ...` (those audit lines used the row NAME; callers resolve names
 *    back to rows via the composed tree).
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
  const namesByRowId = input.namesByRowId ?? {}
  const lines = input.stderrTail.split(/\r?\n/).filter(line => line.trim() !== '')
  for (const line of lines) {
    const byMessage = matchLoaderMessage(line, rowIdSet)
    if (byMessage !== undefined) return byMessage
  }
  // Audit and report lines, newest shape first: the alpha.2 audit spells
  // `<id> (<name>): <detail>`, its startup report names the row and then
  // prints `Package: <name>`, and a legacy host spelled `<name>: <detail>`.
  for (const line of lines) {
    const listMatch = /plugin\(s\) failed to load: (.+?);/.exec(line)
    if (listMatch !== null) {
      for (const id of listMatch[1].split(',').map(part => part.trim())) {
        if (rowIdSet.has(id)) return { rowId: id, source: 'failed-to-load-list', evidence: line }
      }
    }
    const entryMatch = /^\s*([^\s()]+) \(([^()]+)\): (.+)$/.exec(line)
    if (entryMatch !== null) {
      const [, entryId, entryName] = entryMatch
      if (rowIdSet.has(entryId)) return { rowId: entryId, source: 'activation-line', evidence: line }
      for (const [rowId, rowName] of Object.entries(namesByRowId)) {
        if (rowName === entryName || rowName === entryId) return { rowId, source: 'activation-line', evidence: line }
      }
    }
    const packageMatch = /^\s*Package: (\S+)\s*$/.exec(line)
    if (packageMatch !== null) {
      for (const [rowId, rowName] of Object.entries(namesByRowId)) {
        if (rowName === packageMatch[1]) return { rowId, source: 'activation-line', evidence: line }
      }
    }
    const legacyMatch = /^(.+?): (?:pending \(waiting for|fiber state)/.exec(line)
    if (legacyMatch !== null && legacyMatch[1] !== undefined) {
      const name = legacyMatch[1]
      for (const [rowId, rowName] of Object.entries(namesByRowId)) {
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