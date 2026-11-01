/**
 * The frozen protocol surface: method names, topic names, refusal codes, and
 * the one authorization rule the dispatcher enforces before any method runs.
 * @module dsh-remote-bridge/core/protocol
 */

/** Client-callable methods of protocol v1. */
export const METHOD_HELLO = 'hello'
export const METHOD_SESSION_LIST = 'session.list'
export const METHOD_SESSION_TITLES = 'session.titles'
export const METHOD_SESSION_SNAPSHOT = 'session.snapshot'
export const METHOD_SESSION_HISTORY = 'session.history'
export const METHOD_SESSION_HISTORY_DEEP = 'session.history.deep'
export const METHOD_SESSION_PROMPT = 'session.prompt'
export const METHOD_SESSION_INTERRUPT = 'session.interrupt'
export const METHOD_SESSION_ATTACHMENT = 'session.attachment'
export const METHOD_SESSION_PERMISSIONS = 'session.permissions'
export const METHOD_SESSION_SET_PERMISSION = 'session.setPermission'
export const METHOD_SESSION_MODELS = 'session.models'
export const METHOD_SESSION_SET_MODEL = 'session.setModel'
/** Remember one model's reasoning level, without switching the session's model. */
export const METHOD_SESSION_SET_EFFORT = 'session.setEffort'
export const METHOD_SESSION_CREATE = 'session.create'
export const METHOD_SESSION_FORK = 'session.fork'
export const METHOD_SESSION_COMMANDS = 'session.commands'
export const METHOD_SESSION_COMMAND = 'session.command'
export const METHOD_SESSION_RENAME = 'session.rename'
export const METHOD_SESSION_PIN = 'session.pin'
export const METHOD_SESSION_UNPIN = 'session.unpin'
export const METHOD_SESSION_ARCHIVE = 'session.archive'
export const METHOD_SESSION_UNARCHIVE = 'session.unarchive'
export const METHOD_WORKSPACE_LIST = 'workspace.list'
export const METHOD_PRESETS_LIST = 'presets.list'
export const METHOD_PAIR_BEGIN = 'pair.begin'
export const METHOD_PAIR_FINISH = 'pair.finish'
export const METHOD_APPROVAL_RESOLVE = 'approval.resolve'
export const METHOD_QUESTION_ANSWER = 'question.answer'
export const METHOD_QUESTION_LIST = 'question.list'
export const METHOD_JOBS_LIST = 'jobs.list'
export const METHOD_SQUADS_STATE = 'squads.state'
export const METHOD_SQUADS_LIST = 'squads.list'
export const METHOD_SQUADS_RUNS = 'squads.runs'
export const METHOD_SQUADS_RUN_MEMBER = 'squads.runMember'
export const METHOD_SQUADS_RUN_SQUAD = 'squads.runSquad'
export const METHOD_PUSH_REGISTER = 'push.register'
export const METHOD_USAGE_SESSION = 'usage.session'
export const METHOD_USAGE_BALANCE = 'usage.balance'
export const METHOD_USAGE_STATS = 'usage.stats'
// 协议 §35 追加的两个方法：一条卡上的动作回来，以及一张全局卡表的对账读。
export const METHOD_UI_EVENT = 'ui.event'
export const METHOD_UI_LIST = 'ui.list'
/**
 * 一条配对连接把手机从账号服务换到的中继授权交给宿主。
 *
 * 它是这条通道唯一的写动作：授权落进那台设备自己的名册行，随后宿主拿它去第二
 * 会合点申领租约。宿主不认识账号——它只会看到「准了」或「不准」，绝不会从这一帧
 * 里读出用户是谁。只在配了第二会合点的宿主上是这个方法（见 {@link CAP_RELAY_TIER}）。
 */
export const METHOD_RELAY_GRANT = 'relay.grant'

/** Server-pushed topics of protocol v1. */
export const TOPIC_SESSION_DELTA = 'session.delta'
export const TOPIC_APPROVAL_REQUEST = 'approval.request'
export const TOPIC_QUESTION_REQUEST = 'question.request'
export const TOPIC_JOBS_CHANGED = 'jobs.changed'
// §35.2 追加的主题：一块整页自包含文档，以及它自己的结算通知。
export const TOPIC_UI_REQUEST = 'ui.request'

/**
 * Capability a client declares in `hello`'s `cap` array to ask for a trimmed
 * `session.snapshot` baseline. A client that does not declare it — including
 * every client written before this capability existed — is served exactly the
 * baseline protocol v1 always served.
 */
export const CAP_SESSION_SNAPSHOT_TRIM = 'session.snapshot.trim.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to have
 * `session.snapshot` answer with one bounded page instead of the whole opening
 * window. Declaring it is what makes an opening screen cost one page rather
 * than a whole session; a client that does not declare it — including every
 * client written before this capability existed — receives byte for byte the
 * snapshot protocol v1 always served.
 */
