/** Host BFF policy for resolving Remote Agent and Session identities. */
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol';
/** Cold identity absent from the durable session store. */
export class ApiRemoteSessionNotFound extends Error {
}
/** Session identity whose lifecycle belongs to subagent routing. */
export class ApiRemoteSubagentSessionOwnership extends Error {
    sessionId;
    /**
     * Construct the ownership fence.
     * @param sessionId - identity reserved to subagent routing.
     */
    constructor(sessionId) {
        super(`session "${sessionId}" is a subagent session; use subagent delivery`);
        this.sessionId = sessionId;
    }
}
/**
 * Test whether generic Host routing must leave an identity to subagent routing.
 * @param ctx - Host Context carrying the live Agent registry.
 * @param session - attached or live Session metadata.
 * @param agent - live Agent when one is registered.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
export function hasApiRemoteSubagentOwner(ctx, session, agent) {
    if (session.header.origin === 'subagent')
        return true;
    const parentId = session.header.parentSession;
    if (parentId === undefined || agent === undefined)
        return false;
    const parent = ctx.agents.get(parentId);
    return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent);
}
/**
 * Build the stable caller-facing ownership rejection.
 * @param sessionId - identity reserved to subagent routing.
 * @returns the existing `agent-busy` RPC shape.
 */
export function apiRemoteSubagentOwnershipError(sessionId) {
    return {
        code: 'agent-busy',
        message: `session "${sessionId}" is owned by subagent routing`,
        details: { reason: 'use subagent delivery for this child session' },
    };
}
/**
 * Inspect one cold served session without repairing, resuming, or publishing it.
 * @param ctx - Host Context carrying the optional persistence provider.
 * @param sessionId - durable identity to inspect.
 * @returns detached metadata and events for a servable session.
 * @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
 */
export async function inspectApiRemoteSession(ctx, sessionId) {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) {
        throw new Error('session persistence is not configured (load a dsh-session-persistence backend)');
    }
    const meta = (await persistence.list()).find(candidate => candidate.id === sessionId);
    if (meta === undefined || meta.cwd === undefined) {
        throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`);
    }
    const inspected = await persistence.inspect(sessionId);
    if (inspected.meta.cwd === undefined) {
        throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`);
    }
    return { meta: inspected.meta, events: [...inspected.events] };
}
/**
 * Create the Host's shared Agent resolver and configure Agent/Session Typert lookups.
 * Live Agents are reused, ordinary cold sessions resume once per identity, and
 * subagent-owned identities retain the legacy `agent-busy` fence.
 * @param ctx - owning Host Context.
 * @param options - defaults and Agent-scope setup used only for cold resume.
 * @returns resolver shared by legacy API Proxy methods and Typert lookups.
 */
export function createApiRemoteAgentResolver(ctx, options) {
    const resumes = new Map();
    const fencedLiveAgent = (sessionId) => {
        const live = ctx.agents.get(sessionId);
        if (live === undefined)
            return undefined;
        if (hasApiRemoteSubagentOwner(ctx, live.session, live)) {
            return { error: apiRemoteSubagentOwnershipError(sessionId) };
        }
        return { agent: live };
    };
    const agentFor = async (sessionId) => {
        const fenced = fencedLiveAgent(sessionId);
        if (fenced !== undefined)
            return fenced;
        const attached = ctx.sessions.get(sessionId);
        if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
            return { error: apiRemoteSubagentOwnershipError(sessionId) };
        }
        let resume = resumes.get(sessionId);
        if (resume === undefined) {
            resume = (async () => {
                try {
                    const inspected = await inspectApiRemoteSession(ctx, sessionId);
                    if (hasApiRemoteSubagentOwner(ctx, { header: inspected.meta }, undefined)) {
                        throw new ApiRemoteSubagentSessionOwnership(sessionId);
                    }
                    // Built from the inspected session before the published re-checks
                    // below, so those stay adjacent to `resume` and a Host setup that
                    // awaits (composing a preset, say) does not widen the collision
                    // window.
                    const setup = options.setup === undefined ? undefined : await options.setup(inspected);
                    const publishedSession = ctx.sessions.get(sessionId);
                    const publishedAgent = ctx.agents.get(sessionId);
                    if (publishedSession !== undefined
                        && hasApiRemoteSubagentOwner(ctx, publishedSession, publishedAgent)) {
                        throw new ApiRemoteSubagentSessionOwnership(sessionId);
                    }
                    const handle = await ctx.agents.resume({
                        resumeSessionId: sessionId,
                        ...options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions() },
                        ...setup === undefined ? {} : { setup },
                    });
                    return handle.agent;
                }
                finally {
                    resumes.delete(sessionId);
                }
            })();
            resumes.set(sessionId, resume);
        }
        try {
            return { agent: await resume };
        }
        catch (error) {
            if (error instanceof ApiRemoteSessionNotFound) {
                return { error: { code: 'session-not-found', message: error.message, details: { sessionId } } };
            }
            if (error instanceof ApiRemoteSubagentSessionOwnership) {
                return { error: apiRemoteSubagentOwnershipError(error.sessionId) };
            }
            const fenced = fencedLiveAgent(sessionId);
            if (fenced !== undefined)
                return fenced;
            const attached = ctx.sessions.get(sessionId);
            if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
                return { error: apiRemoteSubagentOwnershipError(sessionId) };
            }
            return {
                error: {
                    code: 'internal',
                    message: `resume failed for session "${sessionId}": ${String(error)}`,
                    details: {},
                },
            };
        }
    };
    ctx.inject(['typert'], (typeCtx) => {
        const resolveAgent = async (sessionId) => {
            const found = await agentFor(sessionId);
            if ('error' in found)
                throw new TypertLookupFailure(found.error);
            return found.agent;
        };
        typeCtx.typert.lookups.configure('agent', resolveAgent);
        typeCtx.typert.lookups.configure('session', async (sessionId) => (await resolveAgent(sessionId)).session);
        typeCtx.typert.contexts.configureHost('agent', async (sessionId) => (await resolveAgent(sessionId)).ctx);
    });
    return agentFor;
}
//# sourceMappingURL=agent-lookup.js.map