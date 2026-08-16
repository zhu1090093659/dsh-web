/**
 * Pure trajectory state math shared by the browser injector and tests:
 * write/edit calls project into per-position file states that rollback
 * (create a master tree) and restore (return to the main tree) apply.
 *
 * Rollback fidelity rules:
 * - A write whose result text says "Created" has a known baseline (absent),
 *   so rolling back to before it deletes the file.
 * - A write always yields an exact state from its own position onward.
 * - An edit is exact only when the file state before it is exact; otherwise
 *   the path is reported as skipped instead of guessed.
 */
import type { WriteTarget } from './types.ts'

export interface FileOp {
  readonly id: string
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly kind: 'write' | 'edit'
  readonly path: string
  readonly content?: string
  readonly oldString?: string
  readonly newString?: string
  readonly replaceAll?: boolean
  /** write only: result said Created (true), Updated (false), unknown (undefined). */
  readonly created?: boolean
}

export interface ApplySet {
  readonly writes: readonly WriteTarget[]
  readonly deletes: readonly string[]
  readonly skipped: readonly string[]
}

export function parseArgs(argsRaw: string | undefined): unknown {
  if (argsRaw === undefined || argsRaw === '') return undefined
  try {
    return JSON.parse(argsRaw) as unknown
  } catch {
    return undefined
  }
}

function createdFromResult(resultText: string | undefined): boolean | undefined {
  if (resultText === undefined || resultText === '') return undefined
  if (/created/i.test(resultText)) return true
  if (/updated/i.test(resultText)) return false
  return undefined
}

/** Derive one file op from a settled tool call (write/edit only). */
export function fileOpFromCall(
  seq: number,
  time: number,
  turn: number,
  step: number,
  name: string,
  argsRaw: string | undefined,
  resultText: string | undefined,
): FileOp | undefined {
  if (name !== 'write' && name !== 'edit') return undefined
  const args = parseArgs(argsRaw)
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  const path = typeof record.file_path === 'string' ? record.file_path : ''
  if (path === '') return undefined
  const id = `${seq}:${step}:${name}:${path}`
  if (name === 'write') {
    const content = typeof record.content === 'string' ? record.content : ''
    return {
      id, seq, time, turn, step,
      kind: 'write', path, content, created: createdFromResult(resultText),
    }
  }
  const oldString = typeof record.old_string === 'string' ? record.old_string : ''
  const newString = typeof record.new_string === 'string' ? record.new_string : ''
  if (oldString === '') return undefined
  return {
    id, seq, time, turn, step,
    kind: 'edit', path, oldString, newString,
    replaceAll: record.replace_all === true,
  }
}

export function textOf(blocks: readonly { type?: string; text?: string }[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => (block.text as string))
    .join('\n')
}

/** File state at a given op count (clamped), for rollback/restore targets. */
export function applySetAt(ops: readonly FileOp[], count: number): ApplySet {
  const clamped = Math.max(0, Math.min(count, ops.length))
  const state = new Map<string, { content: string | undefined; exact: boolean }>()
  const createdBy = new Map<string, number>()
  ops.forEach((op, index) => {
    if (op.kind === 'write' && op.created === true && !createdBy.has(op.path)) {
      createdBy.set(op.path, index)
    }
  })
  for (let index = 0; index < clamped; index++) {
    const op = ops[index]
    if (op === undefined) continue
    if (op.kind === 'write') {
      state.set(op.path, { content: op.content ?? '', exact: true })
      continue
    }
    const entry = state.get(op.path)
    if (
      entry !== undefined
      && entry.exact
      && entry.content !== undefined
      && op.oldString !== undefined
      && op.newString !== undefined
    ) {
      const next = op.replaceAll === true
        ? entry.content.replaceAll(op.oldString, op.newString)
        : entry.content.replace(op.oldString, op.newString)
      state.set(op.path, next === entry.content ? { content: undefined, exact: false } : { content: next, exact: true })
    } else {
      state.set(op.path, { content: undefined, exact: false })
    }
  }
  const writes: WriteTarget[] = []
  const skipped = new Set<string>()
  for (const [path, entry] of state) {
    if (entry.exact && entry.content !== undefined) writes.push({ path, content: entry.content })
    else skipped.add(path)
  }
  const deletes: string[] = []
  for (const [path, createdIndex] of createdBy) {
    if (createdIndex >= clamped) deletes.push(path)
  }
  return { writes, deletes, skipped: [...skipped] }
}
