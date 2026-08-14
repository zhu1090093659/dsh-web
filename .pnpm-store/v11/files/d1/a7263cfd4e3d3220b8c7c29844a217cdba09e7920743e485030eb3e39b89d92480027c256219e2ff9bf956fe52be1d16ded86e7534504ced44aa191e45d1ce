/**
 * Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
 * per-namespace sections; plugins register a namespace schema and read the
 * resolved value, which layers schema defaults, the registrant's composition
 * `base`, and the user document section, in that order.
 * @module @deepseek-ai/dsh-settings
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';
import type { RedactedSecret } from './redact.ts';
import type { SettingsNamespace, SettingsUpdateSource } from './types.ts';
export { redactSecrets } from './redact.ts';
export type { RedactedSecret, RedactedValue } from './redact.ts';
export type { SettingsNamespace, SettingsUpdateSource } from './types.ts';
/**
 * Brand a raw string as a {@link SettingsNamespace}.
 * @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
 * @returns the branded namespace.
 */
export declare function settingsNamespace(value: string): SettingsNamespace;
/** When a namespace's changes take effect for its owner. */
export type SettingsApplies = 'live' | 'restart';
/** Registration options beyond the namespace schema. */
export interface SettingsRegisterOptions<T> {
    /** Composition-layer values resolved below the user layer (entry-config subset). */
    base?: Partial<T>;
    /** Owner's effect timing, surfaced to configuration UIs; defaults to `live`. */
    applies?: SettingsApplies;
    /**
     * Reject a resolved section the owner could not act on, for constraints its
     * schema cannot express — a cross-field requirement, or one field's validity
     * depending on another's. Throwing here refuses the *write* that produced the
     * value, so a caller learns at `update`/`replace`/`mutate` instead of storing
     * something that would silently disable the owner.
     *
     * Kept separate from the schema because the schema is also what a
     * configuration surface renders and what an absent section resolves through;
     * folding a cross-field check into it would change both.
     *
     * Once the owner is registered, a stored section that fails this keeps the
     * namespace's last good value and warns, exactly as a schema failure does,
     * so an externally edited document cannot strand a running owner. At
     * registration there is no last good value yet, so a stored section that
     * already fails rejects the registration itself — again exactly as a schema
     * failure does.
     * @param value - the resolved section, schema-valid by construction.
     */
    validate?: (value: T) => void;
}
/** One registered namespace as surfaced to configuration UIs. */
export interface SettingsDescriptor {
    /** The registered namespace. */
    ns: SettingsNamespace;
    /** Serialized schemastery schema (`schema.toJSON()`). */
    schema: unknown;
    /** Current resolved value. */
    value: unknown;
    /**
     * Monotonic revision of the raw user section this descriptor was read at.
     * Send it back as `expectedRevision` on a write to refuse a stale one.
     */
    revision: number;
    /** Registrant's composition `base` layer (detached), when one was declared. */
    base?: unknown;
    /**
     * Raw user section from the stored document (detached), when one exists and
     * is well-formed; a field's presence here is what marks it user-overridden.
     */
    user?: unknown;
    /** Owner's declared effect timing. */
    applies: SettingsApplies;
    /** Schema-declared secret positions; present only under `redactSecrets`. */
    secrets?: RedactedSecret[];
}
/** Options for {@link SettingsProvider.describe}. */
export interface SettingsDescribeOptions {
    /**
     * Strip `role('secret')` fields from `value`/`base`/`user` and enumerate
     * them in each descriptor's `secrets`. Every wire surface MUST pass this;
     * the verbatim default exists for same-process configuration UIs only.
     */
    redactSecrets?: boolean;
}
/** Owner-facing handle for one registered namespace. */
export interface SettingsScope<T> {
    /** Current resolved value: schema defaults, then `base`, then the user layer. */
    get(): T;
    /**
     * Observe committed changes to this namespace's resolved value. Invocations
     * of one callback run asynchronously, one at a time, in commit order; a
     * rejection is contained and logged like a sync throw. After the disposer
     * returns, no further invocation starts — one already queued is skipped;
     * one already started still settles, and service disposal waits for it.
     * @param callback - invoked after each commit with the next and previous values.
     * @returns the disposer removing this observer.
     */
    watch(callback: (next: T, prev: T) => void | Promise<void>): () => void;
    /**
     * Merge a partial patch into this namespace's user layer and persist it.
     * @param patch - plain-object patch over the user section; JSON-compatible data
     * only (non-JSON values reject with their path before anything persists).
     */
    update(patch: object): Promise<void>;
    /**
     * Replace this namespace's user section wholesale; absent keys re-inherit
     * the composition `base` and schema defaults (`replace({})` resets all).
     * @param section - the complete next user section; JSON-compatible data only,
     * as for {@link update}.
     */
    replace(section: object): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        settings: SettingsProvider;
    }
}
/**
 * Deep equality over JSON-compatible data (objects, arrays, primitives) — the
 * Service Definition's single change-detection predicate, exported so the invariant
 * companion checks exactly the implementation's relation.
 * @param a - one JSON-compatible value.
 * @param b - the other JSON-compatible value.
 * @returns whether the two values are structurally equal.
 */
