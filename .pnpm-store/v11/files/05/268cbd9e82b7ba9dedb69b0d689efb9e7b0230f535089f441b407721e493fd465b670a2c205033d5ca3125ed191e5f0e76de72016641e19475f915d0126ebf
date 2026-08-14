/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-commands`:
 * command lifecycle events pair by commandId within one session log.
 * @module @deepseek-ai/dsh-commands/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-commands';
/** Cordis companion plugin name. */
export const name = 'commands-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install pairing validation over loaded logs and newly appended lifecycle events. */
const install = Object.assign((ctx, fail) => {
    // Install-scoped so a dispose/re-register cycle re-sweeps from a clean slate.
    const runIds = new WeakMap();
    const validateEvent = (session, event) => {
        if (event.type === 'command/run') {
            const ids = runIds.get(session) ?? new Set();
            if (ids.has(event.data.commandId)) {
                fail(`command/run repeats commandId ${JSON.stringify(event.data.commandId)}`);
            }
            ids.add(event.data.commandId);
            runIds.set(session, ids);
            return;
        }
        if (event.type !== 'command/done')
            return;
        if (runIds.get(session)?.has(event.data.commandId) !== true) {
            fail(`command/done ${JSON.stringify(event.data.commandId)} pairs no prior command/run in this log`);
        }
        const source = event.data.sourceEventSeq;
        const sourceEvent = source === undefined ? undefined : session.events[source];
        if (source !== undefined
            && (event.data.kind !== 'success'
                || !Number.isSafeInteger(source) || source < 0 || source >= event.seq
                || sourceEvent?.seq !== source
                || sourceEvent.type === 'command/run'
                || sourceEvent.type === 'command/done')) {
            fail(`command/done ${JSON.stringify(event.data.commandId)} has invalid sourceEventSeq ${String(source)}`);
        }
    };
    for (const session of ctx.sessions.list()) {
        for (const event of session.events)
            validateEvent(session, event);
    }
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [session, event] = args;
        validateEvent(session, event);
    }, { global: true });
}, { inject: ['sessions'] });
/* jscpd:ignore-end */
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map