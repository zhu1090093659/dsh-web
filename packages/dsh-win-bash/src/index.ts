/**
 * Host-half entry for the dsh-win-bash plugin.
 *
 * The plugin owns exactly one model-facing capability — the win_bash tool over
 * a per-session persistent bash process — and nothing else. It registers no
 * settings section, no HTTP route and no browser half: the Host renders the
 * configuration form for this row from the exported Config schema.
 *
 * Mount-time integrity: before the tool is registered at all, the vendored
 * payload is checked against its shipped SHA256 manifest. A mismatch refuses
 * the mount with a specific message rather than running commands through
 * bytes nobody verified. The tool is also refused on every non-Windows host
 * and on a Windows host that is not x64, because no PATH bash is ever used as
 * a substitute.
 *
 * Mount-time publication: the tree that is spawned is a verified copy outside
 * this package, not the tree inside node_modules. A persistent shell holds its
 * own executable open, and Windows refuses to rename a directory that holds a
 * running executable, so a shell started inside the package makes pnpm's
 * import of this package fail with ERR_PNPM_EPERM. Publishing the payload
 * outside the package is what lets an update or uninstall run while sessions
 * are live. The copy's mandatory integrity label is checked before reuse and
 * before execution: a Low-labelled cache is abandoned for an isolated root
 * instead of starting a Low-integrity shell. A cache that cannot be written,
 * or no safe root at all, keeps the tool working from the packaged tree and
 * logs that updates will need this host stopped.
 *
 * Registration: on a supported Windows x64 host the tool registers as soon as
 * the payload verifies and the config resolves — availability follows the
 * platform, the shipped payload and the configuration alone, with no preset
 * registry read. apply() registers synchronously; a failed payload check
 * refuses the mount, a config error is thrown, and a tool-registry refusal is
 * caught and logged so it never escapes apply as an unhandled rejection.
 * A retired availability key left in an old profile row is ignored, not rejected.
 *
 * Host shell replacement: once win_bash is registered, the host's own pwsh
 * tool is withdrawn from each session win_bash can actually SERVE - the
 * sessions whose own sandbox mode is danger-full-access - so their command work
 * goes to bash rather than to the shell a model already knows. A session in any
 * other mode keeps its pwsh, because win_bash refuses to run there and pwsh is
 * then the only shell it has. Windows only, visibility only, per agent scope,
 * and re-evaluated when a session switches mode; see ./pwsh-replacement.ts for
 * why it is neither global nor an execution denial.
 *
 * Lifecycle: one shell process per calling agent, released when that agent is
 * disposed and when the plugin fiber unloads. The pwsh restriction follows the
 * same lifecycle, lifted with the agent and with the fiber. apply() registers
 * the tool directly once the payload and config check out; a tool-registry
 * failure is logged rather than escaping as an unhandled rejection.
 * @module @linxin666/dsh-win-bash
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig, type WinBashConfig, type WinBashConfigInput } from './config.ts'
import { installPwshReplacement } from './pwsh-replacement.ts'
import { prepareRuntime, type RuntimeReady, type HostPlatform } from './runtime.ts'
import { ShellRegistry, sweepOrphanShellTempDirs } from './shell.ts'
import { buildWinBashTool } from './tool.ts'

export { BACKGROUND_JOB_KIND, startBackgroundJob } from './background.ts'
export type {
  BackgroundCommand,
  JobHandleLike,
  JobHooksLike,
  JobOutcomeLike,
  JobOutputSourceLike,
  JobRegistryLike,
  JobSourceReadLike,
} from './background.ts'

export { Config }
export type { WinBashConfig, WinBashConfigInput }
export {
  CONFIG_DEFAULTS,
  DEFAULT_DESCRIPTION,
  DEFAULT_ENABLE_RUN_IN_BACKGROUND,
  DEFAULT_REPLACE_PWSH,
  validateConfig,
} from './config.ts'
export {
  HOST_PWSH_TOOL,
  SERVING_MODE,
  installPwshReplacement,
  type PwshReplacementOptions,
  type ScopedRestrictor,
  type SessionPolicyReader,
} from './pwsh-replacement.ts'
export { WIN_BASH_TOOL, renderResult, readJobRegistry, stripTerminalEscapes, truncationNotice } from './tool.ts'
export type { RenderFacts } from './tool.ts'
export {
  SHELL_TEMP_PREFIX,
  ShellRegistry,
  ShellUnavailableError,
  removeShellTempDir,
  shellArgv,
  shellEnvironment,
  shellTempDir,
  sweepOrphanShellTempDirs,
  type ShellTempSweep,
  type ShellTempSweepOptions,
} from './shell.ts'
export { buildFrame, markerFor, parseFrame } from './protocol.ts'
export {
  CACHE_DIR_PARTS,
  CACHE_STAGING_PREFIX,
  ISOLATED_CACHE_DIR_PARTS,
  RUNTIME_ROOT_ENV,
  bashIn,
  bashPath,
  binIn,
  cacheRoot,
  isolatedCacheRoot,
  parseChecksums,
  payloadKey,
  prepareRuntime,
  resolveRuntime,
  runtimeRoot,
  shIn,
  shPath,
  verifyPayload,
  verifyPayloadRoot,
  type CopyTree,
  type PrepareRuntimeOptions,
} from './runtime.ts'

/** Cordis plugin name; also the loader row id this package mounts under. */
export const name = 'dsh-win-bash'

