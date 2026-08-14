/**
 * Pure subagent-lineage aggregation over the retained session-list mirror.
 * Ordinary forks terminate propagation so each visible session owns only its
 * uninterrupted subagent subtree.
 * @module @deepseek-ai/dsh-client-runtime/client/sessions/subagent-lineage
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { SessionSummary } from './service.ts';
/** Descendant counts projected for one possible parent session. */
export interface SubagentDescendantSummary {
    /** All descendants connected through uninterrupted subagent-origin lineage. */
    readonly count: number;
    /** Descendants whose exact session summary is currently running. */
    readonly runningCount: number;
}
/**
 * Index every subagent descendant under each ancestor it reaches through an
 * uninterrupted subagent-origin chain. Cycles fail soft and orphan owners
 * remain harmless map keys until their summaries arrive.
 * @param summaries - retained session summaries keyed by id.
 * @returns descendant totals and running totals keyed by possible parent id.
 */
export declare function indexSubagentDescendants(summaries: Readonly<Record<SessionId, SessionSummary>>): ReadonlyMap<SessionId, SubagentDescendantSummary>;
//# sourceMappingURL=subagent-lineage.d.ts.map