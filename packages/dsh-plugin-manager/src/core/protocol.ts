/**
 * Wire parsing for the official plugin-installer / plugin-control RPC
 * channels. This package is a browser-side consumer of those channels: every
 * response is decoded but untrusted, so each parser validates the shape it
 * needs and throws a typed error on mismatch. Callers treat a parse failure
 * as "channel unavailable or drifted" and degrade to command hints.
 *
 * The shapes mirror the official web installer tab's wire protocol (see the
 * DSH checkout's packages/client/ui-settings-plugin-installer/src/client/
 * protocol.ts); they are a contract observation, not an import.
 * @module @linxin666/dsh-client-ui-plugin-manager/core
 */

/** One loader entry row claimed by an installed bundle package (aggregate child). */
export interface InstalledPluginChild {
  /** The loader entry id, e.g. web-ui-pet. */
  id: string
  /** Display name: the real plugin package (shell config.plugin) when known. */
  name: string
  /** Effective next-start enablement of this row alone (bundle default plus user override). */
  enabled: boolean
  /** Rows the manager must never disable (the manager tab itself, the compat face). */
  locked?: boolean
}

/** One installed user-plugin row served by `/plugin-installer list`. */
export interface InstalledPluginItem {
  id: string
  name: string
  version: string
  source: { kind: 'npm' | 'git'; spec: string }
  installedAt: string
  /** Effective next-start enablement across the bundle's own rows and the managed profile patch row. */
  enabled: boolean
  commit?: string
  /**
   * Entry rows this package's bundle patch claims, present when the package
   * is an aggregate claiming more than one row (gateway mode only — the
   * official channel wire has no children). Child enablement is individually
   * switchable; uninstall stays whole-package (the code ships in one npm
   * package).
   */
  children?: InstalledPluginChild[]
}

/**
 * How the host carried out (or refused) a restart request:
 * `relaunch` — this host re-executes itself in place; `shell` — the packaged
 * Desktop shell owns the process tree and runs its own restart; `systemd` —
 * this host runs as a systemd service and asks its own unit to restart it;
 * `manual` — none of these is possible here, the user restarts DSH themselves.
 */
export type RestartMode = 'relaunch' | 'shell' | 'systemd' | 'manual'

/**
 * The unit name shape a systemd restart may name. Deliberately conservative:
 * the host derives the value from its own cgroup and the browser re-validates
 * it before the confirmation names a unit, so a value outside this shape is
 * wire drift rather than a unit worth restarting. The one position that is
 * refused is a leading `-`: this name travels as the last argv element of
 * `systemctl --user restart --no-block <unit>`, where a leading `-` reads as
 * another option instead of a unit. Everything else systemd itself accepts is
 * kept, including a first `_` or `:` (`_x.service` and `:x.service` are
 * valid unit names).
 */
const SYSTEMD_UNIT_RE = /^(?!-)[a-zA-Z0-9:_.@-]+\.service$/

/** Whether a value is a systemd unit name this package asks systemd to restart. */
export function isSystemdUnitName(value: string): boolean {
  return SYSTEMD_UNIT_RE.test(value)
}

/**
 * What the host would do with a restart request, as the plan read answers it.
 *
 * A discriminated union rather than a mode beside an optional unit: a systemd
 * plan always names the unit it restarts (the parser refuses one that does
 * not) and no other mode carries a unit at all, so the confirmation reads the
 * unit off the plan instead of guarding a field that cannot be missing.
 */
export type RestartPlanWire =
  | { mode: 'systemd'; unit: string }
  | { mode: 'relaunch' | 'shell' | 'manual' }

/**
 * The result of one applied update: the installed row, plus the host's verdict
 * on whether this process can serve it without a restart.
 *
 * The two facts are separate because they answer different questions and must
 * not be folded into one: the version landed (the row carries it), and the
 * running host may still not have loaded it. Reporting the second as an error
 * would be wrong twice over — the update did apply, and a batch update stops on
 * the first error it sees — so it travels as an accompanying fact instead.
 */
export interface PluginUpdateResult {
  /** The installed row, at the version the update landed on. */
  plugin: InstalledPluginItem
  /**
   * Bundles whose new version is on disk but which the running host has not
   * loaded, empty when the update took effect in place. The official manager
   * reports this as `application: 'restart-required'` (issue #1905); the
   * official installer channel carries no such fact, so it answers an empty
   * list.
   */
  restartRequired: string[]
}

