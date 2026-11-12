/**
 * The Host's REST client for one team-hub.
 *
 * Every call carries the Host Token and the protocol version, resolves its base
 * URL and team at call time (so a settings edit reaches the next call without a
 * remount), and turns the hub's unified error envelope into one diagnosable
 * error carrying its code. The transport is injected: a deployment uses the
 * global fetch, and the test suite drives a fake hub through the same seam.
 *
 * @module dsh-task-board-team/host/hub-client
 */
import {
  HUB_API_PREFIX,
  HUB_PROTOCOL_HEADER,
  HUB_PROTOCOL_VERSION,
  type HubActivity,
  type HubAgentDefinition,
  type HubAgentRecord,
  type HubClaim,
  type HubComment,
  type HubIssue,
  type HubQuestion,
} from '../core/hub-protocol.ts'
import type { QuestionReportBody } from '../core/question-report.ts'
import type { SettleRequestBody } from '../core/settlement.ts'

/** One response as this client reads it. */
export interface HubResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

/** The transport one deployment hands the client. */
export type HubFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HubResponse>

/** One refusal the hub answered with. */
export class HubError extends Error {
  /** Machine-readable code from the unified error envelope. */
  readonly code: string
  /** HTTP status the hub answered with. */
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'HubError'
    this.code = code
    this.status = status
  }
}

/** Read the code out of the hub's unified error envelope. */
function readErrorCode(body: unknown, status: number): { code: string; message: string } {
  if (typeof body === 'object' && body !== null) {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'object' && error !== null) {
      const envelope = error as { code?: unknown; message?: unknown }
      return {
        code: typeof envelope.code === 'string' ? envelope.code : 'HTTP_' + String(status),
        message: typeof envelope.message === 'string' ? envelope.message : 'the hub refused the request',
      }
    }
  }
  return { code: 'HTTP_' + String(status), message: 'the hub refused the request' }
}

export interface HubClientOptions {
  /** Hub base URL, read per call. */
  hubUrl: () => string
  /** Team id, read per call. */
  teamId: () => string
  /** Host Token, resolved per call from the credential store. */
  token: () => Promise<string | undefined>
  /** Transport; the global fetch when absent. */
  fetch?: HubFetch
}

/** The REST surface one Host speaks to one team. */
export class HubClient {
  readonly #options: HubClientOptions

  constructor(options: HubClientOptions) {
    this.#options = options
  }

  /** Whether this deployment can reach a hub at all (a URL and a token exist). */
  async configured(): Promise<boolean> {
    return this.#base().ok
  }

