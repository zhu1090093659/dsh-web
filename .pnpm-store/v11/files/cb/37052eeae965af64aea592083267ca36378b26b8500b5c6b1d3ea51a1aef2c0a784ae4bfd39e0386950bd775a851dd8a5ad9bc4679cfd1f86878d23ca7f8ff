/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages provide
 * the single active provider.
 *
 * @module @deepseek-ai/dsh-user-questions
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { HarnessError } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/cordis' {
    interface Context {
        userQuestions: UserQuestionService;
    }
}
import type { AskUserQuestionAnswer, AskUserQuestionItem } from './types.ts';
export type { AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem, AskUserQuestionOption, } from './types.ts';
/** Request for a human answer. */
export interface AskUserQuestionRequest {
    /** Questions to display. */
    questions: AskUserQuestionItem[];
    /** Exact live calling agent, when the request came from an agent tool call. */
    agent?: Agent;
    /** Abort signal for the owning tool/step. */
    signal?: AbortSignal;
}
/** UI-side provider for user questions. */
export interface UserQuestionProvider {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
}
/** Stable error taxonomy for user-questions failures. */
export declare class UserQuestionError extends HarnessError {
    constructor(message: string, code: string, options?: ErrorOptions);
}
/** `ctx.userQuestions`: one active UI provider plus an `ask()` API. */
export declare class UserQuestionService extends Service {
    private provider;
    constructor(ctx: Context);
    /**
     * Register the UI provider. Only one provider may be active in a context.
     *
     * @param provider UI-side implementation that collects answers.
     * @returns Disposer that unregisters this provider.
     */
    registerProvider(provider: UserQuestionProvider): () => void;
    /**
     * Ask the active UI provider and wait for the user's answer.
     *
     * When a caller supplies an agent, human interaction is valid only for the
     * exact live runtime root. Runtime ownership, not durable session lineage,
     * decides this boundary: an owned child has no human answerer and would
     * block forever, while a lineage-bearing session resumed as a new runtime
     * root may ask normally.
     *
     * @param request Questions, owner agent, and abort signal.
     * @returns The answer chosen or typed by the human.
     * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
     *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
     *   when that live agent is owned by another agent.
     */
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
}
export default UserQuestionService;
//# sourceMappingURL=index.d.ts.map