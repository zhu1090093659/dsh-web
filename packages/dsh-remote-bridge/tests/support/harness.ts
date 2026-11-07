/**
 * Test doubles for the bridge suites: a recording carrier, a scriptable
 * gateway, and a connection factory whose dependencies are all real except the
 * gateway. Nothing here patches a module or spies on a service method — the
 * gateway is injected, which is exactly the seam the production code already
 * takes.
 * @module tests/support/harness
 */

import { Context } from '@deepseek-ai/cordis'
import { BridgeConnection, type BridgeConnectionOptions, type BridgeTransport, type ConnectionAuth } from '../../src/core/connection.ts'
import { ApprovalRegistry } from '../../src/core/approvals.ts'
import { DeviceRoster } from '../../src/core/devices.ts'
import { RemoteBridgeRegistry } from '../../src/core/extension.ts'
import { inScope, JobRoster, type JobEventLike, type JobEventFilterLike, type JobRegistryFace, type JobViewLike } from '../../src/core/jobs.ts'
import { ModelEffortPreferences } from '../../src/core/model-efforts.ts'
import { BridgeHub } from '../../src/core/hub.ts'
import { createOwnerPeer } from '../../src/core/owner-peer.ts'
import { PairingService } from '../../src/core/pairing.ts'
import { QuestionClaims } from '../../src/core/questions.ts'
import { UiCards } from '../../src/core/ui.ts'
import { SessionMeta, type SessionMetaFaces } from '../../src/core/session-meta.ts'
import { SessionPermissions } from '../../src/core/session-permissions.ts'
import type { LiveActivityNotifier } from '../../src/core/liveactivity.ts'
import type { PushNotifier } from '../../src/core/push.ts'
import type { SquadTransport } from '../../src/core/squads.ts'
import type { TurnEndQuietGate } from '../../src/core/turn-end-quiet.ts'
import { UsageService, type UsageFaces } from '../../src/core/usage.ts'
import type { RelayTierFace } from '../../src/core/connection.ts'
import type { BridgeGateway, GatewayInvokeRequest, GatewayPeer } from '../../src/core/wire.ts'

/** One frame as it crossed the wire. */
export interface WireFrame {
  readonly t: string
  readonly [key: string]: unknown
}

/** One request the connection made through the gateway. */
export interface RecordedCall {
  readonly namespace: string
  readonly method: string
  readonly args: Readonly<Record<string, unknown>>
  /** The caller the call spoke for; the suites assert the bridge's own owner peer crosses, never a client-supplied one. */
  readonly peer: GatewayPeer
  readonly signal: AbortSignal | undefined
}

/** A carrier that keeps every frame instead of writing a socket. */
export class RecordingTransport implements BridgeTransport {
  readonly sent: string[] = []
  closed: { code: number; reason: string } | undefined
  /** The last `frame.deflate.v1` declaration the connection reported; undefined until a hello. */
  deflate: boolean | undefined

  send(text: string): void {
    this.sent.push(text)
  }

  frameDeflate(declared: boolean): void {
    this.deflate = declared
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }

  /** @returns every frame, parsed. */
  frames(): WireFrame[] {
    return this.sent.map(text => JSON.parse(text) as WireFrame)
  }

  /** @returns the frames with the given `t`. */
  ofType(kind: string): WireFrame[] {
    return this.frames().filter(frame => frame.t === kind)
  }

  /** @returns the response frame for one request id, or undefined when none arrived. */
  responseTo(id: number): WireFrame | undefined {
    return this.frames().find(frame => frame.t === 'res' && frame.id === id)
  }

  /** @returns the last frame received, or undefined. */
  last(): WireFrame | undefined {
    const frames = this.frames()
    return frames[frames.length - 1]
  }
}