export const CAP_SESSION_SNAPSHOT_PAGE = 'session.snapshot.page.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to have
 * `session.snapshot` answer a reconnect with only what it missed.
 *
 * The declaration and the request's `sinceSeq` are what it takes together: a
 * snapshot that carries no `sinceSeq` is answered, byte for byte, the body
 * protocol v1 always served, whether or not the client declared this. Behind
 * both, the client names the durable `lastSeq` of a snapshot it already holds
 * and the answer is either that same reply in an incremental form —
 * `{turns, lastSeq, mode:"since", reset:false}` carrying only the entries above
 * that watermark — or a full baseline with `mode:"full"` and `reset:true`,
 * which is the one answer that tells a client to throw its copy away. The
 * estimate is only served when the bridge can PROVE nothing was lost: the
 * current follow window's oldest entry must sit at or below `sinceSeq + 1`, so a
 * window that has already scrolled past the watermark answers the baseline
 * instead of a delta with a hole in it. It exists because a reconnect on the
 * phone re-paid 0.86-1.06 s of baseline five times in one measured run.
 */
export const CAP_SESSION_SNAPSHOT_SINCE = 'session.snapshot.since.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be shown the
 * host's pending user questions and to answer them with `question.answer`.
 *
 * Declaring it is what makes `question.request` reachable and what makes the
 * method part of that client's protocol at all: a client that does not declare
 * it — including every client written before this channel existed — receives no
 * such event, and its `question.answer` is refused as an unknown method,
 * exactly as that frame was refused before.
 */
export const CAP_QUESTIONS = 'questions.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to learn that this
 * bridge can list the user questions it is still holding.
 *
 * An announcement rather than a switch, the same shape as
 * {@link CAP_SESSION_DEEP_HISTORY}: `question.list` is reachable from every
 * client that declared {@link CAP_QUESTIONS}, exactly as `question.answer` is,
 * so a client written before this name existed loses nothing by declaring it
 * and nothing by never calling the method. What the name buys is a way to tell
 * a bridge that serves the method from one that does not: a host built before
 * it answers `unknown-method`, so a client that does not find this name in
 * `hello`'s `capabilities` keeps the retirement rule it had — a card is over
 * when `question.request` says `settled` — instead of reaping cards on an
 * answer it cannot trust.
 */
export const CAP_QUESTION_LIST = 'questions.list.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be handed the
 * approval questions this bridge is already holding for it.
 *
 * Unlike every channel capability beside it, this one gates a second delivery
 * rather than the channel: `approval.request` still reaches every paired
 * connection the moment a tool asks, exactly as it did before this name
 * existed, because gating the first broadcast would take approvals away from
 * every client written before the capability. What the declaration buys is the
 * replay — after a reconnect, or on a session screen opened late, the client is
 * handed the questions that are still waiting instead of a card it never saw.
 * Only a live claim is replayed: a question that was answered, that the bridge
 * timed out, or that was withdrawn with the last phone is gone from the claim
 * registry before the replay reads it.
 *
 * It is deliberately absent from {@link SERVED_CAPABILITIES}: that list is what
 * `hello` advertises as served, advertising a capability is a minor-version
 * addition (see {@link MINOR}), and this channel changes nothing a client can
 * observe in the handshake — no answer, no field and no method behind it. The
 * declaration is the whole switch, and the name reaches a client through this
 * bridge's own protocol documentation.
 */
export const CAP_APPROVALS = 'approvals.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be told where a
 * message came from and that an agent spawned a child session.
 *
 * Declaring it is what makes the `subagent` delta part of that client's
 * protocol: a client that does not declare it — including every client written
 * before this channel existed — receives no such event, exactly as that frame
 * was dropped before. The `actor` of a `user-message` is not gated: it is an
 * additive field a client that does not read it ignores.
 */
export const CAP_SUBAGENT_THREAD = 'subagent.thread.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to see the host's
 * background jobs and to be told when the set changes.
 *
 * Declaring it is what makes `jobs.list` reachable, and `jobs.list` is the only
 * thing that opens a roster: a connection that declares this capability but
 * never asks for a scope receives no `jobs.changed` at all. A client that does
 * not declare it — including every client written before this channel existed —
 * receives no such event, and its `jobs.list` is refused as an unknown method,
 * exactly as that frame was refused before.
 */
export const CAP_JOBS = 'jobs.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to read the host's
 * Agent presets and to instantiate one as a session.
 *
 * Declaring it is what makes `presets.list` and `session.create` part of that
 * client's protocol at all: a client that does not declare it — including every
 * client written before this channel existed — is refused both as unknown
 * methods, exactly as those frames were refused before. Neither method is
 * called on a connection's behalf either, so a client that never asks sends the
 * host no request.
 */
export const CAP_AGENTS = 'agents.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to read the host's
 * agent squads and to drive them.
 *
 * Declaring it is what makes `squads.state`, `squads.list`, `squads.runs`,
 * `squads.runMember` and `squads.runSquad` part of that client's protocol at
 * all: a client that does not declare it — including every client written before
 * this channel existed — is refused each as an unknown method, exactly as those
 * frames were refused before. No command is called on a connection's behalf
 * either, so a client that never asks sends the host no request.
 *
 * The channel is additive beside {@link CAP_AGENTS} rather than a replacement:
 * a phone that predates the squad model keeps the preset roster and session
 * creation it was written against, and a phone that reads this name reads the
 * squad domain instead of deriving agents from anything else.
 */
