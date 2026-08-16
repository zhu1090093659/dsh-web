/**
 * Official trajectory row projection: replicates (read-only) the cell-index
 * enumeration of the shipped ui-trajectory layout so the browser injector can
 * map each official `tr[data-record-index]` to a rollback/restore state
 * without touching the official UI. This is a pure mirror of the official
 * layout rules for the current dsh SDK (rc.6); it never imports from the
 * official package at value level.
 *
 * Every official row gets an entry with its global cellIndex and the file-op
 * count applied up to that position (stateIndex). Only settled write/edit
 * calls carry a FileOp: calls whose result is outside the trajectory window
 * or still running have unknown file state and stay op-less (the row then
 * reports "no changes" instead of guessing).
 */
import type { ConversationNode, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { fileOpFromCall, textOf, type FileOp } from './trajectory.ts'

export type OfficialRowKind =
  | 'request' | 'system' | 'compacted' | 'user' | 'message' | 'context' | 'tool' | 'subtool'

export interface OfficialRowProjection {
  /** Value of the official row's `tr[data-record-index]` attribute. */
  readonly cellIndex: number
  readonly kind: OfficialRowKind
  /** File op carried by this row (settled write/edit only). */
  readonly op: FileOp | undefined
  /** File ops applied up to and including this row (applySetAt index). */
  readonly stateIndex: number
  readonly callId?: string
  /** Short row label (tool name or kind), used for master tree labels. */
  readonly label: string
}

export interface OfficialRowsInput {
  readonly nodes: readonly ConversationNode[]
  /** Raw RequestView[] from the trajectory snapshot (fields are read structurally). */
  readonly requests?: readonly unknown[]
  readonly partial?: { readonly turn: number; readonly step: number; readonly blocks: readonly unknown[] } | null
  readonly runningCalls: readonly RunningToolCall[]
}

interface RequestLike {
  readonly purpose: string
  readonly startSeq: number
  readonly turn: number | null
  readonly step: number
  readonly promptChange?: { readonly seq: number; readonly kind: string }
  readonly prompt?: unknown
}

function requestOf(value: unknown): RequestLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.purpose !== 'string' || typeof record.startSeq !== 'number') return undefined
  const changeRaw = record.promptChange
  let promptChange: { readonly seq: number; readonly kind: string } | undefined
  if (typeof changeRaw === 'object' && changeRaw !== null) {
    const change = changeRaw as Record<string, unknown>
    if (typeof change.seq === 'number' && typeof change.kind === 'string') {
      promptChange = { seq: change.seq, kind: change.kind }
    }
  }
  return {
    purpose: record.purpose,
    startSeq: record.startSeq,
    turn: typeof record.turn === 'number' ? record.turn : null,
    step: typeof record.step === 'number' ? record.step : 0,
    ...(promptChange === undefined ? {} : { promptChange }),
    prompt: record.prompt,
  }
}

interface ToolBlockLike {
  readonly kind?: string
  readonly callId: string
  readonly name: string
  readonly argsRaw?: string
  readonly subCalls?: readonly unknown[]
  readonly content?: readonly { type?: string; text?: string }[]
  readonly call?: { readonly name?: string | null; readonly argsRaw?: string } | null
}

function asBlock(value: unknown): ToolBlockLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.callId !== 'string' || record.callId === '') return undefined
  const call = typeof record.call === 'object' && record.call !== null
    ? record.call as Record<string, unknown>
    : undefined
  const callName = typeof call?.name === 'string' && call.name !== '' ? call.name : undefined
  const callArgs = typeof call?.argsRaw === 'string' ? call.argsRaw : undefined
  return {
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    callId: record.callId,
    name: typeof record.name === 'string' && record.name !== '' ? record.name : (callName ?? record.callId),
    argsRaw: callArgs ?? (typeof record.argsRaw === 'string' ? record.argsRaw : undefined),
    subCalls: Array.isArray(record.subCalls) ? record.subCalls : undefined,
    content: Array.isArray(record.content) ? record.content : undefined,
    call: call === undefined
      ? null
      : { name: callName ?? null, argsRaw: callArgs },
  }
}

/**
 * Enumerate the official trajectory rows and attach per-row file state.
 * @returns rows sorted by cellIndex (the official display order).
 */
