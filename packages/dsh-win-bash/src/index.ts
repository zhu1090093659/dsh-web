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
 * Availability gate: win_bash serves sessions that run the LiangShen (梁神)
 * preset, so its registration follows that preset's DECLARATION in the
 * harness's agent-preset registry — declared means registered, undeclared
 * means the tool is never registered and one info line says why. The gate's
 * config escape hatch is syncWithLiangShen: false, which skips it and always
 * registers. See ./gate.ts for the API the gate reads and the timing
 * constraints it satisfies.
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
 * same lifecycle, lifted with the agent and with the fiber. apply() returns as
 * soon as the plugin is configured: the gate decides in mountWithGate, whose
 * promise is deliberately NOT returned from apply (see that function).
 * @module @linxin666/dsh-win-bash
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig, type WinBashConfig, type WinBashConfigInput } from './config.ts'
import { startLiangShenGate, LIANGSHEN_PRESET_ID, type GateOptions, type GateOutcome } from './gate.ts'
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
  DEFAULT_SYNC_WITH_LIANGSHEN,
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
  GATE_DECLARATION_WAIT_MS,
  GATE_POLL_INTERVAL_MS,
  GATE_READ_TIMEOUT_MS,
  GATE_SETTLE_TIMEOUT_MS,
  LIANGSHEN_PRESET_ID,
  declaresLiangShen,
  readPresetRegistry,
  settleHostTree,
  startLiangShenGate,
  type GateOptions,
  type GateOutcome,
  type GateReason,
  type PresetRosterReader,
  type PresetRosterRow,
  type SettleStatus,
} from './gate.ts'
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
 * One human-readable line explaining a refused gate verdict.
 * @param outcome - the gate's verdict.
 * @returns the message the entry logs.
 */
export function gateRefusalMessage(outcome: GateOutcome): string {
  const settleNote = outcome.settled === 'timed-out'
    ? '; the host plugin tree did not settle in time, so the roster was read during boot'
    : ''
  if (outcome.reason === 'registry-absent') {
    return 'win_bash was not registered (syncWithLiangShen is on and this deployment publishes no agent-preset registry,'
      + ' so a preset with id ' + LIANGSHEN_PRESET_ID + ' cannot be declared)' + settleNote
  }
  if (outcome.reason === 'registry-unreadable') {
    return 'win_bash was not registered (syncWithLiangShen is on and the agent-preset registry roster could not be read)'
      + settleNote
  }
  return 'win_bash was not registered (syncWithLiangShen is on and no preset with id '
    + LIANGSHEN_PRESET_ID + ' is declared; enable the dsh-liangshen plugin row, or set syncWithLiangShen to false to'
    + ' register this shell without the preset)' + settleNote
}

/**
 * Register the win_bash tool and its per-session shell registry on the calling
 * fiber. Called only once per fiber: the caller decides whether to call at all.
 *
 * The host pwsh replacement is installed from HERE and not from the gate or
 * apply, because its precondition is exactly "win_bash is now on the wire": a
 * deployment whose gate refused, whose payload failed verification, or that
 * runs on a POSIX host never reaches this function and therefore never touches
 * the host's shell.
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
 * Apply the availability gate, then register the tool when it allows it.
 *
 * The returned promise is deliberately NOT awaited by apply: the gate's roster
 * read audits every declared preset and can await the Host loader tree, which
 * still counts this very activation among its pending tasks — awaiting it from
 * inside the activation would make the two waits depend on each other and
 * neither would settle. Keeping the decision off the activation path also
 * keeps the loader entry's own inertia free of it, so the tree can settle.
 *
 * A fiber disposed while the gate was deciding registers nothing: its tool
 * effect would be refused anyway, and its shells would outlive it.
 * @param ctx - context carrying tools and subprocess.
 * @param config - the resolved configuration.
 * @param runtime - the verified payload paths.
 * @param options - gate deadlines; the defaults are the shipped bounds.
 * @returns the decision, for the caller to observe (never rejects).
 */
export async function mountWithGate(
  ctx: Context,
  config: WinBashConfig,
  runtime: RuntimeReady,
  options: GateOptions = {},
): Promise<void> {
  let closed = false
  ctx.effect(() => () => { closed = true }, 'dsh-win-bash: gate continuation lifetime')

  const mount = (announcement?: string): void => {
    if (announcement !== undefined) ctx.logger?.info?.(announcement)
    // Registration is deliberately OUTSIDE the gate's try: a tool registry that
    // refuses the registration is not a gate defect, and reporting it as one
    // would send an operator to the wrong place. It must also not escape as a
    // rejection, because this continuation is not awaited by the loader's own
    // activation and an unhandled rejection here kills the whole process.
    try {
      registerWinBash(ctx, config, runtime)
    } catch (error) {
      ctx.logger?.error?.('dsh-win-bash: win_bash could not be registered: '
        + (error instanceof Error ? error.message : String(error)))
    }
  }

  if (!config.syncWithLiangShen) {
    mount()
    return
  }

  let outcome: GateOutcome
  try {
    outcome = await startLiangShenGate(ctx, options)
  } catch (error) {
    // The gate contains its own failures; this arm keeps a defect in it from
    // escaping as an unhandled rejection, which the host's fail-loud guard
    // turns into a whole-process kill.
    if (closed) return
    ctx.logger?.warn?.('dsh-win-bash: win_bash was not registered (the LiangShen availability gate failed: '
      + (error instanceof Error ? error.message : String(error)) + ')')
    return
  }
  if (closed) return
  if (!outcome.allowed) {
    ctx.logger?.info?.('dsh-win-bash: ' + gateRefusalMessage(outcome))
    return
  }
  mount('dsh-win-bash: win_bash registered (the ' + LIANGSHEN_PRESET_ID + ' preset is declared)')
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
  // runs. Detached like the mount continuation below, and self-contained, because
  // an unreclaimed directory must never keep the plugin from mounting.
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
  // Deliberately detached (see mountWithGate), with a last-resort catch so no
  // defect above can surface as the unhandled rejection that kills the process.
  void mountWithGate(ctx, resolved, runtime).catch((error: unknown) => {
    ctx.logger?.error?.('dsh-win-bash: the mount continuation failed: '
      + (error instanceof Error ? error.message : String(error)))
  })
}
