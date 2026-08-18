/** Pure projection of official DSH session events into task activity facts. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PetTaskPhase, PetTaskToolSnapshot } from './protocol.ts'

/** Per-session mutable facts required to understand an event stream. */
export interface ActivityProjectionRuntime {
  activeTools: Map<string, string>
  completedTools: number
  failedTools: number
  officialEventsSeen: boolean
  stepHadFailure: boolean
}

/** One projected activity update, optionally carrying a turn reward. */
export interface ProjectedActivity {
  phase: PetTaskPhase
  statusLine?: string
  narration?: string
  tool?: PetTaskToolSnapshot
  completedTurn?: number
}

/** Create clean projection state for one session. */
export function createActivityProjectionRuntime(): ActivityProjectionRuntime {
  return {
    activeTools: new Map(),
    completedTools: 0,
    failedTools: 0,
    officialEventsSeen: false,
    stepHadFailure: false,
  }
}

/** Keep tool names readable inside compact status surfaces. */
export function displayToolName(name: string): string {
  const compact = name.replace(/\s+/g, ' ').trim() || '工具'
  return compact.length <= 24 ? compact : `${compact.slice(0, 21)}...`
}

function toolSnapshot(
  runtime: ActivityProjectionRuntime,
  fallbackName: string,
): PetTaskToolSnapshot {
  const activeName = runtime.activeTools.values().next().value as string | undefined
  return {
    name: activeName ?? fallbackName,
    activeCount: runtime.activeTools.size,
    completedCount: runtime.completedTools,
    ...(runtime.failedTools === 0 ? {} : { failedCount: runtime.failedTools }),
  }
}

/**
 * Project the durable session vocabulary. Unknown and log-only events return
 * undefined so they cannot overwrite the last meaningful task state.
 */
export function projectOfficialEvent(
  event: SessionEvent,
  runtime: ActivityProjectionRuntime,
): ProjectedActivity | undefined {
  switch (event.type) {
    case 'turn/start':
      runtime.activeTools.clear()
      runtime.completedTools = 0
      runtime.failedTools = 0
      runtime.stepHadFailure = false
      return { phase: 'waiting', statusLine: '准备开始' }
    case 'step/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { phase: 'waiting', statusLine: '等待模型响应' }
    case 'assistant/chunk': {
      const { chunk } = event.data
      if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
        return { phase: 'thinking', statusLine: '正在思考' }
      }
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        return { phase: 'review', statusLine: '整理回复中' }
      }
      return undefined
    }
    case 'assistant/message':
      return { phase: 'review', statusLine: '整理回复中' }
    case 'tool/call': {
      const name = displayToolName(event.data.name)
      runtime.activeTools.set(String(event.data.callId), name)
      return {
        phase: 'tool',
        statusLine: `正在使用 ${name}`,
        tool: toolSnapshot(runtime, name),
      }
    }
    case 'tool/result': {
      const callId = String(event.data.message.source.callId)
      const completedName = runtime.activeTools.get(callId) ?? '工具'
      if (runtime.activeTools.delete(callId)) runtime.completedTools += 1
      const block = event.data.message.content[0]
      runtime.stepHadFailure ||= event.data.error !== undefined || block?.isError === true
      if (event.data.error !== undefined || block?.isError === true) runtime.failedTools += 1
      if (runtime.activeTools.size > 0) {
        return {
          phase: 'tool',
          statusLine: `还有 ${runtime.activeTools.size} 个工具运行中`,
          tool: toolSnapshot(runtime, completedName),
        }
      }
      return runtime.stepHadFailure
        ? {
            phase: 'failed',
            statusLine: '工具执行失败',
            tool: toolSnapshot(runtime, completedName),
          }
        : {
            phase: 'thinking',
            statusLine: '处理工具结果',
            tool: toolSnapshot(runtime, completedName),
          }
    }
    case 'turn/end': {
      runtime.activeTools.clear()
      switch (event.data.reason.kind) {
        case 'completed':
          return {
            phase: 'done',
            statusLine: '完成啦',
            completedTurn: event.data.turn,
          }
        case 'error':
          return { phase: 'failed', statusLine: '执行失败' }
        case 'max-tokens':
          return { phase: 'failed', statusLine: '达到输出上限' }
        case 'interrupted':
          return { phase: 'failed', statusLine: '执行意外中断' }
        case 'blocked':
          return { phase: 'blocked', statusLine: '任务受阻，等待继续' }
        case 'aborted':
          return { phase: 'idle', statusLine: '已停止' }
        default:
          return { phase: 'idle' }
      }
    }
    default:
      return undefined
  }
}
