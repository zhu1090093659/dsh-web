/**
 * Deterministic mapping for the dsh-web aggregate package rename.
 *
 * The runtime identifiers (web-ui-* rows, settings section, API paths,
 * storage keys) stay frozen; only the npm aggregate package name changes.
 * This module is the single migration map shared by the plugin-manager
 * update job and the Doctor preflight launcher so they never drift.
 */

/** The previously published aggregate package name. */
export const LEGACY_AGGREGATE = '@linxin666/dsh-web-ui-all'

/** The current aggregate package name. */
export const CURRENT_AGGREGATE = '@linxin666/dsh-web-all'

/** One deterministic legacy-to-current package migration. */
export interface LegacyAggregateMigration {
  from: string
  to: string
}

/** The only supported legacy aggregate migration. */
export const LEGACY_AGGREGATE_MIGRATION: LegacyAggregateMigration = {
  from: LEGACY_AGGREGATE,
  to: CURRENT_AGGREGATE,
}

/** Whether a package name is the legacy aggregate. */
export function isLegacyAggregate(name: string): boolean {
  return name === LEGACY_AGGREGATE
}

/** Whether a package name is the current aggregate. */
export function isCurrentAggregate(name: string): boolean {
  return name === CURRENT_AGGREGATE
}

/** Return the migration for a package name, or undefined when not legacy. */
export function legacyMigrationFor(name: string): LegacyAggregateMigration | undefined {
  return isLegacyAggregate(name) ? LEGACY_AGGREGATE_MIGRATION : undefined
}

/**
 * Build the exact target install spec for one legacy aggregate source.
 *
 * Local repository links are rewritten in place so development checkouts
 * keep using the repository tree; every other source is migrated through the
 * published package pinned to the family release version.
 */
export function targetSpecForLegacy(sourceSpec: string, familyVersion: string): string | undefined {
  const raw = sourceSpec.trim()
  if (raw.startsWith('link:') || raw.startsWith('file:')) {
    const prefix = raw.slice(0, raw.indexOf(':'))
    const target = raw.slice(prefix.length + 1)
    const oldSegment = 'dsh-web-ui-all'
    const index = target.lastIndexOf(oldSegment)
    if (index === -1) return undefined
    const rewritten = target.slice(0, index) + 'dsh-web-all' + target.slice(index + oldSegment.length)
    return `${prefix}:${rewritten}`
  }
  if (familyVersion === '') return undefined
  return `${CURRENT_AGGREGATE}@${familyVersion}`
}
