/**
 * LiangShen availability gate for the win_bash tool.
 *
 * win_bash serves sessions that run the LiangShen (梁神) preset, so its
 * availability follows that preset's DECLARATION: this gate asks the harness's
 * agent-preset registry whether a preset with id liangshen is declared, and the
 * entry registers no tool at all when it is not. The alternative — mounting a
 * tool whose every call refuses — teaches the model a capability the session
 * does not have, which is worse than an honest absence.
 *
 * The registry read is STRUCTURAL, not an import: this package does not depend
 * on @deepseek-ai/dsh-agent-preset-registry (a leaf plugin takes no SDK
 * dependency to read one optional service), so the single method consumed is
 * mirrored from the published declaration of
 * @deepseek-ai/dsh-agent-preset-registry@0.2.2-alpha.3, lib/types/index.d.ts:
 *
 *   export declare class AgentPresetRegistry {
 *     list(): Promise<AgentPreset[]>
 *   }
 *   export interface AgentPreset {
 *     readonly id: string
 *     readonly name?: string
 *     readonly broken?: string
 *   }
 *
 * list() is the registry's public DEFINITION roster: it resolves every declared
 * definition, including activation failures (which each row reports), so it
 * answers exactly the "is this preset declared here" question. The narrower
 * resolve(id) cannot: it REJECTS for an undeclared id, so a probe built on it
 * would have to read a rejection as "absent" and could not tell that apart from
 * a real failure of a preset that IS declared.
 *
 * The service is read with ctx.get, never a hard inject: a deployment may
 * compose no preset registry at all, and waiting on one would pend this row
 * forever — which under the Host's boot gate fails the whole web boot rather
 * than this one plugin (the trap dsh-liangshen documents as issue #1712).
 *
 * Timing. Two facts about the pieces this talks to shape the verdict:
 *
 * 1. Rows in one loader group mount concurrently (the loader starts every entry
 *    of a group in the same tick), so this row cannot assume the LiangShen row
 *    ran first. The verdict therefore waits for the Host plugin tree to settle
 *    before its first read, rather than reading during the boot race.
 * 2. The declaration does not arrive with that row's activation return: the
 *    declaring plugin schedules it on its own detached promise chain (it
 *    persists module rows, so it cannot block activation on the mount). The
 *    tree can therefore settle one or more turns BEFORE the registry holds the
 *    definition, and a single read would answer "not declared" for a
 *    deployment that is about to declare it.
 *
 * So a read that already sees the declaration decides immediately and costs
 * nothing; a read that does not re-reads on a bounded schedule until the
 * declaration appears or the deadline passes. The wait is never paid in the
 * common case, and it never turns a late declaration into a refusal. It runs
 * entirely off the plugin's activation path (see the entry), so it delays no
 * boot work; it only decides when win_bash becomes available.
 *
 * The registry exposes NO declaration-change event. Its only declared preset
 * event is agent-preset/selected, which records one SESSION's committed preset
 * to that session's durable log (lib/types/types.d.ts) and says nothing about
 * the roster. The verdict is therefore decided once per mount, and a switch
 * toggle takes effect through the plugin manager's row refresh, which remounts
 * this row and re-runs the gate — the same freshness model the family's row
 * ledger uses.
 * @module @linxin666/dsh-win-bash/gate
 */

import type { Context } from '@deepseek-ai/cordis'

/** Preset id whose declaration makes win_bash available. */
export const LIANGSHEN_PRESET_ID = 'liangshen'

/** Upper bound on the wait for the Host plugin tree to settle, in milliseconds. */
export const GATE_SETTLE_TIMEOUT_MS = 10_000

/** Upper bound on one registry roster read, in milliseconds. */
export const GATE_READ_TIMEOUT_MS = 10_000

/**
 * How long a roster that does not yet declare LiangShen keeps being re-read,
 * in milliseconds. See the module header: the declaring plugin publishes the
 * definition on a detached chain, so the tree can settle first. Only paid when
 * the declaration is genuinely absent, since a visible one returns at once.
 */
