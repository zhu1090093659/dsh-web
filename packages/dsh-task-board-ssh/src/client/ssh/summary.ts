/**
 * The summary this provider's host half publishes, and the store the browser
 * half renders it from.
 *
 * The host half calls the board capability face's `publish(summary)`; the board
 * carries that document in its snapshot and hands it to every bookmarking
 * client inside the mirror's `extensions` map. It is therefore the browser
 * half's only host-to-client data channel besides the ledger payload on each
 * card — the action channel returns a boolean, not a reply — so everything the
 * seats need that is not a card fact travels here: the host list behind the
 * target form's picker, the provider's defaults, and the byte windows of the
 * log being read.
 *
 * Nothing here is trusted: every field is read defensively and an unknown shape
 * reads as absent, exactly like the GitHub provider's summary reader.
 *
 * @module dsh-task-board-ssh/client/ssh/summary
 */
import { useSyncExternalStore } from 'react'
import { SSH_EXTENSION_ID } from '../../core/action.ts'
import type { SshAgentKind, SshExecutionMode, SshRunPhase, SshWorkspaceKind } from '../../core/target.ts'

/** One host as the provider publishes it: no secret, no ProxyCommand text. */
export interface SshSummaryHost {
  /** Alias every remote operation addresses. */
  alias: string
  /** Hostname or IP. */
  host: string
  /** Login user. */
  user: string
  /** SSH port. */
  port: number
  /** Deployment label, when the host carries one. */
  environment?: string
  /** Free-form note, when the host carries one. */
  description?: string
}

/**
 * One run's log increment.
 *
 * The provider reads the run's remote stdout file by byte offset and publishes
 * what it read since the previous window: `[baseOffset, endOffset)` with the
 * bytes themselves as `text`. A window that starts at zero is a replay from the
 * first byte — the provider publishes one whenever a card's detail is opened —
 * and a window that starts where the previous one ended is the running tail.
 */
export interface SshSummaryLogWindow {
  /** Run these bytes belong to. */
  runId: string
  /** Byte offset of `text`'s first byte in the remote file. */
  baseOffset: number
  /** Byte offset just past `text`'s last byte. */
  endOffset: number
  /** The bytes themselves, verbatim. */
  text: string
  /** Whether the provider skipped bytes before `baseOffset`. */
  truncated?: boolean
}

/** Defaults the provider prefills a new target from. */
export interface SshSummaryDefaults {
  /** Host alias a new target opens with. */
  host?: string
  /** Execution mode. */
  mode?: SshExecutionMode
  /** Agent CLI. */
  agent?: SshAgentKind
  /** Filesystem mechanism. */
  workspace?: SshWorkspaceKind
}

/** The provider's read-only summary; every field is optional on the wire. */
export interface SshSummary {
  /** Whether the host half currently runs its extension. */
  enabled?: boolean
  /** Configured hosts, in `dsh-ssh` store order. */
  hosts?: SshSummaryHost[]
  /** Prefill values for a new target. */
  defaults?: SshSummaryDefaults
  /** Per-host running cap, keyed by host alias. */
  caps?: Record<string, number>
  /** Log increments, keyed by task id. */
  logs?: Record<string, SshSummaryLogWindow>
  /** Phase of the run each log window belongs to, keyed by task id. */
  phases?: Record<string, SshRunPhase>
}

/** Whether a value is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one bounded string field. */
function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read the host list, dropping entries a picker cannot use. */
function decodeHosts(value: unknown): SshSummaryHost[] | undefined {
  if (!Array.isArray(value)) return undefined
  const hosts: SshSummaryHost[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) continue
    const alias = readText(entry.alias)
    const host = readText(entry.host)
    const user = readText(entry.user)
    if (alias === undefined || host === undefined || user === undefined) continue
    const decoded: SshSummaryHost = { alias, host, user, port: typeof entry.port === 'number' ? entry.port : 22 }
    const environment = readText(entry.environment)
    const description = readText(entry.description)
    if (environment !== undefined) decoded.environment = environment
    if (description !== undefined) decoded.description = description
    hosts.push(decoded)
  }
  return hosts
}

