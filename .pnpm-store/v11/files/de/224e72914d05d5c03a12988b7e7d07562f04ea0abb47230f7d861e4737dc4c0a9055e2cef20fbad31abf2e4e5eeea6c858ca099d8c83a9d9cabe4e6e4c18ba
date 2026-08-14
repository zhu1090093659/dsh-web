import { Context } from './context.ts';
import { symbols } from './utils.ts';
/**
 * Base class for services that expose a named API on `ctx`.
 *
 * Subclasses call `super(ctx, name)` from their constructor. The service is
 * registered immediately and is automatically removed with the owning fiber.
 */
export declare abstract class Service<out T = never> {
    protected ctx: Context;
    /** Symbol key of an instance method run after construction (class plugins). */
    static readonly init: unique symbol;
    /** Symbol key of the availability predicate passed to `ctx.provide()`. */
    static readonly check: unique symbol;
    /** Symbol key of the phantom intercept-config type parameter. */
    static readonly config: unique symbol;
    /** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
    static readonly invoke: unique symbol;
    /** Symbol key of the helper deriving an extended service instance. */
    static readonly extend: unique symbol;
    /** Symbol key of the tracker metadata used for context tracing. */
    static readonly tracker: unique symbol;
    /** Symbol key of the intercept-config resolution helper below. */
    static readonly resolveConfig: unique symbol;
    [symbols.config]: T;
    /** The service name this instance is registered under. */
    name: string;
    /**
     * Register this instance as `name` in the current context.
     *
     * Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
     * service is unregistered automatically when the owning fiber unloads.
     * Services with a `[Service.invoke]` body return a callable instance.
     *
     * @param ctx — the context to register in (stored as `this.ctx`).
     * @param name — the service name; defaults to the static `provide` field.
     */
    constructor(ctx: Context, name: string);
    protected [symbols.filter](ctx: Context): boolean;
    protected [symbols.extend](props?: any): any;
    /**
     * Merge intercept config from ancestors with optional base and head values.
     *
     * Entries added closer to the root apply first; `base` is prepended and
     * `head` appended. Uses `Config.merge` when the service declares one,
     * otherwise a shallow `Object.assign`.
     *
     * @param base — lowest-precedence config merged before all intercepts.
     * @param head — highest-precedence config merged after all intercepts.
     * @returns the merged config.
     */
    [symbols.resolveConfig](base?: T, head?: T): T;
    static [Symbol.hasInstance](instance: any): boolean;
}
//# sourceMappingURL=service.d.ts.map