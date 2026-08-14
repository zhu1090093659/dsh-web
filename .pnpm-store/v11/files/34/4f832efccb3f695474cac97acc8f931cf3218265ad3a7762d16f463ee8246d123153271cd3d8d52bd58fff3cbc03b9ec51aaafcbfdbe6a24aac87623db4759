/**
 * Scoped-context primitive: mint a Cordis context that tags registrations with
 * an opaque identity and build routing-only event carriers for that identity.
 *
 * @module @deepseek-ai/dsh-scope
 */
import type { Context } from '@deepseek-ai/cordis';
export { AnonymousEntries, NamedEntries, ScopedLayers } from './store.ts';
export type { ScopeLayer } from './store.ts';
/** An opaque, identity-compared scope key. */
export type ScopeKey = object;
declare const ScopedBrand: unique symbol;
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
export type Scoped<T extends object> = object & {
    readonly [ScopedBrand]: T;
};
/** The privileged handle to move one scope key's parent link. */
export interface ScopeParentBinding {
    /**
     * Re-link the bound key to a different parent, with the same cycle check as
     * the bind. Valid only while nothing produced under the old parent is
     * retained — the blank-session recompose contract, which the holder upholds
     * because this relation cannot see what a session logged.
     * @param parent - the new enclosing scope key.
     */
    rebind(parent: ScopeKey): void;
}
/**
 * Bind `parent` as `key`'s enclosing scope, once.
 *
 * A key that already has a parent throws: there is no open re-link path, so a
 * scope's ancestry cannot be moved by anyone but the original binder, who
 * alone receives the {@link ScopeParentBinding}. A link that would close a
 * cycle is rejected, because every chain consumer walks parents to the root.
 * @param key - the child scope key.
 * @param parent - its enclosing scope key.
 * @returns the binding that alone may re-link this key.
 */
export declare function bindScopeParent(key: ScopeKey, parent: ScopeKey): ScopeParentBinding;
/**
 * Read one key's enclosing scope.
 * @param key - the scope key to inspect.
 * @returns its parent key, or `undefined` for a root scope.
 */
export declare function scopeParentOf(key: ScopeKey): ScopeKey | undefined;
/**
 * The chain from a key to its root ancestor.
 * @param key - the starting key, or `undefined` for the empty chain.
 * @returns keys nearest-first: `[key, parent, grandparent, …]`.
 */
export declare function scopeChainOf(key: ScopeKey | undefined): ScopeKey[];
/** A minted registration scope and its quiescent disposal boundaries. */
export interface Scope {
    /** Context through which scope-owned registrations are made. */
    ctx: Context;
    /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
    rawDispose: () => Promise<void> | void;
    /** Dispose every scope-owned registration; racing calls await the same completion. */
    dispose(): Promise<void>;
}
/** Options accepted by {@link createScope}. */
export interface CreateScopeOptions {
    /** Enclosing scope bound via {@link bindScopeParent} before the scope is usable; the binding stays internal. */
    parent?: ScopeKey;
}
/**
 * Mint a scope under `ctx`. The scoped context inherits the minting plugin's
 * dependency API and owns every registration made through it.
 * @param ctx - active context whose dependency API the scope inherits.
 * @param key - opaque identity used for listener routing.
 * @param options - optional scope-chain placement.
 * @returns the scoped context and exact/shared disposal boundaries.
 */
export declare function createScope(ctx: Context, key: ScopeKey, options?: CreateScopeOptions): Scope;
/**
 * Read the nearest scope tag inherited by a context.
 * @param ctx - context to inspect.
 * @returns its scope key, or `undefined` for an unscoped context.
 */
export declare function scopeOf(ctx: Context): ScopeKey | undefined;
/**
 * Build an opaque receiver that preserves the base filter, admits untagged
 * listeners globally, and admits tagged listeners for a matching key or any
 * of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
 * scope receives every descendant scope's events, which is what lets one
 * standing composition observe each of the agents composed under it. A tag
 * BELOW the dispatch key stays excluded — events flow up the chain, never
 * down.
 * @param base - subject or service whose existing Cordis filter is preserved.
 * @param key - routed scope identity, or `undefined` for an unscoped subject.
 * @returns a carrier whose subject remains available only through event arguments.
 */
export declare function scopeTarget<T extends object>(base: T, key: ScopeKey | undefined): Scoped<T>;
/**
 * Test whether a value is a scope carrier.
 * @param value - dispatch receiver to inspect.
 * @returns whether {@link scopeTarget} created it.
 */
export declare function isScopeCarrier(value: unknown): value is Scoped<object>;
/**
 * Read a carrier's routing key.
 * @param value - dispatch receiver to inspect.
 * @returns the carrier key, or `undefined` for an unkeyed/non-carrier value.
 */
export declare function carrierKeyOf(value: unknown): ScopeKey | undefined;
//# sourceMappingURL=index.d.ts.map