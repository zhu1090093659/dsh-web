import type { ActionsDecl, StoreHandle, StoreInstance, StoreSpec } from '@deepseek-ai/dsh-client-ui-slots';
export type { ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec, } from '@deepseek-ai/dsh-client-ui-slots';
/** Minimal observable snapshot source: Session objects and snapshot stores both satisfy it. */
export interface ObservableSnapshot<T> {
    getSnapshot(): T;
    subscribe(fn: () => void): () => void;
}
/** Writable snapshot store (bare data face; React selector hooks are synthesized in web-react). */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
    /**
     * Mutate the state through an immer draft.
     * @param mutator - draft mutator.
     */
    update(mutator: (draft: T) => void): void;
    /**
     * Replace the state wholesale.
     * @param next - next state.
     */
    set(next: T): void;
}
/**
 * Shallow equality for selector slices (zustand/shallow semantics; travels
 * with the engine so hook consumers need no zustand dependency).
 * @param a - left value.
 * @param b - right value.
 * @returns whether the values are shallowly equal.
 */
export declare function shallowEqual(a: unknown, b: unknown): boolean;
/**
 * Create a snapshot store.
 *
 * Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
 * stores opt into 'raf', where a frame's worth of updates coalesces into one
 * notification. Known raf-mode tradeoff: a component mounting mid-frame reads
 * fresh state while existing subscribers hear it next flush — transient
 * frame-level skew, same nature as the object layer's microtask batching.
 *
 * @param init - initial state.
 * @param opts - flush mode and opt-in persistence (localStorage, keyed by name).
 * @returns the store.
 */
export declare function createSnapshotStore<T>(init: T, opts?: {
    flush?: 'raf' | 'sync';
    persist?: {
        name: string;
    };
}): SnapshotStore<T>;
/** A live engine instance: the contract instance plus the raw engine store. */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> extends StoreInstance<T, A> {
    /** The underlying engine store (framework/test API; components never see it). */
    readonly store: SnapshotStore<T>;
}
/** The engine-backed handle: create() narrowed to the engine instance. */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {
    /**
     * Construct a live engine instance (see the contract JSDoc on
     * {@link StoreHandle.create} for scopeKey/persist semantics).
     *
     * Known boundary: the persist key is the storage identity, so multiple live
     * instances created under the same resolved key share (and cross-pollute)
     * one localStorage entry. Instance uniqueness per key is the caller's
     * responsibility — production is safe because the framework caches one
     * instance per handle x scope key; tests wanting isolation use distinct
     * scope keys or persist-free declarations (multi-create freedom is a
     * feature there, so create() deliberately does not dedupe or throw).
     * @param scopeKey - session id for session-scope instances; omitted for root scope.
     * @returns the engine instance.
     */
    create(scopeKey?: string): EngineStoreInstance<T, A>;
}
/**
 * Declare a store: initial state, optional persistence, and the full write
 * set as pure draft mutators. The returned handle is the registration
 * currency of the store seat — its identity keys instance sharing. Satisfies
 * ui-slots' DefineStore contract (the handle/instance are the engine-extended
 * subtypes).
 *
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter (context-sensitive functions defer),
 * so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
 * future TS version breaks this single-literal inference, the design's
 * documented fallback is currying (`defineStore(init).actions({...})`).
 * @param decl - init lambda (fresh state per instance), optional persist key, actions table.
 * @returns the store handle.
 */
export declare function defineStore<T, A extends ActionsDecl<T>>(decl: StoreSpec<T, A> & {
    actions: A & ActionsDecl<T>;
}): EngineStoreHandle<T, A>;
//# sourceMappingURL=store.d.ts.map