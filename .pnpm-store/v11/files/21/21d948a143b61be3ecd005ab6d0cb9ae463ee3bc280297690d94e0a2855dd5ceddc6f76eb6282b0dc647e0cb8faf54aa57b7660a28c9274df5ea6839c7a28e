/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages provide
 * the single active provider.
 *
 * @module @deepseek-ai/dsh-user-questions
 */
import { Service } from '@deepseek-ai/cordis';
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
    constructor(message, code, options) {
        super(message, code, options);
        this.name = 'UserQuestionError';
    }
}
/** `ctx.userQuestions`: one active UI provider plus an `ask()` API. */
export class UserQuestionService extends Service {
    provider;
    constructor(ctx) {
        super(ctx, 'userQuestions');
    }
    /**
     * Register the UI provider. Only one provider may be active in a context.
     *
     * @param provider UI-side implementation that collects answers.
     * @returns Disposer that unregisters this provider.
     */
    registerProvider(provider) {
        const dispose = this.ctx.effect(function* () {
            if (this.provider !== undefined) {
                throw new UserQuestionError('a user-questions provider is already registered', 'DUPLICATE_PROVIDER');
            }
            this.provider = provider;
            yield () => {
                this.provider = undefined;
            };
        }.bind(this), 'userInteraction.registerProvider()');
        return () => void dispose();
    }
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
    async ask(request) {
        if (request.signal?.aborted) {
            throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED');
        }
        if (request.questions.length === 0) {
            throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS');
        }
        const agent = request.agent;
        if (agent !== undefined) {
            const agents = this.ctx.get('agents');
            if (agents === undefined || agents.get(agent.id) !== agent) {
                throw new UserQuestionError('human interaction requires the exact live calling agent when an agent is supplied', 'CALLER_NOT_LIVE');
            }
            if (!agents.roots().includes(agent)) {
                throw new UserQuestionError('human interaction is unavailable while the calling agent is owned by another live agent; '
                    + "include the unresolved question or decision in the child agent's final result", 'DELEGATED_CALLER');
            }
        }
        // A presentation intent asserts two things the types cannot: that the
        // named approve label is one of this question's own options, and that a
        // plan-review carries the plan it is a review of. A UI honouring the
        // intent answers with that label, and shows that detail as the plan, so
        // either gap would put a choice the asker never offered — or an approval of
        // something invisible — in front of the user. Caught at the asker, where
        // the mistake is, rather than in each UI.
        for (const question of request.questions) {
            const intent = question.intent;
            if (intent === undefined)
                continue;
            if (!(question.options ?? []).some(option => option.label === intent.approve)) {
                throw new UserQuestionError(`question ${question.id} declares intent ${intent.kind} whose approve label `
                    + `${JSON.stringify(intent.approve)} names none of its options`, 'BAD_INTENT');
            }
            if (question.detail === undefined) {
                throw new UserQuestionError(`question ${question.id} declares intent ${intent.kind} without the detail it reviews`, 'BAD_INTENT');
            }
        }
        if (this.provider === undefined) {
            throw new UserQuestionError('no user-questions provider is registered', 'NO_PROVIDER');
        }
        return this.provider.ask(request);
    }
}
export default UserQuestionService;
//# sourceMappingURL=index.js.map