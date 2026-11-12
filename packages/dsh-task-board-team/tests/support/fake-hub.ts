/**
 * An in-process team hub written against team-hub/PROTOCOL.md.
 *
 * It is a contract-conforming fake rather than a stub: the REST surface answers
 * the same paths, bodies, status codes and error codes the specification fixes
 * (sections 5, 6, 7, 9), including the state gate of section 5 — a claim on a
 * `todo` or `failed` issue is refused with 422, a reconnect that presents a
 * mismatched lease with 409, and a fresh claim always mints its own attempt id —
 * and the WebSocket channel delivers the event frames of section 9 with monotone
 * sequence numbers. The event payloads are built from the frozen catalogue in
 * `team-hub/contract/ws-events.json`, so a test cannot push an event or a payload
 * shape the hub does not send. Nothing here reaches the network: the transport is
 * the injected fetch seam and the injected socket factory, which is what lets a
 * test drive the hub's timing without a server.
 *
 * @module dsh-task-board-team/tests/support/fake-hub
 */
import {
  compareRequest,
  compareResponse,
  loadContractSamples,
  loadEventCatalogue,
  sampleForCall,
  type ContractSample,
  type ContractSet,
  type EventSample,
} from './contract.ts'
import type { HubFetch, HubResponse } from '../../src/host/hub-client.ts'
import type { SocketHandlers, SocketLike } from '../../src/host/channel.ts'
import type { BoundAgent } from '../../src/host/bindings.ts'

/** One issue as the fake keeps it. */
interface FakeIssue {
  id: string
  issueNumber: number
  title: string
  description: string
  status: 'todo' | 'assigned' | 'waiting_host' | 'running' | 'in_review' | 'done' | 'failed' | 'canceled'
  assigneeAgentId: string
  reviewer?: string
  attemptId?: string
  leaseToken?: string
  leaseExpiresAt?: number
  reworkInstructions?: string
}

/** One question the fake stored, in the amendment-A2 wire shape. */
interface FakeQuestion {
  id: string
  issueId: string
  text: string
  options: Array<{ label: string; description?: string }>
  multiSelect: boolean
  status: 'pending' | 'answered' | 'dismissed' | 'expired'
  answer: { selected: string[]; custom?: string } | null
}

/** One failure a test scripts for the next settlement; see {@link FakeHub.settleFailures}. */
type SettleFailure = { status: number; code: string } | 'network' | 'lose-response'

/** One comment row, in the wire shape `comments.json` and `comments-list.json` show. */
interface FakeComment {
  id: string
  team_id: string
  issue_id: string
  author_type: 'human' | 'agent'
  author_member_id: string | null
  author_agent_id: string | null
  content: string
  created_at: number
  updated_at: number
}

/** One request the Host made, for assertions about the wire. */
export interface HubCall {
  method: string
  path: string
  body?: unknown
  protocolVersion?: string
  authorization?: string
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function respond(status: number, body: unknown): HubResponse {
  const text = JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}

function failure(status: number, code: string, message: string): HubResponse {
  return respond(status, { error: { code, message, details: {} } })
}

/** The team hub one test drives. */
export class FakeHub {
  readonly calls: HubCall[] = []
  readonly issues = new Map<string, FakeIssue>()
  readonly questions = new Map<string, FakeQuestion>()
  /** Comment rows this hub stored, in the wire shape of `comments.json`. */
  readonly comments: FakeComment[] = []
  hostId = 'host_1'
  /** Agents this Host registered, by the name it registered them under. */
  registered: Array<{ id: string; name: string; preset_id: string }> = []
  /** Agent names another Host already owns, with the reason the hub reports; a registration skips them. */
  readonly nameConflicts = new Map<string, string>()
  /** Error code the next claim answers with; absent means the claim succeeds. */
  failNextClaim: string | undefined
  /** When true the next question report is refused, as a hub outage would. */
  failNextQuestion = false
  /**
   * The failures the next settlements meet, in order: a hub refusal, a transport
   * error before anything was stored (`network`), or a lost answer after the hub
   * really stored it (`lose-response`). An empty queue accepts every settlement.
   */
  readonly settleFailures: SettleFailure[] = []
  /** The frozen wire samples this checkout carries, when it carries them. */
  readonly contract: ContractSet = loadContractSamples()
  /** The server event catalogue every pushed frame is built from. */
  readonly events: Map<string, EventSample> = loadEventCatalogue()
  /** Sample-name mismatches found while answering, asserted by the suite. */
  readonly contractProblems: string[] = []
  /** The channel this Host opened, when it did. */
  handlers: SocketHandlers | undefined
  sockets = 0
  /** The answer of the claim a test holds back, so two paths can race it. */
  private claimGate: Promise<void> | undefined
  private openClaimGate: (() => void) | undefined
  private seq = 0
  private attempt = 0
  private lease = 0
  private question = 0

