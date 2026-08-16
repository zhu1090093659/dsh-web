/**
 * @linxin666/dsh-client-ui-branch — host half: the workspace-gated file
 * service and its /branch/* HTTP routes. The browser half (exports
 * "./client") is served by client-modules from the same package.
 */
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import type { BranchError } from './core/types.ts'
import { BranchFsService, type WorkspaceGate } from './host/fs-service.ts'
import { registerBranchRoutes } from './host/routes.ts'

export const inject = ['webServer', 'workspaceRegistry']

function createWorkspaceGate(ctx: Context): WorkspaceGate {
  return async (path) => {
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'path does not resolve on disk' } as BranchError }
    }
    if (ctx.workspaceRegistry.list().some(workspace => workspace.path === canonical)) {
      return { ok: true, canonical }
    }
    return { ok: false, error: { code: 'workspace-unknown', message: 'path is not a registered workspace' } as BranchError }
  }
}

export function apply(ctx: Context): void {
  const service = new BranchFsService(createWorkspaceGate(ctx))
  ctx.effect(() => registerBranchRoutes(ctx, service), 'dsh-branch: /branch routes')
}
