/**
 * Package-owned invariant companion for `@linxin666/dsh-client-ui-git-graph`.
 * Not mounted by the bundle patch (the web profile composes no invariants
 * service); kept as the repo-convention companion for compositions that do.
 * @module @linxin666/dsh-client-ui-git-graph/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@linxin666/dsh-client-ui-git-graph'

/** Cordis companion plugin name. */
export const name = 'git-graph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns no durable package-local event
 * stream — git state is external to the harness log by design (UI-triggered
 * host operations, not model-visible facts); service tests cover the guard
 * and gate contracts.
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
