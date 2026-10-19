/**
 * The DSH runtime compatibility verdict for one declared plugin requirement,
 * evaluated the way the official boot gate evaluates it
 * (`evaluatePluginCompatibility` in app-boot's `plugin-compatibility.ts`):
 * the requirement is a node-semver range and the host satisfies it when
 * `semver.satisfies(host, range, { includePrerelease: true })` holds. Every
 * legal range form therefore decides: `||` alternatives, `^` and `~`,
 * whitespace-separated comparators, x-ranges, and prerelease tags compared as
 * ordinary versions.
 *
 * The requirement itself comes from `dshRequirementOf` in
 * `../core/version.ts`, which owns the field priority (this module only
 * decides the verdict). Host-only on purpose: `semver` is a node package and
 * must never be reachable from the browser half, which renders the same
 * declaration through the regex-only `displayMinimumVersion`.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import semver from 'semver'

/**
 * The verdict for one declared requirement, with its cause kept apart so
 * callers can tell "this host is too old" from "we could not check".
 *
 * The distinction is user-visible: a `host-too-low` verdict is the only one
 * that may tell the user to upgrade DSH, because it is the only one where a
 * running version was actually compared and lost. An `unverifiable` verdict
 * means the question was never answered — an absent declaration, a range
 * node-semver rejects, or a host string that is not one valid version — so
 * telling the user to upgrade would send them after a fix nobody confirmed was
 * needed (issue #1819), and reporting it as "below the minimum" contradicts a
 * declaration that may well be satisfied (issue #1899).
 */
export type DshCompatibility =
  | { verdict: 'satisfied' }
  | { verdict: 'host-too-low' }
  | { verdict: 'unverifiable' }

/**
 * Decide whether the running DSH host satisfies a declared requirement range.
 * @param host - the running DSH host version.
 * @param range - the declared requirement, in any node-semver range form.
 * @returns `satisfied` when the host satisfies the declaration,
 * `host-too-low` when it was compared and does not, and `unverifiable` when
 * no comparison could be made. Callers fail closed on the last two (issue
 * #754) but must not describe them with the same words.
 */
export function evaluateDshCompatibility(host: string, range: string): DshCompatibility {
  // `semver.validRange('')` answers `'*'`, so an absent declaration would
  // otherwise read as an unconstrained range and become a satisfied verdict.
  // The official gate keeps the same `range.trim() !== ''` guard for the
  // same reason.
  if (range.trim() === '') return { verdict: 'unverifiable' }
  if (semver.validRange(range) === null) return { verdict: 'unverifiable' }
  // A host string that is not a single valid version is "cannot verify", not
  // "too old": `semver.satisfies` would silently answer false for it.
  if (semver.valid(host) === null) return { verdict: 'unverifiable' }
  return semver.satisfies(host, range, { includePrerelease: true })
    ? { verdict: 'satisfied' }
    : { verdict: 'host-too-low' }
}
