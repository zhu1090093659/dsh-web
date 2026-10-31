/**
 * `@linxin666/dsh-remote-bridge` — the Host half of the DSH remote bridge.
 *
 * One plugin row exposes the frozen protocol v1 to a paired remote client:
 *
 * - `/ios/v1` (WebSocket upgrade) carries the whole protocol. Admission is
 *   unconditional: a connection without a valid device token is UNPAIRED and
 *   may only call `hello`, `pair.begin` and `pair.finish` — even from loopback.
 * - `/remote-bridge/pair/token` (exact HTTP route) mints the one-shot bootstrap
 *   token. It is admitted only when the request arrives from this machine AND
 *   its `Host` header names this machine: a tunneled request reaches the origin
 *   from loopback too, so the socket address alone is not a loopback proof.
 * - `approval/request` is claimed in-process while a paired device is connected,
 *   and delegated (`next()`) in every other case, which the Host normalizes to
 *   the fail-closed `'unavailable'`.
 * - `ui_present` is this bridge's own model tool (protocol §35): one whole
 *   self-contained page is announced as `ui.request` to the paired clients that
 *   declared `ui.v1`, and the user's first action inside it comes back as that
 *   tool call's result. `ui.event` settles it, `ui.list` reads the cards still
 *   held. No paired client that declared the channel means the call answers
 *   `unavailable` at once instead of holding the agent.
 * - `user-questions/request` is claimed the same way and published as
 *   `question.request` to the devices that declared `questions.v1`; their
 *   `question.answer` settles the host's own ask while it is open, or reaches a
 *   continued question through the host's Remote `answer`. With no paired
 *   connection on the wire the claim is still made when a roster device registered
 *   for notifications, which is reached by the alert and holds the question for one
 *   window before it goes back to the host's chain (§11.3, §32). Every other case
 *   delegates, and a timed question keeps the Host's own deadline.
 *
 * The browser half lives in `src/client/` and is declared by `dsh.client`: one
 * sidebar-foot panel that reads the same loopback-gated token route over a
 * same-origin request and renders the secret as a QR symbol beside its
 * plaintext. It is display-only — it cannot mint, spend, list or revoke
 * anything — and this module does not import it.
 * @module @linxin666/dsh-remote-bridge
 */

import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { ApprovalRegistry } from './core/approvals.ts'
import type { ConnectionAuth } from './core/connection.ts'
import { DeviceRoster } from './core/devices.ts'
import { createRemoteBridgeFace, RemoteBridgeRegistry, REMOTE_BRIDGE_SERVICE } from './core/extension.ts'
import { JobRoster, type JobRegistryFace } from './core/jobs.ts'
import { ModelEffortPreferences } from './core/model-efforts.ts'
import { BridgeHub, OFFLINE_QUESTION_CLAIM_TTL_MS } from './core/hub.ts'
import { createOwnerPeer } from './core/owner-peer.ts'
import { PairingService } from './core/pairing.ts'
import { LiveActivityNotifier } from './core/liveactivity.ts'
import { PushNotifier, type PushRoute } from './core/push.ts'
import { QuestionClaims } from './core/questions.ts'
import { UiCards } from './core/ui.ts'
import { WS_PATH } from './core/protocol.ts'
import { SessionMeta, type SessionStoreFace, type SessionTitleFace, type WorkspacesFace } from './core/session-meta.ts'
import { sessionQuietProbe, TURN_END_QUIET_REPORT_MS, TurnEndQuietGate } from './core/turn-end-quiet.ts'
import { SessionPermissions, type ApprovalPolicyFace, type PermissionPresetsFace, type SandboxPolicyFace } from './core/session-permissions.ts'
import { selectionOf, modelSelectionOf } from './core/connection.ts'
import { UsageService, type CredentialStoreFace, type SessionRosterFace, type SessionRouteFace, type SettingsFace } from './core/usage.ts'
import { UsageStatsReader } from './core/usage-stats.ts'
import { wireArgs, type GatewayPeer } from './core/wire.ts'
import { dshHome } from './host/dsh-home.ts'
import { ApnsSender, apnsConfigFromEnv } from './host/apns.ts'
import { pushChannelLine, pushRouteOf, RelaySender, relayUrlFromEnv, type PushChannelDescription } from './host/relay.ts'
import { StandingWatchers } from './host/watchers.ts'
import { LoopbackSquads } from './host/squads.ts'
import { mountOnce } from './mount-once.ts'
import { makePairTokenRoute } from './host/routes.ts'
import { createUiPresentTool } from './host/ui-tools.ts'
import { hostWebOrigin, LoopbackUsage } from './host/usage-stats.ts'
import { ensureFirewallRule, firewallSummary, removeFirewallRule, type FirewallSummary } from './host/firewall.ts'
import { bindUrlHostOf, isWildcardLiteral, wildcardBindSupported, type ConfigSchemaFactory } from './host/host-bind-capability.ts'
import { createIngressGate, type IngressGate } from './host/ingress-gate.ts'
import { IngressSync, ingressInputOf, livePortOf, type IngressSyncInput } from './host/ingress-sync.ts'
import { lanIPv4Addresses } from './host/lan.ts'
import {
  firewallActionNeeded,
  forwardPlanOf,
  isLanReachableBind,
  type AppliedFirewallState,
  type ForwardPlan,
  type ForwardStopReason,
  type LanBindCapability,
  type StartupFacts,
} from './host/lan-bind-plan.ts'
import { removeManagedBlock, type LegacyBlockCleanup } from './host/lan-bind.ts'
import { LanForwarder, type LanForwardState } from './host/lan-forward.ts'
import { createRelayBridgeRunner } from './host/relay-bridge-connector.ts'
import { releaseRelayLease, type RelayClaim, type RelayConnectorMode } from './host/relay-control.ts'
import {
  createNamedRelayConnector,
  readPluginVersion,
  RelayConnectorPair,
  relayClaimKeyOf,
  type RelayBridgeStart,
  type RelayConnectorPairOptions,
  type RelayPairState,
} from './host/relay-connector.ts'
import {
  loadRelayIdentity,
  readExistingRelayIdentity,
  RelayRegistrar,
  unregisterRelay,
  type RelayIdentity,
  type RelayState,
} from './host/relay-registry.ts'
import { TunnelManager, type TunnelPhase } from './host/tunnel.ts'
import { tunnelPlanOf, type TunnelPlan } from './host/tunnel-plan.ts'
import { isWebSocketUpgrade, presentedTokenOf, readSecWebSocketKey, refuseUpgrade, serveUpgrade } from './host/websocket.ts'

/** Loader row identity of this plugin. */
export const name = 'remote-bridge'

/**
 * The Host services this plugin cannot run without.
 *
 * `tools` is what protocol §35 added: this bridge contributes one model tool of
 * its own (`ui_present`), so a host that composes no tool registry is a host where
 * the card channel has no caller — the row simply does not mount here.
 */
export const inject = ['typertGateway', 'webServer', 'tools']

/** Where the paired-device roster lives inside the DSH home. */
export const ROSTER_PATH = 'remote-bridge/devices.json'

/**
 * Where this host remembers one reasoning level per model.
 *
 * Beside the roster, and for the same reason: it belongs to this bridge rather
 * than to any one session, and it outlives every process (core/model-efforts.ts).
 */
export const EFFORT_PATH = 'remote-bridge/model-efforts.json'

/** The environment variable that moves the offline claim window (§32.2). */
export const OFFLINE_CLAIM_TTL_ENV = 'DSH_REMOTE_BRIDGE_OFFLINE_CLAIM_TTL_MS'

/**
 * The offline claim window this process runs with.
 *
 * The window is the bridge's own constant and never a host fact, so a deployment
 * moves it here. A value that is missing, unreadable or not positive falls back to
 * the constant instead of closing the window: a zero window would silently switch
 * the channel off, and an operator who wanted that would be turning off push.
 * @param env - the process environment, injectable for a suite.
 * @returns the window in milliseconds.
 */
export function offlineClaimTtl(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env[OFFLINE_CLAIM_TTL_ENV])
  return Number.isFinite(configured) && configured > 0 ? configured : OFFLINE_QUESTION_CLAIM_TTL_MS
}

/**
 * The environment variable that moves when a still-waiting turn end is reported (§28).
 *
 * The name is the one deployments already set and is kept as it is; what it moves is
 * the point at which the bridge says it is still waiting, because the wait itself has
 * no cap.
 */
export const TURN_END_QUIET_MAX_ENV = 'DSH_REMOTE_BRIDGE_TURN_END_QUIET_MAX_MS'

/**
 * The still-waiting report point this process runs with.
 *
 * It is the bridge's own constant and never a host fact, so a deployment moves it
 * here. A value that is missing, unreadable or not positive falls back to the
 * constant: the point only decides when the log line saying the wait continues is
 * written, and nothing about it can make the bridge announce work that is still
 * running or withhold a turn end whose family is quiet.
 * @param env - the process environment, injectable for a suite.
 * @returns the report point in milliseconds.
 */
export function turnEndQuietMaxWait(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env[TURN_END_QUIET_MAX_ENV])
  return Number.isFinite(configured) && configured > 0 ? configured : TURN_END_QUIET_REPORT_MS
}

/** This machine's IANA time zone, or undefined when the platform has none. */
function localTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone === '' ? undefined : zone
  } catch {
    return undefined
  }
}

/**
 * The `/ios/v1` upgrade handler.
 *
 * A bad, absent or bootstrap token is NOT a refusal: the connection is simply
 * unpaired, which is the state the pairing handshake starts from. Only a
 * malformed handshake is refused.
 */