export declare function deepEqualJson(a: unknown, b: unknown): boolean;
/**
 * A write refused because the namespace moved since the caller read it. The
 * Service Definition's serialized write queue orders writes; it cannot tell a fresh writer
 * from one holding a stale snapshot, which is what this reports.
 */
export declare class SettingsConflictError extends Error {
    /** Stable machine code for wire layers mapping this to their own taxonomy. */
    readonly code = "SETTINGS_CONFLICT";
    /** The revision the write expected. */
    readonly expected: number;
    /** The revision the namespace actually stands at. */
    readonly actual: number;
    /**
     * @param ns - the namespace whose write was refused.
     * @param expected - the revision the caller sent.
     * @param actual - the revision now stored.
     */
    constructor(ns: SettingsNamespace, expected: number, actual: number);
}
/**
 * One path-addressed edit to a namespace's user section. Path mutation exists
 * for a caller holding an INCOMPLETE view of the section — a configuration UI
 * reads the redacted descriptor, which by construction never received the
 * `role('secret')` fields. Such a caller can name the field it means without
 * restating the section: a wholesale `replace` rebuilt from a redacted
 * document silently deletes every secret the wire never returned.
 */
export type SettingsPathOp = {
    op: 'set';
    path: readonly string[];
    value: unknown;
} | {
    op: 'unset';
    path: readonly string[];
};
/**
 * Abstract settings service. Providers implement raw-document storage
 * (`load`/`persist`) and push external changes through {@link Settings.publish};
 * the base class owns namespace registration, resolution, validation, change
 * detection, and the `settings/updated` commit event.
 */
