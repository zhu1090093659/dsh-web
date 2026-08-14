/**
 * Delegation-depth accounting: the recursion budget a parent passes to its
 * children. Kept apart from the service so composition helpers can read it
 * without importing the registry.
 *
 * @module @deepseek-ai/dsh-subagent/depth
 */
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
export function delegationDepthOf(agent) {
    const runtime = agent.options.subagentDepth;
    if (runtime !== undefined && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0))) {
        throw new TypeError('agent subagentDepth must be a non-negative safe integer');
    }
    // The header value was validated at the session boundary (creation and
    // persistence load both construct through the store).
    return Math.max(agent.session.header.delegationDepth ?? 0, runtime ?? 0);
}
/**
 * Reject a recursion cap that cannot represent an exact delegation depth.
 * @param maxDepth - the optional runtime value to validate.
 */
export function assertSubagentMaxDepth(maxDepth) {
    if (maxDepth !== undefined && (typeof maxDepth !== 'number'
        || !Number.isSafeInteger(maxDepth)
        || maxDepth < 0
        || Object.is(maxDepth, -0))) {
        throw new TypeError('subagent maxDepth must be a non-negative safe integer');
    }
}
//# sourceMappingURL=depth.js.map