export const CAP_SQUADS = 'squads.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to register the APNs
 * token this device wants to be notified on.
 *
 * Declaring it is what makes `push.register` part of that client's protocol at
 * all: a client that does not declare it — including every client written before
 * this channel existed — is refused that frame as an unknown method, and no
 * device row is written on its behalf.
 *
 * The name announces that this bridge can REMEMBER a token, not that it will
 * send anything. Whether a notification ever leaves the process is a deployment
 * fact (is an APNs signing key configured?) that the wire deliberately cannot
 * express: a bridge with no key answers `ok:true` exactly like one with a key,
 * because a client has no second code path to keep for the difference. Every
 * notification this channel produces is an outbound APNs request and nothing
 * else — no topic, no frame and no state is added to `/ios/v1` (see the
 * protocol's §28).
 */
export const CAP_PUSH = 'push.v1'

/**
 * 客户端在 `hello` 的 `cap` 数组里宣告它要读本桥自己的用量读数。
 *
 * 宣告它是 `usage.session` 与 `usage.balance` 进入这个客户端协议的唯一前提：
 * 不宣告的客户端——包括这个通道出现之前写下的每一个客户端——收到的是与从前
 * 逐字一样的 `unknown-method`，本桥也不会替它读一条会话、更不会替它打一次
 * 上游余额端点。
 *
 * 一个能力名带两个方法，因为它们读的是同一件事的两面：一条会话下一次请求由
 * 什么组成（上下文窗口取宿主自己广播的值，组成由本桥按文本长度估算并恒标
 * `estimated: true`），以及某条 provider 路由背后账户的余额（DeepSeek 官方
 * 口径，只在路由确实指向 `api.deepseek.com` 且凭据拿得到时才查官方端点，宿主
 * 侧同一 provider + 凭据 60 秒最多一次上游请求）。
 */
export const CAP_USAGE = 'usage.v1'

/**
 * 客户端在 `hello` 的 `cap` 数组里宣告它要读宿主自己的用量台账聚合。
 *
 * 与 {@link CAP_USAGE} 平级、独立声明：宣告它是 `usage.stats` 进入这个客户端
 * 协议的唯一前提，不宣告的客户端——包括 `usage.v1` 出现之后、这个能力出现之前
 * 写下的每一个客户端——收到的仍是 `unknown-method`，本桥也不会替它去读宿主
 * 上 `dsh-usage` 插件的任何一条路由。
 *
 * 拆成独立能力而不是塞进 `usage.v1`，是因为它读的是另一件事：那两半读的是本
 * 进程自己的事实（一个会话、一条路由的账户），这一半读的是另一个插件挂在这个
 * 宿主上的 HTTP 路由，而那个插件可能根本没装。老客户端忽略这个未知名字即可，
 * 它看到的能力表里多一项、别的什么都没有变。
 */
export const CAP_USAGE_STATS = 'usage.stats.v1'

/**
 * 客户端在 `hello` 的 `cap` 数组里宣告它要渲染整页卡并回答它（协议 §35）。
 *
 * 宣告它是 `ui.request` 与 `ui.event` 进入这个客户端协议的唯一前提：不宣告的
 * 客户端——包括这个通道出现之前写下的每一个客户端——收不到任何一帧整页卡，它的
 * `ui.event` 回 `unknown-method`，其余逐字节不变。它是**公告不是协商**（§13.1、
 * §24.1 同一判据）：宿主公告同名项、客户端声明，双向缺一即当作这个能力不存在，
 * 且不得把「宿主没这个能力」渲染成「这张卡不存在」或任何错误态。
 *
 * 宿主半区只有真实现了 `ui_present` 这一半的桥才把自己列进
 * {@link SERVED_CAPABILITIES}，所以一个客户端读到这个名字，就能断定 `ui.request`
 * 会出现、`ui.event` 会被接受。
 */
export const CAP_UI = 'ui.v1'

/**
 * 客户端在 `hello` 的 `cap` 数组里宣告它要按 §24.3 的四条件对账自己手上的整页卡
 * （协议 §35.4）。
 *
 * 与 {@link CAP_QUESTION_LIST} 同一形状：`ui.list` 本身是只读的、对每条配对连接
 * 都开放，这个名字买到的是「这条连接会不会被答」之外的另一种确定性——一条老桥
 * 回 `unknown-method`，于是没有这个名字的客户端就保留它原有的退休规则（卡片只在
 * `ui.request` 说 `settled` 时结束），而不是按一次它信不过的应答清卡。
 */
export const CAP_UI_LIST = 'ui.list.v1'

/**
 * 宿主配了第二会合点时，在 `hello` 的 `capabilities` 里公告的能力名。
 *
 * 它是这条通道的全部门槛，而且门槛落在宿主这一侧：一个配了第二会合点的宿主才
 * 公告这个名字、才收 {@link METHOD_RELAY_GRANT}，客户端读到它之后才把授权发过来。
 * 不配第二会合点的宿主——也就是缺省配置的每一台——公告表里没有这个名字，
 * `relay.grant` 对它仍是 `unknown-method`，名册里也不会因此多出一个块：缺省
 * 宿主的握手与名册与这条通道出现之前逐字相同。
 *
 * 正因为它是**条件**公告，{@link MINOR} 不随它抬格：minor 描述的是这个协议本身，
 * 而缺省宿主在线路上读不到任何新东西（设计冻结在 21）。客户端因此按名字判断而不是
 * 按 minor 判断：读不到这个名字就什么都不发。
 */
export const CAP_RELAY_TIER = 'relay.tier.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be answered with
 * byte-level increments instead of the whole roster or the whole board.
 *
 * Behind it, `session.list` and `board.snapshot` (the latter through the board
 * plugin, §15) accept an opaque `since` token and answer either the whole set
 * (`mode:"reset"`) or only what changed since the set that token names. A
 * client that does not declare it — including every client written before this
 * channel existed — is answered today's body plus the ignorable `mode` and
 * `token` keys, with `mode` always `"reset"`.
 */
export const CAP_DELTA = 'delta.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be told that an
 * archived session is not in the roster at all.
 *
 * Unlike every capability beside it this one negotiates nothing: the bridge
 * never transfers an archived session, whether or not a client declares it, so
 * an older client simply receives the shorter roster it would have hidden
 * anyway. The name is an announcement of that fact, so a client can stop
 * filtering for itself: behind it, no `session.list` row is a session the
 * host's archive set names, a row that does survive still carries
 * `archived: false` under the same schema, and a live child of an archived
 * parent still crosses with its `parentSessionId` — the parent id, not the
 * parent row.
 */
export const CAP_ROSTER_OMITS_ARCHIVED = 'session.list.omit-archived.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be answered a
 * compact roster it can page.
 *
 * The declaration alone changes nothing: a listing that carries none of the
 * compact parameters (`cwd`, `maxRows`, `after`) is answered exactly the body
 * protocol v1 always served, so a client can opt into the name before it
 * relies on any of it. Behind the parameters, a row drops its absolute `cwd`
 * unless the request asks for it, drops its `updatedAt` when this connection
 * already sent that id the same value, and a `maxRows`/`after` pair cuts the
 * roster into pages ordered most recent first. The roster is the most repeated
 * large reply on the link, so this is what lets a reconnect pay for the newest
 * screenful plus a cursor instead of the whole list again.
 */
export const CAP_ROSTER_COMPACT = 'session.list.compact.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be told that this
 * bridge can page a session's durable history down to its oldest entry.
 *
 * The capability is an announcement and nothing more. `session.history.deep` is
 * open to every paired connection, exactly as `session.history` is, because it
 * is a pure read of the session store that costs no other client anything;
 * declaring the capability is how a client learns the method exists, and a
 * client that does not declare it loses only that knowledge.
 */
export const CAP_SESSION_DEEP_HISTORY = 'session.deep-history.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to fork a session.
 *
 * Declaring it is what makes `session.fork` part of that client's protocol at
 * all: a client that does not declare it — including every client written
 * before this channel existed — is refused `unknown-method`, and no fork is
 * asked of the host on its behalf. Behind the name the bridge forwards one
 * `SessionForkRequest` to the host's `session/fork` and hands back the host's
 * own `SessionForkValue`, so what a fork point means stays the host's: an
 * `atSeq` is the source event seq the fork includes, an omitted one is the
 * newest finished turn, and a cut the host opens itself is closed by the host's
 * own synthetic finishing event. Nothing about a fork is modelled or
 * re-derived here.
 */
export const CAP_SESSION_FORK = 'session.fork.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to list a session's
 * slash commands and skills and to run one of them.
 *
 * Declaring it is what makes `session.commands` and `session.command` part of
 * that client's protocol at all: a client that does not declare it — including
 * every client written before this channel existed — is refused both as unknown
 * methods, exactly as those frames were refused before. Neither method is called
 * on a connection's behalf either, so a client that never asks costs the host no
 * registry read and no skill catalog read.
 *
 * The channel holds no events and no cache: a directory is read live on every
 * call, so a command a plugin registered a moment ago and a skill withdrawn from
 * one Agent preset are both reflected in the answer that follows.
 */
export const CAP_COMMANDS = 'commands.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to read the host's
 * workspaces and its two registry-global session sets.
 *
 * Declaring it is what makes `workspace.list` part of that client's protocol at
 * all: a client that does not declare it — including every client written before
 * this channel existed — is refused that frame as an unknown method, and no
 * registry is read on its behalf. Behind the name the answer is the host's own
 * synchronous projection: one row per registered workspace in registry order,
 * plus the complete archive and pin sets.
 *
 * The method is a read and nothing is cached, so a pin or an archive followed by
 * another list reads the set the write left behind. That pair of calls is the
 * whole refresh story of the session-admin channel: see {@link CAP_SESSION_ADMIN}.
 */
export const CAP_WORKSPACE = 'workspace.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to rename, pin,
 * unpin, archive and unarchive a session.
 *
 * Declaring it is what makes those five methods part of that client's protocol
 * at all: a client that does not declare it — including every client written
 * before this channel existed — is refused each as an unknown method, and no
 * write is asked of the host on its behalf.
 *
 * Every one of the five is forwarded one-to-one to the endpoint that already
 * owns the semantics, so nothing about a title, a pin or an archive is modelled
 * or re-derived here: a rename reaches `session/rename` — the endpoint that
 * restores a cold session before it writes, which is why a client needs no
 * resume path of its own — and the four set mutations reach
 * `workspace/pinSession`, `workspace/unpinSession`, `workspace/archiveSession`
 * and `workspace/unarchiveSession`. A host refusal crosses with its own code
 * and text, `workspace/session-active` included.
 *
 * The channel publishes no event, because the host announces none of these
 * writes as a cordis event a connection could fold into a delta: a rename
 * appends one `session/title` log record and nothing else. A client re-reads
 * after a write instead — the pin set through {@link CAP_WORKSPACE}, the roster
 * through `session.list` — which is why one branch serves both capabilities.
 */
export const CAP_SESSION_ADMIN = 'session.admin.v1'

/**
 * Capability a client declares in `hello`'s `cap` array to be sent frames
 * compressed instead of as plain text.
 *
 * Declaring it is what allows the host to compress at all: a frame whose JSON
 * text is at least 1024 UTF-8 bytes crosses as one WebSocket binary frame
 * carrying raw DEFLATE (RFC 1951) of exactly that text, and a frame that does
 * not get smaller still crosses as the text frame it always was. A client that
 * does not declare it — including every client written before this capability
 * existed — receives byte for byte the text frames protocol v1 always wrote.
 *
 * The direction is one way: a client still sends text frames only, and the
 * 10 MiB frame cap stays measured on the text, before inflation.
 */
export const CAP_FRAME_DEFLATE = 'frame.deflate.v1'

/**
 * Methods an unpaired connection may still call: the handshake itself and the
 * two pairing steps. Everything else answers `unpaired` — a caller can pair
 * without a device token, but cannot touch a session without one.
 */
export const UNPAIRED_METHODS: ReadonlySet<string> = new Set([
  METHOD_HELLO,
  METHOD_PAIR_BEGIN,
  METHOD_PAIR_FINISH,
])

/** Every method this protocol version serves. */
export const KNOWN_METHODS: ReadonlySet<string> = new Set([
  METHOD_HELLO,
  METHOD_SESSION_LIST,
  METHOD_SESSION_TITLES,
  METHOD_SESSION_SNAPSHOT,
  METHOD_SESSION_HISTORY,
  METHOD_SESSION_HISTORY_DEEP,
  METHOD_SESSION_PROMPT,
  METHOD_SESSION_INTERRUPT,
  METHOD_SESSION_ATTACHMENT,
  METHOD_SESSION_PERMISSIONS,
  METHOD_SESSION_SET_PERMISSION,
  METHOD_SESSION_MODELS,
  METHOD_SESSION_SET_MODEL,
  METHOD_SESSION_SET_EFFORT,
  METHOD_PAIR_BEGIN,
  METHOD_PAIR_FINISH,
  METHOD_APPROVAL_RESOLVE,
  METHOD_QUESTION_ANSWER,
  METHOD_QUESTION_LIST,
  METHOD_JOBS_LIST,
  METHOD_PRESETS_LIST,
  METHOD_SESSION_CREATE,
  METHOD_SESSION_FORK,
  METHOD_SESSION_COMMANDS,
  METHOD_SESSION_COMMAND,
  METHOD_SESSION_RENAME,
  METHOD_SESSION_PIN,
  METHOD_SESSION_UNPIN,
  METHOD_SESSION_ARCHIVE,
  METHOD_SESSION_UNARCHIVE,
  METHOD_WORKSPACE_LIST,
  METHOD_SQUADS_STATE,
  METHOD_SQUADS_LIST,
  METHOD_SQUADS_RUNS,
  METHOD_SQUADS_RUN_MEMBER,
  METHOD_SQUADS_RUN_SQUAD,
  METHOD_PUSH_REGISTER,
  METHOD_USAGE_SESSION,
  METHOD_USAGE_BALANCE,
  METHOD_USAGE_STATS,
  METHOD_UI_EVENT,
  METHOD_UI_LIST,
  METHOD_RELAY_GRANT,
])

/** Refusal codes the bridge itself raises (DSH failures cross as their own code). */
export const CODE_UNPAIRED = 'unpaired'
export const CODE_UNKNOWN_METHOD = 'unknown-method'
export const CODE_INVALID_ARGS = 'invalid-args'
/**
 * `usage.session` 点名的会话在这个宿主上不存在：宿主自己的会话名册里没有它，
 * 活会话存储里没有它，本进程也从未观察过它的任何事件。它与「会话存在但两项
 * 读数都取不到」是两个答案，后者回的是空对象——一条刚刚开始、还什么都没广播
 * 的会话，以及一条在桥重载前就存在的会话，都在那个状态里：存在而没读数，不是
 * 不存在。
 */
export const CODE_UNKNOWN_SESSION = 'unknown-session'
export const CODE_PROTO_UNSUPPORTED = 'proto-unsupported'
export const CODE_TOKEN_INVALID = 'token-invalid'
export const CODE_NONCE_INVALID = 'nonce-invalid'
export const CODE_SIGNATURE_INVALID = 'signature-invalid'
export const CODE_APPROVAL_UNKNOWN = 'approval-unknown'
/**
 * The bridge does not hold the named question: it never claimed that call id, it
 * already answered it, or the host no longer holds it as answerable. Host
 * failures crossing this method keep their own codes instead.
 */
export const CODE_QUESTION_UNKNOWN = 'question-unknown'
/**
 * The bridge could not read the questions it is holding, so it cannot say which
 * ones are still live. The answer is deliberately not an empty list: a client
 * retires every card a COMPLETE list does not carry, and a read that failed is
 * not a complete one — it is a bridge that cannot answer this question today.
 */
export const CODE_QUESTION_LIST_UNAVAILABLE = 'question-list-unavailable'
/**
 * 本桥不认领这个 `callId`：它从没呈现过这张卡，或者这张卡已被别处结算（宽限窗口
 * 到期、回合被取消、桥卸载）。客户端码表保持开放：除本码之外的未知码不得被读成
 * 「卡已消失」（§11.3 同一句）。
 */
export const CODE_UI_UNKNOWN = 'ui-unknown'
/**
 * 这张卡已经被用户自己的第一条动作结算过（§35.3）。它与 {@link CODE_UI_UNKNOWN}
 * 是两个答案：重复的一次点击是「已经做完了」，不是「这张卡不存在」。
 */
export const CODE_UI_SETTLED = 'ui-settled'
/**
 * 本桥读不出自己持有的卡，所以它说不了哪些还活着。答案故意不是一张空表：客户端
 * 只会按 COMPLETE 的列表退休卡片，一次失败的读不是一张完整的空表，而是这台桥今天
 * 答不了这一问（与 {@link CODE_QUESTION_LIST_UNAVAILABLE} 同一句）。
 */
export const CODE_UI_LIST_UNAVAILABLE = 'ui-list-unavailable'
/**
 * The named session is a delegated child whose durable parent is not a session
 * this connection may read. The bridge follows an addressable child and refuses
 * an unaddressable one, rather than reading it blind.
 */
export const CODE_SESSION_NOT_FOLLOWABLE = 'session-not-followable'
export const CODE_SNAPSHOT_UNAVAILABLE = 'snapshot-unavailable'
/**
 * This host composes no job registry, so it has no background jobs to publish.
 * The capability stays advertised — it is a fact about this bridge, not about
 * what a particular host mounts — and only a call that needs the registry fails.
 */
export const CODE_JOBS_UNAVAILABLE = 'jobs-unavailable'
/**
 * This host serves no endpoint behind the command channel: no `commands/list`,
 * no `commands/execute` or no `skills/list`, which the gateway itself reports
 * as an endpoint nothing exports. The capability stays advertised — it is a fact
 * about this bridge, not about what a particular host mounts — and only a call
 * that needs those endpoints fails.
 */
export const CODE_COMMANDS_UNAVAILABLE = 'commands-unavailable'
/**
 * This host serves no squad domain this bridge can reach: no answer to the
 * plugin's state route over loopback, no readable ledger beside it, or a body
 * this build cannot read as one squad domain. The capability stays advertised —
 * it is a fact about this bridge, not about what a particular host mounts — and
 * only a call that needs the domain fails. A refusal the `dsh-agents` plugin
 * itself raised crosses with the plugin's own code instead (`team-not-found`,
 * `member-not-found`, `preset-unknown`, `workspace-unavailable` and their
 * neighbours).
 */
export const CODE_SQUADS_UNAVAILABLE = 'squads-unavailable'
/**
 * The definitions are readable but the two run commands cannot be served: this
 * host answered no run route over loopback, and the read-only ledger fallback
 * cannot launch anything. Failing closed is the point — a client is told the
 * capability is not served here rather than shown a run that never started.
 */
export const CODE_SQUADS_RUN_UNAVAILABLE = 'squads-run-unavailable'
export const CODE_SNAPSHOT_TOO_LARGE = 'snapshot-too-large'
export const CODE_INTERNAL = 'internal'

/** Protocol version this package speaks. */
export const PROTO = 1
/**
 * Minor version this package speaks.
 *
 * 21 当可交互回复（协议 §35）落地：新增 {@link CAP_UI} 与 {@link CAP_UI_LIST}
 * 两个能力名、{@link TOPIC_UI_REQUEST} 一个主题、{@link METHOD_UI_EVENT} 与
 * {@link METHOD_UI_LIST} 两个方法，宿主半区还多一个模型工具 `ui_present`。客户端
 * 因此从线路上读到两项新能力名、一种新主题与两种新应答体，所以 minor 抬一格；
 * `proto` 仍为 1，没有任何既有帧、既有方法或既有键改形状。工具结果是**新增**的：
 * 老会话、老 prompt、老回合都不受影响，工具名进入宿主工具表之后只有新回合才可能
 * 被调用。
 * 20 when the usage stats channel shipped: behind {@link CAP_USAGE_STATS} a
 * client may call {@link METHOD_USAGE_STATS} and read the host's own usage
 * ledger — today, this month and one row per local day — and behind the same
 * {@link CAP_USAGE} this bridge now also answers `usage.session` with a
 * `modelContextWindow` when the model catalog of the session's route declares
 * one, so a client reads one new reply body and one new optional key off the
 * wire and has to read the name before it asks. The stats half is independent
 * of {@link CAP_USAGE} on purpose: it reads another plugin's HTTP routes, which
 * a host may not mount at all, so a client written before this name existed
 * keeps the two readings it had and the bridge reads no route on its behalf.
 * No frame, no topic, no existing method and no existing key changes shape.
 * 19 when the usage channel shipped: behind {@link CAP_USAGE} a client may call
 * {@link METHOD_USAGE_SESSION} and read one session's context window and its
 * request's estimated composition, and {@link METHOD_USAGE_BALANCE} and read the
 * account behind one provider route, so it reads two new reply bodies off the
 * wire and has to read the name before it asks — a bridge below this one answers
 * `unknown-method` for both. No frame, no topic and no existing method changes
 * shape.
 * 18 when one card learned to lay out several sessions (§30 of
 * `docs/protocol-v1.md` in the iphone_remote_use_dsh repository): `content-state`
 * gains the optional `rows` key, so a phone reads up to three sessions off one
 * lock-screen card instead of having to hold one card per session. It is a pure
 * addition — no new method, no new capability name, no existing key or topic
 * changes shape — so the minor counts the key alone, and a client that reads 18
 * knows the order of the rows it is handed is the bridge's rather than one it
 * has to derive.
 * 17 when the live-activity channel shipped (§29.2): this bridge now sends the
 * lock-screen card a suspended app cannot update itself, addressed to the
 * per-card APNs tokens {@link METHOD_PUSH_REGISTER} already carries and projected
 * per session rather than per bridge. It is a pure addition — no new method, no
 * new capability name, and no existing frame, field or topic changes shape — so
 * the minor counts it alone: a client that wants a card has to read 17 before it
 * registers one, because a bridge below this one has no sending path at all and
 * would answer `ok:true` to a registration it can never use.
 * 16 when the push channel shipped: behind {@link CAP_PUSH} a client may call
 * {@link METHOD_PUSH_REGISTER} and have the device table remember an APNs token,
 * so a phone learns a turn ended — or that a question is waiting — while its
 * socket is not open. No frame, no topic and no existing method changes shape;
 * the minor is raised because a new reply body and a new announcement appear on
 * the wire, and because a client has to read the name before it registers.
 * 15 when the squads channel shipped: behind {@link CAP_SQUADS} a client may
 * call {@link METHOD_SQUADS_STATE}, {@link METHOD_SQUADS_LIST},
 * {@link METHOD_SQUADS_RUNS}, {@link METHOD_SQUADS_RUN_MEMBER} and
 * {@link METHOD_SQUADS_RUN_SQUAD}, so it reads five new reply bodies off the wire
 * and drives the squad domain instead of deriving its agents from anything else.
 * 14 when the session-admin channel shipped: behind {@link CAP_WORKSPACE} a
 * client may call {@link METHOD_WORKSPACE_LIST} and read the host's workspaces
 * with both registry-global session sets, and behind {@link CAP_SESSION_ADMIN}
 * it may call {@link METHOD_SESSION_RENAME}, {@link METHOD_SESSION_PIN},
 * {@link METHOD_SESSION_UNPIN}, {@link METHOD_SESSION_ARCHIVE} and
 * {@link METHOD_SESSION_UNARCHIVE}, so a phone long-presses a roster row for the
 * same five actions the desktop offers it.
 * 13 when the question list shipped: behind {@link CAP_QUESTION_LIST} a client
 * may call {@link METHOD_QUESTION_LIST} and be answered the questions this
 * bridge is still holding, so it reads a new reply body off the wire and the
 * number rises with it. It is what lets a phone stop trusting a card it holds:
 * the one retirement signal before it was `question.request` with
 * `state: "settled"`, which a phone that was disconnected when the last client
 * left never receives.
 * 12 when the command channel shipped: behind {@link CAP_COMMANDS} a client may
 * call {@link METHOD_SESSION_COMMANDS} and {@link METHOD_SESSION_COMMAND}, so it
 * reads a new reply body off the wire and the number rises with it.
 * 11 when the fork channel shipped: behind {@link CAP_SESSION_FORK} a client may
 * call {@link METHOD_SESSION_FORK} and receive the host's own fork answer, so a
 * phone branches a session that inherits the context of the one it forked. This
 * is the second of two appends cut from 9 — the snapshot-`since` channel took
 * 10 on the integration branch first — so the number steps over the one already
 * on `dev`: the minor counts additions to this protocol, and a later landing
 * steps over the earlier one instead of reusing its number.
 * 10 when the snapshot became incremental on request: behind
 * {@link CAP_SESSION_SNAPSHOT_SINCE} a `session.snapshot` that names `sinceSeq`
 * is answered either the entries above that watermark or a full baseline
 * carrying `mode` and `reset`, so a client reads a new reply shape off the
 * wire and the number rises with it.
 * 9 when the compact roster shipped: behind {@link CAP_ROSTER_COMPACT} a
 * `session.list` that names one of the compact parameters is answered a
 * shorter row and may be cut into pages, so a client reads a new row schema
 * off the wire and the number rises with it.
 * 8 when the outbound frame form became a capability: behind
 * {@link CAP_FRAME_DEFLATE} a declaring client may be answered in binary
 * frames carrying raw DEFLATE of the text, so the minor is raised for a change
 * a client reads off the wire rather than for a name alone.
 * 7 when the two channels met: the agent channel and the durable history
 * channel each raised 5 to 6 on its own branch, so the protocol that carries
 * both is 7. 6 when the agent channel shipped: behind {@link CAP_AGENTS}
 * `presets.list` forwards the host's Agent-preset roster and `session.create`
 * hands the host one creation request, both verbatim. 6 was also the durable
 * history channel on its own: behind {@link CAP_SESSION_DEEP_HISTORY} a client
 * may call {@link METHOD_SESSION_HISTORY_DEEP} and walk a session's store back
 * to its oldest entry, below the follow window `session.history` slices. 5 when
 * the roster stopped carrying archived sessions: behind
 * {@link CAP_ROSTER_OMITS_ARCHIVED} `session.list` names no session the host's
 * archive set holds, so a session archived between two listings arrives as a
 * removal and one restored as a change. 4 when byte-level increments shipped:
 * behind {@link CAP_DELTA} `session.list` and `board.snapshot` answer a reset
 * or a delta against a `since` token. 3 was
 * the background-job channel — behind {@link CAP_JOBS} a client may call
 * `jobs.list` and receive `jobs.changed`. 2 was the subagent thread —
 * a `user-message` delta may carry an `actor` and a `subagent` delta exists
 * behind {@link CAP_SUBAGENT_THREAD}. 1 was the extension seam — a mounted
 * plugin may answer methods outside {@link KNOWN_METHODS} once the client
 * declares the capability that plugin requires. No addition changed the major
 * version, a frozen field, or an existing method or topic name.
 */
export const MINOR = 21

/**
 * The capabilities this bridge itself serves, and the opening half of what
 * `hello` advertises.
 *
 * A capability a mounted plugin adds is not listed here — the bridge is not its
 * author and names none of them — but `hello` advertises it all the same: the
 * answer is this list plus every capability the extension registry currently
 * requires a client to declare (`RemoteBridgeRegistry.capabilities`), computed
 * on each greeting so a plugin mounted after this bridge was built is visible
 * to the next phone. A name both halves carry is listed once, and this list
 * keeps its order at the front, so a bridge with no extension mounted answers
 * byte for byte the list it always did. Extension names never move
 * {@link MINOR}: that number describes this protocol, and a plugin's own names
 * are the plugin's.
 *
 * A capability whose whole switch is a declaration — no method, no answer, no
 * field behind it, such as {@link CAP_APPROVALS} — stays out of this list for
 * the reason it always did: advertising it would claim a handshake change
 * without one.
 */
export const SERVED_CAPABILITIES: readonly string[] = [
  CAP_SESSION_SNAPSHOT_TRIM,
  CAP_SESSION_SNAPSHOT_PAGE,
  CAP_QUESTIONS,
  CAP_QUESTION_LIST,
  CAP_SUBAGENT_THREAD,
  CAP_JOBS,
  CAP_AGENTS,
  CAP_DELTA,
  CAP_ROSTER_OMITS_ARCHIVED,
  CAP_SESSION_DEEP_HISTORY,
  CAP_FRAME_DEFLATE,
  CAP_ROSTER_COMPACT,
  CAP_SESSION_SNAPSHOT_SINCE,
  CAP_SESSION_FORK,
  CAP_COMMANDS,
  CAP_WORKSPACE,
  CAP_SESSION_ADMIN,
  CAP_SQUADS,
  CAP_PUSH,
  CAP_USAGE,
  CAP_USAGE_STATS,
  CAP_UI,
  CAP_UI_LIST,
]
/** `server` field of the hello response. */
export const SERVER_ID = 'dsh-remote-bridge'

/** Exact route path of the bridge's WebSocket endpoint. */
export const WS_PATH = '/ios/v1'
/** Exact route path of the loopback-only bootstrap token endpoint. */
export const PAIR_TOKEN_PATH = '/remote-bridge/pair/token'
