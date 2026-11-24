/**
 * `usage.v1` 的两个读数：一条会话下一次请求由什么组成，以及某个 provider
 * 路由背后账户的余额；外加 `usage.stats.v1` 那一份宿主台账的聚合（见
 * `usage-stats.ts`，本模块只把它的读数转发出去）。
 *
 * 前两半都是「本进程自己的事实」，所以谁都不去打断会话，也不落盘：
 *
 * - 会话那一半折的是宿主经 `session/event` 广播给本进程的事件。上下文窗口
 *   只有宿主真正广播过才有（最近一次 `request/context` 的 `contextWindow`），
 *   组成由本桥按文本长度折算，因此 `composition` 恒带 `estimated: true`：它是
 *   估算，永不冒充宿主读数。
 * - 余额那一半只在路由确实指向官方 origin、且凭据确实拿得到时才发一次上游
 *   请求。同一 provider + 凭据在 {@link BALANCE_CACHE_TTL_MS} 内最多一次，
 *   并发调用合并成一次；401、超时与形状不符都回 `probe-failed`，绝不把上一
 *   次的旧值当成新值发出去。
 *
 * 宿主服务一律走结构化 face：一个服务没挂载就少一档读数，而不是让整条方法
 * 失败（`session-meta.ts` 与 `wire.ts` 都是同一套理由）。
 *
 * 会话那一半还有第三档读数：宿主从未广播过 `request/context` 窗口时，去问那条
 * 路由的模型目录（`GET {baseURL}/models`），把模型自己声明的窗口填进
 * `modelContextWindow`。两个键永不混用——`contextWindow` 恒为宿主实测，
 * `modelContextWindow` 恒为模型声明，客户端据此能分辨该相信谁；宿主广播过窗口时
 * 这一档根本不出现。
 * @module dsh-remote-bridge/core/usage
 */

import { failureText } from './gateway-errors.ts'
import { METHOD_USAGE_BALANCE, METHOD_USAGE_SESSION } from './protocol.ts'
import type { SessionStoreFace } from './session-meta.ts'
import { STATS_DAYS_DEFAULT, type UsageStatsAnswer, type UsageStatsReader } from './usage-stats.ts'

/** `usage.v1` 背后的两个方法：能力门按这一张表判定。 */
export const USAGE_METHODS: ReadonlySet<string> = new Set([METHOD_USAGE_SESSION, METHOD_USAGE_BALANCE])

/** 折算分母：一份 token 约合四个 UTF-8 字节。 */
export const BYTES_PER_TOKEN = 4

/** 会话折叠最多记住多少条会话，超出时丢最早的一条。 */
export const USAGE_SESSIONS_MAX = 512

/**
 * 宿主名册在本进程里的缓存窗口。
 *
 * 名册只在「活会话存储没有、事件折叠也没有」时才读，但一次开屏可能连着问几条，
 * 所以同一个窗口内的多次存在性判定共用一次读取；窗口取得很短，是因为名册本身
 * 会随新建会话变化。
 */
export const ROSTER_CACHE_TTL_MS = 5_000

/** 同一个 provider + 凭据在这个窗口内最多打一次上游。 */
export const BALANCE_CACHE_TTL_MS = 60_000

/** 一次上游探测的超时；超时与 401 一样是 `probe-failed`。 */
export const BALANCE_PROBE_TIMEOUT_MS = 10_000

/** 余额缓存最多记住多少个 provider + 凭据组合。 */
export const BALANCE_CACHE_LIMIT = 64

/**
 * 一条路由的模型目录在这个窗口内最多读一次。
 *
 * 目录里的窗口是模型自己声明的静态事实，不会因为一次请求而变化，所以这一档比
 * 余额那一档长得多：10 分钟既跟得上用户改配置，也不会让每次 `usage.session`
 * 都打一次上游。
 */
export const MODEL_WINDOW_CACHE_TTL_MS = 600_000

/** 一次模型目录探测的超时；超时与 404 一样是「这次没读到」。 */
export const MODEL_WINDOW_PROBE_TIMEOUT_MS = 5_000

/** 模型目录缓存最多记住多少条路由。 */
export const MODEL_WINDOW_CACHE_LIMIT = 32

/**
 * 官方 DeepSeek 的 API origin。
 *
 * 余额端点是按 origin 记账的：只有确实发往这里的路由才查得到官方账户的钱。
 */
export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com'

/** 官方余额端点；金额单位为元，形如 `balance_infos:[{currency,total_balance,...}]`。 */
const DEEPSEEK_BALANCE_URL = `${DEEPSEEK_API_ORIGIN}/user/balance`

/** 官方余额适配认的 provider 路由 id，与 dsh-usage 的 deepseek adapter 同一份名单。 */
const DEEPSEEK_ROUTES: ReadonlySet<string> = new Set(['deepseek', 'deepseek-official'])

/** 官方 App 托管账户的路由 id（走 `ctx.deepseekAccount.getBalance`）。 */
const DEEPSEEK_ACCOUNT_ROUTE = 'deepseek-account'

/** pi-ai 凭据记录的 scope：一条记录以 `<scope>/<id>` 寻址。 */
const PI_AI_CREDENTIAL_SCOPE = 'llm-pi-ai'

/** pi-ai 适配器的设置命名空间。 */
const PI_AI_SETTINGS_NS = 'llm-pi-ai'

/** 官方 DeepSeek 适配器的设置命名空间。 */
const DEEPSEEK_SETTINGS_NS = 'llm-deepseek'

/** 官方适配器没配 `apiKeyEnv` 时读的环境变量名。 */
const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** UTF-8 编码器：宿主与浏览器两侧都是同一个实现，所以长度口径处处一致。 */
const encoder = new TextEncoder()

/** 一条会话事件里本模块读到的字段；结构化读取，不导入 SDK 的事件类型。 */
export interface UsageEventLike {
  readonly type: string
  readonly data?: unknown
}

