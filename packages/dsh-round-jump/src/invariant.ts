/**
 * Package-owned invariant companion for `@linxin666/dsh-round-jump`.
 * @module @linxin666/dsh-round-jump/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@linxin666/dsh-round-jump'

/** Cordis companion plugin name. */
export const name = 'round-jump-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser half renders purely from the framework
 * conversation snapshot and emits no cordis events or session writes this
 * companion could observe; its only host row is a no-op placeholder.
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
