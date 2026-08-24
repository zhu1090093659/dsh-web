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

/** One installed user-plugin row served by `/plugin-installer list`. */
export interface InstalledPluginItem {
  id: string
  name: string
  version: string
  source: { kind: 'npm' | 'git'; spec: string }
  installedAt: string
  /** Saved next-start enablement from the managed profile patch row. */
  enabled: boolean
  commit?: string
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

/** One deployment-configured logical product switch. */
export interface PluginControlItem {
  id: string
  name: string
  repository: string
  state: 'enabled' | 'disabled' | 'mixed' | 'unavailable' | 'uninstalled'
}

/** Whether a decoded value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is a string. */
function isString(value: unknown): value is string {
  return typeof value === 'string'
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
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    source: { kind: value.source.kind, spec: value.source.spec },
    installedAt: value.installedAt,
    enabled: value.enabled,
    ...isString(value.commit) ? { commit: value.commit } : {},
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
 * Validate and normalize a plugin-control `list` / `set-enabled` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed control items.
 */
export function parsePluginControlSnapshot(value: unknown): PluginControlItem[] {
  if (!isRecord(value) || !Array.isArray(value.controls)) {
    throw new Error('plugin-manager: response must contain a controls array')
  }
  return value.controls.map((control, index) => {
    if (!isRecord(control) || !isString(control.id) || !isString(control.name)
      || !isString(control.repository)
      || (control.state !== 'enabled' && control.state !== 'disabled'
        && control.state !== 'mixed' && control.state !== 'unavailable'
        && control.state !== 'uninstalled')) {
      throw new Error(`plugin-manager: control row ${String(index)} is invalid`)
    }
    return {
      id: control.id,
      name: control.name,
      repository: control.repository,
      state: control.state,
    }
  })
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
    return row
  })
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
