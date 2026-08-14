/**
 * Ownership of one unpublished Session before registry publication.
 * @module @deepseek-ai/dsh-session/preparation
 */
import type { Session } from './index.ts';
/** Options for a preparation whose provider retains unpublished state. */
export interface SessionPreparationOptions {
    /** Release provider-owned state when the Session was not published. */
    readonly release?: () => void;
}
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
export declare class SessionPreparation implements Disposable {
    private readonly options;
    private released;
    /** The exact Session to use for setup and publication. */
    readonly session: Session;
    private constructor();
    /**
     * Wrap an unpublished Session in one preparation lifetime.
     * @param session - exact unpublished Session.
     * @param options - optional provider release behavior.
     * @returns a preparation disposed after publication or rollback.
     */
    static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
    /** Release provider state once when this preparation leaves its caller. */
    [Symbol.dispose](): void;
}
//# sourceMappingURL=preparation.d.ts.map