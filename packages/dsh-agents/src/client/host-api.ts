/**
 * Browser transport of the agents sub-plugin: a thin fetch layer over the
 * frozen wire contract.
 *
 * Every failure becomes an {@link AgentsApiError} with a stable class plus
 * copy from the locale dictionary, so the page never renders a raw fetch or
 * JSON parse message: an unmounted Host route, a refused run and a broken
 * response all read as sentences the user can act on.
 */
import { t } from './locales.ts'
import type { AgentsKey } from './locales.ts'
import { DSH_AGENTS_API_PREFIX } from '../protocol.ts'
import type {
  AgentsErrorCode,
  AgentsStateView,
  DescribeRequestBody,
  DescribeResponseBody,
  MemberDraft,
  RunRecord,
  SquadRunRequestBody,
  TeamDefinition,
  TeamDraft,
} from '../protocol.ts'

/**
 * The page is served with `<base href="./">`, so the browser half addresses
 * the routes DOCUMENT-RELATIVE: the Host registers the prefix root-absolute
 * and the client drops the leading slash, exactly like the task board.
 */
const CLIENT_API_PREFIX = DSH_AGENTS_API_PREFIX.slice(1)

/** Ceiling for one request, matching the task board's transport budget. */
const REQUEST_TIMEOUT_MS = 15_000
/**
 * Ceiling for one description draft. The Host may wait up to 90s for a model,
 * so this budget sits above it: the page must report the Host's own timeout,
 * never cut the call short and then blame the model.
 */
const DESCRIBE_TIMEOUT_MS = 95_000

const JSON_HEADERS = { accept: 'application/json' } as const

/**
 * Failure classes of the agents API. The class is what the UI branches on;
 * the message is already user-facing copy.
 */
export type AgentsFailure =
  /** The Host routes are absent: the plugin did not mount, or its row degraded. */
  | 'not-mounted'
  | 'unauthorized'
  | 'forbidden'
  /** The Host answered with a refusal of its own (see `message`). */
  | 'rejected'
  /** The member pins a preset this deployment does not have. */
  | 'unknown-preset'
  /** Neither the squad nor the member has a usable workspace. */
  | 'no-workspace'
  /** This deployment serves no model route, so no description can be written. */
  | 'describe-unavailable'
  /** The description model failed, timed out, or answered nothing usable. */
  | 'describe-failed'
  /** The addressed squad is gone: deleted between the read and the write. */
  | 'squad-missing'
  /** The Host refused to create the squad Lead session. */
  | 'lead-create-failed'
  /** The Lead session exists but could not be renamed or prompted, so the run is dead. */
  | 'lead-prepare-failed'
  /** The squad ledger is owned by another process, corrupt, or unwritable. */
  | 'ledger-unavailable'
  | 'timeout'
  | 'unreachable'
  | 'unexpected'

/** Transport failure carrying a stable class next to its user-facing message. */
export class AgentsApiError extends Error {
  constructor(readonly failure: AgentsFailure, message: string, readonly status?: number) {
    super(message)
    this.name = 'AgentsApiError'
  }
}

/** Dictionary key per failure class. */
const FAILURE_KEYS: Record<AgentsFailure, AgentsKey> = {
  'not-mounted': 'error.notMounted',
  'unauthorized': 'error.unauthorized',
  'forbidden': 'error.forbidden',
  'rejected': 'error.rejected',
  'unknown-preset': 'error.unknownPreset',
  'no-workspace': 'error.noWorkspace',
  'describe-unavailable': 'error.describeUnavailable',
  'describe-failed': 'error.describeFailed',
  'squad-missing': 'error.squadMissing',
  'lead-create-failed': 'error.leadCreateFailed',
  'lead-prepare-failed': 'error.leadPrepareFailed',
  'ledger-unavailable': 'error.ledgerUnavailable',
  'timeout': 'error.timeout',
  'unreachable': 'error.unreachable',
  'unexpected': 'error.unexpected',
}

/** Read the failure copy of one class, with the params that class needs. */
function failureMessage(failure: AgentsFailure, params: Record<string, string> = {}): string {
  return t(FAILURE_KEYS[failure], params)
}