/**
 * One row of a batch update, as the host reported it.
 *
 * A batch is the host's sequence over the official manager's single-plugin
 * update, so its progress is a row per requested plugin rather than one
 * aggregate verdict: each row carries the version the host resolved, where it
 * ended, and — when it could not be applied — the reason.
 */
export interface PluginUpdateOutcome {
  /** Installed package name this row applies. */
  id: string
  /** Where this row is: still queued, in flight, applied, or refused. */
  phase: 'pending' | 'running' | 'done' | 'error'
  /** The exact version the host resolved for this row; absent when it was refused up front. */
  targetVersion?: string
  /** The version that landed, present on an applied row. */
  landed?: string
  /** Why this row could not be applied, present on a refused row. */
  error?: string
  /**
   * Whether the landed version is on disk but not loaded in the running host
   * (the official manager answered `application: 'restart-required'`).
   */
  restartRequired?: boolean
}

/**
 * What one batch update run produced.
 *
 * Both halves are carried: the refused rows stay in the panel beside the version
 * they are stuck on, and the applied rows leave it. Reporting only one half would
 * make a partial run read as either a clean one or no run at all.
 */
export interface PluginBatchUpdateResult {
  /** Rows that landed, at the version that landed. */
  applied: PluginUpdateOutcome[]
  /** Rows that did not, each carrying the host's reason. */
  failed: PluginUpdateOutcome[]
}

/** Point-in-time install/update progress reported by the host. */
export interface InstallProgressItem {
  kind: 'idle' | 'install' | 'update'
  stage: 'fetch' | 'download' | 'extract' | 'write'
  percent?: number
}

/** Whether an update row is a normal same-name update or a legacy package migration. */
export type PluginUpdateKind = 'update' | 'migrate'

/** One plugin with a newer version available. */
export interface PluginUpdateItem {
  id: string
  current: string
  latest: string
  /** Normal same-name update or legacy aggregate migration. Defaults to update. */
  kind?: PluginUpdateKind
  /** Target package name when kind is migrate. */
  target?: string
  /** Exact target package version when kind is migrate. */
  targetVersion?: string
  /** Declared DSH minimum the update needs (package manifest's `dsh.engines.dsh`). */
  requiresDsh?: string
  /** Whether the running DSH host satisfies requiresDsh; absent when unknown. */
  compatible?: boolean
  /**
   * The running DSH version the verdict was made from, present only when the
   * host compared it and found it below the declaration. Its absence is what
   * separates "this host is too old" from "we could not verify" — a host that
   * could not be read, or a declaration that could not be parsed; different
   * problems, with different copy (issues #1819 and #1899).
   */
  hostVersion?: string
}

/** One recorded plugin boot failure served by the host. */
export interface PluginFailureItem {
  /** Installed plugin id (package name); empty for unattributable failures. */
  pluginId: string
  kind: 'load-failure' | 'hang' | 'late-rejection'
  message: string
  stack: string
  installPath: string
  at: string
}

/** Recovery facts served by the host: the failure ring, the plugin root, and safe mode. */
export interface PluginFailuresSnapshot {
  items: PluginFailureItem[]
  /** Absolute plugin install root — the repair conversation's workspace. */
  pluginRoot: string
  /** Whether the host is running in safe mode (user plugins skipped). */
  safeMode: boolean
}

/** Whether a decoded value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is a string. */
function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Validate one aggregate child row. */
function parsePluginChild(value: unknown, rowIndex: number, childIndex: number): InstalledPluginChild {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name) || typeof value.enabled !== 'boolean') {
    throw new Error(`plugin-manager: plugin row ${String(rowIndex)} child ${String(childIndex)} is invalid`)
  }
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    ...typeof value.locked === 'boolean' ? { locked: value.locked } : {},
  }
}

/** Validate one installed-plugin row. */
function parsePlugin(value: unknown, index: number): InstalledPluginItem {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)
    || !isString(value.version) || !isString(value.installedAt)
    || typeof value.enabled !== 'boolean'
    || !isRecord(value.source) || (value.source.kind !== 'npm' && value.source.kind !== 'git')
    || !isString(value.source.spec)) {
    throw new Error(`plugin-manager: plugin row ${String(index)} is invalid`)
  }
  if (value.children !== undefined && !Array.isArray(value.children)) {
    throw new Error(`plugin-manager: plugin row ${String(index)} children is invalid`)
  }
  const children = (value.children as unknown[] | undefined)?.map((child, childIndex) => parsePluginChild(child, index, childIndex))
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    source: { kind: value.source.kind, spec: value.source.spec },
    installedAt: value.installedAt,
    enabled: value.enabled,
    ...isString(value.commit) ? { commit: value.commit } : {},
    ...children !== undefined ? { children } : {},
  }
}

