/**
 * Browser half for @linxin666/dsh-perf: a tiny performance HUD.
 *
 * One poll loop reads the host's loopback-fenced /api/dsh-perf/stats
 * (event/s, event-loop delay, memory, batch delay) and merges it with local
 * browser sampling (rAF FPS + per-plugin DOM-activity scoreboard + an
 * attributed long-task log). Everything degrades silently:
 * a missing host half hides the HUD, a hostile environment keeps the GUI
 * unaffected. apply() never throws.
 * @module @linxin666/dsh-perf/client
 */

import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale / settings-surface / slot merge points.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official conversation SlotMap augmentation (conversation.chat.node).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type { ComponentType } from 'react'
import { zh, en, type PerfKey } from './perf-locales.ts'
import { dictionaries as bsmDictionaries, type BetterSessionKey } from './bs-locales.ts'
import { PerfSettingsCard, PerfSettingsCardController, type PerfSettings, type PerfSettingsCardFace } from './perf-settings-card.tsx'
import { makePerfAssistantShadow, type ShadowOwner } from './perf-assistant-shadow.tsx'
import { startIntegrityObserver } from './perf-integrity.ts'
import { makeListSetGate, type ListSetGate, type SessionListSnapshotLike } from './perf-list-gate.ts'
import {
  createAttributionAggregator,
  createLongtaskLog,
  readLongtaskSource,
  startDomAttributionSampler,
  type LongtaskRecord,
} from './perf-attribution.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'dsh-perf'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-perf': PerfKey | BetterSessionKey
  }
  interface SlotMap {
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional binder provided by dsh-web-settings. */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** Services required by the browser half. */
export const inject = ['slots', 'locale', 'settingsScope', 'sessions']


/** Wire shape the host half returns; loose on purpose (host version drift). */
interface StatsWire {
  ok?: boolean
  ts?: number
  uptimeMs?: number
  mode?: string
  meterIntervalMs?: number
  batchDelayMs?: number
  elDelay?: { meanMs?: number; p99Ms?: number; maxMs?: number }
  mem?: { rssMB?: number; heapUsedMB?: number }
  events?: { perSec?: number; window?: number; activeSessions?: number }
  topSessions?: { id?: string; eventsPerSec?: number; lastType?: string; status?: string }[]
  eventTypes?: Record<string, number>
  alert?: {
    kind?: string
    activeSessions?: number
    eventsPerSec?: number
    maxSessions?: number
    maxEventsPerSec?: number
  } | null
}

const API_STATS = '/api/dsh-perf/stats'
const POLL_MS = 2000
const STORAGE_KEY = 'dsh-perf-hud-visible'
const FPS_WINDOW_MS = 1000

export function apply(ctx: ClientContext): void {
  // 全局开关: 与 host 共用 dsh-perf 命名空间; false 时 HUD 与 CSS 降载一并停用。
  let perfScope: SettingsScope<PerfSettings> | undefined
  try {
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
    perfScope = binder.bind<PerfSettings>({ namespace: NS })
  } catch { /* 无设置面时按默认开启 */ }
  // 渲染降载/HUD/完整性观察开关: 统一走插件设置命名空间。
  let renderDegrade = true
  let hudOn = false
  let hudDispose: (() => void) | undefined
  let integrityDispose: (() => void) | undefined
  let listGateDispose: (() => void) | undefined
  const refreshClientSwitches = (): void => {
    let snapshotValue: PerfSettings | undefined
    try {
      const snapshot = perfScope?.getSnapshot()
      if (snapshot?.status === 'ready') snapshotValue = snapshot.value as PerfSettings
    } catch { /* noop */ }
    renderDegrade = snapshotValue?.renderDegrade ?? true
    const nextHudOn = snapshotValue?.hudEnabled ?? false
    if (nextHudOn !== hudOn) {
      hudOn = nextHudOn
      try {
        if (hudOn && hudDispose === undefined) {
          hudDispose = boot(isEnabled)
        } else if (!hudOn && hudDispose !== undefined) {
          hudDispose()
          hudDispose = undefined
        }
      } catch (error) {
        console.debug('[dsh-perf] HUD boot degraded:', error)
      }
    }
    // CSS 降载(P0): 独立于 HUD(默认关) 生效, 跟随总开关。
    try {
      installPerfCss(isEnabled)
    } catch { /* noop */ }
    // 尾部完整性观察: 跟随总开关 enabled(默认开) 启停。
    const shouldRun = isEnabled()
    if (shouldRun && integrityDispose === undefined) {
      try {
        integrityDispose = startIntegrityObserver(ctx, isEnabled)
      } catch (error) {
        console.debug('[dsh-perf] integrity observer degraded:', error)
      }
    } else if (!shouldRun && integrityDispose !== undefined) {
      integrityDispose()
      integrityDispose = undefined
    }
    // 会话列表发布门控(#4): 仅投影身份变化的 flush 合并到 ~1Hz, 跟随总开关 + renderDegrade。
    const shouldGate = isEnabled() && renderDegrade
    if (shouldGate && listGateDispose === undefined) {
      try {
        listGateDispose = installListGate(ctx)
      } catch (error) {
        console.warn('[dsh-perf] list gate degraded:', error)
      }
    } else if (!shouldGate && listGateDispose !== undefined) {
      listGateDispose()
      listGateDispose = undefined
    }
  }
  const isEnabled = (): boolean => {
    try {
      const snapshot = perfScope?.getSnapshot()
      return snapshot?.status === 'ready' ? (snapshot.value?.enabled ?? true) : true
    } catch { return true }
  }
  try { refreshClientSwitches(); perfScope?.subscribe(refreshClientSwitches) } catch { /* noop */ }
  // 词典: 设置卡文案 + Better Session 子节文案(bsm.* 前缀, 同一命名空间,
  // 因为 Better Session 管理面嵌在 perf 设置卡内部渲染)。
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh: { ...zh, ...bsmDictionaries.zh }, en: { ...en, ...bsmDictionaries.en } }), 'dsh-perf: dictionaries')
  } catch { /* noop */ }
  // 设置卡: 贡献到 "Web 插件" 组, 绑定 dsh-perf 命名空间。
  try {
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
    const settingsScope = binder.bind<PerfSettings>({ namespace: NS })
    const controller = new PerfSettingsCardController(settingsScope)
    ctx.slots.inject('web-ui.plugin.item', () => {
      try {
        const unregister = ctx.slots.register({
          name: 'web-ui.plugin.item',
          id: 'dsh-perf',
          order: 95,
          locale: NS,
          inject: () => controller.inject() as PerfSettingsCardFace,
        }, PerfSettingsCard)
        return () => { controller.dispose(); unregister() }
      } catch {
        return () => {}
      }
    })
  } catch (error) {
    console.debug('[dsh-perf] settings card degraded:', error)
  }
  // P1: 保持观感的 assistant-step shadow —— 全部经官方渲染器输出, 仅对超重已结算
  // 消息把高亮终态延迟到回合结束热路径之外(见 perf-assistant-shadow.tsx)。
  try {
    const slotsCore = ctx.get('slots') as unknown as {
      entries?: (key: string) => readonly { component?: unknown; options?: { priority?: number; key?: string } }[]
      entriesOfSlot?: (key: string) => readonly { component?: unknown; options?: { key?: string } }[]
    } | undefined
    ctx.slots.inject('conversation.chat.node', () => {
      try {
        // 注册优先级: 取该 cell 已有条目的最小 priority, 再额外下探一段保留带,
        // 保证 "lowest renders" 投影下本影子永远排最前, 同时给第三方替换渲染器
        // 留出落位空间 —— 它们常把 priority 硬编码为 -1(例如
        // @morlay/ui-conversation-message-actions), 而 keyed slot 对同 key 同
        // priority 是硬校验, 撞值会让后注册方整个插件加载失败。
        const SHADOW_PRIORITY_HEADROOM = 8
        const existing = (slotsCore?.entries?.('conversation.chat.node') ?? [])
          .filter((entry) => entry?.options?.key === 'assistant-step')
          .map((entry) => Number(entry?.options?.priority ?? 0))
        const floor = (existing.length === 0 ? 0 : Math.min(...existing)) - 1 - SHADOW_PRIORITY_HEADROOM
        // 影子组件先建好: 懒捕获回调需要排除自身(entries 按 priority 排序, 影子排最前)。
        const shadow = makePerfAssistantShadow(undefined, () => renderDegrade, () => {
          // React.memo 组件 typeof === 'object'(Symbol(react.memo) 标签对象), 不能用
          // typeof === 'function' 过滤 —— 官方 AssistantNodeView 是 memo, 那是旧版
          // 捕获永远落空的第二个根因(第一个是未绑定 this 的 register)。
          for (const entry of slotsCore?.entries?.('conversation.chat.node') ?? []) {
            if (entry?.options?.key === 'assistant-step' && entry.component != null && entry.component !== shadow) {
              return entry.component as ComponentType<ShadowOwner>
            }
          }
          return undefined
        })
        // 类型擦除: 官方注册同款 options 形态(仅 name/key/priority/locale); inject 面由 slot 声明提供。
        // register 内部读 this.ctx —— 必须绑定服务实例调用(裸引用会丢 this, 这是旧版 P1 静默失效的根因)。
        const register = ctx.slots.register as unknown as (options: Record<string, unknown>, component: unknown) => () => void
        const unregister = register.call(ctx.slots, {
          name: 'conversation.chat.node',
          key: 'assistant-step',
          priority: floor,
          locale: NS,
        }, shadow)
        // 自诊断(每页一次): 注册后读投影胜者, 确认 shadow 确实是该 cell 的渲染者。
        try {
          const winners = slotsCore?.entriesOfSlot?.('conversation.chat.node') ?? []
          const winner = winners.find((entry) => entry?.options?.key === 'assistant-step')
          const candidate = winner?.component
          const winnerName = candidate == null
            ? 'none'
            : typeof candidate === 'function'
              ? ((candidate as { displayName?: string; name?: string }).displayName ?? (candidate as { name?: string }).name ?? 'fn')
              : String((candidate as { $$typeof?: symbol }).$$typeof === Symbol.for('react.memo') ? 'memo(assistant-step)' : (candidate as { displayName?: string }).displayName ?? 'component')
          console.log('[dsh-perf] assistant shadow: registered at priority ' + floor + ', projected winner ' + winnerName)
        } catch { /* 诊断输出失败不影响注册 */ }
        return () => { unregister() }
      } catch (error) {
        console.warn('[dsh-perf] assistant shadow registration failed:', error)
        return () => {}
      }
    })
  } catch (error) {
    console.warn('[dsh-perf] assistant shadow degraded:', error)
  }
}

