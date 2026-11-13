/**
 * Fixtures and the fake transport shared by the agents client suites.
 *
 * The page talks to the transport interface only, so a suite injects this fake
 * instead of patching `fetch` or spying on a module: reads and runs are
 * counted on the fake, and every answer is the frozen wire shape.
 */
import type { AgentsTransport } from '../src/client/host-api.ts'
import type { SessionListFace, SquadTeamSnapshot, SquadTeamSource } from '../src/client/team-source.ts'
import type {
  AgentsStateView,
  AgentsWorkspaceOption,
  DescribeRequestBody,
  MemberDefinition,
  MemberDraft,
  RunRecord,
  SquadRunRequestBody,
  TeamDefinition,
  TeamDraft,
} from '../src/protocol.ts'

/** One squad with no members unless overridden. */
export function teamOf(overrides: Partial<TeamDefinition> = {}): TeamDefinition {
  return {
    id: 'team-1',
    name: 'Squad one',
    description: 'Two reviewers and one builder',
    workspaceId: 'workspace-main',
    createdAt: 0,
    updatedAt: 0,
    members: [],
    ...overrides,
  }
}

/** One member with every optional field pinned unless overridden. */
export function memberOf(overrides: Partial<MemberDefinition> = {}): MemberDefinition {
  return {
    id: 'member-1',
    teamId: 'team-1',
    name: 'Reviewer',
    preset: 'standard',
    permission: 'read-only',
    model: 'deepseek/deepseek-v4',
    brief: 'Reviews the diff and names the risky parts before the build runs',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

/** One run of a member. */
export function runOf(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    teamId: 'team-1',
    memberId: 'member-1',
    sessionId: 'session-1',
    createdAt: 0,
    status: 'running',
    ...overrides,
  }
}

/** One whole-squad run, the Lead session a live roster belongs to. */
export function squadRunOf(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'squad-run-1',
    teamId: 'team-1',
    sessionId: 'lead-session-1',
    createdAt: 1_000,
    status: 'running',
    kind: 'squad',
    goal: 'Ship the review notes',
    ...overrides,
  }
}

/**
 * The `subagentCatalog` projection value exactly as the Host publishes it: one
 * row per direct child of the session that owns the catalog.
 * @param members - the direct children, in spawn order.
 * @returns the published value.
 */
export function subagentCatalogOf(
  members: readonly {
    id: string
    label?: string
    name?: string
    mode?: 'one-shot' | 'continuable' | 'external' | 'unknown'
    createdAt?: number
  }[],
): Array<{ id: string; mode: string; createdAt: number; label?: string; name?: string }> {
  return members.map((member, index) => ({
    id: member.id,
    mode: member.mode ?? 'continuable',
    createdAt: member.createdAt ?? 1_700_000_000_000 + index,
    ...(member.label === undefined ? {} : { label: member.label }),
    ...(member.name === undefined ? {} : { name: member.name }),
  }))
}

/** One published state. */
export function stateOf(
  teams: TeamDefinition[],
  runs: RunRecord[] = [],
  presets?: readonly string[],
  workspaces?: readonly AgentsWorkspaceOption[],
): AgentsStateView {
  return {
    teams,
    runs,
    host: { ownerPid: 4242 },
    ...(presets === undefined ? {} : { presets }),
    ...(workspaces === undefined ? {} : { workspaces }),
  }
}

/** The fake's configuration; every hook is optional except the read. */
export interface FakeTransportConfig {
  state: (read: number) => Promise<AgentsStateView>
  run?: (teamId: string, memberId: string) => Promise<RunRecord>
  runSquad?: (request: SquadRunRequestBody) => Promise<RunRecord>
  createTeam?: (draft: TeamDraft) => Promise<TeamDefinition>
  deleteTeam?: (teamId: string) => Promise<void>
  saveMember?: (teamId: string, member: MemberDraft) => Promise<TeamDefinition>
  deleteMember?: (teamId: string, memberId: string) => Promise<TeamDefinition>
  describe?: (request: DescribeRequestBody) => Promise<string>
}

/** The injected fake plus the counters the poll suite reads. */
export interface FakeTransport extends AgentsTransport {
  readonly reads: number
  readonly runs: number
  readonly squadRuns: number
  /** Every squad-run request the page posted, in order. */
  readonly squadRequests: readonly SquadRunRequestBody[]
  /** Every team draft the page saved, in order. */
  readonly teamSaves: readonly TeamDraft[]
  /** Every describe request the page posted, in order. */
  readonly describes: readonly DescribeRequestBody[]
}

/**
 * Build the fake transport the page drives.
 * @param config - answers per contract route.
 */
