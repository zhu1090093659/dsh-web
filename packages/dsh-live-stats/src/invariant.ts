/**
 * Package-owned invariant companion for `@linxin666/dsh-live-stats`.
 * @module @linxin666/dsh-live-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@linxin666/dsh-live-stats'

/** Cordis companion plugin name. */
export const name = 'live-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the `liveTokenUsage` projection is a pure replayable
 * fold whose every published view passes the strict boundary schema at
 * projection-application time, and its served-value relation lives on the
 * projection carrier's wire path (emits no cordis event this companion could
 * observe); totals need not be monotone because a final usage sample replaces
 * the earlier chunk estimate mid-step, and estimator constants are validated
 * synchronously at config resolution.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