/**
 * #4: 会话列表 store 发布门控(单例, 方法级补丁)。
 * projectList 每 flush 全量重建快照对象再 list.set; 流式期间主体是 usage 投影帧 ——
 * 侧栏可见字段没变也触发整树重渲染(实测 1700+ 会话账号)。门控把"仅 projectionValues
 * 身份变化"的发布合并到每 ~1s 一次尾部补发; 有可见变化立即发布。唯一可感知代价:
 * 子代理 lineage 头部的 token 计数刷新降到 ~1Hz。dispose 时恢复原始 set 并补发挂起快照。
 */
let listGateInstalled = false
function installListGate(ctx: ClientContext): () => void {
  const sessions = ctx.get('sessions') as unknown as {
    list?: {
      set?: (next: SessionListSnapshotLike) => void
      getSnapshot?: () => SessionListSnapshotLike
      __dshPerfGate?: ListSetGate
    }
  } | undefined
  const list = sessions?.list
  if (list === undefined || typeof list.set !== 'function' || typeof list.getSnapshot !== 'function') {
    console.warn('[dsh-perf] list gate: sessions.list store shape not recognized, skipped')
    return () => {}
  }
  // 幂等: 重复安装(HMR/双源)直接复用已有门。
  if (list.__dshPerfGate !== undefined) {
    console.log('[dsh-perf] list gate: already installed, reuse')
    return () => {}
  }
  const originalSet = list.set
  const gate = makeListSetGate({
    coalesceMs: readPositiveInt('dsh-perf-list-coalesce', 1000),
    getPublished: () => list.getSnapshot?.() ?? {},
    publish: (next) => { originalSet(next) },
  })
  list.set = gate.set
  list.__dshPerfGate = gate
  listGateInstalled = true
  try {
    if (localStorage.getItem('dsh-perf-debug') === '1') {
      ;(window as unknown as { __dshPerfListGate?: ListSetGate }).__dshPerfListGate = gate
    }
  } catch { /* noop */ }
  console.log('[dsh-perf] list gate: installed on sessions.list (coalesce projection-only publishes)')
  return () => {
    gate.dispose()
    if (list.__dshPerfGate === gate) {
      list.set = originalSet
      delete list.__dshPerfGate
    }
    listGateInstalled = false
  }
}