/** 一条会话下一次请求的组成估算，单位 token，三格各自向下取整。 */
export interface UsageComposition {
  /** system 消息文本折算出来的分量。 */
  readonly system: number
  /** 最近一次 `request/header` 的 tools schema 原文折算出来的分量。 */
  readonly tools: number
  /** 会话里已观察到的消息文本折算出来的分量。 */
  readonly messages: number
  /** 恒为 true：这是本桥的估算，宿主从未广播过这个数字。 */
  readonly estimated: true
}

/** `usage.session` 的应答体；两项都取不到时是空对象。 */
export interface UsageSessionAnswer {
  /** 宿主广播过的上下文窗口；没广播过就没有这个键。 */
  readonly contextWindow?: number
  /**
   * 会话当前路由的模型目录声明的窗口；宿主广播过 `contextWindow` 时永不出现，
   * 目录也取不到时同样不出现。
   *
   * 它与 {@link contextWindow} 是两个来源：那个是宿主实测，这个是模型声明。两者
   * 不得混用，所以这个键的存在本身就说明「宿主没有实测值」。
   */
  readonly modelContextWindow?: number
  /** 组成估算；一项都没观察到时没有这个键。 */
  readonly composition?: UsageComposition
}

/** `usage.balance` 支持不到的情况。 */
export type UsageUnsupported = 'no-credential' | 'not-deepseek-route' | 'probe-failed'

/** `usage.balance` 的应答体：要么是一次成功读数的四个金额，要么是为什么读不到。 */
export type UsageBalanceAnswer =
  | {
    readonly provider: string
    readonly currency: string
    readonly total: number
    readonly toppedUp: number
    readonly granted: number
    readonly updatedAt: number
  }
  | {
    readonly provider: string
    readonly unsupported: UsageUnsupported
    readonly reason?: string
  }

/** 一次成功读数里除 provider 与时间戳以外的四个字段。 */
interface ParsedBalance {
  readonly currency: string
  readonly total: number
  readonly toppedUp: number
  readonly granted: number
}

/** 一条会话在本进程里攒下的读数。 */
interface SessionFacts {
  /** 最近一次 `request/context` 广播的上下文窗口。 */
  contextWindow?: number
  /** 最近一次 `request/header` 的 tools schema 原文长度；undefined 表示还没广播过。 */
  toolsBytes?: number
  /** 最近一条 system 消息文本的长度；undefined 表示还没广播过。 */
  systemBytes?: number
  /** 已观察到的消息文本累计长度。 */
  messagesBytes: number
  /** 是否已经观察过任何一条消息事件。 */
  sawMessages: boolean
}

/**
 * 会话事件的折叠：一条会话最近一次广播过的上下文窗口，以及它的组成原文长度。
 *
 * 只在事件里出现过的会话才有记录，所以「宿主没广播过」与「值恰好是 0」是
 * 两件不同的事，应答里也就不会把没观察到的分量当成读数发出去。
 */
export class UsageTracker {
  readonly #limit: number
  readonly #facts = new Map<string, SessionFacts>()

  /**
   * @param limit - 最多记住多少条会话；默认 {@link USAGE_SESSIONS_MAX}。
   */
  constructor(limit = USAGE_SESSIONS_MAX) {
    this.#limit = limit
  }

  /**
   * 折进一条会话事件。
   *
   * 只认四类会改变读数的原文：`request/context` 的窗口、`request/header` 的
   * tools schema、`system/message` 的 system 文本，以及 `user/message`、
   * `assistant/message` 与 `tool/result` 的消息文本。其余事件一概不落记录，
   * 所以一条只跑工具事件的会话不会凭空长出一条组成。
   * @param sessionId - 事件所属会话。
   * @param event - 宿主广播的事件。
   */
  record(sessionId: string, event: UsageEventLike): void {
    if (sessionId === '' || typeof event?.type !== 'string') return
    const data = event.data
    switch (event.type) {
      case 'request/context': {
        const window = contextWindowOf(data)
        if (window === undefined) return
        this.#factsFor(sessionId).contextWindow = window
        return
      }
      case 'request/header': {
        // header 到了就算观察过：一条不带 tools 的 header 是「这次请求没有
        // 工具」，tools 分量因此是真实的 0，而不是没观察到。
        const header = isRecord(data) ? data.header : undefined
        if (!isRecord(header)) return
        const tools = header.tools ?? []
        this.#factsFor(sessionId).toolsBytes = utf8Bytes(JSON.stringify(tools) ?? '')
        return
      }
      case 'system/message': {
        // system 提示词是派生历史：最近一条 system 消息就是当前的提示词，
        // 早先那条被替换掉的文本不该再算一遍。
        this.#factsFor(sessionId).systemBytes = utf8Bytes(messageText(messageOf(data)))
        return
      }
      case 'user/message':
      case 'assistant/message':
      case 'tool/result': {
        const facts = this.#factsFor(sessionId)
        facts.messagesBytes += utf8Bytes(messageText(messageOf(data)))
        facts.sawMessages = true
        return
      }
      default: return
    }
  }

  /**
   * 本进程是否观察过这条会话。
   * @param sessionId - 会话 id。
   * @returns 观察到过任何一条相关事件时为 true。
   */
  known(sessionId: string): boolean {
    return this.#facts.has(sessionId)
  }

  /**
   * 一条会话的读数，两项都取不到时是空对象。
   *
   * 空对象而不是 0：一个还没广播过窗口、也没观察到任何原文的会话，本桥对
   * 它的组成一无所知，编一个 0 会把「不知道」说成「没有内容」。
   * @param sessionId - 会话 id。
   * @returns 应答体，字段按观察到的部分给出。
   */
  answer(sessionId: string): UsageSessionAnswer {
    const facts = this.#facts.get(sessionId)
    const composition = facts === undefined ? undefined : compositionOf(facts)
    if (facts?.contextWindow === undefined && composition === undefined) return {}
    return {
      ...(facts?.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow }),
      ...(composition === undefined ? {} : { composition }),
    }
  }

  /** 取（必要时新建）一条会话的记录，并维持容量上界。 */
  #factsFor(sessionId: string): SessionFacts {
    const existing = this.#facts.get(sessionId)
    if (existing !== undefined) return existing
    const fresh: SessionFacts = { messagesBytes: 0, sawMessages: false }
    this.#facts.set(sessionId, fresh)
    while (this.#facts.size > this.#limit) {
      const oldest = this.#facts.keys().next()
      if (oldest.done === true) break
      this.#facts.delete(oldest.value)
    }
    return fresh
  }
}

