/**
 * One client connection's protocol v1 state machine, transport-agnostic.
 *
 * Everything a connected device can do lives here, and nothing about the
 * WebSocket carrier does: the state machine writes frames through a
 * {@link BridgeTransport}, so the tests drive a whole session — pairing,
 * listing, snapshotting, prompting, approvals — without a socket.
 *
 * Two rules from the frozen design are load-bearing here:
 * - a follow stream is opened once per session with `assistantStream: true`,
 *   and its opening snapshot frame doubles as `session.snapshot`'s answer
 *   (decided after the original §2.1/§2.2 contradiction);
 * - every follow stream is aborted when the connection ends. A stream that
 *   outlives its connection would keep the session's process-local assistant
 *   stream alive for a phone that is gone.
 * @module dsh-remote-bridge/core/connection
 */

import type { ApprovalRegistry } from './approvals.ts'
import { commandItems, commandsUnavailable } from './commands.ts'
import type { DeviceRoster, PushEnvironment, PushLiveActivityToken, PushRegistration } from './devices.ts'
import { ROSTER_DELTA_MAX_ROWS, RemoteBridgeDeltas, type DeltaRow } from './delta.ts'
import { deltaOfFollowFrame, MessageIndex, oldestEntrySeq, pageTurns, readFollowBaseline, SpawnCallIndex, ToolCallIndex, trimUnrenderedEntries, turnsAbove, turnsOfRecords, type FollowBaseline, type SnapshotTurn } from './dsh-frames.ts'
import { EventSequence, FRAME_TOO_LARGE, MAX_FRAME_BYTES, decodeClientFrame, encodeFrame, errorFrame, responseFrame, type ReqFrame, type ServerFrame } from './envelope.ts'
import type { RemoteBridgeMethodResult, RemoteBridgeRegistry } from './extension.ts'
import { errorCodeOf, failureText, withServiceUnavailableRetry } from './gateway-errors.ts'
import { scopeKey, type JobRoster, type JobsPayload } from './jobs.ts'
import type { LiveActivityNotifier } from './liveactivity.ts'
import type { ModelEffortPreferences } from './model-efforts.ts'
import type { PairingService } from './pairing.ts'
import type { PushNotifier } from './push.ts'
import { pushEventOfTurnEnd } from './push.ts'
import type { ListedQuestion, QuestionAnswerItem, QuestionClaims, QuestionListPayload } from './questions.ts'
import type { TurnEndQuietGate } from './turn-end-quiet.ts'
import { uiEventFits, uiEventOf } from './ui.ts'
import type { ListedCard, UiCards, UiListPayload } from './ui.ts'
import {
  CAP_AGENTS,
  CAP_COMMANDS,
  CAP_DELTA,
  CAP_FRAME_DEFLATE,
  CAP_JOBS,
  CAP_PUSH,
  CAP_QUESTIONS,
  CAP_QUESTION_LIST,
  CAP_ROSTER_COMPACT,
  CAP_SESSION_ADMIN,
  CAP_SESSION_FORK,
  CAP_SESSION_SNAPSHOT_PAGE,
  CAP_SESSION_SNAPSHOT_SINCE,
  CAP_SESSION_SNAPSHOT_TRIM,
  CAP_SQUADS,
  CAP_SUBAGENT_THREAD,
  CAP_UI,
  CAP_UI_LIST,
  CAP_USAGE,
  CAP_USAGE_STATS,
  CAP_WORKSPACE,
  CODE_APPROVAL_UNKNOWN,
  CODE_COMMANDS_UNAVAILABLE,
  CODE_INTERNAL,
  CODE_INVALID_ARGS,
  CODE_JOBS_UNAVAILABLE,
  CODE_NONCE_INVALID,
  CODE_PROTO_UNSUPPORTED,
  CODE_QUESTION_LIST_UNAVAILABLE,
  CODE_SESSION_NOT_FOLLOWABLE,
  CODE_SNAPSHOT_TOO_LARGE,
  CODE_SNAPSHOT_UNAVAILABLE,
  CODE_SQUADS_UNAVAILABLE,
  CODE_TOKEN_INVALID,
  CODE_UI_LIST_UNAVAILABLE,
  CODE_UNKNOWN_METHOD,
  CODE_UNKNOWN_SESSION,
  CODE_UNPAIRED,
  KNOWN_METHODS,
  METHOD_APPROVAL_RESOLVE,
  METHOD_HELLO,
  METHOD_JOBS_LIST,
  METHOD_PAIR_BEGIN,
  METHOD_PAIR_FINISH,
  METHOD_PRESETS_LIST,
  METHOD_PUSH_REGISTER,
  METHOD_QUESTION_ANSWER,
  METHOD_QUESTION_LIST,
  METHOD_SESSION_ARCHIVE,
  METHOD_SESSION_ATTACHMENT,
  METHOD_SESSION_COMMAND,
  METHOD_SESSION_COMMANDS,
  METHOD_SESSION_CREATE,
  METHOD_SESSION_FORK,
  METHOD_SESSION_HISTORY,
  METHOD_SESSION_HISTORY_DEEP,
  METHOD_SESSION_INTERRUPT,
  METHOD_SESSION_LIST,
  METHOD_SESSION_MODELS,
  METHOD_SESSION_PERMISSIONS,
  METHOD_SESSION_PIN,
  METHOD_SESSION_PROMPT,
  METHOD_SESSION_RENAME,
  METHOD_SESSION_SET_EFFORT,
  METHOD_SESSION_SET_MODEL,
  METHOD_SESSION_SET_PERMISSION,
  METHOD_SESSION_SNAPSHOT,
  METHOD_SESSION_TITLES,
  METHOD_SESSION_UNARCHIVE,
  METHOD_RELAY_GRANT,
  METHOD_UI_EVENT,
  METHOD_UI_LIST,
  METHOD_SESSION_UNPIN,
  METHOD_SQUADS_LIST,
  METHOD_SQUADS_RUNS,
  METHOD_SQUADS_RUN_MEMBER,
  METHOD_SQUADS_RUN_SQUAD,
  METHOD_SQUADS_STATE,
  METHOD_USAGE_BALANCE,
  METHOD_USAGE_SESSION,
  METHOD_USAGE_STATS,
  METHOD_WORKSPACE_LIST,
  CAP_RELAY_TIER,
  MINOR,
  PROTO,
  SERVED_CAPABILITIES,
  SERVER_ID,
  TOPIC_JOBS_CHANGED,
  TOPIC_SESSION_DELTA,
  UNPAIRED_METHODS,
} from './protocol.ts'
import { base64UrlDecode, verifyEs256 } from './crypto.ts'
import { isSquadRefusal, parseSquadMemberRun, parseSquadRun, squadRunOf, SQUAD_METHODS, squadsStateOf, type SquadTransport, type SquadsState } from './squads.ts'
import { TITLES_MAX_IDS, type SessionMeta } from './session-meta.ts'
import type { SessionPermissions } from './session-permissions.ts'
import { USAGE_METHODS, type UsageService } from './usage.ts'
import type { BridgeGateway, GatewayPeer } from './wire.ts'
import { CODE_SUBAGENT_ADDRESS_REQUIRED, sessionAddress, subagentAddress, wireArgs, type SessionAddress } from './wire.ts'
import { CLOSE_LIVENESS_TIMEOUT } from './ws-frames.ts'

/** Protocol-level heartbeat period: a frame is sent after this long without one. */
export const IDLE_PING_MS = 20_000
/**
 * Deadline behind one liveness ping: a peer that sends no frame at all within
 * this long of the ping is torn down.
 *
 * It only ever exists because a ping was sent — a connection the host has not
 * pinged has no deadline — so a quiet client is never closed for being quiet,
 * only for failing to answer. The measured one-way path over the relay is about
 * 410 ms (2026-10-19), so this is more than an order of magnitude of slack.
 */
export const LIVENESS_TIMEOUT_MS = 10_000
/** How long `session.snapshot` waits for its follow stream's opening frame. */
export const SNAPSHOT_OPEN_TIMEOUT_MS = 10_000
/** Largest turn window one snapshot asks DSH for. */
export const SNAPSHOT_MAX_MESSAGES = 200
/** Default byte budget of one `session.history` page: 512 KiB. */
export const HISTORY_PAGE_BYTES = 512 * 1024
/**
 * Window one `session.history.deep` read asks DSH for: at least 50 user or
 * assistant messages across at least 2 turns, and never more than 500 messages.
 *
 * It is the window the harness's own Web client pages history with, and it is
 * deliberately wider than one answer: a byte budget is the caller's, so the
 * store is asked for a whole span once and the bridge then cuts that span to
 * `maxBytes` by entry. Nothing in the answer depends on where the store cut:
 * the host's `hasMore` is folded into the answer's own `hasMore`, and the
 * cursor is always the oldest entry the answer carries.
 */
export const DEEP_HISTORY_WINDOW = {
  maxMessages: 500,
  turnWindow: { minMessages: 50, minTurns: 2 },
} as const
/** Highest number of prompt receipts one connection remembers for idempotency. */
export const PROMPT_RECEIPT_LIMIT = 512
/** Largest base64 text one prompt attachment may carry: 6 MiB (protocol §10.2). */
export const PROMPT_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024

/** The carrier a connection writes through. */
export interface BridgeTransport {
  send(text: string): void
  close(code: number, reason: string): void
  /**
   * Optional: whether the peer declared `frame.deflate.v1`, reported once the
   * `hello` that declares it has been recorded. The capability is the client's
   * declaration and the wire form is the carrier's, so this is the one fact that
   * has to cross between them. A carrier with no socket to compress — a
   * recording double, for one — omits the member and keeps writing text.
   */
  frameDeflate?(declared: boolean): void
}

/**
 * 第二会合点在协议面上的那一半：一条公告与一次收帧。
 *
 * 只有配了第二会合点的宿主才提供这个面，而它存在与否就是 `relay.tier.v1` 这个
 * 能力名与 `relay.grant` 这个方法存在与否——没有它，握手与应答与今天逐字相同。
 * 宿主侧的动作（写名册、去第二会合点申领）全在插件半区，core 里只留这两处接线，
 * 所以一个不认识的宿主不会因为这里多了一层而改变任何一帧。
 */
export interface RelayTierFace {
  /**
   * 这次握手要在 `hello.r.relay` 里公告的会合点，或 undefined（此刻没有可公告的）。
   *
   * 公告的含义是「这台宿主此刻确实持有一份中继承认的、按 6 小时周期刷新的租约」，
   * 而不是「它曾经申到过一次」：公告出去的是「拨这个地址」，而一个没有有效租约的
   * 地址背后没有人服务。还没申到、降级被拒、grant 过期、主动释放，四种情况都回
   * undefined，于是一条连接的下一个世代自己退回市场边缘，不需要服务端推送任何东西。
   * @returns `wss://<id><suffix>`，或 undefined。
   */
  origin(): string | undefined
  /**
   * 一条新授权已经落进名册行：第二会合点要立刻重新申领一次。
   *
   * 调用发生在名册写完之后，所以插件半区读到的就是这条授权。它是**触发**而不是
   * 等待：`relay.grant` 的应答不等那一次网络往返，申领失败由半区自己的退避收着。
   */
  grantLanded(): void
}

export interface BridgeConnectionOptions {
  readonly gateway: BridgeGateway
  readonly pairing: PairingService
  readonly roster: DeviceRoster
  readonly approvals: ApprovalRegistry
  /** Pending user questions: the claims this bridge holds and the answer path back to the host. */
  readonly questions: QuestionClaims
  /**
   * 整页卡（§35）：`ui_present` 持有的每一张卡，`ui.event` 结算它们，`ui.list`
   * 把它们念回去。与提问表平级、各自认领各自结算——两条通道互不改形状（§35.8）。
   */
  readonly ui: UiCards
  /** The host's background jobs: the read-only projection and the scopes this connection watches. */
  readonly jobs: JobRoster
  /** Process-local session metadata: live titles and the host's archive set. */
  readonly sessionMeta: SessionMeta
  /**
   * `usage.v1` 背后两半读数：一条会话的上下文窗口与请求组成估算，以及某条
   * provider 路由背后账户的余额。两者都是宿主侧的事实而不是某个设备的事实，
   * 所以一个宿主一份、所有连接共享（见 `core/usage.ts`）。
   */
  readonly usage: UsageService
  /** Host-process permission presets, read and switched through their real service objects. */
  readonly permissions: SessionPermissions
  /**
   * 每个模型自己的思考档偏好表（`core/model-efforts.ts`）。
   *
   * 一个宿主一份、所有连接与所有会话共享：它记的是这个模型在这台机器上被选过
   * 哪一档，与哪条会话无关（契约 §4）。它与宿主自己的 `reasoning.defaultEffort`
   * 是两件事，`session.models` 用另一个键名 `preferredEffort` 公布它。
   */
  readonly modelEfforts: ModelEffortPreferences
  /**
   * The in-process owner peer every gateway call speaks for, minted by the
   * bridge itself (`core/owner-peer.ts`). Dispatch refuses unpaired
   * connections before any gateway call exists, so this peer — a
   * full-control credential — is exercised only behind the bridge's own
   * pairing gate, and no client frame field is ever read into it.
   */
  readonly ownerPeer: GatewayPeer
  readonly now: () => number
  /** This machine's IANA time zone, sent with every prompt. */
  readonly clientTimeZone: () => string | undefined
  readonly log: (message: string) => void
  /**
   * Called after a client's `hello` records its capabilities, so the hub can hand
   * it whatever it can now receive but was not there to see.
   */
  readonly onDeclare?: (connection: BridgeConnection) => void
  readonly heartbeatMs?: number
  /**
   * Methods plugins registered on the bridge's extension seam. Absent is the
   * protocol exactly as this package defines it: every name outside
   * `KNOWN_METHODS` answers `unknown-method`.
   */
  readonly extensions?: RemoteBridgeRegistry
  /**
   * The host's squad domain, behind the `squads.v1` channel. Absent is a host
   * that serves no `dsh-agents` domain: the capability stays advertised and only
   * a call that needs the domain answers `squads-unavailable`.
   */
  readonly squads?: SquadTransport
  /**
   * The outbound notification path, behind the `push.v1` channel. Absent is a
   * bridge that sends nothing: `push.register` still answers `ok:true` (the
   * device row is written either way), and no notification is ever built. That
   * is the default, because a sender needs an Apple signing key this bridge is
   * not shipped with.
   */
  readonly push?: PushNotifier
  /**
   * The lock-screen card path, behind the same `push.v1` channel. Absent — and it
   * is absent whenever no APNs key is configured — is a bridge that never builds a
   * card: the roster is still served and a question is still answered, because
   * registering the phone's tokens and pushing to them are two different things
   * (§28.3, §29).
   */
  readonly liveActivity?: LiveActivityNotifier
  /**
   * The gate a finished turn is announced through (§28, §29).
   *
   * Absent is a bridge assembled without one — a suite, or an embedder — and then
   * both channels report at the frame, exactly as they did before the gate
   * existed. The mount always hands one, because it is the only assembly that can
   * read the host's own answer.
   */
  readonly turnEndQuiet?: TurnEndQuietGate
  /**
   * 第二会合点（`relay.tier.v1`）。缺省就是没有第二会合点：`hello` 不带
   * `relay` 键、能力表里没有那个名字、`relay.grant` 仍是 `unknown-method`。
   */
  readonly relay?: RelayTierFace
  /**
   * Called after a registration changed the device table.
   *
   * A session's first live-activity token is what asks this bridge to keep a
   * follow stream of its own open for that session (`host/watchers.ts`), so the
   * roster is the trigger. The hook is guarded at the call site: a standing
   * watcher is this bridge's own background work and may never turn a
   * `push.register` into a failure.
   */
  readonly onPushRegistered?: () => void
  /**
   * Called after `pair.finish` admits a device into the roster.
   *
   * A machine that started with no paired devices defers claiming its relay
   * lease until a remote device is actually paired (or a pairing code is
   * requested); guarded at the call site so background relay work never fails
   * the pairing response.
   */
  readonly onDeviceEnrolled?: () => void
}

/** A device the connection proved itself to be, resolved from the upgrade request. */
export interface ConnectionAuth {
  readonly deviceId: string
}

/**
 * Whether one follow increment proves its session is working again.
 *
 * Deliberately narrow, and never "anything that is not a turn end": a parent's
 * stream also carries a settled child's message (`source.kind` `subagent-settled`
 * or `agent-message`, which the frames read as an agent actor), the usage count the
 * host publishes as an assistant message finishes, and the catalog changes of the
 * threads that session spawned. Reading any of those as a new turn would drop the
 * turn end a waiting phone has not been told about yet — the one whose session is
 * still busy with a running child, which is the case §28's gate exists for.
 *
 * One shared rule on purpose: this connection's own drain and the standing watchers
 * both read it, so the two paths cannot disagree about what a new turn looks like.
 * @param delta - one increment of a follow stream.
 * @returns whether assistant work is streaming, or this session's own user wrote.
 */
