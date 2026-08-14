/**
 * Package-owned invariant companion for `@linxin666/dsh-remote-web-ui`.
 * @module @linxin666/dsh-remote-web-ui/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@linxin666/dsh-remote-web-ui'

/** Cordis companion plugin name. */
export const name = 'remote-web-ui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no durable package-local event
 * stream; its route-table and device-session relationships are asserted by
 * the package's own specs (route register/dispose symmetry via the
 * webServer disposer contract, token/revocation semantics on the service).
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
