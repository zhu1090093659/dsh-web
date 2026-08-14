import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { TypertClientRemote, TypertRemoteScopeApi } from '@deepseek-ai/dsh-typert-protocol';
/** Client Cordis Context carrying one Agent identity and its scoped Remote namespaces. */
export type AgentContext = Omit<Context, 'remote'> & {
    readonly remote: TypertClientRemote & TypertRemoteScopeApi<'agent'>;
};
/** A minted Agent scope and its disposal boundary. */
export interface AgentScopeHandle {
    /**
     * Tagged context: scope-owned registrations and scoped dispatch both go
     * through it (passing it as the dispatch subject routes to this agent's
     * tagged listeners plus every untagged one).
     */
    ctx: AgentContext;
    /** Backing fiber (dispose tears down every scope-owned registration). */
    fiber: Fiber;
}
/**
 * Mint an Agent scope under `ctx`: a no-op plugin fiber whose context
 * carries the agent tag and the dispatch filter — untagged listeners are
 * admitted globally, tagged listeners only for a matching agent.
 * Registrations through the returned ctx dispose with the fiber.
 * @param ctx - client root context the scope fiber mounts under.
 * @param key - owning agent identity (the routing tag; agent id === session id).
 * @returns the tagged context and its backing fiber.
 */
export declare function createScope(ctx: Context, key: SessionId): AgentScopeHandle;
/**
 * Read the nearest agent tag inherited by a context.
 * @param ctx - any client context.
 * @returns its agent identity (the session id), or undefined for root contexts.
 */
export declare function scopeOf(ctx: Context): SessionId | undefined;
//# sourceMappingURL=scope.d.ts.map