function readPositiveInt(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
  } catch { return fallback }
}

/** P0 CSS 降载样式(单例): 屏外消息行 content-visibility 近似虚拟化。 */
let perfCssStyle: HTMLStyleElement | undefined
function installPerfCss(isEnabled: () => boolean): void {
  try {
    const off = localStorage.getItem('dsh-perf-css') === 'off'
    if (!isEnabled() || off) {
      perfCssStyle?.remove()
      perfCssStyle = undefined
      return
    }
    if (perfCssStyle !== undefined && perfCssStyle.isConnected) return
    const style = document.createElement('style')
    style.dataset.dshPerf = 'css'
    // 选择器列表后必须带 '{': 缺失时浏览器丢弃整条规则, 降载形同虚设。
    style.textContent = [
      '[data-chat-flow-kind="assistant-step"],',
      '[data-chat-flow-kind="tool-call"] {',
      '  content-visibility: auto;',
      '  contain-intrinsic-size: auto 120px;',
      '}',
      // 侧栏会话行(dsh-better-sidebar 渲染, 类名形如 YDXeBa_sessionRow): 展开大分组时
      // 一次挂载数千行, 屏外行跳过渲染; 行高实测 32px。选择器用 _sessionRow 子串,
      // 锚定 _sidebarCol 避免误伤同名类。上游若改类名规则自然失效(无副作用)。
      '[class*="_sidebarCol"] [class*="_sessionRow"] {',
      '  content-visibility: auto;',
      '  contain-intrinsic-size: auto 32px;',
      '}',
    ].join('\n')
    document.head.appendChild(style)
    perfCssStyle = style
  } catch { /* noop */ }
}

