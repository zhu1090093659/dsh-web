/** Package-owned invariant companion for `@deepseek-ai/dsh-api-remotes`. */
const PACKAGE_NAME = '@deepseek-ai/dsh-api-remotes';
/** Cordis companion plugin name. */
export const name = 'api-remotes-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: Typert and the Agent/Session registries own the observed relationships. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map