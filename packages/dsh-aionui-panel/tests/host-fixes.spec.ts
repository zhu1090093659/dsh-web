/**
 * Host-half regression tests for the security/robustness fixes:
 * - C1: symlink escape is blocked by realpath validation in FsService
 *       (read/write/delete) and in GitService.discard.
 * - H1: discard derives the root-relative path with relative() (no garbage
 *       slice) and refuses untracked files that lie outside the session root.
 * - M4: the JPEG probe parses the SOF marker for dimensions instead of the
 *       APP0 segment.
 * - L4: delete/write refuse .git paths.
 * Uses a real temporary directory so the symlink behavior is exercised.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsService, probeImageSize } from '../src/host/fs-service.ts'
import { GitService, type GitRunner } from '../src/host/git-service.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'

/** Build a synthetic JPEG header (SOI + APP0 + SOF0 with known dims). */
function buildJpeg(height: number, width: number): Buffer {
  const bytes: number[] = [0xff, 0xd8] // SOI
  bytes.push(0xff, 0xe0, 0x00, 0x10) // APP0 marker + length(16)
  for (let i = 0; i < 14; i += 1) bytes.push(0) // APP0 payload
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08) // SOF0 + length(17) + precision
  bytes.push((height >> 8) & 0xff, height & 0xff)
  bytes.push((width >> 8) & 0xff, width & 0xff)
  bytes.push(0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00)
  return Buffer.from(bytes)
}

const gate: WorkspaceGate = async (root) => ({ ok: true, canonical: root })

describe('probeImageSize (M4: JPEG SOF parsing)', () => {
  it('reads dimensions from the SOF marker, not the APP0 segment', () => {
    expect(probeImageSize(buildJpeg(376, 608))).toEqual({ height: 376, width: 608 })
    expect(probeImageSize(buildJpeg(0x0100, 0x0200))).toEqual({ height: 256, width: 512 })
  })

  it('returns undefined for malformed/truncated JPEGs', () => {
    const jpeg = buildJpeg(100, 100)
    expect(probeImageSize(jpeg.subarray(0, 4))).toBeUndefined()
    expect(probeImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xc0]))).toBeUndefined()
    expect(probeImageSize(Buffer.from('not an image'))).toBeUndefined()
  })
})

describe('FsService symlink escape (C1)', () => {
  it('refuses to read/write/delete through a symlink pointing outside the root', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-gate-')))

    const outsideDir = join(dir, 'outside')
    const root = join(dir, 'root')
    await mkdir(root)
    await mkdir(outsideDir)
    await writeFile(join(outsideDir, 'secret.txt'), 'secret')
    // A symlink inside root pointing at the outside directory.
    await symlink(outsideDir, join(root, 'link'))
    const service = new FsService(gate)

    // read through the link must be refused (path-outside-root).
    const readResult = await service.read(root, 'link/secret.txt', false)
    expect(readResult).toMatchObject({ code: 'path-outside-root' })

    // write through the link must be refused.
    const writeResult = await service.write(root, 'link/secret.txt', 'pwned')
    expect(writeResult).toMatchObject({ code: 'path-outside-root' })

    // delete through the link must not delete the outside target.
    const deleteResult = await service.delete(root, 'link')
    expect(deleteResult).toMatchObject({ code: 'path-outside-root' })
    expect(await realpath(join(outsideDir, 'secret.txt'))).toBe(join(outsideDir, 'secret.txt'))

    await rm(dir, { recursive: true, force: true })
  })

  it('blocks .git writes and deletes (L4) but still lists/reads them', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-git-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git', 'config'), 'cfg')
    await writeFile(join(root, 'ok.txt'), 'ok')
    const service = new FsService(gate)

    expect(await service.delete(root, '.git')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.delete(root, '.git/config')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.write(root, '.git/HEAD', 'ref')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.write(root, 'sub/.git/HEAD', 'ref')).toMatchObject({ code: 'path-outside-root' })
    // Reads remain allowed (viewing .git content was the prior behavior).
    const read = await service.read(root, '.git/config', false)
    expect(read).toMatchObject({ content: 'cfg' })

    await rm(dir, { recursive: true, force: true })
  })
})