export function isTurnStartDelta(delta: { readonly kind: string; readonly actor?: { readonly kind?: string } }): boolean {
  switch (delta.kind) {
    case 'text':
    case 'reasoning':
    case 'tool-call':
    case 'tool-result':
      return true
    case 'user-message':
      // A message with no actor is not evidence: a durable log written before
      // sources existed carries none, and guessing "human" there would drop a real
      // announcement.
      return delta.actor?.kind === 'human'
    default:
      return false
  }
}

/** The answer of a subscription's opening frame: a baseline, or why there is none. */
type Opening = { readonly ok: true; readonly baseline: FollowBaseline } | { readonly ok: false; readonly code: string; readonly msg: string }

/** One open follow stream and the answer its opening frame resolves. */
interface Subscription {
  readonly sessionId: string
  readonly controller: AbortController
  /**
   * Mutable on purpose: a delegated child is addressable only through its durable
   * parent, and the bridge learns which address kind applies from the harness's own
   * refusal on the first attempt.
   */
  address: SessionAddress
  opened: Promise<Opening>
  /**
   * Whether this stream has delivered any frame after its opening one. The
   * opening window is a moment, not a state: once the stream moves, that window
   * is as old as the moment it was opened and can no longer answer for a session
   * that has run a turn since.
   */
  advanced: boolean
}

/** The refusal half of every dispatch outcome. */
interface CallFailure {
  readonly ok: false
  readonly code: string
  readonly msg: string
}

type DispatchOutcome = { readonly ok: true; readonly r: unknown } | CallFailure

/**
 * One snapshot baseline answer, typed rather than opaque so the incremental
 * fallback can extend the very payload protocol v1 serves instead of rebuilding
 * it. `hasMore` is present exactly for a connection that declared the page
 * capability.
 */
type BaselineAnswer =
  | { readonly ok: true; readonly r: { readonly turns: readonly SnapshotTurn[]; readonly lastSeq: number; readonly hasMore?: boolean } }
  | CallFailure

/** One session-list row as the protocol publishes it. */
interface SessionRow extends DeltaRow {
  readonly id: string
  readonly title: string
  readonly updatedAt: number
  readonly agentRunning: boolean
  /** The session's working directory, omitted when the host did not report one. */
  readonly cwd?: string
  /** The session this one was delegated from, omitted for a root session. */
  readonly parentSessionId?: string
  /** `subagent` for a delegated session, omitted for an ordinary one. */
  readonly origin?: 'subagent'
  readonly blank: boolean
  /** The host's archive flag; omitted when this process cannot read the archive set. */
  readonly archived?: boolean
}

function refusal(code: string, msg: string): CallFailure {
  return { ok: false, code, msg }
}

/**
 * The opaque `since` token one request carried.
 *
 * Anything that is not a non-empty string is "no usable token", which answers a
 * reset — the same answer an unknown token gets, because a request that named
 * no base cannot be diffed against one.
 * @param payload - the request's `p`.
 * @returns the token, or undefined.
 */
function sinceOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const value = payload.since
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Whether a plugin's answer is one of the two shapes the seam defines.
 *
 * An extension is ordinary JavaScript calling into this bridge, so a result the
 * type system never saw still has to leave the client with an answer instead of
 * a lost frame.
 * @param value - what the extension method returned.
 * @returns whether it carries a usable answer or refusal.
 */
function isMethodResult(value: unknown): value is RemoteBridgeMethodResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as { ok?: unknown; code?: unknown; msg?: unknown }
  if (result.ok === true) return true
  if (result.ok !== false) return false
  return typeof result.code === 'string' && result.code !== '' && typeof result.msg === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns a non-empty string argument, or undefined. */
function stringArg(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** @returns a non-empty string payload value, or undefined. */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * One roster row's own title, as the host's projection carries it.
 *
 * `SessionSummary` has no top-level `title` — which is why this bridge once read
 * its own live-title cache and nothing else. Every row nevertheless carries
 * `projections.values.title`: the host folds that out of its projection cache
 * synchronously for a cold session as well as a live one, with no log read and no
 * follow stream, and its own desktop list renders exactly that field. Reading it
 * costs no call, because it is already inside the listing the bridge just paid
 * for.
 *
 * The guard is the one every optional field here takes: a `projections` block
 * that is not an object, a `values` member that is not one, and a `title` that is
 * not a non-empty string are all simply absent, so an answer of another shape
 * costs a row its title rather than failing the listing.
 * @param item - one row of the host's `session/list` answer.
 * @returns the projected title, or undefined when the row carries none.
 */
function projectedTitleOf(item: Readonly<Record<string, unknown>>): string | undefined {
  const projections = isRecord(item.projections) ? item.projections : undefined
  if (projections === undefined) return undefined
  const values = isRecord(projections.values) ? projections.values : undefined
  return values === undefined ? undefined : optionalText(values.title)
}

/** @returns a non-negative safe integer page argument, or undefined. */
function pageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * @param value - a request's event-seq member, or undefined.
 * @returns the seq, or undefined when it is not a positive safe integer.
 */
function seqNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

/**
 * Read one request's page budget.
 *
 * An absent budget is {@link HISTORY_PAGE_BYTES}; a budget an encoded page
 * could never be measured against — zero, fractional, negative or larger than
 * one frame — is refused rather than clamped, so a caller never mistakes a
 * silently reduced page for the one it asked for.
 * @param value - the request's `maxBytes` member, or undefined.
 * @param method - the method name the refusal names.
 */
function pageBudgetOf(value: unknown, method: string): { readonly ok: true; readonly maxBytes: number } | CallFailure {
  if (value === undefined) return { ok: true, maxBytes: HISTORY_PAGE_BYTES }
  const maxBytes = pageNumber(value)
  if (maxBytes === undefined || maxBytes < 1 || maxBytes > MAX_FRAME_BYTES) {
    return refusal(CODE_INVALID_ARGS, `${method} maxBytes must be between 1 and ${MAX_FRAME_BYTES}`)
  }
  return { ok: true, maxBytes }
}

/** The compact roster parameters one listing carried, when it carried any. */
interface RosterCompact {
  /** Rows per page; absent means every row. */
  readonly maxRows?: number
  /** Exclusive cursor: serve the rows after the row this id names. */
  readonly after?: string
  /** Whether each row carries the host's absolute `cwd`. */
  readonly cwd: boolean
}

/**
 * Read one listing's compact roster parameters.
 *
 * The parameters are the switch, not the capability: a listing that names none
 * of them is answered today's body byte for byte, so declaring
 * {@link CAP_ROSTER_COMPACT} alone can never change what a client is sent. The
 * page size reuses {@link pageNumber} and is bounded by the same cap the roster
 * delta window retains ({@link ROSTER_DELTA_MAX_ROWS}), so no second limit is
 * invented here. A value that cannot be honoured — a page size of zero,
 * negative, fractional or past that cap, an `after` that is not an id, a `cwd`
 * that is not a boolean — is refused rather than clamped, so a caller never
 * mistakes a silently reduced page for the one it asked for.
 * @param payload - the request's `p`.
 * @returns the parameters, or `ok` with no `compact` member when there are none.
 */
function rosterCompactOf(payload: Readonly<Record<string, unknown>>): { readonly ok: true; readonly compact?: RosterCompact } | CallFailure {
  const { cwd: rawCwd, maxRows: rawRows, after: rawAfter } = payload
  if (rawCwd === undefined && rawRows === undefined && rawAfter === undefined) return { ok: true }
  if (rawCwd !== undefined && typeof rawCwd !== 'boolean') return refusal(CODE_INVALID_ARGS, 'session.list cwd must be a boolean')
  let maxRows: number | undefined
  if (rawRows !== undefined) {
    maxRows = pageNumber(rawRows)
    if (maxRows === undefined || maxRows < 1 || maxRows > ROSTER_DELTA_MAX_ROWS) {
      return refusal(CODE_INVALID_ARGS, `session.list maxRows must be between 1 and ${ROSTER_DELTA_MAX_ROWS}`)
    }
  }
  const after = rawAfter === undefined ? undefined : optionalText(rawAfter)
  if (rawAfter !== undefined && after === undefined) return refusal(CODE_INVALID_ARGS, 'session.list after must be a non-empty session id')
  return {
    ok: true,
    compact: {
      ...(maxRows === undefined ? {} : { maxRows }),
      ...(after === undefined ? {} : { after }),
      cwd: rawCwd === true,
    },
  }
}

/**
 * Read the capability names a `hello` announced.
 *
 * A capability is an announcement, not a negotiation: an unreadable `cap`, an
 * unknown name and an absent key all leave the connection with no capabilities
 * rather than failing the handshake.
 * @param value - the `cap` member of a hello payload, as it crossed the wire.
 * @returns the declared names, empty when the client declared none.
 */
function capabilitiesOf(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((name): name is string => typeof name === 'string' && name !== ''))
}

/**
 * Validate `question.answer`'s answer batch.
 *
 * The host validates the batch against the questions it actually asked (missing,
 * duplicated or invented ids are the host's own `BAD_ANSWER`), so this only
 * refuses what is not an answer at all: a non-array, an entry that is not an
 * object, an entry without a non-empty id, or `selected` that is not a list of
 * non-empty labels.
 * @param value - the request's `answers` member, or undefined.
 * @returns the batch in protocol vocabulary, or undefined when it is not one.
 */
function answersOf(value: unknown): QuestionAnswerItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const answers: QuestionAnswerItem[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    const id = optionalText(entry.id)
    const selected = entry.selected
    if (id === undefined || !Array.isArray(selected)) return undefined
    if (!selected.every(label => typeof label === 'string' && label !== '')) return undefined
    const custom = optionalText(entry.custom)
    answers.push({ id, selected: selected as string[], ...(custom === undefined ? {} : { custom }) })
  }
  return answers
}

/**
 * One model selection, in the field names the protocol publishes.
 *
 * Exported beside {@link selectionOf} and {@link modelSelectionOf} because the
 * host half resolves a session's current route for `usage.stats`'s neighbour
 * key `usage.session`/`modelContextWindow` with exactly this fold: two readings
 * of "which model is this session on" would let the two methods name different
 * routes for the same session.
 */
export type ModelSelection = {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** @returns the selection this value describes, or undefined when it describes none. */
export function selectionOf(value: unknown): ModelSelection | undefined {
  if (!isRecord(value)) return undefined
  const provider = optionalText(value.provider)
  const model = optionalText(value.model)
  if (provider === undefined || model === undefined) return undefined
  const reasoningEffort = optionalText(value.reasoningEffort)
  return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
}

/**
 * The durable model-selection fold of one `session/projections` answer.
 *
 * Both halves stay optional: a session that never ran has neither, and the
 * catalog default is then the only truthful current value.
 */
export function modelSelectionOf(value: unknown): { readonly next?: ModelSelection; readonly lastUsed?: ModelSelection } {
  if (!isRecord(value) || !isRecord(value.values)) return {}
  const selection = value.values.modelSelection
  if (!isRecord(selection)) return {}
  const next = selectionOf(selection.next)
  const lastUsed = selectionOf(selection.lastUsed)
  return {
    ...(next === undefined ? {} : { next }),
    ...(lastUsed === undefined ? {} : { lastUsed }),
  }
}

/**
 * The effort ids one catalog row offers, for the model a preference names.
 *
 * Read out of the catalog's own `reasoning.efforts`, which is the only list this
 * bridge may validate against: an effort no row advertises is not a level of
 * that model, and answering `ok` for it would store a value the next
 * `selectModel` has to refuse.
 * @param groups - the catalog's `groups`, exactly as the harness published them.
 * @param provider - provider id, matched against a group's own `id`.
 * @param model - model id, matched against a row's own `id`.
 * @returns the ids the model offers, or undefined when no such model exists —
 * a host that never heard of a pair is a different answer from a model that
 * offers no level at all, and the two refusals say so.
 */
function effortIdsOf(groups: unknown, provider: string, model: string): readonly string[] | undefined {
  if (!Array.isArray(groups)) return undefined
  for (const group of groups) {
    if (!isRecord(group) || optionalText(group.id) !== provider || !Array.isArray(group.models)) continue
    for (const row of group.models) {
      if (!isRecord(row) || optionalText(row.id) !== model) continue
      const reasoning = row.reasoning
      if (!isRecord(reasoning) || !Array.isArray(reasoning.efforts)) return []
      return reasoning.efforts
        .map(effort => (isRecord(effort) ? optionalText(effort.id) : undefined))
        .filter((id): id is string => id !== undefined)
    }
  }
  return undefined
}

/**
 * The catalog's groups with this host's remembered level beside every model.
 *
 * A row this table has nothing for crosses UNCHANGED — no `preferredEffort`, not
 * even a null one: the key means "the host remembers a level for this model", and
 * a client that showed a level for a model nobody ever chose would be showing the
 * catalog's default under the wrong name. Every other key, and the order of the
 * rows, stays exactly as the harness wrote it.
 * @param groups - the catalog's `groups`, exactly as the harness published them.
 * @param efforts - the host's preference table.
 * @returns the rows to publish, with the remembered levels injected.
 */
function withPreferredEfforts(groups: unknown, efforts: ModelEffortPreferences): readonly unknown[] {
  if (!Array.isArray(groups)) return []
  return groups.map(group => {
    if (!isRecord(group) || !Array.isArray(group.models)) return group
    const provider = optionalText(group.id)
    if (provider === undefined) return group
    return {
      ...group,
      models: group.models.map(row => {
        if (!isRecord(row)) return row
        const model = optionalText(row.id)
        const preferred = model === undefined ? undefined : efforts.effortOf(provider, model)
        return preferred === undefined ? row : { ...row, preferredEffort: preferred }
      }),
    }
  })
}

/** One prompt attachment, already projected to the harness's image content part. */
type PromptAttachment = Readonly<Record<string, unknown>>

/** The validated attachments of one prompt, or the refusal that withheld it. */
type PromptAttachments = { readonly ok: true; readonly parts: readonly PromptAttachment[] } | CallFailure

/**
 * Validate `session.prompt`'s optional attachments and project them to the
 * harness's image content parts, keeping the order the client sent.
 *
 * The per-attachment budget is checked here rather than at the harness: 6 MiB of
 * base64 per attachment is what keeps a prompt frame inside the envelope's
 * 10 MiB, and the refusal names the attachment and its exact byte count so the
 * phone can say which pick made the send fail. Nothing is truncated and nothing
 * is dropped — one rejected attachment withholds the whole prompt.
 * @param value - the request's `attachments` member, or undefined.
 */
function promptAttachmentsOf(value: unknown): PromptAttachments {
  if (value === undefined) return { ok: true, parts: [] }
  if (!Array.isArray(value)) return refusal(CODE_INVALID_ARGS, 'session.prompt attachments must be an array')
  const parts: PromptAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return refusal(CODE_INVALID_ARGS, 'session.prompt attachments must be objects')
    const name = optionalText(entry.name)
    const label = name === undefined ? `attachment ${parts.length + 1}` : `attachment "${name}"`
    const mediaType = optionalText(entry.mediaType)
    const data = typeof entry.data === 'string' ? entry.data : undefined
    if (mediaType === undefined || data === undefined || data === '') {
      return refusal(CODE_INVALID_ARGS, `session.prompt ${label} requires mediaType and base64 data`)
    }
    const bytes = Buffer.byteLength(data, 'utf8')
    if (bytes > PROMPT_ATTACHMENT_MAX_BYTES) {
      return refusal(
        CODE_INVALID_ARGS,
        `session.prompt ${label} is ${bytes} base64 bytes, past the ${PROMPT_ATTACHMENT_MAX_BYTES} byte limit`,
      )
    }
    parts.push({ type: 'image', mediaType, data, ...(name === undefined ? {} : { name }) })
  }
  return { ok: true, parts }
}

/**
 * Everything one connected device may do.
 *
 * Not thread-safe by construction but safe by awaiting: handlers are invoked
 * one frame at a time by the carrier's reader, and the only background work is
 * a subscription's own drain loop.
 */
/**
 * Monotonic source for {@link BridgeConnection.id}. The counter is process-wide
 * and never reused, so a plugin keying connection-scoped state can trust that a
 * reclaimed id belongs to no later socket.
 */
let connectionSeq = 0