/** 凭据服务的一角：pi-ai 记录与外部引用。 */
export interface CredentialStoreFace {
  readRecord(key: string): Promise<{ readonly kind?: string; readonly key?: string } | undefined>
  resolve(ref: string): Promise<{ readonly value?: string } | undefined>
}

/** 设置服务的一角：按命名空间读一段解析后的配置。 */
export interface SettingsFace {
  get?(ns: string): unknown
  describe?(options?: unknown): readonly { readonly ns?: string; readonly value?: unknown }[]
}

/**
 * 宿主自己的会话名册。
 *
 * 这是 `session.list` 服务的同一个来源，也就是手机名册的来源：它名下既有活的
 * 会话，也有本进程没观察过、甚至当前不 live 的会话。活会话存储答不了这一问
 * 的一半（`ctx.sessions.list()` 只列已进入存储的会话），所以名册单独一格。
 */
export interface SessionRosterFace {
  /**
   * 名册里的会话 id。
   * @returns id 列表；读不到时回 undefined，调用方据此退回「不知道名册」。
   */
  ids(): Promise<readonly string[] | undefined>
}

/** 一条会话此刻的路由：下一步要用哪个 provider 的哪个模型。 */
export interface SessionRouteFace {
  /**
   * 一条会话当前的路由。
   *
   * 与 `session.models` 的 `current` 同一个折叠：下一步的选择、其次是用过的
   * 那个、最后才是目录默认——三者都不是本模块能自己推的，所以只转发。
   * @param sessionId - 会话 id。
   * @returns provider 与模型 id，或者 undefined 表示这条路由读不到。
   */
  current(sessionId: string): Promise<{ readonly provider: string; readonly model: string } | undefined>
}

/** 官方 DeepSeek 请求鉴权服务（`ctx.deepseekAuth`，DSH 0.2.3-alpha.2+）。 */
export interface DeepSeekAuthFace {
  authorize(request: {
    readonly consumer: string
    readonly accepts: readonly ('account' | 'api-key')[]
    readonly billing: 'auto' | 'account' | 'api-key'
    readonly route?: string
    readonly destination: { readonly path: string }
  }, signal?: AbortSignal): Promise<{
    readonly kind: 'account' | 'api-key'
    readonly endpoint: string
    readonly headers: Readonly<Record<string, string>>
  } | undefined>
}

/** 官方 DeepSeek 账号钱包条目（`ctx.deepseekAccount`）。 */
export interface DeepSeekAccountWalletFace {
  readonly currency: string
  readonly balance: string
}

/** 官方 DeepSeek 账号余额服务（`ctx.deepseekAccount`）。 */
export interface DeepSeekAccountFace {
  getState(): Promise<{ readonly status: 'signed-out' | 'credential-stored' }>
  getBalance(client: {
    readonly version: string
    readonly locale: string
    readonly timezoneOffsetSeconds: number
  }): Promise<
    | {
        readonly status: 'ready'
        readonly value: readonly DeepSeekAccountWalletFace[]
        readonly bonusWallets: readonly DeepSeekAccountWalletFace[]
      }
    | { readonly status: 'failed' }
    | null
  >
}

/** 本模块要读的宿主服务；每一个都可能不存在。 */
export interface UsageFaces {
  /** 活会话的存储：`usage.session` 靠它区分「不存在」与「存在但没读数」。 */
  readonly sessions?: SessionStoreFace | undefined
  /** 宿主自己的会话名册：本进程没观察过的会话靠它证明自己存在。 */
  readonly roster?: SessionRosterFace | undefined
  /** 凭据服务：余额探测的密钥来源。 */
  readonly credentials?: CredentialStoreFace | undefined
  /** 设置服务：路由的 `apiKeyEnv` 与 `baseURL` 来源。 */
  readonly settings?: SettingsFace | undefined
  /** 会话此刻的路由：`modelContextWindow` 的来源。 */
  readonly route?: SessionRouteFace | undefined
  /** 官方 DeepSeek 请求鉴权服务（优先于手工凭据解析）。 */
  readonly deepseekAuth?: DeepSeekAuthFace | undefined
  /** 官方 DeepSeek App 托管账户余额服务。 */
  readonly deepseekAccount?: DeepSeekAccountFace | undefined
}

