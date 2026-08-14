/**
 * Host transport for the settings-namespace scope contract. The contract types
 * live in `dsh-client-runtime` (the common dependency of every feature that
 * owns a preference); this file owns the wire behavior and the invalidation
 * subscription, both of which are Settings-surface concerns.
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import { type SettingsScope, type SettingsScopeSnapshot, type SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client';
type SettingsFace = Pick<IApiClient, 'settings'>;
/**
 * Serializes one namespace's Host reads and writes behind a snapshot store.
 * Reads never block plugin activation; writes carry the latest known
 * namespace revision and teardown waits for the operation already crossing
 * the wire.
 */
export declare class SettingsScopeController<T> implements SettingsScope<T> {
    private readonly api;
    private readonly spec;
    private readonly persistence;
    private readonly store;
    private tail;
    private readGeneration;
    private writeGeneration;
    private disposed;
    /**
     * @param api - settings wire face.
     * @param spec - namespace identity and optional narrowing decoder.
     * @param persistence - remote browsers remain process-local because settings RPCs are loopback-only.
     */
    constructor(api: SettingsFace, spec: SettingsScopeSpec<T>, persistence?: 'host' | 'memory');
    /** @returns the current sync snapshot (stable reference until the next change). */
    getSnapshot(): SettingsScopeSnapshot<T>;
    /**
     * Observe snapshot replacements.
     * @param listener - invoked after each snapshot change.
     * @returns the disposer removing this listener.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Queue a Host refresh; a newer read or user write suppresses stale publication.
     * @returns settlement after the queued read completes or is skipped.
     */
    load(): Promise<void>;
    /**
     * Queue one field write; see {@link SettingsScope.set} for the ordering,
     * revision, and recovery contract.
     * @param field - scalar field inside the namespace section.
     * @param value - JSON-shaped value selected by the user.
     * @returns settlement after the write and any latest-write recovery read.
     */
    set(field: string, value: unknown): Promise<void>;
    /**
     * Queue one field clear; see {@link SettingsScope.unset} for the ordering,
     * revision, and recovery contract.
     * @param field - scalar field inside the namespace section.
     * @returns settlement after the clear and any latest-write recovery read.
     */
    unset(field: string): Promise<void>;
    private write;
    /**
     * Stop queued operations and wait for the current wire call to settle.
     * @returns settlement after the controller reaches quiescence.
     */
    dispose(): Promise<void>;
    private enqueue;
    private read;
    private accept;
    private decode;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        settingsScope: SettingsScopeBinder;
    }
}
/**
 * The settings domain's base service. Features that own a preference reach the
 * settings transport through this service rather than a shared function: the
 * client bundle purity gate forbids cross-plugin value imports and directs
 * cross-plugin collaboration through cordis services
 * (`packages/client/tsdown.client.ts`).
 */
export declare class SettingsScopeBinder extends Service {
    /**
     * @param ctx - the providing plugin's context.
     */
    constructor(ctx: Context);
    /**
     * Bind one namespace scope to settings and connection invalidations on the
     * CALLER's plugin lifecycle — the service proxy binds `this.ctx` to the
     * caller at call time, so the scope's disposer belongs to the calling fiber.
     * Listeners exist before the initial background read starts, so activation
     * never blocks on the settings transport. The caller injects `connection`
     * for the transport and `remote` for the forwarded settings invalidation.
     * @param spec - domain-owned namespace contract.
     * @returns the bound scope consumed by the domain's services and rows.
     */
    bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>;
}
export {};
//# sourceMappingURL=settings-scope.d.ts.map