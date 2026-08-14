/** Package-owned agent lifecycle invariants. @module @deepseek-ai/dsh-agent/invariant */
const PACKAGE_NAME = '@deepseek-ai/dsh-agent';
/** Cordis companion plugin name. */
export const name = 'agent-invariant';
/** Services required before the companion can register. */
export const inject = ['invariants'];
/** Install the agent contribution into its child registration fiber. */
const install = (ctx, fail) => {
    const lastStatus = new WeakMap();
    ctx.on('agent/status', ({ agent, status }) => {
        const previous = lastStatus.get(agent);
        if (previous === status) {
            fail(`agent/status repeated ${status} (no-op transition)`);
        }
        lastStatus.set(agent, status);
    }, { global: true });
};
/**
 * Register the agent invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map