export class BridgeConnection {
  readonly #id = `c${connectionSeq += 1}`
  readonly #options: BridgeConnectionOptions
  readonly #transport: BridgeTransport
  readonly #sequence = new EventSequence()
  readonly #subscriptions = new Map<string, Subscription>()
  readonly #receipts = new Set<string>()
  readonly #toolCalls = new ToolCallIndex()
  readonly #messages = new MessageIndex()
  #capabilities: ReadonlySet<string> = new Set()
  /** Delegated children this connection has learned the durable parent of, by child id. */
  readonly #lineage = new Map<string, string>()
  /**
   * Sessions this connection may read: the ordinary sessions the host's roster
   * names, plus every session this connection already opened. A delegated child
   * belongs here only once it has been opened itself, never because the roster
   * merely names it.
   */
  readonly #authorized = new Set<string>()
  /**
   * The job scopes this connection asked about, by {@link scopeKey}, with the
   * disposer of each watch. A scope is watched exactly while this connection has
   * listed it: that is what keeps a declared capability from turning into a
   * subscription the client never requested.
   */
  readonly #jobWatches = new Map<string, () => void>()
  /**
   * The `updatedAt` this connection already sent per session id, for the
   * compact roster: a row whose value this client holds is answered without it.
   * Pruned to the roster on every compact answer, so it is bounded by the set it
   * describes rather than by every id the connection ever listed.
   */
  readonly #rosterUpdatedAt = new Map<string, number>()
  /** The last roster payload this connection received per scope key, for whole-set dedupe. */
  readonly #jobSeen = new Map<string, string>()
  /**
   * This connection's delta windows, one per set it is served incrementally.
   * Held here so the base is released exactly when the connection is, and so no
   * two connections can ever diff against each other's set.
   */
  readonly #deltas = new RemoteBridgeDeltas()
  #lineageRead = false
  #deviceId: string | undefined
  #nonce: { readonly value: string; readonly expiresAt: number } | undefined
  #heartbeat: NodeJS.Timeout | undefined
  /** The deadline armed by the liveness ping currently outstanding, if any. */
  #liveness: NodeJS.Timeout | undefined
  #lastSendAt = 0
  #disposed = false

  constructor(options: BridgeConnectionOptions, transport: BridgeTransport, auth?: ConnectionAuth) {
    this.#options = options
    this.#transport = transport
    this.#deviceId = auth?.deviceId
    this.#lastSendAt = options.now()
  }

  /** @returns whether this connection has proven a device token (or just enrolled). */
  get paired(): boolean {
    return this.#deviceId !== undefined
  }

  /** @returns the paired device id, or undefined while unpaired. */
  get deviceId(): string | undefined {
    return this.#deviceId
  }

  /** @returns whether the connection has been torn down. */
  get disposed(): boolean {
    return this.#disposed
  }

  /**
   * @returns this connection's identity for the extension seam. Stable for the
   * life of the socket and never reused by a later one.
   */
  get id(): string {
    return this.#id
  }

  /**
   * @param capability - one capability name this protocol defines.
   * @returns whether this connection announced it in `hello`.
   */
  declares(capability: string): boolean {
    return this.#capabilities.has(capability)
  }

  /** Start the idle heartbeat that keeps a quiet phone's socket alive. */
  startHeartbeat(): void {
    if (this.#heartbeat !== undefined) return
    const period = this.#options.heartbeatMs ?? IDLE_PING_MS
    this.#heartbeat = setInterval(() => {
      if (this.#options.now() - this.#lastSendAt < period) return
      this.#send({ t: 'ping', ts: this.#options.now() })
      // The ping is out, so the peer now owes an answer: a peer that went
      // silent without closing its socket is exactly what this deadline finds.
      this.#armLivenessDeadline()
    }, period)
    this.#heartbeat.unref?.()
  }

