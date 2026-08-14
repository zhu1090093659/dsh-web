import type { Dict } from '@deepseek-ai/cosmokit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Context } from './context.ts';
import { Fiber } from './fiber.ts';
import { DisposableList, symbols } from './utils.ts';
/**
 * Service dependency declaration accepted by plugins and the `@Inject`
 * decorator.
 *
 * Array form requests services without intercept config. Object form maps each
 * service name to optional intercept config for the plugin context.
 */
export type Inject<M = Dict> = (keyof M)[] | {
    [K in keyof M]?: M[K];
};
/** Context keys that correspond to services with typed intercept config. */
export type InjectKey = keyof {
    [K in keyof Context & string as Context[K] extends {
        [symbols.config]: any;
    } ? K : never]: any;
};
/**
 * Decorator for declaring service dependencies on classes or class methods.
 *
 * On classes it contributes to the plugin's static `inject` map. On methods it
 * delays the method call until the declared services are available.
 */
/**
 * @param name — the required service name.
 * @param config — optional intercept config applied for that service.
 * @returns the class or method decorator.
 */
export declare function Inject<K extends InjectKey>(name: K, config?: Context[K] extends {
    [symbols.config]: infer T;
} ? T : never): (value: any, decorator: ClassDecoratorContext<any> | ClassMethodDecoratorContext<any>) => void;
/** Utilities for normalizing plugin dependency declarations. */
export declare namespace Inject {
    /**
     * Convert array/object/class-inherited inject metadata into a plain map.
     *
     * @param inject — the declaration to normalize; `null`/`undefined` add nothing.
     * @param result — the map to fill (service name → intercept config or `null`).
     * @returns `result`.
     */
    function resolve(inject: Inject | null | undefined, result?: Dict): Dict;
}
/** Supported plugin entrypoint shapes. */
export type Plugin<T = any> = Plugin.Function<T> | Plugin.Constructor<T> | Plugin.Object<T>;
/** Types associated with plugin entrypoints and runtime records. */
export declare namespace Plugin {
    /** Shared metadata understood by the plugin registry and related tooling. */
    interface Base<T = any> {
        /** Display name used for fiber diagnostics and logger names. */
        name?: string;
        /** Standard-schema validator applied to config before the plugin starts. */
        Config?: StandardSchemaV1<any, T>;
        /** Services the plugin requires; it only loads while all are available. */
        inject?: Inject;
        /** Service name(s) the plugin provides (read by `Service` and by loaders). */
        provide?: string | string[];
        /** Service names whose intercept config the plugin declares it consumes. */
        intercept?: Dict<boolean>;
    }
    interface Transform<S, T> {
        /** Marks the transform object as a schema/config transform. */
        schema?: true;
        /** Convert user-facing config to runtime config. */
        Config: (config: S) => T;
    }
    /** Function plugin called with `(ctx, config)`. */
    interface Function<T = any> extends Base<T> {
        (ctx: Context, config: T): any;
    }
    /** Class plugin constructed with `(ctx, config)`. */
    interface Constructor<T = any> extends Base<T> {
        new (ctx: Context, config: T): any;
    }
    /** Object plugin with an `apply(ctx, config)` method. */
    interface Object<T = any> extends Base<T> {
        apply(ctx: Context, config: T): any;
    }
    /** Mutable registry record shared by all fibers of one plugin callback. */
    interface Runtime {
        /** Display name copied from the first registered plugin shape. */
        name?: string;
        /** Every live fiber of this plugin (one per `ctx.plugin()` call). */
        fibers: DisposableList<Fiber>;
        /** The executable entrypoint all fibers share (registry identity key). */
        callback: globalThis.Function;
        /** Standard-schema validator applied to each fiber's config. */
        Config?: StandardSchemaV1;
    }
}
type Spread<T> = undefined extends T ? [config?: T] : [config: T];
type GetPluginParameters<P> = P extends (ctx: Context, ...args: infer R) => any ? R : P extends new (ctx: Context, ...args: infer R) => any ? R : P extends {
    apply(ctx: Context, ...args: infer R): any;
} ? R : never;
type GetPluginConfig<P> = P extends Plugin.Transform<infer S, any> ? S : GetPluginParameters<P>[0];
declare module './context.ts' {
    interface Context {
        /**
         * Run a callback once the requested services are available.
         *
         * Shorthand for `ctx.plugin({ inject, apply: callback })`: the callback
         * is unloaded and re-run whenever a required service changes.
         *
         * @param deps — required services, as an array or a name → config map.
         * @param callback — plugin body called with `(ctx, config)`.
         * @returns the fiber; awaiting it settles once loading finished.
         */
        inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>;
        /**
         * Load a plugin in the current context.
         *
         * @param plugin — a function, class, or `{ apply }` object plugin.
         * @param args — the plugin config, validated against its `Config` schema.
         * @returns the fiber; awaiting it settles once loading finished
         * (rejecting on config or startup errors).
         */
        plugin<P extends Plugin>(plugin: P, ...args: Spread<GetPluginConfig<P>>): Fiber & PromiseLike<Fiber>;
    }
}
/**
 * Plugin registry installed as `ctx.registry` and mixed into every context.
 *
 * It normalizes plugin shapes, tracks plugin runtimes, starts fibers, and
 * exposes map-like inspection over active plugin callbacks.
 */
