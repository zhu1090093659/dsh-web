/** Host BFF policy for resolving Remote Agent and Session identities. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
/** Caller-facing failures preserved by the Gateway's RPC adapter. */
export type ApiRemoteLookupError = {
    readonly code: 'agent-busy';
    readonly message: string;
    readonly details: {
        readonly reason: string;
    };
} | {
    readonly code: 'session-not-found';
    readonly message: string;
    readonly details: {
        readonly sessionId: SessionId;
    };
} | {
    readonly code: 'internal';
    readonly message: string;
    readonly details: Record<never, never>;
};
/** Result of resolving one session identity to its live Agent. */
export type ApiRemoteAgentResult = {
    readonly agent: Agent;
} | {
    readonly error: ApiRemoteLookupError;
};
/** Resume configuration supplied by the owning Host composition. */
export interface ApiRemoteAgentOptions {
    /** Read the per-Agent defaults when a cold identity must resume. */
    readonly agentOptions?: () => AgentOptions;
    /**
     * Build the Host-specific Agent-scope composition completed before
     * publication. Keyed by the resumed session itself because what a Host
     * installs may depend on what that session recorded: an agent preset fixes
     * the tools its history was produced under, so rebuilding it under another
     * composition would replay tool calls the agent can no longer make. The
     * events come along because a session's own record of such a choice may be
     * an event rather than a header field.
     * @param session - the resumed session's persisted header and event log.
     * @returns the Agent-scope setup to run before publication.
     */
    readonly setup?: (session: {
        meta: SessionHeader;
        events: readonly SessionEvent[];
    }) => AgentSetup | Promise<AgentSetup>;
}
/** Cold identity absent from the durable session store. */
export declare class ApiRemoteSessionNotFound extends Error {
}
/** Session identity whose lifecycle belongs to subagent routing. */
export declare class ApiRemoteSubagentSessionOwnership extends Error {
    readonly sessionId: SessionId;
    /**
     * Construct the ownership fence.
     * @param sessionId - identity reserved to subagent routing.
     */
    constructor(sessionId: SessionId);
}
/**
 * Test whether generic Host routing must leave an identity to subagent routing.
 * @param ctx - Host Context carrying the live Agent registry.
 * @param session - attached or live Session metadata.
 * @param agent - live Agent when one is registered.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
export declare function hasApiRemoteSubagentOwner(ctx: Context, session: Pick<Session, 'header'>, agent: Agent | undefined): boolean;
/**
 * Build the stable caller-facing ownership rejection.
 * @param sessionId - identity reserved to subagent routing.
 * @returns the existing `agent-busy` RPC shape.
 */
export declare function apiRemoteSubagentOwnershipError(sessionId: SessionId): ApiRemoteLookupError;
/**
 * Inspect one cold served session without repairing, resuming, or publishing it.
 * @param ctx - Host Context carrying the optional persistence provider.
 * @param sessionId - durable identity to inspect.
 * @returns detached metadata and events for a servable session.
 * @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
 */
export declare function inspectApiRemoteSession(ctx: Context, sessionId: SessionId): Promise<{
    meta: SessionHeader;
    events: SessionEvent[];
}>;
/**
 * Create the Host's shared Agent resolver and configure Agent/Session Typert lookups.
 * Live Agents are reused, ordinary cold sessions resume once per identity, and
 * subagent-owned identities retain the legacy `agent-busy` fence.
 * @param ctx - owning Host Context.
 * @param options - defaults and Agent-scope setup used only for cold resume.
 * @returns resolver shared by legacy API Proxy methods and Typert lookups.
 */
export declare function createApiRemoteAgentResolver(ctx: Context, options: ApiRemoteAgentOptions): (sessionId: SessionId) => Promise<ApiRemoteAgentResult>;
//# sourceMappingURL=agent-lookup.d.ts.map