export const GATE_DECLARATION_WAIT_MS = 5_000

/** Re-read cadence during {@link GATE_DECLARATION_WAIT_MS}, in milliseconds. */
export const GATE_POLL_INTERVAL_MS = 250

/**
 * The deadlines and cadence one gate run uses. The defaults are the shipped
 * values; tests pass small ones so a bounded wait is exercised without a slow
 * suite.
 */
export interface GateOptions {
  /** Bound on the Host plugin-tree settle wait, in milliseconds. */
  settleTimeoutMs?: number
  /** Bound on one registry roster read, in milliseconds. */
  readTimeoutMs?: number
  /** Total time a late declaration may take to appear, in milliseconds. */
  declarationWaitMs?: number
  /** Re-read cadence during that wait, in milliseconds. */
  pollIntervalMs?: number
}

/** One roster row, as much of it as this gate reads. */
export interface PresetRosterRow {
  /** Stable preset identifier. */
  readonly id: string
}

/** The one registry method this gate consumes. */
export interface PresetRosterReader {
  /** Read every declared preset, including activation failures. */
  list(): Promise<readonly PresetRosterRow[]>
}

/** Why the gate reached its verdict. */
export type GateReason =
  /** The registry declares the LiangShen preset. */
  | 'declared'
  /** The registry answered and declares no preset with the LiangShen id. */
  | 'not-declared'
  /** No agent-preset registry usable for this read is published. */
  | 'registry-absent'
  /** A registry is published, but its roster never answered. */
  | 'registry-unreadable'

/** How far the Host plugin-tree settle got before the roster was read. */
export type SettleStatus =
  /** Every Host loader entry and plugin lifecycle task finished. */
  | 'settled'
  /** No loader service is published, so there was nothing to settle. */
  | 'unavailable'
  /** The tree did not settle within the settle bound. */
  | 'timed-out'

/** The gate's verdict: whether win_bash may register, and why. */
export interface GateOutcome {
  /** True only for {@link GateReason} declared. */
  readonly allowed: boolean
  /** The reason, for the caller's log line. */
  readonly reason: GateReason
  /** Whether the Host tree settled before the roster was read. */
  readonly settled: SettleStatus
  /** How many roster reads the verdict cost. */
  readonly reads: number
}

/**
 * Whether a roster declares the preset this tool follows.
 * @param presets - rows as {@link PresetRosterReader.list} returns them.
 * @returns true when one row carries the LiangShen id.
 */
export function declaresLiangShen(presets: readonly PresetRosterRow[]): boolean {
  return presets.some(preset => preset?.id === LIANGSHEN_PRESET_ID)
}

/**
 * Read one optional service without letting a refused lookup escape: a cordis
 * service proxy throws for a name it cannot resolve, and an absent optional
 * service is an ordinary state here, not an error.
 * @param ctx - the plugin context.
 * @param name - the service name.
 * @returns the service, or undefined when it is not resolvable.
 */
function readService(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(key: string): unknown }).get(name)
  } catch {
    return undefined
  }
}

/**
 * The published registry, when this deployment has one shaped like the one this
 * gate consumes.
 * @param ctx - the plugin context.
 * @returns the reader, or undefined when no usable registry is published.
 */
export function readPresetRegistry(ctx: Context): PresetRosterReader | undefined {
  const candidate = readService(ctx, 'agentPresets')
  if (candidate === null || typeof candidate !== 'object') return undefined
  if (typeof (candidate as { list?: unknown }).list !== 'function') return undefined
  return candidate as PresetRosterReader
}

/**
 * Run one promise with a deadline. The timer is always cleared, so a fast
 * answer leaves no stray handle behind.
 * @param work - the promise to bound.
 * @param timeoutMs - the bound in milliseconds.
 * @returns the promise's value.
 * @throws when the deadline passes first.
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('timed out after ' + timeoutMs.toString() + 'ms')) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Wait until the Host loader tree has no pending import or lifecycle work.
 *
 * Waiting for the whole tree rather than this row's neighbours is deliberate:
 * the roster belongs to the deployment, not to one group, and the loader's own
 * await() is the only predicate that means "every row has been applied". A row
 * merely waiting for a service it will never get carries no pending task, so it
 * cannot hold this wait open; one that is genuinely mid-activation can, which is
 * exactly the case the bound covers.
 * @param ctx - the plugin context.
 * @param options - the deadlines for this run.
 * @returns how far the settle got.
 */
