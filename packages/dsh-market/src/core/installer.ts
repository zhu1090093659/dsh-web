/**
 * Market asset installer core: builds the download plan from the public
 * dsh-market.com manifest and writes it into the DSH home asset
 * directories ($DSH_HOME/skins/<id>, $DSH_HOME/pets/<id>).
 *
 * Security model (host half):
 *  - the manifest is fetched from MARKET_ORIGIN only;
 *  - every relative path comes from that manifest and is validated against
 *    a conservative allowlist (no '..', no absolute paths, no empty parts);
 *  - the download URL is rebuilt from the validated rel, never taken from
 *    the client (the client only sends the asset id);
 *  - the manifest and every downloaded file are size-capped (1 MiB manifest,
 *    200 files per asset, 200 MiB per file) and every fetch has a 30 s
 *    timeout, so a hostile manifest cannot exhaust host memory or disk;
 *  - writes are staged in a temp dir next to the destination and renamed
 *    into place only after every file downloaded successfully, so a failed
 *    install never leaves a half-written asset directory;
 *  - an existing directory is replaced only with force (the UI confirms);
 *  - every install records dsh-market.provenance.json (sha256 of each
 *    installed file, pinned to MARKET_ORIGIN), so consumers like the skin
 *    center can tell official-market content — same-review code built from
 *    the dsh-web repository — apart from hand-dropped directories
 *    (issue #1073).
 * @module @linxin666/dsh-client-ui-market/core
 */

import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

export const MARKET_ORIGIN = 'https://dsh-market.com'

/** Provenance manifest written into every installed asset directory. */
export const PROVENANCE_FILENAME = 'dsh-market.provenance.json'

/**
 * Install provenance: proof that the on-disk bytes are exactly what the
 * official market served. files maps each manifest-relative path to its
 * lowercase hex sha256.
 */
export interface InstallProvenance {
  version: 1
  source: typeof MARKET_ORIGIN
  kind: MarketKind
  id: string
  installedAt: string
  files: Record<string, string>
}

/** Manifest response size cap (bytes). */
export const MANIFEST_MAX_BYTES = 1024 * 1024

/** Max files one asset may declare. */
export const MAX_FILES_PER_ASSET = 200

/** Per-file download size cap (bytes). */
export const FILE_MAX_BYTES = 200 * 1024 * 1024

/** Per-request timeout (ms). */
export const FETCH_TIMEOUT_MS = 30_000

export type MarketKind = 'skin' | 'pet'

export interface MarketManifestItem {
  id: string
  files?: string[]
  [key: string]: unknown
}

export interface MarketManifest {
  items: MarketManifestItem[]
  [key: string]: unknown
}

export interface DownloadPlanEntry {
  /** Path relative to the asset directory (e.g. assets/whale-art.webp). */
  rel: string
  /** Absolute download URL on the market origin. */
  url: string
}

const SAFE_REL_RE = /^[A-Za-z0-9._][A-Za-z0-9._\-/]{0,199}$/

/** Whether one manifest-relative path passes the conservative allowlist. */
export function isSafeRel(rel: string): boolean {
  if (typeof rel !== 'string' || !SAFE_REL_RE.test(rel)) return false
  if (rel.includes('..') || rel.includes('//') || rel.startsWith('/') || rel.endsWith('/')) return false
  return true
}

/** The market asset base URL for one kind/id (skins/<id>/ or pets/<id>/). */
export function assetBase(kind: MarketKind, id: string): string {
  return `${MARKET_ORIGIN}/assets/${kind === 'skin' ? 'skins' : 'pets'}/${encodeURIComponent(id)}/`
}

/** Build the validated download plan from a manifest file list. */
export function planDownload(kind: MarketKind, id: string, files: readonly string[]): DownloadPlanEntry[] {
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`invalid asset id: ${id}`)
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`asset ${id} declares no files`)
  }
  if (files.length > MAX_FILES_PER_ASSET) {
    throw new Error(`asset ${id} declares too many files (${files.length}, max ${MAX_FILES_PER_ASSET})`)
  }
  const base = assetBase(kind, id)
  const plan: DownloadPlanEntry[] = []
  const seen = new Set<string>()
  for (const rel of files) {
    if (!isSafeRel(rel)) throw new Error(`unsafe manifest path: ${rel}`)
    if (seen.has(rel)) throw new Error(`duplicate manifest path: ${rel}`)
    seen.add(rel)
    plan.push({ rel, url: base + rel.split('/').map(encodeURIComponent).join('/') })
  }
  return plan
}

/** The destination directory for one asset (dsh home + skins|pets + id). */
export function targetDir(dshHome: string, kind: MarketKind, id: string): string {
  return join(dshHome, kind === 'skin' ? 'skins' : 'pets', id)
}

export interface InstallOptions {
  /** Root of the DSH user home ($DSH_HOME or ~/.dsh). */
  dshHome: string
  /** True to replace an existing directory (UI confirms first). */
  force?: boolean
  /** fetch impl (test seam). */
  fetchImpl?: typeof fetch
  /** Manifest size cap in bytes (default MANIFEST_MAX_BYTES). */
  manifestMaxBytes?: number
  /** Per-file size cap in bytes (default FILE_MAX_BYTES). */
  fileMaxBytes?: number
  /** Per-request timeout in ms (default FETCH_TIMEOUT_MS). */
  fetchTimeoutMs?: number
}

