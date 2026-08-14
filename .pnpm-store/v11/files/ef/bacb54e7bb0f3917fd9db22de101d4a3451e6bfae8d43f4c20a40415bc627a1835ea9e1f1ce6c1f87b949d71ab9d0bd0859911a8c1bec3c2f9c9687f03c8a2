/**
 * Bounded sharing and exclusive reservation of unpublished Sessions.
 * @module @deepseek-ai/dsh-session-persistence/preparations
 */
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
interface PreparedSource {
    readonly session: Session;
}
type PreparationPhase = 'loading' | 'ready' | 'committing' | 'reserved';
interface PreparationEntry<Source, CommitState> {
    readonly id: SessionId;
    readonly result: Promise<Source>;
    phase: PreparationPhase;
    source?: Source;
    reservation?: SessionPreparationReservation<Source, CommitState>;
    reservationSettled?: Promise<void>;
    settleReservation?: () => void;
}
/** One exclusively held prepared source and its committed persistence state. */
export interface SessionPreparationReservation<Source, CommitState> {
    readonly entry: PreparationEntry<Source, CommitState>;
    readonly source: Source;
    readonly state: CommitState;
}
/** Per-coordinator cold-read sharing, exclusive reservation, and ready-entry LRU. */
export declare class SessionPreparations<Source extends PreparedSource, CommitState> {
    private readonly capacity;
    private readonly entries;
    constructor(capacity: number);
    /**
     * Whether this pool currently knows about an unpublished identity.
     * @param id - session identity.
     * @returns whether an entry exists for the identity.
     */
    has(id: SessionId): boolean;
    /**
     * Observe one prepared source, sharing an in-flight read for the same id.
     * @param id - session identity.
     * @param load - cold loader used when no entry exists.
     * @param signal - optional cancellation signal while waiting.
     * @returns the shared prepared source.
     */
    inspect(id: SessionId, load: () => Promise<Source>, signal?: AbortSignal): Promise<Source>;
    /**
     * Reserve one ready source after committing its pending durable repair.
     * @param id - session identity.
     * @param load - cold loader used when no entry exists.
     * @param commit - durable repair and cursor-state commit.
     * @param signal - optional cancellation signal while waiting.
     * @returns the exclusive reservation, or undefined if its entry was invalidated.
     */
    reserve(id: SessionId, load: () => Promise<Source>, commit: (source: Source) => Promise<{
        source: Source;
        state: CommitState;
    } | undefined>, signal?: AbortSignal): Promise<SessionPreparationReservation<Source, CommitState> | undefined>;
    /**
     * Return the exact reservation for Session publication, rejecting aliases.
     * @param session - exact Session candidate for publication.
     * @returns its reservation, or undefined when no preparation exists.
     */
    reservationFor(session: Session): SessionPreparationReservation<Source, CommitState> | undefined;
    /**
     * Consume a reservation after its exact Session has attached.
     * @param reservation - reservation to consume.
     */
    attach(reservation: SessionPreparationReservation<Source, CommitState>): void;
    /**
     * Consume a reservation whose caller only needs the committed inspection.
     * @param reservation - reservation to consume.
     */
    discard(reservation: SessionPreparationReservation<Source, CommitState>): void;
    /**
     * Return a reusable unpublished reservation to the ready LRU.
     * @param reservation - reservation to release.
     * @param reusable - whether the source remains valid for reuse.
     */
    release(reservation: SessionPreparationReservation<Source, CommitState>, reusable: boolean): void;
    /**
     * Discard a prepared view after the durable log changes.
     * @param id - changed session identity.
     */
    invalidate(id: SessionId): void;
    /**
     * Discard an exact stale ready source without disturbing an exclusive owner.
     * @param id - changed session identity.
     * @param expected - exact source observed before its revision check.
     * @returns whether the source was discarded, retained by a reservation, or is absent.
     */
    discardReady(id: SessionId, expected: Source): 'discarded' | 'retained' | 'missing';
    /**
     * Reject writes while an unpublished Session exclusively reserves the id.
     * @param id - session identity to check.
     */
    assertWritable(id: SessionId): void;
    /**
     * Remove a completed entry for an already-serialized append adoption.
     * @param id - adopted session identity.
     * @returns the prepared source, or undefined when no ready entry exists.
     */
    takeReady(id: SessionId): Source | undefined;
    private entryFor;
    private makeReady;
    private remove;
    private touch;
}
/**
 * Give a queued observer a prompt cancellation view without cancelling shared work.
 * @param operation - shared operation whose settlement remains authoritative.
 * @param signal - observer-local cancellation signal.
 * @param started - whether the operation has crossed its cancellation cutoff.
 * @returns the operation result or the observer's prompt cancellation.
 */
export declare function observeQueuedAbort<T>(operation: Promise<T>, signal: AbortSignal, started?: () => boolean): Promise<T>;
export {};
//# sourceMappingURL=preparations.d.ts.map