/** A gateway whose every answer is scripted by the test. */
export class FakeGateway implements BridgeGateway {
  readonly invocations: RecordedCall[] = []
  readonly streamRequests: RecordedCall[] = []
  /** Unary answers; the default accepts everything. */
  handler: (call: RecordedCall) => Promise<unknown> = async () => ({ accepted: true })
  /**
   * Follow streams by call.
   *
   * A wait subscription is answered with an already ended stream: the question
   * channel reads the host's remaining wait from that stream before publishing,
   * and a real host reports it the moment the waiter attaches, so a double that
   * never yields would hold the question instead of modelling the host. A suite
   * that wants frames assigns its own `follow`.
   */
  follow: (call: RecordedCall) => AsyncIterable<unknown> = (call) => (
    call.method === 'attachWait' ? new ControllableStream().end().iterable() : new ControllableStream().iterable()
  )
  /**
   * Whether a browser client that can answer these waterfalls is on the wire.
   *
   * The host's own `ctx.typertGateway.hasLiveClient`: true models the Web GUI
   * sitting in front of the operator, which is what silences a notification.
   */
  liveClient = false

  hasLiveClient(): boolean {
    return this.liveClient
  }

  invoke(request: GatewayInvokeRequest): Promise<unknown> {
    const call: RecordedCall = { namespace: request.namespace, method: request.method, args: request.args, peer: request.peer, signal: request.signal }
    this.invocations.push(call)
    return this.handler(call)
  }

  stream(request: GatewayInvokeRequest): Promise<AsyncIterable<unknown>> {
    const call: RecordedCall = { namespace: request.namespace, method: request.method, args: request.args, peer: request.peer, signal: request.signal }
    this.streamRequests.push(call)
    return Promise.resolve(this.follow(call))
  }

  /** @returns the args of the last invocation of one endpoint. */
  lastArgs(namespace: string, method: string): Readonly<Record<string, unknown>> | undefined {
    for (let index = this.invocations.length - 1; index >= 0; index -= 1) {
      const call = this.invocations[index]
      if (call?.namespace === namespace && call.method === method) return call.args
    }
    return undefined
  }

  /** @returns how many times one endpoint was invoked. */
  countOf(namespace: string, method: string): number {
    return this.invocations.filter(call => call.namespace === namespace && call.method === method).length
  }
}

/**
 * A job registry a test drives directly.
 *
 * It implements the two members the bridge actually reads — the fenced `list`
 * and the event stream — and nothing else, which is what the structural face is
 * for. `list` applies the host's own fence, so a test cannot accidentally
 * assert a scope the host would not serve.
 */
export class FakeJobRegistry implements JobRegistryFace {
  readonly #rows: JobViewLike[] = []
  readonly listeners = new Set<(event: JobEventLike) => void>()
  /** How many times a stream was subscribed; the bridge must unsubscribe when nothing watches. */
  subscriptions = 0

