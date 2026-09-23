/**
 * Lever controller: the business face behind the homepage lever.
 *
 * The view stays pure; every fact and verb comes from here. The roster arrives
 * over the agent-preset Remote namespace (the same one the official surfaces
 * read), the main-view session comes from the catalog's ownership marker, and the
 * switch goes through `agentPresets.select`, which the host accepts only while
 * the session is still blank.
 *
 * Nothing is cached across reloads except in memory: the lever reads the
 * session's `agentPreset` projection, so a page reload still shows the true
 * state, while `previous` (the preset a push-up restores) is remembered for
 * the length of the page visit and otherwise falls back to the deployment
 * default.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { mainViewSessionId } from './main-session.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LIANGSHEN_PRESET_ID, isActionable, leverState, restoreTarget, type LeverFacts, type LeverState } from '../core/lever.ts'
import type { LiangShenKey } from './locales.ts'

/**
 * Why the last switch was refused, mapped from the Remote failure code so the
 * view can render localized copy instead of a host message.
 */
export type LeverError =
  /** The session already started; its composition is fixed. */
  | { kind: 'locked' }
  /** The deployment supplies no such preset. */
  | { kind: 'missing' }
  /**
   * The switch outlived its ceiling. A Remote answer can be lost on the way
   * back even though the host committed the change, so the lever must stop
   * claiming to be busy and let the next session read report the truth.
   */
  | { kind: 'timeout' }
  /** Anything else, carrying the host's own reason. */
  | { kind: 'failed'; reason: string }

/** How long one preset switch may stay in flight before it is reported as timed out. */
export const SELECT_TIMEOUT_MS = 10_000

/**
 * Settings entry ids whose writes can move the roster this lever reads: the
 * agent-preset registry's own entry (its default and selection policy) and this
 * plugin's row under either install shape — the aggregate's generated row id
 * and the standalone row id — because disabling the plugin unregisters the
 * preset it declares.
 */
export const ROSTER_SETTINGS_ENTRY_IDS: readonly string[] = ['agent-preset-registry', 'web-ui-liangshen', 'liangshen']

/** What the lever view renders. */
export interface LeverSnapshot {
  /** Resolved lever state. */
  state: LeverState
  /** Display name of the preset a push-up restores; empty when there is none. */
  restoreLabel: string
  /** A switch is in flight. */
  busy: boolean
  /** The last refusal, cleared by the next attempt. */
  error?: LeverError
  /** Increments when a pull-down landed, so the view replays the burst once. */
  burst: number
}

/**
 * The two agent-preset Remote calls this plugin makes. Spelled locally: the
 * generated namespace merge belongs to the SDK's own client packages, and this
 * browser bundle only needs the two members it calls.
 */
export interface AgentPresetRemote {
  list(): Promise<RemoteResult<AgentPresetRoster>>
  select(sessionId: string, agentPreset: string): Promise<RemoteResult<string>>
}

/** The injected face the lever view consumes. */
export interface LeverFace {
  /** The snapshot store the view subscribes to. */
  store: SnapshotStore<LeverSnapshot>
  /** Pull the lever down: turn LiangShen mode on. */
  pull: () => void
  /** Push the lever up: restore the previous preset. */
  push: () => void
  /** Translate one lever key. */
  t: (key: LiangShenKey, vars?: Record<string, string | number>) => string
}

/** Read the preset a session summary reports, when it reports one. */
function presetOf(session: { projectionValues?: Record<string, unknown> } | undefined): string | undefined {
  const value = session?.projectionValues?.['agentPreset']
  return typeof value === 'string' ? value : undefined
}

/** The lever controller: roster read, session facts, and the preset switch. */
export class LeverController {
  private readonly store: SnapshotStore<LeverSnapshot>

  /**
   * The browser services this controller reads, resolved defensively: the
   * context proxy throws on any service the fiber did not inject, so a
   * deployment that cannot answer one of them must leave the lever inert
   * rather than take the plugin (and the composer row) down with it.
   */
  private readonly sessions: ISessions | undefined

  private readonly remote: AgentPresetRemote | undefined

  /** Roster rows as last read; empty until the first read lands. */
  private rows: AgentPresetRoster['presets'] = []

  /** The preset the user was on before the last pull-down. */
  private previous: string | undefined

  private loading = false

  /** Ceiling on one in-flight switch, so a lost Remote answer cannot hang the row. */
  private readonly selectTimeoutMs: number

  private readonly disposers: (() => void)[] = []