/** Read the prefill defaults. */
function decodeDefaults(value: unknown): SshSummaryDefaults | undefined {
  if (!isPlainObject(value)) return undefined
  const defaults: SshSummaryDefaults = {}
  if (typeof value.host === 'string' && value.host !== '') defaults.host = value.host
  if (value.mode === 'direct' || value.mode === 'proxy') defaults.mode = value.mode
  if (value.agent === 'dsh' || value.agent === 'claude' || value.agent === 'codex' || value.agent === 'custom') defaults.agent = value.agent
  if (value.workspace === 'in-place' || value.workspace === 'git') defaults.workspace = value.workspace
  return Object.keys(defaults).length === 0 ? undefined : defaults
}

/** Read the per-host caps, keeping only finite positive numbers. */
function decodeCaps(value: unknown): Record<string, number> | undefined {
  if (!isPlainObject(value)) return undefined
  const caps: Record<string, number> = {}
  for (const [alias, cap] of Object.entries(value)) {
    if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) caps[alias] = Math.floor(cap)
  }
  return Object.keys(caps).length === 0 ? undefined : caps
}

/** Read the log windows, keyed by card id. */
function decodeLogs(value: unknown): Record<string, SshSummaryLogWindow> | undefined {
  if (!isPlainObject(value)) return undefined
  const logs: Record<string, SshSummaryLogWindow> = {}
  for (const [taskId, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) continue
    const runId = readText(entry.runId)
    if (runId === undefined || typeof entry.text !== 'string') continue
    if (typeof entry.baseOffset !== 'number' || typeof entry.endOffset !== 'number') continue
    const window: SshSummaryLogWindow = {
      runId,
      baseOffset: entry.baseOffset,
      endOffset: entry.endOffset,
      text: entry.text,
    }
    if (entry.truncated === true) window.truncated = true
    logs[taskId] = window
  }
  return Object.keys(logs).length === 0 ? undefined : logs
}

/** Read the published phases, keeping only known phases. */
function decodePhases(value: unknown): Record<string, SshRunPhase> | undefined {
  if (!isPlainObject(value)) return undefined
  const phases: Record<string, SshRunPhase> = {}
  for (const [taskId, phase] of Object.entries(value)) {
    if (phase === 'queued' || phase === 'running' || phase === 'succeeded' || phase === 'failed' || phase === 'cancelled' || phase === 'lost') {
      phases[taskId] = phase
    }
  }
  return Object.keys(phases).length === 0 ? undefined : phases
}

/**
 * Normalize whatever the board hands back; a foreign payload reads as absent.
 * @param value - the mirror's entry for this extension.
 * @returns the summary, or undefined when nothing usable is published.
 */
export function decodeSummary(value: unknown): SshSummary | undefined {
  if (!isPlainObject(value)) return undefined
  const summary: SshSummary = {}
  if (typeof value.enabled === 'boolean') summary.enabled = value.enabled
  const hosts = decodeHosts(value.hosts)
  if (hosts !== undefined) summary.hosts = hosts
  const defaults = decodeDefaults(value.defaults)
  if (defaults !== undefined) summary.defaults = defaults
  const caps = decodeCaps(value.caps)
  if (caps !== undefined) summary.caps = caps
  const logs = decodeLogs(value.logs)
  if (logs !== undefined) summary.logs = logs
  const phases = decodePhases(value.phases)
  if (phases !== undefined) summary.phases = phases
  return summary
}

let current: SshSummary | undefined
const listeners = new Set<() => void>()

/** Replace the stored summary; an unchanged value notifies nobody. */
function setSummary(next: SshSummary | undefined): void {
  if (current === next) return
  current = next
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A subscriber must never break the extension's own bookkeeping.
    }
  }
}

/**
 * Read this extension's summary out of the board mirror and store it.
 * @param published - the mirror's `extensions` map.
 */
export function acceptPublishedSummary(published: Readonly<Record<string, unknown>>): void {
  setSummary(decodeSummary(published[SSH_EXTENSION_ID]))
}

/** Drop the summary (the board reports the extension is not running). */
export function clearSummary(): void {
  setSummary(undefined)
}

/** The current summary, or undefined while none is published. */
export function getSummary(): SshSummary | undefined {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Observe the published summary from a React component.
 * @returns the current summary, or undefined while none is published.
 */
export function usePublishedSummary(): SshSummary | undefined {
  return useSyncExternalStore(subscribe, getSummary, getSummary)
}
