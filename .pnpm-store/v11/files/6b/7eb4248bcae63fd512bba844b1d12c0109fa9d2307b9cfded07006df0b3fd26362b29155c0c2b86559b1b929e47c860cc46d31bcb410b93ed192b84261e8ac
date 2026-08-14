/** Durable request-route lookup for one open model step. @module @deepseek-ai/dsh-llm-retry/history */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * Find the provider in force for one currently open step.
 * Request headers remain effective across turn boundaries until a newer full
 * snapshot changes them; every provider change requires a newer full snapshot.
 * @param events - session events ending inside the open step.
 * @param turn - turn that owns the failed step.
 * @param step - failed step whose provider is required.
 * @returns the provider from the request header in force for the step.
 */
export declare function providerForOpenStep(events: readonly SessionEvent[], turn: number, step: number): string | undefined;
//# sourceMappingURL=history.d.ts.map