function makeUpgradeHandler(hub: BridgeHub, roster: DeviceRoster, log: (message: string) => void) {
  return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    if (!isWebSocketUpgrade(req)) {
      refuseUpgrade(socket, 400, 'Bad Request')
      return
    }
    const key = readSecWebSocketKey(req)
    if (key === undefined) {
      refuseUpgrade(socket, 400, 'Bad Request')
      return
    }
    try {
      await roster.load()
    } catch (error) {
      // An unreadable roster leaves every candidate unpaired. Refusing the upgrade
      // says so; letting the handler's promise reject instead would hand the host's
      // upgrade dispatcher a failure it has no answer for and no client would ever see.
      log(`could not read the device roster: ${String(error)}`)
      refuseUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    const token = presentedTokenOf(req)
    const device = token === undefined ? undefined : roster.authenticate(token)
    const auth: ConnectionAuth | undefined = device === undefined ? undefined : { deviceId: device.deviceId }
    serveUpgrade({
      socket,
      secWebSocketKey: key,
      head,
      hub,
      ...(auth === undefined ? {} : { auth }),
    })
  }
}

/**
 * Resolve the host services session metadata is read from, now.
 *
 * All of them are read per call rather than captured at mount: none is in this
 * plugin's `inject` list, because requiring them would let the title or
 * workspace plugin's absence take the whole bridge down with it. An unmounted
 * service simply reads as undefined, and the protocol degrades one key of one
 * row instead of failing a method. The faces are structural — this package
 * imports no part of those services' own types.
 *
 * One registry answers two faces: `archive` is the slice a roster row reads and
 * `workspaces` the wider slice `workspace.list` publishes, so a single lookup
 * serves both and a host either composes a registry or composes none.
 * @param ctx - the plugin's context.
 * @returns the metadata faces as they stand right now.
 */
function sessionMetaFaces(ctx: Context) {
  const registry = ctx.get('workspaceRegistry') as WorkspacesFace | undefined
  return {
    sessions: ctx.get('sessions') as SessionStoreFace | undefined,
    titles: ctx.get('sessionTitle') as SessionTitleFace | undefined,
    archive: registry,
    workspaces: registry,
  }
}

/**
 * 宿主自己的会话名册，按 `usage.session` 需要的那一格读出来。
 *
 * 走的是 `session.list` 服务的同一个端点（`session/list`），也就是手机名册的
 * 来源：它名下既有活的会话，也有本进程没观察过、当前也不 live 的会话，因此
 * 那类会话不会被说成不存在。`ctx.sessions.list()` 答不了这一问——它只列已经
 * 进入存储的会话。读失败或答不出 item 表就回 undefined，「不知道名册」由用量
 * 服务退回活会话存储与事件折叠两条证词。
 * @param ctx - 插件的上下文，携带网关。
 * @param peer - 本桥自己的 owner peer，每次调用都以它发声。
 * @param log - 读不到名册时的落点。
 * @returns 名册 face。
 */
function sessionRoster(ctx: Context, peer: GatewayPeer, log: (message: string) => void): SessionRosterFace {
  return {
    ids: async (): Promise<readonly string[] | undefined> => {
      try {
        const value = await ctx.typertGateway.invoke({
          namespace: 'session',
          method: 'list',
          args: wireArgs('session', 'list', {}),
          peer,
        })
        const items = typeof value === 'object' && value !== null ? (value as { items?: unknown }).items : undefined
        if (!Array.isArray(items)) return undefined
        const ids: string[] = []
        for (const item of items) {
          const id = typeof item === 'object' && item !== null ? (item as { sessionId?: unknown }).sessionId : undefined
          if (typeof id === 'string' && id !== '') ids.push(id)
        }
        return ids
      } catch (error) {
        log(`the host session roster could not be read: ${String(error)}`)
        return undefined
      }
    },
  }
}

/**
 * 一条会话此刻的路由，按 `usage.session` 的模型窗口那一档读出来。
 *
 * 折叠与 `session.models` 的 `current` 逐字一致：下一步的选择、其次是用过的那个、
 * 最后才是目录默认。两个方法读同一个折叠，就不可能出现「模型选择器说 A、模型窗口
 * 按 B 算」这种事。每次读都走本桥自己的 owner peer；读不到任何一档就回 undefined，
 * 那一档读数（`modelContextWindow`）因此根本不出现，而不是补一个默认值。
 * @param ctx - 插件的上下文，携带网关。
 * @param peer - 本桥自己的 owner peer，每次调用都以它发声。
 * @param log - 读不到时记一行日志。
 * @returns 路由 face。
 */
function sessionRoute(ctx: Context, peer: GatewayPeer, log: (message: string) => void): SessionRouteFace {
  const invoke = async (method: string, args: Readonly<Record<string, unknown>>): Promise<unknown> => await ctx.typertGateway.invoke({
    namespace: 'session',
    method,
    args: wireArgs('session', method, args),
    peer,
  })
  return {
    current: async (sessionId: string) => {
      try {
        const folded = modelSelectionOf(await invoke('projections', { sessionId }))
        const selected = folded.next ?? folded.lastUsed
        // 还没选过模型的会话在目录默认上——它下一步就会用那个，也正是
        // `session.models` 对同一条会话给出的答案。
        const fallback = selected === undefined ? selectionOf(catalogDefaultOf(await invoke('modelCatalog', {}))) : undefined
        const answer = selected ?? fallback
        return answer === undefined ? undefined : { provider: answer.provider, model: answer.model }
      } catch (error) {
        log(`the route of session ${sessionId} could not be read: ${String(error)}`)
        return undefined
      }
    },
  }
}

/** `session/modelCatalog` 里的 `default` 一格。 */
function catalogDefaultOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (value as { default?: unknown }).default : undefined
}

/**
 * 解析 `usage.v1` 要读的宿主服务，现在就解析一次。
 *
 * 与元数据的三个 face 同一条理由：四者都不在本插件的 `inject` 里，缺一个不该
 * 让整个桥起不来。缺活会话存储，`usage.session` 就只能靠名册与本进程观察过的
 * 事件判断会话是否存在；缺凭据服务，`usage.balance` 回 `no-credential`；缺设置
 * 服务，路由的 `baseURL` 与 `apiKeyEnv` 读不到，origin 判定与凭据回退都退回
 * 官方默认值。face 是结构化的：本包不导入这些服务自己的类型。
 * @param ctx - 插件的上下文。
 * @param peer - 本桥自己的 owner peer，名册读取以它发声。
 * @param log - 读不到名册时的落点。
 * @returns 这些 face 此刻的样子。
 */
function usageFaces(ctx: Context, peer: GatewayPeer, log: (message: string) => void) {
  return {
    sessions: ctx.get('sessions') as SessionStoreFace | undefined,
    roster: sessionRoster(ctx, peer, log),
    credentials: ctx.get('credentials') as CredentialStoreFace | undefined,
    settings: ctx.get('settings') as SettingsFace | undefined,
    route: sessionRoute(ctx, peer, log),
  }
}

/**
 * Resolve the host services permission presets are read and switched through, now.
 *
 * Read per call, never captured at mount, for the reason the metadata faces are:
 * none of these is in this plugin's `inject` list, and a host that composes no
 * permission plugin answers `unknown-method` instead of failing to start. The
 * `Session` object the preset service needs is the store's own live instance —
 * the same object `sessionTitle` already takes — so no second lookup path exists
 * for it.
 * @param ctx - the plugin's context.
 * @returns the permission faces as they stand right now.
 */
function permissionFaces(ctx: Context) {
  return {
    sessions: ctx.get('sessions') as SessionStoreFace | undefined,
    presets: ctx.get('permissionPresets') as PermissionPresetsFace | undefined,
    sandbox: ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined,
    approval: ctx.get('approval') as ApprovalPolicyFace | undefined,
  }
}

/**
 * Resolve the host's job registry, now.
 *
 * Read per call, never captured at mount, for the reason the metadata faces
 * are: `jobs` is not in this plugin's `inject` list, so a host that composes
 * no job plugin still serves protocol v1 — `jobs.list` answers
 * `jobs-unavailable` instead of the bridge failing to start. The face is
 * structural: this package imports no part of the registry's own types.
 * @param ctx - the plugin's context.
 * @returns the job faces as they stand right now.
 */
function jobFaces(ctx: Context) {
  return {
    jobs: ctx.get('jobs') as JobRegistryFace | undefined,
  }
}

/**
 * 桥的配置面。
 *
 * 字段名与 `dsh-remote-web-ui` 逐字一致，所以现有 profile YAML 可以直接沿用；本包
 * 没有 schema 依赖，缺省值由 {@link resolveBridgeConfig} 补齐，没写的字段一律按
 * 缺省处理（不新增开关）。
 */
export interface Config {
  /** 是否申领 relay 租约（默认 true）。关掉就只有本机的回环入口可用。 */
  relay?: boolean
  /** 是否起快速隧道（默认 false）：隧道目标永远是入站闸门，不是 webServer。 */
  autoTunnel?: boolean
  /** 隧道令牌：命名隧道用它跑 cloudflared。 */
  tunnelToken?: string
  /** 命名隧道的固定公网基址（https://host[:port]）。 */
  publicBaseUrl?: string
  /** 受管 profile；缺省取 $DSH_PROFILE，再缺省 'desktop'。 */
  profile?: string
  /** 局域网绑定开关；不设即关（老插件同义：只有 true 才开边缘）。 */
  lanBind?: boolean
  /** 是否把命名隧道的 ingress 服务端口同步到本机（默认 false）。 */
  ingressSync?: boolean
  /** Cloudflare 账户级 API 令牌（ingress-sync 用，默认 undefined）。 */
  cfApiToken?: string
  /** Cloudflare 账户 id（默认 undefined）。 */
  cfAccountId?: string
  /** 命名隧道 id（默认 undefined）。 */
  cfTunnelId?: string
}

/** 配置面补齐缺省值后的样子：每个字段都是调用方可以直接用的值。 */
export interface ResolvedBridgeConfig {
  relay: boolean
  autoTunnel: boolean
  tunnelToken: string | undefined
  publicBaseUrl: string | undefined
  profile: string
  lanBind: boolean | undefined
  ingressSync: boolean
  cfApiToken: string | undefined
  cfAccountId: string | undefined
  cfTunnelId: string | undefined
}

/** 一次配置读取看到的字段表：不是对象的配置读成空表。 */
function configFieldsOf(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
}