/**
 * Host refusal codes that have their own class. The protocol's
 * `AGENTS_ERROR_CODES` is the list this table is checked against; every code
 * outside it stays a plain rejection carrying the Host's own sentence.
 */
const HOST_FAILURE_CODES: Partial<Record<AgentsErrorCode, AgentsFailure>> = {
  'preset-registry-unavailable': 'unknown-preset',
  'preset-unknown': 'unknown-preset',
  'preset-unavailable': 'unknown-preset',
  'workspace-unknown': 'no-workspace',
  'workspace-unavailable': 'no-workspace',
  // A deployment with no model service and one with no model route make the
  // same statement about the description button, so both read through it.
  'describe-unavailable': 'describe-unavailable',
  'describe-failed': 'describe-failed',
  'forbidden': 'forbidden',
  // M2 squad-run codes: a Lead this Host never managed to launch reads as its
  // own failure instead of one generic refusal, and a ledger this browser cannot
  // write reads as the ledger rather than as the run.
  'team-not-found': 'squad-missing',
  'session-create-failed': 'lead-create-failed',
  'session-rename-failed': 'lead-prepare-failed',
  'session-prompt-failed': 'lead-prepare-failed',
  'ledger-corrupt': 'ledger-unavailable',
  'ledger-owned': 'ledger-unavailable',
  'ledger-write-failed': 'ledger-unavailable',
}

/** Read the stable code of one error body. */
function hostErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' && code !== '' ? code : undefined
}

/** Read the bounded human sentence of one error body. */
function hostErrorText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const text = (body as { error?: unknown }).error
  return typeof text === 'string' && text !== '' ? text : undefined
}

/**
 * Read one Host response without ever handing a non-JSON body to JSON.parse:
 * the core webserver answers an unmounted route with the plain text
 * "not found", which would otherwise surface as a parse error in the page.
 */
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  let parsed: unknown
  let readable = false
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text)
      readable = true
    } catch {
      readable = false
    }
  }
  const code = readable ? hostErrorCode(parsed) : undefined
  const detail = readable ? hostErrorText(parsed) ?? code : undefined
  if (response.ok) {
    if (!readable) throw new AgentsApiError('unexpected', failureMessage('unexpected', { status: String(response.status) }), response.status)
    if (code !== undefined) throw new AgentsApiError('rejected', failureMessage('rejected', { detail: detail ?? code }), response.status)
    return parsed as T
  }
  if (code !== undefined) {
    const known = (HOST_FAILURE_CODES as Record<string, AgentsFailure | undefined>)[code]
    if (known !== undefined) throw new AgentsApiError(known, failureMessage(known), response.status)
    throw new AgentsApiError('rejected', failureMessage('rejected', { detail: detail ?? code }), response.status)
  }
  // A bare 404 is the only signal that this plugin's routes are absent; a bare
  // 401/403 is the shell's authentication and same-origin fence.
  if (response.status === 404) throw new AgentsApiError('not-mounted', failureMessage('not-mounted'), 404)
  if (response.status === 401) throw new AgentsApiError('unauthorized', failureMessage('unauthorized'), 401)
  if (response.status === 403) throw new AgentsApiError('forbidden', failureMessage('forbidden'), 403)
  throw new AgentsApiError('unexpected', failureMessage('unexpected', { status: String(response.status) }), response.status)
}

/** JSON POST init for one contract route. */
function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Send one request under the plugin's own timeout, forwarding the caller's
 * abort signal (the page cancels in-flight reads when it unmounts).
 * @param timeoutMs - this request's own budget; the model-backed routes get a
 *   longer one than the ledger reads.
 * @returns the Host response, whatever its status.
 */
