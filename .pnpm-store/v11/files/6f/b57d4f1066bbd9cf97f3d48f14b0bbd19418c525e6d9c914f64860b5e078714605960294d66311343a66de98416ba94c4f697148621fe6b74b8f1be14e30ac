/**
 * Shared insertion-ordered storage and effect ownership for scope-aware registries.
 *
 * @module @deepseek-ai/dsh-scope
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ScopeKey } from './index.ts';
/** One scope's aggregate contribution to a registry. */
export interface ScopeLayer {
    /** Whether every table in this layer is empty. */
    isEmpty(): boolean;
}
/** Internal common read contract for the two entry-table implementations. */
interface EntryValues<V> {
    values(): IterableIterator<V>;
    isEmpty(): boolean;
}
/**
 * Insertion-ordered named entries with caller-owned duplicate diagnostics.
 *
 * Values are borrowed. Iterators are live within one nonempty table
 * generation; draining the table detaches them from later insertions. Each
 * successful insertion returns an idempotent undo for that exact entry.
 */
export declare class NamedEntries<V> implements EntryValues<V> {
    private readonly duplicateError;
    private data;
    constructor(duplicateError: (name: string) => Error);
    /**
     * Insert one unique name.
     * @param name - name unique within this table.
     * @param value - borrowed value to retain.
     * @returns an idempotent undo that removes only this insertion.
     */
    insert(name: string, value: V): () => void;
    /**
     * Read one named value.
     * @param name - name to resolve.
     * @returns the retained value, or `undefined` when absent.
     */
    get(name: string): V | undefined;
    /**
     * Test one name for membership.
     * @param name - name to test.
     * @returns whether the table contains that name.
     */
    has(name: string): boolean;
    /**
     * Iterate live names in insertion order.
     * @returns the native live key iterator.
     */
    keys(): IterableIterator<string>;
    /**
     * Iterate live entries in insertion order.
     * @returns the native live entry iterator.
     */
    entries(): IterableIterator<[string, V]>;
    /**
     * Iterate live values in insertion order.
     * @returns the native live value iterator.
     */
    values(): IterableIterator<V>;
    /**
     * Test whether this table has no entries.
     * @returns whether the table is empty.
     */
    isEmpty(): boolean;
}
/**
 * Insertion-ordered anonymous entries with independent registration identity.
 *
 * Equal values remain separate registrations. Values are borrowed, and
 * iterators are live within one nonempty table generation; draining the table
 * detaches them from later appends.
 */
export declare class AnonymousEntries<V> implements EntryValues<V> {
    private data;
    /**
     * Append one independently owned value.
     * @param value - borrowed value to retain.
     * @returns an idempotent undo for this exact append.
     */
    append(value: V): () => void;
    /**
     * Iterate live values in insertion order.
     * @returns the native live value iterator.
     */
    values(): IterableIterator<V>;
    /**
     * Test whether this table has no entries.
     * @returns whether the table is empty.
     */
    isEmpty(): boolean;
}
/**
 * Own the global and exact-scope layers for one registry.
 *
 * Reads never create scoped layers. Registrations derive both visibility and
 * effect ownership from the supplied Cordis context, collect undo before
 * notification, and reclaim only a completely empty aggregate layer.
 */
export declare class ScopedLayers<L extends ScopeLayer> {
    private readonly createLayer;
    private readonly onChange;
    /** The eagerly constructed context-global layer. */
    readonly global: L;
    private readonly scoped;
    constructor(createLayer: (scope: ScopeKey | undefined) => L, onChange: () => void);
    /**
     * Read an existing exact-scope overlay. Deliberately chain-blind: callers
     * addressing one scope's OWN contributions (its restrictions, its guards)
     * must not silently pick up an ancestor's — use {@link chainLayers} where
     * inheritance is the point.
     * @param scope - exact scope key; `undefined` denotes no overlay.
     * @returns the existing scoped layer, or `undefined` without creating one.
     */
    peek(scope: ScopeKey | undefined): L | undefined;
    /**
     * Existing overlays along the scope's parent chain ({@link scopeChainOf}),
     * farthest ancestor first and the exact scope last, so a caller layering
     * them in order gives the nearest scope the final word.
     * @param scope - viewing scope, or `undefined` for no overlays.
     * @returns the existing layers, nearest last; absent overlays are skipped.
     */
    chainLayers(scope: ScopeKey | undefined): L[];
    /**
     * Materialize global named entries followed by scope-chain shadows,
     * farthest ancestor first, so the nearest scope's entry wins a name.
     * @param scope - viewing scope, or `undefined` for the global view.
     * @param pick - select the named table from a layer.
     * @returns an insertion-ordered effective map.
     */
    merge<V>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<V>): Map<string, V>;
    /**
     * Attach one synchronous layer mutation to its registration context.
     * @param ctx - context that determines both scope visibility and effect ownership.
     * @param action - atomic mutation returning its synchronous undo.
     * @param options - Cordis effect label and optional change notification.
     * @returns the exact disposer returned by `ctx.effect()`.
     */
    effect(ctx: Context, action: (layer: L) => () => void, options: {
        label: string;
        notify?: boolean;
    }): () => void;
}
export {};
//# sourceMappingURL=store.d.ts.map