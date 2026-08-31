/**
 * dsh-perf 会话尾部完整性观察探针(浏览器半区)。
 *
 * 目的: 现场取证"会话跑完但会话区没显示最后输出/输入框残留"一类客户端问题。
 * 机制(只读, 绝不干预渲染):
 * - 订阅 sessions.list, 跟踪每个会话 running 位; 在其 true→false 边沿(回合结束),
 *   对仍驻留的会话做三项检查:
 *   1. final-node-missing: 最后一个 assistant-step 已 settled 但没有 finalNode
 *      (定义只接受 surfaceOp=append 的 assistant/message, 该证据标记缺失);
 *   2. stale-tail: 服务端 history 尾部事件(assistant/message) seq 晚于客户端
 *      窗口最后一个可见节点 —— 窗口落后于主机尾部;
 *   3. draft-residue: 编辑框非空而会话已不再运行(忙碌态点击"停止"的签名:
 *      取消回合但草稿保留)。
 * - 发现写入 localStorage 环形缓冲(dsh-perf-integrity-ring)并 console.warn,
 *   供事后回溯; 观察器自身任何失败静默降级, 绝不影响插件宿主。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the sessions Context merge.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** 完整性发现类别。 */
export type IntegrityKind = 'final-node-missing' | 'stale-tail' | 'draft-residue'

/** 一条完整性发现。 */
export interface IntegrityFinding {
  ts: number
  sessionId: string
  kind: IntegrityKind
  detail: string
}

const RING_KEY = 'dsh-perf-integrity-ring'
const RING_SIZE = 24
const COOLDOWN_MS = 30_000

/** 窄接口: 只描述观察器用到的服务面。 */
interface SessionsLike {
  list?: {
    subscribe: (fn: () => void) => () => void
    getSnapshot: () => { byId?: Record<string, { running?: boolean } | undefined> }
  }
  binding?: (sessionId: string) => { session?: SessionLike } | undefined
}

interface SessionLike {
  getSnapshot?: () => {
    running?: boolean
    chat?: { legacy?: { nodes?: unknown[] } }
  }
  history?: (opts: { maxMessages: number }) => Promise<{
    result?: { value?: { events?: { event?: { seq?: number; type?: string } }[] } }
  }>
}

/** 会话窗口最后一个节点的最小视图。 */
export interface TailNodeView {
  kind?: string
  anchorSeq?: number
  data?: {
    status?: string
    finalNode?: unknown
    turn?: unknown
    step?: unknown
    blocks?: unknown[]
  }
}

/**
 * 纯判定: 最后一个 assistant-step 已 settled 却缺少 finalNode。
 * @param node - 窗口尾部节点(取最后一个 assistant-step 传入)。
 * @returns 发现类别或 null。
 */
export function classifyStepTail(node: TailNodeView | undefined): IntegrityKind | null {
  if (node?.kind !== 'assistant-step') return null
  if (node.data?.status === 'settled' && node.data.finalNode === undefined) return 'final-node-missing'
  return null
}

/**
 * 纯判定: 服务端 history 尾部是 assistant/message 且 seq 晚于窗口最后可见节点。
 * @param hostTail - history 返回的最后一个事件的 event 视图。
 * @param lastNode - 客户端窗口最后一个可见节点。
 * @returns 发现类别或 null。
 */
export function classifyStaleTail(
  hostTail: { seq?: number; type?: string } | undefined,
  lastNode: { anchorSeq?: number; kind?: string } | undefined,
): IntegrityKind | null {
  if (hostTail?.type !== 'assistant/message') return null
  if (typeof hostTail.seq !== 'number' || typeof lastNode?.anchorSeq !== 'number') return null
  if (hostTail.seq > lastNode.anchorSeq) return 'stale-tail'
  return null
}

function readRing(): IntegrityFinding[] {
  try {
    const raw = localStorage.getItem(RING_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as IntegrityFinding[]) : []
  } catch {
    return []
  }
}

