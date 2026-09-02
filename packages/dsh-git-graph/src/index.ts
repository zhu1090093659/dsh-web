/**
 * @linxin666/dsh-client-ui-git-graph — host half: the workspace-gated git
 * service and its /git/* HTTP routes (JSON operations + SSE change stream)
 * on the shared webserver, plus the opt-in model-facing git_worktree tool.
 * The browser half (exports "./client") is served by client-modules from
 * the same package's dsh.client declaration.
 *
 * The UI-triggered git verbs (switch/create-branch/worktree operations) own
 * no model-visible surface. The git_worktree tool is the deliberate,
 * settings-gated exception (agentTool, default off): while enabled, agents
 * may create/list/remove managed worktrees of their calling session's
 * repository.
 * @module @linxin666/dsh-client-ui-git-graph
 */

import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type { GitFeatureConfig } from './core/types.ts'
import { GitService, subprocessRunner, type WorkspaceGate } from './host/git-service.ts'
import { registerGitRoutes } from './host/routes.ts'
import { buildWorktreeTool } from './host/agent-tool.ts'
import { worktreesHome } from './host/worktree-home.ts'
import { mountOnce } from './mount-once.ts'

/** Required services: the route registry, the managed subprocess seam, and the workspace registry. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/** Plugin config (settings-editable through the Web settings card). */
export interface Config {
  /** Auto-isolate every New Session of a git workspace into a fresh managed worktree. */
  autoIsolate?: boolean
  /** Baseline for auto-created worktrees: the checkout's current HEAD or the remote default branch. */
  autoBaseline?: 'current' | 'default'
  /** Register the model-facing git_worktree tool (opt-in; off keeps git off the model-visible surface). */
  agentTool?: boolean
}

/** Schemastery schema backing the settings card and profile patch values. */
export const Config: z<Config> = z.object({
  autoIsolate: z.boolean().default(false),
  autoBaseline: z.union(['current', 'default'] as const).default('current'),
  agentTool: z.boolean().default(false),
})

/** The settings-card namespace of this plugin. */
export const GIT_GRAPH_SETTINGS = 'git-graph' as SettingsNamespace

/** Resolve the effective config with schema defaults applied. */
function effectiveConfig(config?: Config): Required<Config> {
  return {
    autoIsolate: config?.autoIsolate ?? false,
    autoBaseline: config?.autoBaseline ?? 'current',
    agentTool: config?.agentTool ?? false,
  }
}

/**
 * The workspace-membership gate: canonicalize the requested path and require
 * it to equal a registered workspace path. This is the security boundary of
 * the /git routes — the browser may only run git on workspace roots, never
 * arbitrary host directories.
 */
function createWorkspaceGate(ctx: Context): WorkspaceGate {
  return async (path) => {
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'path does not resolve on disk' } }
    }
    if (ctx.workspaceRegistry.list().some(workspace => workspace.path === canonical)) {
      return { ok: true, canonical }
    }
    return { ok: false, error: { code: 'workspace-unknown', message: 'path is not a registered workspace' } }
  }
}

/**
 * Mount the git service, its routes, the settings card, and the opt-in tool.
 * @param ctx - context carrying webServer, subprocess, and workspaceRegistry.
 * @param config - profile patch values (the settings card re-sources them).
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-git-graph', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const service = new GitService(subprocessRunner(ctx), createWorkspaceGate(ctx))

  // The live config source: installSection swaps it when the user
  // edits the settings card; onChange re-syncs derived registrations.
  let current: () => Required<Config> = () => effectiveConfig(config)
  const featureConfig = (): GitFeatureConfig => {
    const active = current()
    return {
      autoIsolate: active.autoIsolate,
      autoBaseline: active.autoBaseline,
      worktreesHome: worktreesHome(),
    }
  }

  // The git_worktree tool registers only while agentTool is on. The tools
  // service is awaited lazily so the plugin never hard-depends on it.
  let toolFiber: ReturnType<Context['inject']> | undefined
  const syncTool = (): void => {
    const want = current().agentTool
    if (want && toolFiber === undefined) {
      toolFiber = ctx.inject(['tools'], (toolCtx: Context) => {
        toolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), 'dsh-git-graph: git_worktree tool')
      })
    } else if (!want && toolFiber !== undefined) {
      toolFiber.dispose()
      toolFiber = undefined
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    try {
      if (typeof settingsCtx.settings?.installSection === 'function') {
        settingsCtx.settings.installSection(ctx, GIT_GRAPH_SETTINGS, Config, effectiveConfig(config), {
          setSource: (source) => { current = () => effectiveConfig(source()) },
          onChange: syncTool,
        })
      } else if (typeof settingsCtx.settings?.register === 'function') {
        const scope = settingsCtx.settings.register(GIT_GRAPH_SETTINGS, Config, {
          base: effectiveConfig(config),
        })
        current = () => effectiveConfig(scope.get?.())
        scope.watch?.(() => {
          syncTool()
        })
        syncTool()
      }
    } catch {
      // Defensive fallback against settings registration differences
    }
  })
  ctx.effect(() => {
    syncTool()
    const disposeRoutes = registerGitRoutes(ctx, service, featureConfig)
    return () => {
      disposeRoutes()
      toolFiber?.dispose()
      toolFiber = undefined
    }
  }, 'dsh-git-graph: /git routes + tool')
}