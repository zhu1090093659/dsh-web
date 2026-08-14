/** Package-owned durable goal-stream invariants. @module @deepseek-ai/dsh-goal/invariant */
import { applyGoalEvent, emptyGoalFoldState } from "./fold.js";
const PACKAGE_NAME = '@deepseek-ai/dsh-goal';
/** Cordis companion plugin name. */
export const name = 'goal-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** Copy the independent fold before validating one candidate event. */
function cloneState(state) {
    return {
        goal: state.goal,
        roundsStarted: state.roundsStarted,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        lastRef: state.lastRef,
        seenGoalIds: new Set(state.seenGoalIds),
    };
}
/** Apply one event through the strict goal decoder and attribute failures. */
function applyChecked(state, event, fail) {
    try {
        applyGoalEvent(state, event);
    }
    catch (error) {
        /* v8 ignore next -- the strict goal decoder throws Error instances */
        const message = error instanceof Error ? error.message : String(error);
        fail(`session event ${event.seq} violates the durable goal stream: ${message}`);
    }
}
/** Install an independent incremental fold over every attached session. */
const install = Object.assign((ctx, fail) => {
    const states = new WeakMap();
    const staged = new WeakMap();
    const seed = (session) => {
        const state = emptyGoalFoldState();
        for (const event of session.events)
            applyChecked(state, event, fail);
        states.set(session, state);
        return state;
    };
    /* v8 ignore next -- session/event always follows list() or session/created seeding */
    const stateFor = (session) => states.get(session) ?? seed(session);
    for (const session of ctx.sessions.list())
        seed(session);
    ctx.on('session/created', (session) => { seed(session); }, { global: true });
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [session, event] = args;
        const state = cloneState(stateFor(session));
        applyChecked(state, event, fail);
        staged.set(event, { session, state });
    }, { global: true });
    ctx.on('session/event', (session, event) => {
        const candidate = staged.get(event);
        /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
        if (candidate === undefined || candidate.session !== session) {
            return fail('session/event reached publication without matching goal-fold validation');
        }
        staged.delete(event);
        states.set(session, candidate.state);
    }, { global: true });
}, { inject: ['sessions'] });
/**
 * Register the goal-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map