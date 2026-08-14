/**
 * Internal registry of deployment capabilities composed into every continuable
 * child's unpublished creation context.
 *
 * A contribution grants a child-scoped capability without teaching the
 * continuation manager which capabilities exist. The manager owns residency;
 * this registry owns the join between plugin lifetime, unpublished setup, and
 * Activation disposal, so no installation outlives either owner and no removed
 * contribution can be installed after revocation reports completion.
 *
 * @module @deepseek-ai/dsh-subagent/activation-setup-registry
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AgentSetupCommit } from '@deepseek-ai/dsh-agent';
/**
 * One deployment capability installed into a continuable child's unpublished
 * creation context. It composes synchronously before publication and returns
 * the disposer for exactly that installation.
 * @param childCtx - the child's unpublished scoped context.
 * @returns the disposer revoking this installation.
 */
export type ContinuableSetupContribution = (childCtx: Context) => () => void;
/**
 * Owns continuable-child setup registrations, installations, rollback, child
 * cleanup, and immediate live revocation.
 */
export declare class SubagentActivationSetupRegistry {
    /** Live contributions in installation order. */
    private readonly registrations;
    /** Child context to its live installations. */
    private readonly byChild;
    /**
     * Register one contribution.
     * @param contribution - synchronous child-scope installer.
     * @returns an idempotent registration undo.
     * @throws after attempting every installation when any disposer fails.
     */
    register(contribution: ContinuableSetupContribution): () => void;
    /**
     * Install every live contribution into one unpublished child context.
     * @param childCtx - the child's unpublished scoped context.
     * @returns the provisioning commit consumed at Agent publication.
     */
    apply(childCtx: Context): AgentSetupCommit;
    /** Release every remaining installation owned by one disposed child scope. */
    private releaseChild;
    /**
     * Release a batch completely before reporting disposer failures.
     * @param installations - records to release.
     * @param during - operation name for diagnostics.
     */
    private releaseAll;
    /** Drop one installation from both indices and dispose it exactly once. */
    private release;
}
export default SubagentActivationSetupRegistry;
//# sourceMappingURL=activation-setup-registry.d.ts.map