export function projectOfficialRows(input: OfficialRowsInput): readonly OfficialRowProjection[] {
  const { nodes, requests = [], partial = null, runningCalls = [] } = input

  const resultByCall = new Map<string, ToolBlockLike>()
  const emittedFromBlocks = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      const block = asBlock(node)
      if (block !== undefined) resultByCall.set(node.callId, block)
    } else if (node.kind === 'assistant') {
      for (const block of node.blocks) {
        if (block.kind === 'tool-call') emittedFromBlocks.add(block.callId)
      }
    }
  }
  const callById = new Map<string, ToolBlockLike>(resultByCall)
  for (const call of runningCalls) {
    const block = asBlock(call)
    if (block !== undefined) callById.set(call.callId, block)
  }

  const represented = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'assistant' && node.step > 0) represented.add(`${node.turn}\u0000${node.step}`)
  }
  if (partial !== null && partial.step > 0) represented.add(`${partial.turn}\u0000${partial.step}`)
  for (const call of runningCalls) {
    if (call.step > 0) represented.add(`${call.turn}\u0000${call.step}`)
  }

  interface Entry {
    readonly seq: number
    readonly initial: boolean
    readonly kind: 'node' | 'request' | 'system' | 'compaction'
    readonly node?: ConversationNode
  }
  const entries: Entry[] = []
  for (const node of nodes) entries.push({ kind: 'node', seq: node.seq, initial: false, node })
  for (const raw of requests) {
    const request = requestOf(raw)
    if (request === undefined) continue
    if (request.purpose === 'compaction') {
      entries.push({ kind: 'compaction', seq: request.startSeq, initial: false })
    } else if (request.purpose === 'assistant') {
      if (request.promptChange !== undefined && request.prompt !== undefined) {
        entries.push({
          kind: 'system',
          seq: request.promptChange.seq,
          initial: request.promptChange.kind === 'initial',
        })
      }
      if (!represented.has(`${request.turn}\u0000${request.step}`)) {
        entries.push({ kind: 'request', seq: request.startSeq, initial: false })
      }
    }
  }
  entries.sort((left, right) =>
    (left.initial ? Number.NEGATIVE_INFINITY : left.seq)
    - (right.initial ? Number.NEGATIVE_INFINITY : right.seq))

  const rows: OfficialRowProjection[] = []
  let index = 0
  let opCount = 0
  const emittedRows = new Set<string>()

  const push = (
    kind: OfficialRowKind,
    callId: string | undefined,
    op: FileOp | undefined,
    label: string,
  ): void => {
    index += 1
    if (op !== undefined) opCount += 1
    if (callId !== undefined) emittedRows.add(callId)
    rows.push({
      cellIndex: index,
      kind,
      op,
      stateIndex: opCount,
      ...(callId === undefined ? {} : { callId }),
      label,
    })
  }

  const emitSubCalls = (subs: readonly unknown[] | undefined): void => {
    if (subs === undefined) return
    for (const raw of subs) {
      const block = asBlock(raw)
      if (block === undefined) continue
      const settled = block.kind === 'tool-result'
      if (settled) {
        const op = fileOpFromCall(0, 0, 0, 0, block.name, block.argsRaw, textOf(block.content))
        push('subtool', block.callId, op, block.name)
      } else {
        push('subtool', block.callId, undefined, block.name)
      }
      emitSubCalls(block.subCalls)
    }
  }

  const emitToolRow = (
    callId: string,
    name: string,
    argsRaw: string | undefined,
    result: ToolBlockLike | undefined,
    subCalls: readonly unknown[] | undefined,
  ): void => {
    const op = result === undefined
      ? undefined
      : fileOpFromCall(0, 0, 0, 0, name, argsRaw, textOf(result.content))
    push('tool', callId, op, name)
    emitSubCalls(subCalls)
  }

  const emitAssistantBlocks = (blocks: readonly unknown[]): void => {
    push('message', undefined, undefined, 'assistant')
    for (const raw of blocks) {
      if (typeof raw !== 'object' || raw === null) continue
      const record = raw as Record<string, unknown>
      if (record.kind !== 'tool-call') continue
      const callId = typeof record.callId === 'string' ? record.callId : ''
      const name = typeof record.name === 'string' ? record.name : callId
      if (callId === '') continue
      const argsRaw = typeof record.argsRaw === 'string' ? record.argsRaw : undefined
      const call = callById.get(callId)
      emitToolRow(callId, name, argsRaw, resultByCall.get(callId), call?.subCalls)
    }
  }

  for (const entry of entries) {
    if (entry.kind === 'request') {
      push('request', undefined, undefined, 'request')
      continue
    }
    if (entry.kind === 'system') {
      push('system', undefined, undefined, 'system')
      continue
    }
    if (entry.kind === 'compaction') {
      push('compacted', undefined, undefined, 'compacted')
      continue
    }
    const node = entry.node
    if (node === undefined) continue
    switch (node.kind) {
      case 'user':
      case 'steering':
        push('user', undefined, undefined, node.kind)
        break
      case 'context':
        push('context', undefined, undefined, 'context')
        break
      case 'assistant':
        emitAssistantBlocks(node.blocks)
        break
      case 'tool-result': {
        if (emittedFromBlocks.has(node.callId)) break
        const block = asBlock(node)
        if (block === undefined) break
        emitToolRow(node.callId, block.name, block.argsRaw, block, block.subCalls)
        break
      }
      default:
        // compaction nodes, command/error/max-tokens/model-retry/unknown:
        // the official layout emits no row for these.
        break
    }
  }

  if (partial !== null) emitAssistantBlocks(partial.blocks)

  for (const call of runningCalls) {
    if (emittedRows.has(call.callId)) continue
    const block = asBlock(call)
    emitToolRow(call.callId, call.name, call.argsRaw, undefined, block?.subCalls)
  }

  return rows
}
