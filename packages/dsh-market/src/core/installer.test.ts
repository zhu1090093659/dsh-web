/**
 * Market installer core tests: path allowlist, download plan building, and
 * the atomic install flow (success, conflict, download failure cleanup).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import {
  DEFAULT_INSTALL_RETRIES,
  FETCH_TIMEOUT_MS,
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

    const petPlan = planDownload('pet', 'whale-girl', ['pet.json', 'spritesheet.webp'])
    expect(petPlan).toEqual([
      { rel: 'pet.json', url: MARKET_ORIGIN + '/assets/pets/whale-girl/pet.json' },
      { rel: 'spritesheet.webp', url: MARKET_ORIGIN + '/assets/pets/whale-girl/spritesheet.webp' },
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
    presets: {
      items: [
        {
          id: 'demo-preset',
          version: '1.2.0',
          files: ['agent.cordis.yml', 'preset.yml', 'hook.mjs'],
        },
      ],
    },
  }

  function mockFetch(overrides: Record<string, number> = {}): typeof fetch {
    return (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      const m = url.match(/\/manifest\/(skins|pets|presets)\.json$/)
      if (m) {
        return new Response(JSON.stringify(manifest[m[1] as 'skins' | 'pets' | 'presets']), { status: 200 })
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
    // The rename target is the plain id: staging left nothing visible behind
    expect(readdirSync(join(home, 'skins'))).toEqual(['whale-song'])
  })

  it('user installs a skin while the host fetch cannot decode compressed bodies', async () => {
    const home = tmpHome()
    // Given the alpha.2 host has imported npm undici, so its built-in fetch
    // hands back compressed bytes with no content-encoding header; this mock
    // mirrors that by answering raw brotli to any request that did not ask for
    // identity.
    // When the installer requests the manifest and every asset.
    // Then the install succeeds, because each request carried
    // accept-encoding: identity and the written bytes are the origin's.
    const compressed = (text: string) => brotliCompressSync(Buffer.from(text))
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (new Headers(init?.headers).get('accept-encoding') !== 'identity') {
        return new Response(compressed(url.endsWith('skins.json') ? JSON.stringify(manifest.skins) : 'data-compressed'), { status: 200 })
      }
      const m = url.match(/\/manifest\/(skins|pets|presets)\.json$/)
      if (m) return new Response(JSON.stringify(manifest[m[1] as 'skins' | 'pets' | 'presets']), { status: 200 })
      return new Response('data-' + (url.split('/').pop() ?? ''), { status: 200 })
    }) as typeof fetch

    const result = await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl })

    expect(result.ok).toBe(true)
    expect(readFileSync(join(home, 'skins', 'whale-song', 'skin.css'), 'utf8')).toBe('data-skin.css')
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

  it('installs a preset into the inert library and records the manifest version', async () => {
    const home = tmpHome()
    const result = await installAsset('preset', 'demo-preset', { dshHome: home, fetchImpl: mockFetch() })
    expect(result.dest).toBe(targetDir(home, 'preset', 'demo-preset'))
    expect(readFileSync(join(home, 'agent-presets', 'demo-preset', 'agent.cordis.yml'), 'utf8')).toBe('data-agent.cordis.yml')
    // The discovery root the roster scans must stay untouched: a downloaded
    // preset is inert until the user enables it.
    expect(existsSync(join(home, '.agent-presets'))).toBe(false)
    const provenance = JSON.parse(readFileSync(join(home, 'agent-presets', 'demo-preset', PROVENANCE_FILENAME), 'utf8'))
    expect(provenance).toMatchObject({ kind: 'preset', id: 'demo-preset', assetVersion: '1.2.0' })
  })

  it('rejects a preset id outside the official directory rule', async () => {
    const home = tmpHome()
    expect(() => planDownload('preset', 'Demo_Preset', ['agent.cordis.yml'])).toThrow(/invalid asset id/)
    await expect(installAsset('preset', 'Demo_Preset', { dshHome: home, fetchImpl: mockFetch() }))
      .rejects.toMatchObject({ code: 'manifest' })
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

  // Staging is a sibling of the destination, so a scanner that lists the kind
  // directory meets it unless its name starts with a dot. A failed install
  // must therefore leave no visible entry, and a staging directory the
  // best-effort cleanup could not remove must still be dot-prefixed
  // (issue #1952). The previous version of this test called
  // require('node:fs') — which throws in an ES module — inside a try/catch
  // that swallowed the error, so its assertion held without reading a
  // directory at all.
  it.each([
    { kind: 'skin' as const, id: 'whale-song', file: 'whale-art.webp' },
    { kind: 'pet' as const, id: 'whale-girl', file: 'spritesheet.webp' },
    { kind: 'preset' as const, id: 'demo-preset', file: 'hook.mjs' },
  ])('operator gets no visible $kind entry after a failed download', async ({ kind, id, file }) => {
    // Given an asset whose last file answers 404
    const home = tmpHome()
    const dest = targetDir(home, kind, id)
    const parent = dirname(dest)
    const inFlight: string[] = []
    const base = mockFetch({ [file]: 404 })
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/' + file)) {
        // The staging directory is created before the first download, so this
        // is exactly what a scanner lists while the install is still running.
        inFlight.push(...readdirSync(parent))
      }
      return base(input, init)
    }) as typeof fetch

    // When the install fails
    await expect(installAsset(kind, id, { dshHome: home, fetchImpl }))
      .rejects.toMatchObject({ code: 'download' })

    // Then the entry a scanner could have met was a hidden sibling of the
    // destination, which keeps the rename an atomic same-volume move
    expect(inFlight).toHaveLength(1)
    const staged = inFlight[0] ?? ''
    expect(staged).toMatch(new RegExp('^\\.' + id + '\\.install-[0-9a-z]+-[0-9a-z]+$'))
    expect(join(parent, staged)).not.toBe(dest)
    expect(dirname(join(parent, staged))).toBe(parent)

    // And no visible entry survives the failure, so a scanner lists nothing
    const survivors = readdirSync(parent)
    expect(survivors.filter((name) => !name.startsWith('.'))).toEqual([])
    // ...and a staging directory the cleanup could not remove is still hidden
    expect(survivors.filter((name) => name.startsWith('.'))).toEqual(survivors)
    expect(survivors).not.toContain(id)
    expect(existsSync(dest)).toBe(false)
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

  it('pins an installer cap that clears the largest published pet asset', () => {
    // jyn ships 1565 per-frame images; a cap at or below that makes an
    // official market asset uninstallable for every user (issue #1578).
    // scripts/market-build-cap.test.mjs holds the pipeline side of the gate.
    expect(MAX_FILES_PER_ASSET).toBe(2000)
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

  it('operator gets a per-attempt timeout long enough for the published manifest', () => {
    // Given the installer's default budget
    // When a caller configures nothing
    // Then one attempt gets at least two minutes, because the manifest alone
    // measured 68.5 s on a direct connection (issue #1941)
    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000)
    expect(DEFAULT_INSTALL_RETRIES).toBeGreaterThanOrEqual(2)
  })

  // A self-contained manifest for the limits block: the shared fixture lives
  // in the sibling describe.
  const skinsManifest = {
    items: [{ id: 'whale-song', files: ['skin.json', 'skin.css', 'assets/whale-art.webp'] }],
  }
  const manifestUrl = MARKET_ORIGIN + '/manifest/skins.json'

  it('operator gets the asset installed after one transient 503 on the manifest', async () => {
    const home = tmpHome()
    let manifestCalls = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === manifestUrl) {
        manifestCalls += 1
        // Given the origin answers the first manifest request with 503
        if (manifestCalls === 1) return new Response('busy', { status: 503 })
        return new Response(JSON.stringify(skinsManifest), { status: 200 })
      }
      return new Response('data-' + (url.split('/').pop() ?? ''), { status: 200 })
    }) as typeof fetch

    // When the install runs
    const result = await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, retryDelayMs: 0 })

    // Then the second attempt succeeds and the asset is written once
    expect(result.ok).toBe(true)
    expect(manifestCalls).toBe(2)
    expect(existsSync(targetDir(home, 'skin', 'whale-song'))).toBe(true)
  })

  it('operator gets the asset installed after one transient 500 on a file', async () => {
    // Given a manifest that answers and one file that fails once with 500
    const home = tmpHome()
    let fileCalls = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === manifestUrl) return new Response(JSON.stringify(skinsManifest), { status: 200 })
      if (url.endsWith('/skin.css')) {
        fileCalls += 1
        if (fileCalls === 1) return new Response('busy', { status: 500 })
      }
      return new Response('data-' + (url.split('/').pop() ?? ''), { status: 200 })
    }) as typeof fetch

    // When the install runs
    const result = await installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, retryDelayMs: 0 })

    // Then the retried file arrives and the asset is written once
    expect(result.ok).toBe(true)
    expect(fileCalls).toBe(2)
  })

  it('operator gets a download error without a retry when a file is missing', async () => {
    const home = tmpHome()
    let fileCalls = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === manifestUrl) return new Response(JSON.stringify(skinsManifest), { status: 200 })
      if (url.endsWith('/skin.css')) {
        fileCalls += 1
        return new Response('nope', { status: 404 })
      }
      return new Response('data-' + (url.split('/').pop() ?? ''), { status: 200 })
    }) as typeof fetch

    // Given an asset request that answers 404
    // When the install runs
    // Then it fails as a download error without burning the retry budget
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, retryDelayMs: 0 }))
      .rejects.toMatchObject({ code: 'download', message: expect.stringMatching(/404/) })
    expect(fileCalls).toBe(1)
    expect(existsSync(targetDir(home, 'skin', 'whale-song'))).toBe(false)
  })

  it('operator gets an actionable blocked error when a Cloudflare challenge intercepts the install', async () => {
    const home = tmpHome()
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response('<!DOCTYPE html><title>Just a moment...</title>', {
        status: 403,
        headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
      })
    }) as typeof fetch

    // Given a proxy intercepting the manifest with a managed challenge
    // When the install runs
    // Then it fails as blocked, says what to do, and does not retry the challenge
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, retryDelayMs: 0 }))
      .rejects.toMatchObject({
        code: 'blocked',
        message: expect.stringMatching(/Cloudflare challenge.*switch network or disable the proxy/i),
      })
    expect(calls).toBe(1)
    expect(existsSync(targetDir(home, 'skin', 'whale-song'))).toBe(false)
  })

  it('operator whose manifest fetch times out spends every configured attempt', async () => {
    // Given a request that never answers
    const home = tmpHome()
    let calls = 0
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined) return
        if (signal.aborted) { reject(signal.reason); return }
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }) as typeof fetch

    // When the install runs with a budget of two retries
    await expect(installAsset('skin', 'whale-song', { dshHome: home, fetchImpl, fetchTimeoutMs: 20, retryDelayMs: 0 }))
      .rejects.toMatchObject({ code: 'manifest', message: expect.stringMatching(/timed out/) })

    // Then all three attempts were spent before the install gave up
    expect(calls).toBe(3)
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