  /**
   * Register this Host and synchronize its agent definitions.
   *
   * The body is snake_case end to end (protocol amendment A4 point 1): the hub
   * stores exactly these keys, so a camelCase member is a field it never sees.
   * @param body - hostname, client version and the local agent definitions.
   * @returns the registered host id, status and the agent records the hub now holds.
   */
  async register(body: {
    hostname: string
    client_version: string
    agents: readonly HubAgentDefinition[]
  }): Promise<{ host_id: string; status: string; agents?: readonly HubAgentRecord[] }> {
    return await this.#call('POST', '/hosts/register', body) as {
      host_id: string
      status: string
      agents?: readonly HubAgentRecord[]
    }
  }

  /**
   * Send one heartbeat.
   * @param hostId - the registered host id.
   * @returns the hub's server time.
   */
  async heartbeat(hostId: string): Promise<{ server_time?: number }> {
    return await this.#call('POST', `/hosts/${encodeURIComponent(hostId)}/heartbeat`) as { server_time?: number }
  }

  /**
   * List the issues this Host may claim.
   * @param hostId - the registered host id.
   * @returns the claimable issues.
   */
  async listClaimableIssues(hostId: string): Promise<readonly HubIssue[]> {
    const query = '?assignee_host_id=' + encodeURIComponent(hostId) + '&status=' + encodeURIComponent('assigned,waiting_host')
    const body = await this.#call('GET', '/issues' + query) as { issues?: unknown }
    return Array.isArray(body.issues) ? body.issues as HubIssue[] : []
  }

  /**
   * Claim one issue, or re-establish the attempt already running locally.
   * @param issueId - the issue to claim.
   * @param credentials - the previous attempt credentials, when this is a reconnect.
   * @returns the lease.
   */
  async claim(issueId: string, credentials: { execution_attempt_id?: string; lease_token?: string } = {}): Promise<HubClaim> {
    return await this.#call('POST', `/issues/${encodeURIComponent(issueId)}/claim`, credentials) as unknown as HubClaim
  }

  /**
   * Extend one lease.
   * @param issueId - the claimed issue.
   * @param leaseToken - the lease credential.
   * @returns the new expiry.
   */
  async renewLease(issueId: string, leaseToken: string): Promise<{ lease_expires_at: number }> {
    return await this.#call('POST', `/issues/${encodeURIComponent(issueId)}/renew-lease`, { lease_token: leaseToken }) as { lease_expires_at: number }
  }

  /**
   * Write one settlement back.
   * @param issueId - the settled issue.
   * @param body - outcome, summary and error.
   * @returns the collaboration status the hub moved to.
   */
  async settle(issueId: string, body: SettleRequestBody): Promise<{ ok: boolean; status: string }> {
    return await this.#call('POST', `/issues/${encodeURIComponent(issueId)}/settle`, body) as { ok: boolean; status: string }
  }

  /**
   * Report one decision question.
   * @param issueId - the issue it belongs to.
   * @param body - the question text, options and multi-select flag.
   * @returns the stored question.
   */
  async createQuestion(issueId: string, body: QuestionReportBody): Promise<HubQuestion> {
    const response = await this.#call('POST', `/issues/${encodeURIComponent(issueId)}/questions`, body) as { question?: HubQuestion }
    if (response.question === undefined) throw new HubError('INVALID_RESPONSE', 'the hub returned no question', 200)
    return response.question
  }

  /**
   * Withdraw one pending question after the local asker gave up.
   * @param questionId - the question to withdraw.
   */
  async withdrawQuestion(questionId: string): Promise<void> {
    await this.#call('POST', '/questions/' + encodeURIComponent(questionId) + '/withdraw')
  }

  /**
   * Post one agent comment.
   * @param issueId - the issue to comment on.
   * @param body - the content and the agent identity that wrote it.
   * @returns the stored comment.
   */
  async createComment(issueId: string, body: { content: string; author_type: 'agent'; author_agent_id: string }): Promise<HubComment> {
    const response = await this.#call('POST', `/issues/${encodeURIComponent(issueId)}/comments`, body) as { comment?: HubComment }
    if (response.comment === undefined) throw new HubError('INVALID_RESPONSE', 'the hub returned no comment', 200)
    return response.comment
  }

  /**
   * Read one issue's comment thread.
   * @param issueId - the issue to read.
   * @returns the comments, oldest first.
   */
  async comments(issueId: string): Promise<readonly HubComment[]> {
    const body = await this.#call('GET', `/issues/${encodeURIComponent(issueId)}/comments`) as { comments?: unknown }
    return Array.isArray(body.comments) ? body.comments as HubComment[] : []
  }

  /** The base URL and team, or the reason there is none. */
  #base(): { ok: true; url: string } | { ok: false } {
    const raw = this.#options.hubUrl().trim()
    const team = this.#options.teamId().trim()
    if (raw === '' || team === '') return { ok: false }
    return { ok: true, url: raw.replace(/\/+$/, '') + HUB_API_PREFIX + '/teams/' + encodeURIComponent(team) }
  }

  async #call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const base = this.#base()
    if (!base.ok) throw new HubError('NOT_CONFIGURED', 'the team hub URL and team id are not configured', 0)
    const token = await this.#options.token()
    if (token === undefined || token === '') throw new HubError('UNAUTHORIZED', 'no Host Token is configured', 401)
    const headers: Record<string, string> = {
      authorization: 'Bearer ' + token,
      [HUB_PROTOCOL_HEADER]: HUB_PROTOCOL_VERSION,
      accept: 'application/json',
      // The frozen samples declare it on every Host call, body or not
      // (protocol amendment A4 point 9), so it is never conditional here.
      'content-type': 'application/json',
    }
    const response = await this.#fetch()(
      base.url + path,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    )
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      parsed = undefined
    }
    if (!response.ok) {
      const { code, message } = readErrorCode(parsed, response.status)
      throw new HubError(code, message, response.status)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HubError('INVALID_RESPONSE', 'the hub returned a body this client cannot read', response.status)
    }
    return parsed as Record<string, unknown>
  }

  #fetch(): HubFetch {
    const injected = this.#options.fetch
    if (injected !== undefined) return injected
    return async (url, init) => {
      const response = await fetch(url, init)
      return {
        ok: response.ok,
        status: response.status,
        text: async () => await response.text(),
      }
    }
  }
}

/** The activity entry one status change appends, as the browser renders it. */
export interface ActivityEntry {
  id: string
  type: string
  text: string
  createdAt: number
}

/**
 * Project one hub activity row into the shape the summary carries.
 *
 * The wire carries the payload as a JSON object (its `payload_json` column is a
 * D1 storage form only), so the rendered text is this Host's own rendering of
 * that object rather than a serialized column.
 * @param activity - the row the hub broadcast or served.
 * @returns the entry the browser renders.
 */
export function projectActivity(activity: HubActivity): ActivityEntry {
  return {
    id: activity.id,
    type: activity.activity_type,
    text: Object.keys(activity.payload).length === 0 ? activity.activity_type : JSON.stringify(activity.payload),
    createdAt: activity.created_at,
  }
}