/**
 * Validate and normalize a `list` / `uninstall` response value.
 * @param value - decoded but untrusted response value.
 * @returns typed installed-plugin rows.
 */
export function parsePluginList(value: unknown): InstalledPluginItem[] {
  if (!isRecord(value) || !Array.isArray(value.plugins)) {
    throw new Error('plugin-manager: response must contain a plugins array')
  }
  return value.plugins.map((plugin, index) => parsePlugin(plugin, index))
}

/**
 * Validate and normalize an `install` / `update` / `set-enabled` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed installed-plugin row.
 */
export function parseInstalledPlugin(value: unknown): InstalledPluginItem {
  if (!isRecord(value) || value.plugin === undefined) {
    throw new Error('plugin-manager: response must contain a plugin row')
  }
  return parsePlugin(value.plugin, 0)
}

/**
 * Read the restart-required list off one gateway job (or off anything else
 * carrying it).
 *
 * Deliberately tolerant where the other parsers in this module throw: this list
 * is a hint attached to an update that already landed, so an unreadable value
 * must cost the user the hint only. Throwing would reject an applied update and
 * stop a batch run — the exact outcome the fact exists to avoid.
 * @param value - decoded but untrusted job value.
 * @returns the bundle names, empty when the value is absent or unusable.
 */
export function parseRestartRequired(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item !== '') names.push(item)
  }
  return names
}

/**
 * Validate and normalize a `status` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed progress state.
 */
export function parseInstallStatus(value: unknown): InstallProgressItem {
  if (!isRecord(value) || !isRecord(value.progress)
    || (value.progress.kind !== 'idle' && value.progress.kind !== 'install' && value.progress.kind !== 'update')
    || (value.progress.stage !== 'fetch' && value.progress.stage !== 'download'
      && value.progress.stage !== 'extract' && value.progress.stage !== 'write')
    || (value.progress.percent !== undefined
      && (typeof value.progress.percent !== 'number' || !Number.isFinite(value.progress.percent)))) {
    throw new Error('plugin-manager: response must contain a valid progress state')
  }
  return {
    kind: value.progress.kind,
    stage: value.progress.stage,
    ...typeof value.progress.percent === 'number' ? { percent: value.progress.percent } : {},
  }
}

/**
 * Validate and normalize a `check-updates` response value.
 * @param value - decoded but untrusted response value.
 * @returns typed update rows.
 */
export function parseUpdateList(value: unknown): PluginUpdateItem[] {
  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw new Error('plugin-manager: response must contain an updates array')
  }
  return value.updates.map((update, index) => {
    if (!isRecord(update) || !isString(update.id) || !isString(update.current) || !isString(update.latest)) {
      throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
    }
    const kind = update.kind === undefined ? 'update' : update.kind
    if (kind !== 'update' && kind !== 'migrate') {
      throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
    }
    const row: PluginUpdateItem = { id: update.id, current: update.current, latest: update.latest }
    if (kind === 'migrate') {
      if (!isString(update.target) || !isString(update.targetVersion)) {
        throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
      }
      row.kind = 'migrate'
      row.target = update.target
      row.targetVersion = update.targetVersion
    }
    if (update.requiresDsh !== undefined) {
      if (!isString(update.requiresDsh)) {
        throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
      }
      row.requiresDsh = update.requiresDsh
    }
    if (update.compatible !== undefined) {
      if (typeof update.compatible !== 'boolean') {
        throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
      }
      row.compatible = update.compatible
    }
    if (update.hostVersion !== undefined) {
      if (!isString(update.hostVersion)) {
        throw new Error(`plugin-manager: update row ${String(index)} is invalid`)
      }
      row.hostVersion = update.hostVersion
    }
    return row
  })
}

