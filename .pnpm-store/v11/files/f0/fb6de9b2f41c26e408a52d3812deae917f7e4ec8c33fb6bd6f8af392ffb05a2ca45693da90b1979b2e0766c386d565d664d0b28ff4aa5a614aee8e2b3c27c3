/** Pure provider-independent predicates for logical sessions and event text. */
import type { SessionEventResultFilter, SessionEventSearchDocument, SessionRecord, SessionResultFilter } from './types.ts';
/**
 * Apply ANDed logical-session filters while preserving input order.
 * @param records - detached logical-session records to inspect.
 * @param filters - clauses whose list values are ORed within each clause.
 * @returns records accepted by every clause.
 */
export declare function filterSessionResults<T extends SessionRecord>(records: readonly T[], filters?: readonly SessionResultFilter[]): T[];
/**
 * Apply ANDed event filters to extracted semantic documents.
 * @param documents - semantic documents produced by {@link buildSessionEventSearchDocuments}.
 * @param filters - metadata and literal-text predicates.
 * @returns documents accepted by every clause, in input order.
 */
export declare function filterSessionEventDocuments<T extends SessionEventSearchDocument>(documents: readonly T[], filters?: readonly SessionEventResultFilter[]): T[];
/**
 * Copy and validate logical-session filters before an asynchronous boundary.
 * @param filters - caller-owned clauses to materialize.
 * @returns detached validated clauses.
 */
export declare function materializeSessionResultFilters(filters: readonly SessionResultFilter[]): SessionResultFilter[];
/**
 * Copy and validate event filters before an asynchronous boundary.
 * @param filters - caller-owned clauses to materialize.
 * @returns detached validated clauses.
 */
export declare function materializeSessionEventResultFilters(filters: readonly SessionEventResultFilter[]): SessionEventResultFilter[];
/**
 * Compile a literal case-insensitive, whitespace-flexible semantic-text match.
 * @param text - caller-provided literal text.
 * @returns Unicode-aware regular expression safe from regex injection.
 */
export declare function compileSessionTextFilter(text: string): RegExp;
//# sourceMappingURL=filters.d.ts.map