/** Runtime constructors and protocol constants for the goal domain. */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Version of the goal change embedded in a round-zero message source. */
export const GOAL_CHANGE_VERSION = 1;
/**
 * Brand a string as a goal id.
 * @param id - raw goal identifier.
 * @returns the same string with the compile-time brand.
 */
export function GoalId(id) {
    return id;
}
/** Error returned by the goal domain boundary. */
export class GoalError extends HarnessError {
    /**
     * @param message - human-readable rejection reason.
     * @param code - stable machine-routable classification.
     */
    // Keep the constructor to narrow HarnessError's string code at this boundary.
    // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
    constructor(message, code) {
        super(message, code);
    }
}
//# sourceMappingURL=runtime.js.map