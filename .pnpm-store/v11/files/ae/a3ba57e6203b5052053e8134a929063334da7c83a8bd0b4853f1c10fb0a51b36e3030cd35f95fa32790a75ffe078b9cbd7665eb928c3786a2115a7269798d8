import type { Awaitable, Dict } from '@deepseek-ai/cosmokit';
import { Context } from './context.ts';
import type { Plugin } from './registry.ts';
import { DisposableList } from './utils.ts';
import type { Impl } from './reflect.ts';
import type { StandardSchemaV1 } from '@standard-schema/spec';
declare module './context.ts' {
    interface Context extends Pick<Fiber, 'effect'> {
        /** The fiber (plugin runtime instance) that owns this context. */
        fiber: Fiber;
    }
}
/** Error raised when plugin configuration fails standard-schema validation. */
export declare class ValidationError extends TypeError {
    name: string;
    /**
     * Build the aggregated message from schema issues.
     *
     * @param issues — the standard-schema issues, one message line each.
     */
    constructor(issues: readonly StandardSchemaV1.Issue[]);
}
/**
 * Validate and normalize config for a plugin runtime before it starts.
 *
 * @param runtime — the plugin runtime whose `Config` schema to apply.
 * @param config — the raw user config.
 * @returns the validated config, or `config` unchanged if the runtime has no schema.
 * @throws {ValidationError} when validation reports issues.
 */
export declare function resolveConfig(runtime: Plugin.Runtime, config: any): any;
interface AsyncDisposable<T extends Awaitable<void> = Awaitable<void>> extends PromiseLike<() => T> {
    (): T;
}
/**
 * Function returned by an effect to release resources during disposal.
 *
 * Disposers run in reverse registration order when the owning fiber unloads;
 * they may be async, in which case unloading awaits them.
 */
export type Disposable<T = any> = () => T;
/**
 * Effect body result accepted by `ctx.effect()` and plugin startup.
 *
 * Either a single disposer, a promise of one, or a (possibly async) iterable
 * yielding several — generator effects register each yielded disposer as it
 * is produced.
 */
export type Effect<T = any> = SyncEffect<T> | AsyncEffect<T>;
type SyncEffect<T = any> = Disposable<T> | Iterable<Disposable<T>, void, void>;
type AsyncEffect<T = any> = Promise<Disposable<T>> | AsyncIterable<Disposable<T>, void, void>;
/** Tree node used to expose nested effect labels for diagnostics. */
export interface EffectMeta {
    /** Human-readable effect label, e.g. `ctx.on("event")` or `ctx.provide("name")`. */
    label: string;
    /** Metadata of nested effects registered while this effect ran. */
    children: EffectMeta[];
}
/**
 * Lifecycle state for one plugin fiber.
 *
 * `PENDING` — waiting for required services; `LOADING` — the plugin callback
 * is running; `ACTIVE` — loaded and providing; `FAILED` — the callback or its
 * config threw; `UNLOADING` — disposers are running; `DISPOSED` — the fiber
 * was removed and cannot restart.
 */
export declare const enum FiberState {
    PENDING = 0,
    LOADING = 1,
    ACTIVE = 2,
    FAILED = 3,
    DISPOSED = 4,
    UNLOADING = 5
}
/** Framework error with a stable machine-readable code. */
export declare class CordisError extends Error {
    code: CordisError.Code;
    /**
     * @param code — the stable error code; also the default message.
     * @param message — optional human-readable override.
     */
    constructor(code: CordisError.Code, message?: string);
}
/** Cordis error code definitions. */
export declare namespace CordisError {
    type Code = keyof typeof Code;
    const Code: {
        readonly INACTIVE_EFFECT: "cannot create effect on inactive context";
    };
}
/**
 * Runtime instance of one plugin application.
 *
 * A fiber tracks dependency state, validated config, lifecycle effects, and
 * cleanup for the plugin context returned by `ctx.plugin()`.
 */
export declare class Fiber {
    parent: Context;
    inject: Dict<any>;
    runtime: Plugin.Runtime | null;
    /** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
    uid: number | null;
    /** The context this fiber's plugin runs in (extends the parent context). */
    readonly ctx: Context;
    /** The validated plugin config (updated by `update()`). */
    config: any;
    /** The raw plugin config, re-resolved before each activation. */
    _config: any;
    /** Current lifecycle state; transitions emit `internal/status`. */
    state: FiberState;
    /** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
    readonly dispose: () => Promise<void>;
    /** Snapshot of required service implementations while loaded; `undefined` otherwise. */
    store: Dict<Impl> | undefined;
    /** The in-flight load/unload transition, if one is currently running. */
    inertia: Promise<void> | undefined;
    readonly _hooks: Dict<DisposableList<Function>>;
    readonly _disposables: DisposableList<Disposable<any>>;
    protected context: Context;
    private _error;
    private _runner;
    private _store;
    /**
     * Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
     * rather than constructing them directly.
     *
     * @param parent — the context the plugin was loaded from.
     * @param config — raw config, validated against the runtime's schema.
     * @param inject — resolved dependency map (service name → intercept config).
     * @param runtime — the shared plugin runtime, or `null` for the root fiber.
     * @param getOuterStack — captures the caller stack for effect diagnostics.
     */
    constructor(parent: Context, config: any, inject: Dict<any>, runtime: Plugin.Runtime | null, getOuterStack: () => string[]);
    /** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
    get name(): string;
    /**
     * Throw if the fiber has already been disposed.
     *
     * @returns nothing when the fiber is still active.
     * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
     */
    assertActive(): void;
    private _execute;
    /**
     * Register a cleanup-aware effect on this fiber.
     *
     * `execute` runs immediately; the disposers it produces are collected and
     * run (in reverse order) either when the returned disposer is called or
     * when the fiber unloads, whichever comes first. Calling the disposer twice
     * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
     * already disposed, and `TypeError` if `execute` returns an invalid shape.
     *
     * @param execute — the effect body; see {@link Effect} for accepted shapes.
     * @param label — effect label shown in `getEffects()` diagnostics.
     * @returns a disposer that tears the effect down and settles once done.
     */
    effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>;
    /** Same as above for async effects; the disposer is also awaitable. */
    effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>;
    /**
     * Return metadata for currently registered effects.
     *
     * @returns one {@link EffectMeta} tree per labeled live effect.
     */
    getEffects(): EffectMeta[];
    private _getState;
    private _updateState;
    _checkImpl(name: string): boolean | undefined;
    _refresh(): void;
    private _setEpoch;
    private _resolveConfig;
    private _reload;
    private _unload;
    /**
     * Wait for current lifecycle work and rethrow startup errors.
     *
     * @returns this fiber, once it has settled into a stable state.
     * @throws the config-validation or plugin-startup error, if any.
     */
    await(): Promise<this>;
    /**
     * Dispose and immediately reload this plugin with its current config.
     *
     * @returns a promise resolving once the reload settled.
     * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
     */
    restart(): Promise<void>;
    /**
     * Validate and apply new config, then restart the plugin.
     *
     * Runs the `internal/update` waterfall first, so update hooks (and HMR)
     * can veto or replace the restart.
     *
     * @param config — the new raw config; validated before anything restarts.
     * @param noSave — hint for persistence hooks not to write the change back.
     * @returns the update waterfall result; the default restart returns a promise.
     * @throws when validation, an update listener, or the restarted plugin fails.
     */
    update(config: any, noSave?: boolean): void | Promise<void>;
}
export {};
//# sourceMappingURL=fiber.d.ts.map