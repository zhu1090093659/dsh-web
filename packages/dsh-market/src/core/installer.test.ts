/**
 * Market installer core tests: path allowlist, download plan building, and
 * the atomic install flow (success, conflict, download failure cleanup).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FILE_MAX_BYTES,
  MANIFEST_MAX_BYTES,
  MARKET_ORIGIN,
  PROVENANCE_FILENAME,
  MAX_FILES_PER_ASSET,
  MarketInstallError,
  installAsset,
  isSafeRel,
  planDownload,
  targetDir,
} from './installer.ts'

let dirs: string[] = []

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('isSafeRel', () => {
  it('accepts normal asset-relative paths', () => {
    expect(isSafeRel('skin.css')).toBe(true)
    expect(isSafeRel('assets/whale-art.webp')).toBe(true)
    expect(isSafeRel('preview/light.jpg')).toBe(true)
    expect(isSafeRel('a.b.c/x_y-z/001.gif')).toBe(true)
  })

  it('rejects traversal, absolute and empty-relative paths', () => {
    expect(isSafeRel('../evil')).toBe(false)
    expect(isSafeRel('a/../../b')).toBe(false)
    expect(isSafeRel('/absolute')).toBe(false)
    expect(isSafeRel('a//b')).toBe(false)
    expect(isSafeRel('a/')).toBe(false)
    expect(isSafeRel('')).toBe(false)
    expect(isSafeRel('a b.png')).toBe(false)
  })
})

describe('planDownload', () => {
  it('builds validated absolute URLs from manifest rels', () => {
    const plan = planDownload('skin', 'whale-song', ['skin.json', 'assets/whale-art.webp'])
    expect(plan).toEqual([
      { rel: 'skin.json', url: MARKET_ORIGIN + '/assets/skins/whale-song/skin.json' },
      { rel: 'assets/whale-art.webp', url: MARKET_ORIGIN + '/assets/skins/whale-song/assets/whale-art.webp' },
    ])
  })

  it('rejects unsafe rels and duplicates', () => {
    expect(() => planDownload('skin', 'whale-song', ['../x'])).toThrow(/unsafe manifest path/)
    expect(() => planDownload('skin', 'whale-song', ['a', 'a'])).toThrow(/duplicate manifest path/)
    expect(() => planDownload('pet', 'bad/id', ['pet.json'])).toThrow(/invalid asset id/)
    expect(() => planDownload('skin', 'whale-song', [])).toThrow(/declares no files/)
  })
})

describe('installAsset', () => {
  const manifest = {
    skins: {
      items: [
        {
          id: 'whale-song',
          files: ['skin.json', 'skin.css', 'assets/whale-art.webp'],
        },
      ],
    },
    pets: {
      items: [
        {
          id: 'whale-girl',
          files: ['pet.json', 'spritesheet.webp'],
        },
      ],
    },
  }

  function mockFetch(overrides: Record<string, number> = {}): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const m = url.match(/\/manifest\/(skins|pets)\.json$/)
      if (m) {
        return new Response(JSON.stringify(manifest[m[1] as 'skins' | 'pets']), { status: 200 })
      }
      const file = url.split('/').pop() ?? ''
      if (overrides[file] !== undefined) {
        return new Response('nope', { status: overrides[file] })
      }
      return new Response('data-' + file, { status: 200 })
    }) as typeof fetch
  }

  it('installs a skin into $DSH_HOME/skins/<id> atomically', async () => {
    const home = tmpHome()
    const result = await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl: mockFetch() })
    expect(result.ok).toBe(true)
    expect(result.files).toBe(3)
    expect(result.dest).toBe(targetDir(home, 'skin', 'whale-song'))
    expect(readFileSync(join(home, 'skins', 'whale-song', 'skin.json'), 'utf8')).toBe('data-skin.json')
    expect(readFileSync(join(home, 'skins', 'whale-song', 'assets', 'whale-art.webp'), 'utf8')).toBe('data-whale-art.webp')
  })

  it('records sha256 install provenance for every installed file (issue #1073)', async () => {
    const home = tmpHome()
    await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl: mockFetch() })
    const provenance = JSON.parse(readFileSync(join(home, 'skins', 'whale-song', PROVENANCE_FILENAME), 'utf8'))
    expect(provenance.version).toBe(1)
    expect(provenance.source).toBe(MARKET_ORIGIN)
    expect(provenance.kind).toBe('skin')
    expect(provenance.id).toBe('whale-song')
    expect(typeof provenance.installedAt).toBe('string')
    const sha = (body: string) => createHash('sha256').update(body).digest('hex')
    expect(provenance.files).toEqual({
      'skin.json': sha('data-skin.json'),
      'skin.css': sha('data-skin.css'),
      'assets/whale-art.webp': sha('data-whale-art.webp'),
    })
  })

  it('refreshes provenance on a force reinstall', async () => {
    const home = tmpHome()
    await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl: mockFetch() })
    const first = JSON.parse(readFileSync(join(home, 'skins', 'whale-song', PROVENANCE_FILENAME), 'utf8'))
    await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl: mockFetch(), force: true })
    const second = JSON.parse(readFileSync(join(home, 'skins', 'whale-song', PROVENANCE_FILENAME), 'utf8'))
    expect(second.files['skin.json']).toBe(first.files['skin.json'])
    expect(second.id).toBe('whale-song')
  })

  it('refuses to overwrite without force and replaces with force', async () => {
    const home = tmpHome()
    const dest = targetDir(home, 'pet', 'whale-girl')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'old.txt'), 'old')
    await expect(installAsset('pet', 'whale-girl', { dshHome: home, fetchImpl: mockFetch() }))
      .rejects.toMatchObject({ code: 'conflict' })
    await installAsset('pet', 'whale-girl', { dshHome: home, fetchImpl: mockFetch(), force: true })
    expect(existsSync(join(dest, 'old.txt'))).toBe(false)
    expect(readFileSync(join(dest, 'pet.json'), 'utf8')).toBe('data-pet.json')
  })

  it('cleans the temp dir and keeps nothing partial on download failure', async () => {
    const home = tmpHome()
    await expect(
      installAsset('skin', 'whale-song', { dshHome: home, fetchImpl: mockFetch({ 'whale-art.webp': 404 }) }),
    ).rejects.toMatchObject({ code: 'download' })
    const dest = targetDir(home, 'skin', 'whale-song')
    expect(existsSync(dest)).toBe(false)
    const leftovers = dirs.map((d) => {
      try {
        return require('node:fs').readdirSync(join(home, 'skins')).filter((n: string) => n.startsWith('whale-song'))
      } catch { return [] }
    }).flat()
    expect(leftovers).toEqual([])
  })

  it('rejects unknown ids with manifest error', async () => {
    const home = tmpHome()
    await expect(installAsset('skin', 'nope', { dshHome: home, fetchImpl: mockFetch() }))
      .rejects.toMatchObject({ code: 'manifest' })
  })

  it('exposes MarketInstallError with typed code', () => {
    const err = new MarketInstallError('conflict', 'x')
    expect(err.code).toBe('conflict')
  })
})
describe('installAsset limits', () => {
  const manifest = { items: [{ id: 'whale-song', files: ['skin.json', 'skin.css', 'assets/whale-art.webp'] }] }

  it('rejects a manifest larger than the cap via content-length pre-check', async () => {
    const home = tmpHome()
    const fetchImpl = (async () => new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-length': String(MANIFEST_MAX_BYTES + 1) },
    })) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl }))
      .rejects.toMatchObject({ code: 'manifest', message: expect.stringMatching(/exceeds/) })
    expect(existsSync(targetDir(home, 'skin', 'whale-song'))).toBe(false)
  })

  it('rejects a streaming manifest larger than the cap without content-length', async () => {
    const home = tmpHome()
    const big = JSON.stringify({ items: [], pad: 'x'.repeat(4096) })
    const fetchImpl = (async () => new Response(big, { status: 200 })) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, manifestMaxBytes: 1024 }))
      .rejects.toMatchObject({ code: 'manifest', message: expect.stringMatching(/exceeds/) })
  })

  it('rejects an asset declaring more files than the cap', async () => {
    const home = tmpHome()
    const files = Array.from({ length: MAX_FILES_PER_ASSET + 1 }, (_, i) => `f${i}.png`)
    const fetchImpl = (async () => new Response(
      JSON.stringify({ items: [{ id: 'whale-song', files }] }),
      { status: 200 },
    )) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl }))
      .rejects.toThrow(/too many files/)
  })

  it('rejects a file larger than the cap via content-length pre-check', async () => {
    const home = tmpHome()
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/manifest/skins.json')) return new Response(JSON.stringify(manifest), { status: 200 })
      return new Response('x', { status: 200, headers: { 'content-length': String(FILE_MAX_BYTES + 1) } })
    }) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl }))
      .rejects.toMatchObject({ code: 'download', message: expect.stringMatching(/exceeds/) })
  })

  it('aborts a streaming file that crosses the cap without content-length', async () => {
    const home = tmpHome()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024))
        controller.enqueue(new Uint8Array(1024))
        controller.close()
      },
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/manifest/skins.json')) return new Response(JSON.stringify(manifest), { status: 200 })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, fileMaxBytes: 1024 }))
      .rejects.toMatchObject({ code: 'download', message: expect.stringMatching(/exceeds/) })
    expect(existsSync(targetDir(home, 'skin', 'whale-song'))).toBe(false)
  })

  it('times out a manifest fetch after the configured timeout', async () => {
    const home = tmpHome()
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined) return
        if (signal.aborted) { reject(signal.reason); return }
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, fetchTimeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'manifest', message: expect.stringMatching(/timed out/) })
  })

  it('times out a file download after the configured timeout', async () => {
    const home = tmpHome()
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/manifest/skins.json')) {
        return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }))
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined) return
        if (signal.aborted) { reject(signal.reason); return }
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }) as typeof fetch
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, fetchTimeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'download', message: expect.stringMatching(/timed out/) })
  })
})