/** 上游探测用的 fetch 一角。 */
export type FetchFace = (
  url: string,
  init?: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>

/** 构造 {@link UsageService} 的全部输入。 */
export interface UsageServiceOptions {
  /** 每读一次宿主服务都重新解析一次，晚挂载的服务因此也能被读到。 */
  readonly faces: () => UsageFaces
  /** 缓存窗口与 `updatedAt` 读的时钟。 */
  readonly now: () => number
  /** 读不到宿主服务时的落点。 */
  readonly log: (message: string) => void
  /** 上游探测；默认用本进程的 `fetch`。 */
  readonly fetch?: FetchFace
  /** 余额缓存窗口；默认 {@link BALANCE_CACHE_TTL_MS}。 */
  readonly ttlMs?: number
  /** 一次探测的超时；默认 {@link BALANCE_PROBE_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
  /** 模型目录探测的超时；默认 {@link MODEL_WINDOW_PROBE_TIMEOUT_MS}。 */
  readonly modelTimeoutMs?: number
  /** 宿主台账的聚合；没有它时 `usage.stats` 答 `probe-failed`。 */
  readonly stats?: UsageStatsReader
}

/**
 * `usage.v1` 的两条方法背后的读服务，一个宿主一份、所有连接共享。
 *
 * 会话读数是宿主的事实而不是某个设备的事实，余额是账户的事实，所以两半都
 * 挂在宿主侧：一部手机重复问、两台手机同时问，都不该让上游多收一个请求。
 */
export class UsageService {
  readonly #options: UsageServiceOptions
  readonly #tracker = new UsageTracker()
  readonly #cache = new Map<string, { readonly at: number; readonly answer: UsageBalanceAnswer }>()
  readonly #inFlight = new Map<string, Promise<UsageBalanceAnswer>>()
  /** 每条路由的模型目录（模型 id → 声明的窗口），以及它是哪一刻读的。 */
  readonly #catalogs = new Map<string, { readonly at: number; readonly windows: ReadonlyMap<string, number> | undefined }>()
  readonly #catalogInFlight = new Map<string, Promise<ReadonlyMap<string, number> | undefined>>()
  /** 最近读到的一份宿主名册，以及它是哪一刻读的。 */
  #roster: { readonly at: number; readonly ids: ReadonlySet<string> | undefined } | undefined

  /**
   * @param options - 宿主服务的解析函数、时钟与上游探测。
   */
  constructor(options: UsageServiceOptions) {
    this.#options = options
  }

  /**
   * 折进一条宿主广播的会话事件。
   *
   * 没广播过的事件不会出现在任何应答里：本模块不读会话日志，也不回填历史，
   * 所以一条在桥挂载前就结束的会话只有活会话存储能证明它存在。
   * @param sessionId - 事件所属会话。
   * @param event - 事件本身。
   */
  record(sessionId: string, event: UsageEventLike): void {
    this.#tracker.record(sessionId, event)
  }

  /**
   * 一条会话的上下文窗口与组成估算。
   *
   * 「不存在」与「存在但两项都取不到」是两个答案，而「存在」有三个证人：活会话
   * 存储里有它、本进程观察过它的事件、或者宿主名册里有它。前两个是同步的，因此
   * 只有两个都答不上来时才会去问名册——名册才是那条「本进程没观察过、当前也不
   * live」的会话唯一的证据，把它说成不存在会变成一次假的失败。
   *
   * 名册也读不到时，证人只剩前两个：这时回 undefined 就是协议的
   * `unknown-session`，与加名册之前逐字一样。
   * @param sessionId - 会话 id。
   * @returns 应答体，或者 undefined 表示这条会话不存在。
   */
  async session(sessionId: string): Promise<UsageSessionAnswer | undefined> {
    if (!this.#live(sessionId) && !this.#tracker.known(sessionId) && !(await this.#inRoster(sessionId))) return undefined
    const answer = this.#tracker.answer(sessionId)
    // 宿主实测优先，且永不混用：广播过窗口时这一档根本不出现，只有没实测值的
    // 会话才去问模型目录。
    if (answer.contextWindow !== undefined) return answer
    const declared = await this.#modelContextWindow(sessionId)
    return declared === undefined ? answer : { ...answer, modelContextWindow: declared }
  }

  /**
   * 宿主自己那份按天记的 token 台账的聚合。
   *
   * 缓存、合并与「读到/没读到」的区分都在 `usage-stats.ts`：那是对另一个插件的
   * HTTP 路由的读数，与本节两半的「本进程自己的事实」不是同一类东西，因此单独
   * 一格。本方法只转发。
   * @param days - 要多少天；省略按 {@link STATS_DAYS_DEFAULT}。
   * @returns 台账聚合，或者为什么读不到。
   */
  async stats(days?: number): Promise<UsageStatsAnswer> {
    const reader = this.#options.stats
    if (reader === undefined) return { unsupported: 'probe-failed', reason: 'no host usage route' }
    return await reader.stats(days ?? STATS_DAYS_DEFAULT)
  }

  /**
   * 一条 provider 路由背后账户的余额，DeepSeek 官方口径。
   *
   * 判定的顺序就是省下上游请求的顺序：不是官方路由的 id 不查，指向别的
   * origin 的路由不查，拿不到凭据不查；只有三关都过了才谈得上缓存与探测。
   * @param provider - 客户端给的 provider 路由 id。
   * @returns 余额，或者为什么读不到。
   */
  async balance(provider: string): Promise<UsageBalanceAnswer> {
    const faces = this.#faces()
    if (provider === DEEPSEEK_ACCOUNT_ROUTE) {
      return await this.#accountBalance(provider, faces.deepseekAccount)
    }
    if (!DEEPSEEK_ROUTES.has(provider)) return { provider, unsupported: 'not-deepseek-route' }
    if (!officialRoute(provider, faces.settings)) return { provider, unsupported: 'not-deepseek-route' }
    const authorized = await this.#deepseekAuthOf(provider, faces)
    const credential = authorized === undefined ? await this.#credentialOf(provider, faces) : undefined
    if (authorized === undefined && credential === undefined) return { provider, unsupported: 'no-credential' }
    const identity = authorized !== undefined
      ? `${authorized.endpoint}\u0000${headerAuthFingerprint(authorized.headers)}`
      : fingerprint(credential as string)
    // 缓存键带上凭据指纹：换一把 key 就是另一个账户，不能被上一把的读数冒充。
    const cacheKey = `${provider}\u0000${identity}`
    const cached = this.#cache.get(cacheKey)
    if (cached !== undefined && this.#options.now() - cached.at < this.#ttl()) return cached.answer
    const running = this.#inFlight.get(cacheKey)
    if (running !== undefined) return await running
    const settle = (answer: UsageBalanceAnswer): UsageBalanceAnswer => {
      this.#remember(cacheKey, answer)
      this.#inFlight.delete(cacheKey)
      return answer
    }
    const probe = (authorized !== undefined
      ? this.#probeAuthorized(provider, authorized.endpoint, authorized.headers)
      : this.#probe(provider, credential as string))
      .then(settle, (error: unknown) => settle({ provider, unsupported: 'probe-failed', reason: failureText(error) }))
    this.#inFlight.set(cacheKey, probe)
    return await probe
  }

  /** 宿主服务的一次解析；解析本身抛错按「什么都没挂载」处理。 */
  #faces(): UsageFaces {
    try {
      return this.#options.faces()
    } catch (error) {
      this.#options.log(`the usage faces could not be resolved: ${failureText(error)}`)
      return {}
    }
  }

  /** 宿主名册里是否有这条会话；没有名册或读不到都按「不知道」处理。 */
  async #inRoster(sessionId: string): Promise<boolean> {
    return (await this.#rosterIds())?.has(sessionId) === true
  }

  /**
   * 一个缓存窗口内的宿主名册。
   *
   * 一次开屏可能连着问几条会话，所以同一窗口内的判定共用一次读取；读失败（或
   * 本进程根本没有名册来源）缓存的是 undefined，也就是「不知道名册」，判定因此
   * 退回活会话存储与事件折叠两条证词。
   */
  async #rosterIds(): Promise<ReadonlySet<string> | undefined> {
    const now = this.#options.now()
    if (this.#roster !== undefined && now - this.#roster.at < ROSTER_CACHE_TTL_MS) return this.#roster.ids
    let ids: ReadonlySet<string> | undefined
    try {
      const read = this.#faces().roster?.ids
      const listed = read === undefined ? undefined : await read()
      ids = listed === undefined ? undefined : new Set(listed)
    } catch (error) {
      this.#options.log(`the host session roster could not be read: ${failureText(error)}`)
      ids = undefined
    }
    this.#roster = { at: this.#options.now(), ids }
    return ids
  }

  /** 活会话存储里是否有这条会话；读不到就按没有处理。 */
  #live(sessionId: string): boolean {
    try {
      return this.#faces().sessions?.get(sessionId) !== undefined
    } catch (error) {
      this.#options.log(`the live session "${sessionId}" could not be read: ${failureText(error)}`)
      return false
    }
  }

  /**
   * 这条路由这一次要用的密钥：pi-ai 的凭据记录，然后 profile 的
   * `apiKeyEnv`，最后官方适配器自己的环境变量引用。
   *
   * 记录里的 OAuth grant 不算凭据：官方余额端点只认 API key，一个 grant 拿
   * 过去只会换来 401，所以这里直接落到环境变量这一档。
   */
  async #credentialOf(provider: string, faces: UsageFaces): Promise<string | undefined> {
    const store = faces.credentials
    if (store === undefined) return undefined
    try {
      const record = await store.readRecord(`${PI_AI_CREDENTIAL_SCOPE}/${provider}`)
      if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key !== '') return record.key
    } catch (error) {
      // 读写不了的记录按不存在处理：下一档是环境变量，那里还有一次机会。
      this.#options.log(`the pi-ai credential of route "${provider}" could not be read: ${failureText(error)}`)
    }
    const name = nonEmptyText(profileOf(faces.settings, provider)?.apiKeyEnv) ?? deepseekApiKeyEnv(faces.settings)
    try {
      const resolved = await store.resolve(name)
      if (typeof resolved?.value === 'string' && resolved.value !== '') return resolved.value
    } catch (error) {
      this.#options.log(`the credential reference "${name}" of route "${provider}" could not be resolved: ${failureText(error)}`)
    }
    return undefined
  }

  /** 优先向官方 `ctx.deepseekAuth` 申请余额请求头，仅接受指向官方 origin 的 api-key 授权。 */
  async #deepseekAuthOf(
    provider: string,
    faces: UsageFaces,
  ): Promise<{ readonly endpoint: string; readonly headers: Record<string, string> } | undefined> {
    const auth = faces.deepseekAuth
    if (auth === undefined || typeof auth.authorize !== 'function') return undefined
    try {
      const authorization = await auth.authorize({
        consumer: 'dsh-remote-bridge',
        accepts: ['api-key'],
        billing: 'api-key',
        route: provider,
        destination: { path: '/user/balance' },
      }, AbortSignal.timeout(this.#timeout()))
      if (authorization === undefined || authorization.kind !== 'api-key') return undefined
      if (originOf(authorization.endpoint) !== DEEPSEEK_API_ORIGIN) return undefined
      return { endpoint: authorization.endpoint, headers: { ...authorization.headers } }
    } catch (error) {
      this.#options.log(`deepseekAuth could not authorize route "${provider}": ${failureText(error)}`)
      return undefined
    }
  }

  /** 通过官方 `ctx.deepseekAccount` 查询 App 托管账户余额，带缓存与并发合并。 */
  async #accountBalance(provider: string, account: DeepSeekAccountFace | undefined): Promise<UsageBalanceAnswer> {
    if (account === undefined || typeof account.getState !== 'function' || typeof account.getBalance !== 'function') {
      return { provider, unsupported: 'not-deepseek-route' }
    }
    const cacheKey = `${provider}\u0000account`
    const cached = this.#cache.get(cacheKey)
    if (cached !== undefined && this.#options.now() - cached.at < this.#ttl()) return cached.answer
    const running = this.#inFlight.get(cacheKey)
    if (running !== undefined) return await running
    const settle = (answer: UsageBalanceAnswer): UsageBalanceAnswer => {
      this.#remember(cacheKey, answer)
      this.#inFlight.delete(cacheKey)
      return answer
    }
    const probe = (async (): Promise<UsageBalanceAnswer> => {
      try {
        const state = await account.getState()
        if (state.status !== 'credential-stored') return { provider, unsupported: 'no-credential' }
        const offsetMin = new Date().getTimezoneOffset()
        const outcome = await account.getBalance({
          version: '0.2.3',
          locale: 'zh-CN',
          timezoneOffsetSeconds: offsetMin === 0 ? 0 : -offsetMin * 60,
        })
        if (outcome === null) return { provider, unsupported: 'no-credential' }
        if (outcome.status === 'failed') return { provider, unsupported: 'probe-failed', reason: 'account balance query failed' }
        const parsed = parseAccountWallets(outcome.value, outcome.bonusWallets)
        return { provider, ...parsed, updatedAt: this.#options.now() }
      } catch (error) {
        return { provider, unsupported: 'probe-failed', reason: failureText(error) }
      }
    })().then(settle, (error: unknown) => settle({ provider, unsupported: 'probe-failed', reason: failureText(error) }))
    this.#inFlight.set(cacheKey, probe)
    return await probe
  }

  /**
   * 对官方余额端点做一次探测。
   *
   * 失败一律折成 `probe-failed` 并带上一条短原因：401、超时与形状不符都是
   * 「这次没读到」，任何一条都不会拿上一轮的旧值顶上。
   */
  async #probe(provider: string, credential: string): Promise<UsageBalanceAnswer> {
    return await this.#probeAuthorized(provider, DEEPSEEK_BALANCE_URL, { authorization: `Bearer ${credential}` })
  }

  async #probeAuthorized(
    provider: string,
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<UsageBalanceAnswer> {
    const call = this.#options.fetch ?? defaultFetch
    try {
      const response = await call(endpoint, {
        headers,
        signal: AbortSignal.timeout(this.#timeout()),
      })
      if (!response.ok) return { provider, unsupported: 'probe-failed', reason: `HTTP ${response.status}` }
      const body: unknown = await response.json().catch(() => undefined)
      const balance = parsedBalance(body)
      if (balance === undefined) return { provider, unsupported: 'probe-failed', reason: 'unrecognized response shape' }
      return { provider, ...balance, updatedAt: this.#options.now() }
    } catch (error) {
      return { provider, unsupported: 'probe-failed', reason: failureText(error) }
    }
  }

  /**
   * 一条会话当前路由的模型声明的上下文窗口。
   *
   * 三关都不打上游请求的顺序：读不到路由不查、路由没有可寻址的 base URL 不查、
   * 目录里没有这个模型就不出现这个键。目录按路由缓存 {@link MODEL_WINDOW_CACHE_TTL_MS}，
   * 读失败也缓存同一窗口——窗口是模型自己声明的静态事实，重试改变不了答案，而每次
   * `usage.session` 都去打一次上游只会把这条路走成噪声。
   * @param sessionId - 会话 id。
   * @returns 模型声明的窗口，或者 undefined 表示这一档取不到。
   */
  async #modelContextWindow(sessionId: string): Promise<number | undefined> {
    const faces = this.#faces()
    const route = faces.route
    if (route === undefined) return undefined
    let selection: { readonly provider: string; readonly model: string } | undefined
    try {
      selection = await route.current(sessionId)
    } catch (error) {
      this.#options.log(`the route of session "${sessionId}" could not be read: ${failureText(error)}`)
      return undefined
    }
    if (selection === undefined) return undefined
    const baseURL = catalogBaseUrl(selection.provider, faces.settings)
    if (baseURL === undefined) return undefined
    const windows = await this.#catalogOf(`${selection.provider}\u0000${baseURL}`, baseURL, selection.provider, faces)
    return windows?.get(selection.model)
  }

  /**
   * 一条路由的模型目录，按窗口缓存并合并并发读。
   * @param key - provider + baseURL 的缓存键。
   * @param baseURL - 目录的地址（已去掉结尾斜杠）。
   * @param provider - 这条目录属于哪个 provider 路由，取凭据用。
   * @param faces - 这一次的宿主服务。
   * @returns 模型 id → 声明的窗口；取不到时 undefined。
   */
  async #catalogOf(key: string, baseURL: string, provider: string, faces: UsageFaces): Promise<ReadonlyMap<string, number> | undefined> {
    const cached = this.#catalogs.get(key)
    if (cached !== undefined && this.#options.now() - cached.at < MODEL_WINDOW_CACHE_TTL_MS) return cached.windows
    const running = this.#catalogInFlight.get(key)
    if (running !== undefined) return await running
    const settle = (windows: ReadonlyMap<string, number> | undefined): ReadonlyMap<string, number> | undefined => {
      this.#rememberCatalog(key, windows)
      this.#catalogInFlight.delete(key)
      return windows
    }
    const read = this.#readCatalog(baseURL, provider, faces).then(settle, () => settle(undefined))
    this.#catalogInFlight.set(key, read)
    return await read
  }

  /**
   * 读一次 `GET {baseURL}/models`。
   *
   * 凭据与账本同源（pi-ai 记录，然后 `apiKeyEnv`）：请求发往这条路由**自己的**
   * origin，所以不需要余额那一档的官方 origin 判定——这里问的是这条路由自己声明的
   * 事实。拿不到凭据也照发，某些自建端点不鉴权；失败一律 undefined。
   * @param baseURL - 目录的地址（已去掉结尾斜杠）。
   * @param provider - 这条目录属于哪个 provider 路由。
   * @param faces - 这一次的宿主服务。
   * @returns 模型 id → 声明的窗口；取不到时 undefined。
   */
  async #readCatalog(baseURL: string, provider: string, faces: UsageFaces): Promise<ReadonlyMap<string, number> | undefined> {
    const call = this.#options.fetch ?? defaultFetch
    const headers: Record<string, string> = { accept: 'application/json' }
    const credential = await this.#credentialOf(provider, faces)
    if (credential !== undefined) headers.authorization = `Bearer ${credential}`
    try {
      const response = await call(`${baseURL}/models`, {
        headers,
        signal: AbortSignal.timeout(this.#modelTimeout()),
      })
      if (!response.ok) return undefined
      const body: unknown = await response.json().catch(() => undefined)
      return catalogWindowsOf(body)
    } catch (error) {
      this.#options.log(`the model catalog of route "${provider}" could not be read: ${failureText(error)}`)
      return undefined
    }
  }

  /** 记一条路由的目录（读到与没读到都记）并维持容量上界。 */
  #rememberCatalog(key: string, windows: ReadonlyMap<string, number> | undefined): void {
    this.#catalogs.delete(key)
    this.#catalogs.set(key, { at: this.#options.now(), windows })
    while (this.#catalogs.size > MODEL_WINDOW_CACHE_LIMIT) {
      const oldest = this.#catalogs.keys().next()
      if (oldest.done === true) return
      this.#catalogs.delete(oldest.value)
    }
  }

  /** 一次模型目录探测的超时。 */
  #modelTimeout(): number {
    return this.#options.modelTimeoutMs ?? MODEL_WINDOW_PROBE_TIMEOUT_MS
  }

  /** 记一次读数（成功与失败都记）并维持容量上界。 */
  #remember(cacheKey: string, answer: UsageBalanceAnswer): void {
    this.#cache.delete(cacheKey)
    this.#cache.set(cacheKey, { at: this.#options.now(), answer })
    while (this.#cache.size > BALANCE_CACHE_LIMIT) {
      const oldest = this.#cache.keys().next()
      if (oldest.done === true) return
      this.#cache.delete(oldest.value)
    }
  }

  /** 余额缓存窗口。 */
  #ttl(): number {
    return this.#options.ttlMs ?? BALANCE_CACHE_TTL_MS
  }

  /** 一次探测的超时。 */
  #timeout(): number {
    return this.#options.timeoutMs ?? BALANCE_PROBE_TIMEOUT_MS
  }
}