  readonly events = {
    subscribe: (filter: JobEventFilterLike, listener: (event: JobEventLike) => void): (() => void) => {
      this.subscriptions += 1
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  /** Replace the registry's whole content. */
  set(rows: readonly JobViewLike[]): this {
    this.#rows.splice(0, this.#rows.length, ...rows)
    return this
  }

  /** Add one job. */
  add(row: JobViewLike): this {
    this.#rows.push(row)
    return this
  }

  list(caller?: string): readonly JobViewLike[] {
    return this.#rows.filter(row => inScope(row.owner, caller))
  }

  /** Announce one lifecycle commit, as the host registry does after every commit. */
  emit(event: JobEventLike): this {
    // A copy, because a listener may unsubscribe while this one dispatch runs
    // (a connection disposed mid-burst), and the assertion is about the set.
    for (const listener of Array.from(this.listeners)) listener(event)
    return this
  }

  /** Announce one output append: it moves no row, so no roster frame may follow. */
  emitOutput(id: string, owner: string | undefined, total: number): this {
    // The host's `output` event carries only the id and the new total, which is
    // exactly why a roster can never be driven by it.
    const append = { type: 'output', id, total, ...(owner === undefined ? {} : { owner }) }
    return this.emit(append as JobEventLike)
  }
}

/**
 * A follow stream a test drives one frame at a time.
 *
 * Aborting the signal ends the stream, which is how the suites prove that a
 * closed connection does not leave a session subscription running.
 */
export class ControllableStream {
  readonly #queue: unknown[] = []
  readonly #waiters: ((result: IteratorResult<unknown>) => void)[] = []
  #ended = false
  #signal: AbortSignal | undefined

  /** Take the follow call's signal so an abort ends the stream. */
  attach(signal: AbortSignal | undefined): this {
    this.#signal = signal
    signal?.addEventListener('abort', () => { this.end() }, { once: true })
    return this
  }

  /** @returns whether the stream has been ended (by the test or by an abort). */
  get ended(): boolean {
    return this.#ended
  }

  /** Whether the producing signal was aborted. */
  get aborted(): boolean {
    return this.#signal?.aborted === true
  }

  push(frame: unknown): this {
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) waiter({ done: false, value: frame })
    else this.#queue.push(frame)
    return this
  }

  end(): this {
    if (this.#ended) return this
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
    return this
  }

  /** @returns the iterable a gateway hands back. */
  iterable(): AsyncIterable<unknown> {
    return { [Symbol.asyncIterator]: () => this }
  }

  next(): Promise<IteratorResult<unknown>> {
    const queued = this.#queue.shift()
    if (queued !== undefined) return Promise.resolve({ done: false, value: queued })
    if (this.#ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise(resolve => { this.#waiters.push(resolve) })
  }

  return(): Promise<IteratorResult<unknown>> {
    this.end()
    return Promise.resolve({ done: true, value: undefined })
  }
}

/** Everything one connection was built with, so a test can inspect each part. */
export interface ConnectionHarness {
  readonly connection: BridgeConnection
  readonly transport: RecordingTransport
  readonly gateway: FakeGateway
  readonly pairing: PairingService
  readonly roster: DeviceRoster
  readonly approvals: ApprovalRegistry
  readonly ownerPeer: GatewayPeer
  readonly questions: QuestionClaims
  /** 整页卡（§35）的卡表，套件用它断言「仍持有」与「已结算」。 */
  readonly ui: UiCards
  readonly extensions: RemoteBridgeRegistry
  readonly logs: string[]
}

export interface HarnessOptions {
  /** Marks the connection as already paired with a device token. */
  readonly paired?: boolean
  /** Roster file path; a nonexistent path under a temp directory is enough. */
  readonly rosterFile?: string
  /** Roster stand-in, for the failure paths a real file cannot be made to take. */
  readonly roster?: DeviceRoster
  /** The host's remembered effort table; a suite that asserts persistence passes its own file. */
  readonly modelEfforts?: ModelEffortPreferences
  /** Session metadata source; the default models a host with no such service mounted. */
  readonly sessionMeta?: SessionMeta
  /** Permission presets source; the default models a host with no such service mounted. */
  readonly permissions?: SessionPermissions
  /** Job registry source; the default models a host with no job plugin mounted. */
  readonly jobs?: JobRegistryFace
  /** 用量读数源；默认是一个宿主服务一个都没挂载、也从未观察过任何会话的服务。 */
  readonly usage?: UsageService
  /** Coalescing window of the job roster; the default is the production one. */
  readonly jobsFlushMs?: number
  readonly heartbeatMs?: number
  /** Id source for the call ids the question channel mints; the default is random. */
  readonly questionIds?: (byteLength: number) => string
  /** 整页卡的卡表；默认每个 harness 自己一份，套件可换一份来驱动「已被别处结算」的路径。 */
  readonly ui?: UiCards
  /** The extension seam's method registry, when the suite inspects it. */
  readonly extensions?: RemoteBridgeRegistry
  /** Clock the question deadline bookkeeping reads; the default is the wall clock. */
  readonly questionNow?: () => number
  /** Squad domain source; the default models a host with no `dsh-agents` domain. */
  readonly squads?: SquadTransport
  /** The outbound notification path; the default models a bridge with no APNs key. */
  readonly push?: PushNotifier
  /** Whether a browser client that answers these waterfalls is on the wire; the default is none. */
  readonly liveClient?: boolean
  /** The lock-screen card path; the default models a bridge that sends no card. */
  readonly liveActivity?: LiveActivityNotifier
  /** The gate a finished turn is announced through; the default reports at the frame. */
  readonly turnEndQuiet?: TurnEndQuietGate
  /** The roster-change hook the standing watchers are armed from. */
  readonly onPushRegistered?: () => void
  /**
   * 第二会合点在协议面上的那一半（`relay.tier.v1`）。
   *
   * 缺省是没有第二会合点：握手与 `relay.grant` 都与这条通道出现之前逐字相同，
   * 所以每一个既有套件的上下文都没有变。
   */
  readonly relay?: RelayTierFace
}

/**
 * A preference table a suite gets when it says nothing.
 *
 * Pointed at a path no suite writes: `load()` then reads nothing and the table
 * answers no level, which is the state every pre-existing test was written
 * against. A suite that asserts what this host remembers builds its own over its
 * own temp file.
 * @returns an empty table over a file nobody writes.
 */
function effortTableOf(): ModelEffortPreferences {
  return new ModelEffortPreferences({ file: '/tmp/dsh-remote-bridge-test/not-loaded-efforts.json' })
}

/** Session metadata for a host whose session services are all present. */
function metaOf(options: HarnessOptions, log: (message: string) => void): SessionMeta {
  return options.sessionMeta ?? new SessionMeta(() => ({}), () => Date.now(), log)
}

/**
 * A title service over one fixed table, plus the live-session store in front of
 * it — the two faces {@link SessionMeta} reads.
 */
export interface TitlesDouble {
  /** The faces one `SessionMeta` is built from. */
  readonly faces: SessionMetaFaces
  /** The ids the title service was actually asked for, in order. */
  readonly reads: string[]
}

/**
 * Build a title double.
 * @param table - titles by session id.
 * @param live - ids the store reports as live sessions; defaults to the table's keys.
 * @returns the faces, and the log of every id the title service was asked for.
 */
export function titlesDouble(table: Record<string, string>, live: readonly string[] = Object.keys(table)): TitlesDouble {
  const reads: string[] = []
  return {
    reads,
    faces: {
      sessions: { get: id => (live.includes(id) ? { id } : undefined) },
      titles: {
        get: session => {
          reads.push(session.id)
          const title = table[session.id]
          return title === undefined ? undefined : { title }
        },
      },
    },
  }
}

/**
 * 用量服务一个 harness 挂的那一份。
 *
 * 没挂任何宿主服务、也没观察过任何会话：`usage.session` 因此只会对活会话存储
 * 里有的会话作答，`usage.balance` 只会回 `no-credential`。需要别的读数的套件
 * 自己构造一份传进来。
 */
export function usageOf(options: HarnessOptions, log: (message: string) => void, faces: () => UsageFaces = () => ({})): UsageService {
  return options.usage ?? new UsageService({ faces, now: () => Date.now(), log })
}

/**
 * 一个 harness 挂的那份整页卡卡表（§35）。
 *
 * 缺省时每个 harness 自己一份新的：一条动作只属于发起它的那个工具调用，套件之间
 * 不共享卡表，所以「仍持有」这种断言读到的永远是本次构造的事实。
 * @param options - 套件选项。
 * @returns 卡表。
 */
export function uiOf(options: HarnessOptions): UiCards {
  return options.ui ?? new UiCards()
}

/** The job roster one harness mounts, over the registry the caller supplied (or none). */
function jobsOf(options: HarnessOptions, log: (message: string) => void): JobRoster {
  const registry = options.jobs
  return new JobRoster({
    faces: () => ({ jobs: registry }),
    log,
    ...(options.jobsFlushMs === undefined ? {} : { flushMs: options.jobsFlushMs }),
  })
}

/** Build one connection over the recording carrier. */
export function makeConnection(options: HarnessOptions = {}): ConnectionHarness {
  const transport = new RecordingTransport()
  const gateway = new FakeGateway()
  gateway.liveClient = options.liveClient === true
  const pairing = new PairingService()
  const roster = options.roster ?? new DeviceRoster({ file: options.rosterFile ?? '/tmp/dsh-remote-bridge-test/not-loaded.json' })
  const modelEfforts = options.modelEfforts ?? effortTableOf()
  const approvals = new ApprovalRegistry()
  const logs: string[] = []
  const ownerPeer = createOwnerPeer(new Context())
  const questions = new QuestionClaims({
    gateway,
    peer: ownerPeer,
    log: message => { logs.push(message) },
    ...(options.questionIds === undefined ? {} : { random: options.questionIds }),
    ...(options.questionNow === undefined ? {} : { now: options.questionNow }),
  })
  const extensions = options.extensions ?? new RemoteBridgeRegistry()
  const settings: BridgeConnectionOptions = {
    extensions,
    gateway,
    pairing,
    roster,
    modelEfforts,
    approvals,
    questions,
    ui: uiOf(options),
    sessionMeta: metaOf(options, message => { logs.push(message) }),
    permissions: options.permissions ?? new SessionPermissions(() => ({}), message => { logs.push(message) }),
    jobs: jobsOf(options, message => { logs.push(message) }),
    usage: usageOf(options, message => { logs.push(message) }),
    ownerPeer,
    ...(options.squads === undefined ? {} : { squads: options.squads }),
    ...(options.push === undefined ? {} : { push: options.push }),
    ...(options.liveActivity === undefined ? {} : { liveActivity: options.liveActivity }),
    ...(options.turnEndQuiet === undefined ? {} : { turnEndQuiet: options.turnEndQuiet }),
    ...(options.onPushRegistered === undefined ? {} : { onPushRegistered: options.onPushRegistered }),
    ...(options.relay === undefined ? {} : { relay: options.relay }),
    now: () => Date.now(),
    clientTimeZone: () => 'Asia/Shanghai',
    log: (message: string) => { logs.push(message) },
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  }
  const auth: ConnectionAuth | undefined = options.paired === true ? { deviceId: 'dev_harness' } : undefined
  const connection = new BridgeConnection(settings, transport, auth)
  return { connection, transport, gateway, pairing, roster, approvals, ownerPeer, questions, ui: settings.ui, extensions, logs }
}

/** One request frame, serialized the way a client sends it. */
export function requestFrame(id: number, method: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ t: 'req', id, m: method, p: payload })
}

/**
 * Let the connection's background work run to its next await.
 * @param rounds - microtask hops; enough for the drain loop to publish one pushed frame.
 */
export async function settle(rounds = 50): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

/**
 * Wait out one job-roster coalescing window.
 *
 * The roster folds a burst into one publish with a timer, and a `setImmediate`
 * turn never reaches the timers phase that timer belongs to. This waits on a
 * timer queued after the roster's own, so it resumes only once that flush has
 * run; on a window of 0 ms it resumes at the next timers phase, which is exactly
 * when a suite that asserts an absence has to look. An ordering primitive, not a
 * sleep: nothing here waits for a duration.
 */
export async function settleJobs(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/**
 * Yield exactly one event-loop turn, for the events Node emits after the turn
 * that caused them (a destroyed stream reports `close` this way). This is an
 * ordering primitive, not a wait: the turn is deterministic and has no duration.
 */
export async function nextTurn(): Promise<void> {
  await new Promise<void>(resolve => { setImmediate(resolve) })
}

/** Everything a hub was built with, plus the one connection attached to it. */
export interface HubHarness {
  readonly hub: BridgeHub
  readonly connection: BridgeConnection
  readonly transport: RecordingTransport
  readonly gateway: FakeGateway
  readonly approvals: ApprovalRegistry
  readonly ownerPeer: GatewayPeer
  readonly questions: QuestionClaims
  readonly ui: UiCards
  readonly extensions: RemoteBridgeRegistry
  readonly logs: string[]
}

/** Build one hub with one attached connection. */
export function makeHub(options: HarnessOptions = {}): HubHarness {
  const bare = makeBareHub(options)
  const transport = new RecordingTransport()
  const connection = bare.hub.attach(transport, options.paired === false ? undefined : { deviceId: 'dev_harness' })
  return { ...bare, connection, transport }
}

/** Everything a hub was built with, before any connection is attached to it. */
export interface BareHubHarness {
  readonly hub: BridgeHub
  readonly gateway: FakeGateway
  readonly approvals: ApprovalRegistry
  readonly ownerPeer: GatewayPeer
  readonly questions: QuestionClaims
  readonly ui: UiCards
  readonly extensions: RemoteBridgeRegistry
  readonly logs: string[]
}

/** Build one hub with nothing attached, for suites that bring their own carrier. */
export function makeBareHub(options: HarnessOptions = {}): BareHubHarness {
  const gateway = new FakeGateway()
  gateway.liveClient = options.liveClient === true
  const approvals = new ApprovalRegistry()
  const logs: string[] = []
  const ownerPeer = createOwnerPeer(new Context())
  const questions = new QuestionClaims({
    gateway,
    peer: ownerPeer,
    log: message => { logs.push(message) },
    ...(options.questionIds === undefined ? {} : { random: options.questionIds }),
    ...(options.questionNow === undefined ? {} : { now: options.questionNow }),
  })
  const extensions = options.extensions ?? new RemoteBridgeRegistry()
  const ui = uiOf(options)
  const hub = new BridgeHub({
    extensions,
    gateway,
    pairing: new PairingService(),
    roster: options.roster ?? new DeviceRoster({ file: options.rosterFile ?? '/tmp/dsh-remote-bridge-test/not-loaded.json' }),
    modelEfforts: options.modelEfforts ?? effortTableOf(),
    approvals,
    questions,
    ui,
    sessionMeta: metaOf(options, message => { logs.push(message) }),
    permissions: options.permissions ?? new SessionPermissions(() => ({}), message => { logs.push(message) }),
    jobs: jobsOf(options, message => { logs.push(message) }),
    usage: usageOf(options, message => { logs.push(message) }),
    ownerPeer,
    ...(options.squads === undefined ? {} : { squads: options.squads }),
    ...(options.push === undefined ? {} : { push: options.push }),
    ...(options.liveActivity === undefined ? {} : { liveActivity: options.liveActivity }),
    ...(options.turnEndQuiet === undefined ? {} : { turnEndQuiet: options.turnEndQuiet }),
    ...(options.onPushRegistered === undefined ? {} : { onPushRegistered: options.onPushRegistered }),
    ...(options.relay === undefined ? {} : { relay: options.relay }),
    now: () => Date.now(),
    clientTimeZone: () => undefined,
    log: (message: string) => { logs.push(message) },
  })
  return { hub, gateway, approvals, ownerPeer, questions, ui, extensions, logs }
}

/** One response frame's `ok`, `r` and `e`, exactly as the client reads them. */
export function answerOf(harness: { readonly transport: RecordingTransport }, id: number): { ok: boolean; r?: unknown; e?: { code: string; msg: string } } {
  const frame = harness.transport.responseTo(id)
  if (frame === undefined) throw new Error(`no response for request ${id}`)
  const { ok, r, e } = frame as unknown as { ok: boolean; r?: unknown; e?: { code: string; msg: string } }
  return e === undefined ? { ok, r } : { ok, e }
}