export async function settleHostTree(ctx: Context, options: GateOptions = {}): Promise<SettleStatus> {
  const loader = readService(ctx, 'loader')
  if (loader === null || typeof loader !== 'object') return 'unavailable'
  const wait = (loader as { await?: unknown }).await
  if (typeof wait !== 'function') return 'unavailable'
  try {
    await withDeadline(
      Promise.resolve((wait as () => Promise<void>).call(loader)).then(() => undefined),
      options.settleTimeoutMs ?? GATE_SETTLE_TIMEOUT_MS,
    )
    return 'settled'
  } catch {
    return 'timed-out'
  }
}

/**
 * Sleep one timer turn.
 *
 * Production code, not a test helper: the wait IS the declaration window the
 * module header describes, and the gate is only ever reached from a mount.
 * @param ms - how long to wait.
 */
function waitFor(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

/** One roster read, or undefined when the registry could not answer. */
async function readRoster(
  registry: PresetRosterReader,
  timeoutMs: number,
): Promise<readonly PresetRosterRow[] | undefined> {
  try {
    const rows = await withDeadline(Promise.resolve(registry.list()), timeoutMs)
    return Array.isArray(rows) ? rows as readonly PresetRosterRow[] : undefined
  } catch {
    return undefined
  }
}

/**
 * Decide whether the LiangShen preset is declared in this deployment.
 *
 * Call this OFF the plugin's activation path — never awaited from a plugin
 * apply. list() is not a leaf read: it audits every declared preset and, for one
 * whose mounted subtree still has pending rows, awaits the Host loader tree
 * (agent-preset-registry lib/index.js diagnostic). A plugin whose activation
 * awaited this would wait on the loader tree while its OWN activation is among
 * the tasks that tree is waiting for, and neither wait would ever settle. The
 * entry calls this after its synchronous activation returned, which is what
 * keeps this a wait and not a deadlock.
 * @param ctx - the plugin context.
 * @param options - the deadlines and cadence for this run.
 * @returns the verdict, with the reason for the caller's log line.
 */
export async function startLiangShenGate(ctx: Context, options: GateOptions = {}): Promise<GateOutcome> {
  const settled = await settleHostTree(ctx, options)
  const registry = readPresetRegistry(ctx)
  if (registry === undefined) return { allowed: false, reason: 'registry-absent', settled, reads: 0 }
  const readTimeoutMs = options.readTimeoutMs ?? GATE_READ_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? GATE_POLL_INTERVAL_MS
  const waitMs = options.declarationWaitMs ?? GATE_DECLARATION_WAIT_MS

  let reads = 0
  const first = await readRoster(registry, readTimeoutMs)
  reads += 1
  if (first === undefined) return { allowed: false, reason: 'registry-unreadable', settled, reads }
  if (declaresLiangShen(first)) return { allowed: true, reason: 'declared', settled, reads }

  // Not declared yet. Re-read until the declaration appears or the window
  // closes: the declaring plugin publishes it off its activation return, so
  // \"not yet\" and \"not here\" are only distinguishable by waiting. A read
  // that fails mid-window is not the verdict — only a window that never
  // produced a successful answer at all is reported as unreadable.
  const deadline = Date.now() + waitMs
  let answered = false
  while (Date.now() < deadline) {
    await waitFor(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())))
    const rows = await readRoster(registry, readTimeoutMs)
    reads += 1
    if (rows === undefined) continue
    answered = true
    if (declaresLiangShen(rows)) return { allowed: true, reason: 'declared', settled, reads }
  }
  return { allowed: false, reason: answered ? 'not-declared' : 'registry-unreadable', settled, reads }
}
