/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-settings`.
 * @module @deepseek-ai/dsh-settings/invariant
 */
import { deepEqualJson } from "./index.js";
const PACKAGE_NAME = '@deepseek-ai/dsh-settings';
/** Cordis companion plugin name. */
export const name = 'settings-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * Install the commit-event contract: `settings/updated` fires only for a
 * currently registered namespace, only when the resolved value changed, and
 * only with the service's authoritative resolved value — all judged with the
 * seam's own equality predicate.
 */
const install = (ctx, fail) => {
    ctx.on('settings/updated', (ns, next, prev) => {
        const settings = ctx.get('settings');
        if (settings === undefined) {
            fail(`settings/updated for "${ns}" emitted without a live settings service`);
        }
        const current = settings.get(ns);
        if (current === undefined) {
            fail(`settings/updated for "${ns}" emitted while the namespace is unregistered`);
        }
        if (!deepEqualJson(current, next)) {
            fail(`settings/updated for "${ns}" does not match the authoritative resolved value`);
        }
        if (deepEqualJson(next, prev)) {
            fail(`settings/updated for "${ns}" emitted without a resolved-value change`);
        }
    });
};
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map