  /**
   * Handle one received text frame.
   *
   * This method NEVER rejects. Its caller in the mounted wiring is
   * `void connection.handleText(text)`, so a rejection here would be dropped on
   * the floor and the client would wait forever for an answer that is never
   * coming — the same silent stall as a socket nobody reads. Any unexpected
   * failure (a roster write that cannot complete, a carrier that throws) is
   * answered as an `internal` refusal and logged.
   * @param text - the frame body as it crossed the wire.
   */
  async handleText(text: string): Promise<void> {
    if (this.#disposed) return
    // Any frame at all proves the peer is alive, so it satisfies the deadline
    // behind the outstanding ping — a pong that answers no ping included.
    this.#clearLivenessDeadline()
    const outcome = decodeClientFrame(text)
    if (!outcome.ok) {
      this.#send(errorFrame(outcome.id, outcome.code, outcome.msg))
      return
    }
    const frame = outcome.frame
    if (frame.t === 'ping') {
      this.#send({ t: 'pong', ts: frame.ts })
      return
    }
    if (frame.t === 'pong') return
    try {
      const answer = await this.#dispatch(frame)
      if (answer.ok) this.#send(responseFrame(frame.id, answer.r))
      else this.#send(errorFrame(frame.id, answer.code, answer.msg))
    } catch (error) {
      this.#options.log(`${frame.m} failed unexpectedly: ${failureText(error)}`)
      this.#send(errorFrame(frame.id, CODE_INTERNAL, failureText(error)))
    }
  }

  /** Push one event to this connection, advancing its own sequence. */
  emit(topic: string, payload: unknown): boolean {
    return this.#emit(topic, payload)
  }

  /**
   * Tear the connection down: stop the heartbeat, abort every follow stream it
   * owns, and tell the carrier to go away. Idempotent, and safe to call from a
   * socket error handler — a carrier whose socket already closed ignores it.
   * @param close - the close frame to send instead of the bridge-unloading one.
   *   Only the liveness deadline passes it, so a client can tell a peer that
   *   stopped answering from an ordinary teardown; every other caller leaves it
   *   out and keeps the same code and reason as before.
   */
  dispose(close?: { readonly code: number; readonly reason: string }): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#clearLivenessDeadline()
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat)
      this.#heartbeat = undefined
    }
    for (const subscription of this.#subscriptions.values()) subscription.controller.abort()
    this.#subscriptions.clear()
    // A scope nobody left can read must stop costing the host a read per burst.
    for (const dispose of this.#jobWatches.values()) dispose()
    this.#jobWatches.clear()
    this.#jobSeen.clear()
    // A dropped connection's incremental bases are released with it: a token it
    // was given names nothing afterwards, and nothing here outlives its socket.
    this.#deltas.clear()
    // The bridge itself may be unloading with live sockets: the client is told
    // the endpoint is going away instead of being left on a dead protocol.
    this.#transport.close(close?.code ?? 1001, close?.reason ?? 'the bridge is going away')
  }

  /** Arm the deadline behind one liveness ping, replacing any earlier one. */
  #armLivenessDeadline(): void {
    this.#clearLivenessDeadline()
    this.#liveness = setTimeout(() => {
      this.#options.log(`connection closed on the liveness deadline: no frame within ${LIVENESS_TIMEOUT_MS} ms of a liveness ping`)
      this.dispose({
        code: CLOSE_LIVENESS_TIMEOUT,
        reason: `no frame within ${LIVENESS_TIMEOUT_MS} ms of a liveness ping`,
      })
    }, LIVENESS_TIMEOUT_MS)
    this.#liveness.unref?.()
  }

  /** Drop the deadline: the peer answered, or the connection is already gone. */
  #clearLivenessDeadline(): void {
    if (this.#liveness === undefined) return
    clearTimeout(this.#liveness)
    this.#liveness = undefined
  }

  async #dispatch(frame: ReqFrame): Promise<DispatchOutcome> {
    const builtIn = KNOWN_METHODS.has(frame.m)
    // A method no plugin registered is refused here, before the pairing gate, so
    // the answer costs no plugin lookup and names the method the client invented.
    if (!builtIn && this.#options.extensions?.has(frame.m) !== true) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // `question.answer` exists only for a client that asked for the question
    // channel: without the capability it is an unknown method, which is exactly
    // what this frame was before the channel existed.
    if (frame.m === METHOD_QUESTION_ANSWER && !this.declares(CAP_QUESTIONS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // `question.list` is its own channel capability, declared by the client and
    // announced by the bridge: a client that never declared it is told what it was
    // told before the method existed, and no claim registry is read on its behalf.
    if (frame.m === METHOD_QUESTION_LIST && !this.declares(CAP_QUESTION_LIST)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // `jobs.list` is the whole of the job channel: without the capability the
    // method does not exist, and without the method no scope is ever watched, so
    // a client that never declared it can receive no `jobs.changed` either.
    if (frame.m === METHOD_JOBS_LIST && !this.declares(CAP_JOBS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // The agent channel is one capability: without `agents.v1` neither the preset
    // roster nor session creation is part of this client's protocol, so a client
    // that predates them is told what it was told before they existed.
    if ((frame.m === METHOD_PRESETS_LIST || frame.m === METHOD_SESSION_CREATE) && !this.declares(CAP_AGENTS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // Forking one session into another exists only for a client that declared
    // the fork channel: without it the method is what it was before the channel
    // existed, and the host is asked nothing on that client's behalf.
    if (frame.m === METHOD_SESSION_FORK && !this.declares(CAP_SESSION_FORK)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // The command channel is one capability: without `commands.v1` neither the
    // directory nor the dispatch is part of this client's protocol, so no
    // registry and no skill catalog is read on a client's behalf that never
    // asked for either.
    if ((frame.m === METHOD_SESSION_COMMANDS || frame.m === METHOD_SESSION_COMMAND) && !this.declares(CAP_COMMANDS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // Reading workspaces is its own capability, apart from the five writes beside
    // it: a client may ask what this host has and where without ever renaming,
    // pinning or archiving anything, so the reading half is declared on its own
    // and a client that declared only the writing half reads no registry.
    if (frame.m === METHOD_WORKSPACE_LIST && !this.declares(CAP_WORKSPACE)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // The session-admin writes are one capability: without it none of the five is
    // part of this client's protocol, so no title is written and no set is
    // mutated on behalf of a client that predates the channel.
    if (!this.declares(CAP_SESSION_ADMIN)
      && (frame.m === METHOD_SESSION_RENAME
        || frame.m === METHOD_SESSION_PIN
        || frame.m === METHOD_SESSION_UNPIN
        || frame.m === METHOD_SESSION_ARCHIVE
        || frame.m === METHOD_SESSION_UNARCHIVE)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // The squads channel is one capability: without `squads.v1` none of the five
    // commands is part of this client's protocol, so no squad domain is read and
    // no session is launched on behalf of a client that never asked to drive one.
    if (SQUAD_METHODS.has(frame.m) && !this.declares(CAP_SQUADS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // Registering an APNs token is its own capability: without `push.v1` the
    // method does not exist for this client, and no device row is written on its
    // behalf. The capability gates the WRITE only — whether a notification ever
    // leaves this process is a deployment fact the wire cannot express (§28.3).
    if (frame.m === METHOD_PUSH_REGISTER && !this.declares(CAP_PUSH)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // 用量通道是一个能力：不宣告 `usage.v1` 的客户端看到的仍是它从前看到的
    // `unknown-method`，本桥也不会替它折一条会话事件、更不会替它打一次上游
    // 余额端点。
    if (USAGE_METHODS.has(frame.m) && !this.declares(CAP_USAGE)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // 台账聚合是另一个能力，因为它读的是另一个插件挂在这个宿主上的路由：不宣告
    // `usage.stats.v1` 的客户端看不到这个方法，本桥也不会替它去读那两条路由。
    if (frame.m === METHOD_USAGE_STATS && !this.declares(CAP_USAGE_STATS)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // 整页卡是 §35 的一条通道、一个能力：不宣告 `ui.v1` 的客户端看到的仍是它从前
    // 看到的 `unknown-method`，本桥也不会替它把一条动作交给某个工具调用。
    if (frame.m === METHOD_UI_EVENT && !this.declares(CAP_UI)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // 对账读是它自己的能力，与 §24 同一判据：不宣告 `ui.list.v1` 的客户端读不到卡表，
    // 本桥也不会替它翻一遍认领表。
    if (frame.m === METHOD_UI_LIST && !this.declares(CAP_UI_LIST)) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // 第二会合点只在配了它的宿主上存在：没有这个面时这一帧与它出现之前逐字一样是
    // `unknown-method`，名册上也不会为它多出一块授权。
    if (frame.m === METHOD_RELAY_GRANT && this.#options.relay === undefined) {
      return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
    // Unconditional: a loopback Host buys nothing here. Without a device token
    // only the handshake and the two pairing steps run.
    if (!this.paired && !UNPAIRED_METHODS.has(frame.m)) return refusal(CODE_UNPAIRED, 'this connection is not paired')
    // Extension methods run after both gates, so a registered name answers
    // `unpaired` exactly as a protocol method does, and a client that never
    // declared the capability is told the method does not exist rather than
    // that it lacks rights to it.
    if (!builtIn) return await this.#extension(frame)
    switch (frame.m) {
      case METHOD_HELLO: return this.#hello(frame.p)
      case METHOD_PAIR_BEGIN: return this.#pairBegin(frame.p)
      case METHOD_PAIR_FINISH: return await this.#pairFinish(frame.p)
      case METHOD_SESSION_LIST: return await this.#sessionList(frame.p)
      case METHOD_SESSION_TITLES: return this.#sessionTitles(frame.p)
      case METHOD_SESSION_SNAPSHOT: return await this.#sessionSnapshot(frame.p, frame.id)
      case METHOD_SESSION_HISTORY: return await this.#sessionHistory(frame.p, frame.id)
      case METHOD_SESSION_HISTORY_DEEP: return await this.#sessionHistoryDeep(frame.p, frame.id)
      case METHOD_SESSION_PROMPT: return await this.#sessionPrompt(frame.p)
      case METHOD_SESSION_INTERRUPT: return await this.#sessionInterrupt(frame.p)
      case METHOD_SESSION_ATTACHMENT: return await this.#sessionAttachment(frame.p, frame.id)
      case METHOD_SESSION_PERMISSIONS: return this.#sessionPermissions(frame.p)
      case METHOD_SESSION_SET_PERMISSION: return this.#sessionSetPermission(frame.p)
      case METHOD_SESSION_MODELS: return await this.#sessionModels(frame.p)
      case METHOD_SESSION_SET_MODEL: return await this.#sessionSetModel(frame.p)
      case METHOD_SESSION_SET_EFFORT: return await this.#sessionSetEffort(frame.p)
      case METHOD_APPROVAL_RESOLVE: return this.#approvalResolve(frame.p)
      case METHOD_QUESTION_ANSWER: return await this.#questionAnswer(frame.p)
      case METHOD_QUESTION_LIST: return this.#questionList(frame.p)
      case METHOD_UI_EVENT: return this.#uiEvent(frame.p)
      case METHOD_UI_LIST: return this.#uiList(frame.p)
      case METHOD_RELAY_GRANT: return await this.#relayGrant(frame.p)
      case METHOD_PUSH_REGISTER: return await this.#pushRegister(frame.p)
      case METHOD_USAGE_SESSION: return await this.#usageSession(frame.p)
      case METHOD_USAGE_BALANCE: return await this.#usageBalance(frame.p)
      case METHOD_USAGE_STATS: return await this.#usageStats(frame.p)
      case METHOD_JOBS_LIST: return await this.#jobsList(frame.p)
      case METHOD_PRESETS_LIST: return await this.#presetsList()
      case METHOD_SESSION_CREATE: return await this.#sessionCreate(frame.p)
      case METHOD_SESSION_FORK: return await this.#sessionFork(frame.p)
      case METHOD_SESSION_COMMANDS: return await this.#sessionCommands(frame.p)
      case METHOD_SESSION_COMMAND: return await this.#sessionCommand(frame.p)
      case METHOD_SQUADS_STATE: return await this.#squadsState()
      case METHOD_SQUADS_LIST: return await this.#squadsProjection('squads')
      case METHOD_SQUADS_RUNS: return await this.#squadsProjection('runs')
      case METHOD_SQUADS_RUN_MEMBER: return await this.#squadsRunMember(frame.p)
      case METHOD_SQUADS_RUN_SQUAD: return await this.#squadsRunSquad(frame.p)
      case METHOD_WORKSPACE_LIST: return this.#workspaceList()
      case METHOD_SESSION_RENAME: return await this.#sessionRename(frame.p)
      case METHOD_SESSION_PIN: return await this.#sessionSetWrite(METHOD_SESSION_PIN, 'pinSession', frame.p)
      case METHOD_SESSION_UNPIN: return await this.#sessionSetWrite(METHOD_SESSION_UNPIN, 'unpinSession', frame.p)
      case METHOD_SESSION_ARCHIVE: return await this.#sessionArchive(frame.p)
      case METHOD_SESSION_UNARCHIVE: return await this.#sessionSetWrite(METHOD_SESSION_UNARCHIVE, 'unarchiveSession', frame.p)
      default: return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    }
  }

  /**
   * Run one method a plugin registered on the extension seam.
   *
   * The plugin decides everything: whether the payload is usable, what an
   * answer looks like, and which refusal codes exist in its own protocol. This
   * bridge only forwards — and owns `internal`, because a handler that throws
   * or answers nothing usable has left the client with no other honest code.
   * @param frame - the request being served.
   */
  async #extension(frame: ReqFrame): Promise<DispatchOutcome> {
    const handler = this.#options.extensions?.handlerFor(frame.m, capability => this.declares(capability))
    // Reached when the name is registered but this client never declared the
    // capability: the method is not part of its protocol.
    if (handler === undefined) return refusal(CODE_UNKNOWN_METHOD, `unknown method ${frame.m}`)
    try {
      const result = await handler(frame.p, {
        connectionId: this.#id,
        declares: capability => this.declares(capability),
        deltas: this.#deltas,
      })
      if (!isMethodResult(result)) return refusal(CODE_INTERNAL, `${frame.m} answered no result`)
      return result.ok ? { ok: true, r: result.r } : refusal(result.code, result.msg)
    } catch (error) {
      // The plugin's own message is the diagnostic; the client is told the call
      // failed in this bridge because no extension code would be truthful here.
      this.#options.log(`${frame.m} failed: ${failureText(error)}`)
      return refusal(CODE_INTERNAL, failureText(error))
    }
  }

  /**
   * The capabilities this greeting advertises: the protocol's own, and every
   * capability a mounted extension currently requires a client to declare.
   *
   * Computed per greeting rather than held once, because a plugin may register
   * its table after this bridge was built — a name frozen at build time would
   * leave that surface invisible to every phone that ever connects. The
   * protocol's own names come first and keep their order, so a bridge with no
   * extension mounted advertises exactly the list it always did; extension
   * names follow in their registry's order. A name both halves know is listed
   * once.
   * @returns the served capabilities, one name each.
   */
  #servedCapabilities(): string[] {
    const capabilities = [...SERVED_CAPABILITIES]
    // 第二会合点是条件能力：配了它才公告，所以它不在 {@link SERVED_CAPABILITIES}
    // 里（那张表是每条连接逐字相同的开头），而是紧跟其后追加——没配它的宿主因此
    // 仍然答出那张表本身。
    if (this.#options.relay !== undefined) capabilities.push(CAP_RELAY_TIER)
    for (const capability of this.#options.extensions?.capabilities() ?? []) {
      if (!capabilities.includes(capability)) capabilities.push(capability)
    }
    return capabilities
  }

  #hello(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const proto = payload.proto
    if (proto !== PROTO) return refusal(CODE_PROTO_UNSUPPORTED, `this bridge speaks protocol ${PROTO}`)
    this.#capabilities = capabilitiesOf(payload.cap)
    // The frame form is decided where the frame is written, so the carrier is
    // told the one thing it cannot read for itself: what this peer can inflate.
    this.#transport.frameDeflate?.(this.#capabilities.has(CAP_FRAME_DEFLATE))
    // The hub replays anything this client can now receive but missed: a phone
    // that connected after a question was raised has no other way to learn of it.
    this.#options.onDeclare?.(this)
    // 第二会合点的公告。钩子缺省存在与否就是「这台宿主有没有第二个会合点」，因此
    // 没有它、或它此刻答不出地址时，这个键整个不出现——应答与今天逐字相同。
    const relayOrigin = this.#options.relay?.origin()
    return {
      ok: true,
      r: {
        proto: PROTO,
        minor: MINOR,
        server: SERVER_ID,
        capabilities: this.#servedCapabilities(),
        resume: 'snapshot',
        auth: this.paired ? 'paired' : 'unpaired',
        ...(relayOrigin === undefined ? {} : { relay: { origin: relayOrigin } }),
      },
    }
  }

  #pairBegin(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const token = stringArg(payload, 'token')
    if (token === undefined) return refusal(CODE_INVALID_ARGS, 'pair.begin requires token')
    if (!this.#options.pairing.consumeToken(token)) return refusal(CODE_TOKEN_INVALID, 'the bootstrap token is unknown, expired or already used')
    const nonce = this.#options.pairing.issueNonce()
    this.#nonce = { value: nonce.value, expiresAt: nonce.expiresAt }
    return { ok: true, r: { nonce: nonce.value, expiresAt: nonce.expiresAt } }
  }

  async #pairFinish(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const devicePubKey = stringArg(payload, 'devicePubKey')
    const signature = stringArg(payload, 'signature')
    if (devicePubKey === undefined || signature === undefined) {
      return refusal(CODE_INVALID_ARGS, 'pair.finish requires devicePubKey and signature')
    }
    const nonce = this.#nonce
    if (nonce === undefined) return refusal(CODE_NONCE_INVALID, 'this connection has no open pairing')
    // Consume before verifying: a wrong signature burns the challenge instead of
    // leaving it available for another guess.
    this.#nonce = undefined
    if (!this.#options.pairing.consumeNonce(nonce.value) || nonce.expiresAt <= this.#options.now()) {
      return refusal(CODE_NONCE_INVALID, 'the pairing nonce is expired or already used')
    }
    const raw = base64UrlDecode(nonce.value)
    // The design says "the nonce's raw bytes". Both readings of that phrase are
    // accepted — the decoded nonce, and the UTF-8 of the base64url text a client
    // may sign without decoding — because the nonce is one-shot, 60 s, and
    // bound to this connection, so accepting either encoding cannot let an
    // unpaired caller in.
    const signed = raw !== undefined && verifyEs256(devicePubKey, signature, raw)
      ? true
      : verifyEs256(devicePubKey, signature, Buffer.from(nonce.value, 'utf8'))
    if (!signed) return refusal('signature-invalid', 'the ES256 signature does not verify against the device public key')
    const enrollment = await this.#options.roster.enroll(devicePubKey)
    if (enrollment === undefined) return refusal(CODE_INVALID_ARGS, 'devicePubKey is not a P-256 SPKI public key')
    this.#deviceId = enrollment.deviceId
    try {
      this.#options.onDeviceEnrolled?.()
    } catch {
      // Relay lease activation is background work and must never fail pairing.
    }
    return { ok: true, r: { deviceToken: enrollment.deviceToken, deviceId: enrollment.deviceId } }
  }

  /**
   * Answer the roster as a whole set, as one compact page, or as the increment
   * since a token.
   *
   * `since` and the two answer modes exist only for a client that declared
   * {@link CAP_DELTA}: every other client is answered the roster it always was,
   * with `mode:"reset"` and an empty `token` beside it, and this connection
   * keeps no copy of a set that client cannot continue from.
   *
   * The compact form needs both halves: the capability, and at least one compact
   * parameter in the request. Either one alone is today's answer, which is what
   * keeps an older client — and a client that declared the name but asks for
   * nothing — byte identical to protocol v1.
   * @param payload - `{since?, cwd?, maxRows?, after?}`.
   */
  async #sessionList(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    if (this.declares(CAP_ROSTER_COMPACT)) {
      const requested = rosterCompactOf(payload)
      if (!requested.ok) return requested
      const compact = requested.compact
      if (compact !== undefined) {
        // One answer is a whole page a client continues with `after`, the other
        // is an increment it continues with `token`; a request naming both bases
        // is refused rather than answered against one of them silently.
        if (sinceOf(payload) !== undefined) {
          return refusal(CODE_INVALID_ARGS, 'session.list cannot combine a compact page with a since token')
        }
        const compactRoster = await this.#readRoster()
        if (!compactRoster.ok) return compactRoster
        return { ok: true, r: this.#compactRoster(compactRoster.rows, compact) }
      }
    }
    const roster = await this.#readRoster()
    if (!roster.ok) return roster
    if (!this.declares(CAP_DELTA)) {
      this.#deltas.drop('session.list')
      return { ok: true, r: { mode: 'reset', token: '', sessions: roster.rows } }
    }
    const answer = this.#deltas
      .window<SessionRow>('session.list', { maxRows: ROSTER_DELTA_MAX_ROWS })
      .answer(roster.rows, sinceOf(payload))
    return {
      ok: true,
      r: answer.mode === 'reset'
        ? { mode: 'reset', token: answer.token, sessions: answer.rows }
        : { mode: 'delta', token: answer.token, changed: answer.changed, removed: answer.removed },
    }
  }

  /**
   * Read the roster once, as the host answers it.
   *
   * Deliberately separate from {@link #sessionList}: lineage and authorization
   * are learned from the same read, and an internal read must not consume or
   * advance this connection's incremental base.
   */
  async #readRoster(): Promise<{ readonly ok: true; readonly rows: SessionRow[] } | CallFailure> {
    const call = await this.#unary('session', 'list')
    if (!call.ok) return call
    const items = isRecord(call.value) ? call.value.items : undefined
    if (!Array.isArray(items)) return refusal(CODE_INTERNAL, 'session/list returned no item table')
    // Read once for the whole roster: the archive flag comes from one process-wide
    // set, and an unreadable registry leaves the key out of every row — and drops
    // nothing, because a bridge that cannot tell must not answer a shorter roster.
    // A row that survives therefore always carries `archived: false`: the key stays
    // in the schema even though no `true` crosses it any more.
    const archived = this.#options.sessionMeta.archiveSet()
    const sessions: SessionRow[] = []
    for (const item of items) {
      if (!isRecord(item) || typeof item.sessionId !== 'string') continue
      // An archived session is not part of the roster this connection is sent at
      // all: the phone hides such a row on arrival, so sending it is bytes paid
      // for nothing. Skipped before the row is built, so no field of it is read.
      // A live child keeps its own row, and with it the parent id that row names,
      // so an archived parent never costs a child its lineage; the follow gate
      // does notice, because that parent is no longer a session the roster names.
      if (archived?.has(item.sessionId) === true) continue
      const cwd = optionalText(item.cwd)
      const parentSessionId = optionalText(item.parentSessionId)
      sessions.push({
        id: item.sessionId,
        // The row's own title. `SessionSummary` has no top-level `title`, but the
        // projection block beside it does — `projections.values.title` — and the
        // host answers that synchronously for a cold session too, which is the
        // field its own desktop list renders. The live-title cache is the
        // fallback for a row whose projection carries none, and no lookup is
        // spent here, so listing stays one call either way.
        title: projectedTitleOf(item) ?? this.#options.sessionMeta.cachedTitle(item.sessionId) ?? '',
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        agentRunning: item.running === true,
        ...(cwd === undefined ? {} : { cwd }),
        ...(parentSessionId === undefined ? {} : { parentSessionId }),
        ...(item.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        blank: item.blank === true,
        ...(archived === undefined ? {} : { archived: archived.has(item.sessionId) }),
      })
    }
    // A listed roster is also the cheapest place to learn lineage: a delegated
    // child's durable parent is on its own row, so a client that lists before it
    // opens a session never costs a second read to address that session.
    this.#rememberLineage(sessions)
    // The workspace short name a notification carries is picked up from a roster
    // this bridge just served, because the alternative is a gateway read on the
    // notification path. Best effort by construction: a session never listed
    // simply produces a payload without `w`.
    this.#options.push?.noteSessions(sessions)
    // The same roster answers how many sessions are running, which is what a card
    // reports; the call returns before any delivery starts, so listing pays no
    // APNs round trip.
    this.#options.liveActivity?.noteRoster(sessions)
    return { ok: true, rows: sessions }
  }

  /**
   * Answer one compact roster page out of the roster just read.
   *
   * Rows are ordered most recent first, with the id as the tiebreak, because a
   * cursor is only meaningful over an order that does not depend on the order
   * the host happened to answer in. `after` is exclusive and names the last row
   * the previous page carried; a cursor this roster no longer names is an
   * unknown base and answers a first page again, the way a delta token this
   * window never issued answers a reset, so the client continues from the page
   * it is given instead of stalling on an id that no longer exists.
   *
   * Three members are what makes the body shorter: `cwd` is present only when
   * the request asked for it, `updatedAt` only when this connection has not
   * already sent this id that exact value (a client keeps the one it holds), and
   * `nextAfter` only while the roster continues past this page. Every other
   * field of the row is today's, under today's names, so a page is the same
   * roster cut short rather than a second schema — and `compact:true` says which
   * schema the rows are in, so a client whose bookkeeping drifted can tell an
   * omitted `updatedAt` from one this bridge never had.
   * @param rows - the roster as the host answered it.
   * @param compact - the parameters this listing carried.
   */
  #compactRoster(rows: readonly SessionRow[], compact: RosterCompact): Record<string, unknown> {
    const ordered = [...rows].sort((left, right) => (right.updatedAt - left.updatedAt)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    // A cursor that names no row of this roster resolves to -1, which is a first
    // page: the honest answer to a base this bridge cannot place.
    const from = compact.after === undefined ? 0 : ordered.findIndex(row => row.id === compact.after) + 1
    const end = compact.maxRows === undefined ? ordered.length : Math.min(ordered.length, from + compact.maxRows)
    const page = ordered.slice(from, end)
    const sessions = page.map(row => {
      const held = this.#rosterUpdatedAt.get(row.id) === row.updatedAt
      this.#rosterUpdatedAt.set(row.id, row.updatedAt)
      return {
        id: row.id,
        title: row.title,
        ...(held ? {} : { updatedAt: row.updatedAt }),
        agentRunning: row.agentRunning,
        ...(compact.cwd && row.cwd !== undefined ? { cwd: row.cwd } : {}),
        ...(row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId }),
        ...(row.origin === undefined ? {} : { origin: row.origin }),
        blank: row.blank,
        ...(row.archived === undefined ? {} : { archived: row.archived }),
      }
    })
    // Bounded by the set it describes: an id this roster no longer names is gone
    // from the memory too, and a row that comes back simply carries its value.
    const current = new Set(rows.map(row => row.id))
    for (const id of this.#rosterUpdatedAt.keys()) {
      if (!current.has(id)) this.#rosterUpdatedAt.delete(id)
    }
    const last = page[page.length - 1]?.id
    return {
      mode: 'reset',
      token: '',
      compact: true,
      sessions,
      ...(last === undefined || end >= ordered.length ? {} : { nextAfter: last }),
    }
  }

  /**
   * Answer a batch of title lookups out of this process's title service.
   *
   * Every read is synchronous and in-process, so the batch bound is the whole
   * cost bound: nothing here awaits, opens a follow stream or touches
   * persistence. A session that is not live here, one whose title has not
   * landed yet, and a host without the title service all answer `""` — the
   * batch never fails for one id, and never fails because a service is absent.
   * @param payload - `{ids}`: one to {@link TITLES_MAX_IDS} session ids.
   */
  #sessionTitles(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const ids = payload.ids
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > TITLES_MAX_IDS) {
      return refusal(CODE_INVALID_ARGS, `session.titles requires 1 to ${TITLES_MAX_IDS} session ids`)
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') return refusal(CODE_INVALID_ARGS, 'session.titles requires non-empty string ids')
    }
    // The ids are chosen by the client, so the answer map is built on a null
    // prototype: a literal id like `__proto__` has to become a real key.
    const titles = Object.create(null) as Record<string, string>
    for (const id of ids) titles[id] = this.#options.sessionMeta.title(id)
    return { ok: true, r: { titles } }
  }

  /**
   * Answer `session.snapshot`: the opening window, or one page of it.
   *
   * A client that declared {@link CAP_SESSION_SNAPSHOT_PAGE} gets the newest
   * page inside `maxBytes` (default {@link HISTORY_PAGE_BYTES}) instead of the
   * whole window, so an opening screen costs one page. The page is cut by the
   * same entry-level slice `session.history` uses, so the two can never
   * disagree, an entry larger than the whole budget is a page of its own rather
   * than a refusal, and `snapshot-too-large` cannot answer such a connection.
   * The oldest entry's own `seq` is the `before` cursor for the next, older
   * page; no second field restates it.
   *
   * The budget is measured on the WHOLE answer — `{turns, lastSeq, hasMore}`
   * encoded as the `res` frame the client receives — and never per turn, so a
   * turn of many small entries is cut like any other run of entries. What it
   * does not bound is a single entry: `pageTurns` ends a page at an entry, never
   * inside one, so when the newest entry alone is past the budget that entry IS
   * the page and the answer is exactly as large as it is (measured: a 2.2 MB
   * newest message answers a 2.2 MB page against a 512 KiB budget, while the
   * same window of ordinary entries answers 513794 bytes). Trimming or splitting
   * such an entry would hand the client something other than what the session
   * says, and refusing it would take the session away from the very capability
   * that exists to open big sessions, so this is a stated bound of the page
   * budget rather than a defect to be closed by a smaller number elsewhere.
   * A client that declared {@link CAP_SESSION_SNAPSHOT_SINCE} and named
   * `sinceSeq` is answered incrementally instead: only the entries above that
   * durable watermark, in the same turn shape, with `mode:"since"` and
   * `reset:false`. When the bridge cannot PROVE the chain is unbroken — the
   * window's oldest entry has scrolled past the watermark — the answer is the
   * baseline below, carrying `mode:"full"` and `reset:true` so the client knows
   * to throw its copy away. Nothing else about this method moves: a request
   * without `sinceSeq`, or from a connection that never declared the capability,
   * is answered exactly the bytes protocol v1 answered before.
   * @param payload - `{sessionId, sinceSeq?, maxBytes?}`.
   * @param id - the request id the page budget is measured against.
   */
  async #sessionSnapshot(payload: Readonly<Record<string, unknown>>, id: number): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.snapshot requires sessionId')
    const unfollowable = await this.#unfollowable(sessionId)
    if (unfollowable !== undefined) return refusal(CODE_SESSION_NOT_FOLLOWABLE, unfollowable)
    const opening = await this.#openingForBaseline(sessionId)
    if (!opening.ok) return refusal(opening.code, `session ${sessionId} produced no opening frame (${opening.msg})`)
    // A client that declared the trim capability chooses what it is sent, never
    // which turns it gets: the projection is trimmed inside each turn first, and
    // only then does any frame or page budget apply.
    const window = turnsOfRecords(opening.baseline.records)
    const projection = this.#trimmedFor(window)
    const lastSeq = opening.baseline.cursor
    // An incremental answer takes two declarations: the capability in the
    // handshake AND the watermark in this request. Every other request keeps
    // protocol v1's own answer, byte for byte, so a client can adopt the name
    // before it relies on any of it.
    if (payload.sinceSeq !== undefined && this.#capabilities.has(CAP_SESSION_SNAPSHOT_SINCE)) {
      const sinceSeq = pageNumber(payload.sinceSeq)
      if (sinceSeq === undefined) return refusal(CODE_INVALID_ARGS, 'session.snapshot sinceSeq must be a non-negative integer')
      // A connection that declared the page capability declared the budget its
      // requests must carry, and an incremental request is one of its requests:
      // an unusable budget is refused here, so whether this reply ends up being
      // the increment or the baseline that spends the budget never decides it.
      if (this.#capabilities.has(CAP_SESSION_SNAPSHOT_PAGE)) {
        const budget = pageBudgetOf(payload.maxBytes, METHOD_SESSION_SNAPSHOT)
        if (!budget.ok) return budget
      }
      const incremental = this.#sinceAnswer(projection, window, sinceSeq, lastSeq, id)
      if (incremental !== undefined) return { ok: true, r: incremental }
      const baseline = this.#baselineAnswer(sessionId, projection, lastSeq, payload, id)
      if (!baseline.ok) return baseline
      return { ok: true, r: { ...baseline.r, mode: 'full', reset: true } }
    }
    return this.#baselineAnswer(sessionId, projection, lastSeq, payload, id)
  }

  /**
   * The answer protocol v1 has always served: the whole window, or the newest
   * page of it for a connection that declared {@link CAP_SESSION_SNAPSHOT_PAGE}.
   *
   * One home for that answer, so an incremental request that has to fall back to
   * a full baseline is sent exactly the bytes it would have been sent without
   * asking — plus the two fields that say the client must reset.
   * @param sessionId - the session this baseline is of; the refusal names it.
   * @param projection - this connection's projection of the opening window.
   * @param lastSeq - the harness cursor the answer reports.
   * @param payload - the request, read only for `maxBytes`.
   * @param id - the request id any page budget is measured against.
   */
  #baselineAnswer(
    sessionId: string,
    projection: readonly SnapshotTurn[],
    lastSeq: number,
    payload: Readonly<Record<string, unknown>>,
    id: number,
  ): BaselineAnswer {
    if (!this.#capabilities.has(CAP_SESSION_SNAPSHOT_PAGE)) {
      // Not declared: the whole window, shrunk by whole turns, unchanged.
      const fitted = this.#fitTurns(projection, lastSeq, id)
      if (fitted === undefined) return refusal(CODE_SNAPSHOT_TOO_LARGE, `session ${sessionId} does not fit one ${MAX_FRAME_BYTES} byte frame`)
      return { ok: true, r: { turns: fitted.turns, lastSeq: fitted.lastSeq } }
    }
    const budget = pageBudgetOf(payload.maxBytes, METHOD_SESSION_SNAPSHOT)
    if (!budget.ok) return budget
    const page = pageTurns(projection, undefined, budget.maxBytes, (turns, _nextBefore, hasMore) =>
      Buffer.byteLength(JSON.stringify(responseFrame(id, { turns, lastSeq, hasMore })), 'utf8'))
    return { ok: true, r: { turns: page.turns, lastSeq, hasMore: page.hasMore } }
  }

  /**
   * Answer a snapshot that named a watermark, or hand back undefined when this
   * request has to be answered with the full baseline instead.
   *
   * The continuity proof is the whole contract, and it reads the WINDOW rather
   * than the trimmed projection: an entry the client never renders is still an
   * entry the window holds, and continuing past a watermark below it would hand
   * the client a view it cannot attach to what it already has. Only the window's
   * own oldest entry can say whether anything between that watermark and this
   * window is missing, and `oldest <= sinceSeq + 1` is the one case where nothing
   * is; an empty window proves it trivially, because there is nothing to lose. A
   * reset is always correct, so an unprovable window takes the safe answer.
   *
   * The bound this form still carries is the frame cap: a delta that cannot
   * cross one frame answers the baseline instead of a refusal, because the
   * client's recovery from a hole is the `reset` flag, not a failed request.
   * @param projection - the projection the incremental turns are cut from.
   * @param window - the same window before trimming, read for its oldest entry.
   * @param sinceSeq - the durable watermark the client already holds.
   * @param lastSeq - the harness cursor the answer reports.
   * @param id - the request id the frame cap is measured against.
   */
  #sinceAnswer(
    projection: readonly SnapshotTurn[],
    window: readonly SnapshotTurn[],
    sinceSeq: number,
    lastSeq: number,
    id: number,
  ): { readonly turns: readonly SnapshotTurn[]; readonly lastSeq: number; readonly mode: 'since'; readonly reset: false } | undefined {
    const oldest = oldestEntrySeq(window)
    if (oldest !== undefined && oldest > sinceSeq + 1) return undefined
    const answer = { turns: turnsAbove(projection, sinceSeq), lastSeq, mode: 'since' as const, reset: false as const }
    if (Buffer.byteLength(JSON.stringify(responseFrame(id, answer)), 'utf8') > MAX_FRAME_BYTES) return undefined
    return answer
  }

  /**
   * Read one backwards page of a session's history.
   *
   * Pages are cut from the very baseline `session.snapshot` serves, so the two
   * can never disagree about a turn or an entry; this method only slices that
   * projection, by entry, from the newest entry below the caller's watermark. It
   * is a pure read of the baseline: it never drops, replaces or re-addresses the
   * subscription, and the same cursor always answers the same page.
   * @param payload - `{sessionId, before?, maxBytes?}`.
   * @param id - the request id the page budget is measured against.
   */
  async #sessionHistory(payload: Readonly<Record<string, unknown>>, id: number): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.history requires sessionId')
    const before = payload.before === undefined ? undefined : pageNumber(payload.before)
    if (payload.before !== undefined && before === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.history before must be a non-negative integer')
    }
    const budget = pageBudgetOf(payload.maxBytes, METHOD_SESSION_HISTORY)
    if (!budget.ok) return budget
    const unfollowable = await this.#unfollowable(sessionId)
    if (unfollowable !== undefined) return refusal(CODE_SESSION_NOT_FOLLOWABLE, unfollowable)
    const opening = await this.#openingForBaseline(sessionId)
    if (!opening.ok) return refusal(opening.code, `session ${sessionId} produced no opening frame (${opening.msg})`)
    const page = pageTurns(this.#projectionOf(opening.baseline.records), before, budget.maxBytes, (turns, nextBefore, hasMore) =>
      Buffer.byteLength(JSON.stringify(responseFrame(id, { turns, ...(nextBefore === undefined ? {} : { nextBefore }), hasMore })), 'utf8'))
    return {
      ok: true,
      r: {
        turns: page.turns,
        ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
        hasMore: page.hasMore,
      },
    }
  }

  /**
   * Read one backwards page of a session's DURABLE history.
   *
   * `session.history` slices the follow window this connection holds, and that
   * window is only as wide as the harness was asked to open it (200 messages), so
   * a client that scrolls past it has no older page to ask for. This method reads
   * the session store itself: one `session/page` call walked backwards with
   * `beforeSeq`, with no follow stream and no window involved.
   *
   * It is a pure read in the same sense `session.history` is: nothing is
   * subscribed, remembered, dropped or re-addressed, so the same `before`
   * answers the same page and reading cannot change what the session is.
   * @param payload - `{sessionId, before?, maxBytes?}`.
   * @param id - the request id the page budget is measured against.
   */
  async #sessionHistoryDeep(payload: Readonly<Record<string, unknown>>, id: number): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.history.deep requires sessionId')
    const before = payload.before === undefined ? undefined : pageNumber(payload.before)
    if (payload.before !== undefined && before === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.history.deep before must be a non-negative integer')
    }
    const budget = pageBudgetOf(payload.maxBytes, METHOD_SESSION_HISTORY_DEEP)
    if (!budget.ok) return budget
    // The same fence every other history read passes, and it runs before any
    // store call: a child this connection may not read costs no read at all.
    const unfollowable = await this.#unfollowable(sessionId)
    if (unfollowable !== undefined) return refusal(CODE_SESSION_NOT_FOLLOWABLE, unfollowable)
    const cut = await this.#durableCutOf(sessionId)
    if (!cut.ok) return cut
    const store = await this.#storePageOf(sessionId, cut.cut, before)
    if (!store.ok) return store
    const projection = turnsOfRecords(store.records)
    const oldestOf = (turns: readonly SnapshotTurn[]): number | undefined => turns[0]?.entries[0]?.seq
    const page = pageTurns(projection, before, budget.maxBytes, (turns, nextBefore, hasMore) => {
      // The measured frame is the ANSWER, not the store read: a store page that
      // ends short of the session's oldest entry still leaves older entries
      // behind the answer, and the cursor is the answer's own oldest entry.
      const more = hasMore || store.hasMore
      const cursor = more ? nextBefore ?? oldestOf(turns) : undefined
      return Buffer.byteLength(JSON.stringify(responseFrame(id, {
        turns,
        ...(cursor === undefined ? {} : { nextBefore: cursor }),
        hasMore: more,
      })), 'utf8')
    })
    if (page.turns.length === 0) return { ok: true, r: { turns: [], hasMore: false } }
    const hasMore = page.hasMore || store.hasMore
    const nextBefore = page.nextBefore ?? oldestOf(page.turns)
    return {
      ok: true,
      r: {
        turns: page.turns,
        ...(hasMore && nextBefore !== undefined ? { nextBefore } : {}),
        hasMore,
      },
    }
  }

  /**
   * The inclusive log cut one durable page read names.
   *
   * `session/page` takes that cut as `throughSeq` and refuses one the store does
   * not hold, so a page read has to name a seq the session actually has. The
   * projection watermark is that seq: the cut every finished projection value has
   * folded through, read from the non-activating projection service
   * `session.models` already uses. `-1` is the harness's own name for a log with
   * no events at all, and the store answers it with an empty page.
   */
  async #durableCutOf(sessionId: string): Promise<{ readonly ok: true; readonly cut: number } | CallFailure> {
    const call = await this.#unary('session', 'projections', { sessionId })
    if (!call.ok) return call
    const cut = isRecord(call.value) ? call.value.asOfSeq : undefined
    if (typeof cut !== 'number' || !Number.isSafeInteger(cut) || cut < -1) {
      return refusal(CODE_SNAPSHOT_UNAVAILABLE, `session ${sessionId} reported no durable cut to page from`)
    }
    return { ok: true, cut }
  }

  /**
   * Read one span of a session's durable history, at the address the harness demands.
   *
   * A delegated child is addressable only through its durable parent, and the
   * harness answers `session/agent-busy` when it is asked as an ordinary session.
   * That refusal is the one signal that distinguishes it from a real failure, so
   * it is the only one that triggers the roster lookup and the retry — the same
   * resolution {@link #openSubscription} performs for the follow stream.
   */
  async #storePageOf(sessionId: string, cut: number, before: number | undefined): Promise<{ readonly ok: true; readonly records: readonly unknown[]; readonly hasMore: boolean } | CallFailure> {
    let call = await this.#pageCall(this.#addressOf(sessionId), cut, before)
    if (!call.ok && call.code === CODE_SUBAGENT_ADDRESS_REQUIRED) {
      const parent = await this.#parentOf(sessionId)
      if (parent === undefined) return call
      this.#lineage.set(sessionId, parent)
      call = await this.#pageCall(subagentAddress(parent, sessionId), cut, before)
    }
    if (!call.ok) return call
    const value = call.value
    const records = isRecord(value) && Array.isArray(value.records) ? value.records as readonly unknown[] : undefined
    if (records === undefined) return refusal(CODE_INTERNAL, 'session/page answered no records')
    return { ok: true, records, hasMore: isRecord(value) && value.hasMore === true }
  }

  /** One `session/page` call at one resolved address. */
  async #pageCall(address: SessionAddress, cut: number, before: number | undefined) {
    return await this.#unary('session', 'page', {
      address,
      throughSeq: cut,
      ...(before === undefined ? {} : { beforeSeq: before }),
      ...DEEP_HISTORY_WINDOW,
    })
  }

  /** The projection a baseline is served with: trimmed only for a client that asked for it. */
  #projectionOf(records: readonly unknown[]): readonly SnapshotTurn[] {
    return this.#trimmedFor(turnsOfRecords(records))
  }

  /** Drop the bookkeeping entries only for a client that declared the trim capability. */
  #trimmedFor(turns: readonly SnapshotTurn[]): readonly SnapshotTurn[] {
    return this.#capabilities.has(CAP_SESSION_SNAPSHOT_TRIM) ? trimUnrenderedEntries(turns) : turns
  }

  async #sessionPrompt(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const text = stringArg(payload, 'text')
    const requestId = stringArg(payload, 'requestId')
    if (sessionId === undefined || text === undefined || requestId === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.prompt requires sessionId, text and requestId')
    }
    // Attachments are settled before the receipt is read and before anything is
    // sent: one rejected attachment withholds the whole prompt, so the harness is
    // not even subscribed to, let alone prompted.
    const attachments = promptAttachmentsOf(payload.attachments)
    if (!attachments.ok) return attachments
    const receipt = `${sessionId}\u0000${requestId}`
    if (this.#receipts.has(receipt)) return { ok: true, r: { accepted: true } }
    // A session the phone prompts is the phone's own work, which is the one thing that
    // makes its turn end announceable at all: the host's own subagent sessions are
    // dropped by the quiet gate unless they were prompted from here (§28/§29). The
    // fact is what the wire carried, not what the host accepted.
    this.#options.turnEndQuiet?.notePhonePrompt(sessionId)
    // A client may prompt without snapshotting first; the subscription is what
    // makes its own deltas reachable.
    this.#ensureSubscription(sessionId)
    const timeZone = this.#options.clientTimeZone()
    const call = await this.#unary('session', 'prompt', {
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }, ...attachments.parts],
      ...(timeZone === undefined || timeZone === '' ? {} : { clientTimeZone: timeZone }),
    })
    if (!call.ok) return call
    this.#rememberReceipt(receipt)
    return { ok: true, r: { accepted: true } }
  }

  async #sessionInterrupt(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.interrupt requires sessionId')
    // The subscription deliberately outlives this: cancelling a turn is not
    // unsubscribing from the session.
    const call = await this.#unary('session', 'cancel', { sessionId })
    if (!call.ok) return call
    return { ok: true, r: { ok: true } }
  }

  /**
   * Answer `session.attachment`: one durable image's bytes, straight from the
   * harness.
   *
   * The bridge keeps no cache — an image can be offloaded after the fact, so
   * every read goes to the session it belongs to — and it refuses rather than
   * writing a frame past the envelope budget: an attachment that cannot cross at
   * all is reported as such, never as an absent attachment.
   * @param payload - `{sessionId, attachmentId}`.
   * @param id - the request id the frame budget is measured against.
   */
  async #sessionAttachment(payload: Readonly<Record<string, unknown>>, id: number): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const attachmentId = stringArg(payload, 'attachmentId')
    if (sessionId === undefined || attachmentId === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.attachment requires sessionId and attachmentId')
    }
    const call = await this.#unary('session', 'attachment', { sessionId, attachmentId })
    if (!call.ok) return call
    if (!isRecord(call.value)) return refusal(CODE_INTERNAL, 'session/attachment returned no attachment')
    const bytes = Buffer.byteLength(JSON.stringify(responseFrame(id, call.value)), 'utf8')
    if (bytes > MAX_FRAME_BYTES) {
      return refusal(FRAME_TOO_LARGE, `attachment ${attachmentId} needs ${bytes} bytes, past the ${MAX_FRAME_BYTES} byte frame`)
    }
    return { ok: true, r: call.value }
  }

  /** Answer `session.permissions` out of the host's own preset service. */
  #sessionPermissions(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.permissions requires sessionId')
    const answer = this.#options.permissions.describe(sessionId)
    return 'code' in answer ? refusal(answer.code, answer.msg) : { ok: true, r: answer }
  }

  /**
   * Switch one session's permission mode.
   *
   * This is the session-level persistent mode, deliberately apart from
   * `approval.resolve`: that answers one tool question once, this changes what
   * every later turn runs under.
   */
  #sessionSetPermission(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const sessionId = stringArg(payload, 'sessionId')
    const id = stringArg(payload, 'id')
    if (sessionId === undefined || id === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.setPermission requires sessionId and id')
    }
    const answer = this.#options.permissions.set(sessionId, id)
    return 'code' in answer ? refusal(answer.code, answer.msg) : { ok: true, r: { ok: true, current: answer.current } }
  }

  /**
   * Answer `session.models`: the host's catalog plus this session's selection.
   *
   * `current` is the session's FOLD — next, else last used, else the catalog
   * default — and never the default on its own: a phone that showed the default
   * while another model was in force would name the wrong model for the next
   * turn. The catalog's failures and default cross unchanged, and every row
   * carries this host's remembered level as `preferredEffort` when it has one:
   * that key is the table's, deliberately not the row's own
   * `reasoning.defaultEffort`, which stays the catalog's property.
   * @param payload - `{sessionId}`.
   */
  async #sessionModels(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.models requires sessionId')
    const catalog = await this.#unary('session', 'modelCatalog')
    if (!catalog.ok) return catalog
    if (!isRecord(catalog.value)) return refusal(CODE_INTERNAL, 'session/modelCatalog returned no catalog')
    const folded = await this.#sessionCurrent(sessionId, catalog.value)
    if (!folded.ok) return folded
    await this.#options.modelEfforts.load()
    return {
      ok: true,
      r: {
        current: folded.current,
        default: folded.fallback,
        groups: withPreferredEfforts(catalog.value.groups, this.#options.modelEfforts),
        failures: catalog.value.failures ?? [],
      },
    }
  }

  /**
   * The selection one session folds to: the pending next choice, else the last
   * one used, else the catalog default.
   *
   * One fold shared by `session.models`, `session.setModel` and
   * `session.setEffort`, so no two of them can name a different model for the
   * same session.
   * @param sessionId - the session whose projection is read.
   * @param catalog - the catalog the fold falls back into.
   */
  async #sessionCurrent(
    sessionId: string,
    catalog: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly ok: true; readonly current: ModelSelection; readonly fallback: ModelSelection } | CallFailure> {
    const fallback = selectionOf(catalog.default)
    if (fallback === undefined) return refusal(CODE_INTERNAL, 'session/modelCatalog returned no default model')
    const projections = await this.#unary('session', 'projections', { sessionId })
    if (!projections.ok) return projections
    const folded = modelSelectionOf(projections.value)
    return { ok: true, current: folded.next ?? folded.lastUsed ?? fallback, fallback }
  }

  /**
   * Answer `session.setModel`: register the next turn's selection.
   *
   * The harness only records the choice for the NEXT request, so the answer
   * echoes the `selected` selection it accepted and nothing here claims the
   * running turn changed.
   *
   * A request with no effort of its own is answered with the level this host
   * remembers for that model: a phone that picked "high" for a model once means
   * it on the next switch too, and sending nothing would silently reset the
   * model to the harness's own default. A model this table has nothing for is
   * sent exactly as before — no `reasoningEffort` key at all. The remembered
   * level is proven against the catalog first; see {@link #rememberedEffort}.
   * @param payload - `{sessionId, provider, model, effort?}`.
   */
  async #sessionSetModel(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const provider = stringArg(payload, 'provider')
    const model = stringArg(payload, 'model')
    if (sessionId === undefined || provider === undefined || model === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.setModel requires sessionId, provider and model')
    }
    await this.#options.modelEfforts.load()
    const named = optionalText(payload.effort)
    const effort = named ?? await this.#rememberedEffort(provider, model)
    const call = await this.#unary('session', 'selectModel', {
      sessionId,
      provider,
      model,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    })
    if (!call.ok) return call
    const selected = isRecord(call.value) ? selectionOf(call.value.selected) : undefined
    if (selected === undefined) return refusal(CODE_INTERNAL, 'session/selectModel returned no selected model')
    return { ok: true, r: { ok: true, current: selected } }
  }

  /**
   * The level this host remembers for one model, proven against the catalog.
   *
   * A remembered level is a fact about the past: the harness can change a model's
   * offered ladder under it, and sending a level the model no longer publishes
   * makes `selectModel` refuse — which leaves that model unswitchable, with the
   * slider (which only writes the session's current model) unable to heal it. So
   * the backfill asks the catalog first and withholds a level the model does not
   * offer, dropping the stale row on the way: one catalog read for the stale
   * switch, then the row is gone and the next switch costs nothing.
   * @param provider - provider id.
   * @param model - model id.
   * @returns the level to send, or undefined when there is none this host can prove.
   */
  async #rememberedEffort(provider: string, model: string): Promise<string | undefined> {
    const remembered = this.#options.modelEfforts.effortOf(provider, model)
    if (remembered === undefined) return undefined
    const catalog = await this.#unary('session', 'modelCatalog')
    // A catalog this call cannot read is not evidence the level went stale: the
    // stored value crosses exactly as it did before this check existed.
    if (!catalog.ok || !isRecord(catalog.value)) return remembered
    const offered = effortIdsOf(catalog.value.groups, provider, model)
    // A model this answer leaves out is NOT evidence its level went stale: a
    // provider that failed to enumerate this time is reported under the catalog's
    // own `failures`, and one transient absence must never erase a level the user
    // set. The level is withheld for this switch and the row is kept. Only a model
    // that IS published, with a ladder that does not contain this level, is a
    // level no selection can ever accept.
    if (offered === undefined) return undefined
    if (offered.includes(remembered)) return remembered
    await this.#options.modelEfforts.forget(provider, model, remembered, `the catalog no longer offers it: ${offered.join(', ') || 'no levels'}`)
      .catch((error: unknown) => {
        this.#options.log(`could not drop the stale remembered effort for ${provider}/${model}: ${failureText(error)}`)
      })
    return undefined
  }

  /**
   * Answer `session.setEffort`: remember one model's reasoning level.
   *
   * The table is the host's — keyed by provider and model, shared by every
   * session — so this writes a PREFERENCE and switches no model. The harness is
   * asked for a selection only when the pair is already this session's folded
   * choice, where the new level has to reach the next turn; for any other model
   * `session/selectModel` is never called and the answer echoes the fold
   * unchanged. A model the catalog does not publish, and a level that model does
   * not offer, are refused as `invalid-args` before anything is written.
   * @param payload - `{sessionId, provider, model, effort}`.
   */
  async #sessionSetEffort(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const provider = stringArg(payload, 'provider')
    const model = stringArg(payload, 'model')
    const effort = stringArg(payload, 'effort')
    if (sessionId === undefined || provider === undefined || model === undefined || effort === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.setEffort requires sessionId, provider, model and effort')
    }
    // Read before any write: the table is rewritten whole, so a save must never
    // overwrite rows this process has not read yet.
    await this.#options.modelEfforts.load()
    const catalog = await this.#unary('session', 'modelCatalog')
    if (!catalog.ok) return catalog
    if (!isRecord(catalog.value)) return refusal(CODE_INTERNAL, 'session/modelCatalog returned no catalog')
    const offered = effortIdsOf(catalog.value.groups, provider, model)
    if (offered === undefined) {
      return refusal(CODE_INVALID_ARGS, `session.setEffort: this host publishes no model ${provider}/${model}`)
    }
    if (!offered.includes(effort)) {
      return refusal(CODE_INVALID_ARGS, `session.setEffort: ${effort} is not a reasoning effort of ${provider}/${model}`)
    }
    const folded = await this.#sessionCurrent(sessionId, catalog.value)
    if (!folded.ok) return folded
    await this.#options.modelEfforts.save(provider, model, effort)
    const saved = { provider, model, effort }
    if (folded.current.provider !== provider || folded.current.model !== model) {
      return { ok: true, r: { ok: true, saved, current: folded.current } }
    }
    const call = await this.#unary('session', 'selectModel', { sessionId, provider, model, reasoningEffort: effort })
    if (!call.ok) return call
    const selected = isRecord(call.value) ? selectionOf(call.value.selected) : undefined
    if (selected === undefined) return refusal(CODE_INTERNAL, 'session/selectModel returned no selected model')
    return { ok: true, r: { ok: true, saved, current: selected } }
  }

  /**
   * Answer `presets.list`: the host's Agent-preset roster, forwarded verbatim.
   *
   * The bridge has no vocabulary of its own for a preset — a row is whatever
   * `agentPresets/list` publishes, and that endpoint takes no request — so the
   * answer crosses exactly as the host wrote it, down to the keys a client of
   * this version does not read.
   */
  async #presetsList(): Promise<DispatchOutcome> {
    const call = await this.#unary('agentPresets', 'list')
    return call.ok ? { ok: true, r: call.value } : call
  }

  /**
   * Answer `session.create`: hand the client's request to the host unchanged.
   *
   * A preset instantiated as an Agent is a host decision about a body this
   * bridge does not model — the field names, the defaults and the refusals
   * belong to `SessionCreateRequest` and to the host that validates it — so the
   * payload and the answer cross verbatim. Nothing is required here, renamed, or
   * defaulted: a request the host rejects is rejected with the host's own code
   * and text.
   * @param request - the host's `SessionCreateRequest`, exactly as the client wrote it.
   */
  async #sessionCreate(request: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const call = await this.#unary('session', 'create', request)
    return call.ok ? { ok: true, r: call.value } : call
  }

  /**
   * Answer `session.fork`: branch one session into another that inherits it.
   *
   * Only the two keys protocol v1 names are read here. `sessionId` is required
   * and `atSeq` is the host's inclusive source-event cut, so a caller that
   * omitted it must not have one invented for it: the host reads an absent
   * `atSeq` as the newest finished turn, and a zero or a fractional number is
   * not a seq at all, which is refused here rather than forwarded for the host
   * to reject with a shape this bridge could have caught. Everything else —
   * whether this host forks at all, what the new session is called, which
   * synthetic events close an open cut — belongs to `session/fork`, so a host
   * refusal crosses with its own code and text.
   * @param payload - `{sessionId, atSeq?}`.
   */
  async #sessionFork(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.fork requires sessionId')
    const atSeq = payload.atSeq === undefined ? undefined : seqNumber(payload.atSeq)
    if (payload.atSeq !== undefined && atSeq === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.fork atSeq must be a positive integer')
    }
    const call = await this.#unary('session', 'fork', {
      sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
    })
    return call.ok ? { ok: true, r: call.value } : call
  }

  /**
   * Answer `squads.state`: the host's squad domain as this deployment publishes
   * it.
   *
   * The read is the `dsh-agents` plugin's own `{teams, runs, host, presets?}`
   * document — reached over loopback, or read out of its ledger when loopback
   * cannot answer — mapped onto the frozen body: a definition keeps its identity,
   * its pins and its members, a run names the squad it belongs to, and both lose
   * the bookkeeping fields this channel does not publish. A body this build cannot
   * read is refused rather than repaired, and a host that serves no domain answers
   * `squads-unavailable` instead of an empty board.
   */
  async #squadsState(): Promise<DispatchOutcome> {
    const read = await this.#squadState()
    return read.ok ? { ok: true, r: read.state } : read
  }

  /**
   * Answer `squads.list` or `squads.runs`: one half of the same read.
   *
   * Both commands read the domain once, exactly as `squads.state` does, and
   * publish the half they are named after. There is no second source: a squad
   * listing and a run listing can never disagree about a definition a launch
   * touched, because both are cut from one answer.
   * @param half - the body key this command publishes.
   */
  async #squadsProjection(half: 'squads' | 'runs'): Promise<DispatchOutcome> {
    const read = await this.#squadState()
    if (!read.ok) return read
    return { ok: true, r: { [half]: read.state[half] } }
  }

  /**
   * Read the squad domain once.
   *
   * The transport answers the plugin's rows unread and this bridge maps them
   * here, so the ledger fallback and the loopback route are the same answer as far
   * as a client can tell.
   */
  async #squadState(): Promise<{ readonly ok: true; readonly state: SquadsState } | CallFailure> {
    const transport = this.#options.squads
    if (transport === undefined) {
      return refusal(CODE_SQUADS_UNAVAILABLE, 'this host serves no dsh-agents squad domain')
    }
    try {
      return { ok: true, state: squadsStateOf(await transport.state()) }
    } catch (error) {
      return this.#squadFailure(error)
    }
  }

  /**
   * Answer `squads.runMember`: launch one member session.
   *
   * Only the two names the command needs are read here. Which preset, permission,
   * model and brief that session is composed from is the definition's own, and
   * whether this host can launch at all is the transport's: an unknown squad or
   * member, an unusable preset and a squad that pins no workspace all cross as the
   * plugin's own code.
   * @param payload - `{squadId, memberId, firstMessage?}`.
   */
  async #squadsRunMember(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const transport = this.#options.squads
    if (transport === undefined) {
      return refusal(CODE_SQUADS_UNAVAILABLE, 'this host serves no dsh-agents squad domain')
    }
    const request = parseSquadMemberRun(payload)
    if (request === undefined) return refusal(CODE_INVALID_ARGS, 'squads.runMember requires squadId and memberId')
    try {
      return { ok: true, r: { run: squadRunOf(await transport.runMember(request)) } }
    } catch (error) {
      return this.#squadFailure(error)
    }
  }

  /**
   * Answer `squads.runSquad`: launch the Lead session of one whole squad.
   *
   * The goal travels as the plugin's own `goal` — it becomes part of the Lead's
   * system-prompt context rather than its first user message — so nothing about
   * what the squad must achieve is modelled here.
   * @param payload - `{squadId, goal?}`.
   */
  async #squadsRunSquad(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const transport = this.#options.squads
    if (transport === undefined) {
      return refusal(CODE_SQUADS_UNAVAILABLE, 'this host serves no dsh-agents squad domain')
    }
    const request = parseSquadRun(payload)
    if (request === undefined) return refusal(CODE_INVALID_ARGS, 'squads.runSquad requires squadId')
    try {
      return { ok: true, r: { run: squadRunOf(await transport.runSquad(request)) } }
    } catch (error) {
      return this.#squadFailure(error)
    }
  }

  /**
   * Convert whatever the squad transport raised into a refusal that names a code.
   *
   * A refusal the transport built keeps its own code — that is how a domain
   * refusal and this bridge's two capability codes stay distinguishable. Anything
   * else is a host failure this channel could not attribute, and it is refused as
   * an unreachable domain rather than as an internal error: no squad answer was
   * read, which is exactly what `squads-unavailable` says.
   */
  #squadFailure(error: unknown): CallFailure {
    if (isSquadRefusal(error)) return refusal(error.code, error.message)
    this.#options.log(`squad domain read failed: ${failureText(error)}`)
    return refusal(CODE_SQUADS_UNAVAILABLE, failureText(error))
  }

  /**
   * Answer `workspace.list`: the host's workspaces and its two global sets.
   *
   * A pure in-process read: `list()` answers a fresh array in registry order and
   * both sets are synchronous getters, so nothing here awaits, subscribes or
   * touches persistence, and a write this bridge forwarded a moment ago is
   * visible to the very next call. Nothing is sorted — the registry's own order
   * is the display order — and no row carries a workspace's `sessionIds`: the
   * roster already carries every session's `cwd`, a client groups for itself, and
   * that account would make one frame grow with the session count.
   *
   * A host that composes no registry is refused rather than answered with an
   * empty list: an empty list says "this host has no workspaces", which is a
   * different sentence from "there is nothing here to ask".
   */
  #workspaceList(): DispatchOutcome {
    const listed = this.#options.sessionMeta.workspaceList()
    if (listed === undefined) return refusal(CODE_INTERNAL, 'this host composes no workspaceRegistry service')
    return { ok: true, r: listed }
  }

  /**
   * Answer `session.rename`: forward one `SessionRenameRequest` and hand back
   * the host's own `SessionRenameValue`.
   *
   * The write goes through the gateway — `session/rename`, never the title
   * service this process holds — because that endpoint restores a cold session
   * before it writes, so a client needs no resume path of its own. The title is
   * required and is text: an empty string is not a name anyone could have meant,
   * and it is refused here instead of being written. Everything after that is
   * the host's: the normalized title, the durable seq that committed it, and a
   * refusal such as `session/not-found` cross verbatim.
   * @param payload - `{sessionId, title}`.
   */
  async #sessionRename(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const title = stringArg(payload, 'title')
    if (sessionId === undefined || title === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.rename requires sessionId and title')
    }
    const call = await this.#unary('session', 'rename', { sessionId, title })
    return call.ok ? { ok: true, r: call.value } : call
  }

  /**
   * Forward one registry set mutation and answer `{ok:true}`.
   *
   * Three of the five session-admin writes are the same call under a different
   * endpoint name, so they share one body: `{sessionId}` in, one decided answer
   * out. Nothing is branched on — pin, unpin and unarchive take no second
   * argument to branch on — and the host's own set answer
   * (`WorkspacePinValue` / `WorkspaceArchiveValue`) is deliberately not
   * republished: a client that wants the new set reads `workspace.list`, the one
   * read that serves both. An archive's optional `stopActivity` is
   * `#sessionArchive`'s own concern.
   * @param method - the protocol method being answered, named in the refusal.
   * @param endpoint - the `workspace` registry method behind it.
   * @param payload - `{sessionId}`.
   */
  async #sessionSetWrite(method: string, endpoint: string, payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, `${method} requires sessionId`)
    const call = await this.#unary('workspace', endpoint, { sessionId })
    return call.ok ? { ok: true, r: { ok: true } } : call
  }

  /**
   * Answer `session.archive`, whose request may ask the host to stop the
   * session's running work first.
   *
   * `stopActivity` is the host's own choice and only a boolean may cross: sent
   * without it, a session that is still running is refused by the host as
   * `workspace/session-active`; sent as `true`, the archive is written and that
   * work is stopped. Archiving is a session-level act — it never touches the
   * workspace the session belongs to — and the archived session keeps its slot,
   * so `session.unarchive` puts it back where it was. None of that is modelled
   * here.
   * @param payload - `{sessionId, stopActivity?}`.
   */
  async #sessionArchive(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.archive requires sessionId')
    const stopActivity = payload.stopActivity
    if (stopActivity !== undefined && typeof stopActivity !== 'boolean') {
      return refusal(CODE_INVALID_ARGS, 'session.archive stopActivity must be a boolean when present')
    }
    const call = await this.#unary('workspace', 'archiveSession', { sessionId, ...(stopActivity === undefined ? {} : { stopActivity }) })
    return call.ok ? { ok: true, r: { ok: true } } : call
  }

  /**
   * Answer `session.commands`: one session's slash commands and skills, in one
   * directory.
   *
   * Both catalogs are read live and neither is modelled here: `commands/list`
   * is the host registry's own effective view for this Agent — a command
   * registered through an Agent-scoped child shadows the global one — and
   * `skills/list` is the catalog this session's cwd and preset select, so what
   * a phone lists is what the desktop composer would offer that same session. A
   * row crosses with the name and the summary the host publishes for it, plus
   * the whole draft line that invokes it, separator space included.
   *
   * Nothing is paged, re-sorted or cached: every command first, every skill
   * after, each in the host's own order, and the next call reads both again.
   * @param payload - `{sessionId}`.
   */
  async #sessionCommands(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'session.commands requires sessionId')
    const commands = await this.#unary('commands', 'list', { agentId: sessionId })
    if (!commands.ok) return this.#commandsFailure('commands', 'list', commands)
    if (!Array.isArray(commands.value)) return refusal(CODE_INTERNAL, 'commands/list returned no command directory')
    const skills = await this.#unary('skills', 'list', { sessionId })
    if (!skills.ok) return this.#commandsFailure('skills', 'list', skills)
    if (!isRecord(skills.value) || !Array.isArray(skills.value.skills)) {
      return refusal(CODE_INTERNAL, 'skills/list returned no skill catalog')
    }
    return { ok: true, r: { sessionId, items: commandItems(commands.value, skills.value.skills) } }
  }

  /**
   * Answer `session.command`: run one draft line on the host and report whether
   * the host resolved it.
   *
   * The line crosses exactly as the client wrote it, because what a line means
   * belongs to the host: its parser decides whether the text is a slash command
   * at all, and its registry decides whether that name is one this Agent has. A
   * line the host resolves runs — this method does not pre-judge a command,
   * replay one, or refuse a line it does not recognise — and the answer is then
   * `matched: true`. A line the host resolves to nothing (no leading slash, an
   * unknown name, or a skill's `/name` gesture, which is prompt text rather than
   * a registry entry) answers `matched: false`, and nothing ran.
   *
   * A plain invocation carries no attachments: a draft line has none, the
   * endpoint requires the key, so an empty array is what crosses.
   * @param payload - `{sessionId, line}`.
   */
  async #sessionCommand(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const line = stringArg(payload, 'line')
    if (sessionId === undefined || line === undefined) {
      return refusal(CODE_INVALID_ARGS, 'session.command requires sessionId and line')
    }
    const call = await this.#unary('commands', 'execute', { agentId: sessionId, line, submittedAttachments: [] })
    if (!call.ok) return this.#commandsFailure('commands', 'execute', call)
    return { ok: true, r: { matched: call.value !== undefined } }
  }

  /**
   * Re-answer one command-channel failure.
   *
   * An endpoint this host does not serve at all is this bridge's own
   * `commands-unavailable`, so a phone stops offering the directory instead of
   * showing a call that fails every time; a call the host refused, and a channel
   * that is merely still activating, cross with the failure's own code and text.
   * @param namespace - the Remote namespace that failed.
   * @param method - the endpoint that failed.
   * @param failure - the refusal `#unary` produced.
   */
  #commandsFailure(namespace: string, method: string, failure: CallFailure): CallFailure {
    if (!commandsUnavailable(failure.code)) return failure
    return refusal(CODE_COMMANDS_UNAVAILABLE, `this host serves no ${namespace}/${method} endpoint`)
  }

  #approvalResolve(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const id = stringArg(payload, 'id')
    const decision = payload.decision
    if (id === undefined || (decision !== 'allowed-once' && decision !== 'rejected')) {
      return refusal(CODE_INVALID_ARGS, 'approval.resolve requires id and decision of allowed-once or rejected')
    }
    if (!this.#options.approvals.resolve(id, decision)) {
      return refusal(CODE_APPROVAL_UNKNOWN, 'the question is unknown, already answered or expired')
    }
    return { ok: true, r: { ok: true } }
  }

  /**
   * Answer one pending user question.
   *
   * The claim decides how the answer travels: an open question settles the
   * host's own ask, a continued one is steered into the agent through the
   * host's Remote `answer`. A call id this bridge does not hold is refused
   * rather than forwarded, and a host failure crosses with its own code.
   * @param payload - `{sessionId, callId, answers}`.
   */
  async #questionAnswer(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    const callId = stringArg(payload, 'callId')
    const answers = answersOf(payload.answers)
    if (sessionId === undefined || callId === undefined || answers === undefined) {
      return refusal(CODE_INVALID_ARGS, 'question.answer requires sessionId, callId and answers of {id, selected, custom?}')
    }
    const reply = await this.#options.questions.answer(sessionId, callId, { answers })
    return reply.ok ? { ok: true, r: { ok: true } } : refusal(reply.code, reply.msg)
  }

  /**
   * Answer one `question.list`: the questions this bridge is still holding.
   *
   * A pure read — it claims nothing, moves no deadline, triggers no `continued`
   * and writes no host state — because its whole purpose is to let a client that
   * was disconnected reconcile cards it already holds: a question missing from
   * this list is one nobody can answer any more, since the bridge withdraws every
   * claim when the last paired device leaves and the phone is not there to hear
   * it.
   *
   * Only a COMPLETE list may retire a card on the client, so a registry this
   * bridge cannot read answers `question-list-unavailable` rather than an empty
   * list: an unreadable set is not an empty one.
   * @param payload - must be the empty object: the held set is global, not scoped.
   */
  #questionList(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    if (Object.keys(payload).length > 0) {
      return refusal(CODE_INVALID_ARGS, 'question.list takes no arguments')
    }
    let questions: readonly ListedQuestion[]
    try {
      questions = this.#options.questions.listed()
    } catch (error) {
      this.#options.log(`question.list could not read the held questions: ${failureText(error)}`)
      return refusal(CODE_QUESTION_LIST_UNAVAILABLE, 'this bridge could not read the questions it is holding')
    }
    const answer: QuestionListPayload = { questions, complete: true }
    return { ok: true, r: answer }
  }

  /**
   * Answer one `ui.event`: the first action a user took inside a presented page
   * (§35.3).
   *
   * The event is carried and never interpreted — `type` is the presenter's own
   * closed set, so this bridge does not validate its value, refuse an unknown one
   * or rewrite it. A card this bridge never claimed, or one that was settled
   * elsewhere, is refused `ui-unknown`; a card whose own first event already
   * settled it is refused `ui-settled`, because a repeated tap and a nonexistent
   * card are two different answers. The payload is measured here rather than on the
   * client: a refusal on that side would leave the agent waiting for a card that
   * will never settle (§35.2's rule, one channel over).
   * @param payload - `{sessionId, callId, event:{type, payload?}}`.
   */
  #uiEvent(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    const sessionId = stringArg(payload, 'sessionId')
    const callId = stringArg(payload, 'callId')
    const event = uiEventOf(payload.event)
    if (sessionId === undefined || callId === undefined || event === undefined) {
      return refusal(CODE_INVALID_ARGS, 'ui.event requires sessionId, callId and event of {type, payload?}')
    }
    if (!uiEventFits(event)) return refusal(CODE_INVALID_ARGS, 'ui.event payload is over the 8 KiB cap')
    const reply = this.#options.ui.settle(sessionId, callId, event)
    return reply.ok ? { ok: true, r: { ok: true } } : refusal(reply.code, reply.msg)
  }

  /**
   * Answer one `ui.list`: the cards this bridge is still holding (§35.4).
   *
   * A pure read — it claims nothing, moves no deadline, triggers no settlement and
   * writes no host state — because its whole purpose is to let a client that was
   * disconnected reconcile the cards it already holds. `settled` never appears in
   * it: the list's definition is "still held", and a settled card is a notice the
   * host already sent, not a row.
   *
   * Only a COMPLETE list may retire a card on the client, so a registry this bridge
   * cannot read answers `ui-list-unavailable` rather than an empty list: an
   * unreadable set is not an empty one.
   * @param payload - must be the empty object: the held set is global, not scoped.
   */
  #uiList(payload: Readonly<Record<string, unknown>>): DispatchOutcome {
    if (Object.keys(payload).length > 0) {
      return refusal(CODE_INVALID_ARGS, 'ui.list takes no arguments')
    }
    let cards: readonly ListedCard[]
    try {
      cards = this.#options.ui.listed()
    } catch (error) {
      this.#options.log(`ui.list could not read the held cards: ${failureText(error)}`)
      return refusal(CODE_UI_LIST_UNAVAILABLE, 'this bridge could not read the cards it is holding')
    }
    const answer: UiListPayload = { cards, complete: true }
    return { ok: true, r: answer }
  }

  /**
   * The body of `push.register` (protocol §28.3).
   *
   * A write, and the only one this channel has: the device's APNs registration
   * lands in its own row of the roster file, beside the identity it already
   * proved, so revoking the device revokes its notifications with it and no
   * second identity or second table exists.
   *
   * The answer is `{ok:true}` and nothing else. There is deliberately no echo of
   * the token and no "ready" flag: this bridge cannot know whether APNs will
   * accept the token, and a field claiming it did would be a lie a client might
   * render. A bridge with no signing key answers identically — a client has no
   * second code path for that difference.
   * @param payload - `{deviceToken, environment, bundle, liveActivityTokens?, locale?, relayToken?}`.
   */
  async #pushRegister(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const deviceToken = payload.deviceToken
    const environment = payload.environment
    const bundle = payload.bundle
    if (typeof deviceToken !== 'string' || deviceToken === '' || !/^[0-9a-fA-F]+$/.test(deviceToken)) {
      return refusal(CODE_INVALID_ARGS, 'deviceToken must be the hex string APNs handed the app')
    }
    if (environment !== 'sandbox' && environment !== 'production') {
      return refusal(CODE_INVALID_ARGS, 'environment must be "sandbox" or "production"')
    }
    if (typeof bundle !== 'string' || bundle === '') return refusal(CODE_INVALID_ARGS, 'bundle must be a non-empty string')
    const locale = optionalText(payload.locale)
    // The relay credential (§28 over the hosted service). Optional and opaque: the
    // bridge never mints, parses or reissues it — it is the App's, scoped to this
    // pairing's fingerprint, and this row is the only place it is kept.
    const relayToken = payload.relayToken
    if (relayToken !== undefined && (typeof relayToken !== 'string' || relayToken === '')) {
      return refusal(CODE_INVALID_ARGS, 'relayToken must be the non-empty string the account service issued')
    }
    let liveActivityTokens: readonly PushLiveActivityToken[] | undefined
    if (payload.liveActivityTokens !== undefined) {
      const raw = payload.liveActivityTokens
      if (!Array.isArray(raw)) return refusal(CODE_INVALID_ARGS, 'liveActivityTokens must be an array')
      const collected: PushLiveActivityToken[] = []
      for (const entry of raw) {
        if (!isRecord(entry)) return refusal(CODE_INVALID_ARGS, 'each liveActivityTokens entry needs an activityId and a token')
        const activityId = entry.activityId
        const token = entry.token
        if (typeof activityId !== 'string' || activityId === '' || typeof token !== 'string' || token === '') {
          return refusal(CODE_INVALID_ARGS, 'each liveActivityTokens entry needs an activityId and a token')
        }
        // §29.9: a card names the session it belongs to. The key is optional —
        // a client that omits it is registered exactly as before — but a value
        // that is present has to be a session id, because a card carrying a
        // malformed address would be pushed to nobody while looking registered.
        const sessionId = entry.sessionId
        if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId === '')) {
          return refusal(CODE_INVALID_ARGS, 'a liveActivityTokens sessionId must be a non-empty string')
        }
        collected.push({ activityId, token, ...(sessionId === undefined ? {} : { sessionId }) })
      }
      liveActivityTokens = collected
    }
    const deviceId = this.#deviceId
    if (deviceId === undefined) return refusal(CODE_UNPAIRED, 'this connection is not paired')
    const registration: PushRegistration = {
      deviceToken,
      environment: environment as PushEnvironment,
      bundle,
      ...(locale === undefined ? {} : { locale }),
      ...(liveActivityTokens === undefined ? {} : { liveActivityTokens }),
      ...(relayToken === undefined ? {} : { relayToken }),
      registeredAt: this.#options.now(),
    }
    try {
      const stored = await this.#options.roster.registerPush(deviceId, registration)
      if (!stored) return refusal(CODE_INTERNAL, 'this connection names no paired device')
      // The roster is the only place a standing watcher is armed from: the
      // session a card names gets a follow stream of this bridge's own, and it
      // keeps it until the last token for that session is gone.
      try {
        this.#options.onPushRegistered?.()
      } catch (error) {
        this.#options.log(`standing watchers could not be reconciled: ${failureText(error)}`)
      }
    } catch (error) {
      // Registration failing has to reach the client: it decides whether to
      // retry, and a token that never reached the disk is a device that will
      // never be notified.
      return refusal(CODE_INTERNAL, `could not write the device roster: ${failureText(error)}`)
    }
    return { ok: true, r: { ok: true } }
  }

  /**
   * The body of `relay.grant`: one device hands its relay tier grant over.
   *
   * A write, and the only one this channel has. The grant lands in the sending
   * device's own roster row (schema 4), beside the identity it already proved, so
   * revoking the device withdraws the admission with it and no second table exists.
   * The host then asks the second meeting point to refresh its lease, and that ask
   * is fired rather than awaited: a phone hands a fresh grant over precisely when a
   * claim was just refused, and this frame must not hang on a meeting point that
   * stopped answering. The roster row is what the next claim reads, so the ask
   * never depends on this answer reaching the client first.
   *
   * The answer is `{ok:true}` and nothing else. There is deliberately no echo, no
   * tier and no "admitted" flag: the tier is decided out of band by the meeting
   * point, this bridge never learns it, and a field claiming one would be a lie the
   * client might render.
   * @param payload - `{grant}`.
   */
  async #relayGrant(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const relay = this.#options.relay
    // Unreachable through the dispatcher (the gate above refuses first), and kept
    // because this handler reads its own precondition rather than trusting it.
    if (relay === undefined) return refusal(CODE_UNKNOWN_METHOD, `unknown method ${METHOD_RELAY_GRANT}`)
    const grant = payload.grant
    if (typeof grant !== 'string' || grant === '') {
      return refusal(CODE_INVALID_ARGS, 'grant must be the string the account service issued')
    }
    const deviceId = this.#deviceId
    if (deviceId === undefined) return refusal(CODE_UNPAIRED, 'this connection is not paired')
    try {
      const stored = await this.#options.roster.setRelayGrant(deviceId, grant)
      if (!stored) return refusal(CODE_INTERNAL, 'this connection names no paired device')
      try {
        relay.grantLanded()
      } catch (error) {
        // The re-claim is this bridge's own background work and may never turn a
        // grant the roster already holds into a failure of this frame.
        this.#options.log(`the second meeting point could not re-claim: ${failureText(error)}`)
      }
    } catch (error) {
      // A grant that never reached the disk is an admission the host does not
      // have, so the client has to be told instead of assuming it landed.
      return refusal(CODE_INTERNAL, `could not write the device roster: ${failureText(error)}`)
    }
    return { ok: true, r: { ok: true } }
  }

  /**
   * 答一次 `usage.session`：一条会话的上下文窗口与下一次请求的组成估算。
   *
   * 两个读数各有自己的来源，也各有自己的缺席方式：`contextWindow` 只在宿主
   * 广播过 `request/context` 时出现，`composition` 只在观察到任何原文时出现，
   * 两项都没有就是空对象。会话本身不存在是另一种情况，回的是
   * `unknown-session`，而不是一个读不到任何东西的空对象；而「存在」由活会话
   * 存储、本进程观察到的事件与宿主名册三处中任意一处证明（见 `core/usage.ts`）。
   * @param payload - `{sessionId}`。
   */
  async #usageSession(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const sessionId = stringArg(payload, 'sessionId')
    if (sessionId === undefined) return refusal(CODE_INVALID_ARGS, 'usage.session requires sessionId')
    const answer = await this.#options.usage.session(sessionId)
    if (answer === undefined) return refusal(CODE_UNKNOWN_SESSION, `session ${sessionId} does not exist on this host`)
    return { ok: true, r: answer }
  }

  /**
   * 答一次 `usage.balance`：某条 provider 路由背后账户的余额。
   *
   * 判定与缓存全在 `core/usage.ts`：不是官方路由、不指向官方 origin、凭据拿
   * 不到，都不发上游请求，各自的理由按 `unsupported` 的三种取值过线。这里
   * 只转发，因为余额是账户的事实，本连接既不改写也不补默认值。
   * @param payload - `{provider}`。
   */
  async #usageBalance(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const provider = stringArg(payload, 'provider')
    if (provider === undefined) return refusal(CODE_INVALID_ARGS, 'usage.balance requires provider')
    return { ok: true, r: await this.#options.usage.balance(provider) }
  }

  /**
   * 答一次 `usage.stats`：宿主自己那份按天记的 token 台账的聚合。
   *
   * `days` 省略按 14，超出 60 按 60 收——收窗口的是 `core/usage-stats.ts`，不是
   * 协议：客户端给的天数只是「想看多深」，不该被当成一次分配。这里只拒绝根本
   * 不是数字的那种值，其余一律转发，包括读不到时那份 `unsupported`，
   * 因为「这台 Mac 没挂那个插件」不是一次失败。
   * @param payload - `{days?}`。
   */
  async #usageStats(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const days = payload.days
    if (days !== undefined && (typeof days !== 'number' || !Number.isFinite(days))) {
      return refusal(CODE_INVALID_ARGS, 'usage.stats requires days to be a number')
    }
    return { ok: true, r: await this.#options.usage.stats(days) }
  }

  /**
   * Answer one `jobs.list` and start watching that scope.
   *
   * The scope is the host registry's own: naming a session reads that session's
   * fenced set (its own jobs plus every unowned one), naming none reads the
   * unowned set. Neither is a global list, and this method never assembles one —
   * a cross-session view would be a second source of truth the host does not
   * have, and it would have to aggregate N fenced reads to fake it.
   *
   * Answering is also what subscribes: every later change of this scope arrives
   * as `jobs.changed` carrying the same payload, and a scope that was never
   * listed is never watched.
   * @param payload - `{}` for the unowned scope, or `{sessionId}` for one session's.
   */
  async #jobsList(payload: Readonly<Record<string, unknown>>): Promise<DispatchOutcome> {
    const raw = payload.sessionId
    if (raw !== undefined && (typeof raw !== 'string' || raw === '')) {
      return refusal(CODE_INVALID_ARGS, 'jobs.list sessionId must be a non-empty string when present')
    }
    const sessionId = raw
    if (sessionId !== undefined) {
      // A job row names its owner and carries its label, so this read is fenced
      // by the same rule as following the session it belongs to: a delegated
      // child whose parent this connection may not read is not addressable here.
      const unfollowable = await this.#unfollowable(sessionId)
      if (unfollowable !== undefined) return refusal(CODE_SESSION_NOT_FOLLOWABLE, unfollowable)
    }
    const roster = this.#options.jobs.read(sessionId)
    if (roster === undefined) {
      return refusal(CODE_JOBS_UNAVAILABLE, 'this host composes no background job registry')
    }
    this.#watchJobs(sessionId, roster)
    return { ok: true, r: roster }
  }

  /**
   * Watch one job scope for this connection, once.
   *
   * The scope's first payload is the answer the client just received, so it is
   * seeded as already seen: a change frame only ever carries a set that differs
   * from the last one this connection was handed.
   */
  #watchJobs(sessionId: string | undefined, payload: JobsPayload): void {
    const key = scopeKey(sessionId)
    this.#jobSeen.set(key, JSON.stringify(payload.jobs))
    if (this.#jobWatches.has(key)) return
    const dispose = this.#options.jobs.watch(sessionId, (changed) => {
      if (!this.declares(CAP_JOBS)) return
      const encoded = JSON.stringify(changed.jobs)
      if (this.#jobSeen.get(key) === encoded) return
      this.#jobSeen.set(key, encoded)
      this.#emit(TOPIC_JOBS_CHANGED, changed)
    })
    if (dispose !== undefined) this.#jobWatches.set(key, dispose)
  }

  /**
   * Run one unary Remote call with the activation retry, converting a gateway
   * failure into a refusal that carries the gateway's own code.
   */
  async #unary(namespace: string, method: string, request: Readonly<Record<string, unknown>> = {}): Promise<{ readonly ok: true; readonly value: unknown } | CallFailure> {
    try {
      const value = await withServiceUnavailableRetry(() => this.#options.gateway.invoke({
        namespace,
        method,
        args: wireArgs(namespace, method, request),
        peer: this.#options.ownerPeer,
      }))
      return { ok: true, value }
    } catch (error) {
      this.#options.log(`${namespace}/${method} failed: ${failureText(error)}`)
      return refusal(errorCodeOf(error, CODE_INTERNAL), failureText(error))
    }
  }

  #ensureSubscription(sessionId: string): Subscription {
    const existing = this.#subscriptions.get(sessionId)
    if (existing !== undefined) return existing
    const subscription: Subscription = {
      sessionId,
      controller: new AbortController(),
      address: this.#addressOf(sessionId),
      advanced: false,
      // Resolved without ever rejecting: a caller may subscribe without awaiting
      // the opening frame (`session.prompt` does exactly that), and an unobserved
      // rejection would take the whole host process down under node's default
      // `--unhandled-rejections=throw`.
      opened: Promise.resolve({ ok: false, code: CODE_SNAPSHOT_UNAVAILABLE, msg: 'the stream was not opened' }),
    }
    subscription.opened = this.#openSubscription(subscription)
    this.#subscriptions.set(sessionId, subscription)
    return subscription
  }

  /** The durable address of one session, as far as this connection has learned it. */
  #addressOf(sessionId: string): SessionAddress {
    const parent = this.#lineage.get(sessionId)
    return parent === undefined ? sessionAddress(sessionId) : subagentAddress(parent, sessionId)
  }

  /**
   * Remember the durable parent of every delegated child a roster carried, and
   * which sessions that same roster authorizes this connection to read.
   *
   * A child is not authorized by being named: authorizing it on its own row
   * would let one refused read teach the connection to follow it on the retry.
   */
  #rememberLineage(rows: readonly SessionRow[]): void {
    for (const row of rows) {
      if (row.origin !== 'subagent') {
        this.#authorized.add(row.id)
        continue
      }
      if (row.parentSessionId !== undefined) this.#lineage.set(row.id, row.parentSessionId)
    }
  }

  /**
   * The durable parent of a delegated child, or undefined when the roster does
   * not name one.
   *
   * The roster is the only endpoint that carries lineage, so it is read at most
   * once per connection: a client that listed sessions has already populated the
   * map, and a child opened without a listing costs exactly one roster read.
   */
  async #parentOf(sessionId: string): Promise<string | undefined> {
    const known = this.#lineage.get(sessionId)
    if (known !== undefined || this.#lineageRead) return known
    const roster = await this.#readRoster()
    if (roster.ok) this.#lineageRead = true
    return this.#lineage.get(sessionId)
  }

  /**
   * Whether this connection may follow one session at all.
   *
   * Following a delegated child is the one case that needs an answer before the
   * stream is asked for: relaxing the child gate must not become a channel to
   * any session a caller happens to name. A session this connection already
   * opened is authorized by that fact, an ordinary session the roster names is
   * authorized by the host's own roster, and a delegated child is authorized
   * only when the parent it hangs off is one of those. A session the roster does
   * not know at all keeps the old path — the harness itself answers for an id
   * this host does not have.
   * @returns the refusal to answer with, or undefined when the session may be followed.
   */
  async #unfollowable(sessionId: string): Promise<string | undefined> {
    if (this.#authorized.has(sessionId)) return undefined
    const parent = await this.#parentOf(sessionId)
    if (parent === undefined) return undefined
    if (this.#authorized.has(parent)) return undefined
    return `session ${sessionId} is a delegated child whose parent ${parent} is not a session this connection may read`
  }

  /**
   * Open one follow stream, resolving the address kind the harness demands.
   *
   * A delegated child is addressable only through its durable parent, and the
   * harness answers `session/agent-busy` when it is asked as an ordinary session.
   * That refusal is the one signal that distinguishes it from a real failure, so
   * it is the only one that triggers a roster lookup and a retry — everything
   * else crosses to the caller unchanged.
   */
  async #openSubscription(subscription: Subscription): Promise<Opening> {
    let outcome = await this.#openFollow(subscription)
    if (!outcome.ok && outcome.code === CODE_SUBAGENT_ADDRESS_REQUIRED) {
      const parent = await this.#parentOf(subscription.sessionId)
      if (parent !== undefined) {
        this.#lineage.set(subscription.sessionId, parent)
        subscription.address = subagentAddress(parent, subscription.sessionId)
        outcome = await this.#openFollow(subscription)
      }
    }
    if (!outcome.ok) {
      // The stream is unusable for this connection: drop it rather than leaving a
      // half-open subscription behind, so a later call starts a fresh one.
      this.#forget(subscription)
      subscription.controller.abort()
    }
    return outcome
  }

  /** One attempt at the opening frame of a follow stream. */
  async #openFollow(subscription: Subscription): Promise<Opening> {
    let iterator: AsyncIterator<unknown>
    try {
      const stream = await withServiceUnavailableRetry(() => this.#options.gateway.stream({
        namespace: 'session',
        method: 'follow',
        args: wireArgs('session', 'follow', {
          address: subscription.address,
          // Decided after the frozen design's §2.1/§2.2 contradiction: one stream
          // per session carries both the baseline and the process-local deltas.
          assistantStream: true,
          maxMessages: SNAPSHOT_MAX_MESSAGES,
        }),
        peer: this.#options.ownerPeer,
        signal: subscription.controller.signal,
      }))
      iterator = stream[Symbol.asyncIterator]()
    } catch (error) {
      return { ok: false, code: errorCodeOf(error, CODE_SNAPSHOT_UNAVAILABLE), msg: failureText(error) }
    }
    try {
      const first = await iterator.next()
      const baseline = first.done === true ? undefined : readFollowBaseline(first.value)
      if (baseline === undefined) {
        await iterator.return?.()
        return { ok: false, code: CODE_SNAPSHOT_UNAVAILABLE, msg: 'session/follow returned no opening snapshot frame' }
      }
      // A stream that opened is proof this connection may read that session,
      // which is what lets a child of it be followed afterwards.
      this.#authorized.add(subscription.sessionId)
      void this.#drain(subscription, iterator)
      return { ok: true, baseline }
    } catch (error) {
      return { ok: false, code: errorCodeOf(error, CODE_SNAPSHOT_UNAVAILABLE), msg: failureText(error) }
    }
  }

  /** Consume the rest of a follow stream, publishing every increment. */
  async #drain(subscription: Subscription, iterator: AsyncIterator<unknown>): Promise<void> {
    // Turn and step belong to this stream, not to the connection: a phone
    // following a parent and a child at once interleaves two turn sequences.
    const memory = {
      subagentThread: this.declares(CAP_SUBAGENT_THREAD),
      spawnCalls: new SpawnCallIndex(),
    }
    try {
      for (;;) {
        const next = await iterator.next()
        if (next.done === true) return
        subscription.advanced = true
        const delta = deltaOfFollowFrame(next.value, this.#toolCalls, this.#messages, memory)
        if (delta === undefined) continue
        this.#emit(TOPIC_SESSION_DELTA, { sessionId: subscription.sessionId, ...delta })
        // One turn ended, so a phone that is not holding this socket may want to
        // know. The call returns before anything is sent and swallows its own
        // failures: the frame above is already gone, and a notification is not
        // worth a delayed or aborted stream (protocol §28.5).
        if (delta.kind === 'turn-end') this.#announceTurnEnd(subscription.sessionId, delta.reason)
        // Only an increment that proves this session's own work proves a new turn; a
        // settled child, a usage count and a catalog change all arrive here without
        // meaning the user prompted again.
        else if (isTurnStartDelta(delta)) this.#options.turnEndQuiet?.noteTurnStarted(subscription.sessionId)
      }
    } catch (error) {
      if (!subscription.controller.signal.aborted) {
        this.#options.log(`session ${subscription.sessionId} follow stream ended: ${failureText(error)}`)
      }
    } finally {
      this.#forget(subscription)
    }
  }

  /**
   * Hand one finished turn to the channel that announces it.
   *
   * The gate holds it until the session is quiet (§28, §29); a connection built
   * without one has no host answer to wait for and reports at the frame.
   * @param sessionId - the session the turn belonged to.
   * @param reason - the host's own reason for ending it.
   */
  #announceTurnEnd(sessionId: string, reason: string): void {
    const gate = this.#options.turnEndQuiet
    if (gate !== undefined) {
      gate.noteTurnEnd(sessionId, reason)
      return
    }
    this.#options.push?.notify(pushEventOfTurnEnd(reason), sessionId)
    this.#options.liveActivity?.noteTurnEnd(sessionId, reason)
  }

  /**
   * The opening frame a baseline read is answered from.
   *
   * A subscription that has delivered nothing since its opening frame still
   * holds the window that frame opened, so it is awaited and reused: a session
   * asked about while it stays silent costs one stream however often it is read.
   * One that HAS delivered a frame since has moved past that window, and reusing
   * it would answer a session that ran a turn on this very stream with the empty
   * baseline of the moment before that turn. Such a subscription is dropped —
   * its drain aborted and itself forgotten — and a fresh stream answers with the
   * window the harness opens now, which is the session as it is.
   * @param sessionId - the session whose baseline is wanted.
   * @returns that stream's opening frame, or why there is none.
   */
  async #openingForBaseline(sessionId: string): Promise<Opening> {
    const subscription = this.#ensureSubscription(sessionId)
    if (!subscription.advanced) return this.#awaitOpening(subscription)
    this.#forget(subscription)
    subscription.controller.abort()
    return this.#awaitOpening(this.#ensureSubscription(sessionId))
  }

  /** Await a subscription's opening frame under a bounded wait. */
  async #awaitOpening(subscription: Subscription): Promise<Opening> {
    let timer: NodeJS.Timeout | undefined
    const expiry = new Promise<undefined>(resolve => {
      timer = setTimeout(() => { resolve(undefined) }, SNAPSHOT_OPEN_TIMEOUT_MS)
      timer.unref?.()
    })
    try {
      const outcome = await Promise.race([subscription.opened, expiry])
      if (outcome !== undefined) return outcome
      // No opening frame in time means the stream is unusable for this connection:
      // drop it rather than leaving a half-open subscription behind.
      subscription.controller.abort()
      this.#forget(subscription)
      return { ok: false, code: CODE_SNAPSHOT_UNAVAILABLE, msg: `no opening frame within ${SNAPSHOT_OPEN_TIMEOUT_MS} ms` }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Drop a subscription only while it is still the current one for its session. */
  #forget(subscription: Subscription): void {
    if (this.#subscriptions.get(subscription.sessionId) === subscription) this.#subscriptions.delete(subscription.sessionId)
  }

  /**
   * Shrink a snapshot until it fits one frame, dropping whole oldest turns.
   * @returns the fitting payload, or undefined when even one turn cannot fit.
   */
  #fitTurns(turns: readonly SnapshotTurn[], cursor: number, id: number): { readonly turns: readonly SnapshotTurn[]; readonly lastSeq: number } | undefined {
    let kept = [...turns]
    for (;;) {
      const frame = responseFrame(id, { turns: kept, lastSeq: cursor })
      if (Buffer.byteLength(JSON.stringify(frame), 'utf8') <= MAX_FRAME_BYTES) return { turns: kept, lastSeq: cursor }
      if (kept.length <= 1) return undefined
      kept = kept.slice(1)
    }
  }

  #rememberReceipt(receipt: string): void {
    this.#receipts.add(receipt)
    while (this.#receipts.size > PROMPT_RECEIPT_LIMIT) {
      const oldest = this.#receipts.values().next()
      if (oldest.done === true) break
      this.#receipts.delete(oldest.value)
    }
  }

  #emit(topic: string, payload: unknown): boolean {
    if (this.#disposed) return false
    const frame: ServerFrame = { t: 'ev', seq: this.#sequence.take(), m: topic, p: payload }
    const text = encodeFrame(frame)
    if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
      this.#options.log(`dropped a ${topic} event past ${MAX_FRAME_BYTES} bytes`)
      return false
    }
    return this.#write(text)
  }

  #send(frame: ServerFrame): void {
    if (this.#disposed) return
    this.#write(encodeFrame(frame))
  }

  /**
   * Hand one encoded frame to the carrier.
   *
   * A carrier that throws must not take the process down with it: every write
   * here happens either inside a socket `data` handler or inside the approval
   * waterfall, where an escaping exception becomes an uncaught exception. A
   * failure is logged and the frame is dropped — the socket is already gone by
   * then, so there is nobody left to answer.
   * @returns whether the frame was handed to the carrier.
   */
  #write(text: string): boolean {
    try {
      this.#transport.send(text)
    } catch (error) {
      this.#options.log(`could not write a frame: ${failureText(error)}`)
      return false
    }
    this.#lastSendAt = this.#options.now()
    return true
  }
}