function writeRing(finding: IntegrityFinding): void {
  try {
    const next = [...readRing(), finding].slice(-RING_SIZE)
    localStorage.setItem(RING_KEY, JSON.stringify(next))
  } catch {
    // 存储失败(配额/隐私模式)只降级观测, 不抛出。
  }
}

/**
 * 启动观察器。
 * @param ctx - 插件客户端上下文(仅经 inject 服务访问)。
 * @param isEnabled - 总开关读取器; 观察器随 enabled 生命周期启停。
 * @returns 停止函数。
 */
export function startIntegrityObserver(ctx: ClientContext, isEnabled: () => boolean): () => void {
  let sessions: SessionsLike | undefined
  try {
    sessions = ctx.get('sessions') as SessionsLike | undefined
  } catch {
    return () => {}
  }
  if (typeof sessions?.list?.subscribe !== 'function') return () => {}

  let disposed = false
  const running = new Map<string, boolean>()
  const lastHit = new Map<string, number>()

  const record = (sessionId: string, kind: IntegrityKind, detail: string): void => {
    if (!isEnabled()) return
    const now = Date.now()
    const key = sessionId + ':' + kind
    const cooldown = lastHit.get(key) ?? 0
    if (cooldown > now) return
    lastHit.set(key, now + COOLDOWN_MS)
    const finding: IntegrityFinding = { ts: now, sessionId, kind, detail }
    writeRing(finding)
    console.warn('[dsh-perf-integrity]', kind, sessionId, detail)
  }

  const checkTurnEnd = (sessionId: string): void => {
    try {
      const session = sessions?.binding?.(sessionId)?.session
      if (session === undefined) return
      const snapshot = session.getSnapshot?.()
      const nodes = (snapshot?.chat?.legacy?.nodes ?? []) as TailNodeView[]
      if (nodes.length === 0) return

      // 1. 尾部 assistant-step 是否 settled 却无 finalNode。
      const lastStep = [...nodes].reverse().find((node) => node.kind === 'assistant-step')
      const stepFinding = classifyStepTail(lastStep)
      if (stepFinding !== null) {
        record(sessionId, stepFinding, 'step ' + String(lastStep?.data?.turn) + ':' + String(lastStep?.data?.step) + ' settled without finalNode (blocks=' + (lastStep?.data?.blocks ?? []).length + ')')
      }

      // 2. 与主机尾部比对 —— 窗口落后检测。
      void (async () => {
        try {
          const result = await session.history?.({ maxMessages: 50 })
          const events = result?.result?.value?.events ?? []
          const hostTail = events.at(-1)?.event
          const lastNode = nodes[nodes.length - 1]
          const stale = classifyStaleTail(hostTail, lastNode)
          if (stale !== null) {
            record(sessionId, stale, 'history tail seq=' + String(hostTail?.seq) + ' (' + String(hostTail?.type) + ') > last node seq=' + String(lastNode?.anchorSeq) + ' kind=' + String(lastNode?.kind))
          }
        } catch {
          // 探测性 history 失败不记录, 也不抛出。
        }
      })()

      // 3. 草稿残留: 会话不再运行但编辑框非空(忙碌态停止签名)。
      if (snapshot?.running === false) {
        try {
          const textarea = document.querySelector('textarea')
          const value = textarea?.value ?? ''
          if (value.trim() !== '') {
            record(sessionId, 'draft-residue', 'editor non-empty (' + value.length + ' chars) while session idle after a running edge')
          }
        } catch {
          // DOM 探测失败忽略。
        }
      }
    } catch {
      // 观察器绝不打断宿主。
    }
  }

  const unsubscribe = sessions.list.subscribe(() => {
    if (disposed) return
    try {
      const byId = sessions?.list?.getSnapshot().byId ?? {}
      for (const [sessionId, summary] of Object.entries(byId)) {
        const now = summary?.running ?? false
        const prev = running.get(sessionId) ?? false
        if (prev && !now) checkTurnEnd(sessionId)
        running.set(sessionId, now)
      }
    } catch {
      // 列表形状漂移时本轮跳过。
    }
  })

  return () => {
    disposed = true
    unsubscribe()
  }
}
