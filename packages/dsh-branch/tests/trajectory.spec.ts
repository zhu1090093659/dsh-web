/**
 * Pure file-op derivation + rollback/restore state math.
 */
import { describe, expect, it } from 'vitest'
import { applySetAt, fileOpFromCall } from '../src/core/trajectory.ts'

const writeArgs = (path: string, content: string): string =>
  JSON.stringify({ file_path: path, content })
const editArgs = (path: string, oldString: string, newString: string, replaceAll = false): string =>
  JSON.stringify({ file_path: path, old_string: oldString, new_string: newString, replace_all: replaceAll })

describe('fileOpFromCall', () => {
  it('derives writes with the created flag from the result text', () => {
    const created = fileOpFromCall(3, 3000, 1, 1, 'write', writeArgs('a.txt', 'v1'), 'Created a.txt')
    expect(created?.kind).toBe('write')
    expect(created?.path).toBe('a.txt')
    expect(created?.content).toBe('v1')
    expect(created?.created).toBe(true)
    const updated = fileOpFromCall(4, 4000, 1, 2, 'write', writeArgs('b.txt', 'v2'), 'Updated b.txt')
    expect(updated?.created).toBe(false)
    expect(fileOpFromCall(5, 5000, 1, 3, 'write', writeArgs('c.txt', 'v3'), undefined)?.created).toBeUndefined()
  })

  it('derives edits with old/new strings and replaceAll', () => {
    const edit = fileOpFromCall(4, 4000, 1, 2, 'edit', editArgs('a.txt', 'v1', 'v2', true), 'Updated a.txt')
    expect(edit?.kind).toBe('edit')
    expect(edit?.oldString).toBe('v1')
    expect(edit?.newString).toBe('v2')
    expect(edit?.replaceAll).toBe(true)
  })

  it('ignores non-file tools and malformed payloads', () => {
    expect(fileOpFromCall(1, 1, 1, 1, 'bash', '{"command":"echo hi"}', 'hi')).toBeUndefined()
    expect(fileOpFromCall(1, 1, 1, 1, 'write', 'not-json', 'Created')).toBeUndefined()
    expect(fileOpFromCall(1, 1, 1, 1, 'write', '{"file_path":""}', 'Created')).toBeUndefined()
    expect(fileOpFromCall(1, 1, 1, 1, 'edit', '{"file_path":"a.txt","new_string":"x"}', 'Updated')).toBeUndefined()
  })
})

describe('applySetAt', () => {
  const ops = [
    fileOpFromCall(3, 3000, 1, 1, 'write', writeArgs('a.txt', 'v1'), 'Created a.txt')!,
    fileOpFromCall(4, 4000, 1, 2, 'edit', editArgs('a.txt', 'v1', 'v2'), 'Updated a.txt')!,
  ]

  it('rolling back before a Created write deletes the file', () => {
    const before = applySetAt(ops, 0)
    expect(before.deletes).toEqual(['a.txt'])
    expect(before.writes).toHaveLength(0)
  })

  it('applies an edit chain exactly when the base state is known', () => {
    expect(applySetAt(ops, 1).writes).toEqual([{ path: 'a.txt', content: 'v1' }])
    expect(applySetAt(ops, 2).writes).toEqual([{ path: 'a.txt', content: 'v2' }])
  })

  it('honors replaceAll on edits', () => {
    const chain = [
      fileOpFromCall(3, 3000, 1, 1, 'write', writeArgs('a.txt', 'x y x'), 'Created a.txt')!,
      fileOpFromCall(4, 4000, 1, 2, 'edit', editArgs('a.txt', 'x', 'z', true), 'Updated a.txt')!,
    ]
    expect(applySetAt(chain, 2).writes).toEqual([{ path: 'a.txt', content: 'z y z' }])
  })

  it('skips edits whose base state is unknown', () => {
    const loneEdit = [
      fileOpFromCall(3, 3000, 1, 1, 'edit', editArgs('a.txt', 'v1', 'v2'), 'Updated a.txt')!,
    ]
    const set = applySetAt(loneEdit, 1)
    expect(set.writes).toHaveLength(0)
    expect(set.skipped).toContain('a.txt')
  })

  it('clamps out-of-range counts', () => {
    expect(applySetAt(ops, 99).writes).toEqual([{ path: 'a.txt', content: 'v2' }])
    expect(applySetAt(ops, -1).writes).toHaveLength(0)
  })
})
