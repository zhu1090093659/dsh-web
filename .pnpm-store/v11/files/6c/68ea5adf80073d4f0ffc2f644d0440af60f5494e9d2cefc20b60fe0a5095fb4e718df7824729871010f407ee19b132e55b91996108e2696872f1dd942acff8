/**
 * Package-owned invariant companion for the default Agent model selection.
 *
 * The service owns no independent event relationship: settings registration
 * already validates every mutable value before `currentSelection()` can observe it.
 * The empty installer keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-agent-default-model/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "agent-default-model-invariant";
/** Services required before the companion can register. */
export declare const inject: string[];
/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map