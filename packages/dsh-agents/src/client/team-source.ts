/**
 * Where the squad page reads the live team of one whole-squad run.
 *
 * The source is the Host's own: `@deepseek-ai/dsh-subagent` publishes the
 * `subagentCatalog` projection on the parent Session, and the shared client
 * session catalog carries it under
 * `projectionsBySession[leadSessionId].values.subagentCatalog`. Reading it costs
 * no request and no poll.
 *
 * The `agentTeam` projection is NOT a member source: since 0.2.2-rc.2 it carries
 * the task board and the saved Team mode only (`{ enabled, tasks, failure? }`,
 * stateVersion 7) and its wire schema is strict, so a member row is not something
 * it can ever publish again.
 *
 * @module @linxin666/dsh-agents/client
 */
/** One live child session of the Lead, as the Host's catalog reports it. */
export interface SquadTeammateRow {
  /** Session id of the teammate session. */
  id: string
  /** The `description` the Lead passed to the subagent tool: the member name when the roster was followed. */
  label?: string
  /** Agent name the Host minted, when it reports one. */
  name?: string
  /** How this child was started; the catalog's own vocabulary. */
  mode: 'one-shot' | 'continuable' | 'external' | 'unknown'
  /** Creation instant of the child session. */
  createdAt: number
  /** Whether the Host reports this session as running; undefined when the store says nothing about it. */
  running?: boolean
}

/** What the page knows about the live team of one squad run. */
export type SquadTeamSnapshot =
  /** No catalog surface answers in this deployment: say so instead of polling forever. */
  | { state: 'unavailable' }
  /** The surface is reachable but reports no teammate yet (the Lead has not spawned one). */
  | { state: 'pending'; leadRunning?: boolean }
  /** The Lead session and the children it has started so far. */
  | { state: 'ready'; leadSessionId: string; rows: readonly SquadTeammateRow[]; leadRunning?: boolean }

/** One place the page can read the live team from. */
export interface SquadTeamSource {
  /** Which surface this source is: the Host's published subagent catalog. */
  readonly kind: 'catalog'
  /**
   * Follow one Lead session.
   * @param sessionId - the Lead session id of the newest squad run.
   * @param onChange - receives the current snapshot now and after every change.
   * @returns the unsubscribe function.
   */
  watch(sessionId: string, onChange: (snapshot: SquadTeamSnapshot) => void): () => void
}

/** The slice of the client session catalog this adapter reads. */
export interface SessionListFace {
  getSnapshot(): {
    readonly projectionsBySession?: Readonly<Record<string, SessionProjectionFace | undefined>>
    /** Session summaries by id; the running flag is what the Host publishes about activity. */
    readonly byId?: Readonly<Record<string, { readonly running?: boolean } | undefined>>
  }
  subscribe(listener: () => void): () => void
}

/** One session's projection row: the whole values map the host published. */
export interface SessionProjectionFace {
  readonly values: Readonly<Record<string, unknown>>
}

/** The projection key the Host's subagent runtime publishes direct children under. */
export const SUBAGENT_CATALOG_PROJECTION_KEY = 'subagentCatalog'

/** Modes the catalog can report, kept as a closed set so an unknown mode is skipped rather than rendered. */
const CATALOG_MODES = ['one-shot', 'continuable', 'external', 'unknown'] as const

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function modeOf(value: unknown): SquadTeammateRow['mode'] | undefined {
  return typeof value === 'string' && (CATALOG_MODES as readonly string[]).includes(value)
    ? value as SquadTeammateRow['mode']
    : undefined
}

/**
 * Read one published `subagentCatalog` value.
 *
 * A row this build cannot read is skipped: the catalog is another plugin's wire,
 * so one malformed entry must not blank the whole roster.
 * @param value - whatever the projection key carried.
 * @returns the parsed rows, or undefined when the value is not a catalog at all.
 */
export function readCatalogValue(value: unknown): SquadTeammateRow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: SquadTeammateRow[] = []
  for (const candidate of value as unknown[]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as Record<string, unknown>
    const id = text(entry.id)
    const mode = modeOf(entry.mode)
    const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : undefined
    if (id === undefined || mode === undefined || createdAt === undefined) continue
    const label = text(entry.label)
    const name = text(entry.name)
    rows.push({
      id,
      mode,
      createdAt,
      ...(label === undefined ? {} : { label }),
      ...(name === undefined ? {} : { name }),
    })
  }
  return rows
}

/**
 * Read the Host's running flag for one session, when the store reports it.
 * @param list - the session catalog.
 * @param sessionId - the session to look up.
 * @returns the flag, or undefined when the store says nothing about that session.
 */
function summaryOf(list: SessionListFace, sessionId: string): boolean | undefined {
  try {
    const running = list.getSnapshot().byId?.[sessionId]?.running
    return typeof running === 'boolean' ? running : undefined
  } catch {
    return undefined
  }
}

