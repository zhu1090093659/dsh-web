/**
 * Configurable registry for package-owned runtime invariant contributions.
 * Every workspace package registers checks from a `./invariant` companion;
 * ordinary package entrypoints stay independent of diagnostics.
 *
 * @module @deepseek-ai/dsh-invariants
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Inject } from '@deepseek-ai/cordis';
import type Schema from '@deepseek-ai/schemastery';
/** Runtime invariant selection configured on the service plugin. */
export interface Config {
    /** Global switch; defaults to `true`. */
    readonly enabled?: boolean;
    /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
    readonly package_allowlist?: string[];
    /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
    readonly package_blocklist?: string[];
}
/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
export type InvariantFailure = (message: string) => never;
/** Install one package's checks into the registration's child context. */
export interface InvariantInstaller {
    /**
     * Install the package contribution.
     * @param ctx - child context owned by this invariant registration.
     * @param fail - reporter bound to the registering package name.
     * @returns nothing, or a promise settling after asynchronous checks finish.
     */
    (ctx: Context, fail: InvariantFailure): void | Promise<void>;
    /** Services the child installer fiber may access. */
    readonly inject?: Inject;
}
/** Thrown when a package-owned runtime invariant is violated. */
export declare class InvariantError extends Error {
    /** Stable machine-readable invariant failure code. */
    readonly code: "INVARIANT";
    /** Full npm package name that owns the violated invariant. */
    readonly packageName: string;
    /**
     * Construct a package-attributed invariant failure.
     * @param packageName - full npm package name that registered the check.
     * @param message - violated contract, without the standard error prefix.
     */
    constructor(packageName: string, message: string);
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        invariants: InvariantRegistry;
    }
}
/** Package-owned invariant registry with global and regex-based selection. */
export declare class InvariantRegistry extends Service {
    static Config: Schema<Config>;
    private readonly enabled;
    private readonly ownerCtx;
    private readonly packageAllowlist;
    private readonly packageBlocklist;
    private readonly registrations;
    /**
     * Create and install the invariant registry.
     * @param ctx - Cordis context that owns the service.
     * @param config - global enablement and package-name regex filters.
     */
    constructor(ctx: Context, config?: Config);
    /** Return whether one full package name passes the configured filters. */
    private selected;
    /**
     * Register one package's invariant installer. The package name is reserved
     * even when filtering disables its checks. Enabled installers run in a child
     * fiber; failure disposes that fiber and releases the reservation.
     * @param packageName - full npm package name that owns the contribution.
     * @param installer - listener or startup-check installer for the child context.
     * @returns an effect-scoped disposer for the registration.
     */
    register(packageName: string, installer: InvariantInstaller): () => void;
}
export default InvariantRegistry;
//# sourceMappingURL=index.d.ts.map