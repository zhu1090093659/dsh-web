/**
 * Ownership of one unpublished Session before registry publication.
 * @module @deepseek-ai/dsh-session/preparation
 */
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
export class SessionPreparation {
    options;
    released = false;
    /** The exact Session to use for setup and publication. */
    session;
    constructor(session, options) {
        this.options = options;
        this.session = session;
    }
    /**
     * Wrap an unpublished Session in one preparation lifetime.
     * @param session - exact unpublished Session.
     * @param options - optional provider release behavior.
     * @returns a preparation disposed after publication or rollback.
     */
    static create(session, options) {
        return new SessionPreparation(session, options ?? {});
    }
    /** Release provider state once when this preparation leaves its caller. */
    [Symbol.dispose]() {
        if (this.released)
            return;
        this.released = true;
        this.options.release?.();
    }
}
//# sourceMappingURL=preparation.js.map