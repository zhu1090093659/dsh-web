/**
 * InputHub: the SessionInputResolver implementation (`ctx.conversation.input`) — one
 * SessionInputShell per session, created inside the sessions provide
 * materialization (the 'input' standard-kit entry IS the
 * creation trigger) and torn down by the scope disposer (instance-and-scope
 * share one lifecycle). The hub registers the three scoped input-mutation
 * listeners on each session's actx (the sole consumer side of the ui-input-trigger
 * bail events) and owns the default-sink choreography: every session is a
 * real host entity, so the sink is one unconditional prompt path.
 */
import type { ClientContext, SessionBinding, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client';
import type { ComposerKeyboard, SessionInputResolver, SessionInput } from './contract.ts';
import { SessionInputShell } from './facade.ts';
/** Session-addressed input facade registry (SessionInputResolver face + composer-layer extras). */
export declare class InputHub implements SessionInputResolver {
    private readonly rootCtx;
    private readonly t;
    private readonly shells;
    /**
     * @param ctx - client root context (services resolved lazily per call — boot order stays free).
     * @param t - conversation-namespace translate thunk (reads the active locale at call time).
     */
    constructor(rootCtx: ClientContext, t: TranslateNS<'conversation'>);
    /**
     * Resolve the facade for one session-scope ctx (SessionInputResolver face).
     * @param actx - session-scope context.
     * @returns the resident per-session facade.
     */
    for(actx: ClientContext): SessionInput;
    /**
     * Resident shell for one session binding — the provide-channel entry
     * (called during scope materialization, BEFORE the scope record is
     * queryable, hence binding-fed and hence the thunked slash/popup deps).
     * Wires the scoped event listeners + teardown into the session scope.
     * @param binding - session assembly handle.
     * @returns the shell.
     */
    shellFor(binding: SessionBinding): SessionInputShell;
    /**
     * Resident shell by session id (service-face path; the provide channel has
     * normally created it already — this covers direct id-addressed access).
     * @param id - session id.
     * @returns the shell.
     */
    shell(id: SessionId): SessionInputShell;
    /**
     * The InputBar-exclusive keyboard command face: the shell
     * satisfies it structurally; package-internal — handed through the
     * composer-bar entry's inject, never across a plugin boundary.
     * @param id - session id.
     * @returns the shell as the keyboard face.
     */
    keyboard(id: SessionId): ComposerKeyboard;
    /**
     * Resolve the optional slash controller for composer chrome that launches
     * the shared candidate menu without typing a trigger.
     * @param id - session id.
     * @returns the resident controller, or undefined when ui-input-trigger is absent.
     */
    inputTriggers(id: SessionId): InputTriggerController | undefined;
    /**
     * Default sink: optimistic clear + prompt. The session is always a real
     * host entity (materialized when its workspace was picked), so there is
     * exactly one path; a failed first prompt is an ordinary prompt failure
     * (error strip via promptError, draft restored only while untouched).
     */
    private sink;
    /**
     * Steer every still-pending queued message into the running turn, in FIFO
     * order — the same strict-steer operation as the queue dock's per-row
     * button. A turn closing mid-way (`steer-unavailable`) or a row already
     * claimed by the agent (`queue-item-not-found`) converges silently, while a
     * genuine failure surfaces as one composer notice. Repeated triggers
     * (e.g. two rapid empty-draft chords) rely on that `queue-item-not-found`
     * convergence: the snapshot may still list a row the host already steered,
     * and the duplicate strict steer is a silent no-op.
     * @param session - the addressed host session.
     * @param shell - the resident shell (notice outlet).
     */
    private steerQueue;
    private controller;
    private popup;
    private sessions;
    private conversation;
}
//# sourceMappingURL=hub.d.ts.map