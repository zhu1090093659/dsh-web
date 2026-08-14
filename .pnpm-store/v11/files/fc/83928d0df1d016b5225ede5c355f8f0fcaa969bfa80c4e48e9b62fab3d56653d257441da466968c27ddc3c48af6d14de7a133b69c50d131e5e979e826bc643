import type { Dict } from '@deepseek-ai/cosmokit';
import { Context } from './context.ts';
import { Fiber } from './fiber.ts';
declare module './context.ts' {
    interface Context {
        /**
         * Read a service from the store without the inject requirement.
         *
         * @param name — the service name.
         * @param strict — when `true` (default), only return implementations
         * whose providing fiber is currently active.
         * @returns the service value, or `undefined` when not (yet) provided.
         */
        get<K extends string & keyof this>(name: K, strict?: boolean): undefined | this[K];
        /** Same as above for service names outside the typed `Context` surface. */
        get(name: string, strict?: boolean): any;
        /**
         * Overwrite a provided service's value.
         *
         * Only the fiber that provided the service may set it; setting an
         * unprovided name throws.
         *
         * @param name — the service name.
         * @param value — the new service value.
         */
        set<K extends string & keyof this>(name: K, value: undefined | this[K]): void;
        /** Same as above for service names outside the typed `Context` surface. */
        set(name: string, value: any): void;
        /**
         * Register a service implementation owned by the current fiber.
         *
         * The service becomes visible to dependents in the same isolation scope
         * once the fiber is active; it is unregistered (waking dependents) when
         * the returned disposer runs or the fiber unloads. Throws if the name is
         * already provided in this scope or declared as an accessor.
         *
         * @param name — the service name.
         * @param value — the service value.
         * @returns a disposer that unregisters the service.
         */
        provide<K extends string & keyof this>(name: K, value: undefined | this[K]): () => void;
        /** Same as above for service names outside the typed `Context` surface. */
        provide(name: string, value?: any): () => void;
        /**
         * Define a computed context property backed by get/set hooks.
         *
         * The accessor is removed when the current fiber unloads. Throws if the
         * name is already declared.
         *
         * @param name — the context property name.
         * @param options — the `get` hook and optional `set` hook.
         */
        accessor(name: string, options: Omit<Property.Accessor, 'type'>): void;
        /**
         * Expose selected members of a service directly on `ctx`.
         *
         * Each mixed-in key becomes an accessor that forwards to the service
         * (binding methods to it), so e.g. `ctx.on` forwards to `ctx.events.on`.
         * Mixins are removed when the current fiber unloads.
         *
         * @param name — the context property holding the source service.
         * @param mixins — keys to forward, or a source-key → ctx-key map.
         */
        mixin<K extends string & keyof this>(name: K, mixins: (keyof this & keyof this[K])[] | Dict<string>): void;
        /** Same as above with a source object instead of a context property name. */
        mixin<T extends {}>(source: T, mixins: (keyof this & keyof T)[] | Dict<string>): void;
    }
}
/** Context property definition known by the reflection service. */
export type Property = Property.Service | Property.Accessor;
/** Property definition variants understood by `ReflectService`. */
export declare namespace Property {
    /** Service property backed by a provided implementation. */
    interface Service {
        /** Discriminator. */
        type: 'service';
    }
    /** Computed context property backed by custom get/set hooks. */
    interface Accessor {
        /** Discriminator. */
        type: 'accessor';
        /** Compute the property value; `error` carries the caller stack for diagnostics. */
        get: (this: Context, receiver: any, error: Error) => any;
        /** Optional setter; return `false` to reject the write. */
        set?: (this: Context, value: any, receiver: any, error: Error) => boolean;
    }
}
/** Concrete service implementation record stored in the root reflect service. */
export interface Impl {
    /** The service name. */
    name: string;
    /** The fiber that provided the service (owns its lifetime). */
    fiber: Fiber;
    /** The current service value. */
    value?: any;
    /** Optional availability predicate consulted before dependents may load. */
    check?: () => boolean;
}
/**
 * Reflection and service-resolution layer installed as `ctx.reflect`.
 *
 * This service powers the context proxy, service registration, accessors, and
 * the mixins that expose core service methods directly on `ctx`.
 */
export declare class ReflectService {
    ctx: Context;
    /** Proxy traps implementing service resolution for every context object. */
    static handler: ProxyHandler<Context>;
    /** Service implementations, keyed by isolation label. */
    store: Dict<Impl, symbol>;
    /** Declared context properties (services and accessors), by name. */
    props: Dict<Property>;
    constructor(ctx: Context);
    /**
     * Read a service from the store without the inject requirement.
     *
     * @param name — the service name.
     * @param strict — when `true`, only return implementations whose providing
     * fiber is currently active.
     * @returns the service value, or `undefined` when not (yet) provided.
     */
    get(name: string, strict?: boolean): any;
    _getImpl(name: string, strict?: boolean): Impl | undefined;
    /**
     * Overwrite a provided service's value.
     *
     * @param name — the service name.
     * @param value — the new service value.
     * @param error — carrier for the caller stack in diagnostics.
     * @returns `true` on success.
     * @throws when `name` was never provided, or was provided by another fiber.
     */
    set(name: string, value: any, error?: Error): boolean;
    /**
     * Register a service implementation owned by the current fiber.
     *
     * See the `ctx.provide()` overload above for the full contract.
     *
     * @param name — the service name.
     * @param value — the service value.
     * @param check — optional availability predicate for dependents.
     * @returns a disposer that unregisters the service.
     */
    provide(name: string, value?: any, check?: () => boolean): import("./fiber.ts").Disposable<Promise<void>>;
    /**
     * Re-evaluate every fiber that requires one of the given services.
     *
     * @param names — the service names that changed.
     * @param filter — restricts notification to matching isolation scopes.
     * @returns the fibers whose dependency state was refreshed.
     */
    notify(names: string[], filter?: (ctx: Context, name: string) => boolean): Fiber[];
    /**
     * Define a computed context property backed by get/set hooks.
     *
     * @param name — the context property name.
     * @param options — the `get` hook and optional `set` hook.
     * @returns a disposer that removes the accessor.
     */
    accessor(name: string, options: Omit<Property.Accessor, 'type'>): import("./fiber.ts").Disposable<Promise<void>>;
    /**
     * Expose selected members of a service directly on `ctx`.
     *
     * See the `ctx.mixin()` overload above for the full contract.
     *
     * @param source — a context property name or a source object.
     * @param mixins — keys to forward, or a source-key → ctx-key map.
     * @returns a disposer that removes all created accessors.
     */
    mixin(source: any, mixins: string[] | Dict<string>): import("./fiber.ts").Disposable<Promise<void>>;
    /**
     * Attach this context's tracing wrapper to a value.
     *
     * @param value — the value to wrap.
     * @returns the traceable wrapper (or the value itself when not applicable).
     */
    trace<T>(value: T): T;
    /**
     * Wrap a callback so calls trace `this` and arguments to this context.
     *
     * @param callback — the function to wrap.
     * @returns a proxy delegating to `callback` with traced values.
     */
    bind<T extends Function>(callback: T): T;
}
//# sourceMappingURL=reflect.d.ts.map