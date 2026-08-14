/** Platform-neutral assembly of generated Host Remote contributions. */
import commandsRemote from '@deepseek-ai/dsh-commands/remote';
import goalsRemote from '@deepseek-ai/dsh-goal/remote';
import dynamicRemote from '@deepseek-ai/dsh-cordis-host-runner/remote';
import pluginInventoryRemote from '@deepseek-ai/dsh-host-plugin-inventory/remote';
import messageFeedbackRemote from '@deepseek-ai/dsh-message-feedback/remote';
/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote'];
/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx) {
    const disposers = [];
    try {
        for (const contribution of [
            commandsRemote, goalsRemote, dynamicRemote, pluginInventoryRemote, messageFeedbackRemote,
        ]) {
            disposers.push(await ctx.remote.$mount(contribution));
        }
    }
    catch (error) {
        for (const dispose of disposers.reverse())
            await dispose();
        throw error;
    }
    // Unwound in reverse mount order, so a namespace never outlives one mounted
    // after it.
    return async () => {
        for (const dispose of disposers.reverse())
            await dispose();
    };
}
//# sourceMappingURL=index.js.map