/** 默认的探测实现：宿主与浏览器两侧都有全局 fetch。 */
const defaultFetch: FetchFace = (url, init) => globalThis.fetch(url, init)

/** 一条记录的长度：UTF-8 字节数，汉字因此按实际字节计。 */
function utf8Bytes(text: string): number {
  return text === '' ? 0 : encoder.encode(text).length
}

/**
 * 字节数折算成 token：四字节一份，向下取整。
 *
 * 向下而不是四舍五入，是因为一个空数组序列化成 `[]` 也有两个字节，四舍五入会
 * 把一个「这次请求没有工具」的 header 说成占了一份 token。
 */
function tokensOf(bytes: number): number {
  return Math.floor(bytes / BYTES_PER_TOKEN)
}

/** 一条会话的组成估算；一项都没观察到时没有这个读数。 */
function compositionOf(facts: SessionFacts): UsageComposition | undefined {
  if (facts.toolsBytes === undefined && facts.systemBytes === undefined && !facts.sawMessages) return undefined
  return {
    system: tokensOf(facts.systemBytes ?? 0),
    tools: tokensOf(facts.toolsBytes ?? 0),
    messages: tokensOf(facts.messagesBytes),
    estimated: true,
  }
}

/** `request/context` 里可用的上下文窗口：非负有限整数才有意义。 */
function contextWindowOf(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined
  const window = data.contextWindow
  return typeof window === 'number' && Number.isInteger(window) && window > 0 ? window : undefined
}