/**
 * Validate and normalize the rows of a batch update, as a gateway job carries
 * them under `results`.
 *
 * Deliberately tolerant in the same way {@link parseRestartRequired} is: every
 * row is an outcome the panel has to render, and refusing the whole list over one
 * malformed row would hide the rows that did land. A row missing its id or phase
 * is that row's problem, so it is dropped rather than thrown; an unreadable
 * `results` value reads as "no rows", which the caller shows as a run without a
 * per-row verdict.
 * @param value - decoded but untrusted job value.
 * @returns the typed rows, in the order the host applied them.
 */
export function parseUpdateOutcomes(value: unknown): PluginUpdateOutcome[] {
  if (!Array.isArray(value)) return []
  const rows: PluginUpdateOutcome[] = []
  for (const item of value) {
    if (!isRecord(item) || !isString(item.id) || item.id === '') continue
    const phase = item.phase
    if (phase !== 'pending' && phase !== 'running' && phase !== 'done' && phase !== 'error') continue
    const row: PluginUpdateOutcome = { id: item.id, phase }
    if (isString(item.targetVersion) && item.targetVersion !== '') row.targetVersion = item.targetVersion
    if (isString(item.landed) && item.landed !== '') row.landed = item.landed
    if (isString(item.error) && item.error !== '') row.error = item.error
    if (item.restartRequired === true) row.restartRequired = true
    rows.push(row)
  }
  return rows
}

/**
 * Split a finished batch's rows by outcome, the shape the toolbar renders.
 * A row still in flight is neither: it is simply not in either half.
 * @param rows - the rows the host reported.
 * @returns the applied and failed rows.
 */
export function batchUpdateResult(rows: readonly PluginUpdateOutcome[]): PluginBatchUpdateResult {
  const applied: PluginUpdateOutcome[] = []
  const failed: PluginUpdateOutcome[] = []
  for (const row of rows) {
    if (row.phase === 'done') applied.push(row)
    else if (row.phase === 'error') failed.push(row)
  }
  return { applied, failed }
}

/**
 * Validate and normalize a `restart` response value, reading the mode a POST
 * answer carries.
 * @param value - decoded but untrusted response value.
 * @returns the mode the host actually used.
 */
export function parseRestartMode(value: unknown): RestartMode {
  const restart = isRecord(value) ? value.restart : undefined
  const mode = isRecord(restart) ? restart.mode : undefined
  if (mode !== 'relaunch' && mode !== 'shell' && mode !== 'systemd' && mode !== 'manual') {
    throw new Error('plugin-manager: response must contain a restart mode')
  }
  return mode
}

/**
 * Validate and normalize a restart PLAN response value (the GET answer).
 *
 * The plan is read before the confirmation is shown, so this parser fails
 * closed: an unknown mode, or a systemd plan that does not name a unit of the
 * accepted shape, throws instead of letting the panel promise a restart the
 * host cannot actually perform.
 * @param value - decoded but untrusted response value.
 * @returns the plan the host would carry out.
 */
export function parseRestartPlan(value: unknown): RestartPlanWire {
  const mode = parseRestartMode(value)
  if (mode !== 'systemd') return { mode }
  const restart = isRecord(value) ? value.restart : undefined
  const unit = isRecord(restart) ? restart.unit : undefined
  if (!isString(unit) || !isSystemdUnitName(unit)) {
    throw new Error('plugin-manager: response must name the systemd unit a systemd restart uses')
  }
  return { mode, unit }
}

/**
 * Validate and normalize a `failures` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed failures snapshot.
 */
export function parseFailuresSnapshot(value: unknown): PluginFailuresSnapshot {
  if (!isRecord(value) || !Array.isArray(value.items)
    || !isString(value.pluginRoot) || typeof value.safeMode !== 'boolean') {
    throw new Error('plugin-manager: response must contain a failures snapshot')
  }
  return {
    items: value.items.map((item, index) => {
      if (!isRecord(item) || !isString(item.pluginId)
        || (item.kind !== 'load-failure' && item.kind !== 'hang' && item.kind !== 'late-rejection')
        || !isString(item.message) || !isString(item.stack)
        || !isString(item.installPath) || !isString(item.at)) {
        throw new Error(`plugin-manager: failure row ${String(index)} is invalid`)
      }
      return {
        pluginId: item.pluginId,
        kind: item.kind,
        message: item.message,
        stack: item.stack,
        installPath: item.installPath,
        at: item.at,
      }
    }),
    pluginRoot: value.pluginRoot,
    safeMode: value.safeMode,
  }
}
