/**
 * FsService menu operations (rename / mkdir / newFile / resolveAbsolute):
 * gated like every other operation, .git refused, the root itself refused,
 * bare-name validation for rename, and wx semantics for new files. Uses a
 * real temporary directory.
 */
import { describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsService } from '../src/host/fs-service.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'

const gate: WorkspaceGate = async (root) => ({ ok: true, canonical: root })

async function makeRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'aionui-menu-')))
}

describe('FsService menu operations', () => {
  it('renames a file and keeps it inside its own directory', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'old.ts'), 'x')
    const service = new FsService(gate)
    const result = await service.rename(root, 'old.ts', 'new.ts')
    expect(result).toEqual({ ok: true })
    await access(join(root, 'new.ts'))
    await expect(access(join(root, 'old.ts'))).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it('refuses rename of the root and of .git paths', async () => {
    const root = await makeRoot()
    await mkdir(join(root, '.git'))
    const service = new FsService(gate)
    expect(await service.rename(root, '', 'x')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.rename(root, '.git', 'x')).toMatchObject({ code: 'path-outside-root' })
    await rm(root, { recursive: true, force: true })
  })

  it('rejects rename names that carry separators or traversal', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.txt'), 'x')
    const service = new FsService(gate)
    for (const name of ['', '.', '..', 'b/c', 'b\\c', '  ']) {
      const result = await service.rename(root, 'a.txt', name)
      expect(result).toMatchObject({ code: 'path-outside-root' })
    }
    // The original file must still be there and intact.
    await access(join(root, 'a.txt'))
    await rm(root, { recursive: true, force: true })
  })

  it('creates directories (parent must exist) and refuses the root', async () => {
    const root = await makeRoot()
    const service = new FsService(gate)
    expect(await service.mkdir(root, '')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.mkdir(root, 'src')).toEqual({ ok: true })
    expect((await stat(join(root, 'src'))).isDirectory()).toBe(true)
    // Parent missing: node mkdir without recursive must fail -> write-failed.
    expect(await service.mkdir(root, 'a/b')).toMatchObject({ code: 'write-failed' })
    await rm(root, { recursive: true, force: true })
  })

  it('creates empty files and refuses to overwrite existing ones', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'exists.txt'), 'keep')
    const service = new FsService(gate)
    expect(await service.newFile(root, 'new.txt')).toEqual({ ok: true })
    expect((await stat(join(root, 'new.txt'))).size).toBe(0)
    // wx flag: an existing file is never truncated.
    expect(await service.newFile(root, 'exists.txt')).toMatchObject({ code: 'write-failed' })
    const content = await (await import('node:fs/promises')).readFile(join(root, 'exists.txt'), 'utf8')
    expect(content).toBe('keep')
    await rm(root, { recursive: true, force: true })
  })

  it('resolveAbsolute gates and resolves, refusing .git', async () => {
    const root = await makeRoot()
    const service = new FsService(gate)
    const resolved = await service.resolveAbsolute(root, 'a/b.ts')
    expect(resolved).toEqual({ ok: true, abs: join(root, 'a/b.ts') })
    expect(await service.resolveAbsolute(root, '.git/config')).toMatchObject({ code: 'path-outside-root' })
    await rm(root, { recursive: true, force: true })
  })
})