/** 事件里的消息对象：`system/message` 与 `assistant/message` 包在 `message` 里，`user/message` 就是它本身。 */
function messageOf(data: unknown): unknown {
  return isRecord(data) && isRecord(data.message) ? data.message : data
}

/**
 * 一条消息的模型可见文本。
 *
 * 取的是每个内容块自己的 `text`（工具调用块则是它的 `arguments` 原文）：这两样
 * 是一次请求里真正占 token 的部分，而消息 id、来源记录与流式记录都不占。
 */
function messageText(message: unknown): string {
  const content = isRecord(message) ? message.content : undefined
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block === 'string') {
      text += block
      continue
    }
    if (!isRecord(block)) continue
    if (typeof block.text === 'string') {
      text += block.text
      continue
    }
    if (typeof block.arguments === 'string') text += block.arguments
  }
  return text
}

/**
 * 这条路由的请求是否确实发往官方 origin。
 *
 * 余额端点是按 origin 记账而不是按路由 id：一个共用 `deepseek` 这个 id 的
 * 转售 profile 只改 `baseURL`，拿官方 key 去打官方端点会把官方账户的钱印在
 * 它的名下（串号事故）。配了别的 origin 就回 `not-deepseek-route`；没配
 * origin 的路由用的就是适配器自己的固定端点，也就是官方 origin。
 */
