/**
 * The session standard-props provide channel: provider roster, bundle
 * materialization (fail-loud on undeclared/missing/duplicate members), the
 * static no-session projection, and the atomic current-session projection
 * observable. One implementation — SessionRuntime drives it from wire
 * truth, the test runtime's sessions double drives it from fixtures — so
 * the materialization rules and the projection semantics cannot drift
 * between production and the test bench.
 */
import type { HostObservable, SessionMaybeProvideInfo, SessionProvideInfo } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionBinding, SessionProvideDescriptor } from './service.ts';
/** The owner-side hooks: how the channel reaches the owner's live bundles and current selection. */
export interface SessionProvideChannelHost {
    /**
     * Re-materialize every already-materialized bundle against the new roster
     * (call {@link SessionProvideChannel.materializeInfo} per live binding).
     * Lazily-materialized sessions pick the new roster up on first resolve.
     */
    rebuildBundles(): void;
    /** Resolve the current selection's bundle (the owner's maybe-provide lookup). */
    resolveCurrent(): SessionMaybeProvideInfo;
}
/**
 * Provider roster + materialization + current projection. The channel owns
 * every rule a provider contribution must satisfy; owners keep only their
 * per-session bundle storage and the definition of "current".
 */
export declare class SessionProvideChannel {
    private readonly host;
    private readonly providers;
    private maybeInfoCache;
    /** Latest published current bundle (identity comparison dedupes republish). */
    private currentSnapshot;
    /** Projection subscribers (plain cell: bundles hold live session sources, so no store freeze may touch them). */
    private readonly listeners;
    /**
     * Atomic current-session provide projection: selection changes and
     * provider-roster changes publish through this one source, so a roster
     * change under a stable current id republishes the bundle instead of
     * stranding mounted entries.
     */
    readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>;
    /**
     * @param host - owner-side bundle storage and current-selection resolution.
     */
    constructor(host: SessionProvideChannelHost);
    /** The static no-session projection under the current roster (declared names present, values undefined). */
    get maybeInfo(): SessionMaybeProvideInfo;
    /**
     * Register a per-session standard-props provider (see
     * SessionRuntime.provide for the product contract). Live bundles rebuild
     * immediately; misdeclared providers fail loud here, at the registration
     * edge, and the registration rolls back — the channel never stays on a
     * roster it cannot materialize.
     * @param descriptor - static member roster plus per-session resolver.
     * @returns disposer removing the provider.
     */
    provide(descriptor: SessionProvideDescriptor): () => void;
    /**
     * Re-derive the current selection's bundle and publish it when it changed.
     * Bundles are identity-stable per (scope, roster) materialization, so an
     * identity compare is exact; synchronous notify — call sites (the owner's
     * list subscription, provide()) already sit behind their own batching or
     * registration edges.
     */
    publishCurrent(): void;
    /**
     * Materialize the standard-props bundle for one session (fails loud on
     * undeclared, missing, and duplicate member names).
     * @param binding - session assembly handle fed to every resolver.
     * @returns the materialized bundle (identity-stable until the next materialization).
     */
    materializeInfo(binding: SessionBinding): SessionProvideInfo;
    /** Rebuild the static projection and the owner's live bundles, then republish the current one. */
    private applyRosterChange;
    /** Build the static no-session kit and reject duplicate declared names. */
    private materializeMaybeInfo;
}
//# sourceMappingURL=provide.d.ts.map