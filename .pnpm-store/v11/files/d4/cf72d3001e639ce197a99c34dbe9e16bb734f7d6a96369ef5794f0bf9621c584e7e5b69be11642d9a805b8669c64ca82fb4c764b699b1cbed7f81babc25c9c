/**
 * Request-header reconstruction utilities over full `request/header` session
 * events. Anyone holding a session log reconstructs the {@link EpochHeader}
 * any request was built under by taking the latest canonical snapshot; the
 * loop uses the same equality helper to avoid logging unchanged headers.
 *
 * @module dsh-session/request-header
 */
import type { EpochHeader, SessionEvent } from './types.ts';
/**
 * Normalize a header to canonical form: an empty system prompt and empty tool
 * list become absent fields, matching how requests are built. Logging, folding,
 * and comparison use this one representation.
 * @param header - the header to normalize (not mutated).
 * @returns the canonical header.
 */
export declare function canonicalHeader(header: EpochHeader): EpochHeader;
/**
 * Field-wise equality over canonical headers. Tool schemas compare in order.
 * @param a - one canonical header.
 * @param b - the other.
 * @returns whether config, system, and tools all match.
 */
export declare function headerEquals(a: EpochHeader, b: EpochHeader): boolean;
/**
 * Fold the header events of a log (or any prefix) into the
 * {@link EpochHeader} in force after the last snapshot. Non-header events are
 * skipped. This is the pure offline reconstruction path; the live session
 * tracks the same fold incrementally.
 * @param events - session events in log order.
 * @param from - a previously folded state to continue from.
 * @returns the latest canonical header, or undefined when none exists yet.
 */
export declare function foldRequestHeader(events: readonly SessionEvent[], from?: EpochHeader): EpochHeader | undefined;
//# sourceMappingURL=request-header.d.ts.map