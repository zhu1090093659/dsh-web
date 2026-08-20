/**
 * Shared snapshot fixtures for chat-recovery tests. Type-only imports from
 * the SDK: the runtime/client half is a closure-factory bundle for the GUI
 * module loader and cannot be value-imported under vitest, so every snapshot
 * is built field by field.
 */
import type {
  AssistantMessageNode,
  ConversationNode,
  ConversationSnapshot,
  ModelRetryNode,
  SessionId,
  ToolResultNode,
  TurnErrorNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'

export const SRC = 'src-session' as SessionId

/** Minimal-but-complete ConversationSnapshot; the plugin only reads these fields. */
export function snapshot(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SRC,
    views: {} as ConversationSnapshot['views'],
    chat: {} as ConversationSnapshot['chat'],
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...over,
  }
}

export function userMsg(seq: number, text = 'hello world'): UserMessageNode {
  return { kind: 'user', seq, time: seq, content: [{ type: 'text', text }], source: null }
}

export function imageUserMsg(seq: number): UserMessageNode {
  return {
    kind: 'user',
    seq,
    time: seq,
    content: [{ type: 'image', attachment: {} as never }],
    source: null,
  }
}

export function assistantMsg(seq: number, turn: number, over: Partial<AssistantMessageNode> = {}): AssistantMessageNode {
  return {
    kind: 'assistant',
    seq,
    time: seq,
    turn,
    step: 1,
    blocks: [{ kind: 'text', text: 'ok' }],
    messageId: `m${seq}` as MessageId,
    ...over,
  }
}

export function interruptedMsg(seq: number, turn: number): AssistantMessageNode {
  return assistantMsg(seq, turn, { interrupted: true, messageId: undefined })
}

export function turnErr(seq: number, turn: number, message: string, code?: string): TurnErrorNode {
  return { kind: 'turn-error', seq, time: seq, turn, step: 1, message, code }
}

export function maxTokens(seq: number, turn: number): ConversationNode {
  return { kind: 'turn-max-tokens', seq, time: seq, turn, step: 1 }
}

export function toolResult(seq: number, name = 'bash'): ToolResultNode {
  return {
    kind: 'tool-result',
    seq,
    time: seq,
    callId: `c${seq}`,
    call: { name, argsRaw: '{}' },
    callTime: null,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

export function modelRetry(seq: number, turn: number, retryState: 'scheduled' | 'started' | 'cancelled'): ModelRetryNode {
  return {
    retryId: 'r1' as never,
    kind: 'model-retry',
    seq,
    time: seq,
    turn,
    step: 1,
    provider: 'deepseek',
    mode: 'normal',
    policyKey: 'default',
    retry: 1,
    maxRetries: 3,
    delayMs: 100,
    failure: { message: 'timeout', code: 'timeout' },
    retryState,
  }
}

export function steeringMsg(seq: number): ConversationNode {
  return {
    kind: 'steering',
    messageId: `m${seq}` as MessageId,
    seq,
    time: seq,
    content: [{ type: 'text', text: 'steer' }],
    source: null,
  }
}

export function contextMsg(seq: number): ConversationNode {
  return {
    kind: 'context',
    seq,
    time: seq,
    content: [{ type: 'text', text: 'injected context' }],
    source: null,
    provenance: { role: 'system', producer: 'plugin' } as never,
    form: null,
  }
}