/**
 * 读一个布尔字段。
 *
 * profile YAML 由人手写，'true'/'false' 也当成布尔收下；其余取值（缺省、null、
 * 写错的字面量）一律回退到缺省值，绝不把「写错了」读成「关掉」。
 * @param fields - 配置字段表。
 * @param key - 字段名。
 * @param fallback - 缺省值。
 * @returns 生效的布尔值。
 */
function booleanField(fields: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = fields[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * 读一个可选的布尔字段：没写与写错都读成 undefined（= 关）。
 * @param fields - 配置字段表。
 * @param key - 字段名。
 * @returns 布尔值或 undefined。
 */
function optionalBooleanField(fields: Record<string, unknown>, key: string): boolean | undefined {
  const value = fields[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/**
 * 读一个可选的文本字段：没写、不是字符串、空白一律读成 undefined。
 * @param fields - 配置字段表。
 * @param key - 字段名。
 * @returns 去掉首尾空白后的非空文本，或 undefined。
 */
function optionalTextField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 把行配置补齐成桥要用的完整配置面。
 * @param raw - loader 交给插件的行配置（字段名与老插件一致）。
 * @param env - 进程环境，注入给测试。
 * @returns 每个字段都有确定取值的配置。
 */
export function resolveBridgeConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): ResolvedBridgeConfig {
  const fields = configFieldsOf(raw)
  return {
    relay: booleanField(fields, 'relay', true),
    autoTunnel: booleanField(fields, 'autoTunnel', false),
    tunnelToken: optionalTextField(fields, 'tunnelToken'),
    publicBaseUrl: optionalTextField(fields, 'publicBaseUrl'),
    profile: optionalTextField(fields, 'profile') ?? (env.DSH_PROFILE?.trim() || 'desktop'),
    lanBind: optionalBooleanField(fields, 'lanBind'),
    ingressSync: booleanField(fields, 'ingressSync', false),
    cfApiToken: optionalTextField(fields, 'cfApiToken'),
    cfAccountId: optionalTextField(fields, 'cfAccountId'),
    cfTunnelId: optionalTextField(fields, 'cfTunnelId'),
  }
}

/**
 * 端口没绑上时的重新规划间隔。
 *
 * 一次 recompose 可以让 apply 跑到监听器 bind 之前，所以隧道、租约与局域网边缘都
 * 可能拿到未落定的端口；这个间隔就是老插件 PORT_SETTLE_RETRY_MS 的语义。
 */
export const PORT_SETTLE_RETRY_MS = 1_000

/** 一次性重试计时器的注入面（测试给假时钟）。 */
export interface PortSettleTimer {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** 端口落定之前的那一个重试计时器。 */
export interface PortSettleRetry {
  /** 请求一次「端口落定后重来」；已经排着一个就什么都不做，回 false。 */
  request(): boolean
  /** 端口落定了：丢掉排着的那个，下一次未落定重新计时、重新告警。 */
  reset(): void
  /** 卸载：丢掉排着的那个，之后的请求不再排。 */
  dispose(): void
  /** 此刻是否排着一个重试。 */
  readonly pending: boolean
}

/** 默认计时器：node 自己的 setTimeout，且 unref 掉，不让一个等待拖住进程退出。 */
const nodePortSettleTimer: PortSettleTimer = {
  setTimeout(fn: () => void, ms: number): unknown {
    const handle = setTimeout(fn, ms)
    handle.unref()
    return handle
  },
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout)
  },
}

/**
 * 建一个端口落定前的一次性重试计划。
 *
 * 全进程只该有一个这样的计划：隧道、租约与 ingress-sync 共用一个，否则每次未落定
 * 都会多排一个计时器，端口落定后一起回放成重复的申领与重复的隧道启动。
 * @param options - 重试动作、间隔、计时器与告警落点。
 * @returns 计划本身。
 */
export function createPortSettleRetry(options: {
  onRetry: () => void
  retryMs?: number
  timer?: PortSettleTimer
  warn?: (message: string) => void
}): PortSettleRetry {
  const retryMs = options.retryMs ?? PORT_SETTLE_RETRY_MS
  const timer = options.timer ?? nodePortSettleTimer
  let handle: unknown
  let armed = false
  let disposed = false
  let warned = false
  const clear = (): void => {
    if (!armed) return
    armed = false
    timer.clearTimeout(handle)
    handle = undefined
  }
  return {
    request(): boolean {
      if (disposed || armed) return false
      // 一个未落定窗口只告警一次：sync 可能被反复问，日志不该跟着涨。
      if (!warned) {
        warned = true
        options.warn?.('the web server port is not bound yet — the tunnel, the lease and the LAN edge are planned once it settles')
      }
      armed = true
      handle = timer.setTimeout(() => {
        armed = false
        handle = undefined
        if (!disposed) options.onRetry()
      }, retryMs)
      return true
    },
    reset(): void {
      clear()
      warned = false
    },
    dispose(): void {
      disposed = true
      clear()
    },
    get pending(): boolean {
      return armed
    },
  }
}

/** 端口落定之后，一次规划需要的全部事实。 */
export interface BridgeWiringFacts {
  /** 补齐缺省值后的配置面。 */
  readonly config: ResolvedBridgeConfig
  /** 入站闸门的端口：隧道、租约与局域网边缘都指向它，不是 webServer 的端口。 */
  readonly gatePort: number | undefined
  /** 宿主/CLI 给出的启动绑定（局域网边缘的 yield 判据）。 */
  readonly startupHost?: string
  /** 本机可以监听的局域网 IPv4 字面量。 */
  readonly candidates?: readonly string[]
  /** 安装的 webserver schema 是否接受通配绑定（只上报，从不写）。 */
  readonly wildcardSupported?: boolean
}

/** 一次规划的产物：隧道、租约、局域网边缘与 ingress-sync 各自的输入。 */
export interface BridgeWiringPlan {
  /** 端口还没落定：隧道、租约与转发器都要等它。 */
  readonly awaitPort: boolean
  /** 隧道计划；快速隧道在端口未落定时是 undefined，绝不计划一个未落定的目标。 */
  readonly tunnel: TunnelPlan | undefined
  /** 这次是否发起租约申领。它与隧道计划无关：无隧道时也必须申领。 */
  readonly claim: boolean
  /** 局域网边缘计划：听哪个地址，或者为什么必须关着。 */
  readonly forward: ForwardPlan
  /** ingress-sync 的输入：端口未落定时是一次零请求等待。 */
  readonly ingress: IngressSyncInput
}

/**
 * 把一份配置与一个闸门端口规划成四件事：隧道、租约、局域网边缘、ingress-sync。
 *
 * 三处「不是 webServer 端口」都在这里落定：快速隧道的目标 URL、租约申领的端口、
 * ingress-sync 要收敛到的服务端口，全部是闸门端口，公网侧因此只看见 /ios/v1。
 * @param facts - 配置、闸门端口与局域网能力。
 * @returns 这次应该做的事。
 */
export function bridgeWiringPlanOf(facts: BridgeWiringFacts): BridgeWiringPlan {
  const config = facts.config
  const gatePort = facts.gatePort
  const capability: LanBindCapability = {
    wildcardSupported: facts.wildcardSupported === true,
    candidates: [...(facts.candidates ?? [])],
  }
  return {
    awaitPort: gatePort === undefined,
    // 快速隧道的目标要端口，命名隧道的目标在云侧：只有前者必须等端口。
    tunnel: gatePort === undefined && config.autoTunnel ? undefined : tunnelPlanOf(config, gatePort),
    // 租约是传输的事，不是隧道的事：无隧道分支同样要申领，否则边缘永远 no-connector。
    claim: config.relay && gatePort !== undefined,
    forward: forwardPlanOf(config.lanBind, facts.startupHost, capability),
    ingress: ingressInputOf({
      // 桥这一行挂上就是开着的：没有主开关，开关是 ingressSync 自己。
      enabled: true,
      ingressSync: config.ingressSync,
      autoTunnel: config.autoTunnel,
      ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
      ...(config.cfApiToken === undefined ? {} : { cfApiToken: config.cfApiToken }),
      ...(config.cfAccountId === undefined ? {} : { cfAccountId: config.cfAccountId }),
      ...(config.cfTunnelId === undefined ? {} : { cfTunnelId: config.cfTunnelId }),
    }, gatePort),
  }
}

/** 一次租约申领的触发面。 */
export interface LeaseClaimer {
  /** 申领一次；同一把端口/目标键重复调用不发请求。 */
  claim(port: number | undefined, target?: string): boolean
  /** 这个进程已经申领过的那把键。 */
  readonly key: string | undefined
  /** 卸载：之后的申领请求一概不发。 */
  dispose(): void
}

/**
 * 建一个去重的租约申领器。
 *
 * 申领只有这一个出口：无隧道分支、端口落定重试、隧道换 URL 都走它，键相同就不
 * 重复申领，否则一个设置同步循环就会把租约的 last_seen 刷成噪声。
 * @param options - 申领动作与失败落点。
 * @returns 申领器。
 */
export function createLeaseClaimer(options: {
  start: (input: { port: number }) => Promise<unknown>
  log?: (message: string) => void
}): LeaseClaimer {
  let claimedFor: string | undefined
  let disposed = false
  return {
    claim(port: number | undefined, target?: string): boolean {
      const key = relayClaimKeyOf(port, target)
      if (disposed || key === undefined || port === undefined) return false
      if (claimedFor === key) return false
      claimedFor = key
      // 申领是网络往返：失败只记一行，绝不让它冒成 unhandled rejection。
      Promise.resolve()
        .then(async () => await options.start({ port }))
        .catch((error: unknown) => {
          options.log?.('the lease claim did not land: ' + (error instanceof Error ? error.message : String(error)))
        })
      return true
    },
    get key(): string | undefined {
      return claimedFor
    },
    dispose(): void {
      disposed = true
    },
  }
}

/** 一次已接受的租约应该起哪些连接器。 */
export interface LeaseConnectorWants {
  /** 命名连接器：只在快速隧道计划下起，别在操作员背后再跑一条 cloudflared。 */
  readonly named: boolean
  /** 桥连接器：租约带 bridge 授权就起，与隧道计划无关。 */
  readonly bridge: boolean
}

/**
 * 计划与租约决定的两件事，一处算清。
 * @param plan - 当前的隧道计划（未落定时 undefined）。
 * @param claim - 控制面接受的租约。
 * @returns 该起哪些连接器。
 */
export function leaseConnectorWants(plan: TunnelPlan | undefined, claim: RelayClaim): LeaseConnectorWants {
  return {
    named: plan?.mode === 'quick' && claim.tunnel !== undefined,
    bridge: claim.bridge !== undefined,
  }
}

/**
 * 租约连接器的启动器对：命名连接器读隧道计划，桥连接器只读租约。
 *
 * 两个启动器都可注入，所以「计划 × 租约」的整张表可以直接驱动真实的
 * RelayConnectorPair，而不必把插件挂到一个活宿主上。
 * @param options - 计划读取器与两个真实启动器。
 * @returns RelayConnectorPair 要的那几个 seam。
 */
export function leaseConnectorSeams(options: {
  plan: () => TunnelPlan | undefined
  startNamed: (token: string, hostname: string) => void
  startBridge: (start: RelayBridgeStart) => void
  stopNamed?: () => void
  stopBridge?: () => void
  log?: (message: string) => void
}): RelayConnectorPairOptions {
  return {
    startNamed(token: string, hostname: string): void {
      if (!leaseConnectorWants(options.plan(), { mode: 'named', hostname, tunnel: { id: '', token } }).named) {
        options.log?.('the lease names a tunnel but the plan runs none — no second cloudflared is started')
        return
      }
      options.startNamed(token, hostname)
    },
    startBridge(start: RelayBridgeStart): void {
      options.startBridge(start)
    },
    ...(options.stopNamed === undefined ? {} : { stopNamed: options.stopNamed }),
    ...(options.stopBridge === undefined ? {} : { stopBridge: options.stopBridge }),
  }
}


/** 一次隧道状态给出的注册事实。 */
export interface RelayAnnounceFacts {
  /** relay 开关：关掉时不但不注册，还要把 Worker 上那行撤掉。 */
  readonly relay: boolean
  /** 当前的隧道计划模式。 */
  readonly mode: TunnelPlan['mode'] | undefined
  /** 隧道 running 时报出的 URL；没 running 就是 undefined。 */
  readonly url: string | undefined
}

/**
 * 这次的隧道状态该把哪个 URL 注册给 Worker，或者什么都不注册。
 *
 * 只有快速隧道需要注册：Worker 靠注册表里那条 URL 把稳定子域名代理到本机。命名
 * 隧道有自己的固定主机名、桥模式有自己的传输，两者都不写这行。
 * @param facts - 隧道计划、它报出的 URL 与 relay 开关。
 * @returns 要注册的 target，或 undefined。
 */
export function relayAnnounceTargetOf(facts: RelayAnnounceFacts): string | undefined {
  if (!facts.relay || facts.mode !== 'quick') return undefined
  const url = facts.url?.trim()
  return url === undefined || url === '' ? undefined : url
}

/** Worker 上那行「稳定子域名 -> 本机隧道」的注册，只有一个出口。 */
export interface RelayAnnouncer {
  /** 隧道计划、它报出的 URL 或 relay 开关变了就调一次。 */
  sync(facts: RelayAnnounceFacts): void
  /** 注册成功的那个 target；undefined 表示 Worker 上还没有指向本机的行。 */
  readonly registered: string | undefined
  /** 卸载：停掉重试；`unregister` 时连 Worker 上那行一并撤掉。 */
  dispose(unregister?: boolean): void
}

/**
 * 建一个 announcer。
 *
 * 语义对齐老插件的 ensureRelayRegistrar / announceRelay / disposeRelayAnnouncer：
 * 同一 target 只注册一次（隧道崩溃重启会报一个新 URL，那时才重新注册）；失败只记
 * 一行、由 registrar 自己退避重试，绝不冒成异常阻断隧道；relay 从开到关时撤掉那
 * 一行，免得稳定子域名指向一个已经关掉的宿主。
 *
 * 注册上去的 URL 就是隧道的目标，而隧道的目标是入站闸门，所以这一行只透出
 * `/ios/v1`：announcer 不会把宿主的路由表暴露给公网。
 * @param options - 身份来源（懒读，只有真要注册时才碰 DSH home）与失败落点。
 * @returns announcer 本身。
 */
export function createRelayAnnouncer(options: {
  identity: () => RelayIdentity | undefined
  registrar?: (identity: RelayIdentity, onState: (state: RelayState) => void) => RelayRegistrar
  log?: (message: string) => void
}): RelayAnnouncer {
  const build = options.registrar
    ?? ((identity: RelayIdentity, onState: (state: RelayState) => void) => new RelayRegistrar(identity, onState))
  let registrar: RelayRegistrar | undefined
  let attempted: string | undefined
  let registered: string | undefined
  let disposed = false

  /** 拿（或建）registrar；身份读不出来就让 announcer 保持惰性。 */
  const ensure = (): RelayRegistrar | undefined => {
    if (registrar !== undefined) return registrar
    const identity = options.identity()
    if (identity === undefined) return undefined
    registrar = build(identity, (state: RelayState) => {
      // 注册行不在了或注册失败：稳定子域名此刻不再指向本机。
      if (state.state !== 'running' && state.state !== 'registering') registered = undefined
    })
    return registrar
  }

  /** 撤掉 Worker 上那行；失败只记一行。 */
  const withdraw = (live: RelayRegistrar): void => {
    void live.unregister().catch((error: unknown) => {
      options.log?.('the relay registry row could not be withdrawn: '
        + (error instanceof Error ? error.message : String(error)))
    })
  }

  return {
    sync(facts: RelayAnnounceFacts): void {
      if (disposed) return
      if (!facts.relay) {
        const live = registrar
        registrar = undefined
        attempted = undefined
        registered = undefined
        if (live === undefined) return
        withdraw(live)
        live.dispose()
        return
      }
      // 同一 target 只注册一次：重复的 running 事件与端口落定重试都走这里。
      const target = relayAnnounceTargetOf(facts)
      if (target === undefined || target === attempted) return
      const live = ensure()
      if (live === undefined) return
      attempted = target
      void live.announce(target).then((base) => {
        if (base !== undefined) registered = target
      }).catch((error: unknown) => {
        options.log?.('the relay registration did not land: '
          + (error instanceof Error ? error.message : String(error)))
      })
    },
    get registered(): string | undefined {
      return registered
    },
    dispose(unregister = false): void {
      if (disposed) return
      disposed = true
      const live = registrar
      registrar = undefined
      attempted = undefined
      registered = undefined
      if (live === undefined) return
      if (unregister) withdraw(live)
      live.dispose()
    },
  }
}


/** relay 半区的开关：打开时由计划驱动，关掉时撤行并释放租约。 */
export interface RelayHalfSwitch {
  /** 关掉一次：撤掉 Worker 上那行注册、释放租约、随后 dispose；重复调用是空操作。 */
  off(): void
  /** 卸载：不撤行也不释放，只停重试（那一行是手机的收藏地址，由服务端 GC 回收）。 */
  dispose(): void
}

/**
 * 建一个 relay 半区的开关。
 *
 * 对齐老插件 `disposeRelayHalf(true)` 的语义：relay 从开到关时先撤注册行、再
 * `pair.release()` 释放租约，最后 dispose；两步失败都只记一行，绝不冒成异常。与
 * 卸载严格分开——卸载只 `dispose()`，既不放租约也不撤行，否则一次重启就会把手机
 * 收藏的稳定地址抹掉。
 * @param parts - announcer、租约半区与失败落点。
 * @returns 开关本身。
 */
export function createRelayHalfSwitch(parts: {
  announcer: RelayAnnouncer
  /** 租约半区：懒建（端口落定之后才存在），所以按读取时刻取。 */
  pair?: () => { release(): Promise<void>; dispose(): void } | undefined
  log?: (message: string) => void
}): RelayHalfSwitch {
  let retired = false
  return {
    off(): void {
      if (retired) return
      retired = true
      // announcer 自己的 relay:false 分支负责撤行并停掉重试。
      parts.announcer.sync({ relay: false, mode: undefined, url: undefined })
      const pair = parts.pair?.()
      if (pair === undefined) return
      void Promise.resolve()
        .then(async () => { await pair.release() })
        .catch((error: unknown) => {
          parts.log?.('the relay lease could not be released: '
            + (error instanceof Error ? error.message : String(error)))
        })
        // 释放失败也要关掉连接器：否则一个已经关掉的宿主还挂着一个 socket。
        .finally(() => { pair.dispose() })
    },
    dispose(): void {
      if (retired) return
      retired = true
      parts.announcer.dispose()
    },
  }
}

/** 一次实时地址判断要的事实。 */
export interface LivePublicOriginFacts {
  /** 已接受的租约：控制面决定的 mode 与 hostname。 */
  readonly lease: { readonly mode: RelayConnectorMode; readonly hostname: string } | undefined
  /** relay 注册成功的那个 target；undefined 表示还没成功。 */
  readonly registered: string | undefined
  /** 隧道此刻的阶段与 URL。 */
  readonly tunnel: { readonly phase: TunnelPhase; readonly url?: string } | undefined
}

/**
 * 桥自己此刻的公网入口。
 *
 * 租约的稳定子域名只在它后面确实有人服务时才优先：bridge 与 named 各有自己的传输，
 * quick 却要靠 Worker 把子域名代理到本机注册给它的那条隧道 URL——注册还没成功时那
 * 条子域名指向离线页，二维码必须退回隧道自己报出的地址。判据只看「租约 mode 与注
 * 册状态」这两个已定的事实，不读时钟，所以它不可能是竞态。
 * @param facts - 租约、注册状态与隧道阶段。
 * @returns 公网基址，或 undefined（此刻没有可拨的公网入口）。
 */
export function livePublicOriginOf(facts: LivePublicOriginFacts): string | undefined {
  const lease = facts.lease
  if (lease !== undefined && (lease.mode !== 'quick' || facts.registered !== undefined)) {
    return 'https://' + lease.hostname
  }
  const tunnel = facts.tunnel
  return tunnel !== undefined && tunnel.phase === 'running' ? tunnel.url : undefined
}

/**
 * 局域网兜底地址：只从局域网转发器自己报出的监听事实取值。
 *
 * 默认配置（lanBind 关、宿主绑回环）下本机的局域网地址上没有监听者，把那个字面量
 * 写进二维码就是一个拨不通的地址。所以这里没有第二种来源：转发器说它在监听，就报它
 * 绑定到的地址与端口（内核可能把 0 换成真实端口，它回报的那一对才是客户端能拨的）；
 * 转发器没在监听、或地址端口还没有落定，就没有兜底地址。也不另取地址列表里的第一个
 * 去猜——猜出来的地址背后没有监听者。
 * @param forward - 局域网转发器此刻的状态快照；undefined 表示这一行还没把转发器挂上。
 * @returns 局域网地址与端口，或 undefined（此刻本机没有局域网监听者）。
 */
export function lanOriginOf(forward: LanForwardState | undefined): { address: string; port: number } | undefined {
  if (forward === undefined || !forward.listening) return undefined
  const address = forward.address?.trim()
  const port = forward.port
  if (address === undefined || address === '' || port === undefined || !Number.isFinite(port)) return undefined
  return { address, port }
}

/**
 * 一次采样：本机能监听哪些局域网地址，安装的 webserver schema 是否接受通配绑定。
 * @param configOf - schema 工厂注入（测试用），缺省读已安装的那个包。
 * @returns 规划局域网边缘要的能力。
 */
export function lanBindCapabilityOf(configOf?: ConfigSchemaFactory): LanBindCapability {
  return { wildcardSupported: wildcardBindSupported(configOf), candidates: lanIPv4Addresses() }
}

/**
 * 一个非回环绑定能被哪些 LAN 基址访问到。
 *
 * 通配绑定回答每个接口，所以每个候选各得一个基址（多网卡的机器可以挑手机真能到的
 * 那张网）；具体字面量只在它自己那里可达，因此只广告它一个。
 * @param host - 活的绑定，或端口未落定时受管块里钉的地址。
 * @param port - 绑定的端口。
 * @returns 基址表，绑定留在本机时为空。
 */
export function lanBasesOf(host: string | undefined, port: number): { address: string; base: string }[] {
  if (typeof host !== 'string' || !isLanReachableBind(host)) return []
  const addresses = isWildcardLiteral(host)
    ? lanIPv4Addresses()
    // 没有 URL 形态的字面量（带 zone id 的非回环 IPv6）不可广告：编出来的基址会
    // 让手机把整个配对尝试赔进去。
    : [bindUrlHostOf(host)].filter((address): address is string => address !== undefined && address !== '')
  return addresses.map(address => ({ address, base: 'http://' + address + ':' + String(port) }))
}

/** 局域网绑定状态帧要的事实，请求时刻读一次。 */
export interface LanBindFrameInput {
  /** 受管 profile。 */
  profile: string
  /** 开关：翻过是 true/false，没翻过是 undefined。 */
  setting: boolean | undefined
  /** 旧版本受管块还钉着的地址（清理之前）。 */
  blockHost: string | undefined
  /** 运行中 webServer 的活的绑定（这套设计里是回环）。 */
  bindHost: string | undefined
  /** 局域网转发器的实时状态。 */
  forward: LanForwardState
  /** 转发器为什么关着（开关要求它开时）。 */
  forwardReason: ForwardStopReason | undefined
  /** 这个进程是否删掉了旧版本留下的块。 */
  legacyBlockRemoved: boolean
  /** 已落定的端口。 */
  port: number | undefined
  /** 安装的 webserver schema 接受什么（只上报，从不写）。 */
  wildcardSupported: boolean
  /** 这个进程能监听的本机非回环 IPv4 字面量。 */
  candidates: string[]
  /** CLI 给出的启动绑定事实。 */
  startupHost: string | undefined
}

/**
 * 局域网绑定状态帧，做成一个纯值，好让每个字段都有直接的单元覆盖。
 *
 * `bindHost` 是局域网客户端真正能拨的地址——转发器的监听器，或者操作员把
 * `--host` 指到网络上时的活绑定——因为卡片就是拿它渲染「bind: host:port」的；
 * `localBindHost` 把宿主进程自己的监听器并排留在旁边。
 * @param input - 请求时刻读到的事实。
 * @param firewallOf - 防火墙摘要读取器（测试注入）。
 * @returns 设置卡读的那一帧。
 */
export function lanBindFrameOf(
  input: LanBindFrameInput,
  firewallOf: (port: number, lanOn: boolean) => FirewallSummary = firewallSummary,
): Record<string, unknown> {
  const capability: LanBindCapability = {
    wildcardSupported: input.wildcardSupported,
    candidates: input.candidates,
  }
  const plan = forwardPlanOf(input.setting, input.startupHost, capability)
  // 可达性看局域网边缘，不看宿主自己的绑定：转发器起来时看它的监听器，操作员让
  // 宿主自己听网络时看那个活绑定（转发器把端口让出去）。
  const reachHost = input.forward.listening ? input.forward.address : input.bindHost
  return {
    profile: input.profile,
    setting: input.setting ?? null,
    blockHost: input.blockHost ?? null,
    bindHost: reachHost,
    localBindHost: input.bindHost ?? null,
    port: input.port,
    lanUrls: input.port !== undefined
      ? lanBasesOf(reachHost, input.port).map(entry => entry.base)
      : [],
    firewall: input.port !== undefined
      ? firewallOf(input.port, isLanReachableBind(reachHost))
      : { ok: true, managed: false },
    platform: process.platform,
    /** 转发器计划监听的局域网地址；必须关着时是 null。 */
    desiredHost: plan.host ?? null,
    /** 运行中宿主的 schema 是否接受通配绑定（只上报）。 */
    wildcardSupported: input.wildcardSupported,
    /** 这个进程能监听的具体局域网字面量。 */
    supportedHosts: input.candidates,
    /** 开关开着但这台机器没有可监听的局域网 IPv4 地址。 */
    lanBlocked: plan.reason === 'no-address',
    // 永远是 false：这套设计里没有任何一步需要重启。字段留着是因为卡片渲染它。
    pendingRestart: false,
    /** 旧版本写的块被这个进程删掉了。 */
    legacyBlockRemoved: input.legacyBlockRemoved,
    /** 局域网边缘本身：它听在哪，关着时为什么。 */
    forward: {
      listening: input.forward.listening,
      host: input.forward.address ?? null,
      port: input.forward.port ?? null,
      // 听着的边缘没有「为什么关」：原因只描述关着的那一个。
      reason: input.forward.listening ? null : (input.forwardReason ?? null),
      error: input.forward.error ?? null,
    },
  }
}

/** 旧版受管块的清理执行器：一个进程只清一次，而且只删不写。 */
export interface LegacyBlockCleaner {
  /** 排一次清理（重复调用是空操作）；清理在 defer 的回调里跑，不在调用方的帧里。 */
  run(): void
  /** 已经跑出来的结论，供状态帧的 legacyBlockRemoved 读。 */
  readonly cleanup: LegacyBlockCleanup | undefined
}

/**
 * 建一个旧版受管块清理执行器。
 *
 * 写入路径已经不存在了（局域网边缘是运行时转发器），留下的唯一一次文件操作就是
 * 删掉旧版本写进 profile 的那个块。它必须离开调用方的帧：设置保存正握着宿主的
 * 排他 HMR 事务，从那里直接写配置文件会让配置监视器重入同一事务（#1751/#1754）。
 * 这个清理带一次性守卫，所以进程里最多碰一次文件，后面的重复调用是空操作。
 * @param options - profile 读取器、删除动作、推迟动作与失败落点。
 * @returns 清理执行器。
 */
export function createLegacyBlockCleaner(options: {
  profile: () => string
  remove?: (profile: string) => LegacyBlockCleanup
  defer?: (fn: () => void) => void
  log?: (message: string) => void
}): LegacyBlockCleaner {
  const remove = options.remove ?? ((profile: string): LegacyBlockCleanup => removeManagedBlock(profile))
  const defer = options.defer ?? ((fn: () => void): void => { setImmediate(fn) })
  let started = false
  let cleanup: LegacyBlockCleanup | undefined
  return {
    run(): void {
      if (started) return
      started = true
      defer(() => {
        try {
          cleanup = remove(options.profile())
        } catch (error) {
          // 推迟执行的清理失败绝不能冒成 unhandled rejection：调用方早已答完。
          options.log?.('the legacy lan-bind block could not be removed: ' + (error instanceof Error ? error.message : String(error)))
        }
      })
    },
    get cleanup(): LegacyBlockCleanup | undefined {
      return cleanup
    },
  }
}

/** 入站栈的成员：它们互相之间的卸载次序是硬约束。 */
export interface BridgeIngressStack {
  readonly ingress?: { dispose(): void }
  readonly forwarder?: { stop(): unknown }
  readonly connectors?: { dispose(): void }
  readonly tunnel?: { dispose(): void }
  readonly gate?: { stop(): void }
}

/**
 * 卸载整条入站栈，次序固定。
 *
 * 转发器先走（它持有局域网侧最外层的监听器），然后连接器（它们会把 socket 打回
 * 闸门），再隧道，最后闸门——闸门必须是最后一个关的，否则前面几步会把还活着的
 * 连接钉在一个已经不存在的上游上。一个成员抛错不影响后面几个。
 * @param stack - 当前活着的成员。
 * @param log - 卸载失败的落点。
 * @returns 实际释放过的成员名，按释放次序。
 */
export function disposeBridgeStack(stack: BridgeIngressStack, log?: (message: string) => void): string[] {
  const steps: [keyof BridgeIngressStack, () => void][] = [
    ['ingress', () => { stack.ingress?.dispose() }],
    ['forwarder', () => {
      // 转发器的 stop 是异步的：一个 rejected promise 不能被 void 掉，这里收住它。
      void Promise.resolve()
        .then(async () => await stack.forwarder?.stop())
        .catch((reason: unknown) => {
          log?.('the LAN forwarder did not stop cleanly: '
            + (reason instanceof Error ? reason.message : String(reason)))
        })
    }],
    ['connectors', () => { stack.connectors?.dispose() }],
    ['tunnel', () => { stack.tunnel?.dispose() }],
    ['gate', () => { stack.gate?.stop() }],
  ]
  const released: string[] = []
  for (const [name, release] of steps) {
    if (stack[name] === undefined) continue
    try {
      release()
    } catch (error) {
      log?.('the ingress stack member ' + name + ' did not release cleanly: ' + (error instanceof Error ? error.message : String(error)))
    }
    released.push(name)
  }
  return released
}

/**
 * 闸门要拨的上游：宿主 webServer 自己监听的 host 与 port。
 *
 * 端口走 {@link livePortOf} 归一化——一次 recompose 可以递给插件一个半读的
 * webServer，NaN/Infinity 不是端口，它和「还没绑上」走同一条等待路径。通配绑定换成
 * 回环字面量：闸门自己只监听回环，拨 0.0.0.0 不是它要的语义。
 * @param server - 宿主 web server。
 * @returns host 与 port；port 未落定时 undefined。
 */
function webServerFacts(server: { getOrigin?: () => string; port?: number }): { host: string; port: number | undefined } {
  const port = livePortOf(server.port)
  let host = '127.0.0.1'
  try {
    const name = new URL(server.getOrigin?.() ?? '').hostname
    if (name !== '' && !isWildcardLiteral(name)) host = name
  } catch {
    // 没有 origin 可读的宿主就按回环拨：闸门本来就只在回环上。
  }
  return { host, port }
}

/**
 * 读一个宿主服务，读不到就是没挂。
 *
 * 捕获式测试上下文不带服务注册表，真实的宿主治带；两种都读成 undefined 或那个
 * 服务，绝不在这里抛错——一个选配服务缺席不该让整行挂不上去。
 * @param ctx - 插件的上下文。
 * @param name - 服务名。
 * @returns 服务，或 undefined。
 */
function hostService<T>(ctx: Context, name: string): T | undefined {
  const get = (ctx as { get?: (key: string) => unknown }).get
  return typeof get === 'function' ? get.call(ctx, name) as T | undefined : undefined
}

/**
 * 读本 profile 的 relay 身份，必要时首次生成。
 * @param profile - 受管 profile。
 * @param log - 读不出来时的落点。
 * @returns 身份，或 undefined（profile 名不能当路径段、文件也读不回来）。
 */
function relayIdentityOf(profile: string, log: (message: string) => void): RelayIdentity | undefined {
  try {
    return loadRelayIdentity(profile)
  } catch (error) {
    log('the relay identity could not be read, so the relay half stays off: ' + String(error))
    return undefined
  }
}

/**
 * 读一份已经存在的身份，绝不生成。
 *
 * 与 {@link relayIdentityOf} 的区别就是「不生成」：relay 关着的这条路径只想知道盘上
 * 有没有身份，盘上没有就应该什么都不做。
 * @param profile - 受管 profile。
 * @param log - 读不出来时的落点。
 * @returns 身份，或 undefined（没有可用身份，且什么都没写）。
 */
function existingRelayIdentityOf(profile: string, log: (message: string) => void): RelayIdentity | undefined {
  try {
    return readExistingRelayIdentity(profile)
  } catch (error) {
    log('the relay identity could not be read, so the previous registration stays as it is: ' + String(error))
    return undefined
  }
}

/**
 * 用一份已经存在的身份收掉上一次挂载留下的 relay 半区：先撤掉 Worker 上那行注册，
 * 再释放一次租约。
 *
 * 设置是挂载时的快照，用户把 relay 改成 false 会让插件行重新挂载：旧 effect 的卸载按
 * 设计不释放（那行是手机的收藏地址），新 effect 在 relay=false 下又不建租约半区，所以
 * 真实路径上的释放只可能发生在这里。两步都是 best-effort，失败各记一行，绝不冒成异常
 * ——一次挂载不该因为中继控制面不在线就失败。
 * @param parts - 身份与失败落点。
 */
export async function retireStaleRelayHalfOf(parts: {
  identity: RelayIdentity
  log?: (message: string) => void
}): Promise<void> {
  try {
    await unregisterRelay(parts.identity)
  } catch (error) {
    parts.log?.('the previous relay registration could not be withdrawn: '
      + (error instanceof Error ? error.message : String(error)))
  }
  try {
    await releaseRelayLease(parts.identity)
  } catch (error) {
    parts.log?.('the previous relay lease could not be released: '
      + (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * 租约状态的一行日志文本。
 * @param state - 租约半区此刻的状态。
 * @returns 一行可读的状态。
 */
function relayStateLine(state: RelayPairState): string {
  if (state.state === 'claimed') return 'claimed ' + state.mode + ' ' + state.hostname
  if (state.state === 'failed') return 'failed ' + state.error
  return state.state
}

/**
 * Mount the bridge.
 *
 * Guarded by the family's single-instance rule: the aggregate row
 * (`web-ui-remote-bridge`) and a standalone install of this same package can
 * both be live in one profile, and the second mount would otherwise register
 * `/ios/v1` and the token route a second time. Whichever source mounts first
 * owns the package name; the other is queued and replayed when that owner
 * disposes.
 * @param ctx - the plugin's context, carrying the gateway and web server.
 */
function applyImpl(ctx: Context, config?: unknown): void {
  const log = (message: string): void => { console.log(`[remote-bridge] ${message}`) }
  // 配置面：字段名与 dsh-remote-web-ui 一致，已有的 profile YAML 直接沿用（见 Config）。
  const settings = resolveBridgeConfig(config)
  const roster = new DeviceRoster({ file: join(dshHome(), ROSTER_PATH), log })
  // 每个模型自己的思考档：一个宿主一份，所有连接共享（契约 §4）。读一次即用，
  // 读坏了按空表处理并记一行日志，宿主照常提供模型目录。
  const modelEfforts = new ModelEffortPreferences({ file: join(dshHome(), EFFORT_PATH), log })
  const pairing = new PairingService()
  const approvals = new ApprovalRegistry()
  // The owner peer is the full-control credential the gateway demands since
  // 0.2.1; it is safe to hold from mount because every call that can trigger
  // it is gated by the bridge's own pairing check (see core/owner-peer.ts).
  const ownerPeer = createOwnerPeer(ctx)
  const questions = new QuestionClaims({ gateway: ctx.typertGateway, peer: ownerPeer, log })
  // 整页卡（§35）：一张宿主级的卡表，所有连接共享——一条动作只属于发起它的那个
  // 工具调用，与它从哪台设备回来无关。
  const ui = new UiCards()
  // One roster per mount, shared by every connection: a background job is a fact
  // about the host, not about the device that asked about it.
  const jobs = new JobRoster({ faces: () => jobFaces(ctx), log })
  const sessionMeta = new SessionMeta(() => sessionMetaFaces(ctx), () => Date.now(), log)
  // 用量读数：一条会话的窗口与组成靠宿主广播的事件折出来，余额靠宿主自己的
  // 凭据与设置查出来。一个宿主一份、所有连接共享——两台手机重复问，上游也只
  // 该收到一次请求（core/usage.ts）。
  // 台账聚合读的是宿主上 dsh-usage 插件的两条 HTTP 路由，走本机回环 origin：那个
  // 插件不发布任何 cordis 服务，端口从 `webServer` 来（先 getOrigin()，拿不到再退回
  // 监听端口）。没有它时 `usage.stats` 答 no-usage-plugin，其余读数一概不变。
  const usageRoutes = new LoopbackUsage({ origin: () => hostWebOrigin(ctx.webServer), log })
  const usageStats = new UsageStatsReader({ transport: () => usageRoutes, now: () => Date.now(), log })
  const usage = new UsageService({ faces: () => usageFaces(ctx, ownerPeer, log), now: () => Date.now(), stats: usageStats, log })
  // The push channel takes one of two roads and is off when it has neither (§28):
  // this machine's own Apple key, or the hosted relay that signs with the key no
  // deployment may ship. The local key always wins — a developer's delivery never
  // travels through the service — and the relay exists because an App distributed
  // to everyone cannot carry a private key to every machine.
  const apns = apnsConfigFromEnv()
  const relayUrl = relayUrlFromEnv()
  // One client for both channels: an APNs provider token is minted per key and
  // then reused, so a second client would only double the mint rate Apple
  // throttles (core/push.ts, host/apns.ts).
  const apnsSender = apns === undefined ? undefined : new ApnsSender({ config: apns, log })
  // Only one road is ever built. The relay's credential is not on this machine at
  // all until a phone registers it, so the relay is armed per event rather than
  // decided once at mount: a bridge with neither route is as inert as one with no
  // key ever was.
  const relaySender = apnsSender === undefined ? new RelaySender({ url: relayUrl }) : undefined
  const pushSender = apnsSender ?? relaySender
  const pushMode: PushRoute = apnsSender === undefined ? 'relay' : 'direct'
  const relayArmed = (): boolean => roster.relayTargets().length > 0
  // What one event is addressed to. On the direct road every registration is a
  // target; on the relay only a row holding the token that road signs with, because
  // a registration from before the relay existed is a phone this machine cannot
  // reach at all. One mapping for both channels, so a notification and a card can
  // never disagree about who is reachable.
  const pushTargets = () => (apnsSender === undefined ? roster.relayTargets() : roster.pushTargets())
  // What the mount log says once the roster has been read. `off` is a real answer
  // rather than a failure: it is the channel a deployment with no key and no
  // registered relay token has always had (§28).
  const pushChannelDescription = (): PushChannelDescription => {
    const route = pushRouteOf(apnsSender !== undefined, relayArmed())
    if (route === 'direct') return { route, ...(apns === undefined ? {} : { keyId: apns.keyId, teamId: apns.teamId }) }
    return route === 'relay' ? { route, relayUrl } : { route }
  }
  const push = new PushNotifier({
    targets: () => pushTargets().map(({ push: registration }) => ({
      deviceToken: registration.deviceToken,
      environment: registration.environment,
      bundle: registration.bundle,
      ...(registration.locale === undefined ? {} : { locale: registration.locale }),
      ...(registration.relayToken === undefined ? {} : { relayToken: registration.relayToken }),
    })),
    ...(pushSender === undefined ? {} : { sender: pushSender }),
    mode: pushMode,
    ...(relaySender === undefined ? {} : { available: relayArmed }),
    titles: id => sessionMeta.title(id),
    now: () => Date.now(),
    log,
  })
  // The lock-screen card path (§29). It reads the same roster, through the same
  // client, and is inert for exactly the same reason: no route, no sender, no card.
  // A token APNs — or the relay — reports dead is dropped from its device row here,
  // which is the whole of the recovery: the next card registers a fresh one.
  const liveActivity = new LiveActivityNotifier({
    targets: () => pushTargets().flatMap(({ push: registration }) => (registration.liveActivityTokens ?? []).map(({ activityId, token, sessionId }) => ({
      activityId,
      token,
      // The session is the card's address (§29.9). A registration written before
      // that field existed simply has none, and its card is never pushed to.
      ...(sessionId === undefined ? {} : { sessionId }),
      environment: registration.environment,
      bundle: registration.bundle,
      ...(registration.relayToken === undefined ? {} : { relayToken: registration.relayToken }),
    }))),
    ...(pushSender === undefined ? {} : { sender: pushSender }),
    ...(relaySender === undefined ? {} : { available: relayArmed }),
    now: () => Date.now(),
    log,
    retire: async (activityId, token) => {
      const dropped = await roster.removeLiveActivityToken(activityId, token)
      // A dead token is a roster change like any other: the session it named may
      // have just lost its last card, and a watcher for it must close.
      if (dropped) watchers.sync()
      return dropped
    },
  })
  // The quiet gate both channels announce a finished turn through: §28's
  // notification and §29's card end wait for the host's own answer that the session's
  // whole family is quiet — the root its parent chain climbs to, every session under
  // that root at any depth, and any job the host attributes to one of them. A family
  // that stays busy is never announced, and a subagent session's own turn end is
  // dropped unless the phone prompted it. Inert while no key is configured, because
  // both channels are then off and no timer is worth arming.
  const turnEndQuiet = new TurnEndQuietGate({
    push,
    liveActivity,
    probe: sessionQuietProbe({ gateway: ctx.typertGateway, peer: ownerPeer, jobs }),
    reportAfterMs: turnEndQuietMaxWait(),
    log,
  })
  // The bridge's own follow streams (§28/§29): a suspended phone has no socket,
  // so the turn end its card has to show would otherwise be seen by nobody. One
  // watcher per session that still holds a card token, armed from the roster and
  // never from a client frame.
  const watchedSessions = (): readonly string[] => {
    const sessions = new Set<string>()
    for (const { push: registration } of pushTargets()) {
      for (const token of registration.liveActivityTokens ?? []) {
        if (token.sessionId !== undefined) sessions.add(token.sessionId)
      }
    }
    return [...sessions]
  }
  const watchers = new StandingWatchers({
    gateway: ctx.typertGateway,
    peer: ownerPeer,
    sessions: watchedSessions,
    // Both channels are handed over on either road: a watcher is what makes a turn
    // end reach a suspended phone when the bridge can tell it at all, and the
    // notifiers are inert until their route is armed.
    liveActivity,
    push,
    turnEndQuiet,
    log,
  })
  const permissions = new SessionPermissions(() => permissionFaces(ctx), log)
  // The extension seam publishes no protocol vocabulary of its own: another
  // plugin registers the method names, payloads and topics it owns, and this
  // package only dispatches and fans out what it was handed.
  // The squad domain of the `dsh-agents` plugin is read over this host's own
  // loopback origin: that plugin serves its routes on the very web server this
  // bridge already injects. Both the origin and the ledger directory are resolved
  // per call — the listener may not have bound a port when this row mounts, and a
  // DSH home is not a fact to capture once.
  const squads = new LoopbackSquads({
    origin: () => {
      try {
        return ctx.webServer.getOrigin()
      } catch {
        return undefined
      }
    },
    ledgerDirectory: () => join(dshHome(), 'dsh-agents'),
    log,
  })
  const extensions = new RemoteBridgeRegistry()
  // 离线认领的窗口归桥所有，宿主从不认识它（§32.2）：常量是默认值，部署可用环境变量覆盖。
  const offlineClaimTtlMs = offlineClaimTtl()
  const hub = new BridgeHub({
    extensions,
    gateway: ctx.typertGateway,
    pairing,
    roster,
    modelEfforts,
    approvals,
    questions,
    ui,
    jobs,
    sessionMeta,
    usage,
    permissions,
    ownerPeer,
    squads,
    push,
    liveActivity,
    turnEndQuiet,
    offlineClaimTtlMs,
    onPushRegistered: () => { watchers.sync() },
    now: () => Date.now(),
    clientTimeZone: localTimeZone,
    log,
  })

  // A capture-only test context implements no service registry; a Host always
  // does. Without it the bridge still serves protocol v1, minus other plugins'
  // methods, which is exactly what not publishing the seam means.
  if (typeof (ctx as { provide?: unknown }).provide === 'function') {
    ctx.provide(REMOTE_BRIDGE_SERVICE, createRemoteBridgeFace(extensions, hub))
  }

  // 入站栈的活引用：隧道、租约与 Worker 上的注册状态由下面的 effect 建立，配对令牌
  // 路由只读它们此刻的状态，所以一个还没起的隧道、一条还没申到的租约都不会把地址
  // 说成存在。
  const liveIngress: {
    tunnel?: TunnelManager
    pair?: RelayConnectorPair
    registered?: () => string | undefined
    /** 局域网转发器此刻的状态；undefined 表示这一行还没挂上转发器。 */
    forward?: () => LanForwardState
  } = {}

  /**
   * 桥自己此刻的公网入口：顺序由 {@link livePublicOriginOf} 一处算清——租约的稳定
   * 子域名只在后面确实有人服务时优先，快速隧道的注册还没落地时退回隧道 running 的
   * URL，绝不拿一条指向离线页的子域名去做二维码。
   * @returns 公网基址，或 undefined（此刻没有公网入口）。
   */
  const realtimeOrigin = (): string | undefined => livePublicOriginOf({
    lease: liveIngress.pair?.lease,
    registered: liveIngress.registered?.(),
    tunnel: liveIngress.tunnel?.info,
  })

  /**
   * 无公网时的局域网兜底：只答局域网转发器自己说它在监听的地址与端口，转发器没在
   * 监听就没有兜底地址（默认 lanBind 关时正是如此）。
   * @returns 一个地址与端口，或 undefined（此刻本机没有局域网监听者）。
   */
  const lanOrigin = (): { address: string; port: number } | undefined => lanOriginOf(liveIngress.forward?.())

  ctx.effect(() => {
    const disposeUpgrade = ctx.webServer.registerUpgrade({
      path: WS_PATH,
      handler: makeUpgradeHandler(hub, roster, log),
    })
    const disposeRoute = ctx.webServer.register(makePairTokenRoute({
      pairing,
      log,
      // 实时优先：二维码带的是桥自己的公网入口，其次才是环境变量，最后退回局域网
      // 转发器自己报出的监听地址（没有监听者就没有兜底地址，响应结构不变）。
      realtime: realtimeOrigin,
      lan: lanOrigin,
    }))
    log(`protocol v1 listening on ${WS_PATH}`)
    // Where the channel stands is only knowable once the roster is read: a relay
    // token may already be on disk, and a line written before that read would
    // claim a route the bridge is not on. One line, after the one disk read.
    void roster.load()
      .then(() => { watchers.sync() })
      .catch(() => undefined)
      .finally(() => { log(pushChannelLine(pushChannelDescription())) })
    return () => {
      disposeUpgrade()
      disposeRoute()
      watchers.dispose()
      turnEndQuiet.dispose()
      hub.dispose()
      jobs.dispose()
    }
  }, 'remote-bridge: protocol v1 routes')

  // §35 的模型工具：`ui_present` 把 agent 写的整页交给已配对的客户端，并在用户
  // 动作时把结构化事件作为它自己的返回值交回。注册在 `ctx.effect` 里、返回
  // disposer，所以插件卸载时工具名随行消失，宿主工具表不会留下一根指向空实现的
  // 指针；`execute` 把 `exec.signal` 一路传到认领表，回合被取消时那张卡立刻结算。
  ctx.effect(() => {
    const disposeTool = ctx.tools.register(createUiPresentTool({
      present: async (card, signal) => await hub.present(card, signal),
    }))
    log('model tool ui_present registered')
    return () => { disposeTool() }
  }, 'remote-bridge: ui_present tool')

  // 桥自己的入站面：闸门先起，隧道、租约与局域网边缘全部指向闸门端口，公网侧所以
  // 只看见 /ios/v1 一个入口。整条栈挂在一个 effect 里：端口没落定时排一次重试，
  // 卸载按 ingress -> forwarder -> connectors -> tunnel -> gate 释放（disposeBridgeStack），
  // 闸门最后关。
  ctx.effect(() => {
    const forwarder = new LanForwarder()
    // 配对令牌的局域网兜底读这一条：只有转发器真的在监听时它才有答案。
    liveIngress.forward = () => forwarder.snapshot()
    const tunnel = new TunnelManager()
    const ingress = new IngressSync()
    // 命名连接器只在快速隧道计划下启动（leaseConnectorSeams 判据）。
    const namedConnector = createNamedRelayConnector()
    // 桥连接器：租约带 bridge 授权就起，与隧道计划无关。
    const runner = createRelayBridgeRunner({
      onState: (state) => { log('relay bridge: ' + state.state + (state.state === 'failed' ? ' ' + state.error : '')) },
    })
    const cleaner = createLegacyBlockCleaner({ profile: () => settings.profile, log })
    let plan: TunnelPlan | undefined
    let relayPair: RelayConnectorPair | undefined
    let claimer: LeaseClaimer | undefined
    let relayIdentity: RelayIdentity | undefined

    /**
     * 本 profile 的 relay 身份，读一次就共用：租约半区与 announcer 必须是同一个对象，
     * 否则首次登记时的 new_secret 只有一个半区带得动。
     * @returns 身份，或 undefined（读不出来时两个半区都不起来）。
     */
    const identityOf = (): RelayIdentity | undefined => {
      relayIdentity ??= relayIdentityOf(settings.profile, log)
      return relayIdentity
    }

    // Worker 上那行「稳定子域名 -> 本机隧道」的注册：只有快速隧道计划才写，失败只记
    // 一行，绝不阻断隧道。注册上去的 URL 是隧道的目标，也就是入站闸门，所以这一行
    // 只透出 /ios/v1。
    const announcer = createRelayAnnouncer({ identity: identityOf, log })
    // relay 关掉时的唯一出口：撤注册行 + 释放租约一次（老插件 disposeRelayHalf(true)）。
    const relayHalf = createRelayHalfSwitch({ announcer, pair: () => relayPair, log })
    liveIngress.registered = () => announcer.registered
    // 隧道自己报出 URL 的那一刻就是该注册的时刻；running 之外的事件不注册，也不撤行
    // （那行是手机的收藏地址，撤行只发生在 relay 关掉时）。
    tunnel.onPhase((info) => {
      announcer.sync({
        relay: settings.relay,
        mode: plan?.mode,
        url: info.phase === 'running' ? info.url : undefined,
      })
    })

    /**
     * 建 relay 半区，只建一次，而且只在端口落定之后。
     *
     * 读身份这一步会在 $DSH_HOME 里生成一份身份文件，所以它跟着「真的有端口可
     * 发布」这件事走：一个还没有 webServer 端口的宿主什么都不该留下。
     */
    const ensureRelay = (): void => {
      if (relayPair !== undefined || claimer !== undefined || !settings.relay) return
      const identity = identityOf()
      if (identity === undefined) return
      relayPair = new RelayConnectorPair(identity, {
        ...leaseConnectorSeams({
          plan: () => plan,
          startNamed: (token, hostname) => { namedConnector.start(token, hostname) },
          startBridge: (start) => { runner.start(start) },
          stopNamed: () => { namedConnector.stop() },
          stopBridge: () => { runner.stop() },
          log,
        }),
        onState: (state: RelayPairState) => { log('relay lease: ' + relayStateLine(state)) },
      })
      claimer = createLeaseClaimer({
        start: async (input) => { await relayPair?.start({ port: input.port, pluginVersion: readPluginVersion() }) },
        log,
      })
    }
    let gate: IngressGate | undefined
    let gatePort: number | undefined
    let disposed = false
    let lastFirewall: AppliedFirewallState | undefined

    /**
     * 局域网边缘与防火墙规则：按计划选监听地址，规则只在期望状态真的动了时改写
     * （探针与规则重写都是阻塞子进程，不能挂在每次规划上）。
     * @param forward - 这次规划出的边缘。
     * @param wsPort - webServer 的端口（转发器监听它，防火墙放行它）。
     * @param upstreamPort - 闸门端口（转发器的上游）。
     */
    const applyForward = (forward: ForwardPlan, wsPort: number, upstreamPort: number): void => {
      if (forward.host === undefined) {
        void forwarder.stop()
      } else {
        void forwarder.start(forward.host, wsPort, upstreamPort).then((state) => {
          log(state.listening
            ? 'LAN edge listening on ' + String(state.address) + ':' + String(state.port)
              + ' -> gate ' + String(state.upstreamPort)
            : 'LAN edge could not listen on ' + forward.host + ' (' + (state.error ?? 'unknown error')
              + '); loopback access is unaffected')
        })
      }
      if (settings.lanBind === undefined) return
      const next: AppliedFirewallState = { enabled: settings.lanBind === true, port: wsPort }
      if (!firewallActionNeeded(lastFirewall, next)) return
      const ok = next.enabled ? ensureFirewallRule(next.port) : removeFirewallRule(next.port)
      if (ok) {
        lastFirewall = next
      } else {
        log('the host firewall rule could not be updated (admin rights required on managed platforms)')
      }
    }

    /**
     * 端口落定后的一次应用。
     * @param wsPort - webServer 的端口。
     */
    const applyPlan = (wsPort: number): void => {
      const port = gatePort
      if (port === undefined || disposed) return
      const startup = hostService<StartupFacts>(ctx, 'webStartup')
      const next = bridgeWiringPlanOf({
        config: settings,
        gatePort: port,
        ...(startup?.host === undefined ? {} : { startupHost: startup.host }),
        candidates: lanIPv4Addresses(),
        wildcardSupported: wildcardBindSupported(),
      })
      plan = next.tunnel
      if (next.tunnel === undefined) {
        log('autoTunnel is on but the web server port is not bound yet — the quick tunnel starts once it settles')
      } else if (next.tunnel.mode === 'quick') {
        // 目标 URL 是闸门端口：cloudflared 拨闸门，不拨 webServer。
        tunnel.start(next.tunnel.targetUrl)
        for (const ignored of next.tunnel.ignored) log('autoTunnel is on — ignoring the configured ' + ignored)
      } else if (next.tunnel.mode === 'named') {
        tunnel.start({ kind: 'named', token: next.tunnel.token, publicUrl: next.tunnel.publicUrl })
      } else {
        tunnel.stop()
        if (settings.tunnelToken !== undefined) {
          log('tunnelToken is set but publicBaseUrl is missing or not a valid URL — the named tunnel stays off')
        }
      }
      if (settings.relay) {
        // 计划为快速隧道且隧道已经在跑时，这里补一次注册（隧道自己报 URL 的那条路在
        // onPhase 里）；同一 target 由 announcer 去重。
        announcer.sync({ relay: true, mode: next.tunnel?.mode, url: tunnel.info.url })
        // 无隧道分支同样要申领：租约跟着传输走，不跟着隧道走。没有这一步，桥模式下
        // 边缘永远答 no-connector。
        ensureRelay()
        claimer?.claim(port, tunnel.info.url)
      } else {
        // relay 关掉：撤注册行并释放租约（只做一次），局域网边缘与 ingress-sync 照旧。
        relayHalf.off()
      }
      applyForward(next.forward, wsPort, port)
      // ingress-sync 收敛到闸门端口，不是 webServer 端口。
      ingress.schedule(next.ingress)
      liveIngress.pair = relayPair
      liveIngress.tunnel = tunnel
    }

    /** 起闸门并把端口交给下面三步；端口没落定时排一次重试。 */
    const start = async (): Promise<void> => {
      const facts = webServerFacts(ctx.webServer)
      if (facts.port === undefined) {
        retry.request()
        return
      }
      retry.reset()
      if (gate === undefined) {
        const created = createIngressGate({ upstreamHost: facts.host, upstreamPort: facts.port })
        try {
          gatePort = (await created.start()).port
          gate = created
          log('ingress gate listening on 127.0.0.1:' + String(gatePort) + ' -> '
            + facts.host + ':' + String(facts.port) + ' (only ' + WS_PATH + ')')
        } catch (error) {
          log('the ingress gate could not start: ' + String(error))
          return
        }
      }
      if (disposed) return
      applyPlan(facts.port)
    }

    /**
     * 挂载即 relay 关：上一次挂载留下的注册行与租约在这里收掉。身份只读已经存在的
     * 那份——盘上没有就什么都不做，挂载绝不铸造新身份。
     */
    const retireStaleRelayHalf = (): void => {
      if (settings.relay) return
      const identity = existingRelayIdentityOf(settings.profile, log)
      if (identity === undefined) return
      log('relay is off at mount — withdrawing the registration the previous mount left and releasing its lease')
      void retireStaleRelayHalfOf({ identity, log })
    }

    const retry = createPortSettleRetry({ onRetry: () => { void start() }, warn: log })
    // 旧版受管块：一次进程只删一次，而且不在调用方的帧里碰文件。
    cleaner.run()
    // 真实路径上的 release 与 unregister 就在这一行上（挂载时一次，不依赖端口落定）。
    retireStaleRelayHalf()
    void start()

    return () => {
      disposed = true
      retry.dispose()
      liveIngress.pair = undefined
      liveIngress.tunnel = undefined
      liveIngress.registered = undefined
      liveIngress.forward = undefined
      // 卸载只停重试：不撤 Worker 上那行、也不释放租约——那是手机的收藏地址，
      // 陈旧行由服务端 GC 回收（老语义）。
      relayHalf.dispose()
      disposeBridgeStack({
        ingress,
        forwarder,
        ...(relayPair === undefined ? {} : { connectors: relayPair }),
        tunnel,
        ...(gate === undefined ? {} : { gate }),
      }, log)
    }
  }, 'remote-bridge: ingress stack')

  // 会话事件是 `usage.session` 唯一的来源：桥不读会话日志、也不回填历史，所以
  // 这个监听器挂上之前广播的事件不会有读数，宿主没广播过的窗口也不会被编出来。
  ctx.on('session/event', (session, event) => { usage.record(session.id, event) })
  ctx.on('approval/request', (request, next) => hub.approve(request, next))
  // Prepended: the host's waterfall is first-come, and the desktop client's own
  // answerer would otherwise claim every question before this listener is
  // consulted. The claim starts the rest of the chain itself, so prepending does
  // not take the desktop panel away — both surfaces show the question and the
  // first answer settles it.
  ctx.on('user-questions/request', (request, next) => hub.question(request, next), { prepend: true })
}

/**
 * The plugin's mount point: {@link applyImpl} behind the family's
 * single-instance guard. The name is the npm package identity, which every
 * install source of this plugin shares — the aggregate's `web-ui-remote-bridge`
 * row and the standalone `remote-bridge` row alike.
 */
export const apply = mountOnce('@linxin666/dsh-remote-bridge', applyImpl)