describe('FsService.readRaw (markdown image route)', () => {
  it('returns raw bytes with a derived mime', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-raw-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, 'assets'), { recursive: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
    await writeFile(join(root, 'assets', 'pic.png'), png)
    await writeFile(join(root, 'a.md'), '# hi')
    const service = new FsService(gate)

    const image = await service.readRaw(root, 'assets/pic.png')
    expect(image).toMatchObject({ mime: 'image/png', size: png.length })
    if ('abs' in image) expect(image.abs.endsWith(join('assets', 'pic.png'))).toBe(true)
    expect(await service.readRaw(root, 'a.md')).toMatchObject({ mime: 'application/octet-stream' })

    await rm(dir, { recursive: true, force: true })
  })

  it('serves pdf bytes as application/pdf (extension and magic bytes)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-raw-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, 'docs'), { recursive: true })
    const pdf = Buffer.from('%PDF-1.7 fake body', 'latin1')
    await writeFile(join(root, 'docs', 'doc.pdf'), pdf)
    // No extension: the %PDF magic must still win over octet-stream.
    await writeFile(join(root, 'docs', 'noext'), pdf)
    const service = new FsService(gate)

    const byExt = await service.readRaw(root, 'docs/doc.pdf')
    expect(byExt).toMatchObject({ mime: 'application/pdf', size: pdf.length })
    if ('abs' in byExt) expect(byExt.abs.endsWith(join('docs', 'doc.pdf'))).toBe(true)
    expect(await service.readRaw(root, 'docs/noext')).toMatchObject({ mime: 'application/pdf' })

    await rm(dir, { recursive: true, force: true })
  })

  it('refuses .git paths, missing files, and directories', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-raw-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, '.git', 'config'), 'cfg')
    const service = new FsService(gate)

    expect(await service.readRaw(root, '.git/config')).toMatchObject({ code: 'path-outside-root' })
    expect(await service.readRaw(root, 'nope.png')).toMatchObject({ code: 'not-found' })
    expect(await service.readRaw(root, 'sub')).toMatchObject({ code: 'is-directory' })

    await rm(dir, { recursive: true, force: true })
  })
})

describe('GitService.discard path derivation (H1)', () => {
  it('derives the root-relative path with relative() (no slice garbage)', async () => {
    // Session root is a subdir of the repo.
    const runner: GitRunner = {
      async run(argv) {
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: '/repo\n', stderr: '' }
        }
        if (argv[0] === 'ls-files') return { exitCode: 1, stdout: '', stderr: 'no match' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const ROOT = '/repo/sub'
    const repoGate: WorkspaceGate = async () => ({ ok: true, canonical: '/repo/sub' })
    const deleted: Array<[string, string]> = []
    const service = new GitService(runner, repoGate, async (root, rel) => {
      deleted.push([root, rel])
      return { ok: true as const }
    })

    const result = await service.discard(ROOT, ['sub/untracked.txt'])
    expect(result.applied).toEqual(['sub/untracked.txt'])
    // relative('/repo/sub', '/repo/sub/untracked.txt') === 'untracked.txt'
    expect(deleted).toEqual([[ROOT, 'untracked.txt']])
  })

  it('refuses untracked files that resolve outside the session root', async () => {
    const runner: GitRunner = {
      async run(argv) {
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: '/repo\n', stderr: '' }
        }
        if (argv[0] === 'ls-files') return { exitCode: 1, stdout: '', stderr: 'no match' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const ROOT = '/repo/sub'
    const repoGate: WorkspaceGate = async () => ({ ok: true, canonical: '/repo/sub' })
    const fsDelete = async () => ({ ok: true as const })
    const service = new GitService(runner, repoGate, fsDelete)

    // '/repo/other.txt' is repo-relative but outside the '/repo/sub' session root.
    const result = await service.discard(ROOT, ['../other.txt'])
    expect(result.failed).toEqual(['../other.txt'])
    expect(result.applied).toEqual([])
  })

  it('refuses to delete a symlink that points outside the repo (C1)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-discard-')))
    const outsideDir = join(dir, 'outside')
    const repoDir = join(dir, 'repo')
    await mkdir(outsideDir)
    await mkdir(repoDir)
    await writeFile(join(outsideDir, 'victim.txt'), 'keep')
    await symlink(outsideDir, join(repoDir, 'link'))
    const runner: GitRunner = {
      async run(argv) {
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: `${repoDir}\n`, stderr: '' }
        }
        if (argv[0] === 'ls-files') return { exitCode: 1, stdout: '', stderr: 'no match' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const repoGate: WorkspaceGate = async () => ({ ok: true, canonical: repoDir })
    let deleted = false
    const service = new GitService(runner, repoGate, async () => {
      deleted = true
      return { ok: true as const }
    })

    const result = await service.discard(repoDir, ['link'])
    expect(result.failed).toEqual(['link'])
    expect(deleted).toBe(false)
    expect(await realpath(join(outsideDir, 'victim.txt'))).toBe(join(outsideDir, 'victim.txt'))

    await rm(dir, { recursive: true, force: true })
  })
})
