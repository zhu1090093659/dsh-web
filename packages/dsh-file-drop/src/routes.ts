/**
 * The /api/dsh-file-drop/upload route: accepts one raw file body, writes it
 * into the drop inbox directory (~/.dsh/dsh-file-drop), and returns the
 * absolute path the agent can then read from disk.
 *
 * The route carries a loopback-only trust fence (plus browser same-origin
 * markers), mirroring the other plugin routes: an upload writes arbitrary
 * bytes to the user's home directory, so a LAN-exposed dsh web must not serve
 * it to strangers.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Route path (shared spelling with the browser half). */
export const FILE_DROP_API = {
  upload: '/api/dsh-file-drop/upload',
} as const

/** Hard cap on an uploaded body (512 MiB). */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** Default inbox directory (~/.dsh/dsh-file-drop). */
export function defaultUploadDir(): string {
  const home = process.env.HOME ?? homedir()
  return join(home, '.dsh', 'dsh-file-drop')
}

/**
 * Collapse a caller-supplied filename into a safe basename: path separators
 * and traversal are stripped, control characters removed, and a blank result
 * falls back to a timestamped name. Pure for unit testing.
 */
export function safeFileName(raw: string, fallback: string): string {
  const cleaned = basename(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\./g, '')
    .trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return fallback
  return cleaned
}

/** Loopback literal check plus browser same-origin markers (mirrors sibling routes). */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read the whole request body up to the cap; undefined when oversized. */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_UPLOAD_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** A destination path that does not overwrite an existing file. */
function uniquePath(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return join(dir, name)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, stem + '-' + i + ext)
    if (!existsSync(candidate)) return candidate
  }
  return join(dir, stem + '-' + Date.now() + ext)
}

/**
 * Decode a URI-encoded header value (the browser sends encodeURIComponent
 * names); a malformed value falls back to the raw string.
 */
export function decodeHeader(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Common directories scanned to resolve a dropped file's original location. */
export function originalSearchDirs(home: string): string[] {
  return [
    join(home, 'Downloads'),
    join(home, 'Desktop'),
    join(home, 'Documents'),
  ]
}

/**
 * Try to locate the original file by exact basename in the common directories.
 * Returns the single unique match, or undefined when absent or ambiguous —
 * an ambiguous name must never point the agent at the wrong file.
 */
export function resolveOriginalPath(name: string, home: string): string | undefined {
  const wanted = name.toLowerCase()
  const matches: string[] = []
  for (const dir of originalSearchDirs(home)) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.toLowerCase() === wanted) matches.push(join(dir, entry))
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Filter mdfind stdout (one path per line) down to exact-basename matches.
 * Pure for unit testing.
 */
export function parseMdfindOutput(stdout: string, name: string): string[] {
  const wanted = name.toLowerCase()
  const matches: string[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (basename(trimmed).toLowerCase() !== wanted) continue
    matches.push(trimmed)
  }
  return matches
}

/**
 * Spotlight lookup: run mdfind -name over the whole user index and keep only
 * exact-basename matches. Returns the single unique hit, or undefined. This is
 * the layer that finds files in deep directories outside the common folders.
 */
export function resolveOriginalViaMdfind(name: string): string | undefined {
  let result
  try {
    result = spawnSync('/usr/bin/mdfind', ['-name', name], {
      timeout: 8000,
      encoding: 'utf8',
    })
  } catch {
    return undefined
  }
  if (result.status !== 0 || result.stdout === undefined) return undefined
  const matches = parseMdfindOutput(result.stdout, name)
  return matches.length === 1 ? matches[0] : undefined
}

/** Route dependencies. */
export interface FileDropRoutesDeps {
  /** Resolved inbox directory (defaults to ~/.dsh/dsh-file-drop). */
  uploadDir?: string
}

/** Build the /api/dsh-file-drop upload route. */
export function makeRoutes(deps: FileDropRoutesDeps = {}): WebRoute[] {
  const dir = deps.uploadDir ?? defaultUploadDir()
  return [
    {
      kind: 'exact',
      path: FILE_DROP_API.upload,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const header = req.headers['x-file-name']
        const rawName = typeof header === 'string' ? header : 'file-' + Date.now()
        const name = safeFileName(decodeHeader(rawName), 'file-' + Date.now())
        const claimed = req.headers['x-original-path']
        const claimedPath = typeof claimed === 'string' ? decodeHeader(claimed) : ''
        const body = await readBody(req)
        if (body === undefined) {
          writeJson(res, 413, { error: 'payload too large' })
          return
        }
        if (body.length === 0) {
          writeJson(res, 400, { error: 'empty body' })
          return
        }
        try {
          mkdirSync(dir, { recursive: true })
          const staged = uniquePath(dir, name)
          writeFileSync(staged, body)
          // Prefer a path the browser could claim from the OS drag (uri-list),
          // then an unambiguous exact-name match in the common directories;
          // otherwise the staged copy is the working path.
          const home = process.env.HOME ?? homedir()
          const claimedValid = claimedPath !== '' && existsSync(claimedPath) && basename(claimedPath).toLowerCase() === name.toLowerCase()
          const original = claimedValid
            ? claimedPath
            : resolveOriginalPath(name, home) ?? resolveOriginalViaMdfind(name)
          const resolved = original !== undefined
          writeJson(res, 200, {
            ok: true,
            path: original ?? staged,
            staged,
            name: basename(original ?? staged),
            bytes: body.length,
            resolved,
          })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