  constructor(private readonly ctx: ClientContext, options: LeverControllerOptions = {}) {
    this.selectTimeoutMs = options.selectTimeoutMs ?? SELECT_TIMEOUT_MS
    this.sessions = readService<ISessions>(() => (ctx as unknown as { sessions: ISessions }).sessions)
    this.remote = readService<AgentPresetRemote>(
      () => (ctx as unknown as { remote: { agentPresets: AgentPresetRemote } }).remote.agentPresets,
    )
    this.store = createSnapshotStore<LeverSnapshot>({
      state: 'off',
      restoreLabel: '',
      busy: false,
      burst: 0,
    })
  }

  /** The snapshot store the view subscribes to. */
  snapshot(): SnapshotStore<LeverSnapshot> {
    return this.store
  }

  /** Follow the roster and the current session, then read the roster once. */
  start(): void {
    const list = this.sessions?.list
    if (list !== undefined) {
      this.disposers.push(list.subscribe(() => { this.refresh() }))
    }
    const remote = readService<{ $on?: (event: string, listener: (ns: string) => void) => () => void }>(
      () => (this.ctx as unknown as { remote: { $on: (event: string, listener: (ns: string) => void) => () => void } }).remote,
    )
    if (typeof remote?.$on === 'function') {
      this.disposers.push(remote.$on('settings/document-updated', (ns: string) => {
        if (ROSTER_SETTINGS_ENTRY_IDS.includes(ns)) void this.load()
      }))
    }
    this.refresh()
    if (this.remote !== undefined) void this.load()
  }

  /** Release every subscription. Idempotent. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  /** The inject face handed to the slot entry. */
  face(): LeverFace {
    return {
      store: this.store,
      pull: () => { void this.toggle('down') },
      push: () => { void this.toggle('up') },
      t: (key, vars) => {
        const translate = readService<(key: LiangShenKey, vars?: Record<string, string | number>) => string>(
          () => this.ctx.locale.bind('liangshen'),
        )
        return translate === undefined ? key : translate(key, vars)
      },
    }
  }

  /** Read the roster; a refusal leaves the lever as it was. */
  async load(): Promise<void> {
    if (this.loading) return
    const remote = this.remote
    if (remote === undefined) return
    this.loading = true
    try {
      const result = await remote.list()
      if (result.ok) this.rows = result.value.presets
    } catch {
      // A carrier failure leaves the roster empty; the view reports `missing`.
    } finally {
      this.loading = false
      this.refresh()
    }
  }

  /**
   * Recompute the snapshot from the current session and the last roster read.
   * Only the derived fields are written: an in-flight switch, the last refusal,
   * and the burst counter belong to the gesture, not to a session refresh.
   */
  refresh(): void {
    const facts = this.facts()
    const snapshot = this.store.getSnapshot()
    const state = leverState(facts)
    const target = restoreTarget(facts)
    const restoreLabel = target === undefined ? '' : this.labelOf(target)
    if (snapshot.state === state && snapshot.restoreLabel === restoreLabel) return
    this.store.set({ ...snapshot, state, restoreLabel })
  }