/** Attach the Host's running flag to one row, when the store reports it. */
function withActivity(list: SessionListFace, rows: readonly SquadTeammateRow[]): SquadTeammateRow[] {
  let summaries: Readonly<Record<string, { readonly running?: boolean } | undefined>> | undefined
  try {
    summaries = list.getSnapshot().byId
  } catch {
    summaries = undefined
  }
  if (summaries === undefined || summaries === null) return [...rows]
  return rows.map(row => {
    const running = summaries?.[row.id]?.running
    return typeof running === 'boolean' ? { ...row, running } : row
  })
}

/** The raw `subagentCatalog` value of one session, or undefined while it carries none. */
function catalogValue(list: SessionListFace, sessionId: string): unknown {
  const rows = list.getSnapshot().projectionsBySession
  if (rows === undefined || rows === null) return undefined
  const row = rows[sessionId]
  if (row === undefined || row === null) return undefined
  const values = row.values
  if (values === undefined || values === null) return undefined
  return values[SUBAGENT_CATALOG_PROJECTION_KEY]
}

/**
 * Build the snapshot for one published catalog value.
 * @param list - the session catalog, read again for activity.
 * @param sessionId - the Lead session the catalog belongs to.
 * @param value - the published catalog value.
 * @returns the snapshot the page renders.
 */
function snapshotOf(list: SessionListFace, sessionId: string, value: unknown): SquadTeamSnapshot {
  // No published catalog yet (or an empty one) is the Lead before it starts
  // anyone: a blank roster would read as "this squad has no members".
  if (value === undefined) return { state: 'pending' }
  const rows = readCatalogValue(value)
  // A value this build cannot read is reported as no capability rather than as a
  // broken roster: the page then says live state is unavailable, which is the
  // honest reading of "the deployment and this build disagree about the shape".
  if (rows === undefined) return { state: 'unavailable' }
  const leadRunning = summaryOf(list, sessionId)
  if (rows.length === 0) return { state: 'pending', ...(leadRunning === undefined ? {} : { leadRunning }) }
  return { state: 'ready', leadSessionId: sessionId, rows: withActivity(list, rows), ...(leadRunning === undefined ? {} : { leadRunning }) }
}

/** A source that answers "this deployment has no session catalog" once. */
export function unavailableTeamSource(): SquadTeamSource {
  return {
    kind: 'catalog',
    watch(_sessionId: string, onChange: (snapshot: SquadTeamSnapshot) => void): () => void {
      onChange({ state: 'unavailable' })
      return () => {}
    },
  }
}

/**
 * Read the live team from the shared session store.
 * @param list - the client session catalog's list face.
 * @returns the source the page watches.
 */
export function catalogTeamSource(list: SessionListFace): SquadTeamSource {
  return {
    kind: 'catalog',
    watch(sessionId: string, onChange: (snapshot: SquadTeamSnapshot) => void): () => void {
      /** Read the current value; a catalog that throws is a surface this build cannot read. */
      const read = (): { readable: boolean; value: unknown } => {
        try {
          return { readable: true, value: catalogValue(list, sessionId) }
        } catch {
          return { readable: false, value: undefined }
        }
      }
      const initial = read()
      if (!initial.readable) {
        onChange({ state: 'unavailable' })
        return () => {}
      }
      let raw: unknown = initial.value
      onChange(snapshotOf(list, sessionId, raw))
      /** The store keeps one reference per published value, so an unchanged value is a no-op. */
      function publish(): void {
        const next = read()
        if (!next.readable || next.value === raw) return
        raw = next.value
        onChange(snapshotOf(list, sessionId, raw))
      }
      let stop: () => void
      try {
        stop = list.subscribe(publish)
      } catch {
        return () => {}
      }
      return () => { stop() }
    },
  }
}

/**
 * Pick the live-team surface for this deployment.
 * @param list - the shared session catalog face, when this context serves one.
 * @returns the catalog source when the session store is reachable, else a source that says so.
 */
export function createTeamSource(list: SessionListFace | undefined): SquadTeamSource {
  return list === undefined ? unavailableTeamSource() : catalogTeamSource(list)
}

/**
 * Read the session catalog face off whatever this deployment exposes.
 * @param sessions - the client `sessions` service, when the context carries one.
 * @returns the list face, or undefined when the service or its shape is absent.
 */
export function sessionListFace(sessions: unknown): SessionListFace | undefined {
  if (typeof sessions !== 'object' || sessions === null) return undefined
  const list = (sessions as { list?: unknown }).list
  if (typeof list !== 'object' || list === null) return undefined
  const candidate = list as { getSnapshot?: unknown; subscribe?: unknown }
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return candidate as SessionListFace
}