function boot(isEnabled: () => boolean): () => void {
  const host = document.documentElement
  if (host === null || host === undefined) return () => {}

  const root = document.createElement('div')
  root.dataset.dshPerf = 'hud'
  root.style.cssText = [
    'position:fixed', 'bottom:10px', 'right:10px', 'z-index:2147483000',
    'padding:7px 9px', 'border-radius:8px', 'background:rgba(15,20,26,.92)',
    'color:#d8e0ea', 'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace',
    'white-space:pre', 'pointer-events:auto', 'user-select:none',
    'box-shadow:0 2px 12px rgb(0 0 0 / .35)', 'max-width:340px', 'overflow:hidden',
    'border:1px solid transparent',
  ].join(';')

  const cache: { stats?: StatsWire; stale: boolean; failures: number } = { stats: undefined, stale: true, failures: 0 }
  let fps = 0
  // --- 按插件活动度归因([data-dsh-plugin]) + 长任务来源记录 ----------------
  const longtaskLog = createLongtaskLog()
  const activityAgg = createAttributionAggregator()
  const stopAttribution = startDomAttributionSampler(activityAgg)

  // --- 本地采样: FPS(近 1s) + Longtask(近 60s) ----------------------
  let frames = 0
  let fps0 = performance.now()
  const rafLoop = (): void => {
    frames += 1
    const now = performance.now()
    if (now - fps0 >= FPS_WINDOW_MS) {
      fps = Math.round((frames * 1000) / (now - fps0))
      frames = 0
      fps0 = now
    }
    requestAnimationFrame(rafLoop)
  }
  requestAnimationFrame(rafLoop)

  try {
    const observer = new PerformanceObserver((list) => {
      const now = performance.now()
      // 一个回调可能批量送达多条长任务, 逐条记录(旧实现按回调只记一条)。
      for (const entry of list.getEntries()) {
        longtaskLog.push({ t: now, durationMs: entry.duration, source: readLongtaskSource(entry) })
      }
      longtaskLog.prune(now)
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* Safari/旧 Chrome 无 longtask: 静默 */ }

  // --- CSS 降载(P0) 已移出 boot(): HUD 默认关闭时独立于 HUD 生效(见 installPerfCss)。



// --- 轮询 host -----------------------------------------------------
  const poll = async (): Promise<void> => {
    let wire: StatsWire | undefined
    try {
      const response = await fetch(API_STATS, { cache: 'no-store' })
      if (!response.ok) throw new Error('http ' + response.status)
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null) wire = body as StatsWire
    } catch { /* host half 未启用/未安装 */ }
    if (wire === undefined) {
      cache.failures += 1
      if (cache.failures >= 3) {
        cache.stale = true
        root.style.display = 'none'
      }
      return
    }
    cache.failures = 0
    cache.stats = wire
    cache.stale = false
    if (!isEnabled()) {
      root.style.display = 'none'
      return
    }
    try {
      render(root, cache, fps)
    } catch (error) {
      // 畸形 wire(host 版本漂移)按缺失处理: 静默, 不产生 unhandled rejection。
      console.debug('[dsh-perf] render degraded:', error)
      root.style.display = 'none'
    }
  }

  // --- 渲染 -----------------------------------------------------------
  let renderInto: HTMLElement | undefined
  function render(hostEl: HTMLElement, state: { stats?: StatsWire }, currentFps: number): void {
    const s = state.stats
    if (s === undefined) return
    const lines: string[] = []
    const mode = s.mode ?? '?'
    const batch = s.batchDelayMs ?? '?'
    const alert = typeof s.alert === 'object' && s.alert !== null ? s.alert : undefined
    if (alert) {
      const reason = alert.kind === 'sessions'
        ? '会话 ' + (alert.activeSessions ?? '?') + ' 个 ≥ 阈值 ' + (alert.maxSessions ?? '?')
        : alert.kind === 'events'
          ? '事件 ' + (alert.eventsPerSec ?? '?') + '/s ≥ 阈值 ' + (alert.maxEventsPerSec ?? '?')
          : '会话与事件均超阈值'
      lines.push('[!] ' + reason)
    }
    lines.push('dsH PERF  mode=' + mode + '  batch=' + batch + 'ms')
    const ev = s.events ?? {}
    lines.push('events ' + (ev.perSec ?? '?') + '/s  active=' + (ev.activeSessions ?? '?') + '  win=' + (ev.window ?? '?'))
    const el = s.elDelay ?? {}
    lines.push('EL p99=' + fmtMs(el.p99Ms) + ' mean=' + fmtMs(el.meanMs))
    const nowTs = performance.now()
    lines.push(
      'fps=' + currentFps +
      '  longtasks(60s)=' + longtaskLog.countSince(nowTs, 60_000) +
      '  max=' + fmtMs(longtaskLog.maxSince(nowTs, 60_000)),
    )
    // 按插件活动度计分板: data-dsh-plugin 归因的 DOM 新增速率 Top3。
    try {
      const act = activityAgg.snapshot(nowTs, 3)
      if (act.topPlugins.length > 0 || act.totalNodesPerSec > 0.05) {
        const parts = act.topPlugins.map((p) => p.name + '=' + fmtRate(p.nodesPerSec))
        if (act.otherNodesPerSec >= 0.1) parts.push('rest=' + fmtRate(act.otherNodesPerSec))
        lines.push('act ' + parts.join(' · '))
      }
    } catch { /* 计分板任何异常都不影响主 HUD 输出 */ }
    const mem = s.mem ?? {}
    lines.push('rss=' + (mem.rssMB ?? '?') + 'MB  heap=' + (mem.heapUsedMB ?? '?') + 'MB')
    const top = Array.isArray(s.topSessions) ? s.topSessions : []
    for (const session of top.slice(0, 3)) {
      const id = shortId(session.id ?? '?')
      const statusMark = session.status === 'idle' ? ' ·idle' : ''
      lines.push('  · ' + id + '  ' + (session.eventsPerSec ?? '?') + '/s [' + (session.lastType ?? '') + ']' + statusMark)
    }
    hostEl.style.borderColor = alert ? '#ff8a65' : 'transparent'
    if (peekBtn !== undefined) peekBtn.style.display = currentVisible() ? 'none' : 'block'
    if (renderInto !== undefined) renderInto.textContent = lines.join('\n')
    else hostEl.textContent = lines.join('\n')
  }
  function fmtMs(value: number | undefined): string {
    if (value === undefined) return '?'
    return (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10) + 'ms'
  }
  function fmtRate(value: number): string {
    return (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)) + '/s'
  }
  function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 12) + '…' : id
  }

  // --- 可见性 / 生命周期 ----------------------------------------------
  function currentVisible(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== 'hidden'
  }
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.dataset.dshPerfAction === 'close') {
      localStorage.setItem(STORAGE_KEY, 'hidden')
      applyCollapse()
      return
    }
    if (target?.dataset.dshPerfAction === 'peek') {
      localStorage.setItem(STORAGE_KEY, 'shown')
      applyCollapse()
    }
    // 收缩状态下点击面板任意处也可展开
    if (!currentVisible() && target !== null) {
      localStorage.setItem(STORAGE_KEY, 'shown')
      applyCollapse()
    }
  })

  const closeBtn = document.createElement('button')
  closeBtn.dataset.dshPerfAction = 'close'
  closeBtn.textContent = '×'
  closeBtn.style.cssText = 'position:absolute;top:2px;right:4px;border:0;background:none;color:#8fa3b8;cursor:pointer;font:12px/1 monospace;padding:2px'
  const peekBtn = document.createElement('button')
  peekBtn.dataset.dshPerfAction = 'peek'
  peekBtn.textContent = '▲'
  peekBtn.style.cssText = 'position:absolute;top:2px;right:20px;border:0;background:none;color:#8fa3b8;cursor:pointer;font:12px/1 monospace;padding:2px;display:none'
  root.appendChild(peekBtn)
  root.appendChild(closeBtn)

  // 数据区与关闭按钮分离: textContent 更新不得清掉按钮。
  const dataEl = document.createElement('pre')
  dataEl.style.cssText = 'margin:0;font:inherit;color:inherit'
  root.appendChild(dataEl)
  root.appendChild(closeBtn)
  // render 状态注入容器
  renderInto = dataEl

  document.body.appendChild(root)
  const applyCollapse = (): void => {
    const collapsed = !currentVisible()
    root.style.width = collapsed ? 'auto' : ''
    root.style.maxWidth = collapsed ? 'none' : '340px'
    if (renderInto !== undefined) {
      renderInto.textContent = collapsed ? 'PERF ' : renderInto.textContent
    }
  }
  applyCollapse()
  // 调试句柄: 与列表门控同款开关(dsh-perf-debug=1), 供现场取证用。
  try {
    if (localStorage.getItem('dsh-perf-debug') === '1') {
      ;(window as unknown as { __dshPerfAttribution?: unknown }).__dshPerfAttribution = {
        snapshot: (): unknown => activityAgg.snapshot(performance.now(), 12),
        longtasks: (): readonly LongtaskRecord[] => longtaskLog.list(),
        topSources: (n?: number): unknown => longtaskLog.topSources(performance.now(), 60_000, n),
      }
    }
  } catch { /* noop */ }
  void poll()
  const timer = setInterval(poll, POLL_MS)
  return () => {
    clearInterval(timer)
    stopAttribution?.()
  }
}