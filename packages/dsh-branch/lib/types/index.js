/**
 * @linxin666/dsh-client-ui-branch — host half: the workspace-gated file
 * service and its /branch/* HTTP routes. The browser half (exports
 * "./client") is served by client-modules from the same package.
 */
import { realpath } from 'node:fs/promises';
import { BranchFsService } from "./host/fs-service.js";
import { registerBranchRoutes } from "./host/routes.js";
export const inject = ['webServer', 'workspaceRegistry'];
function createWorkspaceGate(ctx) {
    return async (path) => {
        let canonical;
        try {
            canonical = await realpath(path);
        }
        catch {
            return { ok: false, error: { code: 'workspace-unknown', message: 'path does not resolve on disk' } };
        }
        if (ctx.workspaceRegistry.list().some(workspace => workspace.path === canonical)) {
            return { ok: true, canonical };
        }
        return { ok: false, error: { code: 'workspace-unknown', message: 'path is not a registered workspace' } };
    };
}
export function apply(ctx) {
    const service = new BranchFsService(createWorkspaceGate(ctx));
    ctx.effect(() => registerBranchRoutes(ctx, service), 'dsh-branch: /branch routes');
}
