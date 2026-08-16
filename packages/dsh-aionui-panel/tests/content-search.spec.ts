/**
 * FsService.searchContent tests: case-insensitive line matching grouped per
 * file, noise-dir and binary pruning, per-file match cap, and the file-cap
 * truncation flag.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FsService } from '../src/host/fs-service.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'
import type { ContentSearchView } from '../src/core/types.ts'

const gate: WorkspaceGate = async (root) => ({ ok: true, canonical: root })

let roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aionui-content-search-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

async function search(service: FsService, root: string, query: string): Promise<ContentSearchView> {
  const result = await service.searchContent(root, query)
  expect('hits' in result).toBe(true)
  return result as ContentSearchView
}

describe('FsService.searchContent', () => {
  it('finds matching lines per file, prunes noise dirs and binary content', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'const x = "Hello World"\nno match\n')
    await writeFile(join(root, 'README.md'), '# Hi\nhello again\n')
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'hello hidden\n')
    await writeFile(join(root, 'data.bin'), Buffer.from([0, 1, 2, 104, 101, 108, 108, 111, 0]))

    const service = new FsService(gate)
    const view = await search(service, root, 'hello')
    expect(view.hits.map((hit) => hit.path)).toEqual(['src/a.ts', 'README.md'])
    expect(view.hits[0]?.matches).toEqual([{ line: 1, text: 'const x = "Hello World"' }])
    expect(view.hits[1]?.matches).toEqual([{ line: 2, text: 'hello again' }])
  })

  it('matches case-insensitively and caps matches per file', async () => {
    const root = await makeRoot()
    let content = ""
    for (let index = 1; index <= 10; index += 1) content += `line ${index} HELLO\n`
    await writeFile(join(root, 'many.txt'), content)

    const service = new FsService(gate)
    const view = await search(service, root, 'hello')
    expect(view.hits).toHaveLength(1)
    expect(view.hits[0]?.matches).toHaveLength(5)
    expect(view.hits[0]?.matches[0]).toEqual({ line: 1, text: 'line 1 HELLO' })
    expect(view.hits[0]?.matches[4]).toEqual({ line: 5, text: 'line 5 HELLO' })
  })

  it('returns empty for an empty query and flags truncation at the file cap', async () => {
    const root = await makeRoot()
    const service = new FsService(gate)
    const empty = await search(service, root, '   ')
    expect(empty.hits).toEqual([])
    expect(empty.truncated).toBe(false)

    for (let index = 1; index <= 51; index += 1) {
      const name = `f${String(index).padStart(2, '0')}.txt`
      await writeFile(join(root, name), `needle ${index}\n`)
    }
    const capped = await search(service, root, 'needle')
    expect(capped.hits).toHaveLength(50)
    expect(capped.truncated).toBe(true)
  })
})