  /** The verb behind one gesture direction. */
  private async toggle(direction: 'down' | 'up'): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (snapshot.busy) return
    const remote = this.remote
    if (remote === undefined) return
    const facts = this.facts()
    if (!isActionable(leverState(facts))) return
    const target = direction === 'down' ? LIANGSHEN_PRESET_ID : restoreTarget(facts)
    const sessionId = this.currentSessionId()
    if (target === undefined || sessionId === undefined) return
    if (facts.agentPreset === target) {
      // Already there: a gesture on the current state is a no-op, not a switch.
      this.refresh()
      return
    }
    this.store.set({ ...snapshot, busy: true, error: undefined })
    let result: RemoteResult<string>
    try {
      result = await withTimeout(remote.select(sessionId, target), this.selectTimeoutMs)
    } catch (error) {
      // A timeout is its own copy: the host may well have committed the change
      // even though its answer never arrived, so this reports the wait, and the
      // next session read (or the next gesture) shows what actually happened.
      const mapped: LeverError = error instanceof SwitchTimeout
        ? { kind: 'timeout' }
        : { kind: 'failed', reason: message(error) }
      this.store.set({ ...this.store.getSnapshot(), busy: false, error: mapped })
      this.refresh()
      return
    }
    if (!result.ok) {
      this.store.set({ ...this.store.getSnapshot(), busy: false, error: refusal(result.error) })
      this.refresh()
      return
    }
    // The switch landed: remember where to return, then celebrate only the
    // pull that turned the mode on.
    if (direction === 'down') {
      const prev = facts.agentPreset ?? this.detectPreset()
      if (prev !== undefined && prev !== LIANGSHEN_PRESET_ID) {
        this.rememberPrevious(prev)
      }
    }
    const next = this.store.getSnapshot()
    this.store.set({ ...next, busy: false, error: undefined, burst: direction === 'down' ? next.burst + 1 : next.burst })
    this.refresh()
  }

  /**
   * Try to detect the active preset from the DOM hero chip or storage
   * when session.projectionValues.agentPreset is absent.
   */
  private detectPreset(): string | undefined {
    try {
      if (typeof document !== 'undefined') {
        const chip = document.querySelector<HTMLElement>('button[aria-haspopup="menu"] span[class*="seatLabel"]')
          ?? Array.from(document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"] span')).find(s => s.className.includes('seatLabel'))
        const text = chip?.textContent?.trim()
        if (text) {
          const matched = this.rows.find(row => (row.name === text || row.id === text) && row.id !== LIANGSHEN_PRESET_ID)
          if (matched) return matched.id
        }
      }
    } catch {
      // Defensive
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem('dsh-liangshen:previous-preset')
        if (stored && stored !== LIANGSHEN_PRESET_ID && this.rows.some(r => r.id === stored)) {
          return stored
        }
      }
    } catch {
      // Defensive
    }

    return undefined
  }

  private rememberPrevious(presetId: string | undefined): void {
    if (presetId === undefined || presetId === LIANGSHEN_PRESET_ID) return
    this.previous = presetId
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('dsh-liangshen:previous-preset', presetId)
      }
    } catch {
      // Defensive
    }
  }

  /** The facts one decision reads, from the live session and the roster. */
  private facts(): LeverFacts {
    const summary = this.currentSession()
    const available = this.rows.filter(row => row.broken === undefined).map(row => row.id)
    const fallback = this.rows.find(row => row.isDefault)?.id
    const currentPreset = presetOf(summary)

    if (currentPreset !== undefined && currentPreset !== LIANGSHEN_PRESET_ID) {
      this.rememberPrevious(currentPreset)
    }

    const previous = this.previous ?? this.detectPreset()

    return {
      blank: summary?.blank === true,
      agentPreset: currentPreset,
      available,
      fallback,
      previous,
    }
  }

  private currentSessionId(): string | undefined {
    return mainViewSessionId(this.sessions?.list.getSnapshot().byId)
  }

  private currentSession(): { blank?: boolean, projectionValues?: Record<string, unknown> } | undefined {
    const state = this.sessions?.list.getSnapshot()
    const current = mainViewSessionId(state?.byId)
    if (state === undefined || current === undefined) return undefined
    return state.byId[current] as unknown as { blank?: boolean, projectionValues?: Record<string, unknown> } | undefined
  }

  /** Display name of one preset id, falling back to the id itself. */
  private labelOf(id: string): string {
    const row = this.rows.find(candidate => candidate.id === id)
    return row?.name ?? id
  }
}

/** The face constructor options; tests narrow the switch ceiling. */
export interface LeverControllerOptions {
  /** Override {@link SELECT_TIMEOUT_MS}. */
  selectTimeoutMs?: number
}

/** Raised when one switch outlives {@link SELECT_TIMEOUT_MS}. */
class SwitchTimeout extends Error {
  constructor() {
    super('the preset switch did not answer in time')
    this.name = 'SwitchTimeout'
  }
}

/** Resolve with `work`, or reject with a {@link SwitchTimeout} after `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new SwitchTimeout()) }, ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/**
 * Read one context service, treating the proxy's "without inject" refusal (and
 * any other resolution fault) as the service being absent.
 */
function readService<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

/** The host's own reason for a refusal, mapped to lever copy. */
function refusal(error: { code?: string, message?: string, details?: unknown }): LeverError {
  if (error.code === 'agent-preset/locked') return { kind: 'locked' }
  if (error.code === 'agent-preset/not-found') return { kind: 'missing' }
  const details = error.details
  if (typeof details === 'object' && details !== null && typeof (details as { reason?: unknown }).reason === 'string') {
    return { kind: 'failed', reason: (details as { reason: string }).reason }
  }
  return { kind: 'failed', reason: error.message ?? error.code ?? 'unknown' }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