  /** Answer through the sample check: the response shape is part of the contract. */
  private answerChecked(sample: ContractSample | undefined, status: number, body: Record<string, unknown>): HubResponse {
    if (sample !== undefined) {
      for (const problem of compareResponse(sample, body)) this.contractProblems.push(problem)
    }
    return respond(status, body)
  }

  /** The transport the Host's client uses. */
  readonly fetch: HubFetch = async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.pathname
    const version = init.headers['X-Team-Hub-Protocol-Version'] ?? init.headers['x-team-hub-protocol-version']
    this.calls.push({
      method: init.method,
      path,
      ...(init.body === undefined ? {} : { body: JSON.parse(init.body) as unknown }),
      ...(version === undefined ? {} : { protocolVersion: version }),
      ...(init.headers.authorization === undefined ? {} : { authorization: init.headers.authorization }),
    })
    if (version === undefined) return failure(400, 'UNSUPPORTED_PROTOCOL_VERSION', 'missing protocol version header')
    const body = init.body === undefined ? {} : JSON.parse(init.body) as Record<string, unknown>
    // The hub side's frozen sample is the authority for the request shape: a
    // renamed or dropped field fails here instead of in production.
    const sample = sampleForCall(this.contract, init.method, path)
    if (sample !== undefined) {
      for (const problem of compareRequest(sample, {
        headers: init.headers,
        query: Object.fromEntries(parsed.searchParams.entries()),
        body,
        method: init.method,
        path,
      })) {
        this.contractProblems.push(sample.file + ': ' + problem)
      }
    }
    const segments = path.split('/').filter(segment => segment !== '')
    // /api/v1/teams/<team>/...
    const tail = segments.slice(4)
    if (init.method === 'POST' && tail[0] === 'hosts' && tail[1] === 'register') {
      const agents = Array.isArray(body.agents) ? body.agents as Array<Record<string, unknown>> : []
      return this.answerChecked(sample, 200, this.registeredAnswer(agents))
    }
    if (init.method === 'POST' && tail[0] === 'hosts' && tail[2] === 'heartbeat') {
      return this.answerChecked(sample, 200, { ok: true, server_time: Date.now() })
    }
    if (init.method === 'GET' && tail[0] === 'issues' && tail.length === 1) {
      const status = parsed.searchParams.get('status') ?? ''
      const wanted = new Set(status.split(',').filter(entry => entry !== ''))
      const issues = [...this.issues.values()]
        .filter(issue => wanted.size === 0 || wanted.has(issue.status))
        .map(issue => this.project(issue))
      return this.answerChecked(sample, 200, { issues })
    }
    if (init.method === 'POST' && tail[0] === 'issues' && tail[2] === 'claim') {
      return this.claim(String(tail[1]), body, sample)
    }
    if (init.method === 'POST' && tail[0] === 'issues' && tail[2] === 'renew-lease') {
      const issue = this.issues.get(String(tail[1]))
      if (issue === undefined) return failure(404, 'NOT_FOUND', 'issue not found')
      if (issue.leaseToken === undefined || issue.leaseToken !== body.lease_token) {
        return failure(412, 'LEASE_EXPIRED', 'the lease is no longer held by this attempt')
      }
      issue.leaseExpiresAt = Date.now() + 60_000
      return this.answerChecked(sample, 200, { lease_expires_at: issue.leaseExpiresAt })
    }
    if (init.method === 'POST' && tail[0] === 'issues' && tail[2] === 'settle') {
      return this.settle(String(tail[1]), body, sample)
    }
    if (init.method === 'POST' && tail[0] === 'issues' && tail[2] === 'questions') {
      if (this.failNextQuestion) {
        this.failNextQuestion = false
        return failure(400, 'VALIDATION_FAILED', 'the hub cannot store this question')
      }
      this.question += 1
      const options = Array.isArray(body.options)
        ? (body.options as Array<Record<string, unknown>>).flatMap(option => typeof option.label === 'string'
          ? [{ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }]
          : [])
        : []
      const stored: FakeQuestion = {
        id: 'ques_' + String(this.question),
        issueId: String(tail[1]),
        text: String(body.question_text ?? ''),
        options,
        multiSelect: body.multi_select === true,
        status: 'pending',
        answer: null,
      }
      this.questions.set(stored.id, stored)
      return this.answerChecked(sample, 201, { question: this.projectQuestion(stored) })
    }
    if (init.method === 'POST' && tail[0] === 'questions' && tail[2] === 'withdraw') {
      const question = this.questions.get(String(tail[1]))
      if (question === undefined) return failure(404, 'NOT_FOUND', 'question not found')
      if (question.status !== 'pending') return failure(409, 'QUESTION_NOT_PENDING', 'the question is no longer pending')
      question.status = 'dismissed'
      return this.answerChecked(sample, 200, { ok: true, status: 'dismissed' })
    }
    if (init.method === 'GET' && tail[0] === 'issues' && tail[2] === 'comments') {
      const issueId = String(tail[1])
      return this.answerChecked(sample, 200, { comments: this.comments.filter(row => row.issue_id === issueId) })
    }
    if (init.method === 'POST' && tail[0] === 'issues' && tail[2] === 'comments') {
      this.comments.push({
        id: 'comm_' + String(this.comments.length + 1),
        team_id: 'team_1',
        issue_id: String(tail[1]),
        author_type: 'agent',
        author_member_id: null,
        author_agent_id: typeof body.author_agent_id === 'string' ? body.author_agent_id : '',
        content: String(body.content ?? ''),
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      return this.answerChecked(sample, 201, { comment: this.comments[this.comments.length - 1] })
    }
    return failure(404, 'NOT_FOUND', 'no such route: ' + init.method + ' ' + path)
  }

  /**
   * Register the agents one Host declared, reporting the names another Host owns.
   *
   * Section 5: a clashing name is skipped and reported in `conflicts` while the
   * rest of the registration still succeeds, so the Host stays online.
   */
  private registeredAnswer(agents: readonly Record<string, unknown>[]): Record<string, unknown> {
    const accepted: Array<{ id: string; name: string; preset_id: string }> = []
    const conflicts: Array<{ name: string; reason: string }> = []
    for (const agent of agents) {
      const name = String(agent.name ?? '')
      const presetId = String(agent.preset_id ?? '')
      // A member without a preset is never registered (protocol amendment A4
      // point 1), so a definition that arrives without one is a drift this fake
      // reports instead of silently storing.
      if (presetId === '') this.contractProblems.push('register: agent "' + name + '" has an empty preset_id')
      const reason = this.nameConflicts.get(name)
      if (reason !== undefined) {
        conflicts.push({ name, reason })
        continue
      }
      accepted.push({ id: 'agent_' + String(accepted.length + 1), name, preset_id: presetId })
    }
    this.registered = accepted
    return {
      host_id: this.hostId,
      status: 'online',
      agents: accepted.map(agent => ({ id: agent.id, name: agent.name })),
      conflicts,
    }
  }

  /**
   * Claim one issue with the two legal shapes of `team-hub/go/internal/hub/leases.go`.
   *
   * The fresh claim (`leases.ts:79`) only moves a card in `assigned` or
   * `waiting_host` and always mints its own attempt id, so the Host can never name
   * one itself. The reconnect (`leases.ts:65`, `:87`) continues the attempt this
   * Host already owns, and only when it presents BOTH the attempt and the lease
   * the issue carries. Everything else is refused from the state the hub holds
   * now (`leases.ts:96`): 409 while another attempt holds the lease, 422 for any
   * status that cannot be claimed.
   */
  private async claim(issueId: string, body: Record<string, unknown>, sample: ContractSample | undefined): Promise<HubResponse> {
    const issue = this.issues.get(issueId)
    if (issue === undefined) return failure(404, 'NOT_FOUND', 'issue not found')
    if (this.failNextClaim !== undefined) {
      const code = this.failNextClaim
      this.failNextClaim = undefined
      return failure(403, code, 'the hub refused this claim')
    }
    const presentedAttempt = typeof body.execution_attempt_id === 'string' ? body.execution_attempt_id : undefined
    const presentedLease = typeof body.lease_token === 'string' ? body.lease_token : undefined
    const reconnecting = presentedAttempt !== undefined && presentedAttempt !== ''
      && presentedLease !== undefined && presentedLease === issue.leaseToken
      && presentedAttempt === issue.attemptId
    if (issue.status === 'assigned' || issue.status === 'waiting_host') {
      // The real hub keeps a presented attempt and lease that still match the
      // issue (team-hub/go/internal/hub/leases.go:65-79): a lapsed lease does not clear
      // lease_token, so the Host whose run is still going gets the same attempt back.
      if (!reconnecting) {
        this.attempt += 1
        this.lease += 1
        issue.attemptId = 'attempt_' + String(this.attempt)
        issue.leaseToken = 'lease_' + String(this.lease)
      }
      issue.status = 'running'
      issue.leaseExpiresAt = Date.now() + 60_000
      return await this.held(this.answerChecked(sample, 200, {
        lease_token: issue.leaseToken,
        lease_expires_at: issue.leaseExpiresAt,
        execution_attempt_id: issue.attemptId,
      }))
    }
    if (reconnecting && issue.status === 'running') {
      issue.leaseExpiresAt = Date.now() + 60_000
      return await this.held(this.answerChecked(sample, 200, {
        lease_token: issue.leaseToken,
        lease_expires_at: issue.leaseExpiresAt,
        execution_attempt_id: issue.attemptId,
      }))
    }
    if (issue.status === 'running') {
      return failure(409, 'LEASE_HELD_BY_OTHER', 'another execution attempt holds the active lease')
    }
    return failure(422, 'INVALID_STATE_TRANSITION', 'the issue is ' + issue.status + ' and cannot be claimed')
  }

  /**
   * Write one settlement back under the rules of `team-hub/go/internal/hub/leases.go`.
   *
   * `failNextSettle` scripts one failure for the Host to cope with: a hub refusal,
   * a transport error before anything was stored, or a lost answer after the hub
   * really stored the settlement.
   */
  private settle(issueId: string, body: Record<string, unknown>, sample: ContractSample | undefined): HubResponse {
    const issue = this.issues.get(issueId)
    if (issue === undefined) return failure(404, 'NOT_FOUND', 'issue not found')
    const scripted = this.settleFailures.shift()
    if (scripted === 'network') {
      throw new Error('the connection to the hub dropped before the settlement arrived')
    }
    if (scripted !== undefined && scripted !== 'lose-response') {
      return failure(scripted.status, scripted.code, 'the hub refused this settlement')
    }
    const answer = this.applySettlement(issue, body, sample)
    if (scripted === 'lose-response') {
      // The hub stored it; only the answer never reached the Host.
      throw new Error('the settlement answer was lost on the way back')
    }
    return answer
  }

  /** Store one settlement exactly as `settleIssue` does, including its refusals. */
  private applySettlement(issue: FakeIssue, body: Record<string, unknown>, sample: ContractSample | undefined): HubResponse {
    const outcome = body.outcome === 'succeeded' || body.outcome === 'failed' ? body.outcome : undefined
    if (outcome === undefined) return failure(400, 'VALIDATION_FAILED', "outcome must be 'succeeded' or 'failed'")
    const presentedAttempt = typeof body.execution_attempt_id === 'string' ? body.execution_attempt_id : undefined
    const attemptMatches = presentedAttempt !== undefined && presentedAttempt === issue.attemptId
    // `leases.ts:180`: a write-back naming an attempt the issue does not carry is
    // a stale one, whatever else its body says.
    if (presentedAttempt !== undefined && !attemptMatches) {
      return failure(412, 'LEASE_EXPIRED', 'this execution attempt is not the one running the issue')
    }
    // `leases.ts:186`: an issue that already settled answers its own status.
    if (issue.status === 'in_review' || issue.status === 'failed') {
      return this.answerChecked(sample, 200, { ok: true, status: issue.status })
    }
    const reconnectWriteBack = issue.status === 'waiting_host' && attemptMatches
    if (issue.status !== 'running' && !reconnectWriteBack) {
      return failure(412, 'LEASE_EXPIRED', 'the issue is not running under this host')
    }
    issue.leaseToken = undefined
    // The hub clears the pending rework once the reworked run settles
    // (protocol amendment A4 point 5).
    issue.reworkInstructions = undefined
    issue.status = outcome === 'succeeded' ? 'in_review' : 'failed'
    return this.answerChecked(sample, 200, { ok: true, status: issue.status })
  }

  /** Open the team channel for the Host. */
  connect = async (_sinceSeq: number, handlers: SocketHandlers): Promise<SocketLike | undefined> => {
    this.sockets += 1
    this.handlers = handlers
    return {
      send: () => {},
      close: () => { this.handlers = undefined },
    }
  }

  /** Drop the channel, as a network failure would. */
  drop(): void {
    const handlers = this.handlers
    this.handlers = undefined
    handlers?.closed('network down')
  }

  /**
   * Push one catalogue event onto the open channel.
   *
   * The payload is the one `ws-events.json` freezes, with the members the test
   * overrides on top: an event the hub cannot send, or a payload the catalogue
   * does not describe, is a contract problem rather than a frame.
   * @param event - event name, as the catalogue spells it.
   * @param overrides - members this test wants instead of the sample's.
   */
  push(event: string, overrides: Record<string, unknown> = {}): void {
    const sample = this.events.get(event)
    if (sample === undefined) {
      this.contractProblems.push('the event catalogue has no ' + event + ' event')
      return
    }
    this.seq += 1
    const payload = { ...sample.payload, ...overrides }
    this.handlers?.message(JSON.stringify({ t: 'event', seq: this.seq, event, payload, ts: Date.now() }))
  }

  /**
   * Hold the answer of the next successful claim until {@link releaseClaim}.
   *
   * The hub's own state is already granted when the answer is held, so a test
   * can put a rejection event's claim on top of a call that is still in flight:
   * the overlap the single-flight rule of section 5 exists for.
   */
  holdNextClaim(): void {
    this.claimGate = new Promise<void>(resolve => { this.openClaimGate = resolve })
  }

  /** Let a held claim answer. */
  releaseClaim(): void {
    const open = this.openClaimGate
    this.claimGate = undefined
    this.openClaimGate = undefined
    open?.()
  }

  /** Answer one held claim, if a test is holding this one. */
  private async held(answer: HubResponse): Promise<HubResponse> {
    const gate = this.claimGate
    if (gate === undefined) return answer
    this.claimGate = undefined
    await gate
    return answer
  }

  /** Answer one pending question, broadcasting the hub's own event. */
  answer(questionId: string, answer: { selected: string[]; custom?: string }): void {
    const question = this.questions.get(questionId)
    if (question === undefined) return
    question.status = 'answered'
    question.answer = answer
    this.push('question.answered', { question_id: questionId, answer, responder_member_id: 'mem_reviewer' })
  }

  /** Expire one pending question, broadcasting the hub's own event. */
  expire(questionId: string, issueId: string): void {
    const question = this.questions.get(questionId)
    if (question !== undefined) question.status = 'expired'
    this.push('question.expired', { question_id: questionId, issue_id: issueId })
  }

  /** Add one issue the Host may see. */
  addIssue(input: Partial<FakeIssue> & { assigneeAgentId: string }): FakeIssue {
    const number = this.issues.size + 1
    const issue: FakeIssue = {
      id: input.id ?? 'issue_' + String(number),
      issueNumber: input.issueNumber ?? number,
      title: input.title ?? 'Ship the thing',
      description: input.description ?? 'The body of the issue.',
      status: input.status ?? 'assigned',
      assigneeAgentId: input.assigneeAgentId,
      ...(input.reviewer === undefined ? {} : { reviewer: input.reviewer }),
    }
    this.issues.set(issue.id, issue)
    return issue
  }

  /** Register the agents one Host declared, without a round trip. */
  seedAgents(agents: readonly BoundAgent[]): void {
    this.registered = agents.map((agent, index) => ({
      id: 'agent_' + String(index + 1),
      name: agent.name,
      preset_id: agent.preset ?? '',
    }))
  }

  /** The hub id of one agent name, as registration assigned it. */
  agentId(name: string): string | undefined {
    return this.registered.find(agent => agent.name === name)?.id
  }

  /** One stored question as the wire serves it. */
  private projectQuestion(question: FakeQuestion): Record<string, unknown> {
    return {
      id: question.id,
      issue_id: question.issueId,
      text: question.text,
      options: question.options,
      multi_select: question.multiSelect,
      status: question.status,
      answer: question.answer,
      first_responder_member_id: question.status === 'answered' ? 'mem_reviewer' : null,
      created_at: Date.now(),
      answered_at: question.status === 'answered' ? Date.now() : null,
    }
  }

  private project(issue: FakeIssue): Record<string, unknown> {
    return {
      id: issue.id,
      team_id: 'team_1',
      issue_number: issue.issueNumber,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      creator_member_id: 'mem_creator',
      assignee_type: 'agent',
      assignee_member_id: null,
      assignee_agent_id: issue.assigneeAgentId,
      reviewer_member_id: issue.reviewer ?? null,
      executing_host_id: issue.leaseToken === undefined ? null : this.hostId,
      lease_expires_at: issue.leaseExpiresAt ?? null,
      has_lease: issue.leaseToken !== undefined,
      execution_attempt_id: issue.attemptId ?? null,
      execution_summary: null,
      rework_instructions: issue.reworkInstructions ?? null,
      failure_error: null,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    }
  }
}

export { JSON_HEADERS }