function officialRoute(provider: string, settings: SettingsFace | undefined): boolean {
  const configured = originOf(nonEmptyText(profileOf(settings, provider)?.baseURL) ?? deepseekBaseUrl(settings))
  return configured === undefined || configured === DEEPSEEK_API_ORIGIN
}

/**
 * 一条路由的模型目录地址。
 *
 * 目录挂在路由自己的 base URL 下，所以这里读的是那同一段配置：pi-ai profile 的
 * `baseURL`，其次（官方适配器那几条路由）`llm-deepseek` 的 `baseURL`，都没有时
 * 回官方 origin。别家路由没配 `baseURL` 时回 undefined——适配器自己的默认端点不在
 * 本包的视野里，猜一个只会打到一个不存在的主机上。
 * @param provider - provider 路由 id。
 * @param settings - 设置服务，可能没挂载。
 * @returns 去掉结尾斜杠的 base URL，或者 undefined。
 */
function catalogBaseUrl(provider: string, settings: SettingsFace | undefined): string | undefined {
  const configured = nonEmptyText(profileOf(settings, provider)?.baseURL)
    ?? (DEEPSEEK_ROUTES.has(provider) ? deepseekBaseUrl(settings) : undefined)
  const base = configured ?? (DEEPSEEK_ROUTES.has(provider) ? DEEPSEEK_API_ORIGIN : undefined)
  if (base === undefined) return undefined
  const trimmed = base.trim().replace(/\/+$/, '')
  return trimmed === '' ? undefined : trimmed
}

/**
 * 一份 OpenAI 兼容的 `/models` 应答里，每个模型声明的上下文窗口。
 *
 * 三个字段名按顺序取第一个可用值（`context_length`、`context_window`、
 * `max_input_tokens`）：不同网关各写各的，而它们说的是同一件事。一个都没有的模型
 * 不进表，所以「目录里没写」与「写了个 0」是两件事，前者不会变成后者的读数。
 * @param body - `GET {baseURL}/models` 的应答体。
 * @returns 模型 id → 窗口；形状不符时 undefined。
 */
function catalogWindowsOf(body: unknown): ReadonlyMap<string, number> | undefined {
  const listed = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data) ? body.data : undefined
  if (listed === undefined) return undefined
  const windows = new Map<string, number>()
  for (const entry of listed) {
    if (!isRecord(entry)) continue
    const id = nonEmptyText(entry.id)
    const window = declaredWindowOf(entry)
    if (id === undefined || window === undefined) continue
    windows.set(id, window)
  }
  return windows
}

