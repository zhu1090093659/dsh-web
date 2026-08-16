/**
 * Host branch file service: request validation, workspace gating, and real
 * preview/apply on a temp directory.
 */
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApplyRequest, BranchError } from '../src/core/types.ts'
import {
  BranchFsService, isApplyRequest, isWriteTarget,
  type WorkspaceGate,
} from '../src/host/fs-service.ts'

let dir: string
const gate: WorkspaceGate = async path => ({ ok: true, canonical: path })
const rejectedGate: WorkspaceGate = async () => ({
  ok: false,
  error: { code: 'workspace-unknown', message: 'not a workspace' } as BranchError,
})

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-branch-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('request guards', () => {
  it('validates write targets', () => {
    expect(isWriteTarget({ path: 'a.txt', content: 'x' })).toBe(true)
    expect(isWriteTarget({ path: '', content: 'x' })).toBe(false)
    expect(isWriteTarget({ path: 'a.txt' })).toBe(false)
    expect(isWriteTarget(null)).toBe(false)
  })

  it('validates apply requests', () => {
    const valid: ApplyRequest = { cwd: dir, writes: [{ path: 'a.txt', content: 'x' }], deletes: [] }
    expect(isApplyRequest(valid)).toBe(true)
    expect(isApplyRequest({ ...valid, cwd: '' })).toBe(false)
    expect(isApplyRequest({ ...valid, writes: 'nope' })).toBe(false)
    expect(isApplyRequest({ ...valid, deletes: [42] })).toBe(false)
  })
})

describe('BranchFsService', () => {
  it('previews creates, writes, and deletes', async () => {
    const service = new BranchFsService(gate)
    const created = await service.preview({ cwd: dir, writes: [{ path: 'a.txt', content: 'v1' }], deletes: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value[0].action).toBe('create')
    expect(created.value[0].changed).toBe(true)

    // Preview is read-only: applying the same content first flips the entry to write.
    const applied = await service.apply({ cwd: dir, writes: [{ path: 'a.txt', content: 'v1' }], deletes: [] })
    expect(applied.ok).toBe(true)

    const updated = await service.preview({ cwd: dir, writes: [{ path: 'a.txt', content: 'v1' }], deletes: ['missing.txt'] })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value[0].action).toBe('write')
    expect(updated.value[0].changed).toBe(false)
    expect(updated.value[1].action).toBe('delete')
    expect(updated.value[1].changed).toBe(false)
  })

  it('applies writes and deletes to disk', async () => {
    const service = new BranchFsService(gate)
    const result = await service.apply({
      cwd: dir,
      writes: [
        { path: 'nested/dir/b.txt', content: 'hello' },
        { path: 'gone.txt', content: 'bye' },
      ],
      deletes: ['gone.txt'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.written).toBe(2)
    expect(result.value.deleted).toBe(1)
    expect(result.value.failed).toBe(0)
    expect(await readFile(join(dir, 'nested/dir/b.txt'), 'utf8')).toBe('hello')
  })

  it('rejects paths escaping the workspace', async () => {
    const service = new BranchFsService(gate)
    const request: ApplyRequest = {
      cwd: dir,
      writes: [{ path: '../escape.txt', content: 'x' }],
      deletes: [],
    }
    const preview = await service.preview(request)
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(preview.error.code).toBe('path-escape')
    const apply = await service.apply(request)
    expect(apply.ok).toBe(false)
  })

  it('rejects requests for unregistered workspaces', async () => {
    const service = new BranchFsService(rejectedGate)
    const result = await service.preview({ cwd: dir, writes: [], deletes: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('workspace-unknown')
  })
})
