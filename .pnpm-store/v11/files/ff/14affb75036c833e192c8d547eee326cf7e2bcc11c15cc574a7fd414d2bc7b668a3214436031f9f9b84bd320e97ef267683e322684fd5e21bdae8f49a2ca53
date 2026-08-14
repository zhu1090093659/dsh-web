/** Runtime constructors and protocol constants for the goal domain. */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { GoalId as GoalIdType } from './types.ts';
import type { GoalErrorCode } from './domain.ts';
/** Version of the goal change embedded in a round-zero message source. */
export declare const GOAL_CHANGE_VERSION = 1;
/**
 * Brand a string as a goal id.
 * @param id - raw goal identifier.
 * @returns the same string with the compile-time brand.
 */
export declare function GoalId(id: string): GoalIdType;
/** Error returned by the goal domain boundary. */
export declare class GoalError extends HarnessError {
    /**
     * @param message - human-readable rejection reason.
     * @param code - stable machine-routable classification.
     */
    constructor(message: string, code: GoalErrorCode);
}
//# sourceMappingURL=runtime.d.ts.map