async function sendWithTimeout(fetchImpl: typeof fetch, path: string, init: RequestInit, signal?: AbortSignal, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => { controller.abort() }, timeoutMs)
  const forward = (): void => { controller.abort() }
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', forward)
  }
  try {
    return await fetchImpl(CLIENT_API_PREFIX + '/' + path, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch (error) {
    // A caller-side abort is not a failure of the Host: let the page drop it.
    if (signal !== undefined && signal.aborted) throw error
    if (controller.signal.aborted) throw new AgentsApiError('timeout', failureMessage('timeout', { seconds: String(Math.round(timeoutMs / 1_000)) }))
    throw new AgentsApiError('unreachable', failureMessage('unreachable'))
  } finally {
    globalThis.clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forward)
  }
}

/** The client face of the frozen contract. */
export interface AgentsTransport {
  /** GET state: every squad, every run, and the owning Host pid. */
  state(signal?: AbortSignal): Promise<AgentsStateView>
  createTeam(team: TeamDraft): Promise<TeamDefinition>
  deleteTeam(teamId: string): Promise<void>
  saveMember(teamId: string, member: MemberDraft): Promise<TeamDefinition>
  deleteMember(teamId: string, memberId: string): Promise<TeamDefinition>
  /** Start the member's own session (点播). */
  run(teamId: string, memberId: string, firstMessage?: string): Promise<RunRecord>
  /** Start one whole squad: the Lead session whose model spawns the teammates. */
  runSquad(request: SquadRunRequestBody): Promise<RunRecord>
  /**
   * Draft one squad description with this deployment's model.
   *
   * The Host spends a model call here, so the caller decides when to ask; a
   * deployment that serves no model route refuses with its own class rather
   * than answering an empty string.
   */
  describe(request: DescribeRequestBody, signal?: AbortSignal): Promise<string>
}

/**
 * Build the transport over one fetch implementation.
 * @param fetchImpl - fetch to use (injected by tests; the page uses the global).
 */
export function createAgentsTransport(fetchImpl: typeof fetch = fetch): AgentsTransport {
  const send = (path: string, init: RequestInit, signal?: AbortSignal, timeoutMs?: number): Promise<Response> => sendWithTimeout(fetchImpl, path, init, signal, timeoutMs)
  return {
    async state(signal?: AbortSignal): Promise<AgentsStateView> {
      return readJson<AgentsStateView>(await send('state', { method: 'GET', headers: JSON_HEADERS }, signal))
    },
    async createTeam(team: TeamDraft): Promise<TeamDefinition> {
      const body = await readJson<{ team: TeamDefinition }>(await send('team', postInit({ team })))
      return body.team
    },
    async deleteTeam(teamId: string): Promise<void> {
      await readJson<{ ok: true }>(await send('team/delete', postInit({ teamId })))
    },
    async saveMember(teamId: string, member: MemberDraft): Promise<TeamDefinition> {
      const body = await readJson<{ team: TeamDefinition }>(await send('member', postInit({ teamId, member })))
      return body.team
    },
    async deleteMember(teamId: string, memberId: string): Promise<TeamDefinition> {
      const body = await readJson<{ team: TeamDefinition }>(await send('member/delete', postInit({ teamId, memberId })))
      return body.team
    },
    async run(teamId: string, memberId: string, firstMessage?: string): Promise<RunRecord> {
      const body = await readJson<{ run: RunRecord }>(await send('run', postInit(firstMessage === undefined ? { teamId, memberId } : { teamId, memberId, firstMessage })))
      return body.run
    },
    async runSquad(request: SquadRunRequestBody): Promise<RunRecord> {
      const body = await readJson<{ run: RunRecord }>(await send('squad/run', postInit(request)))
      return body.run
    },
    async describe(request: DescribeRequestBody, signal?: AbortSignal): Promise<string> {
      const body = await readJson<DescribeResponseBody>(await send('describe', postInit(request), signal, DESCRIBE_TIMEOUT_MS))
      return body.description
    },
  }
}

/**
 * Turn any thrown value into the class plus copy the page renders. A value
 * that is not an {@link AgentsApiError} is a defect in this half, never a
 * Host answer, so it gets the generic sentence instead of its raw text.
 */
export function failureOf(error: unknown): { failure: AgentsFailure; message: string } {
  if (error instanceof AgentsApiError) return { failure: error.failure, message: error.message }
  return { failure: 'unexpected', message: t('error.unknown') }
}