export declare abstract class SettingsProvider extends Service {
    private readonly registrations;
    /** Latest published raw document; empty until the provider's first publish. */
    private document;
    /** Per-namespace write chains; settled tails, so a failure never poisons the queue. */
    private readonly writeQueues;
    /** In-flight watcher invocation segments, drained by the dispose teardown. */
    private readonly pendingTails;
    /** Set at service dispose: refuse new writes while queued ones drain. */
    private stopped;
    /** Opaque read of {@link stopped}: control flow cannot narrow it across awaits. */
    private isStopped;
    constructor(ctx: Context);
    /**
     * Load the provider's document once and publish it before the service
     * becomes injectable, and register the write-drain teardown. Providers with
     * their own init (watchers, connections) delegate here first via
     * `yield* super[Service.init]()`; their disposers then run before the drain.
     */
    [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void>;
    /** Whether {@link update} may persist through this provider. */
    abstract readonly writable: boolean;
    /**
     * Absolute path of the provider's user-editable document, when its storage
     * is one local file. Configuration surfaces use this only as availability
     * metadata; the guarded open operation resolves the path again Host-side.
     * Non-file providers leave it undefined and expose no open-document affordance.
     * @returns the absolute local document path, or undefined for non-file storage.
     */
    get documentPath(): string | undefined;
    /**
     * Prepare the provider's user-editable document for a native editor. File
     * providers may materialize an absent document before returning its path;
     * non-file providers return undefined.
     * @returns the absolute local document path, or undefined for non-file storage.
     */
    prepareDocument(): Promise<string | undefined>;
    /**
     * Read the provider's current raw document (namespace to raw section).
     * @returns the detached raw document.
     */
    protected abstract load(): Promise<Record<string, unknown>>;
    /**
     * Durably store one namespace's merged user section.
     * @param ns - the namespace being written.
     * @param section - the complete merged user section to store.
     */
    protected abstract persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void>;
    /**
     * Register a namespace schema and receive its owner scope. The registration
     * is an effect on the calling plugin's fiber: disposing that fiber removes
     * the namespace and its observers. An invalid stored section fails the
     * registration itself — the earliest point where the schema can judge it.
     * @param ns - unique namespace; duplicate registration fails loud.
     * @param schema - schemastery schema resolving this namespace's value.
     * @param options - composition `base` layer and effect timing.
     * @returns the owner scope for reads, observation, and updates.
     */
    register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>;
    /**
     * Describe every registered namespace for configuration surfaces, including
     * the composition `base` and raw user layers so a form can mark which fields
     * the user overrode (presence in `user`) and what a reset returns to.
     * @param options - redaction switch; wire surfaces must redact.
     * @returns one descriptor per registered namespace, in registration order.
     */
    describe(options?: SettingsDescribeOptions): SettingsDescriptor[];
    /**
     * Read one registered namespace's resolved value.
     * @param ns - the namespace to read.
     * @returns the resolved value, or `undefined` while unregistered.
     */
    get(ns: SettingsNamespace): unknown;
    /**
     * Merge a patch into one registered namespace's user layer, validate the
     * resolved candidate, persist through the provider, then commit and emit.
     * A validation failure rejects before anything is persisted. Writes to one
     * namespace are serialized: concurrent updates apply in call order, each
     * merging over the previous write's committed section.
     * @param ns - the registered namespace to update.
     * @param patch - plain-object patch over the user section.
     * @param expectedRevision - the descriptor `revision` the caller read; a
     *   namespace that moved past it rejects with {@link SettingsConflictError}.
     */
    update(ns: SettingsNamespace, patch: object, expectedRevision?: number): Promise<void>;
    /**
     * Replace one registered namespace's user section wholesale, validate,
     * persist, then commit and emit. Keys absent from `section` fall back to the
     * composition `base` and schema defaults — this is the removal/reset path a
     * merge-only patch cannot express (`replace({})` re-inherits everything).
     * @param ns - the registered namespace to replace.
     * @param section - the complete next user section.
     * @param expectedRevision - the descriptor `revision` the caller read; a
     *   namespace that moved past it rejects with {@link SettingsConflictError}.
     */
    replace(ns: SettingsNamespace, section: object, expectedRevision?: number): Promise<void>;
    /**
     * Apply path-addressed edits to one registered namespace's user section,
     * validate, persist, then commit and emit. The ops are applied to the
     * section as it stands when the write reaches the front of the queue, so a
     * caller never has to restate fields it did not touch — and, crucially,
     * cannot delete fields it never saw. This is the write path for any caller
     * holding a redacted view; `replace` remains the wholesale reset.
     * @param ns - the registered namespace to edit.
     * @param ops - ordered path edits; later ops observe earlier ones.
     * @param expectedRevision - the descriptor `revision` the caller read; a
     *   namespace that moved past it rejects with {@link SettingsConflictError}.
     */
    mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>;
    /** Validate a write, then queue it on the namespace's serialized write chain. */
    private write;
    /**
     * Provider hook: commit a complete raw document observed in storage. Each
     * registered namespace re-resolves; an invalid section keeps that
     * namespace's last good value and warns, other namespaces still commit.
     * @param doc - the detached raw document (unregistered sections preserved).
     * @param source - change origin; defaults to `provider`.
     */
    protected publish(doc: Record<string, unknown>, source?: SettingsUpdateSource): void;
    /** Read one namespace's raw user section, rejecting non-object sections. */
    private section;
    /** Resolve one namespace value: schema defaults, then `base`, then the user layer. */
    private resolve;
    /**
     * Advance a namespace's revision when its RAW section changed, and announce
     * it. Deliberately independent of {@link commit}'s resolved-value equality:
     * storing an override equal to the composition base leaves the resolved
     * value alone but changes what the document says, which is exactly what a
     * configuration surface must re-read.
     */
    private bumpRevision;
    /** Contained fan-out of `settings/document-updated`, mirroring {@link commit}'s. */
    private emitDocumentUpdated;
    /** Commit a resolved value when changed: swap, notify watchers, emit the event. */
    private commit;
    /** Contained-watcher diagnostic shared by the sync and async failure paths. */
    private warnWatcherFailure;
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    private warnListenerFailure;
}
/** Hooks a consumer hands to {@link installSettingsSection}. */
export interface SettingsSectionHooks<T> {
    /**
     * Receive the active configuration source: the resolved settings scope
     * while one is attached, the composition entry otherwise. Called before
     * the matching `onChange` at attach and at detach.
     * @param current - thunk returning the currently authoritative value.
     */
    setSource(current: () => T): void;
    /**
     * Re-judge anything derived from the source — registration-level facts,
     * memoized resolutions — after an attach, a detach, or a committed change.
     */
    onChange(): void;
    /**
     * Reject a resolved section this consumer could not act on, for constraints
     * its schema cannot express. See {@link SettingsRegisterOptions.validate}.
     * @param value - the resolved section, schema-valid by construction.
     */
    validate?: (value: T) => void;
}
/**
 * Install the canonical optional-settings consumer wiring: while a settings
 * service exists, register `ns` with the consumer's composition entry as the
 * `base` layer and point the source thunk at the resolved scope; when the
 * service goes away (disposal, provider reload), fall back to the entry so
 * the consumer keeps working exactly as composed. The registration rides the
 * scoped fiber, so no settings service ever mounted means none of this runs.
 * @param ctx - consumer plugin context owning the wiring.
 * @param ns - the consumer-owned settings namespace.
 * @param schema - schema resolving the namespace (typically the plugin Config).
 * @param entry - the consumer's composition entry config, used as `base`.
 * @param hooks - source sink and change notification.
 */
export declare function installSettingsSection<T>(ctx: Context, ns: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>): void;
export default SettingsProvider;
//# sourceMappingURL=index.d.ts.map