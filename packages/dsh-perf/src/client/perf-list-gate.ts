/**
 * dsh-perf 会话列表 store 发布门控(#4)。
 *
 * 问题(官方 bundle 实锤): sessions projectList 每次 manager flush 都把
 * {ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress} 全部
 * 重建为新对象再 list.set —— 即使可见内容毫无变化, zustand 按 Object.is 必通知,
 * 侧栏 SessionTree/FlatList/SearchResults 的 useSessions((s) => s) 整树重渲染。
 * 流式期间 flush 的主体是 usage/token 投影帧: 只有 byId 条目的 projectionValues
 * 身份变化, 侧栏可见字段(标题/running/updatedAt/顺序/徽标)一个都没变。
 *
 * 设计: 包装 sessions.list.set(方法级补丁, 不换 store 对象, 官方内部 this.list.set
 * 调用点自动走门)。每次发布前与当前已发布快照做"可见字段"比对:
 * - 有可见变化 -> 立即发布(并带走最新投影);
 * - 仅 projectionValues 身份变化 -> 合并到尾部定时器, 最多每 coalesceMs 发布一次
 *   (最新值胜出)。唯一可感知代价: 子代理 lineage 头部的 token 实时计数刷新从
 *   每 usage 帧降为 ~1Hz, 其余消费方语义不变。
 * 纯逻辑可测: makeListSetGate 不依赖 DOM/cordis。
 */

export interface SessionListEntryLike {
  id?: string
  displayTitle?: string
  running?: boolean
  blank?: boolean
  completed?: boolean
  updatedAt?: number
  pendingInteraction?: unknown
  projectionValues?: unknown
  title?: string
  cwd?: string
  parentId?: string
  origin?: string
  agentPreset?: string
  [k: string]: unknown
}

export interface SessionListSnapshotLike {
  ids?: string[]
  byId?: Record<string, SessionListEntryLike | undefined>
  current?: string
  phase?: string
  subagentsByParent?: Record<string, unknown>
  jobsBySession?: Record<string, unknown>
  currentAddress?: unknown
  [k: string]: unknown
}

/** 逐字段比对单条会话条目, 唯一豁免 projectionValues(投影身份, 侧栏不显示)。 */
function sameEntryVisible(a: SessionListEntryLike | undefined, b: SessionListEntryLike | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('projectionValues')
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}

/** 键值表比对: 同键同引用(目录/任务表的值在内容不变时身份稳定)。 */
function sameRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in b)) return false
    const va = a[key]
    const vb = b[key]
    if (Object.is(va, vb)) continue
    if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
      let equal = true
      for (let i = 0; i < va.length; i += 1) {
        if (!Object.is(va[i], vb[i])) { equal = false; break }
      }
      if (equal) continue
    }
    return false
  }
  return true
}

/** 两个列表快照的可见内容是否一致(豁免 byId 条目的 projectionValues 身份)。 */
export function sameVisibleContent(a: SessionListSnapshotLike, b: SessionListSnapshotLike): boolean {
  if (a === b) return true
  if (!Object.is(a.current, b.current)) return false
  if (!Object.is(a.phase, b.phase)) return false
  if (!Object.is(a.currentAddress, b.currentAddress)) return false
  const aIds = a.ids ?? []
  const bIds = b.ids ?? []
  if (aIds.length !== bIds.length) return false
  for (let i = 0; i < aIds.length; i += 1) {
    if (aIds[i] !== bIds[i]) return false
  }
  const aById = a.byId ?? {}
  const bById = b.byId ?? {}
  const aKeys = Object.keys(aById)
  const bKeys = Object.keys(bById)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!sameEntryVisible(aById[key], bById[key])) return false
  }
  return sameRecord(a.subagentsByParent, b.subagentsByParent) && sameRecord(a.jobsBySession, b.jobsBySession)
}

export interface ListSetGateCounts {
  /** 立即发布次数(可见变化)。 */
  published: number
  /** 被合并的仅投影变化次数。 */
  coalesced: number
  /** 尾部定时器补发次数。 */
  flushed: number
}

export interface ListSetGate {
  set: (next: SessionListSnapshotLike) => void
  readonly counts: ListSetGateCounts
  /** 立即补发挂起的合并快照并停表(卸载/开关切换时调用, 不丢更新)。 */
  dispose: () => void
}

export interface ListSetGateOptions {
  coalesceMs: number
  /** 读当前已发布快照(用于比对)。 */
  getPublished: () => SessionListSnapshotLike
  /** 真正发布。 */
  publish: (next: SessionListSnapshotLike) => void
  now?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

export function makeListSetGate(options: ListSetGateOptions): ListSetGate {
  const now = options.now ?? ((): number => Date.now())
  const setTimeoutFn = options.setTimeoutFn ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle: unknown): void => { clearTimeout(handle as Parameters<typeof clearTimeout>[0]) })
  const counts: ListSetGateCounts = { published: 0, coalesced: 0, flushed: 0 }
  let pending: SessionListSnapshotLike | undefined
  let timer: unknown
  let disposed = false

  function clearPendingTimer(): void {
    if (timer !== undefined) {
      clearTimeoutFn(timer)
      timer = undefined
    }
  }

  function flushPending(): void {
    clearPendingTimer()
    if (pending === undefined) return
    const next = pending
    pending = undefined
    counts.flushed += 1
    options.publish(next)
  }

  return {
    set(next: SessionListSnapshotLike): void {
      if (disposed) { options.publish(next); return }
      const published = options.getPublished()
      if (!sameVisibleContent(published, next)) {
        // 可见变化: 立即发布最新快照(其中已含最新投影), 挂起的合并直接作废。
        clearPendingTimer()
        pending = undefined
        counts.published += 1
        options.publish(next)
        return
      }
      // 仅投影身份变化: 合并, 尾部补发最新值。
      pending = next
      counts.coalesced += 1
      if (timer === undefined) {
        timer = setTimeoutFn((): void => {
          timer = undefined
          flushPending()
        }, options.coalesceMs)
      }
    },
    get counts(): ListSetGateCounts { return counts },
    dispose(): void {
      if (disposed) return
      disposed = true
      flushPending()
    },
  }
}