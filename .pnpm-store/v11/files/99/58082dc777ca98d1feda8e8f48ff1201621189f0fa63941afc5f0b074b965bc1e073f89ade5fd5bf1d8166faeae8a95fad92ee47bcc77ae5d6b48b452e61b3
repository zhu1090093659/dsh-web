import type { Promisify } from '@deepseek-ai/cosmokit';
import { Context } from './context.ts';
import { Fiber, FiberState } from './fiber.ts';
/**
 * Return whether an event result should stop a bail-style dispatch.
 *
 * @param value — a listener's return value.
 * @returns `true` unless `value` is `null`, `false`, or `undefined`.
 */
export declare function isBailed(value: any): boolean;
/** Extract the parameter tuple from a function type. */
export type Parameters<F> = F extends (...args: infer P) => any ? P : never;
/** Extract the return type from a function type. */
export type ReturnType<F> = F extends (...args: any) => infer R ? R : never;
/** Extract the explicit `this` type from a function type. */
export type ThisType<F> = F extends (this: infer T, ...args: any) => any ? T : never;
/**
 * Event dispatch strategy used by the event service.
 *
 * `emit` runs synchronous listeners without awaiting them, `parallel` awaits
 * all listeners together, `serial` awaits them in order until one bails,
 * `bail` stops on the first synchronous bail value, and `waterfall` composes
 * listeners around a final `next` callback.
 */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall';
declare module './context.ts' {
    interface Context {
        /**
         * Dispatch an event, running all listeners concurrently.
         *
         * @param name — the event name.
         * @param args — arguments passed to every listener.
         * @returns a promise resolving once every listener has settled.
         */
        parallel<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): Promise<void>;
        /** Same as above, with an explicit `this` for listeners (also used for filtering). */
        parallel<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): Promise<void>;
        /**
         * Dispatch an event synchronously, ignoring listener return values.
         *
         * @param name — the event name.
         * @param args — arguments passed to every listener.
         */
        emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void;
        /** Same as above, with an explicit `this` for listeners (also used for filtering). */
        emit<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): void;
        /**
         * Dispatch an event, awaiting listeners in order until one bails.
         *
         * @param name — the event name.
         * @param args — arguments passed to each listener.
         * @returns the first bail value (non-null, non-false, non-undefined), if any.
         */
        serial<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>;
        /** Same as above, with an explicit `this` for listeners (also used for filtering). */
        serial<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>;
        /**
         * Dispatch an event, calling listeners in order until one bails.
         *
         * @param name — the event name.
         * @param args — arguments passed to each listener.
         * @returns the first bail value (non-null, non-false, non-undefined), if any.
         */
        bail<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>;
        /** Same as above, with an explicit `this` for listeners (also used for filtering). */
        bail<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>;
        /**
         * Dispatch an event whose last argument is a `next` continuation.
         *
         * Each listener wraps the rest of the chain: calling `next()` invokes the
         * next listener (finally the built-in behavior); not calling it vetoes.
         *
         * @param name — the event name.
         * @param args — listener arguments; the final one is the innermost `next`.
         * @returns the outermost listener's return value.
         */
        waterfall<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>;
        /** Same as above, with an explicit `this` for listeners (also used for filtering). */
        waterfall<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>;
        /**
         * Register an event listener owned by the current fiber.
         *
         * @param name — the event name to listen for.
         * @param listener — called with the dispatch arguments.
         * @param options — listener options; a boolean is shorthand for `prepend`.
         * @returns a disposer removing the listener; `true` if it was still registered.
         */
        on<K extends keyof Events>(name: K, listener: Events[K], options?: boolean | EventOptions): () => boolean;
        /**
         * Same as `on()`, but the listener disposes itself after its first call.
         *
         * @param name — the event name to listen for.
         * @param listener — called at most once with the dispatch arguments.
         * @param options — listener options; a boolean is shorthand for `prepend`.
         * @returns a disposer removing the listener; `true` if it was still registered.
         */
        once<K extends keyof Events>(name: K, listener: Events[K], options?: boolean | EventOptions): () => boolean;
    }
}
/** Options accepted by `ctx.on()` and `ctx.once()`. */
export interface EventOptions {
    /** Add the listener before existing listeners for the same event. */
    prepend?: boolean;
    /** Receive the event regardless of context filter checks. */
    global?: boolean;
}
/** Registered listener record stored by the event service. */
export interface Hook extends EventOptions {
    ctx: Context;
    callback: (...args: any[]) => any;
}
/**
 * Event bus installed as `ctx.events` and mixed into every context.
 *
 * The service supports concurrent, synchronous, serial, bail, and waterfall
 * dispatch and automatically disposes listeners with their owning fiber.
 */