export declare class RegistryService {
    ctx: Context;
    private _counter;
    private _internal;
    constructor(ctx: Context);
    /** Allocate the next fiber uid (increments on every read). */
    get counter(): number;
    /** Number of registered plugin runtimes. */
    get size(): number;
    /**
     * Resolve a supported plugin shape to its executable callback.
     *
     * @param plugin — a function, class, or `{ apply }` object plugin.
     * @returns the callback identifying the plugin, or `undefined` if invalid.
     */
    resolve(plugin: Plugin): Function | undefined;
    /**
     * Look up the runtime record for a plugin.
     *
     * @param plugin — any supported plugin shape.
     * @returns the runtime, or `undefined` when the plugin is not registered.
     */
    get(plugin: Plugin): Plugin.Runtime | undefined;
    /**
     * Check whether a plugin has a registered runtime.
     *
     * @param plugin — any supported plugin shape.
     * @returns `true` when at least one fiber of the plugin exists.
     */
    has(plugin: Plugin): boolean;
    /**
     * Dispose every running fiber for a plugin and remove its runtime record.
     *
     * @param plugin — any supported plugin shape.
     * @returns the removed runtime, or `undefined` when none was registered.
     */
    delete(plugin: Plugin): Plugin.Runtime | undefined;
    /** Iterate the registered plugin callbacks. */
    keys(): MapIterator<Function>;
    /** Iterate the registered plugin runtimes. */
    values(): MapIterator<Plugin.Runtime>;
    /** Iterate `[callback, runtime]` pairs. */
    entries(): MapIterator<[Function, Plugin.Runtime]>;
    /**
     * Visit every registered runtime.
     *
     * @param callback — receives each runtime and its identifying callback.
     */
    forEach(callback: (value: Plugin.Runtime, key: Function) => void): void;
    /**
     * Start a callback once the requested dependencies are available.
     *
     * @param inject — required services, as an array or a name → config map.
     * @param callback — plugin body called with `(ctx, config)`.
     * @returns the fiber; awaiting it settles once loading finished.
     */
    inject(inject: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>;
    /**
     * Start a plugin in the current context and return its fiber.
     *
     * Creates (or reuses) the plugin's runtime record, then starts a new fiber
     * under the current context. Throws if `plugin` is not a supported shape or
     * if the current fiber is already disposed.
     *
     * @param plugin — a function, class, or `{ apply }` object plugin.
     * @param config — the plugin config, validated against its `Config` schema.
     * @param getOuterStack — captures the caller stack for effect diagnostics.
     * @returns the fiber; awaiting it settles once loading finished.
     */
    plugin(plugin: Plugin, config?: any, getOuterStack?: () => string[]): Fiber & PromiseLike<Fiber>;
}
export {};
//# sourceMappingURL=registry.d.ts.map