export function fakeTransport(config: FakeTransportConfig): FakeTransport {
  let reads = 0
  let runs = 0
  let squadRuns = 0
  const squadRequests: SquadRunRequestBody[] = []
  const teamSaves: TeamDraft[] = []
  const describes: DescribeRequestBody[] = []
  const missing = (route: string): never => { throw new Error(route + ' is not configured in this fake') }
  return {
    get reads(): number { return reads },
    get runs(): number { return runs },
    get squadRuns(): number { return squadRuns },
    get squadRequests(): readonly SquadRunRequestBody[] { return squadRequests },
    get teamSaves(): readonly TeamDraft[] { return teamSaves },
    get describes(): readonly DescribeRequestBody[] { return describes },
    async state(_signal?: AbortSignal): Promise<AgentsStateView> {
      reads += 1
      return config.state(reads)
    },
    async run(teamId: string, memberId: string): Promise<RunRecord> {
      runs += 1
      return config.run === undefined ? missing('run') : config.run(teamId, memberId)
    },
    async runSquad(request: SquadRunRequestBody): Promise<RunRecord> {
      squadRuns += 1
      squadRequests.push(request)
      return config.runSquad === undefined ? missing('runSquad') : config.runSquad(request)
    },
    async createTeam(draft: TeamDraft): Promise<TeamDefinition> {
      teamSaves.push(draft)
      return config.createTeam === undefined ? missing('createTeam') : config.createTeam(draft)
    },
    async deleteTeam(teamId: string): Promise<void> {
      return config.deleteTeam === undefined ? missing('deleteTeam') : config.deleteTeam(teamId)
    },
    async saveMember(teamId: string, member: MemberDraft): Promise<TeamDefinition> {
      return config.saveMember === undefined ? missing('saveMember') : config.saveMember(teamId, member)
    },
    async deleteMember(teamId: string, memberId: string): Promise<TeamDefinition> {
      return config.deleteMember === undefined ? missing('deleteMember') : config.deleteMember(teamId, memberId)
    },
    async describe(request: DescribeRequestBody): Promise<string> {
      describes.push(request)
      return config.describe === undefined ? missing('describe') : config.describe(request)
    },
  }
}

/** A live-team source the suite drives itself, so a page test never depends on
 * which surface a deployment happens to expose. */
export interface FakeTeamSource extends SquadTeamSource {
  /** Every Lead session the page asked to follow, in order. */
  readonly watches: readonly string[]
  /** How many subscribers are attached right now. */
  readonly watchers: number
  /** Push a new snapshot to every subscriber, as a live surface would. */
  publish(snapshot: SquadTeamSnapshot): void
}

/**
 * Build the driven live-team source.
 * @param initial - the snapshot a fresh subscriber receives, if any.
 */
export function fakeTeamSource(initial: SquadTeamSnapshot | undefined): FakeTeamSource {
  const watches: string[] = []
  let listeners: Array<(snapshot: SquadTeamSnapshot) => void> = []
  let current = initial
  return {
    kind: 'catalog',
    get watches(): readonly string[] { return watches },
    get watchers(): number { return listeners.length },
    watch(sessionId: string, onChange: (snapshot: SquadTeamSnapshot) => void): () => void {
      watches.push(sessionId)
      if (current !== undefined) onChange(current)
      listeners = [...listeners, onChange]
      return () => { listeners = listeners.filter(candidate => candidate !== onChange) }
    },
    publish(snapshot: SquadTeamSnapshot): void {
      current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
  }
}

/** The shared session catalog's list face, driven from the outside. */
export interface FakeSessionList extends SessionListFace {
  /** Publish one session's projection values, as a Host frame would. */
  set(sessionId: string, values: Readonly<Record<string, unknown>>): void
}

/**
 * Build a fake of the client session catalog: exactly the `projectionsBySession`
 * surface the official UI reads `agentTeam` from.
 * @param initial - projection values by Lead session id.
 */
export function sessionListOf(
  initial: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  byId: Readonly<Record<string, { readonly running?: boolean }>> = {},
): FakeSessionList {
  const bySession: Record<string, { values: Readonly<Record<string, unknown>> }> = {}
  for (const [sessionId, values] of Object.entries(initial)) bySession[sessionId] = { values }
  let listeners: Array<() => void> = []
  return {
    getSnapshot() {
      return { projectionsBySession: bySession, byId }
    },
    subscribe(listener: () => void): () => void {
      listeners = [...listeners, listener]
      return () => { listeners = listeners.filter(candidate => candidate !== listener) }
    },
    set(sessionId: string, values: Readonly<Record<string, unknown>>): void {
      bySession[sessionId] = { values }
      for (const listener of listeners) listener()
    },
  }
}
