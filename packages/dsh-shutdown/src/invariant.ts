/**
 * Package-owned invariant companion for `@linxin666/dsh-client-ui-shutdown`.
 * @module @linxin666/dsh-client-ui-shutdown/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@linxin666/dsh-client-ui-shutdown'

/** Cordis companion plugin name. */
export const name = 'shutdown-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the shutdown surface is a loopback-only route plus a
 * bounded exit request; the fence and the exit seam are unit-tested through
 * the route factory, and there is no durable state an invariant could audit.
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
