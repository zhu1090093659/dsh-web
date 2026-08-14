/**
 * Delegation-depth accounting: the recursion budget a parent passes to its
 * children. Kept apart from the service so composition helpers can read it
 * without importing the registry.
 *
 * @module @deepseek-ai/dsh-subagent/depth
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
declare module '@deepseek-ai/dsh-agent' {
    interface AgentOptions {
        /** Delegation depth: zero for a top-level agent and parent depth + 1 for a child. */
        subagentDepth?: number;
    }
}
/**
 * Read an agent's delegation depth, treating absence as top-level depth zero.
 * The persisted session header is authoritative and monotone: runtime
 * `AgentOptions.subagentDepth` may DEEPEN the count but can never lower it —
 * a resumed child arrives with fresh options, and counting it from zero would
 * let it delegate as if it were top-level.
 * @param agent - the agent whose header and options carry the depth.
 * @returns its non-negative safe-integer depth.
 * @throws if the runtime `AgentOptions.subagentDepth` is not a non-negative safe integer.
 */
export declare function delegationDepthOf(agent: Agent): number;
/**
 * Reject a recursion cap that cannot represent an exact delegation depth.
 * @param maxDepth - the optional runtime value to validate.
 */
export declare function assertSubagentMaxDepth(maxDepth: unknown): void;
//# sourceMappingURL=depth.d.ts.map