export interface InstallResult {
  ok: true
  kind: MarketKind
  id: string
  files: number
  dest: string
}

export class MarketInstallError extends Error {
  readonly code: 'manifest' | 'download' | 'conflict' | 'write'
  constructor(code: 'manifest' | 'download' | 'conflict' | 'write', message: string) {
    super(message)
    this.code = code
  }
}

function isAbortError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined
  return name === 'AbortError' || name === 'TimeoutError'
}

/** fetch with a hard timeout; a timeout becomes a typed MarketInstallError. */
async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  code: 'manifest' | 'download',
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (isAbortError(err)) {
      throw new MarketInstallError(code, `fetch timed out after ${timeoutMs}ms: ${url}`)
    }
    throw err
  }
}

/**
 * Read a response body capped at maxBytes: a Content-Length pre-check when
 * present, then a streaming count that cancels the body (and throws) once the
 * cap is crossed, so an unannounced oversized body never fully buffers.
 */
async function readBodyLimited(
  res: Response,
  maxBytes: number,
  code: 'manifest' | 'download',
  what: string,
  timeoutMs: number,
): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (content-length: ${declared})`)
  }
  const body = res.body
  if (body === null) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) {
      throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (received: ${buf.byteLength})`)
    }
    return buf
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (received: ${total})`)
      }
      chunks.push(value)
    }
  } catch (err) {
    if (isAbortError(err)) {
      throw new MarketInstallError(code, `read timed out after ${timeoutMs}ms: ${what}`)
    }
    throw err
  } finally {
    try { await reader.cancel() } catch { /* best effort */ }
  }
  return Buffer.concat(chunks, total)
}

async function fetchManifest(
  kind: MarketKind,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<MarketManifest> {
  const url = `${MARKET_ORIGIN}/manifest/${kind === 'skin' ? 'skins' : 'pets'}.json`
  const res = await fetchWithTimeout(url, fetchImpl, 'manifest', timeoutMs)
  if (!res.ok) throw new MarketInstallError('manifest', `manifest fetch failed: ${res.status}`)
  const text = await readBodyLimited(res, maxBytes, 'manifest', `manifest ${url}`, timeoutMs)
  const data = JSON.parse(text.toString('utf8')) as MarketManifest
  if (!data || !Array.isArray(data.items)) throw new MarketInstallError('manifest', 'manifest shape invalid')
  return data
}

/**
 * Install one market asset into its DSH home directory (atomic, replace
 * with force). Throws MarketInstallError on any failure; an existing
 * directory is left untouched unless force is true and all files arrived.
 */
export async function installAsset(
  kind: MarketKind,
  id: string,
  options: InstallOptions,
): Promise<InstallResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const manifestMaxBytes = options.manifestMaxBytes ?? MANIFEST_MAX_BYTES
  const fileMaxBytes = options.fileMaxBytes ?? FILE_MAX_BYTES
  const fetchTimeoutMs = options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  const manifest = await fetchManifest(kind, fetchImpl, manifestMaxBytes, fetchTimeoutMs)
  const item = manifest.items.find((entry) => entry.id === id)
  if (!item) throw new MarketInstallError('manifest', `asset not in manifest: ${id}`)
  const plan = planDownload(kind, id, item.files ?? [])

  const dest = targetDir(options.dshHome, kind, id)
  let exists = false
  try {
    statSync(dest)
    exists = true
  } catch {
    exists = false
  }
  if (exists && options.force !== true) {
    throw new MarketInstallError('conflict', `destination already exists: ${dest}`)
  }

  const tmp = dest + '.install-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  try {
    mkdirSync(tmp, { recursive: true })
    const hashes: Record<string, string> = {}
    for (const entry of plan) {
      const res = await fetchWithTimeout(entry.url, fetchImpl, 'download', fetchTimeoutMs)
      if (!res.ok) throw new MarketInstallError('download', `${entry.url} failed: ${res.status}`)
      const buf = await readBodyLimited(res, fileMaxBytes, 'download', entry.url, fetchTimeoutMs)
      const target = join(tmp, ...entry.rel.split('/'))
      const guard = entry.rel.split('/').slice(0, -1).join(sep)
      if (guard) mkdirSync(join(tmp, guard), { recursive: true })
      writeFileSync(target, buf)
      hashes[entry.rel] = createHash('sha256').update(buf).digest('hex')
    }
    const provenance: InstallProvenance = {
      version: 1,
      source: MARKET_ORIGIN,
      kind,
      id,
      installedAt: new Date().toISOString(),
      files: hashes,
    }
    writeFileSync(join(tmp, PROVENANCE_FILENAME), JSON.stringify(provenance, null, 2) + '\n')
    if (exists) {
      rmSync(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
    try {
      renameSync(tmp, dest)
    } catch {
      // Brief fallback retry for Windows filesystem handle release
      const start = Date.now()
      while (Date.now() - start < 50) { /* spin */ }
      renameSync(tmp, dest)
    }
  } catch (err) {
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* best effort */ }
    if (err instanceof MarketInstallError) throw err
    throw new MarketInstallError('write', err instanceof Error ? err.message : String(err))
  }

  return { ok: true, kind, id, files: plan.length, dest }
}