/** Required services: the tool registry and the managed subprocess seam. */
export const inject = ['tools', 'subprocess']

/**
 * Register the win_bash tool and its per-session shell registry on the calling
 * fiber. Called only once per fiber: the caller decides whether to call at all.
 *
 * The host pwsh replacement is installed from HERE and not from apply, because
 * its precondition is exactly "win_bash is now on the wire": a deployment whose
 * payload failed verification, whose config was rejected, or that runs on a
 * POSIX host never reaches this function and therefore never touches the host's
 * shell.
 * @param ctx - context carrying tools and subprocess.
 * @param config - the resolved configuration.
 * @param runtime - the verified payload paths.
 */
export function registerWinBash(ctx: Context, config: WinBashConfig, runtime: RuntimeReady): void {
  const shells = new ShellRegistry(ctx.subprocess)
  const tool = buildWinBashTool(ctx, config, runtime, shells)

  ctx.effect(() => {
    const unregister = ctx.tools.register(tool)
    return async () => {
      unregister()
      // Unload must reach quiescence: the shells are real processes the host
      // would otherwise keep hosting with nobody able to talk to them.
      await shells.disposeAll('the dsh-win-bash plugin was unloaded')
    }
  }, 'dsh-win-bash: win_bash tool and its persistent shells')

  // One session's shell dies with that session. The agent object is the key,
  // so a session that ends for any reason (close, archive, reload) releases
  // its process instead of leaving it to the plugin's own disposal.
  ctx.on('agent/disposed', ({ agent }) => {
    void shells.dispose(agent, 'the owning agent was disposed')
  })

  if (config.replacePwsh) installPwshReplacement(ctx)
}

/**
 * Mount the plugin.
 * @param ctx - context carrying tools and subprocess.
 * @param config - the row's config, validated by {@link Config}.
 */
export function apply(ctx: Context, config?: WinBashConfigInput): void {
  const host: HostPlatform = { platform: process.platform, arch: process.arch }
  // The payload is published outside the package before the tool is built: a
  // shell spawned from node_modules would make every later update or uninstall
  // of this package fail with ERR_PNPM_EPERM while it runs. A cache that cannot
  // be written keeps the tool working from the packaged tree and says so.
  const runtime = prepareRuntime({
    host,
    warn: (message: string) => { ctx.logger?.warn?.('dsh-win-bash: ' + message) },
  })
  if ('code' in runtime) {
    // Refusing the mount is the point: there is no fallback shell, and a
    // mounted tool that always errors is worse than an honest absence.
    ctx.logger?.warn?.('dsh-win-bash: win_bash was not mounted (' + runtime.code + '): ' + runtime.message)
    return
  }
  let resolved: WinBashConfig
  try {
    resolved = resolveConfig(config)
  } catch (error) {
    ctx.logger?.error?.('dsh-win-bash: ' + (error instanceof Error ? error.message : String(error)))
    throw error
  }
  // Every shell owns a private temp directory under the machine's temp root and
  // deletes it when it stops. A crash or a hard kill ends this process first, and
  // those directories are not small - whatever the commands wrote under TMP/TEMP
  // is still in them. Their names carry the owning pid, so this start can tell
  // which ones nobody owns any more; the sweep keeps the ones whose pid still
  // runs. Detached and self-contained, because an unreclaimed directory must
  // never keep the plugin from mounting.
  void sweepOrphanShellTempDirs().then((sweep) => {
    if (sweep.removed.length > 0) {
      ctx.logger?.info?.('dsh-win-bash: reclaimed ' + sweep.removed.length.toString()
        + ' orphaned shell temp directories left by earlier runs')
    }
    if (sweep.failed.length > 0) {
      ctx.logger?.warn?.('dsh-win-bash: ' + sweep.failed.length.toString()
        + ' orphaned shell temp directories could not be reclaimed and will be retried on the next start: '
        + sweep.failed.join(', '))
    }
  }, (error: unknown) => {
    ctx.logger?.warn?.('dsh-win-bash: the orphaned shell temp directory sweep failed: '
      + (error instanceof Error ? error.message : String(error)))
  })
  // Registration is caught here rather than left to escape: apply runs on the
  // loader's activation path, and a registration refusal that surfaced as a
  // rejection would fail the whole web boot instead of this one tool.
  try {
    registerWinBash(ctx, resolved, runtime)
  } catch (error) {
    ctx.logger?.error?.('dsh-win-bash: win_bash could not be registered: '
      + (error instanceof Error ? error.message : String(error)))
  }
}