export declare class EventsService {
    private ctx;
    _hooks: Record<keyof any, Hook[]>;
    constructor(ctx: Context);
    /**
     * Resolve listeners for one dispatch and apply context filtering.
     *
     * @param type — the dispatch mode, reported on `internal/dispatch`.
     * @param args — the raw dispatch arguments; consumed up to the event name.
     * @returns the matching listener callbacks, bound to the dispatch `this`.
     */
    dispatch(type: string, args: any[]): ((...args: any[]) => any)[];
    /**
     * Run listeners concurrently and wait for all of them.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns a promise resolving once every listener has settled.
     */
    parallel(...args: any[]): Promise<void>;
    /**
     * Run listeners synchronously without waiting for returned promises.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     */
    emit(...args: any[]): void;
    /**
     * Run listeners in order, awaiting each, until one returns a bail value.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns the first bail value (see {@link isBailed}), if any.
     */
    serial(...args: any[]): Promise<any>;
    /**
     * Run listeners synchronously until one returns a bail value.
     *
     * @param args — optional `this`, the event name, then listener arguments.
     * @returns the first bail value (see {@link isBailed}), if any.
     */
    bail(...args: any[]): any;
    /**
     * Compose listeners around the final `next` callback.
     *
     * The last dispatch argument is treated as the innermost `next`. Listeners
     * run outermost-first; a listener that does not call `next()` vetoes the
     * rest of the chain, including the built-in behavior.
     *
     * @param args — optional `this`, the event name, listener arguments, then `next`.
     * @returns the outermost listener's return value.
     */
    waterfall(...args: any[]): any;
    /**
     * Store a listener record as an effect on the current fiber.
     *
     * @param label — effect label shown in fiber diagnostics.
     * @param hooks — the listener list for one event.
     * @param callback — the listener to store.
     * @param options — placement and filtering options.
     * @returns a disposer that unregisters the listener.
     */
    register(label: string, hooks: Hook[], callback: any, options: EventOptions): () => void;
    /**
     * Remove a stored listener record.
     *
     * @param hooks — the listener list for one event.
     * @param callback — the listener to remove.
     * @returns `true` if the listener was found and removed.
     */
    unregister(hooks: Hook[], callback: any): true | undefined;
    /**
     * Register an event listener owned by the current fiber.
     *
     * The listener is removed automatically when the fiber unloads. Throws
     * `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
     *
     * @param name — the event name to listen for.
     * @param listener — called with the dispatch arguments.
     * @param options — listener options; a boolean is shorthand for `prepend`.
     * @returns a disposer removing the listener; `true` if it was still registered.
     */
    on(name: string | symbol, listener: (...args: any) => any, options?: boolean | EventOptions): any;
    /**
     * Register an event listener that disposes itself after the first call.
     *
     * @param name — the event name to listen for.
     * @param listener — called at most once with the dispatch arguments.
     * @param options — listener options; a boolean is shorthand for `prepend`.
     * @returns a disposer removing the listener; `true` if it was still registered.
     */
    once(name: string, listener: (...args: any) => any, options?: boolean | EventOptions): any;
}
/**
 * Built-in framework events used by core services and extension points.
 *
 * Plugin and status events track fiber lifecycle, service events observe
 * dependency registration, update/get/set/listener events allow core services
 * to intercept runtime operations, and `internal/dispatch` exposes event-bus
 * diagnostics before public events are delivered.
 */
export interface Events {
    /** A plugin fiber was created or its uid was cleared on disposal. */
    'internal/plugin'(fiber: Fiber): void;
    /** A fiber changed lifecycle state; receives the fiber and its previous state. */
    'internal/status'(fiber: Fiber, oldValue: FiberState): void;
    /**
     * Resolve raw plugin config after the fiber's injections become active.
     * @param config - the raw config for this activation.
     * @mode waterfall
     */
    'internal/config'(this: Fiber, config: any, next: () => any): any;
    /** Interception hook for a service binding (no core producer). */
    'internal/service'(this: Context, name: string, value: any): void;
    /** Waterfall: a fiber config update is being applied; skip `next()` to veto. */
    'internal/update'(this: Fiber, config: any, noSave: boolean, next: () => void | Promise<void>): void | Promise<void>;
    /** Waterfall: a service is being read through the context proxy. */
    'internal/get'(ctx: Context, name: string, error: Error, next: () => any): any;
    /** Waterfall: a service is being written through the context proxy. */
    'internal/set'(ctx: Context, name: string, value: any, error: Error, next: () => boolean): boolean;
    /** Bail: a listener is being registered; a non-null result replaces registration. */
    'internal/listener'(this: Context, name: string, listener: any, prepend: boolean): void;
    /** An event is being dispatched to listeners (fired for non-internal events only). */
    'internal/dispatch'(mode: DispatchMode, name: string, args: any[], thisArg: any): void;
}
//# sourceMappingURL=events.d.ts.map