/** 一个模型条目自己声明的窗口：三个字段名里第一个可用值。 */
function declaredWindowOf(entry: Record<string, unknown>): number | undefined {
  for (const name of ['context_length', 'context_window', 'max_input_tokens'] as const) {
    const value = entry[name]
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  }
  return undefined
}

/** 一个 base URL 的 origin；空值或解析不了的 URL 都回 undefined。 */
function originOf(baseURL: string | undefined): string | undefined {
  if (baseURL === undefined || baseURL.trim() === '') return undefined
  try {
    return new URL(baseURL).origin
  } catch {
    return undefined
  }
}

/** pi-ai profile 里这条路由的对象。 */
function profileOf(settings: SettingsFace | undefined, provider: string): Record<string, unknown> | undefined {
  const section = settingsSection(settings, PI_AI_SETTINGS_NS)
  if (!isRecord(section) || !isRecord(section.providers)) return undefined
  const profile = section.providers[provider]
  return isRecord(profile) ? profile : undefined
}

/** 官方适配器这一档要读的环境变量引用。 */
function deepseekApiKeyEnv(settings: SettingsFace | undefined): string {
  const section = settingsSection(settings, DEEPSEEK_SETTINGS_NS)
  return (isRecord(section) ? nonEmptyText(section.apiKeyEnv) : undefined) ?? DEEPSEEK_API_KEY_ENV
}

/** 官方适配器自己配的 base URL。 */
function deepseekBaseUrl(settings: SettingsFace | undefined): string | undefined {
  const section = settingsSection(settings, DEEPSEEK_SETTINGS_NS)
  return isRecord(section) ? nonEmptyText(section.baseURL) : undefined
}

/**
 * 读一段设置命名空间。
 *
 * 先问 `get`，再问 `describe`：设置服务换过读取入口，两者在宿主上都是「这一段
 * 现在解析成什么」。读不到、抛错或根本没有设置服务，一律按「没有这段配置」，
 * 于是 origin 判定与凭据回退都退回官方默认值。
 */
function settingsSection(settings: SettingsFace | undefined, ns: string): unknown {
  if (settings === undefined) return undefined
  try {
    if (typeof settings.get === 'function') {
      const value = settings.get(ns)
      if (value !== undefined) return unwrap(value)
    }
    if (typeof settings.describe === 'function') {
      const descriptors = settings.describe({ redactSecrets: false })
      if (Array.isArray(descriptors)) {
        const match = descriptors.find(entry => isRecord(entry) && entry.ns === ns)
        if (match !== undefined) return unwrap(match.value)
      }
    }
  } catch {
    // 一段读不出来的配置按缺席处理：每次调用都记一行日志只会淹没真正的事件。
  }
  return undefined
}

/** 解开设置服务包在读数值外面的 volatile getter。 */
function unwrap(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current) || typeof current.get !== 'function') break
    current = (current as { get(): unknown }).get()
  }
  return current
}

/**
 * 官方 `/user/balance` 应答体里本协议要的四个数。
 *
 * 缺一个都算形状不符：只读到总额却把赠金与充值额编成 0，等于把「这次没读到」
 * 说成「账户里没有」。
 */
function parsedBalance(body: unknown): ParsedBalance | undefined {
  if (!isRecord(body)) return undefined
  const infos = body.balance_infos
  if (!Array.isArray(infos) || infos.length === 0) return undefined
  const first = infos[0]
  if (!isRecord(first)) return undefined
  const currency = nonEmptyText(first.currency)
  const total = amount(first.total_balance)
  const toppedUp = amount(first.topped_up_balance)
  const granted = amount(first.granted_balance)
  if (currency === undefined || total === undefined || toppedUp === undefined || granted === undefined) return undefined
  return { currency, total, toppedUp, granted }
}

/** 余额端点把金额写成字符串；数字与字符串都读得出来才算数。 */
function amount(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 合并官方 `ctx.deepseekAccount.getBalance` 返回的充值与赠金钱包，优先 CNY，次选 USD。 */
function parseAccountWallets(
  value: readonly DeepSeekAccountWalletFace[],
  bonusWallets: readonly DeepSeekAccountWalletFace[],
): ParsedBalance {
  const sum = (list: readonly DeepSeekAccountWalletFace[], target: string): { found: boolean; total: number } => {
    let found = false
    let total = 0
    for (const wallet of list) {
      if (wallet.currency.toUpperCase() !== target) continue
      const num = amount(wallet.balance)
      if (num === undefined) continue
      found = true
      total += num
    }
    return { found, total }
  }
  const cnyTopped = sum(value, 'CNY')
  const cnyBonus = sum(bonusWallets, 'CNY')
  if (cnyTopped.found || cnyBonus.found) {
    const toppedUp = Number(cnyTopped.total.toFixed(2))
    const granted = Number(cnyBonus.total.toFixed(2))
    return { currency: 'CNY', toppedUp, granted, total: Number((toppedUp + granted).toFixed(2)) }
  }
  const usdTopped = sum(value, 'USD')
  const usdBonus = sum(bonusWallets, 'USD')
  if (usdTopped.found || usdBonus.found) {
    const toppedUp = Number(usdTopped.total.toFixed(2))
    const granted = Number(usdBonus.total.toFixed(2))
    return { currency: 'USD', toppedUp, granted, total: Number((toppedUp + granted).toFixed(2)) }
  }
  return { currency: 'CNY', toppedUp: 0, granted: 0, total: 0 }
}

/** 根据授权请求头计算凭据指纹，键名小写排序确保稳定。 */
function headerAuthFingerprint(headers: Readonly<Record<string, string>>): string {
  const entries = Object.entries(headers)
    .map(([key, value]) => `${key.toLowerCase()}:${value}`)
    .sort()
  return fingerprint(entries.join('\n'))
}

/**
 * 凭据的指纹（FNV-1a）。
 *
 * 缓存键要按凭据区分，但进程里不该为了做键而多留一份密钥：指纹进键，密钥
 * 只出现在发往上游的那一个请求头里。
 */
function fingerprint(secret: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < secret.length; index += 1) {
    hash ^= secret.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

/** 非空字符串，其余一律 undefined。 */
function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 一个可按下标读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
